import {
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    type RouterHistory,
} from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    goBackInStorefront,
    registerStorefrontNavigationHistory,
    returnToStorefrontRoute,
} from './storefront-navigation-history';
import {
    normalizeRouteSearch,
    routeHref,
    routePath,
    storefrontRouteNames,
    type RouteState,
} from './storefront-router';

const cleanup: Array<() => void> = [];

function harness(initialEntries = ['/'], initialIndex = initialEntries.length - 1) {
    const rootRoute = createRootRoute();
    const history = createMemoryHistory({ initialEntries: [...initialEntries], initialIndex });
    const routeTree = rootRoute.addChildren(
        storefrontRouteNames.map(name =>
            createRoute({
                getParentRoute: () => rootRoute,
                path: routePath(name),
                validateSearch: normalizeRouteSearch,
            }),
        ),
    );
    const router = createRouter({ routeTree, history });
    const navigate = vi.spyOn(router, 'navigate');
    const actualGo: RouterHistory['go'] = history.go.bind(history);
    const go = vi.spyOn(history, 'go');
    registerStorefrontNavigationHistory(router);
    cleanup.push(() => history.destroy());
    return {
        router,
        history,
        navigate,
        go,
        actualGo,
        push: (route: RouteState) => history.push(routeHref(route)),
        get pathname() {
            return history.location.pathname;
        },
        get search() {
            return Object.fromEntries(new URLSearchParams(history.location.search));
        },
        get index() {
            return history.location.state.__TSR_index;
        },
    };
}

afterEach(() => {
    cleanup.splice(0).forEach(dispose => dispose());
    vi.restoreAllMocks();
});

