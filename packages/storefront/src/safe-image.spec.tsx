// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { publicPageRequestKey } from '../../storefront-content-plugin/src/shared/public-page-data';
import {
    mediaDescriptor,
    type MediaDescriptor,
} from '../../storefront-content-plugin/src/shared/responsive-image';
import { syntheticPage } from '../e2e/seo-public/fixtures.mjs';

import { CustomerAvatar } from './components/common/customer-avatar';
import { IMAGE_WAIT_EXPIRED_EVENT } from './image-readiness';
import { storefrontQueryKeys } from './query-client';
import {
    clearDecodedImageCache,
    ImagePlaceholder,
    isImageAlreadyDecoded,
    SafeImageMediaProvider,
} from './safe-image';
import { seedPublicPage, type PublicPageData } from './storefront-page-data';
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

function requiredElement<T extends Element>(host: ParentNode, selector: string): T {
    const element = host.querySelector<T>(selector);
    expect(element).not.toBeNull();
    if (!element) throw new Error(`Expected an element matching ${selector}`);
    return element;
}

function completeCandidate(image: HTMLImageElement, candidate = image.src): void {
    Object.defineProperties(image, {
        complete: { configurable: true, value: true },
        naturalWidth: { configurable: true, value: 640 },
        naturalHeight: { configurable: true, value: 360 },
        currentSrc: { configurable: true, value: new URL(candidate, location.href).href },
    });
}

async function loadCandidate(image: HTMLImageElement, candidate = image.src): Promise<void> {
    completeCandidate(image, candidate);
    await act(async () => {
        image.dispatchEvent(new Event('load'));
        await Promise.resolve();
    });
}

async function failCandidate(image: HTMLImageElement): Promise<void> {
    await act(async () => {
        image.dispatchEvent(new Event('error'));
        await vi.dynamicImportSettled();
    });
}

function visibleFrameRect(top = 10, size = 180): DOMRect {
    return {
        x: 10,
        y: top,
        left: 10,
        top,
        right: 330,
        bottom: top + size,
        width: 320,
        height: size,
        toJSON: () => ({}),
    };
}

