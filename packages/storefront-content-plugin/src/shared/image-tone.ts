import { useCallback, useEffect, useState } from 'react';

export type ImageTone = 'light' | 'dark';
export interface ImageTextContrast {
    tone: ImageTone;
    needsBacking: boolean;
}

const toneCache = new Map<string, ImageTone>();
const textContrastCache = new Map<string, ImageTextContrast>();

/**
 * Calculate perceived luminance using ITU-R BT.709 standard.
 * Range: 0 (pure black) to 255 (pure white).
 */
export function calculateLuminance(r: number, g: number, b: number): number {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Samples the text-covered region of an image (default: left 60% horizontally)
 * to determine whether the background is light or dark.
 */
export function sampleImageTone(imageElement: HTMLImageElement, horizontalRatio = 0.6): ImageTone {
    try {
        const canvas = document.createElement('canvas');
        const width = 40;
        const height = 24;
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return 'dark';

        ctx.drawImage(imageElement, 0, 0, width, height);

        // Focus analysis on the region where text is overlaid (left area)
        const sampleWidth = Math.max(4, Math.floor(width * horizontalRatio));
        const imgData = ctx.getImageData(0, 0, sampleWidth, height);
        const data = imgData.data;

        let totalLuminance = 0;
        let count = 0;

        for (let i = 0; i < data.length; i += 4) {
            const alpha = data[i + 3];
            if (alpha > 30) {
                totalLuminance += calculateLuminance(data[i], data[i + 1], data[i + 2]);
                count++;
            }
        }

        if (count === 0) return 'dark';
        const avgLuminance = totalLuminance / count;
        // Threshold around 138 gives optimal balance for high contrast text readability
        return avgLuminance >= 138 ? 'light' : 'dark';
    } catch {
        // In case of CORS canvas taint, gracefully fallback
        return 'dark';
    }
}

/** Check the copy side of a photograph rather than relying on its average color. */
export function sampleImageTextContrast(
    imageElement: HTMLImageElement,
    horizontalRatio = 0.6,
): ImageTextContrast {
    const fallback: ImageTextContrast = { tone: 'dark', needsBacking: true };
    try {
        const canvas = document.createElement('canvas');
        canvas.width = 48;
        canvas.height = 32;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return fallback;
        ctx.drawImage(imageElement, 0, 0, canvas.width, canvas.height);
        const width = Math.max(1, Math.floor(canvas.width * horizontalRatio));
        return assessImageTextPixels(ctx.getImageData(0, 0, width, canvas.height).data);
    } catch {
        // Cross-origin images without canvas permission always keep a readable local surface.
        return fallback;
    }
}

export function assessImageTextPixels(pixels: Uint8ClampedArray): ImageTextContrast {
    let darkTextWorks = true;
    let lightTextWorks = true;
    let total = 0;
    let count = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
        if (pixels[offset + 3] < 240) continue;
        const channels = [pixels[offset], pixels[offset + 1], pixels[offset + 2]].map(value => {
            const channel = value / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
        if ((luminance + 0.05) / 0.05 < 4.5) darkTextWorks = false;
        if (1.05 / (luminance + 0.05) < 4.5) lightTextWorks = false;
        total += luminance;
        count += 1;
    }
    if (!count) return { tone: 'dark', needsBacking: true };
    const tone: ImageTone = total / count >= 0.18 ? 'light' : 'dark';
    return { tone, needsBacking: !(tone === 'light' ? darkTextWorks : lightTextWorks) };
}

/** Analyze the rendered candidate so contrast checks never download the original a second time. */
export function useImageTextContrast(
    imageUrl?: string | null,
): ImageTextContrast & { onImageLoad: (image: HTMLImageElement) => void } {
    const source = imageUrl?.trim() ?? '';
    const [result, setResult] = useState<{ source: string; value: ImageTextContrast }>(() => ({
        source,
        value: textContrastCache.get(source) ?? { tone: 'dark', needsBacking: true },
    }));
    useEffect(() => {
        if (!source) return;
        const cached = textContrastCache.get(source);
        if (cached) {
            setResult({ source, value: cached });
            return;
        }
        setResult({ source, value: { tone: 'dark', needsBacking: true } });
    }, [source]);

    const onImageLoad = useCallback(
        (image: HTMLImageElement) => {
            if (!source) return;
            const next = sampleImageTextContrast(image);
            textContrastCache.set(source, next);
            setResult(current =>
                current.source === source &&
                current.value.tone === next.tone &&
                current.value.needsBacking === next.needsBacking
                    ? current
                    : { source, value: next },
            );
        },
        [source],
    );
    const value: ImageTextContrast = source
        ? result.source === source
            ? result.value
            : (textContrastCache.get(source) ?? { tone: 'dark', needsBacking: true })
        : { tone: 'dark', needsBacking: false };
    return { ...value, onImageLoad };
}

/**
 * Loads an image offscreen to detect its tone asynchronously with memory caching.
 */
export function detectImageToneFromUrl(
    imageUrl: string,
    fallbackTone: ImageTone = 'dark',
): Promise<ImageTone> {
    const trimmed = imageUrl.trim();
    if (!trimmed) return Promise.resolve(fallbackTone);

    const cached = toneCache.get(trimmed);
    if (cached !== undefined) {
        return Promise.resolve(cached);
    }

    return new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.decoding = 'async';

        const finish = (tone: ImageTone) => {
            toneCache.set(trimmed, tone);
            resolve(tone);
        };

        img.onload = () => {
            const tone = sampleImageTone(img);
            finish(tone);
        };

        img.onerror = () => {
            finish(fallbackTone);
        };

        img.src = trimmed;
    });
}

/**
 * React Hook that automatically reacts to image changes and provides the adaptive tone.
 */
export function useImageTone(imageUrl?: string | null, fallbackTone: ImageTone = 'dark'): ImageTone {
    const [tone, setTone] = useState<ImageTone>(() => {
        if (!imageUrl) return fallbackTone;
        return toneCache.get(imageUrl.trim()) ?? fallbackTone;
    });

    useEffect(() => {
        if (!imageUrl?.trim()) {
            setTone(fallbackTone);
            return;
        }

        const trimmed = imageUrl.trim();
        const cached = toneCache.get(trimmed);
        if (cached !== undefined) {
            setTone(cached);
            return;
        }

        let isMounted = true;
        void detectImageToneFromUrl(trimmed, fallbackTone).then(detectedTone => {
            if (isMounted) {
                setTone(detectedTone);
            }
        });

        return () => {
            isMounted = false;
        };
    }, [imageUrl, fallbackTone]);

    return tone;
}
