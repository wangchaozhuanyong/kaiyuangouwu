import { useEffect, useState } from 'react';

export type ImageTone = 'light' | 'dark';

const toneCache = new Map<string, ImageTone>();

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
