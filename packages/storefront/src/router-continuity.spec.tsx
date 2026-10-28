// @vitest-environment jsdom
import { QueryClientProvider, skipToken, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
    createMemoryHistory,
    createRouter,
    Outlet,
    RouterProvider,
    useRouterState,
} from '@tanstack/react-router';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { publicPageRequestKey } from '../../storefront-content-plugin/src/shared/public-page-data';
import { mediaDescriptor } from '../../storefront-content-plugin/src/shared/responsive-image';
import { syntheticPage } from '../e2e/seo-public/fixtures.mjs';

import { useStorefrontNavigation } from './hooks/useStorefrontNavigation';
import { PageReadinessBoundary, usePageReadiness } from './page-readiness';
import { PUBLIC_QUERY_STALE_TIME, storefrontQueryClient, storefrontQueryKeys } from './query-client';
import { PageSkeleton } from './route-loading';
import { router as productionRouter } from './router';
import { publicSeoQueryKey, setPublicPageNavigationScope } from './storefront-page-data';
import { type Product } from './types';

vi.hoisted(() => vi.stubEnv('VITE_CLIENT_CHANNEL_SWITCHING', 'false'));

const preloadRoute = vi.hoisted(() => vi.fn<(name: string) => Promise<void>>());
vi.mock('./route-component-preload', () => ({ preloadStorefrontRouteComponent: preloadRoute }));

