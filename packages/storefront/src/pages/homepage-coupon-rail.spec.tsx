// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HomepageCouponRail } from './homepage-coupon-rail';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('homepage coupon rail', () => {
    let host: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;
    let rail: HTMLDivElement;
    let button: HTMLButtonElement;
    const claim = vi.fn();
    const capture = vi.fn();
    const scrollBy = vi.fn();
    const pointer = (type: string, x: number, y = 0, pointerType = 'mouse') => {
        const event = new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            button: 0,
        });
        Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: pointerType } });
        act(() => {
            button.dispatchEvent(event);
        });
        return event;
    };
    const click = (detail = 1) => {
        act(() => {
            button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail }));
        });
    };

    beforeEach(() => {
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        act(() =>
            root.render(
                <HomepageCouponRail isZh>
                    <button onClick={claim}>领取</button>
                </HomepageCouponRail>,
            ),
        );
        const list = host.querySelector<HTMLDivElement>('[role="list"]');
        const action = host.querySelector('button');
        if (!list || !action) throw new Error('Missing coupon rail');
        rail = list;
        button = action;
        Object.defineProperties(rail, { scrollWidth: { value: 1800 }, clientWidth: { value: 1280 } });
        rail.setPointerCapture = capture;
        rail.hasPointerCapture = () => false;
        rail.scrollBy = scrollBy;
        vi.stubGlobal('matchMedia', () => ({ matches: true }));
    });
    afterEach(() => {
        act(() => root.unmount());
        host.remove();
        vi.clearAllMocks();
        vi.unstubAllGlobals();
    });
    it('drags from a claim button without claiming, then allows the next normal click', () => {
        pointer('pointerdown', 220);
        pointer('pointermove', 100);
        expect(rail.scrollLeft).toBe(120);
        expect(rail.classList.contains('is-dragging')).toBe(true);
        pointer('pointerup', 100);
        click();
        expect(claim).not.toHaveBeenCalled();
        expect(rail.classList.contains('is-dragging')).toBe(false);
        pointer('pointerdown', 100);
        pointer('pointerup', 100);
        click();
        expect(claim).toHaveBeenCalledOnce();
    });
    it('allows small mouse movement and native touch scrolling without capturing or claiming', () => {
        pointer('pointerdown', 100);
        pointer('pointermove', 97);
        pointer('pointerup', 97);
        click();
        expect(claim).toHaveBeenCalledOnce();
        expect(pointer('pointermove', 20, 0, 'touch').defaultPrevented).toBe(false);
        pointer('pointerdown', 100, 0, 'touch');
        pointer('pointermove', 20, 0, 'touch');
        pointer('pointerup', 20, 0, 'touch');
        expect(capture).not.toHaveBeenCalled();
        expect(rail.scrollLeft).toBe(0);
    });
    it('ignores vertical mouse gestures and releases dragging on pointer cancellation', () => {
        pointer('pointerdown', 100);
        pointer('pointermove', 98, 20);
        expect(capture).not.toHaveBeenCalled();
        pointer('pointerdown', 100);
        pointer('pointermove', 20);
        pointer('pointercancel', 20);
        expect(rail.classList.contains('is-dragging')).toBe(false);
        pointer('pointermove', 0);
        expect(rail.scrollLeft).toBe(80);
        click(0);
        expect(claim).toHaveBeenCalledOnce();
    });
    it('scrolls using arrow keys on the rail without hijacking child button keys', () => {
        act(() => {
            rail.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
            );
        });
        expect(scrollBy).toHaveBeenCalledOnce();
        act(() => {
            button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        });
        expect(scrollBy).toHaveBeenCalledOnce();
    });
});
