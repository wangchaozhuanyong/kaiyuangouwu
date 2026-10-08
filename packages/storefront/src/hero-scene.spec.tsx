// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HeroScene, type HeroSceneData } from '../../storefront-content-plugin/src/shared/hero-scene';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('shared hero content layout', () => {
    it('keeps one copy and action structure across every artwork ratio with phone-only scroll semantics', async () => {
        vi.stubGlobal(
            'ResizeObserver',
            class {
                observe = vi.fn();
                disconnect = vi.fn();
            },
        );
        vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockImplementation(function (
            this: HTMLImageElement,
        ) {
            return this.dataset.ready === 'true';
        });
        vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockImplementation(function (
            this: HTMLImageElement,
        ) {
            return Number(this.dataset.width) || 0;
        });
        vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockImplementation(function (
            this: HTMLImageElement,
        ) {
            return Number(this.dataset.height) || 0;
        });
        const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        const content: HeroSceneData = {
            imageUrl: '/wide-original.jpg',
            title: '主标题保留',
            subtitle: '品牌说明保留',
            body: '较长的商品说明全部保留并可滚动查看',
            ctaLabel: 'Browse the complete product collection',
            targetType: 'PAGE',
            items: [{ label: '权益', description: '统计说明保留' }],
        };
        const render = (ready: boolean, width: number, height: number, copyScrollable = true) =>
            act(async () => {
                root.render(
                    <HeroScene
                        content={{ ...content }}
                        copyScrollable={copyScrollable}
                        image={
                            <img
                                key={content.imageUrl}
                                src={content.imageUrl ?? ''}
                                alt="Artwork"
                                data-ready={ready}
                                data-width={width}
                                data-height={height}
                            />
                        }
                        imageLabel="打开内容"
                        mediaOverlay={<div className="test-trust">原服务栏</div>}
                    />,
                );
                await Promise.resolve();
            });
        const artwork = () => {
            const image = host.querySelector<HTMLImageElement>('.hero-rich-image-link img');
            if (!image) throw new Error('Missing current artwork');
            return image;
        };
        const load = (image: HTMLImageElement) =>
            act(async () => {
                image.dispatchEvent(new Event('load'));
                await Promise.resolve();
            });
        try {
            await render(true, 2200, 715);
            expect(host.firstElementChild?.getAttribute('data-hero-artwork-layout')).toBe('overlay');
            const region = host.querySelector<HTMLElement>('.hero-rich-copy-region');
            if (!region) throw new Error('Missing copy scroll region');
            for (const text of [content.title, content.subtitle, content.body, '权益', '统计说明保留']) {
                expect(region.textContent).toContain(text);
            }
            expect(region.contains(host.querySelector('.hero-rich-cta-btn'))).toBe(false);
            expect(host.querySelector('.hero-rich-cta-label')?.textContent).toBe(content.ctaLabel);
            expect(host.querySelector('.hero-rich-cta-btn')?.textContent).toBe(content.ctaLabel);
            expect(region.contains(host.querySelector('.test-trust'))).toBe(false);
            expect(region.getAttribute('tabindex')).toBe('0');
            const composition = () =>
                `${host.firstElementChild?.className}\n${host.querySelector('.hero-rich-content')?.outerHTML}`;
            const initialComposition = composition();
            for (const [width, height] of [
                [1774, 887],
                [1672, 941],
                [1920, 800],
            ]) {
                artwork().dataset.width = String(width);
                artwork().dataset.height = String(height);
                await load(artwork());
                expect(composition()).toBe(initialComposition);
            }
            const oldImage = artwork();
            content.imageUrl = '/phone-original.jpg';
            await render(false, 0, 0);
            expect(composition()).toBe(initialComposition);
            await load(oldImage);
            expect(composition()).toBe(initialComposition);
            const image = artwork();
            image.dataset.ready = 'true';
            image.dataset.width = '1200';
            image.dataset.height = '900';
            await load(image);
            expect(composition()).toBe(initialComposition);
            expect(canvas).toHaveBeenCalledTimes(2);
            await render(true, 1920, 800, false);
            expect(region.getAttribute('tabindex')).toBeNull();
            expect(region.getAttribute('role')).toBeNull();
            expect(region.querySelector('.hero-rich-copy-surface')?.firstElementChild?.className).toContain(
                'hero-rich-pill',
            );
            expect(canvas).toHaveBeenCalledTimes(2);
        } finally {
            await act(async () => {
                root.unmount();
                await Promise.resolve();
            });
            host.remove();
        }
    });

    it('opts into editorial artwork without changing localized copy, image bindings or either action', () => {
        vi.stubGlobal(
            'ResizeObserver',
            class {
                observe = vi.fn();
                disconnect = vi.fn();
            },
        );
        const onImageOpen = vi.fn();
        const onOpen = vi.fn();
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        const content: HeroSceneData = {
            imageUrl: '/assets/text-free-model.webp',
            title: '完整保留的长标题'.repeat(12),
            subtitle: '后台独立副标题',
            body: '介绍仍保留完整原文用于语言切换。'.repeat(12),
            ctaLabel: '开始使用',
            targetType: 'URL',
            settings: { heroArtworkLayout: 'editorial' },
            items: [],
        };
        const render = () =>
            act(() =>
                root.render(
                    <HeroScene
                        content={{ ...content }}
                        image={<img src={content.imageUrl ?? ''} alt="无文字底图" />}
                        imageLabel="查看配置的活动"
                        mediaOverlay={<button type="button">下一张</button>}
                        onImageOpen={onImageOpen}
                        onOpen={onOpen}
                    />,
                ),
            );
        try {
            render();
            expect(host.firstElementChild?.getAttribute('data-hero-artwork-layout')).toBe('editorial');
            expect(host.querySelector('.hero-rich-title')?.textContent).toBe(content.title);
            expect(host.querySelector('.hero-rich-desc')?.textContent).toBe(content.body);
            const image = host.querySelector('.hero-rich-image-link img');
            expect(image?.getAttribute('src')).toBe(content.imageUrl);
            expect(host.querySelector('.hero-rich-media')?.textContent).toContain('下一张');
            act(() => {
                (host.querySelector('.hero-rich-image-link') as HTMLButtonElement).click();
                (host.querySelector('.hero-rich-cta-btn') as HTMLButtonElement).click();
            });
            expect(onImageOpen).toHaveBeenCalledOnce();
            expect(onOpen).toHaveBeenCalledOnce();

            content.title = 'The complete localized title '.repeat(12);
            content.body = 'The original service description stays available. '.repeat(12).trim();
            content.ctaLabel = 'Get started';
            render();
            expect(host.querySelector('.hero-rich-title')?.textContent).toBe(content.title.trim());
            expect(host.querySelector('.hero-rich-desc')?.textContent).toBe(content.body);
            expect(host.querySelector('.hero-rich-cta-label')?.textContent).toBe('Get started');
            expect(host.querySelector('.hero-rich-image-link img')).toBe(image);

            for (const settings of [
                null,
                { heroArtworkLayout: 'overlay' },
                { heroArtworkLayout: 'unknown' },
            ]) {
                content.settings = settings;
                render();
                expect(host.firstElementChild?.getAttribute('data-hero-artwork-layout')).toBe('overlay');
                expect(host.querySelector('.hero-rich-image-link img')).toBe(image);
                expect(host.querySelector('.hero-rich-desc')?.textContent).toBe(content.body);
            }
        } finally {
            act(() => root.unmount());
            host.remove();
        }
    });

    it('samples cached and newly loaded artwork without letting overlay icons or old images set copy colors', async () => {
        vi.stubGlobal(
            'ResizeObserver',
            class {
                observe = vi.fn();
                disconnect = vi.fn();
            },
        );
        vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockImplementation(function (
            this: HTMLImageElement,
        ) {
            return this.dataset.ready === 'true';
        });
        vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockImplementation(function (
            this: HTMLImageElement,
        ) {
            return this.dataset.ready === 'true' ? 1200 : 0;
        });
        let sampledImage: HTMLImageElement;
        const drawImage = vi.fn((image: HTMLImageElement) => {
            sampledImage = image;
        });
        const getImageData = vi.fn(() => {
            if (sampledImage.src.includes('cross-origin')) {
                throw new DOMException('Canvas is tainted', 'SecurityError');
            }
            const value = sampledImage.src.includes('dark') ? 0 : 255;
            return { data: new Uint8ClampedArray([value, value, value, 255]) };
        });
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
            drawImage,
            getImageData,
        } as unknown as CanvasRenderingContext2D);
        const content: HeroSceneData = {
            title: 'Configured title',
            subtitle: '',
            body: 'Configured body',
            ctaLabel: '',
            targetType: 'NONE',
            imageUrl: '/cached-light.jpg',
            items: [],
        };
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        const render = async (ready: boolean) => {
            await act(async () => {
                root.render(
                    <HeroScene
                        content={{ ...content }}
                        image={
                            <>
                                <img src={content.imageUrl ?? undefined} alt="Artwork" data-ready={ready} />
                                <img src="/dark-preview.jpg" alt="" aria-hidden="true" data-ready="true" />
                            </>
                        }
                        imageLabel="Open artwork"
                        mediaOverlay={<img src="/dark-service-icon.jpg" alt="" data-ready="true" />}
                    />,
                );
                await Promise.resolve();
            });
        };
        const color = (property = '--hero-image-copy-foreground') =>
            (host.firstElementChild as HTMLElement).style.getPropertyValue(property);
        const load = async (image: HTMLImageElement) => {
            await act(() => image.dispatchEvent(new Event('load', { bubbles: false })));
        };
        try {
            await render(true);
            expect(color()).toBe('#0f172a');
            expect(drawImage).toHaveBeenCalledOnce();
            for (const image of host.querySelectorAll<HTMLImageElement>('img')) await load(image);
            expect(drawImage).toHaveBeenCalledOnce();
            expect(color()).toBe('#0f172a');

            content.imageUrl = '/new-dark.jpg';
            await render(false);
            expect(color()).toBe('var(--text)');
            const artwork = host.querySelector<HTMLImageElement>('.hero-rich-image-link img');
            if (!artwork) throw new Error('Missing current artwork');
            artwork.dataset.ready = 'true';
            await load(artwork);
            expect(color()).toBe('#ffffff');
            expect(drawImage).toHaveBeenCalledTimes(2);

            content.textColor = '#604823';
            content.settings = { secondaryTextColor: '#334155' };
            await render(true);
            expect(color()).toBe('#604823');
            expect(color('--hero-image-body-foreground')).toBe('#334155');
            expect(drawImage).toHaveBeenCalledTimes(2);

            content.imageUrl = '/cross-origin.jpg';
            content.textColor = null;
            content.settings = null;
            await expect(render(true)).resolves.toBeUndefined();
            expect(color()).toBe('#ffffff');
            expect(drawImage).toHaveBeenCalledTimes(3);
        } finally {
            await act(async () => {
                root.unmount();
                await Promise.resolve();
            });
            host.remove();
        }
    });

    it('keeps configured copy over the image and measures media overlays without losing content', () => {
        let imageHeight = 300;
        let overlayHeight = 40;
        const callbacks: ResizeObserverCallback[] = [];
        const disconnect = vi.fn();
        const observe = vi.fn();
        vi.stubGlobal(
            'ResizeObserver',
            class {
                constructor(callback: ResizeObserverCallback) {
                    callbacks.push(callback);
                }
                observe = observe;
                disconnect = disconnect;
            },
        );
        vi.stubGlobal('innerWidth', 1440);
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
            this: HTMLElement,
        ) {
            const height = this.classList.contains('test-trust')
                ? overlayHeight
                : this.classList.contains('hero-rich-media')
                  ? imageHeight
                  : this.classList.contains('hero-rich-content')
                    ? 200 + this.querySelectorAll('.hero-stat-badge').length * 20
                    : 40;
            const top = this.classList.contains('test-trust') ? imageHeight - 52 : 0;
            return new DOMRect(0, top, 450, height);
        });
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        const navigate = vi.fn();
        const content: HeroSceneData = {
            title: '完整标题',
            subtitle: '完整副标题',
            body: '完整说明',
            ctaLabel: '查看商品',
            targetType: 'PAGE',
            items: [],
        };
        const render = () =>
            act(() =>
                root.render(
                    <HeroScene
                        content={content}
                        image={<img alt="完整图片" src="/fixture.svg" />}
                        imageLabel="打开图片"
                        mediaOverlay={<div className="test-trust">服务保障</div>}
                        onOpen={navigate}
                    />,
                ),
            );
        const layout = () => host.firstElementChild?.getAttribute('data-copy-layout');
        const resize = () =>
            act(() => {
                const callback = callbacks.at(-1);
                if (!callback) throw new Error('Missing layout observer');
                callback([], {} as ResizeObserver);
            });
        try {
            render();
            expect(layout()).toBe('overlay');
            expect(observe).toHaveBeenCalledWith(host.querySelector('.test-trust'));
            expect(
                (host.firstElementChild as HTMLElement).style.getPropertyValue('--hero-overlay-height'),
            ).toBe('40px');
            imageHeight = 220;
            overlayHeight = 72;
            resize();
            expect(layout()).toBe('overlay');
            expect(
                (host.firstElementChild as HTMLElement).style.getPropertyValue('--hero-overlay-height'),
            ).toBe('72px');
            imageHeight = 500;
            resize();
            expect(layout()).toBe('overlay');
            content.items = Array.from({ length: 8 }, (_, index) => ({
                label: `统计 ${index + 1}`,
                description: '完整统计说明',
            }));
            imageHeight = 300;
            render();
            expect(layout()).toBe('overlay');
            expect(host.querySelectorAll('.hero-stat-badge')).toHaveLength(8);
            for (const text of [content.subtitle, content.title, content.body, content.ctaLabel]) {
                expect(host.textContent).toContain(text);
            }
            act(() => {
                const button = host.querySelector<HTMLButtonElement>('.hero-rich-cta-btn');
                if (!button) throw new Error('Missing configured CTA');
                button.click();
            });
            expect(navigate).toHaveBeenCalledOnce();
            imageHeight = 700;
            vi.stubGlobal('innerWidth', 390);
            act(() => {
                window.dispatchEvent(new Event('resize'));
            });
            expect(layout()).toBe('overlay');
            vi.stubGlobal('innerWidth', 1440);
            act(() => {
                window.dispatchEvent(new Event('resize'));
            });
            expect(layout()).toBe('overlay');
            act(() => root.unmount());
            expect(disconnect).toHaveBeenCalled();
        } finally {
            act(() => root.unmount());
            host.remove();
        }
    });
});
