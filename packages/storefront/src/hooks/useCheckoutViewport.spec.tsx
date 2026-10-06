// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCheckoutViewport } from './useCheckoutViewport';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

class TestViewport extends EventTarget {
    height = 760;
    offsetTop = 0;
    scale = 1;
}

describe('checkout visible viewport clearance', () => {
    let host: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;
    let viewport: TestViewport;
    let width: number;
    let naturalBottom: number;
    let nativeAlignment: boolean;
    let mounted: boolean;
    let nextFrame: number;
    const frames = new Map<number, FrameRequestCallback>();

    function Harness({ content = true }: { content?: boolean }) {
        const { pageRef, actionBarRef } = useCheckoutViewport(content);
        return content ? (
            <main ref={pageRef}>
                <div ref={actionBarRef} data-testid="action-bar">
                    <button type="button">提交订单</button>
                </div>
            </main>
        ) : (
            <p>暂无可结算商品</p>
        );
    }

    const page = () => {
        const element = host.querySelector('main');
        if (!element) throw new Error('Checkout page missing');
        return element;
    };
    const offset = () =>
        Number.parseFloat(page().style.getPropertyValue('--checkout-viewport-bottom-offset')) || 0;
    const render = (content = true) => act(() => root.render(<Harness content={content} />));
    const flushFrame = () =>
        act(() => {
            const callbacks = [...frames.values()];
            frames.clear();
            callbacks.forEach(callback => callback(0));
        });
    const resize = () => {
        act(() => {
            viewport.dispatchEvent(new Event('resize'));
        });
        flushFrame();
    };

    beforeEach(() => {
        viewport = new TestViewport();
        width = 390;
        naturalBottom = 784;
        nativeAlignment = false;
        mounted = true;
        nextFrame = 0;
        frames.clear();
        vi.stubGlobal('visualViewport', viewport);
        vi.spyOn(window, 'innerWidth', 'get').mockImplementation(() => width);
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
            const id = ++nextFrame;
            frames.set(id, callback);
            return id;
        });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
            frames.delete(id);
        });
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
            this: HTMLElement,
        ) {
            const fixedBottom = nativeAlignment ? viewport.offsetTop + viewport.height : naturalBottom;
            // Model the CSS offset's actual effect, rather than returning a constant rectangle.
            const correction =
                width < 1024
                    ? Number.parseFloat(
                          this.closest('main')?.style.getPropertyValue('--checkout-viewport-bottom-offset') ??
                              '',
                      ) || 0
                    : 0;
            const bottom = fixedBottom - correction;
            return {
                x: 0,
                y: bottom - 72,
                top: bottom - 72,
                bottom,
                left: 0,
                right: width,
                width,
                height: 72,
            } as DOMRect;
        });
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
    });

    afterEach(() => {
        if (mounted) act(() => root.unmount());
        host.remove();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('raises a footer occluded by 24px to the visible bottom on mount', () => {
        render();
        expect(offset()).toBe(24);
        expect(host.querySelector('[data-testid="action-bar"]')?.getBoundingClientRect().bottom).toBe(760);
    });

    it('follows keyboard shrinkage and restores the original clearance when it closes', () => {
        render();
        viewport.height = 400;
        resize();
        expect(offset()).toBe(384);
        viewport.height = 760;
        resize();
        expect(offset()).toBe(24);
        viewport.height = 784;
        resize();
        expect(offset()).toBe(0);
    });

    it('uses the visible viewport bottom including offsetTop, not height alone', () => {
        viewport.offsetTop = 44;
        viewport.height = 716;
        render();
        expect(offset()).toBe(24);
        viewport.offsetTop = 84;
        act(() => {
            viewport.dispatchEvent(new Event('scroll'));
        });
        flushFrame();
        expect(offset()).toBe(0);
    });

    it('coalesces repeated viewport events without accumulating or oscillating the offset', () => {
        render();
        for (let index = 0; index < 5; index++) {
            act(() => {
                viewport.dispatchEvent(new Event('resize'));
                viewport.dispatchEvent(new Event('scroll'));
                window.dispatchEvent(new Event('resize'));
            });
            expect(frames.size).toBe(1);
            flushFrame();
            expect(offset()).toBe(24);
        }
    });

    it('does not compensate a footer already aligned by the browser, including an open keyboard', () => {
        nativeAlignment = true;
        render();
        expect(offset()).toBe(0);
        viewport.height = 410;
        viewport.offsetTop = 30;
        resize();
        expect(offset()).toBe(0);
    });

    it('removes its previous correction when native viewport alignment takes over', () => {
        render();
        expect(offset()).toBe(24);
        nativeAlignment = true;
        resize();
        expect(offset()).toBe(0);
        resize();
        expect(offset()).toBe(0);
    });

    it('clears mobile correction at the desktop breakpoint and restores it on return', () => {
        render();
        width = 1024;
        act(() => {
            window.dispatchEvent(new Event('resize'));
        });
        flushFrame();
        expect(offset()).toBe(0);
        width = 390;
        act(() => {
            window.dispatchEvent(new Event('resize'));
        });
        flushFrame();
        expect(offset()).toBe(24);
    });

    it('leaves pinch zoom to native panning, then resumes at scale 1', () => {
        render();
        viewport.scale = 1.5;
        viewport.height = 320;
        resize();
        expect(offset()).toBe(0);
        viewport.scale = 1;
        viewport.height = 760;
        resize();
        expect(offset()).toBe(24);
    });

    it('starts when an empty checkout gains content and cleans up when that content disappears', () => {
        const add = vi.spyOn(viewport, 'addEventListener');
        render(false);
        expect(add).not.toHaveBeenCalled();
        render(true);
        expect(offset()).toBe(24);
        const previousPage = page();
        act(() => {
            viewport.dispatchEvent(new Event('resize'));
        });
        expect(frames.size).toBe(1);
        render(false);
        expect(frames.size).toBe(0);
        expect(previousPage.style.getPropertyValue('--checkout-viewport-bottom-offset')).toBe('');
        render(true);
        expect(offset()).toBe(24);
    });

    it('keeps the CSS fallback when VisualViewport is unavailable', () => {
        vi.stubGlobal('visualViewport', undefined);
        const add = vi.spyOn(window, 'addEventListener');
        render();
        expect(page().style.getPropertyValue('--checkout-viewport-bottom-offset')).toBe('');
        expect(add.mock.calls.filter(([event]) => event === 'resize')).toHaveLength(0);
        expect(frames.size).toBe(0);
    });

    it('removes all listeners and cancels a queued animation frame on unmount', () => {
        const viewportAdd = vi.spyOn(viewport, 'addEventListener');
        const viewportRemove = vi.spyOn(viewport, 'removeEventListener');
        const windowAdd = vi.spyOn(window, 'addEventListener');
        const windowRemove = vi.spyOn(window, 'removeEventListener');
        render();
        const previousPage = page();
        act(() => {
            viewport.dispatchEvent(new Event('resize'));
        });
        expect(frames.size).toBe(1);
        act(() => root.unmount());
        mounted = false;
        expect(frames.size).toBe(0);
        expect(previousPage.style.getPropertyValue('--checkout-viewport-bottom-offset')).toBe('');
        for (const [event, listener] of viewportAdd.mock.calls) {
            expect(viewportRemove).toHaveBeenCalledWith(event, listener);
        }
        const resizeListener = windowAdd.mock.calls.find(([event]) => event === 'resize')?.[1];
        expect(resizeListener).toBeDefined();
        expect(windowRemove).toHaveBeenCalledWith('resize', resizeListener);
        act(() => {
            viewport.dispatchEvent(new Event('resize'));
            viewport.dispatchEvent(new Event('scroll'));
            window.dispatchEvent(new Event('resize'));
        });
        expect(frames.size).toBe(0);
    });
});
