import { createBrowserHistory, createRouter } from '@tanstack/react-router';
import { useContext } from 'react';

import { preloadStorefrontRouteComponent } from './route-component-preload';
import { RouteTransitionLoader } from './route-loading';
import { routeTree } from './routeTree.gen';
import {
    getStorefrontScrollRestorationKey,
    routeFromHash,
    routeFromRouterLocation,
    routeHref,
} from './storefront-router';
import { StorefrontContext } from './StorefrontContext';

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
    defaultPendingMs: 220,
    defaultPendingMinMs: 320,
    defaultPendingComponent: StorefrontPendingPage,
    scrollRestoration: true,
    scrollToTopSelectors: ['[data-scroll-restoration-id="category-results"]'],
    getScrollRestorationKey: getStorefrontScrollRestorationKey,
});

router.subscribe('onBeforeNavigate', event => {
    const route = routeFromRouterLocation(event.toLocation.pathname, event.toLocation.search);
    void preloadStorefrontRouteComponent(route.name);
});

function StorefrontPendingPage() {
    const storefront = useContext(StorefrontContext);
    const language = typeof storefront?.language === 'string' ? storefront.language : undefined;
    const storefrontName =
        typeof storefront?.storefrontName === 'string' ? storefront.storefrontName : undefined;
    const logoUrl = typeof storefront?.logoUrl === 'string' ? storefront.logoUrl : null;
    return <RouteTransitionLoader language={language} logoUrl={logoUrl} storefrontName={storefrontName} />;
}

declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router;
    }
}
