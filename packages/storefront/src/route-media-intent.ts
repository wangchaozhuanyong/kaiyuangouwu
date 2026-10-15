import type { RouteState } from './storefront-router';
import type { Product, StorefrontContentBlock } from './types';

/** Navigation hints are optional; their selector must not enlarge the initial application bundle. */
export function prepareRouteMedia(route: RouteState, blocks: StorefrontContentBlock[], products: Product[]) {
    void import('./route-media-preload')
        .then(module => module.preloadRouteMedia(route, blocks, products))
        .catch(() => undefined);
}
