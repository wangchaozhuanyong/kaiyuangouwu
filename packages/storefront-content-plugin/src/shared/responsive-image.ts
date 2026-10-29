export type StorefrontImageKind = 'card' | 'detail' | 'hero' | 'icon' | 'thumbnail';

export { STOREFRONT_IMAGE_SIZES, catalogCardImageSizes } from './storefront-image-layouts';

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

export const INLINE_IMAGE_PREVIEW_LIMIT = 1024;
export const PAGE_IMAGE_PREVIEW_LIMIT = 8192;

/** The complete ASCII data URL counts toward the wire budget, not only its decoded bytes. */
export function validInlineImagePreview(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        value.length <= INLINE_IMAGE_PREVIEW_LIMIT &&
        /^data:image\/(?:webp|png|jpeg);base64,[a-z0-9+/]+={0,2}$/iu.test(value)
    );
}

/** Deterministic per-page hints: no request, persistent cache or render-time budget mutation. */
export function boundedMediaPreviews(media: readonly MediaDescriptor[]): MediaDescriptor[] {
    let bytes = 0;
    return media.flatMap(descriptor => {
        if (!descriptor || typeof descriptor.identity !== 'string' || typeof descriptor.src !== 'string') {
            return [];
        }
        const { placeholder, ...source } = descriptor;
        const preview = placeholder?.inlineData;
        if (!validInlineImagePreview(preview) || bytes + preview.length > PAGE_IMAGE_PREVIEW_LIMIT) {
            return [source];
        }
        bytes += preview.length;
        return [{ ...source, placeholder: { inlineData: preview } }];
    });
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
        ...(validInlineImagePreview(inlineData) ? { placeholder: { inlineData } } : {}),
    };
}

function imagePresets(prefix: string, widths: readonly number[]): ImagePreset[] {
    return widths.map(width => ({ name: `${prefix}-${width}`, width }));
}

const IMAGE_PRESETS: Record<StorefrontImageKind, ImagePresetGroup> = {
    card: {
        width: 960,
        height: 960,
        presets: imagePresets('storefront-card-square', [160, 240, 320, 480, 640, 960]),
        placeholderPreset: 'storefront-placeholder-square-48',
        quality: 90,
        sizes: '(min-width: 900px) 300px, calc(50vw - 14px)',
    },
    detail: {
        width: 1600,
        height: 1600,
        presets: imagePresets('storefront-detail', [640, 1200, 1600]),
        placeholderPreset: 'storefront-placeholder-square-48',
        quality: 90,
        sizes: '(min-width: 1024px) 600px, 100vw',
    },
    hero: {
        width: 1600,
        height: 800,
        presets: imagePresets('storefront-hero-fit', [480, 960, 1440, 1600]),
        placeholderPreset: 'storefront-placeholder-wide-64',
        quality: 90,
        sizes: '(min-width: 1024px) 850px, calc(100vw - 20px)',
    },
    icon: {
        width: 96,
        height: 96,
        presets: imagePresets('storefront-icon', [64, 96]),
        placeholderPreset: 'storefront-placeholder-square-48',
        quality: 82,
        sizes: '48px',
    },
    thumbnail: {
        width: 320,
        height: 320,
        presets: imagePresets('storefront-thumbnail', [160, 320]),
        placeholderPreset: 'storefront-placeholder-square-48',
        quality: 90,
        sizes: '160px',
    },
};

/** Server registration and browser/worker candidates share the same finite presets. */
export function storefrontResponsiveImagePresets() {
    return Object.entries(IMAGE_PRESETS).flatMap(([kind, group]) =>
        group.presets.map(preset => ({
            name: preset.name,
            width: preset.width,
            height: preset.width,
            mode: kind === 'icon' || kind === 'thumbnail' ? ('crop' as const) : ('resize' as const),
        })),
    );
}

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
