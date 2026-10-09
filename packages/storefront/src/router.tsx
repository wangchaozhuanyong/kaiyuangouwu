// Release alignment: perf-unified-architecture-20260911
import { createBrowserHistory, createRouter, useRouterState } from '@tanstack/react-router';

import { storefrontQueryClient } from './query-client';
import { preloadStorefrontRouteComponent } from './route-component-preload';
import { PageSkeleton, pageSkeletonVariantForPathname } from './route-loading';
import { routeTree } from './routeTree.gen';
import { registerStorefrontNavigationHistory } from './storefront-navigation-history';
import { prefetchPublicPage } from './storefront-page-data';
import {
    getStorefrontScrollRestorationKey,
    routeFromHash,
    routeFromRouterLocation,
    routeHref,
} from './storefront-router';

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
    // Keep the current route visible through ordinary chunk/data waits; show the
    // bounded pending state if the destination still has not resolved.
    defaultPendingMs: 750,
    defaultPendingMinMs: 0,
    defaultPendingComponent: StorefrontPendingPage,
    scrollRestoration: true,
    scrollToTopSelectors: ['[data-scroll-restoration-id="category-results"]'],
    getScrollRestorationKey: getStorefrontScrollRestorationKey,
});

registerStorefrontNavigationHistory(router);

router.subscribe('onBeforeNavigate', event => {
    const route = routeFromRouterLocation(event.toLocation.pathname, event.toLocation.search);
    void preloadStorefrontRouteComponent(route.name);
    void prefetchPublicPage(storefrontQueryClient, routeHref(route)).catch(() => undefined);
});

function StorefrontPendingPage() {
    const location = useRouterState({ select: s => s.location });
    const variant = pageSkeletonVariantForPathname(location.pathname);
    return <PageSkeleton variant={variant} root />;
}

declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router;
    }
}
