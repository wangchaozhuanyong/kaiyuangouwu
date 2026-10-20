// Release alignment: perf-unified-architecture-20260911
import { createBrowserHistory, createRouter, useRouterState } from '@tanstack/react-router';

import { publicRouteRewrite } from './public-route-rewrite';
import { PageSkeleton, pageSkeletonVariantForPathname } from './route-loading';
import { routeTree } from './routeTree.gen';
import { registerStorefrontNavigationHistory } from './storefront-navigation-history';
import { createStorefrontScrollRestorationKey, routeFromHash, routeHref } from './storefront-router';

if (typeof window !== 'undefined') {
    const { history, location } = window;
    if (/^#\//.test(location.hash)) {
        history.replaceState(history.state, '', routeHref(routeFromHash(location.hash)));
    }
}

const scroll = createStorefrontScrollRestorationKey(() => router.state);
export const router = createRouter({
    routeTree,
    history: createBrowserHistory(),
    rewrite: publicRouteRewrite,
    parseSearch: search => Object.fromEntries(new URLSearchParams(search.replace(/^\?/, ''))),
    stringifySearch: search => {
        // URLSearchParams coerces the allowed primitives; omit false/empty and non-scalar values.
        const params = new URLSearchParams(
            Object.entries(search).filter(
                ([, value]) =>
                    value !== '' &&
                    (typeof value === 'string' || typeof value === 'number' || value === true),
            ) as Array<[string, string]>,
        ).toString();
        return params && '?' + params;
    },
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    // Keep the published page and its callbacks until the destination is ready.
    // PageReadinessBoundary owns the delayed, non-blocking navigation feedback;
    // a pending Outlet must not hide content the customer is still viewing.
    defaultPendingMs: Infinity,
    defaultPendingMinMs: 0,
    defaultPendingComponent: StorefrontPendingPage,
    scrollRestoration: true,
    scrollToTopSelectors: ['[data-scroll-restoration-id="category-results"]'],
    getScrollRestorationKey: location => scroll.getKey(location),
});

registerStorefrontNavigationHistory(router);
router.subscribe('onLoad', event => scroll.commit(event.toLocation));

function StorefrontPendingPage() {
    const pathname = useRouterState({ select: s => s.location.pathname });
    // Normal navigation retains the source page and its own controls. This fallback
    // is only for an entry without ready content or an unresolved render boundary.
    return <PageSkeleton variant={pageSkeletonVariantForPathname(pathname)} />;
}

declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router;
    }
}
