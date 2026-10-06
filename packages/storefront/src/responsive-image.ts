import {
    responsiveImageSources as assetImageSources,
    mediaDescriptor,
    normalizeStorefrontAssetUrl as normalizeAssetUrl,
    type ResponsiveImageSources,
    type StorefrontImageKind,
} from '../../storefront-content-plugin/src/shared/responsive-image';

import { DEFAULT_HERO_IMAGE, staticStorefrontImageSource } from './storefront-images';

export { type ResponsiveImageSources, type StorefrontImageKind };

export const normalizeStorefrontAssetUrl = normalizeAssetUrl;

export function responsiveImageSources(
    source: string,
    kind: StorefrontImageKind,
): ResponsiveImageSources | null {
    const normalizedSource = normalizeStorefrontAssetUrl(source);
    const staticSource = staticStorefrontImageSource(normalizedSource);
    if (staticSource) return staticSource;
    if (kind === 'hero' && /\/storefront\/default-hero\.jpg(?:[?#]|$)/.test(normalizedSource)) {
        return staticStorefrontImageSource(DEFAULT_HERO_IMAGE);
    }
    return assetImageSources(normalizedSource, kind);
}

export function storefrontWebpUrl(source: string, kind: StorefrontImageKind): string {
    return responsiveImageSources(source, kind)?.fallbackSrc ?? normalizeStorefrontAssetUrl(source);
}

export function storefrontPlaceholderUrl(source: string, kind: StorefrontImageKind): string | null {
    return responsiveImageSources(source, kind)?.placeholderSrc ?? null;
}

/** Shared descriptor for speculative preload and the image the browser renders. */
export function imageSources(source: string, kind?: StorefrontImageKind, sizes?: string) {
    return mediaDescriptor(source, kind, {
        sizes,
        responsive: kind ? responsiveImageSources(source, kind) : null,
    });
}
