import type { AnyRouter, RouterHistory } from '@tanstack/react-router';

import {
    routeFromRouterLocation,
    routeHref,
    routeNavigateOptions,
    routePageIdentity,
    type RouteState,
} from './storefront-router';

type NavigationRouter = Pick<AnyRouter, 'navigate'> & { history: RouterHistory };
type Entry = { href: string; page: string };
type NavigationHistory = { entries: Map<number, Entry>; pending?: object };

const histories = new WeakMap<RouterHistory, NavigationHistory>();

function routeKey(route: RouteState): string {
    // routeHref intentionally represents the page URL; variants also belong to exact return context.
    return JSON.stringify([routeHref(route), route.variantId ?? null]);
}

function entryFor(history: RouterHistory): Entry {
    const location = history.location;
    const route = routeFromRouterLocation(
        location.pathname,
        Object.fromEntries(new URLSearchParams(location.search)),
    );
    return { href: routeKey(route), page: routePageIdentity(route) };
}

function navigationHistory(router: NavigationRouter): NavigationHistory {
    const history = router.history;
    const existing = histories.get(history);
    if (existing) return existing;
    const tracker: NavigationHistory = { entries: new Map() };
    histories.set(history, tracker);
    tracker.entries.set(history.location.state.__TSR_index, entryFor(history));
    history.subscribe(({ location, action }) => {
        const index = location.state.__TSR_index;
        if (action.type === 'PUSH') {
            // A new branch invalidates the abandoned forward entries.
            for (const recorded of tracker.entries.keys()) {
                if (recorded >= index) tracker.entries.delete(recorded);
            }
        }
        tracker.entries.set(index, entryFor(history));
        tracker.pending = undefined;
    });
    return tracker;
}

// Track every router history operation, including Links and native back/forward.
// Only entries observed in this document can be used as a trusted return path.
export function registerStorefrontNavigationHistory(router: NavigationRouter): void {
    navigationHistory(router);
}

function returnToIndex(router: NavigationRouter, tracker: NavigationHistory, index: number): void {
    tracker.pending = {};
    try {
        router.history.go(index - router.history.location.state.__TSR_index);
    } catch (error) {
        tracker.pending = undefined;
        throw error;
    }
}

function replaceWithRoute(router: NavigationRouter, tracker: NavigationHistory, target: RouteState): void {
    if (entryFor(router.history).href === routeKey(target)) return;
    const pending = {};
    tracker.pending = pending;
    const finish = () => {
        if (tracker.pending === pending) tracker.pending = undefined;
    };
    try {
        void Promise.resolve(
            router.navigate({ ...routeNavigateOptions(target), replace: true } as never),
        ).then(finish, finish);
    } catch (error) {
        finish();
        throw error;
    }
}

export function goBackInStorefront(router: NavigationRouter, fallback: RouteState = { name: 'home' }): void {
    const tracker = navigationHistory(router);
    if (tracker.pending) return;
    const current = entryFor(router.history);
    for (let index = router.history.location.state.__TSR_index - 1; ; index--) {
        const previous = tracker.entries.get(index);
        if (!previous) break;
        // Filters, pagination, variants and overlay switches belong to the same page.
        if (previous.page !== current.page) {
            returnToIndex(router, tracker, index);
            return;
        }
    }
    replaceWithRoute(router, tracker, fallback);
}

export function returnToStorefrontRoute(router: NavigationRouter, target: RouteState): void {
    const tracker = navigationHistory(router);
    if (tracker.pending) return;
    const href = routeKey(target);
    if (entryFor(router.history).href === href) return;
    for (let index = router.history.location.state.__TSR_index - 1; ; index--) {
        const previous = tracker.entries.get(index);
        if (!previous) break;
        if (previous.href === href) {
            returnToIndex(router, tracker, index);
            return;
        }
    }
    // Direct links and refreshed documents have no reliable prior entry.
    // A return replaces the current entry; it must never push another copy.
    replaceWithRoute(router, tracker, target);
}
