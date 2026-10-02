// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorefrontContentBlock, StorefrontContentTargetType } from '../types';

import { ManagedAdCarousel } from './content-ui';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const block: StorefrontContentBlock = {
    id: 'ads',
    code: 'ads',
    type: 'CUSTOM',
    enabled: true,
    position: 0,
    startsAt: null,
    endsAt: null,
    imageUrl: null,
    backgroundColor: null,
    textColor: null,
    targetType: 'NONE',
    targetValue: null,
    title: '新品',
    subtitle: '',
    body: '',
    ctaLabel: '',
    settings: { scrollIntervalSeconds: 3 },
    items: Array.from({ length: 4 }, (_, position) => ({
        id: String(position),
        enabled: true,
        position,
        imageUrl: null,
        label: `商品 ${position}`,
        description: '',
        targetType: 'PRODUCT',
        targetValue: String(position),
    })),
};

describe('ManagedAdCarousel direct browsing', () => {
    let host: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;
    let rail: HTMLDivElement;
    let onContentTarget: ReturnType<
        typeof vi.fn<(targetType: StorefrontContentTargetType, targetValue: string | null) => void>
    >;
    const capture = vi.fn();
    const scroll = vi.fn(function (this: HTMLElement, options?: ScrollToOptions | number) {
        this.scrollLeft = typeof options === 'number' ? options : (options?.left ?? 0);
    });
    const pointer = (type: string, x: number, overrides = {}) => {
        const event = new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            button: 0,
            clientX: x,
            clientY: 30,
        });
        Object.defineProperties(
            event,
            Object.fromEntries(
                Object.entries({ pointerId: 1, pointerType: 'mouse', isPrimary: true, ...overrides }).map(
                    ([key, value]) => [key, { value }],
                ),
            ),
        );
        void act(() => rail.dispatchEvent(event));
    };

    beforeEach(async () => {
        vi.useFakeTimers();
        vi.stubGlobal(
            'ResizeObserver',
            class {
                observe = vi.fn();
                disconnect = vi.fn();
            },
        );
        vi.stubGlobal('matchMedia', () => ({
            matches: false,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        }));
        vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
        vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(836);
        vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) {
            return Math.max(0, Array.from(this.parentElement?.children ?? []).indexOf(this)) * 212;
        });
        vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(200);
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
            setTimeout(() => callback(0), 0),
        );
        HTMLElement.prototype.scrollTo = scroll;
        HTMLElement.prototype.scrollBy = function (options?: ScrollToOptions | number) {
            this.scrollLeft += typeof options === 'number' ? options : (options?.left ?? 0);
        };
        HTMLElement.prototype.setPointerCapture = capture;
        HTMLElement.prototype.hasPointerCapture = () => true;
        HTMLElement.prototype.releasePointerCapture = vi.fn();
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        onContentTarget =
            vi.fn<(targetType: StorefrontContentTargetType, targetValue: string | null) => void>();
        await act(async () => {
            root.render(
                <ManagedAdCarousel
                    block={block}
                    products={[]}
                    language="zh"
                    onContentTarget={onContentTarget}
                />,
            );
            await import('./managed-ad-carousel');
        });
        const renderedRail = host.querySelector<HTMLDivElement>('.managed-ad-carousel-rail');
        if (!renderedRail) throw new Error('Carousel rail did not render');
        rail = renderedRail;
        scroll.mockClear();
        capture.mockClear();
    });

    afterEach(() => {
        void act(() => root.unmount());
        host.remove();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('drags without opening a card, then preserves the next intentional click', () => {
        pointer('pointerdown', 280);
        pointer('pointermove', 100);
        expect(rail.scrollLeft).toBe(180);
        expect(rail.dataset.dragging).toBe('true');
        expect(capture).toHaveBeenCalledWith(1);
        pointer('pointerup', 100);
        void act(() => rail.children[0].dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })));
        expect(onContentTarget).not.toHaveBeenCalled();
        expect(rail.dataset.dragging).toBeUndefined();
        pointer('pointerdown', 100);
        pointer('pointerup', 100);
        void act(() => rail.children[0].dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })));
        expect(onContentTarget).toHaveBeenCalledWith('PRODUCT', '0');
    });

    it('keeps tiny mouse movement clickable and leaves touch scrolling native', () => {
        pointer('pointerdown', 100);
        pointer('pointermove', 103);
        pointer('pointerup', 103);
        void act(() => (rail.children[0] as HTMLButtonElement).click());
        expect(onContentTarget).toHaveBeenCalledOnce();
        pointer('pointerdown', 280, { pointerType: 'touch' });
        pointer('pointermove', 60, { pointerType: 'touch' });
        pointer('pointerup', 60, { pointerType: 'touch' });
        expect(capture).not.toHaveBeenCalled();
        expect(rail.scrollLeft).toBe(0);
    });

    it('does not restart autoplay after a manual drag', () => {
        pointer('pointerdown', 280);
        pointer('pointermove', 80);
        pointer('pointerup', 80);
        scroll.mockClear();
        void act(() => vi.advanceTimersByTime(12000));
        expect(scroll).not.toHaveBeenCalled();
    });

    it('restores the rail after cancellation and still permits keyboard activation', () => {
        pointer('pointerdown', 280);
        pointer('pointermove', 80);
        pointer('pointercancel', 80);
        expect(rail.dataset.dragging).toBeUndefined();
        void act(() => (rail.children[0] as HTMLButtonElement).click());
        expect(onContentTarget).toHaveBeenCalledOnce();
    });

    it('supports reaching both ends and moving focus between cards', () => {
        void act(() => rail.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
        expect(document.activeElement).toBe(rail.children[3]);
        void act(() =>
            rail.children[3].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })),
        );
        expect(document.activeElement).toBe(rail.children[2]);
        void act(() => rail.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
        expect(document.activeElement).toBe(rail.children[0]);
    });
});