// Keep the real Router options, public product loader, Query cache and navigation hook.
// The page body is small so every intermediate commit can be checked independently of styling.
vi.mock('./routeTree.gen', async () => {
    const { createRoute } = await import('@tanstack/react-router');
    const { Route } = await import('./routes/product');
    const { Route: CategoryRoute } = await import('./routes/category');
    const { Route: ServicesRoute } = await import('./routes/services');
    const { Route: SupportRoute } = await import('./routes/support');
    const { Route: HomeRoute } = await import('./routes/index');
    const { Route: LegalRoute } = await import('./routes/legal');
    const { Route: RootRoute } = await import('./routes/__root');
    const root = RootRoute.update({ component: () => <NavigationHarness /> });
    return {
        routeTree: root.addChildren([
            createRoute({
                getParentRoute: () => root,
                path: '/legal',
                loader: LegalRoute.options.loader,
                component: () => <article data-legal>Legal content</article>,
            }),
            createRoute({
                getParentRoute: () => root,
                path: '/',
                loader: HomeRoute.options.loader,
                component: HomeBody,
            }),
            createRoute({
                getParentRoute: () => root,
                path: '/services',
                loader: ServicesRoute.options.loader,
                component: ContentBody,
            }),
            createRoute({
                getParentRoute: () => root,
                path: '/support',
                loader: SupportRoute.options.loader,
                component: ContentBody,
            }),
            createRoute({
                getParentRoute: () => root,
                path: '/product',
                validateSearch: Route.options.validateSearch,
                loaderDeps: Route.options.loaderDeps,
                loader: Route.options.loader,
                component: ProductBody,
            }),
            createRoute({
                getParentRoute: () => root,
                path: '/category',
                validateSearch: CategoryRoute.options.validateSearch,
                loaderDeps: CategoryRoute.options.loaderDeps,
                loader: CategoryRoute.options.loader,
                component: CategoryBody,
            }),
        ]),
    };
});
vi.mock('./App', () => ({ App: () => null }));
vi.mock('./route-pages/catalog-detail-route-pages', () => ({
    ProductRoutePage: () => null,
    preloadProductRoutePage: () => Promise.resolve(),
}));
vi.mock('./route-pages/category-route-page', () => ({
    CategoryRoutePage: () => null,
    preloadCategoryRoutePage: () => Promise.resolve(),
}));
vi.mock('./route-pages/content-route-pages', () => ({
    ServicesRoutePage: () => null,
    SupportRoutePage: () => null,
}));
vi.mock('./route-media-preload', () => ({ preloadRouteMedia: vi.fn() }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const scope = { channelCode: 'store-a', currencyCode: 'MYR', languageCode: 'en' };
const productKey = (id: string) => storefrontQueryKeys.product('store-a:MYR', 'en', id);
const product = (id: string, name = id) => ({ id, name }) as Product;
const readProduct = vi.fn<(id: string, signal?: AbortSignal) => Promise<Product | null>>();
const readCatalog = vi.fn(() => Promise.resolve({ items: [], totalItems: 0 }));
const productAction = vi.fn<(id: string) => void>();

function HomeBody() {
    const { data: products } = useQuery<Product[]>({
        queryKey: storefrontQueryKeys.products('store-a:MYR', 'en', 12),
        queryFn: skipToken,
    });
    usePageReadiness(products === undefined);
    if (products === undefined) return <PageSkeleton variant="home" />;
    return <article data-home>{products?.map(item => item.name).join(',') ?? 'Waiting for home'}</article>;
}

function CategoryBody() {
    const result = useInfiniteQuery({
        queryKey: storefrontQueryKeys.catalog('store-a:MYR', 'en', {}),
        queryFn: readCatalog,
        initialPageParam: 0,
        getNextPageParam: () => undefined,
        staleTime: PUBLIC_QUERY_STALE_TIME,
        refetchOnMount: false,
        retry: false,
    });
    return <article data-category>{result.data ? 'Empty category' : 'Waiting for category'}</article>;
}

function ContentBody() {
    const route = useRouterState({ select: state => state.matches.at(-1)?.pathname ?? '' });
    const request = {
        kind: 'page' as const,
        id: route.includes('support') ? ('support' as const) : ('services' as const),
    };
    const { data: media } = useQuery({
        queryKey: publicSeoQueryKey('store-a:MYR', 'en', request, 'public-media'),
        queryFn: skipToken,
    });
    return <article data-content>{media ? 'Backed artwork' : 'Unbacked artwork'}</article>;
}

function ProductBody() {
    const id = useRouterState({
        select: state => {
            const search = state.matches.at(-1)?.search;
            return search && 'id' in search ? String(search.id ?? '') : '';
        },
    });
    const result = useQuery({
        queryKey: productKey(id),
        queryFn: ({ signal }) => readProduct(id, signal),
        staleTime: PUBLIC_QUERY_STALE_TIME,
        refetchOnMount: false,
        retry: false,
    });
    usePageReadiness(result.isPending, 'page', id, result.isError);
    if (result.isPending) return <PageSkeleton variant="detail" />;
    return (
        <article data-product={id} onClick={() => productAction(id)}>
            {result.data?.name ?? 'Waiting for product'}
        </article>
    );
}

function NavigationHarness() {
    const navigation = useStorefrontNavigation({ collections: [] });
    const [clicks, setClicks] = useState(0);
    return (
        <QueryClientProvider client={storefrontQueryClient}>
            <PageReadinessBoundary
                initialScopeKey="store-a"
                navigationKey={JSON.stringify(navigation.route)}
                pending={false}
                navigationPreparing={navigation.isNavigationPending}
                online
                language="en"
                onRetry={() => undefined}
                onBack={navigation.goBack}
            >
                <header
                    data-presented-route={navigation.route.name}
                    data-presented-product={navigation.route.id}
                    data-auth-mode={navigation.authOverlay?.mode}
                >
                    <button type="button" onClick={() => setClicks(value => value + 1)}>
                        Shell action {clicks}
                    </button>
                    <button type="button" onClick={navigation.goBack}>
                        Back
                    </button>
                    <button type="button" onClick={() => navigation.navigate({ name: 'login' })}>
                        Sign in
                    </button>
                </header>
                <main>
                    <Outlet />
                </main>
            </PageReadinessBoundary>
        </QueryClientProvider>
    );
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => {
        resolve = done;
    });
    return { promise, resolve };
}

describe('real storefront router continuity', () => {
    let host: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;
    let router: typeof productionRouter;
    let observer: MutationObserver;
    let pendingNodes: Element[];

    beforeEach(() => {
        vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
        storefrontQueryClient.clear();
        storefrontQueryClient.setDefaultOptions({ queries: { retry: false } });
        storefrontQueryClient.setQueryData(storefrontQueryKeys.collections('store-a:MYR', 'en'), []);
        preloadRoute.mockReset();
        preloadRoute.mockResolvedValue(undefined);
        readProduct.mockReset();
        readProduct.mockImplementation(id => Promise.resolve(product(id)));
        readCatalog.mockClear();
        productAction.mockClear();
        setPublicPageNavigationScope({
            ...scope,
            api: { product: readProduct, catalog: readCatalog },
        });
        router = createRouter({
            ...productionRouter.options,
            history: createMemoryHistory({ initialEntries: ['/en/product?id=a'] }),
            scrollRestoration: false,
        });
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        pendingNodes = [];
        observer = new MutationObserver(records => {
            for (const record of records) {
                for (const node of record.addedNodes) {
                    if (!(node instanceof Element)) continue;
                    if (node.matches('[data-page-pending], .brand-loading')) pendingNodes.push(node);
                    pendingNodes.push(...node.querySelectorAll('[data-page-pending], .brand-loading'));
                }
            }
        });
        observer.observe(host, { childList: true, subtree: true });
    });

    afterEach(() => {
        observer.disconnect();
        act(() => root.unmount());
        host.remove();
        setPublicPageNavigationScope(undefined);
        storefrontQueryClient.clear();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    async function start() {
        await act(async () => {
            await router.load();
            root.render(<RouterProvider router={router} />);
        });
        expect(host.querySelector('article')?.textContent).toBe('a');
    }

    async function navigate(id: string) {
        await act(async () => {
            await router.navigate({ to: '/product', search: { id, __storefrontLanguage: 'en' } } as never);
        });
    }

    async function openCategory() {
        await act(async () => {
            await router.navigate({ to: '/category', search: { __storefrontLanguage: 'en' } } as never);
        });
        expect(host.querySelector('article')?.textContent).toBe('Empty category');
        expect(host.querySelector('header')?.dataset.presentedRoute).toBe('category');
    }

    it('reuses warm A-B-A immediately with the same shell and no intermediate skeleton or brand', async () => {
        await start();
        await openCategory();
        const header = host.querySelector('header');
        pendingNodes.length = 0;
        readProduct.mockClear();
        readCatalog.mockClear();

        await navigate('a');
        await openCategory();
        await navigate('a');

        expect(host.querySelector('header')).toBe(header);
        expect(host.querySelector('header')?.dataset.presentedProduct).toBe('a');
        expect(host.querySelector('article')?.textContent).toBe('a');
        expect(readProduct).not.toHaveBeenCalled();
        expect(readCatalog).not.toHaveBeenCalled();
        expect(pendingNodes).toEqual([]);
    });

    it.each(['services', 'support'] as const)(
        'commits cached %s content without waiting for optional artwork',
        async id => {
            await start();
            const response = deferred<Response>();
            const fetch = vi.fn(() => response.promise);
            vi.stubGlobal('fetch', fetch);
            const page = syntheticPage('synthetic-a', 'en', 'home');
            page.scope.host = window.location.host;
            page.scope.channelCode = 'store-a';
            page.config.code = 'store-a';
            page.request = { kind: 'page', id };
            page.requestKey = publicPageRequestKey(page.request);
            page.media = [
                mediaDescriptor(`/assets/preview/${id}.webp`, 'hero', {
                    inlinePreview: 'data:image/webp;base64,AAAA',
                }),
            ];
            storefrontQueryClient.setQueryData(
                [...storefrontQueryKeys.content('store-a:MYR', 'en'), 'public'],
                page.content,
            );
            let navigation: Promise<void> | undefined;
            await act(async () => {
                navigation = router.navigate({
                    to: `/${id}`,
                    search: { __storefrontLanguage: 'en' },
                } as never);
                await Promise.resolve();
            });
            await vi.waitFor(() =>
                expect(host.querySelector('[data-content]')?.textContent).toBe('Unbacked artwork'),
            );
            expect(host.querySelector('header')?.dataset.presentedRoute).toBe(id);
            await act(async () => {
                response.resolve(Response.json(page));
                await navigation;
            });
            expect(fetch).toHaveBeenCalledOnce();
            await vi.waitFor(() => expect(host.querySelector('article')?.textContent).toBe('Backed artwork'));
            expect(host.querySelector('.brand-loading')).toBeNull();
        },
    );

    it('shows stale cached data while refreshing it in the background without replacing the shell', async () => {
        await start();
        await navigate('b');
        const refresh = deferred<Product>();
        readProduct.mockImplementation(id => (id === 'a' ? refresh.promise : Promise.resolve(product(id))));
        storefrontQueryClient.setQueryData(productKey('a'), product('a'), {
            updatedAt: Date.now() - PUBLIC_QUERY_STALE_TIME - 1,
        });
        const header = host.querySelector('header');
        pendingNodes.length = 0;

        await navigate('a');

        expect(host.querySelector('header')).toBe(header);
        expect(host.querySelector('article')?.textContent).toBe('a');
        expect(storefrontQueryClient.getQueryState(productKey('a'))?.fetchStatus).toBe('fetching');
        expect(pendingNodes).toEqual([]);
        await act(async () => {
            refresh.resolve(product('a', 'Updated A'));
            await refresh.promise;
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        await vi.waitFor(() => expect(host.querySelector('article')?.textContent).toBe('Updated A'));
        expect(pendingNodes).toEqual([]);
    });

    it('presents the target during cold code loading without blocking on optional aggregate data', async () => {
        await start();
        expect(preloadRoute).toHaveBeenCalledWith('product');
        const code = deferred<void>();
        preloadRoute.mockImplementation(name => (name === 'services' ? code.promise : Promise.resolve()));
        const response = deferred<Response>();
        const fetch = vi.fn(() => response.promise);
        vi.stubGlobal('fetch', fetch);
        const page = syntheticPage('synthetic-a', 'en', 'home');
        page.scope.host = window.location.host;
        page.scope.channelCode = 'store-a';
        page.config.code = 'store-a';
        const request = { kind: 'page' as const, id: 'services' as const };
        page.request = request;
        page.requestKey = publicPageRequestKey(request);
        page.media = [mediaDescriptor('/assets/preview/services.webp', 'hero')];
        const seoKey = publicSeoQueryKey('store-a:MYR', 'en', request);
        const mediaKey = publicSeoQueryKey('store-a:MYR', 'en', request, 'public-media');
        storefrontQueryClient.setQueryData(seoKey, null);
        storefrontQueryClient.setQueryData(
            [...storefrontQueryKeys.content('store-a:MYR', 'en'), 'public'],
            page.content,
        );
        const header = host.querySelector('header');
        const article = host.querySelector('article');
        pendingNodes.length = 0;
        let navigation: Promise<void> | undefined;
        await act(async () => {
            navigation = router.navigate({
                to: '/services',
                search: { __storefrontLanguage: 'en' },
            } as never);
            await new Promise(resolve => setTimeout(resolve, 230));
        });
        expect(preloadRoute).toHaveBeenCalledWith('services');
        expect(fetch).toHaveBeenCalledOnce();
        expect(host.querySelector('header')).toBe(header);
        const hiddenArticle = host.querySelector('article');
        if (!hiddenArticle) throw new Error('Expected the retained offscreen subtree');
        expect(getComputedStyle(hiddenArticle).display).toBe('none');
        expect(header?.dataset.presentedRoute).toBe('services');
        if (!article) throw new Error('Expected the retained source article');
        expect(getComputedStyle(article).display).toBe('none');
        expect(host.querySelector('[data-content]')).toBeNull();
        expect(host.querySelector('main [data-page-pending]')).not.toBeNull();
        expect(host.querySelector('.page-readiness-navigation')).toBeNull();
        expect(host.querySelector('[data-page-pending][role="status"]')).not.toBeNull();
        expect(host.querySelector('.brand-loading')).toBeNull();
        const action = host.querySelector('header button');
        if (!(action instanceof HTMLButtonElement)) throw new Error('Expected the retained shell action');
        act(() => action.click());
        expect(action.textContent).toBe('Shell action 1');
        // Code readiness owns the commit; the aggregate remains deliberately unresolved.
        await act(async () => {
            code.resolve();
            await navigation;
        });
        expect(host.querySelector('header')).toBe(header);
        expect(header?.dataset.presentedRoute).toBe('services');
        expect(host.querySelector('[data-content]')?.textContent).toBe('Unbacked artwork');
        expect(storefrontQueryClient.getQueryData(mediaKey)).toBeUndefined();
        expect(fetch).toHaveBeenCalledOnce();
        expect(host.querySelector('main [data-page-pending]')).toBeNull();
        expect(host.querySelector('.page-readiness-navigation')).toBeNull();
        await act(async () => {
            response.resolve(Response.json(page));
            await Promise.resolve();
        });
        await vi.waitFor(() => expect(storefrontQueryClient.getQueryData(mediaKey)).toEqual(page.media));
        expect(fetch).toHaveBeenCalledOnce();
    });

    it('ignores an obsolete route code completion after a newer cached navigation commits', async () => {
        await start();
        const obsoleteCode = deferred<void>();
        preloadRoute.mockImplementation(name =>
            name === 'services' ? obsoleteCode.promise : Promise.resolve(),
        );
        const request = { kind: 'page' as const, id: 'services' as const };
        storefrontQueryClient.setQueryData(publicSeoQueryKey('store-a:MYR', 'en', request), null);
        storefrontQueryClient.setQueryData(
            publicSeoQueryKey('store-a:MYR', 'en', request, 'public-media'),
            [],
        );
        storefrontQueryClient.setQueryData(productKey('b'), product('b'));
        const header = host.querySelector('header');
        pendingNodes.length = 0;
        let abandoned: Promise<void> | undefined;
        await act(async () => {
            abandoned = router.navigate({ to: '/services', search: { __storefrontLanguage: 'en' } } as never);
            await Promise.resolve();
        });
        await vi.waitFor(() => expect(preloadRoute).toHaveBeenCalledWith('services'));
        await vi.waitFor(() => expect(host.querySelector('main [data-page-pending]')).not.toBeNull());
        const hiddenArticle = host.querySelector('article');
        if (!hiddenArticle) throw new Error('Expected the retained offscreen subtree');
        expect(getComputedStyle(hiddenArticle).display).toBe('none');
        await navigate('b');
        expect(host.querySelector('header')).toBe(header);
        expect(header?.dataset.presentedProduct).toBe('b');
        expect(host.querySelector('article')?.textContent).toBe('b');
        expect(pendingNodes.length).toBeGreaterThan(0);
        pendingNodes.length = 0;
        await act(async () => {
            obsoleteCode.resolve();
            await abandoned;
        });
        expect(header?.dataset.presentedProduct).toBe('b');
        expect(host.querySelector('article')?.textContent).toBe('b');
        expect(host.querySelector('[data-content]')).toBeNull();
        expect(pendingNodes).toEqual([]);
    });

    it.each([
        ['retained search', true],
        ['forged route search', { __route: '/services', __storefrontLanguage: 'en' }],
    ] as const)(
        'keeps %s hover preloads and the later navigation bound to their actual target paths',
        async (_label, search) => {
            await start();
            const services = { kind: 'page' as const, id: 'services' as const };
            const support = { kind: 'page' as const, id: 'support' as const };
            storefrontQueryClient.setQueryData(publicSeoQueryKey('store-a:MYR', 'en', services), null);
            storefrontQueryClient.setQueryData(
                publicSeoQueryKey('store-a:MYR', 'en', services, 'public-media'),
                [],
            );
            await act(async () => {
                await router.navigate({ to: '/services', search: { __storefrontLanguage: 'en' } } as never);
            });
            expect(host.querySelector('header')?.dataset.presentedRoute).toBe('services');
            storefrontQueryClient.setQueryData(publicSeoQueryKey('store-a:MYR', 'en', support), null);
            const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
            vi.stubGlobal('fetch', fetch);
            preloadRoute.mockClear();

            await act(async () => {
                await router.preloadRoute({ to: '/support', search } as never);
            });

            // Hover warms the actual target's code and optional media without committing navigation.
            await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
            await vi.waitFor(() =>
                expect(
                    storefrontQueryClient.getQueryData(
                        publicSeoQueryKey('store-a:MYR', 'en', support, 'public-media'),
                    ),
                ).toEqual([]),
            );
            expect(preloadRoute).toHaveBeenCalledWith('support');
            expect(preloadRoute).not.toHaveBeenCalledWith('services');
            preloadRoute.mockClear();
            expect(host.querySelector('header')?.dataset.presentedRoute).toBe('services');
            const header = host.querySelector('header');
            pendingNodes.length = 0;
            await act(async () => {
                await router.navigate({ to: '/support', search } as never);
            });
            await vi.waitFor(() => expect(preloadRoute).toHaveBeenCalledWith('support'));
            // The leaf owns code preparation; navigation does not repeat the intent hint.
            expect(preloadRoute.mock.calls.map(([name]) => name)).toEqual(['support']);
            expect(host.querySelector('header')).toBe(header);
            // A completed hover preload is warm: do not manufacture another cold code wait.
            expect(header?.dataset.presentedRoute).toBe('support');
            expect(router.state.location.search.__route).toBe('/support');
            const publicUrl = new URL(router.state.location.publicHref, 'https://example.test');
            expect(publicUrl.pathname).toBe('/en/support');
            expect(publicUrl.searchParams.has('__route')).toBe(false);
            expect(publicUrl.searchParams.has('__storefrontLanguage')).toBe(false);
            expect(pendingNodes).toEqual([]);
        },
    );

    it('commits a ready support target with retained search before an obsolete services code flight finishes', async () => {
        await start();
        for (const id of ['services', 'support'] as const) {
            const request = { kind: 'page' as const, id };
            storefrontQueryClient.setQueryData(publicSeoQueryKey('store-a:MYR', 'en', request), null);
            storefrontQueryClient.setQueryData(
                publicSeoQueryKey('store-a:MYR', 'en', request, 'public-media'),
                [],
            );
        }
        const obsoleteCode = deferred<void>();
        preloadRoute.mockClear();
        preloadRoute.mockImplementation(name =>
            name === 'services' ? obsoleteCode.promise : Promise.resolve(),
        );
        const header = host.querySelector('header');
        pendingNodes.length = 0;
        let abandoned: Promise<void> | undefined;
        await act(async () => {
            abandoned = router.navigate({
                to: '/services',
                search: { __storefrontLanguage: 'en', __route: '/support', term: 'same' },
            } as never);
            await Promise.resolve();
        });
        await vi.waitFor(() => expect(preloadRoute).toHaveBeenCalledWith('services'));
        expect(router.state.location.pathname).toBe('/services');
        expect(router.state.location.search.__route).toBe('/services');
        await vi.waitFor(() => expect(host.querySelector('main [data-page-pending]')).not.toBeNull());
        const hiddenArticle = host.querySelector('article');
        if (!hiddenArticle) throw new Error('Expected the retained offscreen subtree');
        expect(getComputedStyle(hiddenArticle).display).toBe('none');

        // Retaining search also retains the old internal value before rewrite.input replaces it.
        // This must use a distinct root code owner even though the public business search is identical.
        await act(async () => {
            await router.navigate({ to: '/support', search: true } as never);
        });
        expect(preloadRoute.mock.calls.map(([name]) => name)).toEqual(['services', 'support']);
        expect(host.querySelector('header')).toBe(header);
        expect(header?.dataset.presentedRoute).toBe('support');
        expect(host.querySelector('[data-content]')?.textContent).toBe('Backed artwork');
        expect(router.state.location.search.__route).toBe('/support');
        const publicUrl = new URL(router.state.location.publicHref, 'https://example.test');
        expect(publicUrl.pathname).toBe('/en/support');
        expect(publicUrl.searchParams.get('term')).toBe('same');
        expect(publicUrl.searchParams.has('__route')).toBe(false);
        expect(publicUrl.searchParams.has('__storefrontLanguage')).toBe(false);
        expect(host.querySelector('[data-page-pending]')).toBeNull();
        expect(pendingNodes.length).toBeGreaterThan(0);
        pendingNodes.length = 0;
        await act(async () => {
            obsoleteCode.resolve();
            await abandoned;
        });
        expect(host.querySelector('header')).toBe(header);
        expect(header?.dataset.presentedRoute).toBe('support');
        expect(router.state.location.pathname).toBe('/support');
        expect(host.querySelector('[data-content]')?.textContent).toBe('Backed artwork');
        expect(pendingNodes).toEqual([]);
    });

    it('commits the target identity and missing-data region while keeping the shell interactive', async () => {
        await start();
        const cold = deferred<Product>();
        readProduct.mockImplementation(() => cold.promise);
        const header = host.querySelector('header');
        await act(async () => {
            await router.navigate({ to: '/product', search: { id: 'cold' } } as never);
        });
        expect(host.querySelector('header')).toBe(header);
        expect(header?.dataset.presentedProduct).toBe('cold');
        expect(host.querySelector('article')).toBeNull();
        expect(host.querySelector('main [data-page-pending]')).not.toBeNull();
        expect(host.querySelector('.page-readiness-initial')).toBeNull();
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 230));
        });
        expect(host.querySelector('.page-readiness-navigation')).toBeNull();
        expect(host.querySelector('[data-page-pending][role="status"]')).not.toBeNull();
        expect(host.querySelector('.brand-loading')).toBeNull();
        expect(host.querySelector('main main')).toBeNull();
        const button = host.querySelector('button');
        act(() => button?.click());
        expect(button?.textContent).toBe('Shell action 1');
        expect(productAction).not.toHaveBeenCalled();
        await act(async () => {
            cold.resolve(product('cold'));
            await cold.promise;
        });
        await vi.waitFor(() => expect(host.querySelector('article')?.textContent).toBe('cold'));
        act(() => host.querySelector('article')?.click());
        expect(productAction).toHaveBeenLastCalledWith('cold');
        expect(header?.dataset.presentedProduct).toBe('cold');
    });

    it('shows the target code placeholder and lets the user leave without awaiting its module', async () => {
        await start();
        const code = deferred<void>();
        preloadRoute.mockImplementation(name => (name === 'legal' ? code.promise : Promise.resolve()));
        const header = host.querySelector('header');
        let navigation: Promise<void> | undefined;
        await act(async () => {
            navigation = router.navigate({ to: '/legal' } as never);
            await new Promise(resolve => setTimeout(resolve, 230));
        });
        expect(host.querySelector('header')).toBe(header);
        expect(header?.dataset.presentedRoute).toBe('legal');
        const hiddenArticle = host.querySelector('article');
        if (!hiddenArticle) throw new Error('Expected the retained offscreen subtree');
        expect(getComputedStyle(hiddenArticle).display).toBe('none');
        expect(host.querySelector('[data-page-pending]')).not.toBeNull();
        expect(host.querySelector('.page-readiness-navigation')).toBeNull();
        expect(host.querySelector('[data-page-pending][role="status"]')).not.toBeNull();
        expect(host.querySelector('.brand-loading')).toBeNull();
        await navigate('a');
        await act(async () => {
            code.resolve();
            await navigation;
        });
        expect(host.querySelector('article')?.textContent).toBe('a');
        expect(header?.dataset.presentedProduct).toBe('a');
        expect(host.querySelector('[data-page-pending]')).toBeNull();
    });

    it('opens the home body before its first aggregate completes and adopts that exact result', async () => {
        await start();
        const page = syntheticPage('synthetic-a', 'en', 'home');
        page.scope.host = window.location.host;
        page.scope.channelCode = 'store-a';
        page.config.code = 'store-a';
        const response = deferred<Response>();
        const fetch = vi.fn(() => response.promise);
        vi.stubGlobal('fetch', fetch);
        const header = host.querySelector('header');
        await act(async () => {
            await router.navigate({ to: '/', search: { __storefrontLanguage: 'en' } } as never);
        });
        expect(host.querySelector('header')).toBe(header);
        expect(header?.dataset.presentedRoute).toBe('home');
        expect(host.querySelector('article')).toBeNull();
        expect(host.querySelector('[data-page-pending]')).not.toBeNull();
        const action = host.querySelector('button');
        act(() => action?.click());
        expect(action?.textContent).toBe('Shell action 1');
        await act(async () => {
            response.resolve(Response.json(page));
            await response.promise;
        });
        await vi.waitFor(() =>
            expect(host.querySelector('[data-home]')?.textContent).toBe(
                page.products?.map(item => item.name).join(','),
            ),
        );
        expect(fetch).toHaveBeenCalledOnce();
        expect(host.querySelector('[data-page-pending]')).toBeNull();
    });

    it('keeps sign-in owned by the visible target after its code finishes', async () => {
        await start();
        const code = deferred<void>();
        preloadRoute.mockImplementation(name => (name === 'services' ? code.promise : Promise.resolve()));
        let navigation: Promise<void> | undefined;
        await act(async () => {
            navigation = router.navigate({ to: '/services' } as never);
            await new Promise(resolve => setTimeout(resolve, 230));
        });
        expect(host.querySelector('header')?.dataset.presentedRoute).toBe('services');
        const signIn = Array.from(host.querySelectorAll('button')).find(
            button => button.textContent === 'Sign in',
        );
        await act(async () => {
            signIn?.click();
            await vi.dynamicImportSettled();
        });
        expect(router.state.location.pathname).toBe('/services');
        expect(router.state.location.search.auth).toBe('login');
        await act(async () => {
            code.resolve();
            await navigation;
        });
        await vi.waitFor(() => expect(host.querySelector('header')?.dataset.authMode).toBe('login'));
        expect(router.state.location.pathname).toBe('/services');
        expect(host.querySelector('[data-product]')).toBeNull();
    });

    it('keeps the last navigation intent and restores visited content on history return', async () => {
        await start();
        const obsolete = deferred<Product>();
        readProduct.mockImplementation(id =>
            id === 'slow' ? obsolete.promise : Promise.resolve(product(id)),
        );
        let abandoned: Promise<void> | undefined;
        await act(async () => {
            abandoned = router.navigate({ to: '/product', search: { id: 'slow' } } as never);
            await Promise.resolve();
        });
        await navigate('b');
        await act(async () => {
            obsolete.resolve(product('slow'));
            await abandoned;
        });
        expect(host.querySelector('header')?.dataset.presentedProduct).toBe('b');
        expect(host.querySelector('article')?.textContent).toBe('b');
        await navigate('a');
        pendingNodes.length = 0;
        await act(async () => {
            router.history.back();
            await Promise.resolve();
        });
        await vi.waitFor(() => expect(host.querySelector('article')?.textContent).toBe('b'));
        expect(host.querySelector('header')?.dataset.presentedProduct).toBe('b');
        expect(pendingNodes).toEqual([]);
    });
});
