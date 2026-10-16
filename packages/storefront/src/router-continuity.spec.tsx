// @vitest-environment jsdom
import { QueryClientProvider, useInfiniteQuery, useQuery } from '@tanstack/react-query';
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
import { PUBLIC_QUERY_STALE_TIME, storefrontQueryClient, storefrontQueryKeys } from './query-client';
import { router as productionRouter } from './router';
import { publicSeoQueryKey, setPublicPageNavigationScope } from './storefront-page-data';
import { type Product } from './types';

vi.hoisted(() => vi.stubEnv('VITE_CLIENT_CHANNEL_SWITCHING', 'false'));

const preloadRoute = vi.hoisted(() => vi.fn<(name: string) => Promise<void>>());
vi.mock('./route-component-preload', () => ({ preloadStorefrontRouteComponent: preloadRoute }));

// Keep the real Router options, public product loader, Query cache and navigation hook.
// The page body is small so every intermediate commit can be checked independently of styling.
vi.mock('./routeTree.gen', async () => {
    const { createRootRoute, createRoute } = await import('@tanstack/react-router');
    const { Route } = await import('./routes/product');
    const { Route: CategoryRoute } = await import('./routes/category');
    const { Route: ServicesRoute } = await import('./routes/services');
    const { Route: SupportRoute } = await import('./routes/support');
    const { Route: HomeRoute } = await import('./routes/index');
    const { storefrontRouteCodeLoader } = await import('./storefront-page-data');
    const root = createRootRoute({
        pendingMs: Infinity,
        shouldReload: true,
        preload: false,
        loaderDeps: ({ search }: { search: Record<string, unknown> }) => [
            search.__route,
            search.__storefrontLanguage,
        ],
        loader: { handler: storefrontRouteCodeLoader, staleReloadMode: 'blocking' },
        component: () => <NavigationHarness />,
    });
    return {
        routeTree: root.addChildren([
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
vi.mock('./route-pages/catalog-route-pages', () => ({
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

function HomeBody() {
    const products = storefrontQueryClient.getQueryData<Product[]>(
        storefrontQueryKeys.products('store-a:MYR', 'en', 12),
    );
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
    const media = storefrontQueryClient.getQueryData([
        ...storefrontQueryKeys.scope('store-a:MYR', 'en'),
        'public-media',
        publicPageRequestKey(request),
    ]);
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
    return <article data-product={id}>{result.data?.name ?? 'Waiting for product'}</article>;
}

function NavigationHarness() {
    const navigation = useStorefrontNavigation({ collections: [] });
    const [clicks, setClicks] = useState(0);
    return (
        <QueryClientProvider client={storefrontQueryClient}>
            <header data-presented-route={navigation.route.name} data-presented-product={navigation.route.id}>
                <button type="button" onClick={() => setClicks(value => value + 1)}>
                    Shell action {clicks}
                </button>
                <button type="button" onClick={navigation.goBack}>
                    Back
                </button>
            </header>
            <main>
                <Outlet />
            </main>
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
        'waits for first %s artwork before committing cached content',
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
            expect(host.querySelector('article')?.textContent).toBe('a');
            expect(host.querySelector('[data-content]')).toBeNull();
            await act(async () => {
                response.resolve(Response.json(page));
                await navigation;
            });
            expect(fetch).toHaveBeenCalledOnce();
            expect(host.querySelector('article')?.textContent).toBe('Backed artwork');
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
        });
        await vi.waitFor(() => expect(host.querySelector('article')?.textContent).toBe('Updated A'));
        expect(pendingNodes).toEqual([]);
    });

    it('keeps the cached article and interactive shell beyond 200ms until route code is ready without waiting for optional aggregate data', async () => {
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
        expect(host.querySelector('article')).toBe(article);
        expect(article?.textContent).toBe('a');
        expect(header?.dataset.presentedProduct).toBe('a');
        expect(host.querySelector('[data-content]')).toBeNull();
        expect(pendingNodes).toEqual([]);
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
        expect(pendingNodes).toEqual([]);
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
        expect(host.querySelector('article')?.textContent).toBe('a');
        await navigate('b');
        expect(host.querySelector('header')).toBe(header);
        expect(header?.dataset.presentedProduct).toBe('b');
        expect(host.querySelector('article')?.textContent).toBe('b');
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
        'keeps %s hover preloads out of the root code owner and binds the later navigation to its actual path',
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

            // Hover can warm the leaf's optional media without owning the blocking code flight.
            await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
            await vi.waitFor(() =>
                expect(
                    storefrontQueryClient.getQueryData(
                        publicSeoQueryKey('store-a:MYR', 'en', support, 'public-media'),
                    ),
                ).toEqual([]),
            );
            expect(preloadRoute).not.toHaveBeenCalled();
            expect(host.querySelector('header')?.dataset.presentedRoute).toBe('services');
            const code = deferred<void>();
            preloadRoute.mockImplementation(name => (name === 'support' ? code.promise : Promise.resolve()));
            const header = host.querySelector('header');
            const article = host.querySelector('article');
            pendingNodes.length = 0;
            let navigation: Promise<void> | undefined;
            await act(async () => {
                navigation = router.navigate({ to: '/support', search } as never);
                await Promise.resolve();
            });
            await vi.waitFor(() => expect(preloadRoute).toHaveBeenCalledWith('support'));
            // Intent preparation and the required root loader both use this facade.
            expect(preloadRoute.mock.calls.map(([name]) => name)).toEqual(['support', 'support']);
            expect(host.querySelector('header')).toBe(header);
            expect(header?.dataset.presentedRoute).toBe('services');
            expect(host.querySelector('article')).toBe(article);
            expect(pendingNodes).toEqual([]);
            await act(async () => {
                code.resolve();
                await navigation;
            });
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
        expect(host.querySelector('article')?.textContent).toBe('a');

        // Retaining search also retains the old internal value before rewrite.input replaces it.
        // This must use a distinct root code owner even though the public business search is identical.
        await act(async () => {
            await router.navigate({ to: '/support', search: true } as never);
        });
        expect(preloadRoute.mock.calls.map(([name]) => name)).toEqual([
            'services',
            'services',
            'support',
            'support',
        ]);
        expect(host.querySelector('header')).toBe(header);
        expect(header?.dataset.presentedRoute).toBe('support');
        expect(host.querySelector('[data-content]')?.textContent).toBe('Backed artwork');
        expect(router.state.location.search.__route).toBe('/support');
        const publicUrl = new URL(router.state.location.publicHref, 'https://example.test');
        expect(publicUrl.pathname).toBe('/en/support');
        expect(publicUrl.searchParams.get('term')).toBe('same');
        expect(publicUrl.searchParams.has('__route')).toBe(false);
        expect(publicUrl.searchParams.has('__storefrontLanguage')).toBe(false);
        expect(pendingNodes).toEqual([]);
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

    it('keeps the current body and shell interactive until a cold destination is ready', async () => {
        await start();
        const cold = deferred<Product>();
        readProduct.mockImplementation(() => cold.promise);
        const header = host.querySelector('header');
        let navigation: Promise<void> | undefined;
        await act(async () => {
            navigation = router.navigate({ to: '/product', search: { id: 'cold' } } as never);
            await Promise.resolve();
        });
        expect(host.querySelector('article')?.textContent).toBe('a');
        expect(host.querySelector('header')?.dataset.presentedProduct).toBe('a');
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 230));
        });

        expect(host.querySelector('header')).toBe(header);
        expect(host.querySelector('header')?.dataset.presentedProduct).toBe('a');
        expect(host.querySelector('article')?.textContent).toBe('a');
        expect(host.querySelector('main [data-page-pending]')).toBeNull();
        expect(host.querySelector('.brand-loading')).toBeNull();
        expect(host.querySelector('main main')).toBeNull();
        const button = host.querySelector('button');
        if (!button) throw new Error('Expected the retained shell action');
        act(() => button.click());
        expect(button.textContent).toBe('Shell action 1');

        await act(async () => {
            cold.resolve(product('cold'));
            await navigation;
        });
        expect(host.querySelector('article')?.textContent).toBe('cold');
    });

    it('keeps service-shared content from publishing the first home before its product aggregate arrives', async () => {
        await start();
        const page = syntheticPage('synthetic-a', 'en', 'home');
        page.scope.host = window.location.host;
        page.scope.channelCode = 'store-a';
        page.config.code = 'store-a';
        storefrontQueryClient.setQueryData(
            [...storefrontQueryKeys.content('store-a:MYR', 'en'), 'public'],
            page.content,
        );
        const response = deferred<Response>();
        const fetch = vi.fn(() => response.promise);
        vi.stubGlobal('fetch', fetch);
        const article = host.querySelector('article');
        const header = host.querySelector('header');
        let navigation: Promise<void> | undefined;
        await act(async () => {
            navigation = router.navigate({ to: '/', search: { __storefrontLanguage: 'en' } } as never);
            await new Promise(resolve => setTimeout(resolve, 230));
        });
        expect(host.querySelector('article')).toBe(article);
        expect(host.querySelector('[data-home]')).toBeNull();
        expect(host.querySelector('main [data-page-pending]')).toBeNull();
        const action = host.querySelector('button');
        if (!action) throw new Error('Expected retained shell action');
        act(() => action.click());
        expect(action.textContent).toBe('Shell action 1');
        await act(async () => {
            response.resolve(Response.json(page));
            await navigation;
        });
        expect(host.querySelector('header')).toBe(header);
        expect(header?.dataset.presentedRoute).toBe('home');
        expect(host.querySelector('[data-home]')?.textContent).toBe(
            page.products?.map(item => item.name).join(','),
        );
        expect(fetch).toHaveBeenCalledOnce();
        expect(pendingNodes).toEqual([]);
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
