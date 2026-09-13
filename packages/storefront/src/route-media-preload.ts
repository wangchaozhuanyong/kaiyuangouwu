import { preload } from 'react-dom';

import { authOriginalImageUrl } from '../../storefront-content-plugin/src/shared/auth-visual';

import { findAuthVisualContent } from './auth-visual';
import { productImage } from './product-media';
import { imageSources } from './responsive-image';
import { RouteState } from './storefront-router';
import { Product, StorefrontContentBlock } from './types';

/** This uses only data already resolved for the current store and language. */
export function preloadRouteMedia(route: RouteState, blocks: StorefrontContentBlock[], products: Product[]) {
    let source: string | undefined;
    let kind: 'detail' | 'hero' = 'detail';
    let sizes: string | undefined;
    if (route.name === 'login' || route.name === 'register' || route.name === 'forgot-password') {
        const content = findAuthVisualContent(blocks, route.name === 'register' ? 'register' : 'login');
        if (content?.imageUrl) source = authOriginalImageUrl(content.imageUrl);
        sizes = '(min-width: 1024px) 640px, 100vw';
    } else if (route.name === 'home') {
        source = blocks.find(block => block.type === 'HERO' && block.imageUrl?.trim())?.imageUrl ?? undefined;
        kind = 'hero';
    } else if (route.name === 'product') {
        const product = products.find(item => item.id === route.id);
        if (product) source = productImage(product) ?? undefined;
    }
    if (!source) return;
    const descriptor = imageSources(source, kind, sizes);
    preload(descriptor.src, {
        as: 'image',
        imageSrcSet: descriptor.srcSet,
        imageSizes: descriptor.sizes,
        fetchPriority: 'high',
    });
}
