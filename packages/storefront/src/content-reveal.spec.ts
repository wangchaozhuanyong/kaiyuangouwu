// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDeferredContentReveal } from './content-reveal';
import { createContentRevealController, revealContentRegions } from './content-reveal-animation';

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
});

describe('content entrance ownership', () => {
    it('treats content ready before the optional module as already displayed', async () => {
        const entrance = createDeferredContentReveal();
        const root = document.createElement('div');
        root.innerHTML = '<section data-content-reveal>Ready content</section>';
        document.body.append(root);
        const region = root.firstElementChild as HTMLElement;
        const animate = vi.fn(() => ({ cancel: vi.fn(), finished: new Promise(() => undefined) }));
        Object.defineProperty(root, 'animate', { value: animate });
        Object.defineProperty(region, 'animate', { value: animate });
        vi.spyOn(region, 'getBoundingClientRect').mockReturnValue({
            top: 10,
            bottom: 110,
            width: 200,
            height: 100,
        } as DOMRect);
        // If this stale pending observation were replayed, the first ready call
        // would animate. Only the current committed ready state may be adopted.
        entrance.update(root, 'fast-page', false);
        entrance.update(root, 'fast-page', true);
        await vi.dynamicImportSettled();
        entrance.update(root, 'fast-page', false);
        entrance.update(root, 'fast-page', true);
        expect(animate).not.toHaveBeenCalled();
        entrance.dispose();
    });
    it('reveals only a target that really waited, once, without replaying background reads or returns', () => {
        const reveal = vi.fn(() => vi.fn());
        const entrance = createContentRevealController(reveal);
        const root = document.createElement('div');
        entrance.update(root, 'cached-home', true);
        entrance.update(root, 'product', false);
        expect(reveal).not.toHaveBeenCalled();
        entrance.update(root, 'product', true);
        expect(reveal).toHaveBeenCalledOnce();
        const stop = reveal.mock.results[0].value;
        entrance.update(root, 'product', false);
        expect(stop).toHaveBeenCalledOnce();
        entrance.update(root, 'product', true);
        entrance.update(root, 'cached-home', true);
        entrance.update(root, 'product', false);
        entrance.update(root, 'product', true);
        expect(reveal).toHaveBeenCalledOnce();
    });

    it('never replays adopted public HTML and never reveals a failed or superseded target', () => {
        const stop = vi.fn();
        const reveal = vi.fn(() => stop);
        const entrance = createContentRevealController(reveal);
        const root = document.createElement('div');
        entrance.update(root, 'ssr', false, true);
        entrance.update(root, 'ssr', true);
        entrance.update(root, 'cancelled', false);
        entrance.update(root, 'target', false);
        entrance.update(root, 'target', true, false, true);
        expect(reveal).not.toHaveBeenCalled();
        entrance.update(root, 'target', true);
        expect(reveal).toHaveBeenCalledOnce();
        entrance.update(root, 'next', false);
        expect(stop).toHaveBeenCalled();
    });
});

describe('bounded visible region animation', () => {
    function scene() {
        document.body.innerHTML = '<main id="storefront-content"><header>Navigation</header></main>';
        const root = document.querySelector<HTMLElement>('main');
        if (!root) throw new Error('Missing scene root');
        const animations: Array<{
            element: HTMLElement;
            frames: unknown;
            options: unknown;
            cancel: ReturnType<typeof vi.fn>;
        }> = [];
        vi.stubGlobal(
            'matchMedia',
            vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
        );
        vi.stubGlobal('scrollY', 0);
        vi.stubGlobal('innerHeight', 844);
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
            this: HTMLElement,
        ) {
            const top = Number(this.dataset.top ?? 10);
            return { top, bottom: top + 30, width: 100, height: 30 } as DOMRect;
        });
        Object.defineProperty(HTMLElement.prototype, 'animate', {
            configurable: true,
            value(this: HTMLElement, frames: unknown, options: unknown) {
                const cancel = vi.fn();
                animations.push({ element: this, frames, options, cancel });
                return { cancel, finished: new Promise(() => undefined) };
            },
        });
        return { root, animations };
    }
    afterEach(() => {
        delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
    });

    it('selects at most four visible groups in visual order without hiding content or blocking actions', () => {
        const { root, animations } = scene();
        root.innerHTML +=
            '<section data-content-reveal data-top="200"><button>Shop</button></section>' +
            '<section data-content-reveal data-top="100">Earlier visually</section>' +
            '<section data-content-reveal hidden>Hidden route</section>' +
            '<section data-content-reveal data-top="900">Below fold</section>' +
            '<section data-content-reveal><div data-page-pending="data">Pending</div></section>' +
            Array.from(
                { length: 5 },
                (_, i) => `<section data-content-reveal data-top="${300 + i * 40}">Group</section>`,
            ).join('');
        const cancel = revealContentRegions(root);
        expect(animations).toHaveLength(4);
        expect(animations[0].element.textContent).toBe('Earlier visually');
        expect(animations.map(item => (item.options as KeyframeAnimationOptions).delay)).toEqual([
            0, 60, 120, 180,
        ]);
        expect(root.querySelector('button')?.disabled).toBe(false);
        expect(root.querySelector('header')?.getAttribute('style')).toBeNull();
        window.dispatchEvent(new Event('pointerdown'));
        expect(animations.every(item => item.cancel.mock.calls.length === 1)).toBe(true);
        cancel();
    });

    it('cancels when a nested catalog scrolls without a bubbling event', () => {
        const { root, animations } = scene();
        root.innerHTML +=
            '<div data-scroll-restoration-id="category-results"><section data-content-reveal>Products</section></div>';
        const catalog = root.querySelector('[data-scroll-restoration-id]');
        if (!catalog) throw new Error('Missing catalog scroll region');
        revealContentRegions(root);
        expect(animations).toHaveLength(1);
        catalog.dispatchEvent(new Event('scroll', { bubbles: false }));
        expect(animations[0].cancel).toHaveBeenCalledOnce();
        catalog.dispatchEvent(new Event('scroll', { bubbles: false }));
        expect(animations[0].cancel).toHaveBeenCalledOnce();
    });

    it('skips reduced motion, restored scroll and a region the user is already operating', () => {
        const { root, animations } = scene();
        root.innerHTML += '<section data-content-reveal><input aria-label="Draft"></section>';
        const input = root.querySelector('input');
        if (!input) throw new Error('Missing scene input');
        input.focus();
        revealContentRegions(root);
        expect(animations).toHaveLength(0);
        input.blur();
        vi.stubGlobal('scrollY', 500);
        revealContentRegions(root);
        expect(animations).toHaveLength(0);
        vi.stubGlobal('scrollY', 0);
        vi.stubGlobal(
            'matchMedia',
            vi.fn(() => ({ matches: true })),
        );
        revealContentRegions(root);
        expect(animations).toHaveLength(0);
    });

    it.each(['.06s', '60ms'])(
        'keeps production CSS seconds and %s stagger in WAAPI milliseconds',
        stagger => {
            const { root, animations } = scene();
            root.style.setProperty('--experience-motion-emphasized', '.24s');
            root.style.setProperty('--experience-motion-stagger', stagger);
            root.innerHTML +=
                '<section data-content-reveal>First</section><section data-content-reveal>Second</section>';
            const cancel = revealContentRegions(root);
            expect(animations.map(item => (item.options as KeyframeAnimationOptions).duration)).toEqual([
                240, 240,
            ]);
            expect(animations.map(item => (item.options as KeyframeAnimationOptions).delay)).toEqual([0, 60]);
            cancel();
        },
    );
});
