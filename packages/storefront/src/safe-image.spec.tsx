// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { mediaDescriptor } from '../../storefront-content-plugin/src/shared/responsive-image';

import { CustomerAvatar } from './components/common/customer-avatar';
import { IMAGE_WAIT_EXPIRED_EVENT } from './image-readiness';
import {
    clearDecodedImageCache,
    ImagePlaceholder,
    isImageAlreadyDecoded,
    SafeImageMediaProvider,
} from './safe-image';
import { ProductImagePlaceholder, ProductVariantImage, SafeImage } from './storefront-ui/product-display';

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
    it('keeps a completed SSR image presented during hydration while decode readiness is pending', async () => {
        clearDecodedImageCache();
        let finishDecode!: () => void;
        const decode = vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementation(
            () =>
                new Promise<void>(resolve => {
                    finishDecode = resolve;
                }),
        );
        const onImageReady = vi.fn();
        const element = (
            <SafeImage
                src="/ssr-painted.webp"
                placeholderSrc="/ssr-preview.webp"
                alt="Cover"
                width={640}
                height={360}
                onImageReady={onImageReady}
            />
        );
        const host = document.createElement('div');
        host.innerHTML = renderToStaticMarkup(element);
        const image = requiredImage(host);
        Object.defineProperties(image, {
            complete: { configurable: true, value: true },
            naturalWidth: { configurable: true, value: 640 },
            currentSrc: { configurable: true, value: image.src },
        });
        let root!: ReturnType<typeof hydrateRoot>;
        try {
            await act(async () => {
                root = hydrateRoot(host, element);
                await Promise.resolve();
            });
            expect(requiredImage(host)).toBe(image);
            expect(host.querySelector('.safe-image-frame.is-presented')).not.toBeNull();
            expect(host.querySelector('[data-safe-image=loading]')).not.toBeNull();
            expect(onImageReady).not.toHaveBeenCalled();
            expect(isImageAlreadyDecoded(image.src)).toBe(false);
            await act(async () => {
                finishDecode();
                await Promise.resolve();
            });
            expect(onImageReady).toHaveBeenCalledExactlyOnceWith(image);
            expect(host.querySelector('[data-safe-image=ready]')).not.toBeNull();
        } finally {
            act(() => root?.unmount());
            decode.mockRestore();
            clearDecodedImageCache();
        }
    });

    it('retains native placeholder-backed artwork with its actual crop before decode completes', () => {
        const decode = vi
            .spyOn(HTMLImageElement.prototype, 'decode')
            .mockImplementation(() => new Promise<void>(() => undefined));
        const host = document.createElement('div');
        const root = createRoot(host);
        const onImageReady = vi.fn();
        try {
            act(() =>
                root.render(
                    <SafeImage
                        src="/crop-old.webp"
                        placeholderSrc="/crop-preview.webp"
                        alt="Cover"
                        style={{ objectFit: 'cover', objectPosition: 'right center' }}
                        onImageReady={onImageReady}
                    />,
                ),
            );
            const image = requiredImage(host);
            Object.defineProperties(image, {
                complete: { configurable: true, value: true },
                naturalWidth: { configurable: true, value: 640 },
            });
            act(() => {
                image.dispatchEvent(new Event('load'));
            });
            act(() =>
                root.render(
                    <SafeImage
                        src="/crop-new.webp"
                        alt="Cover"
                        style={{ objectFit: 'cover', objectPosition: 'right center' }}
                        onImageReady={onImageReady}
                    />,
                ),
            );
            const fallback = host.querySelector<HTMLElement>('.safe-image-fallback');
            expect(fallback?.style.backgroundImage).toContain('/crop-old.webp');
            expect(fallback?.style.backgroundSize).toBe('cover');
            expect(fallback?.style.backgroundPosition).toBe('right center');
            expect(host.querySelector('[data-safe-image=loading]')).not.toBeNull();
            expect(onImageReady).not.toHaveBeenCalled();
        } finally {
            act(() => root.unmount());
            decode.mockRestore();
        }
    });

    it('renders supplied bounded inline hints on priority media without a placeholder request', () => {
        const preview = 'data:image/png;base64,aW5saW5l';
        const media = [mediaDescriptor('/cover.png?v=one', 'hero', { inlinePreview: preview })];
        const render = (
            src = '/cover.png?v=one',
            kind: 'hero' | 'card' = 'hero',
            priority: 'high' | 'auto' = 'high',
        ) =>
            renderToStaticMarkup(
                <SafeImageMediaProvider media={media}>
                    <SafeImage src={src} imageKind={kind} alt="Cover" fetchPriority={priority} />
                </SafeImageMediaProvider>,
            );
        expect(render()).toContain('has-inline-preview');
        expect(render()).toContain('safe-image-preview is-ready');
        expect(render()).toContain(`src="${preview}"`);
        expect(render()).not.toContain('storefront-placeholder');
        expect(render('/cover.png?v=two')).not.toContain('has-placeholder');
        expect(render('/cover.png?v=one', 'card')).not.toContain('has-placeholder');
        expect(render('/cover.png?v=one', 'hero', 'auto')).not.toContain('has-placeholder');
        const stale = renderToStaticMarkup(
            <SafeImageMediaProvider media={[{ ...media[0], version: 'other' }]}>
                <SafeImage src="/cover.png?v=one" imageKind="hero" alt="Cover" fetchPriority="high" />
            </SafeImageMediaProvider>,
        );
        expect(stale).not.toContain('has-placeholder');
    });

    it('marks only the actual responsive candidate decoded, never its larger fallback or original alias', async () => {
        clearDecodedImageCache();
        const host = document.createElement('div');
        const root = createRoot(host);
        try {
            act(() =>
                root.render(
                    <SafeImage
                        src="/assets/preview/candidate.png"
                        alt="Candidate"
                        imageKind="card"
                        sizes="80px"
                    />,
                ),
            );
            const image = requiredImage(host);
            const selected = new URL(
                '/assets/preview/candidate.png?preset=storefront-card-square-160&format=webp&q=90',
                location.href,
            ).href;
            Object.defineProperties(image, {
                complete: { configurable: true, value: true },
                naturalWidth: { configurable: true, value: 160 },
                currentSrc: { configurable: true, value: selected },
            });
            await act(async () => {
                image.dispatchEvent(new Event('load'));
                await Promise.resolve();
            });
            expect(isImageAlreadyDecoded(selected)).toBe(true);
            expect(isImageAlreadyDecoded('/assets/preview/candidate.png')).toBe(false);
            expect(isImageAlreadyDecoded(image.getAttribute('src'))).toBe(false);
        } finally {
            act(() => root.unmount());
            clearDecodedImageCache();
        }
    });

    it('preserves a decoded same-version customer avatar across remounts without treating a larger candidate as ready', async () => {
        clearDecodedImageCache();
        const host = document.createElement('div');
        const root = createRoot(host);
        const customer = {
            id: 'avatar-one',
            firstName: 'A',
            lastName: '',
            emailAddress: 'local@example.invalid',
            phoneNumber: null,
            avatar: { id: 'avatar-v1', preview: '/assets/preview/avatar.png?v=one' },
        };
        try {
            act(() => root.render(<CustomerAvatar customer={customer} size={48} />));
            const first = requiredImage(host);
            const selected = new URL(
                '/assets/preview/avatar.png?v=one&preset=storefront-icon-64&format=webp&q=82',
                location.href,
            ).href;
            Object.defineProperties(first, {
                complete: { configurable: true, value: true },
                naturalWidth: { configurable: true, value: 64 },
                currentSrc: { configurable: true, value: selected },
            });
            await act(async () => {
                first.dispatchEvent(new Event('load'));
                await Promise.resolve();
            });
            act(() => root.render(<CustomerAvatar key="security" customer={customer} size={64} />));
            const fallback = host.querySelector<HTMLElement>('.safe-image-fallback');
            expect(fallback?.style.backgroundImage).toContain('storefront-icon-64');
            expect(host.querySelector('[data-safe-image="ready"]')).toBeNull();
            expect(isImageAlreadyDecoded(requiredImage(host).getAttribute('src'))).toBe(false);
            act(() =>
                root.render(
                    <CustomerAvatar
                        key="other-owner"
                        customer={{ ...customer, id: 'avatar-other', firstName: 'B' }}
                        size={48}
                    />,
                ),
            );
            expect(host.querySelector<HTMLElement>('.safe-image-fallback')?.style.backgroundImage).toBe('');
            expect(host.textContent).toBe('B');
            act(() =>
                root.render(
                    <CustomerAvatar
                        key="changed"
                        customer={{
                            ...customer,
                            avatar: { id: 'avatar-v2', preview: '/assets/preview/avatar.png?v=two' },
                        }}
                        size={48}
                    />,
                ),
            );
            expect(host.querySelector<HTMLElement>('.safe-image-fallback')?.style.backgroundImage).toBe('');
            expect(host.textContent).toBe('A');
        } finally {
            act(() => root.unmount());
            clearDecodedImageCache();
        }
    });

    it('server-renders native art direction without preloading the wrong desktop source', () => {
        const html = renderToStaticMarkup(
            <SafeImage
                src="/desktop-art.jpg"
                alt="Artwork"
                fetchPriority="high"
                mediaSources={[
                    { media: '(max-width: 767px)', src: '/mobile-art.jpg', width: 800, height: 1000 },
                ]}
            />,
        );
        expect(html).toContain('<picture');
        expect(html).toContain('media="(max-width: 767px)" srcSet="/mobile-art.jpg"');
        expect(html).not.toContain('rel="preload"');
        expect(html).not.toContain('style="opacity:0');
    });

    it('does not mark desktop art decoded when a native picture loaded its mobile candidate', async () => {
        const host = document.createElement('div');
        const root = createRoot(host);
        const desktop = '/art-cache-desktop.jpg';
        const mobile = '/art-cache-mobile.jpg';
        try {
            act(() =>
                root.render(
                    <SafeImage
                        src={desktop}
                        alt="QA"
                        mediaSources={[{ media: '(max-width: 767px)', src: mobile }]}
                    />,
                ),
            );
            const image = requiredImage(host);
            Object.defineProperties(image, {
                complete: { configurable: true, value: true },
                naturalWidth: { configurable: true, value: 800 },
                currentSrc: { configurable: true, value: new URL(mobile, window.location.href).href },
            });
            await act(async () => {
                image.dispatchEvent(new Event('load'));
                await Promise.resolve();
            });
            expect(host.querySelector('[data-safe-image=ready]')).not.toBeNull();
            expect(isImageAlreadyDecoded(new URL(mobile, window.location.href).href)).toBe(true);
            expect(isImageAlreadyDecoded(desktop)).toBe(false);
        } finally {
            act(() => root.unmount());
        }
    });

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

    it('shows the supplied category icon when its managed image is unavailable', () => {
        const host = document.createElement('div');
        const root = createRoot(host);
        try {
            act(() =>
                root.render(
                    <SafeImage
                        src="/missing-category.png"
                        alt=""
                        errorFallback={<span data-category-fallback>分类</span>}
                    />,
                ),
            );
            act(() => {
                requiredImage(host).dispatchEvent(new Event('error'));
            });
            expect(host.querySelector('[data-safe-image=error]')).not.toBeNull();
            expect(host.querySelector('[data-category-fallback]')?.textContent).toBe('分类');
            expect(host.querySelector('[data-image-state=error]')).toBeNull();
        } finally {
            act(() => root.unmount());
        }
    });

    it('keeps order thumbnails compact when neither variant nor product has an image', () => {
        const variant = {
            id: 'variant-1',
            name: '订单商品',
            sku: 'SKU-1',
            priceWithTax: 100,
            currencyCode: 'MYR',
            featuredAsset: null,
            product: { id: 'product-1', name: '订单商品', featuredAsset: null },
            customFields: { fulfillmentType: 'physical' },
        } satisfies Parameters<typeof ProductVariantImage>[0]['variant'];
        const missing = renderToStaticMarkup(
            <ProductVariantImage variant={variant} alt={variant.name} language="zh" />,
        );
        expect(missing).toContain('role="img" aria-label="暂无商品图"');
        expect(missing).not.toContain('product-image-placeholder-label');

        const available = renderToStaticMarkup(
            <ProductVariantImage
                variant={{
                    ...variant,
                    product: {
                        ...variant.product,
                        featuredAsset: { id: 'asset-1', preview: '/product.jpg' },
                    },
                }}
                alt={variant.name}
                language="zh"
            />,
        );
        expect(available).toContain('<img');
        expect(available).toContain('/product.jpg');
        expect(renderToStaticMarkup(<ProductImagePlaceholder language="zh" />)).toContain(
            'product-image-placeholder-label',
        );
    });

    it('gives a late-promoted lazy image its own network deadline', async () => {
        vi.useFakeTimers();
        const host = document.createElement('div');
        const root = createRoot(host);
        try {
            act(() => root.render(<SafeImage src="/below-fold.png" alt="Product" loading="lazy" />));
            await act(async () => {
                await vi.advanceTimersByTimeAsync(60_000);
            });
            expect(requiredImage(host).getAttribute('src')).toBe('/below-fold.png');
            expect(host.querySelector('[data-safe-image=timeout]')).toBeNull();
            act(() => {
                const image = requiredImage(host);
                image.loading = 'eager';
                image.dispatchEvent(new Event(IMAGE_WAIT_EXPIRED_EVENT));
            });
            await act(async () => {
                await vi.advanceTimersByTimeAsync(14_999);
            });
            expect(requiredImage(host).getAttribute('src')).toBe('/below-fold.png');
            await act(async () => {
                await vi.advanceTimersByTimeAsync(15_001);
            });
            expect(host.querySelector('img')).toBeNull();
        } finally {
            act(() => root.unmount());
            vi.useRealTimers();
        }
    });

    it('does not expire a lazy image which has not been promoted into page loading', async () => {
        vi.useFakeTimers();
        const host = document.createElement('div');
        const root = createRoot(host);
        try {
            act(() => root.render(<SafeImage src="/below-fold.png" alt="Product" loading="lazy" />));
            await act(async () => {
                await vi.advanceTimersByTimeAsync(60_000);
            });
            expect(requiredImage(host).getAttribute('src')).toBe('/below-fold.png');
            expect(host.querySelector('[data-safe-image=timeout]')).toBeNull();
        } finally {
            act(() => root.unmount());
            vi.useRealTimers();
        }
    });
    it('clears the previous deadline when the image source changes', async () => {
        vi.useFakeTimers();
        const host = document.createElement('div');
        const root = createRoot(host);
        try {
            act(() =>
                root.render(<SafeImage src="/previous.png" alt="Product" srcSet="/previous-large.png 2x" />),
            );
            await act(async () => {
                await vi.advanceTimersByTimeAsync(10_000);
            });
            act(() =>
                root.render(<SafeImage src="/current.png" alt="Product" srcSet="/current-large.png 2x" />),
            );
            await act(async () => {
                await vi.advanceTimersByTimeAsync(5_100);
            });
            expect(requiredImage(host).getAttribute('src')).toBe('/current.png');
            const image = requiredImage(host);
            await act(async () => {
                await vi.advanceTimersByTimeAsync(25_000);
            });
            expect(host.querySelector('img')).toBeNull();
            expect(image.hasAttribute('srcset')).toBe(false);
        } finally {
            act(() => root.unmount());
            vi.useRealTimers();
        }
    });
    it('starts lazy images near the viewport with fixed geometry and recovers late loads locally', async () => {
        vi.useFakeTimers();
        let enter = () => undefined as void;
        vi.stubGlobal(
            'IntersectionObserver',
            class {
                constructor(
                    callback: (entries: Array<{ isIntersecting: boolean }>) => void,
                    options: IntersectionObserverInit,
                ) {
                    expect(options.rootMargin).toBe('400px 0px');
                    enter = () => callback([{ isIntersecting: true }]);
                }
                observe() {
                    return undefined;
                }
                disconnect() {
                    return undefined;
                }
            },
        );
        const host = document.createElement('div');
        const root = createRoot(host);
        try {
            act(() =>
                root.render(
                    <SafeImage src="/late-local.png" alt="Product" loading="lazy" width={320} height={240} />,
                ),
            );
            await act(() => vi.advanceTimersByTimeAsync(60_000));
            expect(host.querySelector('[data-safe-image=timeout]')).toBeNull();
            act(() => enter());
            expect(requiredImage(host).getAttribute('loading')).toBe('eager');
            expect(requiredImage(host).getAttribute('width')).toBe('320');
            expect(requiredImage(host).getAttribute('height')).toBe('240');
            expect(host.querySelector('[data-safe-image=ready]')).toBeNull();
            await act(() => vi.advanceTimersByTimeAsync(15_000));
            expect(host.querySelector('[data-safe-image=timeout]')).not.toBeNull();
            expect(host.querySelector('[data-image-state=timeout]')).not.toBeNull();
            const image = requiredImage(host);
            Object.defineProperties(image, {
                complete: { value: true, configurable: true },
                naturalWidth: { value: 320, configurable: true },
                decode: { value: () => Promise.resolve(), configurable: true },
            });
            await act(async () => {
                image.dispatchEvent(new Event('load'));
                await Promise.resolve();
            });
            expect(host.querySelector('[data-safe-image=ready]')).not.toBeNull();
            await act(() => vi.advanceTimersByTimeAsync(15_000));
            expect(requiredImage(host)).toBe(image);
        } finally {
            act(() => root.unmount());
            vi.unstubAllGlobals();
            vi.useRealTimers();
        }
    });
    it('releases the stalled responsive image preload while keeping other preloads', async () => {
        vi.useFakeTimers();
        const host = document.createElement('div');
        const root = createRoot(host);
        const matching = document.createElement('link');
        const unrelated = document.createElement('link');
        matching.rel = unrelated.rel = 'preload';
        matching.setAttribute('as', 'image');
        unrelated.setAttribute('as', 'image');
        matching.href = '/default-preload.png';
        matching.setAttribute('imagesrcset', '/selected-preload.png 2x');
        unrelated.href = '/next-route.png';
        document.head.append(matching, unrelated);
        try {
            act(() =>
                root.render(
                    <SafeImage src="/small-preload.png" srcSet="/selected-preload.png 2x" alt="Product" />,
                ),
            );
            await act(async () => {
                await vi.advanceTimersByTimeAsync(30_000);
            });
            expect(matching.isConnected).toBe(false);
            expect(unrelated.isConnected).toBe(true);
            expect(host.querySelector('img')).toBeNull();
        } finally {
            act(() => root.unmount());
            matching.remove();
            unrelated.remove();
            vi.useRealTimers();
        }
    });

    it('shows a product-image message only after all image sources fail and clears it for a replacement', () => {
        const host = document.createElement('div');
        const root = createRoot(host);
        try {
            act(() =>
                root.render(
                    <SafeImage
                        src="/broken-product.png"
                        fallbackSrc="/backup-product.png"
                        alt="商品"
                        fallbackLabel="暂无商品图"
                    />,
                ),
            );
            expect(host.textContent).not.toContain('暂无商品图');
            act(() => {
                requiredImage(host).dispatchEvent(new Event('error'));
            });
            expect(host.textContent).not.toContain('暂无商品图');
            act(() => {
                requiredImage(host).dispatchEvent(new Event('error'));
            });
            expect(host.textContent).toContain('暂无商品图');
            expect(host.querySelector('[role=img]')?.getAttribute('aria-label')).toBe('商品 · 暂无商品图');

            act(() =>
                root.render(
                    <SafeImage src="/replacement-product.png" alt="商品" fallbackLabel="暂无商品图" />,
                ),
            );
            expect(host.textContent).not.toContain('暂无商品图');
            expect(requiredImage(host).getAttribute('src')).toBe('/replacement-product.png');
        } finally {
            act(() => root.unmount());
        }
    });

    it('keeps a failed thumbnail labelled for assistive technology', () => {
        const host = document.createElement('div');
        const root = createRoot(host);
        try {
            act(() =>
                root.render(
                    <SafeImage
                        src="/broken-thumbnail.png"
                        alt="订单商品"
                        fallbackLabel="暂无商品图"
                        imageKind="thumbnail"
                    />,
                ),
            );
            act(() => {
                requiredImage(host).dispatchEvent(new Event('error'));
            });
            expect(host.querySelector('.safe-image-fallback svg')).not.toBeNull();
            expect(host.querySelector('[role=img]')?.getAttribute('aria-label')).toBe(
                '订单商品 · 暂无商品图',
            );
        } finally {
            act(() => root.unmount());
        }
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
    it('confirms decoded readiness and recovers from a later native error', async () => {
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
    it.each(['card', 'detail', 'thumbnail', 'icon', 'hero'] as const)(
        'loads %s with a stable local placeholder and only the final image request',
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
            expect(markup).not.toContain('safe-image-preview');
            expect((markup.match(/<img /gu) ?? []).length).toBe(1);
            expect(markup).toContain('loading="lazy"');
            expect(markup).not.toContain('safe-image-preview-loading');
            expect(markup).toContain('srcSet=');
            expect(markup).toContain(imageKind === 'icon' ? 'q=82' : 'q=90');
            expect(markup).not.toContain('safe-image is-loaded');
        },
    );

    it('keeps explicit placeholders compatible without automatically requesting a hero preview', () => {
        const hero = renderToStaticMarkup(
            <SafeImage src="/assets/preview/banner.jpg" alt="Banner" imageKind="hero" />,
        );
        expect(hero).not.toContain('storefront-placeholder-wide-64');

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

    it('recovers once with a bounded WebP candidate without requesting an uploaded original', () => {
        const host = document.createElement('div');
        const root = createRoot(host);
        try {
            act(() =>
                root.render(
                    <SafeImage
                        src="/assets/preview/banner.jpg"
                        placeholderSrc="data:image/webp;base64,AAAA"
                        alt="Banner"
                        imageKind="hero"
                    />,
                ),
            );
            const image = requiredImage(host);
            act(() => {
                image.dispatchEvent(new Event('error'));
            });
            expect(image.getAttribute('srcset')).toBeNull();
            expect(image.getAttribute('src')).toContain('preset=storefront-hero-fit-960&format=webp&q=90');
            expect(host.querySelector<HTMLImageElement>('.safe-image-preview')?.src).toContain(
                'data:image/webp;base64,AAAA',
            );
            expect(host.querySelector('.safe-image-fallback svg')).toBeNull();
            act(() => {
                image.dispatchEvent(new Event('error'));
            });
            expect(host.querySelector('.safe-image-preview')).toBeNull();
            expect(host.querySelector('[data-safe-image=error]')).not.toBeNull();
            expect(host.querySelector('[data-image-state=error]')).not.toBeNull();
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

    it('checks a new node before reusing an already decoded resource', async () => {
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
            const remounted = requiredImage(host);
            expect(remounted).not.toBe(first);
            expect(host.querySelector('[data-safe-image=ready]')).toBeNull();
            Object.defineProperties(remounted, {
                complete: { configurable: true, value: true },
                naturalWidth: { configurable: true, value: 320 },
            });
            await act(async () => {
                remounted.dispatchEvent(new Event('load'));
                await Promise.resolve();
            });
            expect(host.querySelector('[data-safe-image=ready]')).not.toBeNull();
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
            await act(async () => {
                old.dispatchEvent(new Event('load'));
                await Promise.resolve();
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

    it('retains a natively painted candidate while decode is pending and the responsive source changes', () => {
        clearDecodedImageCache();
        const decode = vi
            .spyOn(HTMLImageElement.prototype, 'decode')
            .mockImplementation(() => new Promise<void>(() => undefined));
        const host = document.createElement('div');
        const root = createRoot(host);
        try {
            act(() =>
                root.render(<SafeImage src="/painted.webp" srcSet="/painted-small.webp 160w" alt="Cover" />),
            );
            const image = requiredImage(host);
            const painted = new URL('/painted-small.webp', location.href).href;
            Object.defineProperties(image, {
                complete: { configurable: true, value: true },
                naturalWidth: { configurable: true, value: 160 },
                currentSrc: { configurable: true, value: painted },
            });
            act(() => {
                image.dispatchEvent(new Event('load'));
            });
            expect(host.querySelector('[data-safe-image=ready]')).toBeNull();
            expect(isImageAlreadyDecoded(painted)).toBe(false);

            act(() =>
                root.render(<SafeImage src="/painted.webp" srcSet="/painted-large.webp 960w" alt="Cover" />),
            );
            expect(host.querySelector<HTMLElement>('.safe-image-fallback')?.style.backgroundImage).toContain(
                painted,
            );
            expect(host.querySelector('[data-safe-image=ready]')).toBeNull();
            expect(isImageAlreadyDecoded('/painted-large.webp')).toBe(false);
        } finally {
            act(() => root.unmount());
            decode.mockRestore();
            clearDecodedImageCache();
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

    it('does not retry a failed bounded recovery through an equivalent original fallback URL', () => {
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
            expect(image.getAttribute('src')).toContain('preset=storefront-detail-1200&format=webp&q=90');
            expect(host.querySelector('img')).toBeNull();
            expect(host.querySelector('[data-safe-image=error]')).not.toBeNull();
        } finally {
            act(() => root.unmount());
        }
    });
});
