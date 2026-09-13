// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { SafeImage, isImageAlreadyDecoded } from './storefront-ui/product-display';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true,
    writable: true,
    value: () => Promise.resolve(),
});

describe('SafeImage', () => {
    it('does not mark a failed decode as loaded or cache a broken image', async () => {
        const decode = vi
            .spyOn(HTMLImageElement.prototype, 'decode')
            .mockRejectedValue(new Error('Decode failed'));
        const host = document.createElement('div');
        const root = createRoot(host);
        try {
            await act(async () => {
                root.render(<SafeImage src="/assets/broken-decode.png" alt="" />);
                await Promise.resolve();
            });
            expect(host.querySelector('img')?.classList.contains('is-loaded')).toBe(false);
            expect(isImageAlreadyDecoded('/assets/broken-decode.png')).toBe(false);
        } finally {
            act(() => root.unmount());
            decode.mockRestore();
        }
    });
    it('shows a completed image without waiting for another decode and recovers from an error', () => {
        const host = document.createElement('div');
        const root = createRoot(host);
        const onLoad = vi.fn();
        const decode = vi
            .spyOn(HTMLImageElement.prototype, 'decode')
            .mockImplementation(() => new Promise(() => undefined));
        try {
            act(() =>
                root.render(
                    <SafeImage
                        src="/assets/completed.png"
                        fallbackSrc="/assets/fallback.png"
                        alt="Preview"
                        onLoad={onLoad}
                    />,
                ),
            );
            const image = host.querySelector('img');
            if (!image) throw new Error('Expected the preview image');
            Object.defineProperties(image, {
                complete: { value: true, configurable: true },
                naturalWidth: { value: 320, configurable: true },
            });
            act(() => {
                image.dispatchEvent(new Event('load'));
            });
            expect(image.classList.contains('is-loaded')).toBe(true);
            expect(onLoad).toHaveBeenCalledOnce();
            Object.defineProperties(image, { complete: { value: false }, naturalWidth: { value: 0 } });
            act(() => {
                image.dispatchEvent(new Event('error'));
            });
            expect(image.getAttribute('src')).toBe('/assets/fallback.png');
            expect(image.classList.contains('is-loaded')).toBe(false);
        } finally {
            act(() => root.unmount());
            decode.mockRestore();
        }
    });
    it.each(['card', 'detail', 'thumbnail'] as const)(
        'loads %s images at responsive resolution without enlarging a tiny placeholder',
        imageKind => {
            const markup = renderToStaticMarkup(
                <SafeImage
                    src="/assets/preview/product.jpg"
                    alt="Product"
                    imageKind={imageKind}
                    loading="lazy"
                />,
            );

            expect(markup).toContain('safe-image-frame');
            expect(markup).not.toContain('has-placeholder');
            expect(markup).not.toContain('background-image');
            expect(markup).not.toContain('storefront-placeholder');
            expect(markup).toContain('srcSet=');
            expect(markup).toContain('q=90');
            expect(markup).not.toContain('safe-image is-loaded');
        },
    );

    it('preserves automatic hero and explicitly requested placeholders', () => {
        const hero = renderToStaticMarkup(
            <SafeImage src="/assets/preview/banner.jpg" alt="Banner" imageKind="hero" />,
        );
        expect(hero).toContain('storefront-placeholder-wide-64');

        const markup = renderToStaticMarkup(
            <SafeImage
                src="/assets/preview/product.jpg"
                placeholderSrc="/assets/preview/cover.jpg"
                alt="Product"
                imageKind="card"
            />,
        );
        expect(markup).toContain('has-placeholder');
        expect(markup).toContain('storefront-placeholder-square-48');
        expect(markup).toContain('storefront-card-square-960');
    });

    it('keeps a stable frame for external images while they decode', () => {
        const markup = renderToStaticMarkup(
            <SafeImage src="https://images.example.com/product.jpg" alt="Product" loading="lazy" />,
        );

        expect(markup).toContain('<span class="responsive-picture safe-image-frame"');
        expect(markup).toContain('class="safe-image"');
    });

    it('allows compact components to select a smaller responsive image candidate', () => {
        const markup = renderToStaticMarkup(
            <SafeImage src="/assets/preview/icon.png" alt="" imageKind="thumbnail" sizes="48px" />,
        );

        expect(markup).toContain('sizes="48px"');
        expect(markup).toContain('storefront-thumbnail-160');
        expect(markup).toContain('storefront-thumbnail-320');
    });

    it('tracks decoded images in client session to skip repeated opacity fade-in', async () => {
        const { markImageDecoded } = await import('./storefront-ui/product-display');
        markImageDecoded('/assets/preview/fast.png');
        expect(isImageAlreadyDecoded('/assets/preview/fast.png')).toBe(true);
    });
});