describe('SafeImage public presentation reuse', () => {
    it('returns to services with its query-owned inline artwork after home replaces media and decoded pixels are evicted', async () => {
        clearDecodedImageCache();
        const client = new QueryClient();
        const host = document.createElement('div');
        const root = createRoot(host);
        const hero = '/assets/preview/services-return.webp';
        const inline = 'data:image/webp;base64,AAAA';
        const services: PublicPageData = syntheticPage('synthetic-a', 'en', 'home');
        services.request = { kind: 'page', id: 'services' };
        services.media = [mediaDescriptor(hero, 'hero', { inlinePreview: inline })];
        const others = Array.from({ length: 129 }, (_, index) => `/assets/preview/eviction-${index}.webp`);
        const home: PublicPageData = {
            ...services,
            generatedAt: services.generatedAt + 1,
            request: { kind: 'home' },
            media: [mediaDescriptor(hero, 'hero'), ...others.map(source => mediaDescriptor(source))],
        };
        const scope = storefrontQueryKeys.scope('synthetic-a:MYR', 'en');
        const mediaFor = (page: PublicPageData) =>
            client.getQueryData<MediaDescriptor[]>([
                ...scope,
                'public-media',
                publicPageRequestKey(page.request ?? { kind: 'home' }),
            ]) ??
            client.getQueryData<MediaDescriptor[]>([...scope, 'public-media']) ??
            [];
        const render = (page: PublicPageData, sources = [hero]) => (
            <SafeImageMediaProvider scope="synthetic-a" media={mediaFor(page)}>
                {sources.map(source => (
                    <SafeImage
                        key={source}
                        src={source}
                        imageKind={source === hero ? 'hero' : undefined}
                        alt="Artwork"
                    />
                ))}
            </SafeImageMediaProvider>
        );
        try {
            seedPublicPage(client, services);
            act(() => root.render(render(services)));
            await loadCandidate(requiredElement<HTMLImageElement>(host, 'img.safe-image'));
            act(() => root.render(null));
            seedPublicPage(client, home);
            act(() => root.render(render(home, others)));
            await act(async () => {
                for (const image of host.querySelectorAll<HTMLImageElement>('img.safe-image')) {
                    completeCandidate(image);
                    image.dispatchEvent(new Event('load'));
                }
                await Promise.resolve();
            });
            expect(host.querySelectorAll('[data-safe-image=ready]')).toHaveLength(129);
            act(() => root.render(null));
            act(() => root.render(render(services)));
            expect(host.querySelector('.safe-image-frame.has-inline-preview')).not.toBeNull();
            expect(host.querySelector<HTMLImageElement>('img.safe-image-preview')?.getAttribute('src')).toBe(
                inline,
            );
            expect(host.querySelector<HTMLElement>('.safe-image-fallback')?.style.backgroundImage).toBe('');
            expect(host.querySelector('[data-safe-image=loading]')).not.toBeNull();
        } finally {
            act(() => root.unmount());
            client.clear();
            clearDecodedImageCache();
        }
    });
    it('reuses public pixels with the current frame crop instead of the previous route crop', async () => {
        clearDecodedImageCache();
        const host = document.createElement('div');
        const root = createRoot(host);
        const src = '/public-shared-crop.webp';
        const render = (objectFit: 'cover' | 'contain', objectPosition: string) => (
            <SafeImageMediaProvider scope="moyao" media={[mediaDescriptor(src, 'hero')]}>
                <SafeImage
                    src={src}
                    imageKind="hero"
                    alt="Shared banner"
                    style={{ objectFit, objectPosition }}
                />
            </SafeImageMediaProvider>
        );
        try {
            act(() => root.render(render('cover', 'right center')));
            await loadCandidate(requiredImage(host));
            act(() => root.render(null));
            act(() => root.render(render('contain', 'left bottom')));
            const backing = host.querySelector<HTMLElement>('.safe-image-fallback');
            expect(backing?.style.backgroundImage).toContain(src);
            expect(backing?.style.backgroundSize).toBe('contain');
            expect(backing?.style.backgroundPosition).toBe('left bottom');
            expect(host.querySelector('[data-safe-image=loading]')).not.toBeNull();
        } finally {
            act(() => root.unmount());
            clearDecodedImageCache();
        }
    });

    it('keeps the old crop for a source replacement while fitting inline previews to their own current frame', async () => {
        clearDecodedImageCache();
        const host = document.createElement('div');
        const root = createRoot(host);
        const original = '/public-original-crop.webp';
        const next = '/public-next-crop.webp';
        const render = (src: string, objectFit: 'cover' | 'contain', objectPosition: string) => (
            <SafeImageMediaProvider
                scope="moyao"
                media={[
                    mediaDescriptor(original, 'hero'),
                    mediaDescriptor(next, 'hero', { inlinePreview: 'data:image/webp;base64,cHJldmlldw==' }),
                ]}
            >
                <SafeImage src={src} imageKind="hero" alt="Banner" style={{ objectFit, objectPosition }} />
            </SafeImageMediaProvider>
        );
        try {
            act(() => root.render(render(original, 'cover', 'right center')));
            await loadCandidate(requiredImage(host));
            act(() => root.render(render(next, 'contain', 'left bottom')));
            const backing = host.querySelector<HTMLElement>('.safe-image-fallback');
            expect(backing?.style.backgroundImage).toContain(original);
            expect(backing?.style.backgroundSize).toBe('cover');
            expect(backing?.style.backgroundPosition).toBe('right center');
            act(() => root.render(null));
            act(() => root.render(render(next, 'cover', 'left bottom')));
            const preview = host.querySelector<HTMLImageElement>('img.safe-image-preview');
            expect(preview?.style.objectFit).toBe('cover');
            expect(preview?.style.objectPosition).toBe('left bottom');
        } finally {
            act(() => root.unmount());
            clearDecodedImageCache();
        }
    });

    it('updates cached backing artwork when native art direction changes before the next image load', async () => {
        clearDecodedImageCache();
        let mobileViewport = false;
        const changes = new Set<() => void>();
        vi.stubGlobal(
            'matchMedia',
            vi.fn(() => ({
                get matches() {
                    return mobileViewport;
                },
                addEventListener: (_: string, callback: () => void) => changes.add(callback),
                removeEventListener: (_: string, callback: () => void) => changes.delete(callback),
            })),
        );
        const host = document.createElement('div');
        const root = createRoot(host);
        const desktop = '/crop-resize-desktop.webp';
        const mobile = '/crop-resize-mobile.webp';
        const render = () => (
            <SafeImageMediaProvider
                scope="moyao"
                media={[mediaDescriptor(desktop, 'hero'), mediaDescriptor(mobile, 'hero')]}
            >
                <SafeImage
                    src={desktop}
                    imageKind="hero"
                    alt="Responsive banner"
                    mediaSources={[{ media: '(max-width: 767px)', src: mobile }]}
                />
            </SafeImageMediaProvider>
        );
        try {
            for (const viewport of [false, true]) {
                mobileViewport = viewport;
                act(() => root.render(render()));
                await loadCandidate(requiredImage(host), viewport ? mobile : desktop);
                act(() => root.render(null));
            }
            mobileViewport = false;
            act(() => root.render(render()));
            expect(host.querySelector<HTMLElement>('.safe-image-fallback')?.style.backgroundImage).toContain(
                desktop,
            );
            act(() => {
                mobileViewport = true;
                changes.forEach(change => change());
            });
            const background = host.querySelector<HTMLElement>('.safe-image-fallback')?.style.backgroundImage;
            expect(background).toContain(mobile);
            expect(background).not.toContain(desktop);
            expect(host.querySelector('[data-safe-image=loading]')).not.toBeNull();
        } finally {
            act(() => root.unmount());
            vi.unstubAllGlobals();
            clearDecodedImageCache();
        }
    });

    it('keeps an admitted replacement backing after load until paint without marking a pending decode ready', async () => {
        clearDecodedImageCache();
        const frames = new Map<number, FrameRequestCallback>();
        let nextFrame = 0;
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            frames.set(++nextFrame, callback);
            return nextFrame;
        });
        vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame));
        const advanceFrame = () => {
            const callbacks = [...frames.values()];
            frames.clear();
            act(() => callbacks.forEach(callback => callback(16)));
        };
        let finishDecode!: () => void;
        const decode = vi
            .spyOn(HTMLImageElement.prototype, 'decode')
            .mockResolvedValueOnce(undefined)
            .mockImplementation(() => new Promise<void>(resolve => (finishDecode = resolve)));
        const host = document.createElement('div');
        const root = createRoot(host);
        const render = (src: string, scope = 'moyao') => (
            <SafeImageMediaProvider scope={scope}>
                <SafeImage
                    src={src}
                    alt="Replacement"
                    style={{ objectFit: 'cover', objectPosition: 'right center' }}
                />
            </SafeImageMediaProvider>
        );
        try {
            act(() => root.render(render('/admitted-original.webp')));
            await loadCandidate(requiredImage(host));
            act(() => root.render(render('/admitted-next.webp')));
            await loadCandidate(requiredImage(host));
            const backing = host.querySelector<HTMLElement>('.safe-image-fallback');
            expect(backing?.style.backgroundImage).toContain('/admitted-original.webp');
            expect(backing?.style.backgroundSize).toBe('cover');
            expect(backing?.style.backgroundPosition).toBe('right center');
            expect(host.querySelector('[data-safe-image=loading]')).not.toBeNull();
            expect(host.querySelector('.safe-image-frame.is-painted')).toBeNull();
            advanceFrame();
            expect(backing?.style.backgroundImage).toContain('/admitted-original.webp');
            expect(host.querySelector('.safe-image-frame.is-painted')).toBeNull();
            advanceFrame();
            expect(host.querySelector('.safe-image-frame.is-painted')).not.toBeNull();
            expect(host.querySelector('[data-safe-image=loading]')).not.toBeNull();
            await act(async () => {
                finishDecode();
                await Promise.resolve();
            });
            expect(host.querySelector('[data-safe-image=ready]')).not.toBeNull();
            act(() => root.render(render('/admitted-third.webp', 'other-store')));
            expect(host.querySelector<HTMLElement>('.safe-image-fallback')?.style.backgroundImage).toBe('');
        } finally {
            act(() => root.unmount());
            decode.mockRestore();
            vi.unstubAllGlobals();
            clearDecodedImageCache();
        }
    });

    it('keeps a painted candidate painted across a breakpoint whose artwork URL is unchanged', async () => {
        clearDecodedImageCache();
        let mobileViewport = false;
        const changes = new Set<() => void>();
        vi.stubGlobal(
            'matchMedia',
            vi.fn(() => ({
                get matches() {
                    return mobileViewport;
                },
                addEventListener: (_: string, callback: () => void) => changes.add(callback),
                removeEventListener: (_: string, callback: () => void) => changes.delete(callback),
            })),
        );
        const frames = new Map<number, FrameRequestCallback>();
        let nextFrame = 0;
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            frames.set(++nextFrame, callback);
            return nextFrame;
        });
        vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame));
        const advanceFrame = () => {
            const callbacks = [...frames.values()];
            frames.clear();
            act(() => callbacks.forEach(callback => callback(16)));
        };
        const host = document.createElement('div');
        const root = createRoot(host);
        const src = '/same-breakpoint-artwork.webp';
        const onImageReady = vi.fn();
        try {
            act(() =>
                root.render(
                    <SafeImageMediaProvider scope="moyao" media={[mediaDescriptor(src, 'hero')]}>
                        <SafeImage
                            src={src}
                            imageKind="hero"
                            alt="Shared artwork"
                            onImageReady={onImageReady}
                            mediaSources={[{ media: '(max-width: 767px)', src }]}
                        />
                    </SafeImageMediaProvider>,
                ),
            );
            await loadCandidate(requiredImage(host));
            advanceFrame();
            advanceFrame();
            expect(host.querySelector('.safe-image-frame.is-painted')).not.toBeNull();
            act(() => {
                mobileViewport = true;
                changes.forEach(change => change());
            });
            expect(host.querySelector('.safe-image-frame.is-painted')).not.toBeNull();
            expect(host.querySelector('[data-safe-image=ready]')).not.toBeNull();
            expect(onImageReady).toHaveBeenCalledTimes(1);
        } finally {
            act(() => root.unmount());
            vi.unstubAllGlobals();
            clearDecodedImageCache();
        }
    });

    it('keeps a decoded public image behind a genuinely remounted node without marking that node ready', async () => {
        clearDecodedImageCache();
        const host = document.createElement('div');
        const root = createRoot(host);
        const src = '/public-remount.webp?v=one';
        const media = [mediaDescriptor(src, 'hero')];
        const onImageReady = vi.fn();
        let finishDecode!: () => void;
        const decode = vi.spyOn(HTMLImageElement.prototype, 'decode').mockResolvedValueOnce(undefined);
        const render = () => (
            <SafeImageMediaProvider scope="moyao" media={media}>
                <SafeImage src={src} imageKind="hero" alt="Public banner" onImageReady={onImageReady} />
            </SafeImageMediaProvider>
        );
        try {
            act(() => root.render(render()));
            const first = requiredImage(host);
            await loadCandidate(first);
            expect(onImageReady).toHaveBeenCalledTimes(1);
            act(() => root.render(null));
            expect(host.querySelector('img')).toBeNull();

            decode.mockImplementation(() => new Promise<void>(resolve => (finishDecode = resolve)));
            act(() => root.render(render()));
            const next = requiredImage(host);
            expect(next).not.toBe(first);
            expect(host.querySelector<HTMLElement>('.safe-image-fallback')?.style.backgroundImage).toContain(
                src,
            );
            expect(host.querySelector('[data-safe-image=loading]')).not.toBeNull();
            expect(host.querySelector('[data-safe-image=ready]')).toBeNull();
            await loadCandidate(next);
            expect(host.querySelector('[data-safe-image=loading]')).not.toBeNull();
            expect(onImageReady).toHaveBeenCalledTimes(1);
            await act(async () => {
                finishDecode();
                await Promise.resolve();
            });
            expect(host.querySelector('[data-safe-image=ready]')).not.toBeNull();
            expect(onImageReady).toHaveBeenLastCalledWith(next);
            expect(onImageReady).toHaveBeenCalledTimes(2);
        } finally {
            act(() => root.unmount());
            decode.mockRestore();
            clearDecodedImageCache();
        }
    });

    it('isolates public reuse by confirmed scope, content version and current public membership', async () => {
        clearDecodedImageCache();
        const host = document.createElement('div');
        const root = createRoot(host);
        const src = '/public-isolation.webp?v=one';
        const known = mediaDescriptor(src, 'hero');
        const render = (scope: string | undefined, source = src, media = [known]) => (
            <SafeImageMediaProvider scope={scope} media={media}>
                <SafeImage src={source} imageKind="hero" alt="Public banner" />
            </SafeImageMediaProvider>
        );
        try {
            act(() => root.render(render('moyao')));
            await loadCandidate(requiredImage(host));
            for (const element of [
                render('other-store'),
                render(undefined),
                render('moyao', '/public-isolation.webp?v=two', [
                    mediaDescriptor('/public-isolation.webp?v=two', 'hero'),
                ]),
                render('moyao', src, []),
                render('moyao', src, [{ ...known, version: 'stale-version' }]),
            ]) {
                act(() => root.render(null));
                act(() => root.render(element));
                expect(host.querySelector<HTMLElement>('.safe-image-fallback')?.style.backgroundImage).toBe(
                    '',
                );
                expect(host.querySelector('[data-safe-image=loading]')).not.toBeNull();
            }

            const undisclosed = '/public-not-in-the-current-manifest.webp';
            act(() => root.render(null));
            act(() => root.render(render('moyao', undisclosed, [])));
            await loadCandidate(requiredImage(host));
            act(() => root.render(null));
            act(() => root.render(render('moyao', undisclosed, [mediaDescriptor(undisclosed, 'hero')])));
            expect(host.querySelector<HTMLElement>('.safe-image-fallback')?.style.backgroundImage).toBe('');
            expect(host.querySelector('[data-safe-image=loading]')).not.toBeNull();
        } finally {
            act(() => root.unmount());
            clearDecodedImageCache();
        }
    });

    it('keeps native mobile and desktop artwork separate, including a viewport change before load', async () => {
        clearDecodedImageCache();
        let mobileViewport = false;
        vi.stubGlobal(
            'matchMedia',
            vi.fn(() => ({ matches: mobileViewport })),
        );
        const host = document.createElement('div');
        const root = createRoot(host);
        const desktop = '/public-art-desktop.webp?v=one';
        const mobile = '/public-art-mobile.webp?v=one';
        const media = [mediaDescriptor(desktop, 'hero'), mediaDescriptor(mobile, 'hero')];
        const render = () => (
            <SafeImageMediaProvider scope="moyao" media={media}>
                <SafeImage
                    src={desktop}
                    imageKind="hero"
                    alt="Responsive banner"
                    mediaSources={[{ media: '(max-width: 767px)', src: mobile }]}
                />
            </SafeImageMediaProvider>
        );
        try {
            act(() => root.render(render()));
            mobileViewport = true;
            await loadCandidate(requiredImage(host), mobile);
            act(() => root.render(null));

            mobileViewport = false;
            act(() => root.render(render()));
            expect(host.querySelector<HTMLElement>('.safe-image-fallback')?.style.backgroundImage).toBe('');
            await loadCandidate(requiredImage(host), desktop);
            act(() => root.render(null));

            mobileViewport = true;
            act(() => root.render(render()));
            const mobileBackground =
                host.querySelector<HTMLElement>('.safe-image-fallback')?.style.backgroundImage;
            expect(mobileBackground).toContain(mobile);
            expect(mobileBackground).not.toContain(desktop);
            expect(host.querySelector('[data-safe-image=loading]')).not.toBeNull();
            act(() => root.render(null));

            mobileViewport = false;
            act(() => root.render(render()));
            const desktopBackground =
                host.querySelector<HTMLElement>('.safe-image-fallback')?.style.backgroundImage;
            expect(desktopBackground).toContain(desktop);
            expect(desktopBackground).not.toContain(mobile);
        } finally {
            act(() => root.unmount());
            vi.unstubAllGlobals();
            clearDecodedImageCache();
        }
    });

    it('uses inline native art-direction previews without extra HTTP preview candidates', () => {
        clearDecodedImageCache();
        const host = document.createElement('div');
        const root = createRoot(host);
        const desktop = '/inline-art-desktop.webp';
        const mobile = '/inline-art-mobile.webp';
        const desktopPreview = 'data:image/webp;base64,ZGVza3RvcA==';
        const mobilePreview = 'data:image/webp;base64,bW9iaWxl';
        try {
            act(() =>
                root.render(
                    <SafeImageMediaProvider
                        scope="moyao"
                        media={[
                            mediaDescriptor(desktop, 'hero', { inlinePreview: desktopPreview }),
                            mediaDescriptor(mobile, 'hero', { inlinePreview: mobilePreview }),
                        ]}
                    >
                        <SafeImage
                            src={desktop}
                            imageKind="hero"
                            alt="Inline artwork"
                            fetchPriority="auto"
                            mediaSources={[{ media: '(max-width: 767px)', src: mobile }]}
                        />
                    </SafeImageMediaProvider>,
                ),
            );
            const preview = host.querySelector<HTMLImageElement>('img.safe-image-preview');
            expect(preview?.getAttribute('src')).toBe(desktopPreview);
            expect(preview?.closest('picture')?.querySelector('source')?.getAttribute('media')).toBe(
                '(max-width: 767px)',
            );
            expect(preview?.closest('picture')?.querySelector('source')?.getAttribute('srcset')).toBe(
                mobilePreview,
            );
            const networkCandidates = Array.from(host.querySelectorAll('img, source'))
                .flatMap(node => [node.getAttribute('src'), node.getAttribute('srcset')])
                .filter((source): source is string => Boolean(source && !source.startsWith('data:')));
            expect(networkCandidates.sort()).toEqual([desktop, mobile].sort());
            expect(host.querySelector('.safe-image-frame.has-inline-preview')).not.toBeNull();
        } finally {
            act(() => root.unmount());
            clearDecodedImageCache();
        }
    });

    it('does not share a failed decode or a decode completed after its source was replaced', async () => {
        clearDecodedImageCache();
        const host = document.createElement('div');
        const root = createRoot(host);
        const failed = '/public-decode-failed.webp';
        const old = '/public-decode-replaced.webp';
        const next = '/public-decode-next.webp';
        const media = [failed, old, next].map(source => mediaDescriptor(source, 'hero'));
        const render = (source: string) => (
            <SafeImageMediaProvider scope="moyao" media={media}>
                <SafeImage src={source} imageKind="hero" alt="Public banner" />
            </SafeImageMediaProvider>
        );
        let finishDecode!: () => void;
        const decode = vi
            .spyOn(HTMLImageElement.prototype, 'decode')
            .mockRejectedValue(new Error('decode failed'));
        try {
            act(() => root.render(render(failed)));
            await loadCandidate(requiredImage(host));
            expect(host.querySelector('[data-safe-image=error]')).not.toBeNull();
            expect(isImageAlreadyDecoded(new URL(failed, location.href).href)).toBe(false);
            act(() => root.render(null));
            act(() => root.render(render(failed)));
            expect(host.querySelector<HTMLElement>('.safe-image-fallback')?.style.backgroundImage).toBe('');

            decode.mockImplementation(() => new Promise<void>(resolve => (finishDecode = resolve)));
            act(() => root.render(render(old)));
            await loadCandidate(requiredImage(host));
            act(() => root.render(render(next)));
            await act(async () => {
                finishDecode();
                await Promise.resolve();
            });
            expect(isImageAlreadyDecoded(new URL(old, location.href).href)).toBe(false);
            for (const source of [old, next]) {
                act(() => root.render(null));
                act(() => root.render(render(source)));
                expect(host.querySelector<HTMLElement>('.safe-image-fallback')?.style.backgroundImage).toBe(
                    '',
                );
                expect(host.querySelector('[data-safe-image=loading]')).not.toBeNull();
            }
        } finally {
            act(() => root.unmount());
            decode.mockRestore();
            clearDecodedImageCache();
        }
    });

    it('bounds shared presentations at 128 entries and clears both presentations and decode bookkeeping', async () => {
        clearDecodedImageCache();
        const host = document.createElement('div');
        const root = createRoot(host);
        const sources = Array.from({ length: 129 }, (_, index) => `/public-bounded-${index}.webp`);
        const media = sources.map(source => mediaDescriptor(source));
        const render = (selected = sources) => (
            <SafeImageMediaProvider scope="moyao" media={media}>
                {selected.map(source => (
                    <SafeImage key={source} src={source} alt="Public image" />
                ))}
            </SafeImageMediaProvider>
        );
        try {
            act(() => root.render(render()));
            await act(async () => {
                for (const image of host.querySelectorAll<HTMLImageElement>('img.safe-image')) {
                    completeCandidate(image);
                    image.dispatchEvent(new Event('load'));
                }
                await Promise.resolve();
            });
            expect(host.querySelectorAll('[data-safe-image=ready]')).toHaveLength(129);
            act(() => root.render(null));
            act(() => root.render(render([sources[0]])));
            expect(host.querySelector<HTMLElement>('.safe-image-fallback')?.style.backgroundImage).toBe('');
            for (const source of [sources[1], sources[128]]) {
                act(() => root.render(null));
                act(() => root.render(render([source])));
                expect(
                    host.querySelector<HTMLElement>('.safe-image-fallback')?.style.backgroundImage,
                ).toContain(source);
            }
            expect(isImageAlreadyDecoded(new URL(sources[128], location.href).href)).toBe(true);
            clearDecodedImageCache();
            act(() => root.render(null));
            act(() => root.render(render([sources[128]])));
            expect(host.querySelector<HTMLElement>('.safe-image-fallback')?.style.backgroundImage).toBe('');
            expect(isImageAlreadyDecoded(new URL(sources[128], location.href).href)).toBe(false);
        } finally {
            act(() => root.unmount());
            clearDecodedImageCache();
        }
    });

    it('keeps backing artwork through a paint opportunity while decode readiness remains immediate', async () => {
        clearDecodedImageCache();
        let nextFrame = 0;
        const frames = new Map<number, FrameRequestCallback>();
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            frames.set(++nextFrame, callback);
            return nextFrame;
        });
        vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame));
        const host = document.createElement('div');
        const root = createRoot(host);
        const src = '/public-handoff.webp';
        const onImageReady = vi.fn();
        const advanceFrame = () => {
            const callbacks = [...frames.values()];
            frames.clear();
            act(() => callbacks.forEach(callback => callback(16)));
        };
        try {
            act(() =>
                root.render(
                    <SafeImageMediaProvider
                        scope="moyao"
                        media={[
                            mediaDescriptor(src, 'hero', {
                                inlinePreview: 'data:image/webp;base64,cHJldmlldw==',
                            }),
                        ]}
                    >
                        <SafeImage src={src} imageKind="hero" alt="Handoff" onImageReady={onImageReady} />
                    </SafeImageMediaProvider>,
                ),
            );
            await loadCandidate(requiredImage(host));
            expect(onImageReady).toHaveBeenCalledTimes(1);
            expect(host.querySelector('[data-safe-image=ready]')).not.toBeNull();
            expect(host.querySelector('.safe-image-frame.is-presented')).not.toBeNull();
            expect(host.querySelector('.safe-image-frame.is-painted')).toBeNull();
            advanceFrame();
            expect(host.querySelector('.safe-image-frame.is-painted')).toBeNull();
            const backing = host.querySelector<HTMLElement>(
                '.safe-image-frame:not(.is-painted) .safe-image-fallback',
            );
            expect(backing).not.toBeNull();
            expect(backing?.style.backgroundImage).toContain(src);
            advanceFrame();
            expect(host.querySelector('.safe-image-frame.is-painted')).not.toBeNull();
            expect(onImageReady).toHaveBeenCalledTimes(1);
        } finally {
            act(() => root.unmount());
            vi.unstubAllGlobals();
            clearDecodedImageCache();
        }
    });
});

