import { createBrowserHistory, createRouter } from '@tanstack/react-router';

import { PageSkeleton } from './route-loading';
import { routeTree } from './routeTree.gen';
import { getStorefrontScrollRestorationKey, routeFromHash, routeHref } from './storefront-router';

function parseStorefrontSearch(searchString: string): Record<string, string> {
    return Object.fromEntries(new URLSearchParams(searchString.replace(/^\?/, '')));
}

function stringifyStorefrontSearch(search: Record<string, unknown>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(search)) {
        if (value == null || value === false || value === '') continue;
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            params.set(key, String(value));
        }
    }
    return params.size ? `?${params.toString()}` : '';
}

if (typeof window !== 'undefined' && /^#\//.test(window.location.hash)) {
    const legacyRoute = routeFromHash(window.location.hash);
    window.history.replaceState(window.history.state, '', routeHref(legacyRoute));
}

export const router = createRouter({
    routeTree,
    history: createBrowserHistory(),
    parseSearch: parseStorefrontSearch,
    stringifySearch: stringifyStorefrontSearch,
    defaultPreload: 'intent',
    defaultPendingComponent: PageSkeleton,
    scrollRestoration: true,
    getScrollRestorationKey: getStorefrontScrollRestorationKey,
});

declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router;
    }
}
