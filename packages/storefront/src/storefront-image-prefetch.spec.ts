// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const images: FakeImage[] = [];
class FakeImage {
    src = '';
    currentSrc = '';
    srcset = '';
    sizes = '';
    complete = false;
    naturalWidth = 0;
    fetchPriority = '';
    finish = () => undefined as void;
    reject = (_error: Error) => undefined as void;
    constructor() {
        images.push(this);
    }
    decode() {
        return new Promise<void>((resolve, reject) => {
            this.finish = () => {
                this.complete = true;
                this.naturalWidth = 640;
                resolve();
            };
            this.reject = reject;
        });
    }
    removeAttribute(key: 'src' | 'srcset') {
        this[key] = '';
    }
}

describe('shared speculative image queue', () => {
    beforeEach(() => {
        vi.resetModules();
        images.length = 0;
        vi.stubGlobal('Image', FakeImage);
        Object.defineProperty(navigator, 'connection', {
            configurable: true,
            value: { effectiveType: '4g' },
        });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('deduplicates simultaneous and recently completed candidates with two active downloads', async () => {
        const { prefetchStorefrontImage } = await import('./storefront-image-prefetch');
        prefetchStorefrontImage('/assets/preview/a.png', 'detail');
        prefetchStorefrontImage(new URL('/assets/preview/a.png', window.location.href).href, 'detail');
        prefetchStorefrontImage('/assets/preview/a.png', 'detail');
        prefetchStorefrontImage('/assets/preview/b.png', 'detail');
        prefetchStorefrontImage('/assets/preview/c.png', 'detail');
        expect(images).toHaveLength(2);
        expect(images.every(image => image.fetchPriority === 'low')).toBe(true);
        images[0].finish();
        await vi.waitFor(() => expect(images).toHaveLength(3));
        prefetchStorefrontImage('/assets/preview/a.png', 'detail');
        expect(images).toHaveLength(3);
        images[1].finish();
        images[2].finish();
    });

    it('skips Save-Data and slow connections, including queued work when preferences change', async () => {
        const { prefetchStorefrontImage } = await import('./storefront-image-prefetch');
        const connection = { effectiveType: '4g', saveData: true };
        Object.defineProperty(navigator, 'connection', { value: connection });
        prefetchStorefrontImage('/assets/preview/a.png', 'detail');
        connection.saveData = false;
        connection.effectiveType = '2g';
        prefetchStorefrontImage('/assets/preview/a.png', 'detail');
        expect(images).toHaveLength(0);
        connection.effectiveType = '4g';
        for (const name of ['a', 'b', 'c']) prefetchStorefrontImage(`/assets/preview/${name}.png`, 'detail');
        connection.saveData = true;
        images[0].finish();
        images[1].finish();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(images).toHaveLength(2);
    });

    it('caps queued downloads and releases a timed-out slot', async () => {
        vi.useFakeTimers();
        const { prefetchStorefrontImage } = await import('./storefront-image-prefetch');
        for (let index = 0; index < 25; index++)
            prefetchStorefrontImage(`/assets/preview/${index}.png`, 'detail');
        expect(images).toHaveLength(2);
        await vi.advanceTimersByTimeAsync(15_000);
        expect(images).toHaveLength(4);
        expect(images[0].src).toBe('');
        await vi.advanceTimersByTimeAsync(150_000);
        expect(images).toHaveLength(18);
    });

    it('waits for the required page data before starting speculative images', async () => {
        const { prefetchStorefrontImage } = await import('./storefront-image-prefetch');
        const boundary = document.createElement('div');
        boundary.dataset.pageReadiness = 'preparing';
        document.body.append(boundary);
        try {
            prefetchStorefrontImage('/assets/preview/next.png', 'detail');
            expect(images).toHaveLength(0);
            boundary.dataset.pageReadiness = 'ready';
            document.dispatchEvent(new Event('storefront:page-ready'));
            expect(images).toHaveLength(1);
            images[0].finish();
        } finally {
            boundary.remove();
        }
    });

    it('ignores invalid image URLs without throwing from a pointer event', async () => {
        const { prefetchStorefrontImage } = await import('./storefront-image-prefetch');
        expect(() => prefetchStorefrontImage('http://[', 'detail')).not.toThrow();
        expect(images).toHaveLength(0);
    });
});
