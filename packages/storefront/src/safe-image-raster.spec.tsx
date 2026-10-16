// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mediaDescriptor } from '../../storefront-content-plugin/src/shared/responsive-image';

import { clearDecodedImageCache, SafeImage, SafeImageMediaProvider } from './safe-image';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('decoded raster backing', () => {
    const drawings: Array<{ destination: HTMLCanvasElement; source: CanvasImageSource }> = [];
    const originalDecode = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'decode');
    beforeEach(() => {
        clearDecodedImageCache();
        drawings.length = 0;
        vi.stubGlobal('CanvasRenderingContext2D', class {});
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
            this: HTMLCanvasElement,
        ) {
            return {
                drawImage: (source: CanvasImageSource) => drawings.push({ destination: this, source }),
            } as unknown as CanvasRenderingContext2D;
        });
        Object.defineProperty(HTMLImageElement.prototype, 'decode', {
            configurable: true,
            value: vi.fn().mockResolvedValue(undefined),
        });
    });
    afterEach(() => {
        clearDecodedImageCache();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        if (originalDecode) Object.defineProperty(HTMLImageElement.prototype, 'decode', originalDecode);
        else Reflect.deleteProperty(HTMLImageElement.prototype, 'decode');
    });
    const view = (source: string, scope = 'public-a', allowed = true) => (
        <SafeImageMediaProvider scope={scope} media={allowed ? [mediaDescriptor(source, 'hero')] : []}>
            <SafeImage src={source} imageKind="hero" alt="Public artwork" style={{ objectFit: 'contain' }} />
        </SafeImageMediaProvider>
    );
    async function decoded(host: HTMLElement) {
        const image = host.querySelector<HTMLImageElement>('img.safe-image');
        if (!image) throw new Error('Expected current candidate');
        Object.defineProperties(image, {
            complete: { configurable: true, value: true },
            naturalWidth: { configurable: true, value: 640 },
            naturalHeight: { configurable: true, value: 640 },
            currentSrc: { configurable: true, value: image.src },
        });
        await act(async () => {
            image.dispatchEvent(new Event('load'));
            await Promise.resolve();
        });
        return image;
    }
    it('draws an independent decoded bitmap before remount can present its new candidate', async () => {
        const host = document.createElement('div');
        const root = createRoot(host);
        try {
            act(() => root.render(view('/public-raster.webp?v=1')));
            const original = await decoded(host);
            const snapshot = drawings.find(item => item.source === original)?.destination;
            if (!snapshot) throw new Error('Expected independent bitmap');
            expect([snapshot.width, snapshot.height]).toEqual([128, 128]);
            act(() => root.render(null));
            act(() => root.render(view('/public-raster.webp?v=1')));
            const backing = host.querySelector('canvas');
            expect(backing).not.toBeNull();
            expect(drawings.some(item => item.destination === backing && item.source === snapshot)).toBe(
                true,
            );
            expect(host.querySelector('[data-safe-image="loading"]')).not.toBeNull();
            expect(host.querySelector('.is-painted')).toBeNull();
            expect(host.querySelector('img.safe-image-preview')).toBeNull();
            expect(backing?.getAttribute('aria-hidden')).toBe('true');
        } finally {
            act(() => root.unmount());
        }
    });
    it('never supplies a cached bitmap outside the current scope, admitted source or version', async () => {
        const host = document.createElement('div');
        const root = createRoot(host);
        try {
            act(() => root.render(view('/public-raster.webp?v=1')));
            await decoded(host);
            for (const next of [
                view('/public-raster.webp?v=1', 'other-store'),
                view('/public-raster.webp?v=1', 'public-a', false),
                view('/public-raster.webp?v=2'),
            ]) {
                act(() => root.render(null));
                act(() => root.render(next));
                expect(host.querySelector('canvas')).toBeNull();
            }
        } finally {
            act(() => root.unmount());
        }
    });
    it('bounds bitmap storage and releases evicted and explicitly cleared pixels', async () => {
        const host = document.createElement('div');
        const root = createRoot(host);
        try {
            for (let i = 0; i < 129; i++) {
                act(() => root.render(view(`/bounded-raster-${i}.webp`)));
                await decoded(host);
            }
            const snapshots = drawings
                .filter(item => item.source instanceof HTMLImageElement)
                .map(item => item.destination);
            expect(snapshots).toHaveLength(129);
            expect(snapshots[0].width).toBe(0);
            expect(
                snapshots.reduce((sum, canvas) => sum + canvas.width * canvas.height, 0),
            ).toBeLessThanOrEqual(2 * 1024 * 1024);
            act(() => root.render(null));
            act(() => root.render(view('/bounded-raster-0.webp')));
            expect(host.querySelector('canvas')).toBeNull();
            clearDecodedImageCache();
            expect(snapshots.every(canvas => canvas.width * canvas.height === 0)).toBe(true);
        } finally {
            act(() => root.unmount());
        }
    });
    it('keeps an already copied backing through unrelated renders after its source is evicted', async () => {
        const host = document.createElement('div');
        const pressureHost = document.createElement('div');
        const root = createRoot(host);
        const pressure = createRoot(pressureHost);
        try {
            act(() => root.render(view('/pending-backing.webp')));
            await decoded(host);
            act(() => root.render(null));
            act(() => root.render(view('/pending-backing.webp')));
            const backing = host.querySelector('canvas');
            expect(backing?.width).toBe(128);
            for (let i = 0; i < 129; i++) {
                act(() => pressure.render(view(`/pressure-${i}.webp`)));
                await decoded(pressureHost);
            }
            act(() => root.render(view('/pending-backing.webp')));
            expect(host.querySelector('canvas')).toBe(backing);
            expect(backing?.width).toBe(128);
            expect(host.querySelector('[data-safe-image="loading"]')).not.toBeNull();
        } finally {
            act(() => root.unmount());
            act(() => pressure.unmount());
        }
    });
    it('preserves the old crop when a replacement changes both source and frame styling', async () => {
        const host = document.createElement('div');
        const root = createRoot(host);
        const render = (replacement: boolean) => (
            <SafeImageMediaProvider
                scope="public-a"
                media={[mediaDescriptor('/old-crop.webp', 'hero'), mediaDescriptor('/new-crop.webp', 'hero')]}
            >
                <SafeImage
                    src={replacement ? '/new-crop.webp' : '/old-crop.webp'}
                    imageKind="hero"
                    alt="Changing artwork"
                    style={{
                        objectFit: replacement ? 'contain' : 'cover',
                        objectPosition: replacement ? 'left top' : 'right center',
                    }}
                />
            </SafeImageMediaProvider>
        );
        try {
            act(() => root.render(render(false)));
            await decoded(host);
            act(() => root.render(render(true)));
            const canvas = host.querySelector('canvas');
            expect(canvas?.style.objectFit).toBe('cover');
            expect(canvas?.style.objectPosition).toBe('right center');
            expect(host.querySelector('[data-safe-image="loading"]')).not.toBeNull();
        } finally {
            act(() => root.unmount());
        }
    });
});