describe('SafeImage', () => {
    it('retries only its failed native node, preserves the frame and waits for a real decode again', async () => {
        const rect = vi
            .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
            .mockReturnValue(visibleFrameRect());
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        const onImageReady = vi.fn();
        const parentClick = vi.fn();
        let finishDecode!: () => void;
        const decode = vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementation(
            () =>
                new Promise<void>(resolve => {
                    finishDecode = resolve;
                }),
        );
        try {
            act(() =>
                root.render(
                    <div onClick={parentClick}>
                        <SafeImage
                            src="/retry-native.jpg"
                            alt="商品主图"
                            width={640}
                            height={360}
                            onImageReady={onImageReady}
                        />
                    </div>,
                ),
            );
            const first = requiredImage(host);
            vi.spyOn(first, 'getBoundingClientRect').mockReturnValue({ height: 360 } as DOMRect);
            await failCandidate(first);
            const frame = requiredElement<HTMLElement>(host, '.safe-image-frame');
            const retry = requiredElement<HTMLButtonElement>(host, '.safe-image-retry');
            expect(frame.style.minHeight).toBe('360px');
            expect(retry.type).toBe('button');
            expect(retry.tabIndex).toBe(0);
            expect(retry.getAttribute('aria-label')).toContain('商品主图');
            retry.focus();
            act(() => {
                retry.click();
                retry.click();
            });
            expect(parentClick).not.toHaveBeenCalled();
            expect(document.activeElement).toBe(frame);
            const replacement = requiredImage(host);
            expect(replacement).not.toBe(first);
            expect(replacement.getAttribute('src')).toBe('/retry-native.jpg');
            expect(replacement.width).toBe(640);
            expect(replacement.height).toBe(360);
            expect(host.querySelector('[data-safe-image=loading]')).not.toBeNull();
            expect(host.querySelector('[data-safe-image=ready]')).toBeNull();
            completeCandidate(replacement);
            act(() => {
                replacement.dispatchEvent(new Event('load'));
            });
            expect(host.querySelector('[data-safe-image=ready]')).toBeNull();
            expect(onImageReady).not.toHaveBeenCalled();
            await act(async () => {
                finishDecode();
                await Promise.resolve();
            });
            expect(host.querySelector('[data-safe-image=ready]')).not.toBeNull();
            expect(onImageReady).toHaveBeenCalledExactlyOnceWith(replacement);
        } finally {
            act(() => root.unmount());
            host.remove();
            decode.mockRestore();
            rect.mockRestore();
            clearDecodedImageCache();
        }
    });

    it('bounds repeated manual clicks with a cooldown, then allows later local recovery without a permanent lockout', async () => {
        vi.useFakeTimers();
        const rect = vi
            .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
            .mockReturnValue(visibleFrameRect());
        const host = document.createElement('div');
        const root = createRoot(host);
        const render = (className = '') => (
            <SafeImage src="/retry-bounded.jpg" alt="Image" className={className} />
        );
        try {
            act(() => root.render(render()));
            for (let attempt = 0; attempt < 4; attempt += 1) {
                await failCandidate(requiredImage(host));
                expect(host.querySelector('[data-safe-image=error]')).not.toBeNull();
                const retry = host.querySelector<HTMLButtonElement>('.safe-image-retry');
                expect(retry).not.toBeNull();
                if (!retry) throw new Error('Expected the failed image retry control');
                expect(retry.disabled).toBe(attempt > 0);
                if (attempt > 0) {
                    act(() => retry.click());
                    expect(host.querySelector('[data-safe-image=error]')).not.toBeNull();
                    act(() => {
                        vi.advanceTimersByTime(1_000);
                    });
                }
                act(() => retry.click());
                expect(host.querySelector('[data-safe-image=loading]')).not.toBeNull();
            }
            await failCandidate(requiredImage(host));
            act(() => root.render(render('unchanged-source')));
            expect(host.querySelector('[data-safe-image=error]')).not.toBeNull();
            expect(requiredElement<HTMLButtonElement>(host, '.safe-image-retry').disabled).toBe(true);
            act(() => {
                vi.advanceTimersByTime(1_000);
            });
            expect(requiredElement<HTMLButtonElement>(host, '.safe-image-retry').disabled).toBe(false);
        } finally {
            act(() => root.unmount());
            rect.mockRestore();
            vi.useRealTimers();
        }
    });

    it.each(['link', 'button', 'thumbnail', 'icon'] as const)(
        'does not nest another control inside %s media and reconnects the failed image only once',
        async kind => {
            const rect = vi
                .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
                .mockReturnValue(visibleFrameRect());
            const host = document.createElement('div');
            const root = createRoot(host);
            const image = (
                <SafeImage
                    src="/retry-interactive.jpg"
                    alt="Image"
                    imageKind={kind === 'thumbnail' || kind === 'icon' ? kind : undefined}
                />
            );
            const view =
                kind === 'link' ? (
                    <a href="/product/1">{image}</a>
                ) : kind === 'button' ? (
                    <button type="button">{image}</button>
                ) : (
                    image
                );
            const fail = async () => {
                // Compact responsive media first uses its existing bounded recovery candidate.
                for (let index = 0; index < 3 && host.querySelector('img.safe-image'); index += 1)
                    await failCandidate(requiredImage(host));
            };
            try {
                act(() => root.render(view));
                await fail();
                expect(host.querySelector('[data-safe-image=error]')).not.toBeNull();
                const retry = requiredElement<HTMLButtonElement>(host, '.safe-image-retry');
                expect(retry.hidden).toBe(false);
                expect(retry.closest('a')).toBeNull();
                expect(retry.parentElement?.closest('button')).toBeNull();
                act(() => {
                    window.dispatchEvent(new Event('online'));
                });
                expect(host.querySelector('[data-safe-image=loading]')).not.toBeNull();
                expect(requiredImage(host).getAttribute('src')).not.toContain('retry=');
                await fail();
                expect(host.querySelector('[data-safe-image=error]')).not.toBeNull();
                act(() => {
                    window.dispatchEvent(new Event('online'));
                });
                expect(host.querySelector('img.safe-image')).toBeNull();
                expect(host.querySelector('[data-safe-image=error]')).not.toBeNull();
            } finally {
                act(() => root.unmount());
                rect.mockRestore();
            }
        },
    );

    it('resets recovery allowance for a new owner without replaying the previous owner online listener', async () => {
        const rect = vi
            .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
            .mockReturnValue(visibleFrameRect());
        const host = document.createElement('div');
        const root = createRoot(host);
        const render = (owner: string, scope = 'store-one') => (
            <SafeImageMediaProvider scope={scope}>
                <SafeImage src="/owner-retry.jpg" retainedOwnerKey={owner} alt="Avatar" />
            </SafeImageMediaProvider>
        );
        const fail = () => failCandidate(requiredImage(host));
        try {
            act(() => root.render(render('customer-one')));
            await fail();
            act(() => {
                window.dispatchEvent(new Event('online'));
            });
            await fail();
            expect(host.querySelector('[data-safe-image=error]')).not.toBeNull();
            act(() => root.render(render('customer-two')));
            const second = requiredImage(host);
            act(() => {
                window.dispatchEvent(new Event('online'));
            });
            expect(requiredImage(host)).toBe(second);
            await fail();
            act(() => {
                window.dispatchEvent(new Event('online'));
            });
            expect(requiredImage(host)).not.toBe(second);
            act(() => root.render(render('customer-two', 'store-two')));
            await fail();
            act(() => {
                window.dispatchEvent(new Event('online'));
            });
            expect(host.querySelector('[data-safe-image=loading]')).not.toBeNull();
        } finally {
            act(() => root.unmount());
            rect.mockRestore();
            clearDecodedImageCache();
        }
    });

    it('keeps a linked image retry inside its dialog, preserves the link action and removes the portal on unmount', async () => {
        const rect = vi
            .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
            .mockReturnValue(visibleFrameRect());
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        const navigate = vi.fn();
        try {
            act(() =>
                root.render(
                    <div role="dialog" aria-modal="true" aria-label="商品预览">
                        <a
                            href="/product/one"
                            onClick={event => {
                                event.preventDefault();
                                navigate();
                            }}
                        >
                            <SafeImage src="/dialog-retry.jpg" alt="预览图片" />
                        </a>
                    </div>,
                ),
            );
            await failCandidate(requiredImage(host));
            const retry = requiredElement<HTMLButtonElement>(host, '.safe-image-retry');
            const link = requiredElement<HTMLAnchorElement>(host, 'a');
            expect(retry.parentElement?.getAttribute('role')).toBe('dialog');
            expect(link.contains(retry)).toBe(false);
            expect(retry.style.position).not.toBe('fixed');
            expect(retry.style.left).not.toBe('');
            retry.focus();
            act(() => retry.click());
            expect(navigate).not.toHaveBeenCalled();
            expect(document.activeElement).toBe(link);
            expect(link.getAttribute('href')).toBe('/product/one');
            act(() => link.click());
            expect(navigate).toHaveBeenCalledTimes(1);
        } finally {
            act(() => root.unmount());
            expect(host.querySelector('.safe-image-retry')).toBeNull();
            act(() => {
                window.dispatchEvent(new Event('online'));
                window.dispatchEvent(new Event('scroll'));
            });
            host.remove();
            rect.mockRestore();
        }
    });

    it('does not reconnect offscreen or hidden failures and hides the local control as the frame leaves view', async () => {
        let top = 900;
        const rect = vi
            .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
            .mockImplementation(() => visibleFrameRect(top));
        const host = document.createElement('div');
        const root = createRoot(host);
        const render = (hidden = false) => (
            <div aria-hidden={hidden || undefined}>
                <SafeImage src="/visible-reconnect.jpg" alt="Image" />
            </div>
        );
        try {
            act(() => root.render(render()));
            await failCandidate(requiredImage(host));
            expect(requiredElement<HTMLButtonElement>(host, '.safe-image-retry').hidden).toBe(true);
            act(() => {
                window.dispatchEvent(new Event('online'));
            });
            expect(host.querySelector('[data-safe-image=error]')).not.toBeNull();
            top = 10;
            act(() => {
                window.dispatchEvent(new Event('resize'));
            });
            expect(requiredElement<HTMLButtonElement>(host, '.safe-image-retry').hidden).toBe(false);
            top = -200;
            act(() => {
                window.dispatchEvent(new Event('scroll'));
            });
            expect(requiredElement<HTMLButtonElement>(host, '.safe-image-retry').hidden).toBe(true);
            top = 10;
            act(() => root.render(render(true)));
            act(() => {
                window.dispatchEvent(new Event('online'));
            });
            expect(host.querySelector('[data-safe-image=error]')).not.toBeNull();
            act(() => root.render(render()));
            act(() => {
                window.dispatchEvent(new Event('online'));
            });
            expect(host.querySelector('[data-safe-image=loading]')).not.toBeNull();
        } finally {
            act(() => root.unmount());
            rect.mockRestore();
        }
    });

    it('keeps a tiny decorative frame free of an overlapping manual control', async () => {
        const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
            ...visibleFrameRect(),
            right: 42,
            bottom: 42,
            width: 32,
            height: 32,
        });
        const host = document.createElement('div');
        const root = createRoot(host);
        try {
            act(() => root.render(<SafeImage src="/tiny-retry.jpg" alt="小图标" />));
            await failCandidate(requiredImage(host));
            expect(requiredElement<HTMLButtonElement>(host, '.safe-image-retry').hidden).toBe(true);
            act(() => {
                window.dispatchEvent(new Event('online'));
            });
            expect(host.querySelector('[data-safe-image=loading]')).not.toBeNull();
        } finally {
            act(() => root.unmount());
            rect.mockRestore();
        }
    });

    it.each([true, 'true'] as const)(
        'does not add a recovery control to aria-hidden=%s artwork',
        async hidden => {
            const rect = vi
                .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
                .mockReturnValue(visibleFrameRect());
            const host = document.createElement('div');
            const root = createRoot(host);
            try {
                act(() => root.render(<SafeImage src="/hidden-artwork.jpg" alt="" aria-hidden={hidden} />));
                await failCandidate(requiredImage(host));
                expect(host.querySelector('[data-safe-image=error]')).not.toBeNull();
                expect(host.querySelector('.safe-image-retry')).toBeNull();
            } finally {
                act(() => root.unmount());
                rect.mockRestore();
            }
        },
    );

    it.each(['mount', 'hydrate'] as const)(
        'recovers an already completed zero-pixel failure during %s without waiting for another error event',
        async mode => {
            clearDecodedImageCache();
            const complete = vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
            const decode = vi.spyOn(HTMLImageElement.prototype, 'decode');
            const host = document.createElement('div');
            const onImageReady = vi.fn();
            const element = (
                <SafeImage
                    src="/completed-before-listeners.webp"
                    alt="Failed banner"
                    onImageReady={onImageReady}
                />
            );
            if (mode === 'hydrate') host.innerHTML = renderToStaticMarkup(element);
            let root!: ReturnType<typeof createRoot>;
            try {
                await act(async () => {
                    if (mode === 'hydrate') root = hydrateRoot(host, element);
                    else {
                        root = createRoot(host);
                        root.render(element);
                    }
                    await Promise.resolve();
                });
                expect(host.querySelector('[data-safe-image=error]')).not.toBeNull();
                expect(host.querySelector('[data-image-state=error]')).not.toBeNull();
                expect(host.querySelector('[data-safe-image=loading]')).toBeNull();
                expect(host.querySelector('[data-safe-image=timeout]')).toBeNull();
                expect(onImageReady).not.toHaveBeenCalled();
                expect(decode).not.toHaveBeenCalled();
            } finally {
                act(() => root?.unmount());
                complete.mockRestore();
                decode.mockRestore();
                clearDecodedImageCache();
            }
        },
    );

    it('retries the bounded recovery candidate when a responsive image failed before hydration attached listeners', async () => {
        clearDecodedImageCache();
        const host = document.createElement('div');
        const onImageReady = vi.fn();
        const element = (
            <SafeImage
                src="/assets/preview/prehydration-failed.webp"
                imageKind="hero"
                alt="Banner"
                onImageReady={onImageReady}
            />
        );
        host.innerHTML = renderToStaticMarkup(element);
        const image = requiredImage(host);
        Object.defineProperties(image, {
            complete: { configurable: true, get: () => Boolean(image.srcset) },
            currentSrc: {
                configurable: true,
                get: () =>
                    image.srcset
                        ? new URL(image.srcset.split(',')[0].trim().split(' ')[0], location.href).href
                        : image.src,
            },
        });
        let root!: ReturnType<typeof hydrateRoot>;
        try {
            await act(async () => {
                root = hydrateRoot(host, element);
                await Promise.resolve();
            });
            expect(requiredImage(host)).toBe(image);
            expect(image.getAttribute('srcset')).toBeNull();
            expect(image.getAttribute('src')).toContain('preset=storefront-hero-fit-960&format=webp&q=90');
            expect(host.querySelector('[data-safe-image=loading]')).not.toBeNull();
            expect(host.querySelector('[data-safe-image=ready]')).toBeNull();
            expect(onImageReady).not.toHaveBeenCalled();
            await loadCandidate(image);
            expect(onImageReady).toHaveBeenCalledExactlyOnceWith(image);
            expect(host.querySelector('[data-safe-image=ready]')).not.toBeNull();
        } finally {
            act(() => root?.unmount());
            clearDecodedImageCache();
        }
    });

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

    it('renders supplied bounded inline hints independently of request priority without another request', () => {
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
        expect(render('/cover.png?v=one', 'hero', 'auto')).toContain('has-inline-preview');
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

describe('optional image recovery resource', () => {
    it('keeps the real image error and surrounding actions when the recovery module cannot load', async () => {
        vi.resetModules();
        vi.doMock('./image-recovery', () => {
            throw new Error('Recovery chunk unavailable');
        });
        const { SafeImage: IsolatedSafeImage } = await import('./safe-image');
        const host = document.createElement('div');
        const root = createRoot(host);
        const navigate = vi.fn();
        try {
            act(() =>
                root.render(
                    <div>
                        <IsolatedSafeImage src="/optional-recovery-failure.jpg" alt="商品主图" />
                        <button type="button" onClick={navigate}>
                            继续浏览
                        </button>
                    </div>,
                ),
            );
            await failCandidate(requiredImage(host));
            expect(host.querySelector('[data-safe-image=error]')).not.toBeNull();
            expect(host.querySelector('[data-image-state=error]')).not.toBeNull();
            expect(host.querySelector('.safe-image-retry')).toBeNull();
            act(() => requiredElement<HTMLButtonElement>(host, 'button').click());
            expect(navigate).toHaveBeenCalledTimes(1);
        } finally {
            act(() => root.unmount());
            vi.doUnmock('./image-recovery');
            vi.resetModules();
        }
    });
});
