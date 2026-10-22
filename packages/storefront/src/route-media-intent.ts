import type { RouteState } from './storefront-router';
import type { Product, StorefrontContentBlock } from './types';

let previous: { route: RouteState; blocks: StorefrontContentBlock[]; products: Product[] } | undefined;

/** Navigation hints are optional; their selector must not enlarge the initial application bundle. */
export function prepareRouteMedia(route: RouteState, blocks: StorefrontContentBlock[], products: Product[]) {
    if (previous?.route === route && previous.blocks === blocks && previous.products === products) return;
    previous = { route, blocks, products };
    void import('./route-media-preload')
        .then(module => module.preloadRouteMedia(route, blocks, products))
        .catch(() => undefined);
}
