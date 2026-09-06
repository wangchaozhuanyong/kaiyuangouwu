import {
    responsiveImageSources as assetImageSources,
    normalizeStorefrontAssetUrl,
    type ResponsiveImageSources,
    type StorefrontImageKind,
} from '../../storefront-content-plugin/src/shared/responsive-image';

import { DEFAULT_HERO_IMAGE, staticStorefrontImageSource } from './storefront-images';

export { normalizeStorefrontAssetUrl, type ResponsiveImageSources, type StorefrontImageKind };

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
