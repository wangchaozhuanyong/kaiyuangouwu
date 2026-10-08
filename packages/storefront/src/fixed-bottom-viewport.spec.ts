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
    let measurements: number;
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
    const focusInput = (type = 'text') => {
        const input = document.createElement('input');
        input.type = type;
        document.body.append(input);
        input.focus();
        return input;
    };
    const openKeyboard = () => {
        focusInput();
        viewport.height = 400;
    };

    beforeEach(() => {
        viewport = new TestViewport();
        width = 390;
        naturalBottom = 784;
        nativeAlignment = false;
        measurements = 0;
        nextFrame = 0;
        frames.clear();
        vi.stubGlobal('visualViewport', viewport);
        vi.spyOn(window, 'innerWidth', 'get').mockImplementation(() => width);
        vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(784);
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
            measurements++;
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
        document.body.replaceChildren();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('leaves ordinary browsing to native fixed positioning', () => {
        start();
        expect(probe()?.parentElement).toBe(document.body);
        expect(offset()).toBe(0);
        expect(measurements).toBe(0);
    });

    it('never adds a scroll offset while browser toolbar geometry catches up on later frames', () => {
        start();
        for (const [bottom, height] of [
            [784, 700],
            [844, 700],
            [784, 844],
            [844, 844],
            [844, 760],
            [784, 760],
        ]) {
            naturalBottom = bottom;
            viewport.height = height;
            window.dispatchEvent(new Event('scroll'));
            resize();
            expect(offset()).toBe(0);
        }
        expect(measurements).toBe(0);
    });

    it('raises controls only when an editable field and a keyboard obscure their native edge', () => {
        openKeyboard();
        start();
        expect(offset()).toBe(384);
        expect(naturalBottom - offset()).toBe(viewport.height);
    });

    it('does not drag controls down when their native edge is already above the keyboard', () => {
        openKeyboard();
        naturalBottom = 350;
        start();
        expect(offset()).toBe(0);
    });

    it('follows the keyboard and clears its correction after the full viewport returns', () => {
        focusInput();
        start();
        viewport.height = 400;
        resize();
        expect(offset()).toBe(384);
        viewport.height = 760;
        resize();
        expect(offset()).toBe(0);
        viewport.height = 784;
        resize();
        expect(offset()).toBe(0);
    });

    it('does not add a second correction when the browser already aligns fixed edges', () => {
        nativeAlignment = true;
        focusInput();
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
        openKeyboard();
        viewport.offsetTop = 44;
        start();
        expect(offset()).toBe(340);
        viewport.offsetTop = 100;
        viewport.dispatchEvent(new Event('scroll'));
        flushFrame();
        expect(offset()).toBe(284);
    });

    it('rounds keyboard corrections to whole pixels without introducing negative offsets', () => {
        openKeyboard();
        naturalBottom = 424.6;
        start();
        expect(offset()).toBe(25);
        naturalBottom = 374.6;
        resize();
        expect(offset()).toBe(0);
    });

    it('coalesces events and never accumulates correction from an already adjusted bar', () => {
        openKeyboard();
        start();
        for (let index = 0; index < 5; index++) {
            viewport.dispatchEvent(new Event('resize'));
            viewport.dispatchEvent(new Event('scroll'));
            window.dispatchEvent(new Event('resize'));
            window.dispatchEvent(new Event('scroll'));
            expect(frames.size).toBe(1);
            flushFrame();
            expect(offset()).toBe(384);
        }
        expect(document.querySelectorAll('.storefront-viewport-probe')).toHaveLength(1);
    });

    it('clears correction at the desktop breakpoint and restores it on mobile', () => {
        openKeyboard();
        start();
        width = 1024;
        window.dispatchEvent(new Event('resize'));
        flushFrame();
        expect(offset()).toBe(0);
        width = 1023;
        window.dispatchEvent(new Event('resize'));
        flushFrame();
        expect(offset()).toBe(384);
    });

    it('leaves pinch zoom native and resumes alignment when scale returns to one', () => {
        openKeyboard();
        start();
        viewport.scale = 1.5;
        resize();
        expect(offset()).toBe(0);
        viewport.scale = 1;
        resize();
        expect(offset()).toBe(384);
    });

    it('ignores zero-height viewports and resumes after their geometry recovers', () => {
        openKeyboard();
        start();
        viewport.height = 0;
        resize();
        expect(offset()).toBe(0);
        viewport.height = 400;
        resize();
        expect(offset()).toBe(384);
    });

    it('rechecks the edge when a page is restored from the browser back-forward cache', () => {
        openKeyboard();
        start();
        viewport.height = 760;
        window.dispatchEvent(new Event('pageshow'));
        flushFrame();
        expect(offset()).toBe(0);
    });

    it('clears keyboard offsets on blur even before the viewport resize arrives', () => {
        const input = focusInput();
        viewport.height = 400;
        start();
        expect(offset()).toBe(384);
        input.blur();
        flushFrame();
        expect(offset()).toBe(0);
    });

    it('starts keyboard avoidance when focus arrives after the viewport has resized', () => {
        viewport.height = 400;
        start();
        expect(offset()).toBe(0);
        focusInput();
        flushFrame();
        expect(offset()).toBe(384);
    });

    it('uses the layout height when innerHeight already follows the keyboard viewport', () => {
        openKeyboard();
        vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(400);
        vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(784);
        start();
        expect(offset()).toBe(384);
        viewport.height = 760;
        resize();
        expect(offset()).toBe(0);
    });

    it.each(['textarea', 'contenteditable'])('supports %s keyboard input', kind => {
        const field = document.createElement(kind === 'textarea' ? 'textarea' : 'div');
        if (kind === 'contenteditable') {
            field.tabIndex = 0;
            field.contentEditable = 'true';
            // jsdom does not implement the browser's inherited editing-state property.
            Object.defineProperty(field, 'isContentEditable', { value: true });
        }
        document.body.append(field);
        field.focus();
        viewport.height = 400;
        start();
        expect(offset()).toBe(384);
    });

    it('does not mistake a browser toolbar resize for a keyboard with a field focused', () => {
        focusInput();
        viewport.height = 660;
        start();
        expect(offset()).toBe(0);
        viewport.height = 760;
        resize();
        expect(offset()).toBe(0);
    });

    it.each(['checkbox', 'radio', 'range', 'button'])('does not treat %s focus as typing', type => {
        focusInput(type);
        viewport.height = 400;
        start();
        expect(offset()).toBe(0);
    });

    it.each(['readOnly', 'disabled', 'inputMode'] as const)(
        'does not move navigation for a field with %s blocking the keyboard',
        attribute => {
            const input = focusInput();
            if (attribute === 'inputMode') input.inputMode = 'none';
            else input[attribute] = true;
            viewport.height = 400;
            start();
            expect(offset()).toBe(0);
        },
    );

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
        document.dispatchEvent(new Event('focusin'));
        document.dispatchEvent(new Event('focusout'));
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
