// Release alignment: perf-unified-architecture-20260911
import { createBrowserHistory, createRouter, useRouterState } from '@tanstack/react-router';

import { PageBackButton } from './components/common/page-back-button';
import { usePageLoadingState } from './page-readiness';
import { publicRouteRewrite } from './public-route-rewrite';
import { PageSkeleton, pageSkeletonVariantForPathname } from './route-loading';
import { routeTree } from './routeTree.gen';
import { registerStorefrontNavigationHistory } from './storefront-navigation-history';
import { getStorefrontScrollRestorationKey, routeFromHash, routeHref } from './storefront-router';

if (typeof window !== 'undefined') {
    const { history, location } = window;
    if (/^#\//.test(location.hash)) {
        history.replaceState(history.state, '', routeHref(routeFromHash(location.hash)));
    }
}

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
    // Keep the current route through short waits. A slow destination replaces only
    // its Outlet body; the shared shell and its actions stay mounted.
    defaultPendingMs: 200,
    defaultPendingMinMs: 0,
    defaultPendingComponent: StorefrontPendingPage,
    scrollRestoration: true,
    scrollToTopSelectors: ['[data-scroll-restoration-id="category-results"]'],
    getScrollRestorationKey: getStorefrontScrollRestorationKey,
});

registerStorefrontNavigationHistory(router);

function StorefrontPendingPage() {
    const location = useRouterState({ select: s => s.matches.at(-1) ?? s.location });
    const readiness = usePageLoadingState();
    return (
        <>
            {readiness && (
                <PageBackButton
                    label={readiness.language === 'zh' ? '返回' : 'Back'}
                    onClick={readiness.onBack}
                />
            )}
            <PageSkeleton variant={pageSkeletonVariantForPathname(location.pathname)} />
        </>
    );
}

declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router;
    }
}
