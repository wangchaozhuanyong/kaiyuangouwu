import { preload } from 'react-dom';

import {
    primaryStorefrontMedia,
    type PrimaryStorefrontMediaRoute,
} from '../../storefront-content-plugin/src/shared/primary-media';

import { imageSources } from './responsive-image';
import { RouteState } from './storefront-router';
import { Product, StorefrontContentBlock } from './types';

/** Share public HTML's published first-viewport candidates; never fetch route data here. */
export function preloadRouteMedia(
    route: RouteState,
    blocks: StorefrontContentBlock[],
    products: Product[],
    desktopViewport = typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(min-width: 1024px)').matches,
) {
    // This product array does not prove a catalog's active filter/order. Its HTML
    // owns the exact first result; do not speculate from unrelated products here.
    if (
        !['home', 'services', 'support', 'login', 'register', 'forgot-password', 'product'].includes(
            route.name,
        )
    )
        return;
    const candidates = primaryStorefrontMedia({
        route: route.name as PrimaryStorefrontMediaRoute,
        blocks,
        product: route.name === 'product' ? products.find(item => item.id === route.id) : undefined,
    });
    if (route.name === 'home') {
        for (const item of blocks
            .find(block => block.enabled !== false && block.type === 'QUICK_LINKS')
            ?.items?.slice(0, 5) ?? []) {
            if (item.enabled === false || !item.imageUrl?.trim()) continue;
            candidates.push({
                source: item.imageUrl,
                kind: desktopViewport ? 'card' : 'icon',
                sizes: desktopViewport ? '(min-width: 1400px) 210px, 20vw' : '48px',
            });
        }
    }
    for (const candidate of candidates) {
        if (candidate.media) {
            const matches =
                typeof window !== 'undefined' && typeof window.matchMedia === 'function'
                    ? window.matchMedia(candidate.media).matches
                    : candidate.media.startsWith('(min-width:') === desktopViewport;
            if (!matches) continue;
        }
        const descriptor = imageSources(candidate.source, candidate.kind, candidate.sizes);
        preload(descriptor.src, {
            as: 'image',
            imageSrcSet: descriptor.srcSet,
            imageSizes: descriptor.sizes,
            fetchPriority: candidate.kind === 'icon' || candidate.kind === 'card' ? 'auto' : 'high',
        });
    }
}