describe('shared storefront return history', () => {
    it.each(['home', 'account'] as const)(
        'returns detail → existing list → %s without pushing a return loop',
        source => {
            const flow = harness([routeHref({ name: source })]);
            flow.push({ name: 'announcements', page: 2 });
            flow.push({ name: 'announcements', id: 'notice-a', page: 2 });

            returnToStorefrontRoute(flow.router, { name: 'announcements', page: 2 });
            expect(flow.pathname).toBe('/announcements');
            expect(flow.search).toEqual({ page: '2' });
            expect(flow.index).toBe(1);
            expect(flow.history.length).toBe(3);
            expect(flow.navigate).not.toHaveBeenCalled();

            goBackInStorefront(flow.router);
            expect(flow.pathname).toBe(routePath(source));
            expect(flow.index).toBe(0);
            expect(flow.navigate).not.toHaveBeenCalled();
        },
    );

    it.each(['/announcements', '/announcements?id=shared-notice', '/orders?page=3'])(
        'replaces a direct entry %s with the safe home fallback',
        initial => {
            const flow = harness([initial]);
            goBackInStorefront(flow.router);
            expect(flow.pathname).toBe('/');
            expect(flow.index).toBe(0);
            expect(flow.history.length).toBe(1);
            expect(flow.go).not.toHaveBeenCalled();
            expect(flow.navigate).toHaveBeenCalledWith(expect.objectContaining({ replace: true }));
        },
    );

    it('does not read an unrecorded pre-refresh entry even when native history can go back', () => {
        const flow = harness(['/account', '/announcements?id=notice-a'], 1);
        expect(flow.history.canGoBack()).toBe(true);
        goBackInStorefront(flow.router);
        expect(flow.pathname).toBe('/');
        expect(flow.index).toBe(1);
        expect(flow.go).not.toHaveBeenCalled();
        expect(flow.history.length).toBe(2);
    });

    it('honors a configured safe fallback without adding another history entry', () => {
        const flow = harness(['/orders']);
        goBackInStorefront(flow.router, { name: 'account' });
        expect(flow.pathname).toBe('/account');
        expect(flow.index).toBe(0);
        expect(flow.history.length).toBe(1);
        expect(flow.go).not.toHaveBeenCalled();
    });

    it('replaces a direct detail with its list and then exits through the safe fallback', () => {
        const flow = harness(['/announcements?id=shared-notice&page=4']);
        returnToStorefrontRoute(flow.router, { name: 'announcements', page: 4 });
        expect(flow.search).toEqual({ page: '4' });
        expect(flow.history.length).toBe(1);
        goBackInStorefront(flow.router);
        expect(flow.pathname).toBe('/');
        expect(flow.history.length).toBe(1);
    });

    it('skips list pagination, repeated URLs and auth overlay entries when leaving the list', () => {
        const flow = harness(['/account']);
        flow.push({ name: 'announcements' });
        flow.push({ name: 'announcements', page: 2 });
        flow.push({ name: 'announcements', page: 2 });
        flow.history.push('/announcements?page=2&auth=login');
        flow.push({ name: 'announcements', page: 2 });
        goBackInStorefront(flow.router);
        expect(flow.pathname).toBe('/account');
        expect(flow.index).toBe(0);
        expect(flow.go).toHaveBeenCalledWith(-5);
    });

    it('preserves the complete explicit list context across multiple details', () => {
        const flow = harness(['/']);
        flow.push({ name: 'announcements', page: 3 });
        flow.push({ name: 'announcements', id: 'notice-a', page: 3 });
        flow.push({ name: 'announcements', id: 'notice-b', page: 3 });
        returnToStorefrontRoute(flow.router, { name: 'announcements', page: 3 });
        expect(flow.search).toEqual({ page: '3' });
        expect(flow.go).toHaveBeenCalledWith(-2);
        goBackInStorefront(flow.router);
        expect(flow.pathname).toBe('/');
    });

    it('does not substitute a different list context for the explicitly requested target', () => {
        const flow = harness(['/account']);
        flow.push({ name: 'announcements', page: 2 });
        flow.push({ name: 'announcements', id: 'notice-a', page: 2 });
        returnToStorefrontRoute(flow.router, { name: 'announcements', page: 5 });
        expect(flow.search).toEqual({ page: '5' });
        expect(flow.index).toBe(2);
        expect(flow.history.length).toBe(3);
        expect(flow.go).not.toHaveBeenCalled();
        expect(flow.navigate).toHaveBeenCalledWith(expect.objectContaining({ replace: true }));
        goBackInStorefront(flow.router);
        expect(flow.pathname).toBe('/account');
    });

    it('returns to the latest existing matching list rather than an older copy', () => {
        const flow = harness(['/']);
        flow.push({ name: 'announcements', page: 2 });
        flow.push({ name: 'services' });
        flow.push({ name: 'announcements', page: 2 });
        flow.push({ name: 'announcements', id: 'notice-a', page: 2 });
        returnToStorefrontRoute(flow.router, { name: 'announcements', page: 2 });
        expect(flow.index).toBe(3);
        goBackInStorefront(flow.router);
        expect(flow.pathname).toBe('/services');
    });

    it('synchronizes native back/forward before app return navigation', () => {
        const flow = harness(['/']);
        flow.push({ name: 'announcements', page: 2 });
        flow.push({ name: 'announcements', id: 'notice-a', page: 2 });
        flow.history.back();
        flow.history.forward();
        returnToStorefrontRoute(flow.router, { name: 'announcements', page: 2 });
        expect(flow.index).toBe(1);
        goBackInStorefront(flow.router);
        expect(flow.pathname).toBe('/');
        flow.history.forward();
        expect(flow.search).toEqual({ page: '2' });
        goBackInStorefront(flow.router);
        expect(flow.pathname).toBe('/');
    });

    it('truncates abandoned forward entries when a new navigation branch starts', () => {
        const flow = harness(['/']);
        flow.push({ name: 'announcements' });
        flow.push({ name: 'announcements', id: 'abandoned' });
        flow.history.back();
        flow.push({ name: 'services' });
        flow.push({ name: 'legal', id: 'privacy' });
        goBackInStorefront(flow.router);
        expect(flow.pathname).toBe('/services');
        goBackInStorefront(flow.router);
        expect(flow.pathname).toBe('/announcements');
        goBackInStorefront(flow.router);
        expect(flow.pathname).toBe('/');
        flow.history.forward();
        flow.history.forward();
        expect(flow.pathname).toBe('/services');
        expect(flow.search).not.toHaveProperty('id', 'abandoned');
    });

    it('compares target routes independently of URL query parameter order', () => {
        const flow = harness(['/']);
        flow.history.push('/category?minPrice=10&collectionId=furniture&inStockOnly=true');
        flow.push({ name: 'product', id: 'chair' });
        returnToStorefrontRoute(flow.router, {
            name: 'category',
            collectionId: 'furniture',
            minPrice: '10',
            inStockOnly: true,
        });
        expect(flow.pathname).toBe('/category');
        expect(flow.index).toBe(1);
        expect(flow.navigate).not.toHaveBeenCalled();
    });

    it('skips in-page category filters and product variant changes on generic back', () => {
        const flow = harness(['/']);
        flow.push({ name: 'category', collectionId: 'first' });
        flow.push({ name: 'category', collectionId: 'second' });
        flow.history.push('/product?id=chair&variantId=oak');
        flow.history.push('/product?id=chair&variantId=walnut');
        goBackInStorefront(flow.router);
        expect(flow.pathname).toBe('/category');
        expect(flow.search).toEqual({ collectionId: 'second' });
        goBackInStorefront(flow.router);
        expect(flow.pathname).toBe('/');
    });

    it('keeps the requested product variant in an explicit return context', () => {
        const flow = harness(['/']);
        flow.history.push('/product?id=chair&variantId=oak');
        flow.history.push('/product?id=chair&variantId=walnut');
        flow.push({ name: 'support' });
        returnToStorefrontRoute(flow.router, { name: 'product', id: 'chair', variantId: 'oak' });
        expect(flow.search).toEqual({ id: 'chair', variantId: 'oak' });
        expect(flow.index).toBe(1);
        expect(flow.navigate).not.toHaveBeenCalled();
    });

    it('does not add history for an explicit return to the current route', () => {
        const flow = harness(['/']);
        flow.push({ name: 'announcements', page: 2 });
        returnToStorefrontRoute(flow.router, { name: 'announcements', page: 2 });
        expect(flow.index).toBe(1);
        expect(flow.history.length).toBe(2);
        expect(flow.go).not.toHaveBeenCalled();
        expect(flow.navigate).not.toHaveBeenCalled();
    });

    it('ignores repeated clicks until an asynchronous history traversal reaches its destination', () => {
        const flow = harness(['/account']);
        flow.push({ name: 'announcements' });
        flow.push({ name: 'announcements', id: 'notice-a' });
        let complete: (() => void) | undefined;
        flow.go.mockImplementation(delta => {
            complete = () => flow.actualGo(delta);
        });

        returnToStorefrontRoute(flow.router, { name: 'announcements' });
        returnToStorefrontRoute(flow.router, { name: 'announcements' });
        goBackInStorefront(flow.router);
        expect(flow.go).toHaveBeenCalledOnce();
        expect(flow.index).toBe(2);
        if (!complete) throw new Error('Expected a deferred native history traversal');
        flow.go.mockRestore();
        complete();
        expect(flow.index).toBe(1);
        goBackInStorefront(flow.router);
        expect(flow.pathname).toBe('/account');
    });

    it('registers each history only once and keeps independent storefront histories isolated', () => {
        const first = harness(['/account']);
        const second = harness(['/services']);
        const subscriberCount = first.history.subscribers.size;
        registerStorefrontNavigationHistory(first.router);
        expect(first.history.subscribers.size).toBe(subscriberCount);
        first.push({ name: 'announcements' });
        second.push({ name: 'announcements' });
        goBackInStorefront(first.router);
        goBackInStorefront(second.router);
        expect(first.pathname).toBe('/account');
        expect(second.pathname).toBe('/services');
    });
});
