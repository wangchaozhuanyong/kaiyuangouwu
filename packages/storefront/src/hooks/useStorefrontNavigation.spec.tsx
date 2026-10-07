// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BottomNavigation } from '../components/common/bottom-navigation';
import { type CollectionSummary } from '../types';

import { useStorefrontNavigation } from './useStorefrontNavigation';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type MockLocation = { pathname: string; search: Record<string, unknown>; searchStr: string };
type MockNavigationEvent = { toLocation: MockLocation; hrefChanged: boolean };
const router = vi.hoisted(() => ({
    navigate: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    preloadRoute: vi.fn(() => Promise.resolve()),
    listeners: new Map<string, Set<(event: MockNavigationEvent) => void>>(),
    subscribe: vi.fn(),
    state: {
        location: { pathname: '/category', search: {}, searchStr: '' },
        resolvedLocation: { pathname: '/category', search: {}, searchStr: '' },
        status: 'idle',
    },
}));
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => router.navigate,
    useRouter: () => routerInstance,
    useRouterState: ({ select }: { select: (state: typeof router.state) => unknown }) => select(router.state),
}));

const routerInstance = {
    ...router,
    history: { back: router.back, forward: router.forward, canGoBack: () => true },
};
vi.mock('../route-component-preload', () => ({
    preloadStorefrontRouteComponent: vi.fn(() => Promise.resolve()),
}));
vi.mock('../route-media-preload', () => ({ preloadRouteMedia: vi.fn() }));

function emitLoad(location: MockLocation, beforeNavigate = true) {
    const event = {
        toLocation: location,
        hrefChanged:
            router.state.location.pathname !== location.pathname ||
            router.state.location.searchStr !== location.searchStr,
    };
    router.state.location = location;
    if (beforeNavigate) router.listeners.get('onBeforeNavigate')?.forEach(listener => listener(event));
    router.listeners.get('onBeforeLoad')?.forEach(listener => listener(event));
}

