// Release alignment: perf-unified-architecture-20260911
import { createBrowserHistory, createRouter, useRouter, useRouterState } from '@tanstack/react-router';
import { useContext } from 'react';

import { MobilePageHeader } from './components/common/mobile-page-header';
import { publicRouteRewrite } from './public-route-rewrite';
import { PageSkeleton, pageSkeletonVariantForPathname } from './route-loading';
import { routeTree } from './routeTree.gen';
import { registerStorefrontNavigationHistory } from './storefront-navigation-history';
import {
    createStorefrontScrollRestorationKey,
    routeFromHash,
    routeFromRouterLocation,
    routeHref,
} from './storefront-router';
import { AsyncRouteStatePage } from './storefront-ui/page-shell';
import { StorefrontContext } from './StorefrontContext';

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
    // Commit the destination's pending body immediately. App and the shared shell
    // stay mounted; only the leaf Outlet changes while its code is prepared.
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
    defaultPendingComponent: StorefrontPendingPage,
    scrollRestoration: true,
    scrollToTopSelectors: ['[data-scroll-restoration-id="category-results"]'],
    getScrollRestorationKey: location => scroll.getKey(location),
});

registerStorefrontNavigationHistory(router);
router.subscribe('onLoad', event => scroll.commit(event.toLocation));

function StorefrontPendingPage() {
    const activeRouter = useRouter();
    const location = useRouterState({ select: state => state.location });
    const context = useContext(StorefrontContext);
    const variant = pageSkeletonVariantForPathname(location.pathname);
    if (!context) return <PageSkeleton variant={variant} />;
    const route = routeFromRouterLocation(location.pathname, location.search);
    // Leaf code cannot own the only available mobile back/brand controls.
    if (route.name !== 'home')
        return (
            <AsyncRouteStatePage
                routeName={route.name}
                state="loading"
                error=""
                language={context.language}
                onBack={context.goBack}
                onRetry={() => void activeRouter.load()}
            />
        );
    return (
        <div className="page">
            <div className="storefront-pending-mobile-header">
                <MobilePageHeader
                    title={context.storefrontName}
                    storefrontName={context.storefrontName}
                    logoUrl={context.logoUrl}
                    language={context.language}
                    displayCurrencyCode={context.displayCurrencyCode}
                    availableCurrencyCodes={context.availableCurrencyCodes}
                    currencyLoading={context.cartLoading}
                    onToggleLanguage={context.toggleLanguage}
                    onCurrencyChange={code => void context.switchCurrency(code)}
                    onNotifications={() => context.navigate({ name: 'notifications' })}
                />
            </div>
            <PageSkeleton variant="home" language={context.language} />
        </div>
    );
}

declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router;
    }
}
