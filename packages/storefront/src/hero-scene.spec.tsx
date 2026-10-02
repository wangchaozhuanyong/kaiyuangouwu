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
    it('moves intact copy when image, viewport or configured content changes and releases observers', () => {
        let imageHeight = 300;
        const callbacks: ResizeObserverCallback[] = [];
        const disconnect = vi.fn();
        vi.stubGlobal(
            'ResizeObserver',
            class {
                constructor(callback: ResizeObserverCallback) {
                    callbacks.push(callback);
                }
                observe = vi.fn();
                disconnect = disconnect;
            },
        );
        vi.stubGlobal('innerWidth', 1440);
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
            this: HTMLElement,
        ) {
            const height = this.classList.contains('hero-rich-media')
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
            imageHeight = 220;
            resize();
            expect(layout()).toBe('below');
            imageHeight = 500;
            resize();
            expect(layout()).toBe('overlay');
            content.items = Array.from({ length: 8 }, (_, index) => ({
                label: `统计 ${index + 1}`,
                description: '完整统计说明',
            }));
            imageHeight = 300;
            render();
            expect(layout()).toBe('below');
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
            expect(layout()).toBe('below');
            vi.stubGlobal('innerWidth', 1440);
            act(() => {
                window.dispatchEvent(new Event('resize'));
            });
            expect(layout()).toBe('overlay');
            const removeListener = vi.spyOn(window, 'removeEventListener');
            act(() => root.unmount());
            expect(disconnect).toHaveBeenCalled();
            expect(removeListener).toHaveBeenCalledWith('resize', expect.any(Function));
        } finally {
            act(() => root.unmount());
            host.remove();
        }
    });
});
