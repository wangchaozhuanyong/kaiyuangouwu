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
    let firstButtonLeft: number;
    const scrollBy = vi.fn();
    const openOrder = vi.fn();

    beforeEach(() => {
        width = 320;
        reducedMotion = false;
        firstButtonLeft = 10;
        vi.stubGlobal('matchMedia', () => ({ matches: reducedMotion }));
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
            this: HTMLElement,
        ) {
            const index = Number(this.dataset.index);
            const left = this.tagName === 'NAV' ? 0 : index === 0 ? firstButtonLeft : 10 + index * 88;
            const right = this.tagName === 'NAV' ? width : left + 80;
            return { left, right, width: right - left } as DOMRect;
        });
        vi.spyOn(window, 'getComputedStyle').mockReturnValue({
            scrollPaddingInlineStart: '10px',
            scrollPaddingInlineEnd: '10px',
        } as CSSStyleDeclaration);
        Object.defineProperty(HTMLElement.prototype, 'scrollBy', { configurable: true, value: scrollBy });
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        act(() =>
            root.render(
                <AccountOrderCarousel isZh>
                    {Array.from({ length: 6 }, (_, index) => (
                        <button key={index} data-index={index} onClick={openOrder}>
                            <span>订单 {index + 1}</span>
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

    it('keeps native scrolling and order entries without extra controls or hints', () => {
        const nav = required<HTMLElement>('nav');
        expect(container.querySelectorAll('button')).toHaveLength(6);
        expect(container.querySelector('.account-order-carousel-controls')).toBeNull();
        expect(container.textContent).not.toContain('左右滑动查看');
        act(() => {
            nav.scrollLeft = 100;
            nav.dispatchEvent(new Event('scroll'));
        });
        expect(nav.scrollLeft).toBe(100);
        expect(scrollBy).not.toHaveBeenCalled();
        expect(openOrder).not.toHaveBeenCalled();
    });

    it('reveals a partially visible shortcut when its icon is clicked and preserves navigation', () => {
        act(() => required<HTMLSpanElement>('button[data-index="3"] span').click());
        expect(scrollBy).toHaveBeenCalledWith({ left: 44, behavior: 'smooth' });
        expect(openOrder).toHaveBeenCalledOnce();
    });

    it('reveals a shortcut to the left on keyboard focus and respects reduced motion', () => {
        reducedMotion = true;
        const button = required<HTMLButtonElement>('button[data-index="0"]');
        firstButtonLeft = -20;
        act(() => button.focus());
        expect(scrollBy).toHaveBeenCalledWith({ left: -30, behavior: 'auto' });
        expect(openOrder).not.toHaveBeenCalled();
    });

    it('does not move already visible shortcuts, including when every entry fits', () => {
        act(() => required<HTMLButtonElement>('button[data-index="0"]').click());
        width = 620;
        act(() => required<HTMLButtonElement>('button[data-index="5"]').click());
        expect(scrollBy).not.toHaveBeenCalled();
        expect(openOrder).toHaveBeenCalledTimes(2);
    });
});