describe('storefront navigation state', () => {
    let root: ReturnType<typeof createRoot>;
    let host: HTMLDivElement;
    let unmounted: boolean;
    let value: ReturnType<typeof useStorefrontNavigation>;
    let prepareProduct: ((id: string) => Promise<void>) | undefined;
    const collections: CollectionSummary[] = [
        {
            id: 'first',
            name: '分类',
            slug: 'first',
            description: '',
            position: 1,
            parentId: 'root',
            featuredAsset: null,
            children: [],
        },
    ];
    function Harness() {
        value = useStorefrontNavigation({ collections, prepareProduct });
        return <BottomNavigation activeRoute={value.route.name} cartQuantity={0} language="zh" />;
    }
    function servicesLink() {
        const link = host.querySelector<HTMLAnchorElement>('a[href="/services"]');
        if (!link) throw new Error('Expected the actual services navigation link');
        return link;
    }
    beforeEach(() => {
        prepareProduct = undefined;
        router.navigate.mockClear();
        router.state.location = { pathname: '/category', search: {}, searchStr: '' };
        router.state.resolvedLocation = router.state.location;
        router.state.status = 'idle';
        router.listeners.clear();
        router.subscribe.mockImplementation(
            (eventType: string, listener: (event: MockNavigationEvent) => void) => {
                const listeners = router.listeners.get(eventType) ?? new Set();
                listeners.add(listener);
                router.listeners.set(eventType, listeners);
                return () => listeners.delete(listener);
            },
        );
        router.navigate.mockImplementation(
            ({ to, search = {} }: { to: string; search?: Record<string, unknown> }) => {
                emitLoad({
                    pathname: to,
                    search,
                    searchStr: new URLSearchParams(
                        Object.entries(search).map(([key, searchValue]) => [key, String(searchValue)]),
                    ).toString(),
                });
                return Promise.resolve();
            },
        );
        router.back.mockImplementation(() => emitLoad({ pathname: '/services', search: {}, searchStr: '' }));
        router.forward.mockImplementation(() => emitLoad({ pathname: '/cart', search: {}, searchStr: '' }));
        router.preloadRoute.mockClear();
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        unmounted = false;
    });
    afterEach(() => {
        if (!unmounted) act(() => root.unmount());
        host.remove();
        vi.useRealTimers();
    });

    it('keeps the URL all-products default and remembers explicit filters when returning', () => {
        act(() => root.render(<Harness />));
        expect(value.activeCollectionId).toBe('all');
        expect(value.activeChildId).toBe('all');
        act(() => value.updateCategory({ collectionId: 'picked', minPrice: '10', inStockOnly: true }));
        act(() => value.navigate({ name: 'category' }));
        expect(router.navigate).toHaveBeenLastCalledWith(
            expect.objectContaining({
                to: '/category',
                search: expect.objectContaining({
                    collectionId: 'picked',
                    minPrice: '10',
                    inStockOnly: true,
                }),
            }),
        );
    });

    it('resynchronizes filter state after a history navigation', () => {
        act(() => root.render(<Harness />));
        router.state.location = {
            pathname: '/category',
            search: { collectionId: 'history', minPrice: '20' },
            searchStr: '',
        };
        act(() => root.render(<Harness />));
        expect(value.activeCollectionId).toBe('history');
        expect(value.minimumPrice).toBe('20');
    });

    it('keeps the resolved page visible while the destination is loading', () => {
        router.state.status = 'pending';
        router.state.location = { pathname: '/product', search: { id: 'p1' }, searchStr: '?id=p1' };
        act(() => root.render(<Harness />));
        expect(value.route.name).toBe('product');
        expect(value.displayedRoute.name).toBe('category');
    });

    it('keeps the current page while product data is prepared', async () => {
        let finishPreparation!: () => void;
        prepareProduct = vi.fn(
            () =>
                new Promise<void>(resolve => {
                    finishPreparation = resolve;
                }),
        );
        act(() => root.render(<Harness />));
        act(() => value.navigate({ name: 'product', id: 'p1' }));
        expect(value.isPreparingProduct).toBe(true);
        expect(router.navigate).not.toHaveBeenCalled();
        await act(() => {
            finishPreparation();
            return Promise.resolve();
        });
        expect(value.isPreparingProduct).toBe(false);
        expect(router.navigate).toHaveBeenCalledWith(
            expect.objectContaining({ to: '/product', search: expect.objectContaining({ id: 'p1' }) }),
        );
    });

    it('continues to the product after the bounded preparation wait', async () => {
        vi.useFakeTimers();
        prepareProduct = vi.fn(() => new Promise<void>(() => undefined));
        act(() => root.render(<Harness />));
        act(() => value.navigate({ name: 'product', id: 'p1' }));
        expect(value.isPreparingProduct).toBe(true);
        await act(async () => vi.advanceTimersByTimeAsync(1_800));
        expect(value.isPreparingProduct).toBe(false);
        expect(router.navigate).toHaveBeenCalledWith(
            expect.objectContaining({ to: '/product', search: expect.objectContaining({ id: 'p1' }) }),
        );
    });

    it.each(['resolve', 'timeout', 'reject'] as const)(
        'keeps the actual services navigation after old product preparation %s',
        async completion => {
            vi.useFakeTimers();
            let finish!: () => void;
            let fail!: (reason: Error) => void;
            prepareProduct = vi.fn(
                () =>
                    new Promise<void>((resolve, reject) => {
                        finish = resolve;
                        fail = reject;
                    }),
            );
            act(() => root.render(<Harness />));
            act(() => value.navigate({ name: 'product', id: 'old-product' }));
            expect(value.isPreparingProduct).toBe(true);
            act(() => servicesLink().click());
            await act(async () => {
                if (completion === 'resolve') finish();
                if (completion === 'reject') fail(new Error('old request failed'));
                await vi.advanceTimersByTimeAsync(1_800);
            });
            expect(value.isPreparingProduct).toBe(false);
            expect(router.state.location.pathname).toBe('/services');
            expect(router.navigate).toHaveBeenCalledTimes(1);
            expect(router.navigate).toHaveBeenLastCalledWith({ to: '/services' });
        },
    );

    it('invalidates pending product preparation even when the real navigation has the same href', async () => {
        let finish!: () => void;
        prepareProduct = vi.fn(
            () =>
                new Promise<void>(resolve => {
                    finish = resolve;
                }),
        );
        act(() => root.render(<Harness />));
        act(() => value.navigate({ name: 'product', id: 'old-product' }));
        act(() => {
            void router.navigate({ to: '/category' });
        });
        await act(async () => {
            finish();
            await Promise.resolve();
        });
        expect(value.isPreparingProduct).toBe(false);
        expect(router.navigate).toHaveBeenCalledTimes(1);
        expect(router.state.location.pathname).toBe('/category');
    });

    it.each(['back', 'forward'] as const)(
        'invalidates pending preparation on external history %s',
        async direction => {
            let finish!: () => void;
            prepareProduct = vi.fn(
                () =>
                    new Promise<void>(resolve => {
                        finish = resolve;
                    }),
            );
            act(() => root.render(<Harness />));
            act(() => value.navigate({ name: 'product', id: 'old-product' }));
            act(() => {
                void routerInstance.history[direction]();
            });
            await act(async () => {
                finish();
                await Promise.resolve();
            });
            expect(value.isPreparingProduct).toBe(false);
            expect(router.state.location.pathname).toBe(direction === 'back' ? '/services' : '/cart');
            expect(router.navigate).not.toHaveBeenCalled();
        },
    );

    it('invalidates pending preparation for redirected loads that omit onBeforeNavigate', async () => {
        let finish!: () => void;
        prepareProduct = vi.fn(
            () =>
                new Promise<void>(resolve => {
                    finish = resolve;
                }),
        );
        act(() => root.render(<Harness />));
        act(() => value.navigate({ name: 'product', id: 'old-product' }));
        act(() => emitLoad({ pathname: '/services', search: {}, searchStr: '' }, false));
        await act(async () => {
            finish();
            await Promise.resolve();
        });
        expect(value.isPreparingProduct).toBe(false);
        expect(router.state.location.pathname).toBe('/services');
        expect(router.navigate).not.toHaveBeenCalled();
    });

    it.each(['resolve', 'timeout'] as const)(
        'does not commit old product preparation after unmount and %s',
        async completion => {
            vi.useFakeTimers();
            let finish!: () => void;
            prepareProduct = vi.fn(
                () =>
                    new Promise<void>(resolve => {
                        finish = resolve;
                    }),
            );
            act(() => root.render(<Harness />));
            act(() => value.navigate({ name: 'product', id: 'old-product' }));
            act(() => root.unmount());
            unmounted = true;
            await act(async () => {
                if (completion === 'resolve') finish();
                await vi.advanceTimersByTimeAsync(1_800);
            });
            expect(router.navigate).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
            expect([...router.listeners.values()].every(listeners => listeners.size === 0)).toBe(true);
        },
    );

    it('keeps pending product preparation through focus and hover preloads', async () => {
        let finish!: () => void;
        prepareProduct = vi.fn(
            () =>
                new Promise<void>(resolve => {
                    finish = resolve;
                }),
        );
        act(() => root.render(<Harness />));
        act(() => value.navigate({ name: 'product', id: 'product-a' }));
        const services = servicesLink();
        act(() => {
            services.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            services.focus();
            services.dispatchEvent(new Event('pointerover', { bubbles: true }));
        });
        expect(router.preloadRoute).toHaveBeenCalled();
        expect(value.isPreparingProduct).toBe(true);
        expect(router.navigate).not.toHaveBeenCalled();
        await act(async () => {
            finish();
            await Promise.resolve();
        });
        expect(router.navigate).toHaveBeenCalledTimes(1);
        expect(router.navigate).toHaveBeenLastCalledWith(
            expect.objectContaining({ to: '/product', search: expect.objectContaining({ id: 'product-a' }) }),
        );
    });

    it('lets only the latest rapid product request commit and keeps its preparation state', async () => {
        const finish = new Map<string, () => void>();
        prepareProduct = vi.fn(
            id =>
                new Promise<void>(resolve => {
                    finish.set(id, resolve);
                }),
        );
        act(() => root.render(<Harness />));
        act(() => value.navigate({ name: 'product', id: 'product-a' }));
        act(() => value.navigate({ name: 'product', id: 'product-b' }));
        await act(async () => {
            const finishA = finish.get('product-a');
            if (!finishA) throw new Error('Expected pending product A');
            finishA();
            await Promise.resolve();
        });
        expect(router.navigate).not.toHaveBeenCalled();
        expect(value.isPreparingProduct).toBe(true);
        await act(async () => {
            const finishB = finish.get('product-b');
            if (!finishB) throw new Error('Expected pending product B');
            finishB();
            await Promise.resolve();
        });
        expect(value.isPreparingProduct).toBe(false);
        expect(router.navigate).toHaveBeenCalledTimes(1);
        expect(router.navigate).toHaveBeenLastCalledWith(
            expect.objectContaining({ to: '/product', search: expect.objectContaining({ id: 'product-b' }) }),
        );
    });

    it('keeps the original product deadline when the same pending target is clicked again', async () => {
        vi.useFakeTimers();
        prepareProduct = vi.fn(() => new Promise<void>(() => undefined));
        act(() => root.render(<Harness />));
        act(() => value.navigate({ name: 'product', id: 'product-a' }));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1_000);
        });
        act(() => value.navigate({ name: 'product', id: 'product-a' }));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(800);
        });
        expect(value.isPreparingProduct).toBe(false);
        expect(router.navigate).toHaveBeenCalledTimes(1);
        expect(router.navigate).toHaveBeenLastCalledWith(
            expect.objectContaining({ to: '/product', search: expect.objectContaining({ id: 'product-a' }) }),
        );
        expect(prepareProduct).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('shares one pending preparation for the same full product target and replace intent', async () => {
        let finish!: () => void;
        prepareProduct = vi.fn(
            () =>
                new Promise<void>(resolve => {
                    finish = resolve;
                }),
        );
        act(() => root.render(<Harness />));
        act(() => value.navigate({ name: 'product', id: 'product-a', variantId: 'variant-a' }));
        act(() => value.navigate({ variantId: 'variant-a', id: 'product-a', name: 'product' }, false));
        expect(prepareProduct).toHaveBeenCalledTimes(1);
        expect(value.isPreparingProduct).toBe(true);
        await act(async () => {
            finish();
            await Promise.resolve();
        });
        expect(router.navigate).toHaveBeenCalledTimes(1);
        expect(router.navigate).toHaveBeenLastCalledWith(
            expect.objectContaining({
                to: '/product',
                search: expect.objectContaining({ id: 'product-a', variantId: 'variant-a' }),
                replace: false,
            }),
        );
    });

    it.each(['replace', 'variant'] as const)(
        'supersedes the same product when its %s intent differs',
        async intent => {
            const finishes: Array<() => void> = [];
            prepareProduct = vi.fn(
                () =>
                    new Promise<void>(resolve => {
                        finishes.push(resolve);
                    }),
            );
            act(() => root.render(<Harness />));
            act(() => value.navigate({ name: 'product', id: 'product-a', variantId: 'variant-a' }));
            act(() =>
                value.navigate(
                    {
                        name: 'product',
                        id: 'product-a',
                        variantId: intent === 'variant' ? 'variant-b' : 'variant-a',
                    },
                    intent === 'replace',
                ),
            );
            expect(prepareProduct).toHaveBeenCalledTimes(2);
            await act(async () => {
                finishes[0]();
                await Promise.resolve();
            });
            expect(router.navigate).not.toHaveBeenCalled();
            expect(value.isPreparingProduct).toBe(true);
            await act(async () => {
                finishes[1]();
                await Promise.resolve();
            });
            expect(router.navigate).toHaveBeenCalledTimes(1);
            expect(router.navigate).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    to: '/product',
                    search: expect.objectContaining({
                        id: 'product-a',
                        variantId: intent === 'variant' ? 'variant-b' : 'variant-a',
                    }),
                    replace: intent === 'replace',
                }),
            );
        },
    );

    it('releases the dedupe target after real navigation so a later product click can prepare again', async () => {
        const finishes: Array<() => void> = [];
        prepareProduct = vi.fn(
            () =>
                new Promise<void>(resolve => {
                    finishes.push(resolve);
                }),
        );
        act(() => root.render(<Harness />));
        act(() => value.navigate({ name: 'product', id: 'product-a' }));
        act(() => value.navigate({ name: 'product', id: 'product-a' }));
        expect(prepareProduct).toHaveBeenCalledTimes(1);
        act(() => servicesLink().click());
        await act(async () => {
            finishes[0]();
            await Promise.resolve();
        });
        expect(router.state.location.pathname).toBe('/services');
        expect(router.navigate).toHaveBeenCalledTimes(1);
        act(() => value.navigate({ name: 'product', id: 'product-a' }));
        expect(prepareProduct).toHaveBeenCalledTimes(2);
        await act(async () => {
            finishes[1]();
            await Promise.resolve();
        });
        expect(router.state.location.pathname).toBe('/product');
        expect(router.navigate).toHaveBeenCalledTimes(2);
    });

    it('does not merge the same target after its preparation context changes', async () => {
        let finishOld!: () => void;
        let finishNew!: () => void;
        const oldPrepare = vi.fn(
            () =>
                new Promise<void>(resolve => {
                    finishOld = resolve;
                }),
        );
        const newPrepare = vi.fn(
            () =>
                new Promise<void>(resolve => {
                    finishNew = resolve;
                }),
        );
        prepareProduct = oldPrepare;
        act(() => root.render(<Harness />));
        act(() => value.navigate({ name: 'product', id: 'product-a' }));
        prepareProduct = newPrepare;
        act(() => root.render(<Harness />));
        act(() => value.navigate({ name: 'product', id: 'product-a' }));
        expect(oldPrepare).toHaveBeenCalledTimes(1);
        expect(newPrepare).toHaveBeenCalledTimes(1);
        await act(async () => {
            finishOld();
            await Promise.resolve();
        });
        expect(router.navigate).not.toHaveBeenCalled();
        expect(value.isPreparingProduct).toBe(true);
        await act(async () => {
            finishNew();
            await Promise.resolve();
        });
        expect(router.navigate).toHaveBeenCalledTimes(1);
        expect(value.isPreparingProduct).toBe(false);
    });

    it('retains navigation fallback when the current product preparation fails', async () => {
        prepareProduct = vi.fn(() => Promise.reject(new Error('network failed')));
        act(() => root.render(<Harness />));
        act(() => value.navigate({ name: 'product', id: 'product-a' }));
        await act(async () => {
            await Promise.resolve();
        });
        expect(value.isPreparingProduct).toBe(false);
        expect(router.navigate).toHaveBeenCalledTimes(1);
        expect(router.navigate).toHaveBeenLastCalledWith(
            expect.objectContaining({ to: '/product', search: expect.objectContaining({ id: 'product-a' }) }),
        );
    });

    async function actualMemoryRouter(initialEntries: string[] = ['/category'], initialIndex = 0) {
        const actual =
            await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router');
        const rootRoute = actual.createRootRoute();
        const routeTree = rootRoute.addChildren(
            ['/category', '/services', '/cart'].map(path =>
                actual.createRoute({ getParentRoute: () => rootRoute, path }),
            ),
        );
        return actual.createRouter({
            routeTree,
            history: actual.createMemoryHistory({ initialEntries, initialIndex }),
        });
    }

    it('uses actual same-href load events to cancel preparation while actual hover preload leaves it active', async () => {
        const actualRouter = await actualMemoryRouter();
        await actualRouter.load();
        const loads: boolean[] = [];
        const unsubscribe = actualRouter.subscribe('onBeforeLoad', event => {
            loads.push(event.hrefChanged);
            const location = {
                pathname: event.toLocation.pathname,
                search: event.toLocation.search,
                searchStr: event.toLocation.searchStr,
            };
            router.listeners
                .get('onBeforeLoad')
                ?.forEach(listener => listener({ toLocation: location, hrefChanged: event.hrefChanged }));
        });
        let finish!: () => void;
        prepareProduct = vi.fn(
            () =>
                new Promise<void>(resolve => {
                    finish = resolve;
                }),
        );
        act(() => root.render(<Harness />));
        act(() => value.navigate({ name: 'product', id: 'old-product' }));
        await act(async () => {
            await actualRouter.preloadRoute({ to: '/services' });
        });
        expect(loads).toEqual([]);
        expect(value.isPreparingProduct).toBe(true);
        await act(async () => {
            await actualRouter.navigate({ to: '/category' });
        });
        expect(loads).toEqual([false]);
        await act(async () => {
            finish();
            await Promise.resolve();
        });
        expect(value.isPreparingProduct).toBe(false);
        expect(router.navigate).not.toHaveBeenCalled();
        expect(actualRouter.state.location.pathname).toBe('/category');
        unsubscribe();
    });

    it.each(['back', 'forward'] as const)(
        'cancels preparation using actual memory-history %s load events',
        async direction => {
            const actualRouter = await actualMemoryRouter(['/category', '/services', '/cart'], 1);
            await actualRouter.load();
            const pendingLoads: Array<Promise<void>> = [];
            // The app Transitioner subscribes history changes to router.load in the installed router.
            const unsubscribeHistory = actualRouter.history.subscribe(() => {
                pendingLoads.push(actualRouter.load());
            });
            const loads: string[] = [];
            const unsubscribeLoad = actualRouter.subscribe('onBeforeLoad', event => {
                loads.push(event.toLocation.pathname);
                const location = {
                    pathname: event.toLocation.pathname,
                    search: event.toLocation.search,
                    searchStr: event.toLocation.searchStr,
                };
                router.listeners
                    .get('onBeforeLoad')
                    ?.forEach(listener => listener({ toLocation: location, hrefChanged: event.hrefChanged }));
            });
            let finish!: () => void;
            prepareProduct = vi.fn(
                () =>
                    new Promise<void>(resolve => {
                        finish = resolve;
                    }),
            );
            act(() => root.render(<Harness />));
            act(() => value.navigate({ name: 'product', id: 'old-product' }));
            await act(async () => {
                actualRouter.history[direction]();
                await Promise.all(pendingLoads);
            });
            expect(loads).toEqual([direction === 'back' ? '/category' : '/cart']);
            await act(async () => {
                finish();
                await Promise.resolve();
            });
            expect(value.isPreparingProduct).toBe(false);
            expect(router.navigate).not.toHaveBeenCalled();
            expect(actualRouter.state.location.pathname).toBe(direction === 'back' ? '/category' : '/cart');
            unsubscribeLoad();
            unsubscribeHistory();
        },
    );

    it('opens a content product target and ignores empty targets', () => {
        act(() => root.render(<Harness />));
        act(() => value.openContentTarget('PRODUCT', ' product-a '));
        expect(router.navigate).toHaveBeenLastCalledWith(
            expect.objectContaining({ to: '/product', search: expect.objectContaining({ id: 'product-a' }) }),
        );
        router.navigate.mockClear();
        act(() => value.openContentTarget('NONE', 'product-a'));
        act(() => value.openContentTarget('PRODUCT', '   '));
        expect(router.navigate).not.toHaveBeenCalled();
    });

    it('opens configured support and legacy page targets through the current router', () => {
        act(() => root.render(<Harness />));
        act(() => value.openContentTarget('SUPPORT', '#/support'));
        expect(router.navigate).toHaveBeenLastCalledWith(expect.objectContaining({ to: '/support' }));
        act(() => value.openContentTarget('PAGE', '/cart'));
        expect(router.navigate).toHaveBeenLastCalledWith(expect.objectContaining({ to: '/cart' }));
    });
});
