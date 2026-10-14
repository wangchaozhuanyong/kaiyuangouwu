// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { decodeImageElement, isImageCandidateComplete } from './image-readiness';

describe('actual image candidate readiness', () => {
    it('rejects a stale direct currentSrc even when complete and dimensions still describe old pixels', () => {
        const image = new Image();
        image.src = '/next.webp';
        Object.defineProperties(image, {
            complete: { value: true },
            naturalWidth: { value: 100 },
            currentSrc: { value: new URL('/old.webp', location.href).href },
        });
        expect(isImageCandidateComplete(image)).toBe(false);
    });

    it('allows preloading to decode while the browser selects an initially pending responsive candidate', async () => {
        const image = new Image();
        image.src = '/fallback.webp';
        image.srcset = '/small.webp 160w, /large.webp 960w';
        const decode = vi.fn(() => {
            Object.defineProperties(image, {
                complete: { value: true },
                naturalWidth: { value: 160 },
                currentSrc: { value: new URL('/small.webp', location.href).href },
            });
            return Promise.resolve();
        });
        image.decode = decode;
        await expect(decodeImageElement(image)).resolves.toBeUndefined();
        expect(decode).toHaveBeenCalledOnce();
    });

    it('rejects decode when the already selected responsive candidate changes', async () => {
        const image = new Image();
        image.src = '/fallback.webp';
        image.srcset = '/small.webp 160w, /large.webp 960w';
        Object.defineProperties(image, {
            complete: { value: true },
            naturalWidth: { value: 160 },
            currentSrc: { configurable: true, value: new URL('/small.webp', location.href).href },
        });
        image.decode = vi.fn((): Promise<void> => {
            Object.defineProperty(image, 'currentSrc', { value: new URL('/large.webp', location.href).href });
            return Promise.resolve();
        });
        await expect(decodeImageElement(image)).rejects.toThrow('Image candidate is not ready');
    });

    it('turns a synchronous decode error into a retryable rejection', async () => {
        const image = new Image();
        image.src = '/retry.webp';
        Object.defineProperties(image, { complete: { value: true }, naturalWidth: { value: 100 } });
        image.decode = vi.fn(() => {
            throw new Error('Decode failed');
        });
        await expect(decodeImageElement(image)).rejects.toThrow('Decode failed');
        image.decode = vi.fn(() => Promise.resolve());
        await expect(decodeImageElement(image)).resolves.toBeUndefined();
    });
});
