// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import {
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    Outlet,
    RouterProvider,
    useNavigate,
    useRouterState,
} from '@tanstack/react-router';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { catalogInputFromRoute } from './catalog-route-query';
import { useCategoryPagination } from './hooks/useCategoryPagination';
import { PageReadinessBoundary } from './page-readiness';
import { storefrontQueryClient, storefrontQueryKeys } from './query-client';
import { Route as categoryRoute } from './routes/category';
import { publicPageRouteLoader, setPublicPageNavigationScope } from './storefront-page-data';
import { routeFromRouterLocation } from './storefront-router';
import {
    type CollectionSummary,
    type MarketConfig,
    type Product,
    type ProductSearchPage,
    type StorefrontCatalogInput,
} from './types';

const preloadCode = vi.hoisted(() => vi.fn<() => Promise<void>>());
vi.mock('./route-component-preload', () => ({ preloadStorefrontRouteComponent: preloadCode }));
vi.mock('./route-pages/category-route-page', () => ({ CategoryRoutePage: () => null }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const market = { code: 'catalog-store', currencyCode: 'MYR' } as MarketConfig;
const collections = [
    { id: 'first', name: 'First', children: [{ id: 'child', name: 'Child' }] },
] as CollectionSummary[];
const readCatalog =
    vi.fn<(input: StorefrontCatalogInput, signal?: AbortSignal) => Promise<ProductSearchPage>>();
const api = { catalog: readCatalog, product: vi.fn() };
const result = (name: string): ProductSearchPage => ({
    items: [{ id: name, name } as Product],
    totalItems: 1,
});
const cleanups: Array<() => void> = [];

function heldResult() {
    let resolve!: (value: ProductSearchPage) => void;
    const promise = new Promise<ProductSearchPage>(done => {
        resolve = done;
    });
    cleanups.push(() => resolve({ items: [], totalItems: 0 }));
    return { promise, resolve };
}

function Shell() {
    const pending = useRouterState({ select: state => state.status === 'pending' });
    return (
        <PageReadinessBoundary
            initialScopeKey="catalog-store"
            pending={false}
            navigationPreparing={pending}
            online
            language="en"
            onRetry={() => undefined}
            onBack={() => undefined}
        >
            <header>Store navigation</header>
            <Outlet />
        </PageReadinessBoundary>
    );
}

// Keep the real category route, query owner and readiness boundary. This small view
// makes removal of the category controls observable independently of CSS or assets.
function CatalogBody() {
    const navigate = useNavigate();
    const location = useRouterState({ select: state => state.matches.at(-1) });
    if (!location) throw new Error('Expected an active catalog route match');
    const route = routeFromRouterLocation(location.pathname, location.search);
    const pagination = useCategoryPagination({
        api,
        market,
        language: 'en',
        languageCode: 'en',
        input: catalogInputFromRoute(route),
        enabled: true,
        suspended: true,
        route,
    });
    const query = pagination.query;
    return (
        <main>
            <nav
                data-catalog-navigation
                data-selection={`${route.collectionId}/${route.childId ?? 'all'}/${route.sort ?? 'recommended'}`}
            >
                Category controls
                <button
                    type="button"
                    onClick={() =>
                        void navigate({
                            to: '/category',
                            search: { collectionId: 'first', childId: 'child' },
                        } as never)
                    }
                >
                    Child category
                </button>
                <button
                    type="button"
                    onClick={() =>
                        void navigate({
                            to: '/category',
                            search: { collectionId: 'first', sort: 'sales' },
                        } as never)
                    }
                >
                    Sort by sales
                </button>
                <button
                    type="button"
                    onClick={() =>
                        void navigate({ to: '/category', search: { collectionId: 'second' } } as never)
                    }
                >
                    Second category
                </button>
            </nav>
            <section ref={pagination.resultsRef} data-catalog-results aria-busy={query.isFetching}>
                {query.isPending ? (
                    <span data-result-pending>Loading products</span>
                ) : (
                    pagination.products.map(item => item.name).join(',')
                )}
            </section>
        </main>
    );
}

function makeRouter() {
    const root = createRootRoute({ component: Shell });
    const category = createRoute({
        getParentRoute: () => root,
        path: '/category',
        validateSearch: categoryRoute.options.validateSearch,
        loaderDeps: categoryRoute.options.loaderDeps,
        loader: categoryRoute.options.loader,
        component: CatalogBody,
    });
    return createRouter({
        routeTree: root.addChildren([
            createRoute({ getParentRoute: () => root, path: '/', component: () => <article>Home</article> }),
            category,
            createRoute({
                getParentRoute: () => root,
                path: '/search',
                validateSearch: categoryRoute.options.validateSearch,
                loaderDeps: categoryRoute.options.loaderDeps,
                loader: publicPageRouteLoader,
                component: CatalogBody,
            }),
        ]),
        history: createMemoryHistory({ initialEntries: ['/'] }),
        defaultPendingMs: 200,
        defaultPendingMinMs: 0,
        defaultPreloadStaleTime: 0,
        defaultPendingComponent: () => <div data-route-pending>Replacing the route</div>,
        scrollRestoration: false,
    });
}

describe('catalog route keeps category controls during product reads', () => {
    let host: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;
    let router: ReturnType<typeof makeRouter>;
    let replacedControls: boolean;
    let observer: MutationObserver;

    beforeEach(() => {
        vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
        storefrontQueryClient.clear();
        storefrontQueryClient.setDefaultOptions({ queries: { retry: false } });
        storefrontQueryClient.setQueryData(
            storefrontQueryKeys.collections('catalog-store:MYR', 'en'),
            collections,
        );
        preloadCode.mockReset().mockResolvedValue(undefined);
        readCatalog.mockReset().mockImplementation(() => Promise.resolve(result('Initial products')));
        setPublicPageNavigationScope({
            channelCode: market.code,
            currencyCode: market.currencyCode,
            languageCode: 'en',
            api,
        });
        router = makeRouter();
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        replacedControls = false;
        observer = new MutationObserver(records => {
            for (const record of records)
                for (const removed of record.removedNodes) {
                    if (
                        removed instanceof Element &&
                        (removed.matches('[data-catalog-navigation]') ||
                            removed.querySelector('[data-catalog-navigation]'))
                    )
                        replacedControls = true;
                }
        });
        observer.observe(host, { childList: true, subtree: true });
    });

    afterEach(async () => {
        observer.disconnect();
        await act(async () => {
            for (const release of cleanups.splice(0)) release();
            root.unmount();
            await Promise.resolve();
        });
        host.remove();
        setPublicPageNavigationScope(undefined);
        storefrontQueryClient.clear();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    async function start() {
        await act(async () => {
            await router.load();
            root.render(
                <QueryClientProvider client={storefrontQueryClient}>
                    <RouterProvider router={router} />
                </QueryClientProvider>,
            );
        });
    }

    async function navigate(search: Record<string, string>) {
        await act(async () => {
            await router.navigate({ to: '/category', search } as never);
        });
    }

    async function settleBeyondRouteThreshold() {
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 260));
        });
    }

    it('opens category controls before a cold first product read completes and shares that read', async () => {
        const response = heldResult();
        readCatalog.mockReturnValue(response.promise);
        await start();
        let navigation: Promise<void> | undefined;
        await act(async () => {
            navigation = router.navigate({ to: '/category', search: { collectionId: 'first' } } as never);
            await Promise.resolve();
        });
        await settleBeyondRouteThreshold();

        expect(host.querySelector('[data-catalog-navigation]')).not.toBeNull();
        expect(host.querySelector('[data-result-pending]')).not.toBeNull();
        expect(host.querySelector('[data-route-pending]')).toBeNull();
        expect(readCatalog).toHaveBeenCalledOnce();
        await act(async () => {
            response.resolve(result('First products'));
            await navigation;
        });
        await vi.waitFor(() =>
            expect(host.querySelector('[data-catalog-results]')?.textContent).toBe('First products'),
        );
    });

    it('commits search controls while the result query owns its unresolved read', async () => {
        const response = heldResult();
        readCatalog.mockReturnValue(response.promise);
        await start();
        let navigation: Promise<void> | undefined;
        await act(async () => {
            navigation = router.navigate({ to: '/search', search: { term: 'unseen' } } as never);
            await Promise.resolve();
        });
        await settleBeyondRouteThreshold();
        expect(host.querySelector('[data-catalog-navigation]')).not.toBeNull();
        expect(host.querySelector('[data-route-pending]')).toBeNull();
        expect(router.state.status).toBe('idle');
        expect(readCatalog).toHaveBeenCalledOnce();
        await act(async () => {
            response.resolve(result('Search results'));
            await navigation;
        });
    });

    it.each([
        ['Child category', 'first/child/recommended'],
        ['Sort by sales', 'first/all/sales'],
        ['Second category', 'second/all/recommended'],
    ])('keeps mounted category controls while %s has no cached results', async (label, selected) => {
        await start();
        await navigate({ collectionId: 'first' });
        const controls = host.querySelector('[data-catalog-navigation]');
        const response = heldResult();
        readCatalog.mockClear().mockReturnValue(response.promise);
        await act(async () => {
            const control = Array.from(host.querySelectorAll('button')).find(
                button => button.textContent === label,
            );
            if (!control) throw new Error(`Expected catalog control: ${label}`);
            control.click();
            await Promise.resolve();
        });
        await settleBeyondRouteThreshold();

        expect(host.querySelector('[data-catalog-navigation]')).toBe(controls);
        expect(controls?.getAttribute('data-selection')).toBe(selected);
        expect(replacedControls).toBe(false);
        expect(host.querySelector('[data-result-pending]')).not.toBeNull();
        expect(host.querySelector('[data-catalog-results]')?.textContent).not.toContain('Initial products');
        expect(host.querySelector('[data-route-pending]')).toBeNull();
        expect(readCatalog).toHaveBeenCalledOnce();
        await act(async () => {
            response.resolve(result('Selected products'));
            await Promise.resolve();
        });
        await vi.waitFor(() =>
            expect(host.querySelector('[data-catalog-results]')?.textContent).toBe('Selected products'),
        );
    });

    it('keeps the latest selection and products when an earlier category finishes late', async () => {
        await start();
        await navigate({ collectionId: 'first' });
        const controls = host.querySelector('[data-catalog-navigation]');
        const older = heldResult();
        const latest = heldResult();
        readCatalog.mockImplementation(input =>
            input.collectionId === 'second' ? older.promise : latest.promise,
        );
        await navigate({ collectionId: 'second' });
        await navigate({ collectionId: 'third' });
        await act(async () => {
            latest.resolve(result('Latest products'));
            await Promise.resolve();
        });
        await vi.waitFor(() =>
            expect(host.querySelector('[data-catalog-results]')?.textContent).toBe('Latest products'),
        );
        await act(async () => {
            older.resolve(result('Old products'));
            await Promise.resolve();
        });

        expect(host.querySelector('[data-catalog-navigation]')).toBe(controls);
        expect(controls?.getAttribute('data-selection')).toBe('third/all/recommended');
        expect(host.querySelector('[data-catalog-results]')?.textContent).toBe('Latest products');
        expect(replacedControls).toBe(false);
    });

    it('completes route preloading while the query warms, then opens cached products without another request', async () => {
        await start();
        const response = heldResult();
        readCatalog.mockReturnValue(response.promise);
        await router.preloadRoute({ to: '/category', search: { collectionId: 'first' } } as never);
        const queryKey = storefrontQueryKeys.catalog('catalog-store:MYR', 'en', { collectionId: 'first' });
        expect(readCatalog).toHaveBeenCalledOnce();
        expect(storefrontQueryClient.getQueryState(queryKey)?.fetchStatus).toBe('fetching');
        expect(storefrontQueryClient.getQueryData(queryKey)).toBeUndefined();
        expect(host.querySelector('article')?.textContent).toBe('Home');
        await act(async () => {
            response.resolve(result('Prepared products'));
            await Promise.resolve();
        });
        await vi.waitFor(() => expect(storefrontQueryClient.getQueryState(queryKey)?.status).toBe('success'));
        await navigate({ collectionId: 'first' });
        expect(host.querySelector('[data-catalog-results]')?.textContent).toBe('Prepared products');
        expect(readCatalog).toHaveBeenCalledOnce();
        expect(host.querySelector('[data-result-pending]')).toBeNull();
    });

    it('does not turn an unfinished intent preload into a blocking navigation', async () => {
        await start();
        const response = heldResult();
        readCatalog.mockReturnValue(response.promise);
        const preload = router.preloadRoute({ to: '/category', search: { collectionId: 'first' } } as never);
        await vi.waitFor(() => expect(readCatalog).toHaveBeenCalledOnce());
        let navigation: Promise<void> | undefined;
        await act(async () => {
            navigation = router.navigate({ to: '/category', search: { collectionId: 'first' } } as never);
            await Promise.resolve();
        });
        await settleBeyondRouteThreshold();
        expect(host.querySelector('[data-catalog-navigation]')).not.toBeNull();
        expect(host.querySelector('[data-route-pending]')).toBeNull();
        expect(readCatalog).toHaveBeenCalledOnce();
        await act(async () => {
            response.resolve(result('Prepared products'));
            await Promise.all([preload, navigation]);
        });
    });
});
