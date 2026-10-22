import type { RouteName } from './storefront-router';

import { importHomePage, importProductDetailPage } from './catalog-page-imports';

type RoutePreloader = () => Promise<void>;

function preload<T extends string>(
    load: () => Promise<Record<`preload${T}RoutePage`, RoutePreloader>>,
    name: T,
    page?: () => Promise<unknown>,
): RoutePreloader {
    return async () => {
        // Start the selected page alongside its route wrapper. Waiting for the
        // wrapper first adds another network round trip on a cold visit.
        const [routes] = await Promise.all([load(), page?.()]);
        await routes[`preload${name}RoutePage`]();
    };
}

const catalogRoutes = () => import('./route-pages/catalog-route-pages');
const contentRoutes = () => import('./route-pages/content-route-pages');

const routePreloaders = {
    home: preload(catalogRoutes, 'Home', importHomePage),
    category: preload(() => import('./route-pages/category-route-page'), 'Category'),
    product: preload(catalogRoutes, 'Product', importProductDetailPage),
    search: preload(catalogRoutes, 'Search'),
    services: preload(contentRoutes, 'Services'),
    support: preload(contentRoutes, 'Support'),
    legal: preload(() => import('./route-pages/legal-route-page'), 'Legal'),
} satisfies Partial<Record<RouteName, RoutePreloader>>;

export async function preloadStorefrontRouteComponent(name: RouteName): Promise<void> {
    try {
        const prepare = routePreloaders[name as keyof typeof routePreloaders];
        if (prepare) await prepare();
        else await (await import('./route-component-preload-private')).preloadPrivateRoute(name);
    } catch {
        // The destination's actual lazy component owns resource failure and recovery.
    }
}
