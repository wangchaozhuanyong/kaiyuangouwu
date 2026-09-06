export type StorefrontImageKind = 'card' | 'detail' | 'hero' | 'thumbnail';

interface ImagePreset {
    name: string;
    width: number;
}

interface ImagePresetGroup {
    height: number;
    placeholderPreset: string;
    presets: ImagePreset[];
    quality: number;
    sizes: string;
    width: number;
}

export interface ResponsiveImageSources {
    fallbackSrc: string;
    fallbackSrcSet: string;
    height: number;
    placeholderSrc: string;
    sizes: string;
    webpSrcSet: string;
    width: number;
}

export function normalizeStorefrontAssetUrl(source: string): string {
    const normalized = source.trim();
    if (/^(?:preview|source)\//i.test(normalized)) {
        return `/assets/${normalized}`;
    }
    return normalized;
}

const IMAGE_PRESETS: Record<StorefrontImageKind, ImagePresetGroup> = {
    card: {
        width: 960,
        height: 960,
        presets: [
            { name: 'storefront-card-square-320', width: 320 },
            { name: 'storefront-card-square-640', width: 640 },
            { name: 'storefront-card-square-960', width: 960 },
        ],
        placeholderPreset: 'storefront-placeholder-square-48',
        quality: 90,
        sizes: '(min-width: 900px) 300px, calc(50vw - 14px)',
    },
    detail: {
        width: 1600,
        height: 1600,
        presets: [
            { name: 'storefront-detail-640', width: 640 },
            { name: 'storefront-detail-1200', width: 1200 },
            { name: 'storefront-detail-1600', width: 1600 },
        ],
        placeholderPreset: 'storefront-placeholder-square-48',
        quality: 90,
        sizes: '(min-width: 1024px) 600px, 100vw',
    },
    hero: {
        width: 1600,
        height: 800,
        presets: [
            { name: 'storefront-hero-480', width: 480 },
            { name: 'storefront-hero-960', width: 960 },
            { name: 'storefront-hero-1440', width: 1440 },
            { name: 'storefront-hero-1600', width: 1600 },
        ],
        placeholderPreset: 'storefront-placeholder-wide-64',
        quality: 90,
        sizes: '(min-width: 1024px) 850px, calc(100vw - 20px)',
    },
    thumbnail: {
        width: 320,
        height: 320,
        presets: [
            { name: 'storefront-thumbnail-160', width: 160 },
            { name: 'storefront-thumbnail-320', width: 320 },
        ],
        placeholderPreset: 'storefront-placeholder-square-48',
        quality: 90,
        sizes: '160px',
    },
};

function isTransformableAsset(url: URL): boolean {
    return (
        /\/assets\/(?:preview|source)\//.test(url.pathname) && !url.pathname.toLowerCase().endsWith('.svg')
    );
}

function imageUrl(source: string, preset: string, quality: number): string | null {
    let url: URL;
    try {
        url = new URL(source, 'https://storefront.invalid');
    } catch {
        return null;
    }
    if (!isTransformableAsset(url)) return null;

    url.searchParams.set('preset', preset);
    url.searchParams.set('format', 'webp');
    url.searchParams.set('q', String(quality));

    const isAbsolute = /^[a-z][a-z\d+.-]*:/i.test(source) || source.startsWith('//');
    return isAbsolute ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
}

export function responsiveImageSources(
    source: string,
    kind: StorefrontImageKind,
): ResponsiveImageSources | null {
    const normalizedSource = normalizeStorefrontAssetUrl(source);
    const group = IMAGE_PRESETS[kind];
    const buildSrcSet = () =>
        group.presets
            .map(preset => {
                const url = imageUrl(normalizedSource, preset.name, group.quality);
                return url ? `${url} ${preset.width}w` : null;
            })
            .filter((value): value is string => Boolean(value))
            .join(', ');

    const webpSrcSet = buildSrcSet();
    const fallbackSrc = imageUrl(normalizedSource, group.presets.at(-1)?.name ?? '', group.quality);
    const placeholderSrc = imageUrl(normalizedSource, group.placeholderPreset, 75);
    if (!webpSrcSet || !fallbackSrc || !placeholderSrc) return null;

    return {
        fallbackSrc,
        fallbackSrcSet: webpSrcSet,
        height: group.height,
        placeholderSrc,
        sizes: group.sizes,
        webpSrcSet,
        width: group.width,
    };
}

export function storefrontWebpUrl(source: string, kind: StorefrontImageKind): string {
    return responsiveImageSources(source, kind)?.fallbackSrc ?? normalizeStorefrontAssetUrl(source);
}

export function storefrontPlaceholderUrl(source: string, kind: StorefrontImageKind): string | null {
    return responsiveImageSources(source, kind)?.placeholderSrc ?? null;
}
