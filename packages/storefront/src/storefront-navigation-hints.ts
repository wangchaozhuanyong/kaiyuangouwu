import type { Product, StorefrontContentBlock } from './types';

import { preloadStorefrontRouteComponent } from './route-component-preload';
import { prepareRouteMedia } from './route-media-intent';
import { routeFromRouterLocation } from './storefront-router';

/** Optional intent work is outside the startup path; leaf loaders still own navigation. */
export function installNavigationHints(context: {
    current: { contentBlocks: StorefrontContentBlock[]; products: Product[] };
}) {
    const onIntent = (event: Event) => {
        const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
        if (!(anchor instanceof HTMLAnchorElement) || anchor.origin !== window.location.origin) return;
        if (
            event instanceof MouseEvent &&
            event.relatedTarget instanceof Node &&
            anchor.contains(event.relatedTarget)
        )
            return;
        const route = routeFromRouterLocation(
            anchor.pathname,
            Object.fromEntries(new URLSearchParams(anchor.search)),
        );
        void preloadStorefrontRouteComponent(route.name);
        prepareRouteMedia(route, context.current.contentBlocks, context.current.products);
    };
    const events = ['pointerover', 'focusin', 'pointerdown'];
    events.forEach(type => document.addEventListener(type, onIntent));
    return () => events.forEach(type => document.removeEventListener(type, onIntent));
}
