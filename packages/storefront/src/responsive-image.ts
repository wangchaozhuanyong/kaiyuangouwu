export type StorefrontImageKind = 'card' | 'detail' | 'hero' | 'thumbnail';

interface ImagePreset {
    name: string;
    width: number;
}

interface ImagePresetGroup {
    height: number;
    presets: ImagePreset[];
    sizes: string;
    width: number;
}

export interface ResponsiveImageSources {
    fallbackSrc: string;
    fallbackSrcSet: string;
    height: number;
    sizes: string;
    webpSrcSet: string;
    width: number;
}

const IMAGE_PRESETS: Record<StorefrontImageKind, ImagePresetGroup> = {
    card: {
        width: 640,
        height: 560,
        presets: [
            { name: 'storefront-card-320', width: 320 },
            { name: 'storefront-card-640', width: 640 },
        ],
        sizes: '(min-width: 900px) 300px, calc(50vw - 14px)',
    },
    detail: {
        width: 1200,
        height: 1200,
        presets: [
            { name: 'storefront-detail-640', width: 640 },
            { name: 'storefront-detail-1200', width: 1200 },
        ],
        sizes: '(min-width: 1024px) 600px, 100vw',
    },
    hero: {
        width: 1440,
        height: 720,
        presets: [
            { name: 'storefront-hero-480', width: 480 },
            { name: 'storefront-hero-960', width: 960 },
            { name: 'storefront-hero-1440', width: 1440 },
        ],
        sizes: '(min-width: 1024px) 850px, calc(100vw - 20px)',
    },
    thumbnail: {
        width: 320,
        height: 320,
        presets: [
            { name: 'storefront-thumbnail-160', width: 160 },
            { name: 'storefront-thumbnail-320', width: 320 },
        ],
        sizes: '160px',
    },
};

function isTransformableAsset(url: URL): boolean {
    return url.pathname.includes('/assets/') && !url.pathname.toLowerCase().endsWith('.svg');
}

function imageUrl(source: string, preset: string, quality: 75): string | null {
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
    if (kind === 'hero' && /\/storefront\/default-hero\.jpg(?:[?#]|$)/.test(source)) {
        const webp = source.replace(/\.jpg(?=([?#]|$))/, '.webp');
        return {
            webpSrcSet: `${webp} 800w`,
            fallbackSrc: webp,
            fallbackSrcSet: `${webp} 800w`,
            height: 496,
            sizes: IMAGE_PRESETS.hero.sizes,
            width: 800,
        };
    }
    const group = IMAGE_PRESETS[kind];
    const buildSrcSet = () =>
        group.presets
            .map(preset => {
                const url = imageUrl(source, preset.name, 75);
                return url ? `${url} ${preset.width}w` : null;
            })
            .filter((value): value is string => Boolean(value))
            .join(', ');

    const webpSrcSet = buildSrcSet();
    const fallbackSrc = imageUrl(source, group.presets.at(-1)?.name ?? '', 75);
    if (!webpSrcSet || !fallbackSrc) return null;

    return {
        fallbackSrc,
        fallbackSrcSet: webpSrcSet,
        height: group.height,
        sizes: group.sizes,
        webpSrcSet,
        width: group.width,
    };
}

export function storefrontWebpUrl(source: string, kind: StorefrontImageKind): string {
    return responsiveImageSources(source, kind)?.fallbackSrc ?? source;
}
