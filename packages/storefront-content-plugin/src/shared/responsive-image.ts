export type StorefrontImageKind = 'card' | 'detail' | 'hero' | 'icon' | 'thumbnail';

/** Match shared component geometry; these are CSS widths, before device pixel ratio. */
export const STOREFRONT_IMAGE_SIZES = {
    productRow: '(min-width: 1024px) 300px, 104px',
    // category-layout sidebar = clamp(64px, 22%, 86px); list has 8px insets on each side.
    categorySidebarRow:
        '(min-width: 1024px) 300px, clamp(64px, calc((100vw - clamp(64px, 22vw, 86px) - 16px) * 0.3), 104px)',
    // Desktop catalog: min(viewport - 64px, 1280px) shell; 220px sidebar + 20px gap;
    // auto-fill min 180px cards with 16px gaps yields 3/4/5 tracks; full shell has 195.2px cards.
    desktopCatalogCard:
        '(min-width: 1344px) 195.2px, (min-width: 1268px) calc((100vw - 368px) / 5), ' +
        '(min-width: 1072px) calc((100vw - 352px) / 4), ' +
        '(min-width: 1024px) calc((100vw - 336px) / 3), 104px',
    compactProductRow: '104px',
    categoryNavigation: '(min-width: 1024px) 44px, 56px',
    galleryThumbnail: '60px',
} as const;

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

/** One canonical asset identity for HTML preloads, both clients and queued derivatives. */
export function normalizeStorefrontAssetUrl(source: string): string {
    const trimmed = source.trim();
    const normalized = /^(?:preview|source)\//i.test(trimmed) ? `/assets/${trimmed}` : trimmed;
    if (!/\/assets\/(?:preview|source)\/[^?#]*__webp_migrated_\d+\.webp(?:[?#]|$)/iu.test(normalized)) {
        return normalized;
    }
    try {
        const url = new URL(normalized, 'https://storefront.invalid');
        // Preserve a newer explicit content version; only repair the historical unversioned URLs.
        if (!url.searchParams.has('v')) url.searchParams.set('v', 'webp-readable-1');
        return /^[a-z][a-z\d+.-]*:/iu.test(normalized) || normalized.startsWith('//')
            ? url.toString()
            : `${url.pathname}${url.search}${url.hash}`;
    } catch {
        return normalized;
    }
}

export interface MediaDescriptor {
    identity: string;
    version: string | null;
    kind?: StorefrontImageKind;
    src: string;
    /** One bounded recovery candidate; never fall back to an untransformed uploaded original. */
    recoverySrc?: string;
    srcSet?: string;
    sizes?: string;
    width?: number;
    height?: number;
    /** Inline only: rendering a placeholder must never compete with its final image. */
    placeholder?: { inlineData: string };
}

export function mediaDescriptor(
    source: string,
    kind?: StorefrontImageKind,
    options: {
        sizes?: string;
        width?: number;
        height?: number;
        inlinePreview?: string;
        responsive?: ResponsiveImageSources | null;
    } = {},
): MediaDescriptor {
    const normalized = normalizeStorefrontAssetUrl(source);
    const responsive =
        options.responsive === undefined && kind
            ? responsiveImageSources(normalized, kind)
            : options.responsive;
    let version: string | null = null;
    try {
        version = new URL(normalized, 'https://storefront.invalid').searchParams.get('v');
    } catch {
        /* external opaque sources */
    }
    const inlineData = options.inlinePreview;
    return {
        identity: normalized,
        version,
        kind,
        src: responsive?.fallbackSrc ?? normalized,
        recoverySrc: kind ? (storefrontRecoveryImageUrl(normalized, kind) ?? undefined) : undefined,
        srcSet: responsive?.fallbackSrcSet,
        sizes: options.sizes ?? responsive?.sizes,
        width: options.width ?? responsive?.width,
        height: options.height ?? responsive?.height,
        ...(inlineData &&
        /^data:image\/(?:webp|png|jpeg);base64,[a-z0-9+/=]+$/iu.test(inlineData) &&
        inlineData.length <= 8192
            ? { placeholder: { inlineData } }
            : {}),
    };
}

const IMAGE_PRESETS: Record<StorefrontImageKind, ImagePresetGroup> = {
    card: {
        width: 960,
        height: 960,
        presets: [
            { name: 'storefront-card-square-160', width: 160 },
            { name: 'storefront-card-square-240', width: 240 },
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
            { name: 'storefront-hero-fit-480', width: 480 },
            { name: 'storefront-hero-fit-960', width: 960 },
            { name: 'storefront-hero-fit-1440', width: 1440 },
            { name: 'storefront-hero-fit-1600', width: 1600 },
        ],
        placeholderPreset: 'storefront-placeholder-wide-64',
        quality: 90,
        sizes: '(min-width: 1024px) 850px, calc(100vw - 20px)',
    },
    icon: {
        width: 96,
        height: 96,
        presets: [
            { name: 'storefront-icon-64', width: 64 },
            { name: 'storefront-icon-96', width: 96 },
        ],
        placeholderPreset: 'storefront-placeholder-square-48',
        quality: 82,
        sizes: '48px',
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
    return /\/assets\/(?:preview|source)\//.test(url.pathname);
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

export function storefrontRecoveryImageUrl(source: string, kind: StorefrontImageKind): string | null {
    const group = IMAGE_PRESETS[kind];
    const widths: Record<StorefrontImageKind, number> = {
        card: 640,
        detail: 1200,
        hero: 960,
        icon: 96,
        thumbnail: 160,
    };
    const preset = group.presets.find(candidate => candidate.width === widths[kind]);
    return preset ? imageUrl(normalizeStorefrontAssetUrl(source), preset.name, group.quality) : null;
}

export function storefrontPlaceholderUrl(source: string, kind: StorefrontImageKind): string | null {
    return responsiveImageSources(source, kind)?.placeholderSrc ?? null;
}
