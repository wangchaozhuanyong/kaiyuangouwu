import type { ArtworkPosterDesign } from '../../../../common/src/referral-poster-design';

export function resizeArtworkCanvas(
    design: ArtworkPosterDesign,
    width: number,
    height: number,
): ArtworkPosterDesign {
    const diameter = Math.min(
        Math.min(width, height),
        Math.max(360, Math.round((design.qr.diameter * width) / design.canvas.width)),
    );
    const radius = diameter / 2;
    const bound = (value: number, max: number) =>
        Math.round(Math.max(Math.ceil(radius), Math.min(Math.floor(max - radius), value)));
    return {
        ...design,
        canvas: { width, height },
        qr: {
            ...design.qr,
            diameter,
            centerX: bound((design.qr.centerX * width) / design.canvas.width, width),
            centerY: bound((design.qr.centerY * height) / design.canvas.height, height),
        },
    };
}

export function artworkAssetRatioError(design: ArtworkPosterDesign, width?: number, height?: number) {
    if (!width || !height) return '';
    return Math.abs(width / height - design.canvas.width / design.canvas.height) > 0.001
        ? `图片为 ${width}×${height}，与画布 ${design.canvas.width}×${design.canvas.height} 比例不一致。请调整设计图或画布规格；整图模式不会裁切。`
        : '';
}

export function posterPreviewUrl(storefrontUrl?: string | null): string {
    try {
        const url = new URL('/register', storefrontUrl || 'https://store.example');
        if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid store URL');
        url.searchParams.set('ref', 'PREVIEW');
        url.searchParams.set('source', 'POSTER');
        return url.toString();
    } catch {
        return 'https://store.example/register?ref=PREVIEW&source=POSTER';
    }
}
