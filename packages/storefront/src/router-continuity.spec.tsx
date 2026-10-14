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

import { useStorefrontNavigation } from './hooks/useStorefrontNavigation';
import { PUBLIC_QUERY_STALE_TIME, storefrontQueryClient, storefrontQueryKeys } from './query-client';
import { router as productionRouter } from './router';
import { setPublicPageNavigationScope } from './storefront-page-data';
import { type Product } from './types';

// Keep the real Router options, public product loader, Query cache and navigation hook.
// The page body is small so every intermediate commit can be checked independently of styling.
vi.mock('./routeTree.gen', async () => {
    const { createRootRoute, createRoute } = await import('@tanstack/react-router');
    const { Route } = await import('./routes/product');
    const { Route: CategoryRoute } = await import('./routes/category');
    const root = createRootRoute({ component: () => <NavigationHarness /> });
    return {
        routeTree: root.addChildren([
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
vi.mock('./route-media-preload', () => ({ preloadRouteMedia: vi.fn() }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const scope = { channelCode: 'store-a', currencyCode: 'MYR', languageCode: 'en' };
const productKey = (id: string) => storefrontQueryKeys.product('store-a:MYR', 'en', id);
const product = (id: string, name = id) => ({ id, name }) as Product;
const readProduct = vi.fn<(id: string, signal?: AbortSignal) => Promise<Product | null>>();
const readCatalog = vi.fn(() => Promise.resolve({ items: [], totalItems: 0 }));

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
        storefrontQueryClient.clear();
        storefrontQueryClient.setDefaultOptions({ queries: { retry: false } });
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

    it('keeps the shell interactive during a cold read and limits the delayed fallback to the body', async () => {
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
        expect(host.querySelector('header')?.dataset.presentedProduct).toBe('cold');
        expect(host.querySelector('main [data-page-pending]')).not.toBeNull();
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
