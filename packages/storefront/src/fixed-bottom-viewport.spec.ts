// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackFixedBottomViewport } from './fixed-bottom-viewport';

class TestViewport extends EventTarget {
    height = 760;
    offsetTop = 0;
    scale = 1;
}

describe('shared fixed bottom visible viewport alignment', () => {
    let viewport: TestViewport;
    let width: number;
    let naturalBottom: number;
    let nativeAlignment: boolean;
    let cleanup: (() => void) | undefined;
    let nextFrame: number;
    const frames = new Map<number, FrameRequestCallback>();

    const offset = () =>
        Number.parseFloat(
            document.documentElement.style.getPropertyValue('--storefront-viewport-bottom-offset'),
        ) || 0;
    const probe = () => document.querySelector('.storefront-viewport-probe');
    const start = () => {
        cleanup = trackFixedBottomViewport();
    };
    const flushFrame = () => {
        const callbacks = [...frames.values()];
        frames.clear();
        callbacks.forEach(callback => callback(0));
    };
    const resize = () => {
        viewport.dispatchEvent(new Event('resize'));
        flushFrame();
    };

    beforeEach(() => {
        viewport = new TestViewport();
        width = 390;
        naturalBottom = 784;
        nativeAlignment = false;
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
            if (!this.classList.contains('storefront-viewport-probe')) {
                throw new Error('Viewport alignment must measure its neutral probe, not page content');
            }
            // The neutral probe intentionally does not inherit the correction applied to action bars.
            const bottom = nativeAlignment ? viewport.offsetTop + viewport.height : naturalBottom;
            return {
                x: 0,
                y: bottom,
                top: bottom,
                bottom,
                left: 0,
                right: 0,
                width: 0,
                height: 0,
            } as DOMRect;
        });
    });

    afterEach(() => {
        cleanup?.();
        cleanup = undefined;
        document.documentElement.style.removeProperty('--storefront-viewport-bottom-offset');
        document.querySelectorAll('.storefront-viewport-probe').forEach(element => element.remove());
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('raises bars whose native fixed edge falls below the visible bottom', () => {
        start();
        expect(probe()?.parentElement).toBe(document.body);
        expect(offset()).toBe(24);
        expect(naturalBottom - offset()).toBe(viewport.height);
    });

    it('lowers bars stranded above the visible bottom instead of clamping to zero', () => {
        naturalBottom = 420;
        start();
        expect(offset()).toBe(-340);
        expect(naturalBottom - offset()).toBe(viewport.height);
    });

    it('follows the keyboard and clears its correction after the full viewport returns', () => {
        start();
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

    it('does not add a second correction when the browser already aligns fixed edges', () => {
        nativeAlignment = true;
        start();
        expect(offset()).toBe(0);
        viewport.height = 400;
        resize();
        expect(offset()).toBe(0);
        viewport.offsetTop = 30;
        viewport.height = 730;
        resize();
        expect(offset()).toBe(0);
    });

    it('uses the viewport top offset when locating its visible bottom', () => {
        viewport.offsetTop = 44;
        viewport.height = 700;
        start();
        expect(offset()).toBe(40);
        viewport.offsetTop = 100;
        viewport.dispatchEvent(new Event('scroll'));
        flushFrame();
        expect(offset()).toBe(-16);
    });

    it('rounds positive and negative fractional edge differences to whole pixels', () => {
        naturalBottom = 784.6;
        start();
        expect(offset()).toBe(25);
        naturalBottom = 734.6;
        resize();
        expect(offset()).toBe(-25);
    });

    it('coalesces events and never accumulates correction from an already adjusted bar', () => {
        start();
        for (let index = 0; index < 5; index++) {
            viewport.dispatchEvent(new Event('resize'));
            viewport.dispatchEvent(new Event('scroll'));
            window.dispatchEvent(new Event('resize'));
            window.dispatchEvent(new Event('scroll'));
            expect(frames.size).toBe(1);
            flushFrame();
            expect(offset()).toBe(24);
        }
        expect(document.querySelectorAll('.storefront-viewport-probe')).toHaveLength(1);
    });

    it('clears correction at the desktop breakpoint and restores it on mobile', () => {
        start();
        width = 1024;
        window.dispatchEvent(new Event('resize'));
        flushFrame();
        expect(offset()).toBe(0);
        width = 1023;
        window.dispatchEvent(new Event('resize'));
        flushFrame();
        expect(offset()).toBe(24);
    });

    it('leaves pinch zoom native and resumes alignment when scale returns to one', () => {
        start();
        viewport.scale = 1.5;
        resize();
        expect(offset()).toBe(0);
        viewport.scale = 1;
        resize();
        expect(offset()).toBe(24);
    });

    it('ignores zero-height viewports and resumes after their geometry recovers', () => {
        start();
        viewport.height = 0;
        resize();
        expect(offset()).toBe(0);
        viewport.height = 760;
        resize();
        expect(offset()).toBe(24);
    });

    it('rechecks the edge when a page is restored from the browser back-forward cache', () => {
        start();
        naturalBottom = 500;
        window.dispatchEvent(new Event('pageshow'));
        flushFrame();
        expect(offset()).toBe(-260);
    });

    it('removes probe, correction, pending frame and every event subscription on cleanup', () => {
        start();
        viewport.dispatchEvent(new Event('resize'));
        expect(frames.size).toBe(1);
        cleanup?.();
        cleanup = undefined;
        expect(frames.size).toBe(0);
        expect(probe()).toBeNull();
        expect(document.documentElement.style.getPropertyValue('--storefront-viewport-bottom-offset')).toBe(
            '',
        );

        viewport.dispatchEvent(new Event('resize'));
        viewport.dispatchEvent(new Event('scroll'));
        window.dispatchEvent(new Event('resize'));
        window.dispatchEvent(new Event('pageshow'));
        window.dispatchEvent(new Event('scroll'));
        expect(frames.size).toBe(0);
    });

    it('does not create viewport state or observers when the API is unavailable', () => {
        vi.stubGlobal('visualViewport', undefined);
        start();
        expect(probe()).toBeNull();
        expect(offset()).toBe(0);
        window.dispatchEvent(new Event('resize'));
        window.dispatchEvent(new Event('pageshow'));
        window.dispatchEvent(new Event('scroll'));
        expect(frames.size).toBe(0);
        expect(() => cleanup?.()).not.toThrow();
    });
});
