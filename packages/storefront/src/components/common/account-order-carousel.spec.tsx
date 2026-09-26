// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountOrderCarousel } from './account-order-carousel';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('account order shortcut carousel', () => {
    let container: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;
    let width: number;
    let reducedMotion: boolean;
    let resize: () => void;
    const disconnect = vi.fn();
    const scrollBy = vi.fn();
    const openOrder = vi.fn();

    beforeEach(() => {
        width = 320;
        reducedMotion = false;
        vi.stubGlobal(
            'ResizeObserver',
            class {
                constructor(callback: () => void) {
                    resize = callback;
                }
                observe = vi.fn();
                disconnect = disconnect;
            },
        );
        vi.stubGlobal('matchMedia', () => ({ matches: reducedMotion }));
        vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
        vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(580);
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 90 } as DOMRect);
        vi.spyOn(window, 'getComputedStyle').mockReturnValue({ columnGap: '8px' } as CSSStyleDeclaration);
        vi.stubGlobal('scrollBy', undefined);
        Object.defineProperty(HTMLElement.prototype, 'scrollBy', { configurable: true, value: scrollBy });
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        act(() =>
            root.render(
                <AccountOrderCarousel isZh>
                    {Array.from({ length: 6 }, (_, index) => (
                        <button key={index} onClick={openOrder}>
                            订单 {index + 1}
                        </button>
                    ))}
                </AccountOrderCarousel>,
            ),
        );
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        delete (HTMLElement.prototype as Partial<HTMLElement>).scrollBy;
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    const required = <T extends Element>(selector: string): T => {
        const element = container.querySelector<T>(selector);
        if (!element) throw new Error(`Missing carousel element: ${selector}`);
        return element;
    };
    const scroller = () => required<HTMLElement>('nav');
    const previous = () => required<HTMLButtonElement>('[aria-label="向左滑动订单入口"]');
    const next = () => required<HTMLButtonElement>('[aria-label="向右滑动订单入口"]');
    const scrollTo = (left: number) =>
        act(() => {
            scroller().scrollLeft = left;
            scroller().dispatchEvent(new Event('scroll'));
        });

    it('moves by one card with buttons and updates edge controls after native scrolling', () => {
        expect(scroller().querySelectorAll('button')).toHaveLength(6);
        expect(previous().disabled).toBe(true);
        expect(next().disabled).toBe(false);
        expect(next().getAttribute('aria-controls')).toBe(scroller().id);
        act(() => next().click());
        expect(scrollBy).toHaveBeenCalledWith({ left: 98, behavior: 'smooth' });
        expect(openOrder).not.toHaveBeenCalled();
        scrollTo(260);
        expect(previous().disabled).toBe(false);
        expect(next().disabled).toBe(true);
        act(() => previous().click());
        expect(scrollBy).toHaveBeenLastCalledWith({ left: -98, behavior: 'smooth' });
        act(() => required<HTMLButtonElement>('nav button').click());
        expect(openOrder).toHaveBeenCalledOnce();
    });

    it('hides unnecessary controls when all entries fit and restores them after resizing', () => {
        width = 620;
        act(() => resize());
        expect(container.querySelector('.account-order-carousel-controls')).toBeNull();
        width = 320;
        act(() => resize());
        expect(next().disabled).toBe(false);
    });

    it('respects reduced motion for button navigation', () => {
        reducedMotion = true;
        act(() => next().click());
        expect(scrollBy).toHaveBeenCalledWith({ left: 98, behavior: 'auto' });
    });
});
