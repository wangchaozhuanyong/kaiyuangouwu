import { preload } from 'react-dom';

import { authOriginalImageUrl } from '../../storefront-content-plugin/src/shared/auth-visual';

import { findAuthVisualContent } from './auth-visual';
import { productImage } from './product-media';
import { imageSources } from './responsive-image';
import { RouteState } from './storefront-router';
import { Product, StorefrontContentBlock } from './types';

/** This uses only data already resolved for the current store and language. */
export function preloadRouteMedia(
    route: RouteState,
    blocks: StorefrontContentBlock[],
    products: Product[],
    desktopViewport = typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(min-width: 1024px)').matches,
) {
    let source: string | undefined;
    let sizes: string | undefined;
    if (route.name === 'login' || route.name === 'register' || route.name === 'forgot-password') {
        // Mobile login/register artwork is hidden by the auth layout; do not fetch it speculatively.
        if (!desktopViewport) return;
        const content = findAuthVisualContent(blocks, route.name === 'register' ? 'register' : 'login');
        if (content?.imageUrl) source = authOriginalImageUrl(content.imageUrl);
        sizes = '(min-width: 1024px) 640px, 1px';
    } else if (route.name === 'product') {
        const product = products.find(item => item.id === route.id);
        if (product) source = productImage(product) ?? undefined;
    }
    if (!source) return;
    // Home's priority SafeImage selects its phone/desktop source after the viewport resolves.
    // A route-level hint would fetch the desktop artwork before a phone override is available.
    const descriptor = imageSources(source, 'detail', sizes);
    preload(descriptor.src, {
        as: 'image',
        imageSrcSet: descriptor.srcSet,
        imageSizes: descriptor.sizes,
        fetchPriority: 'high',
    });
}
