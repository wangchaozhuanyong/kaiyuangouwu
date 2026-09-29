import {
    responsiveImageSources as assetImageSources,
    normalizeStorefrontAssetUrl as normalizeAssetUrl,
    type ResponsiveImageSources,
    type StorefrontImageKind,
} from '../../storefront-content-plugin/src/shared/responsive-image';

import { DEFAULT_HERO_IMAGE, staticStorefrontImageSource } from './storefront-images';

export { type ResponsiveImageSources, type StorefrontImageKind };

/** Refresh browser-cached 404s from the recovered WebP migration without changing other media URLs. */
export function normalizeStorefrontAssetUrl(source: string): string {
    const normalized = normalizeAssetUrl(source);
    if (!/\/assets\/(?:preview|source)\/[^?#]*__webp_migrated_\d+\.webp(?:[?#]|$)/iu.test(normalized)) {
        return normalized;
    }
    try {
        const url = new URL(normalized, 'https://storefront.invalid');
        url.searchParams.set('v', 'webp-readable-1');
        return /^[a-z][a-z\d+.-]*:/iu.test(normalized) || normalized.startsWith('//')
            ? url.toString()
            : `${url.pathname}${url.search}${url.hash}`;
    } catch {
        return normalized;
    }
}

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
    const responsive = kind ? responsiveImageSources(source, kind) : null;
    return {
        src: responsive?.fallbackSrc ?? normalizeStorefrontAssetUrl(source),
        srcSet: responsive?.fallbackSrcSet,
        sizes: sizes ?? responsive?.sizes,
        width: responsive?.width,
        height: responsive?.height,
        placeholderSrc: responsive?.placeholderSrc,
    };
}
