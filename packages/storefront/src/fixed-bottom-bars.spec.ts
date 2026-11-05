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
            const top = Number(this.dataset.top ?? 0);
            return {
                x: 0,
                y: top,
                left: 0,
                top,
                right: 390,
                bottom: top + height,
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

    it.each(['page-action-bar', 'traffic-consent-banner'])(
        'reveals obscured mobile keyboard focus behind %s without changing clearance',
        className => {
            vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390);
            const surface = bar(60, 0, className);
            surface.dataset.top = '770';
            const button = document.createElement('button');
            button.dataset.top = '780';
            button.dataset.height = '44';
            const scrollIntoView = (button.scrollIntoView = vi.fn());
            page().append(button);
            cleanup = trackFixedBottomBars();
            const originalClearance = clearance();

            button.focus();
            flush();

            expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({
                block: 'center',
                inline: 'nearest',
                behavior: 'instant',
            });
            expect(clearance()).toBe(originalClearance);

            button.blur();
            button.dataset.top = '660';
            button.focus();
            flush();
            expect(scrollIntoView).toHaveBeenCalledTimes(1);
        },
    );

    it('leaves focus inside fixed surfaces, dialogs, and desktop content in place', () => {
        const width = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390);
        const surface = bar(60, 0);
        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        page().append(dialog);
        cleanup = trackFixedBottomBars();
        for (const container of [surface, dialog, page()]) {
            if (container === page()) width.mockReturnValue(1440);
            const button = document.createElement('button');
            const scrollIntoView = (button.scrollIntoView = vi.fn());
            container.append(button);
            button.focus();
            flush();
            expect(scrollIntoView).not.toHaveBeenCalled();
        }
    });

    it('temporarily lifts consent when a page-end control cannot scroll clear', () => {
        const width = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390);
        const banner = bar(180, 0, 'traffic-consent-banner');
        banner.dataset.top = '580';
        const consentChoice = document.createElement('button');
        banner.append(consentChoice);
        const feedback = document.createElement('button');
        feedback.dataset.top = '613';
        feedback.dataset.height = '32';
        feedback.scrollIntoView = vi.fn();
        page().append(feedback);
        cleanup = trackFixedBottomBars();

        const translate = () => banner.style.getPropertyValue('translate');
        const focusFeedback = () => {
            feedback.focus();
            flush();
            expect(translate()).toBe('0 -151px');
            expect(clearance()).toBe('0px');
        };
        focusFeedback();
        consentChoice.focus();
        expect(translate()).toBe('');

        focusFeedback();
        feedback.blur();
        flush();
        expect(translate()).toBe('');

        focusFeedback();
        width.mockReturnValue(1440);
        window.dispatchEvent(new Event('resize'));
        flush();
        expect(translate()).toBe('');
    });
});
