import type { AnyRouter, RouterHistory } from '@tanstack/react-router';

import {
    routeFromRouterLocation,
    routeHref,
    routeNavigateOptions,
    routePageIdentity,
    type RouteState,
} from './storefront-router';

type NavigationRouter = Pick<AnyRouter, 'navigate'> & { history: RouterHistory };
type Entry = {
    href: string;
    page: string;
    key?: string;
    sourceIndex?: number;
    categoryNavigation?: { scope: string; collapsed: boolean };
};
type NavigationHistory = { entries: Map<number, Entry>; pending?: object };

const histories = new WeakMap<RouterHistory, NavigationHistory>();

function routeKey(route: RouteState): string {
    // routeHref intentionally represents the page URL; variants also belong to exact return context.
    return JSON.stringify([routeHref(route), route.variantId ?? null]);
}

function routeAt(location: { pathname: string; search: string }): RouteState {
    return routeFromRouterLocation(
        location.pathname,
        Object.fromEntries(new URLSearchParams(location.search)),
    );
}

function entryFor(history: RouterHistory): Entry {
    const { location } = history;
    const route = routeAt(location);
    const state = location.state as typeof location.state & { storefrontBackIndex?: number };
    return {
        href: routeKey(route),
        page: routePageIdentity(route),
        key: state.__TSR_key,
        sourceIndex: state.storefrontBackIndex,
    };
}

function previousPage(
    tracker: NavigationHistory,
    current: Entry,
    index: number,
    targetPage = current.page,
): number | undefined {
    let entry = current;
    for (let previousIndex = index - 1; previousIndex >= 0; previousIndex--) {
        const previous = tracker.entries.get(previousIndex);
        if (!previous) {
            // After reload, only use a source that was recorded by a storefront navigation.
            const source = entry.sourceIndex;
            return source !== undefined &&
                Number.isSafeInteger(source) &&
                source >= 0 &&
                source <= previousIndex &&
                targetPage === entry.page
                ? source
                : undefined;
        }
        if (previous.page !== targetPage) return previousIndex;
        entry = previous;
    }
}

function navigationHistory(router: Pick<NavigationRouter, 'history'>): NavigationHistory {
    const history = router.history;
    const existing = histories.get(history);
    if (existing) return existing;
    const tracker: NavigationHistory = { entries: new Map() };
    histories.set(history, tracker);
    tracker.entries.set(history.location.state.__TSR_index, entryFor(history));
    function withSource(navigate: RouterHistory['push'], replace: boolean): RouterHistory['push'] {
        return (path, state, options) => {
            const current = entryFor(history);
            const index = history.location.state.__TSR_index;
            const page = routePageIdentity(routeAt(new URL(path, 'https://storefront.invalid')));
            const source =
                !replace && page !== current.page ? index : previousPage(tracker, current, index, page);
            // Let the router write the metadata alongside its own key and index. Keep
            // URLs and identifiers in browser history rather than copying them into state.
            navigate(path, { ...state, storefrontBackIndex: source }, options);
        };
    }
    history.push = withSource(history.push, false);
    history.replace = withSource(history.replace, true);
    history.subscribe(({ location, action }) => {
        const index = location.state.__TSR_index;
        if (action.type === 'PUSH') {
            // A new branch invalidates the abandoned forward entries.
            for (const recorded of tracker.entries.keys()) {
                if (recorded >= index) tracker.entries.delete(recorded);
            }
        }
        const previous = tracker.entries.get(index);
        const entry = entryFor(history);
        if (previous?.key === entry.key && previous?.href === entry.href)
            entry.categoryNavigation = previous.categoryNavigation;
        tracker.entries.set(index, entry);
        tracker.pending = undefined;
    });
    return tracker;
}

// Track every router history operation, including Links and native back/forward.
export function registerStorefrontNavigationHistory(router: NavigationRouter): void {
    navigationHistory(router);
}

/** UI-only history metadata never replaces browser state or starts a router navigation. */
export function getStorefrontNavigationEntryPresentation(
    history: RouterHistory,
    ownerKey?: string,
): Pick<Entry, 'categoryNavigation'> | undefined {
    const entries = navigationHistory({ history }).entries;
    return ownerKey === undefined
        ? entries.get(history.location.state.__TSR_index)
        : [...entries.values()].find(entry => entry.key === ownerKey);
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
    const source = backSource(router);
    if (source !== undefined) returnToIndex(router, tracker, source);
    else replaceWithRoute(router, tracker, fallback);
}

function backSource(router: NavigationRouter): number | undefined {
    const { history } = router;
    return previousPage(navigationHistory(router), entryFor(history), history.location.state.__TSR_index);
}

export function hasStorefrontBackSource(router: NavigationRouter): boolean {
    return backSource(router) !== undefined;
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
