// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ImagePlaceholder, isImageAlreadyDecoded } from './safe-image';
import { SafeImage } from './storefront-ui/product-display';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true,
    writable: true,
    value: () => Promise.resolve(),
});

function requiredImage(host: ParentNode): HTMLImageElement {
    const image = host.querySelector('img');
    if (!image) throw new Error('Expected an image');
    return image;
}

describe('SafeImage', () => {
    it.each([
        ['zh', '图片暂时无法显示'],
        ['en', 'Image temporarily unavailable'],
    ] as const)('distinguishes loading, failed and replaced images in %s', (language, label) => {
        const host = document.createElement('div');
        const root = createRoot(host);
        try {
            act(() =>
                root.render(<SafeImage src="/missing-state-image.png" alt="Product" language={language} />),
            );
            expect(host.querySelector('[data-image-state=loading]')).not.toBeNull();
            expect(host.querySelector('.image-status-label')).toBeNull();
            act(() => {
                requiredImage(host).dispatchEvent(new Event('error'));
            });
            expect(host.querySelector('[data-image-state=error]')).not.toBeNull();
            expect(host.querySelector('.image-status-label')?.textContent).toBe(label);
            expect(host.querySelector('[role=img]')?.getAttribute('aria-label')).toContain(label);

            const nextLanguage = language === 'zh' ? 'en' : 'zh';
            act(() =>
                root.render(
                    <SafeImage src="/missing-state-image.png" alt="Product" language={nextLanguage} />,
                ),
            );
            expect(host.querySelector('.image-status-label')?.textContent).not.toBe(label);
            act(() =>
                root.render(
                    <SafeImage src="/replacement-state-image.png" alt="Product" language={language} />,
                ),
            );
            expect(host.querySelector('[data-image-state=loading]')).not.toBeNull();
            expect(host.querySelector('.image-status-label')).toBeNull();
        } finally {
            act(() => root.unmount());
        }
    });

    it('keeps compact missing media accessible without fitting copy into a tiny thumbnail', () => {
        const markup = renderToStaticMarkup(<ImagePlaceholder compact alt="商品" language="zh" />);
        expect(markup).toContain('商品 · 暂无商品图片');
        expect(markup).not.toContain('image-status-label');
    });

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
            const image = requiredImage(host);
            Object.defineProperties(image, { complete: { value: true }, naturalWidth: { value: 320 } });
            await act(async () => {
                image.dispatchEvent(new Event('load'));
                await Promise.resolve();
            });
            expect(host.querySelector('.safe-image.is-loaded')).toBeNull();
            expect(host.querySelector('[data-safe-image=ready]')).toBeNull();
            expect(isImageAlreadyDecoded('/assets/broken-decode.png')).toBe(false);
        } finally {
            act(() => root.unmount());
            decode.mockRestore();
        }
    });
    it('reveals only after decoding and recovers from a later error', async () => {
        const host = document.createElement('div');
        const root = createRoot(host);
        const onLoad = vi.fn();
        const decode = vi.spyOn(HTMLImageElement.prototype, 'decode').mockResolvedValue(undefined);
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
            await act(async () => {
                image.dispatchEvent(new Event('load'));
                await Promise.resolve();
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

    it('keeps the hero preview visible when a responsive preset falls back to the original', () => {
        const host = document.createElement('div');
        const root = createRoot(host);
        try {
            act(() =>
                root.render(<SafeImage src="/assets/preview/banner.jpg" alt="Banner" imageKind="hero" />),
            );
            const image = requiredImage(host);
            act(() => {
                image.dispatchEvent(new Event('error'));
            });
            expect(image.getAttribute('srcset')).toBeNull();
            expect(host.querySelector<HTMLElement>('.safe-image-fallback')?.style.backgroundImage).toContain(
                'storefront-placeholder-wide-64',
            );
            expect(host.querySelector('.safe-image-fallback svg')).toBeNull();
        } finally {
            act(() => root.unmount());
        }
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
            <SafeImage src="/assets/preview/icon.png" alt="" imageKind="icon" sizes="48px" />,
        );

        expect(markup).toContain('sizes="48px"');
        expect(markup).toContain('storefront-icon-64');
        expect(markup).toContain('storefront-icon-96');
    });

    it('reuses session decoded status so new image elements mount ready without flash while unseen images wait', async () => {
        const host = document.createElement('div');
        const root = createRoot(host);
        try {
            act(() => root.render(<SafeImage src="/unseen.webp" alt="Unseen" />));
            const unseen = requiredImage(host);
            expect(unseen.classList.contains('is-loaded')).toBe(false);

            act(() => root.render(<SafeImage src="/same.webp" alt="One" />));
            const first = requiredImage(host);
            Object.defineProperties(first, { complete: { value: true }, naturalWidth: { value: 320 } });
            await act(async () => {
                first.dispatchEvent(new Event('load'));
                await Promise.resolve();
            });
            expect(first.classList.contains('is-loaded')).toBe(true);
            act(() => root.render(<SafeImage key="new" src="/same.webp" alt="Two" />));
            expect(host.querySelector('img')?.classList.contains('is-loaded')).toBe(true);
        } finally {
            act(() => root.unmount());
        }
    });

    it('discards a decode that completes after the source changes', async () => {
        let finish!: () => void;
        const decode = vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementation(
            () =>
                new Promise(resolve => {
                    finish = resolve;
                }),
        );
        const host = document.createElement('div');
        const root = createRoot(host);
        try {
            act(() => root.render(<SafeImage src="/old.webp" alt="Preview" />));
            const old = requiredImage(host);
            Object.defineProperties(old, { complete: { value: true }, naturalWidth: { value: 320 } });
            act(() => {
                old.dispatchEvent(new Event('load'));
            });
            act(() => root.render(<SafeImage src="/new.webp" alt="Preview" />));
            await act(async () => {
                finish();
                await Promise.resolve();
            });
            expect(host.querySelector('img')?.getAttribute('src')).toBe('/new.webp');
            expect(host.querySelector('[data-safe-image=ready]')).toBeNull();
        } finally {
            act(() => root.unmount());
            decode.mockRestore();
        }
    });

    it('retains the measured image height when all fallback candidates fail', () => {
        const host = document.createElement('div');
        const root = createRoot(host);
        try {
            act(() => root.render(<SafeImage src="/broken.webp" alt="Product" />));
            const image = requiredImage(host);
            vi.spyOn(image, 'getBoundingClientRect').mockReturnValue({ height: 240 } as DOMRect);
            act(() => {
                image.dispatchEvent(new Event('error'));
            });
            expect(host.querySelector<HTMLElement>('[data-safe-image=error]')?.style.minHeight).toBe('240px');
            expect(host.querySelector('.safe-image-fallback')).not.toBeNull();
            expect(host.querySelector('[role=img]')?.getAttribute('aria-label')).toBe(
                'Product · 图片暂时无法显示',
            );
        } finally {
            act(() => root.unmount());
        }
    });

    it('does not retry the same responsive candidate when the final fallback uses the original asset', () => {
        const host = document.createElement('div');
        const root = createRoot(host);
        try {
            act(() =>
                root.render(
                    <SafeImage
                        src="/assets/preview/auth.jpg?preset=storefront-original-preview"
                        fallbackSrc="/assets/preview/auth.jpg"
                        alt=""
                        imageKind="detail"
                    />,
                ),
            );
            const image = requiredImage(host);
            act(() => {
                image.dispatchEvent(new Event('error'));
            });
            expect(image.getAttribute('srcset')).toBeNull();
            act(() => {
                image.dispatchEvent(new Event('error'));
            });
            expect(image.getAttribute('src')).toBe('/assets/preview/auth.jpg');
            expect(image.getAttribute('srcset')).toBeNull();
        } finally {
            act(() => root.unmount());
        }
    });
});
