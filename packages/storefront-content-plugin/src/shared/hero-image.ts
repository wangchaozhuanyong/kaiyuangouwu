import { heroImageSourceForViewport, type HeroImageSourceContent } from './hero-image-source';

export interface HeroImageContent extends HeroImageSourceContent {
    imageAsset?: { width?: number; height?: number } | null;
}

export interface HeroViewportImage {
    imageUrl: string;
    imageAsset?: { width?: number; height?: number };
}

function imageDimension(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Callers select their layout explicitly, including Admin's independent draft previews. */
export function heroImageForViewport(
    content: HeroImageContent | undefined,
    desktop: boolean,
): HeroViewportImage {
    const settings = content?.settings;
    const mobileImageUrl = settings?.mobileImageUrl;
    const imageUrl = heroImageSourceForViewport(content, desktop);
    if (!desktop && typeof mobileImageUrl === 'string' && mobileImageUrl.trim()) {
        const width = imageDimension(settings?.mobileImageWidth);
        const height = imageDimension(settings?.mobileImageHeight);
        return {
            imageUrl,
            ...(width || height ? { imageAsset: { width, height } } : {}),
        };
    }
    return {
        imageUrl,
        ...(content?.imageAsset ? { imageAsset: content.imageAsset } : {}),
    };
}
