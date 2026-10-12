// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackFixedBottomBars } from './fixed-bottom-viewport';

describe('actual fixed bottom clearance', () => {
    let cleanup: (() => void) | undefined;
    let resize: () => void;
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    const flush = () => {
        const callbacks = [...frames.values()];
        frames.clear();
        callbacks.forEach(callback => callback(0));
    };
    const requiredElement = <T extends Element>(element: T | null): T => {
        if (!element) throw new Error('Required bottom-bar fixture element is missing');
        return element;
    };
    const page = () => requiredElement(document.querySelector<HTMLElement>('.page'));
    const clearance = () => page().style.getPropertyValue('--page-bottom-measured-clearance');
    beforeEach(() => {
        nextFrame = 0;
        frames.clear();
        document.body.innerHTML =
            '<div class="storefront-app"><main class="page subpage"><section></section></main></div>';
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
            frames.set(++nextFrame, callback);
            return nextFrame;
        });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
            frames.delete(id);
        });
        vi.stubGlobal(
            'ResizeObserver',
            class {
                constructor(callback: () => void) {
                    resize = callback;
                }
                observe() {
                    return undefined;
                }
                unobserve() {
                    return undefined;
                }
                disconnect() {
                    return undefined;
                }
            },
        );
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
            this: HTMLElement,
        ) {
            const height = Number(this.dataset.height ?? 800);
            return {
                x: 0,
                y: 0,
                left: 0,
                top: 0,
                right: 390,
                bottom: height,
                width: 390,
                height,
                toJSON: () => ({}),
            };
        });
    });
    afterEach(() => {
        cleanup?.();
        cleanup = undefined;
        document.body.innerHTML = '';
        document.documentElement.style.removeProperty('--storefront-viewport-bottom-offset');
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });
    const bar = (height: number, bottom = 0, className = 'page-action-bar') => {
        const element = document.createElement('div');
        element.className = className;
        element.dataset.height = String(height);
        element.style.position = 'fixed';
        element.style.bottom = `${bottom}px`;
        const container =
            className === 'storefront-bottom-nav'
                ? requiredElement(document.querySelector('.storefront-app'))
                : page();
        container.append(element);
        return element;
    };

    it('counts a lowest safe area only once across stacked navigation and checkout bars', () => {
        bar(100, 0, 'storefront-bottom-nav'); // 66px navigation + 34px safe area.
        bar(66, 100);
        cleanup = trackFixedBottomBars();
        expect(clearance()).toBe('166px');
    });
    it('follows the actual bar height, including long translated labels', () => {
        const action = bar(76);
        cleanup = trackFixedBottomBars();
        expect(clearance()).toBe('76px');
        action.dataset.height = '112';
        resize();
        flush();
        expect(clearance()).toBe('112px');
    });
    it('keeps keyboard correction out of document padding', () => {
        document.documentElement.style.setProperty('--storefront-viewport-bottom-offset', '300px');
        bar(110, 300); // 76px generate bar + 34px safe area.
        cleanup = trackFixedBottomBars();
        expect(clearance()).toBe('110px');
    });
    it('does not reserve hidden or document-flow actions and preserves geometry during modal inertness', () => {
        const panel = requiredElement(page().querySelector('section'));
        const action = bar(76);
        panel.append(action);
        panel.hidden = true;
        cleanup = trackFixedBottomBars();
        expect(clearance()).toBe('0px');
        panel.hidden = false;
        action.style.position = 'static';
        window.dispatchEvent(new Event('resize'));
        flush();
        expect(clearance()).toBe('0px');
        action.style.position = 'fixed';
        page().setAttribute('inert', '');
        window.dispatchEvent(new Event('resize'));
        flush();
        expect(clearance()).toBe('76px');
    });
    it('includes desktop floating offset and releases removed actions and cleanup state', () => {
        const action = bar(72, 24);
        cleanup = trackFixedBottomBars();
        expect(clearance()).toBe('96px');
        action.remove();
        window.dispatchEvent(new Event('resize'));
        flush();
        expect(clearance()).toBe('0px');
        cleanup();
        cleanup = undefined;
        expect(clearance()).toBe('');
    });
});
