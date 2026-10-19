// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bindCategoryNavigationCollapse } from './category-navigation-collapse';

describe('mobile catalog navigation motion', () => {
    let root: HTMLElement;
    let viewport: HTMLElement;
    let navigation: HTMLElement;
    let control: ReturnType<typeof bindCategoryNavigationCollapse>;
    let mobile: boolean;
    let reduced: boolean;
    let fullHeight: number;
    let contentHeight: number;
    let y: number;
    let now: number;
    let frameId: number;
    let collapsed: boolean;
    let presentation: { scope: string; collapsed: boolean } | null;
    let locks: { freeze: boolean; forceExpanded: boolean };
    const frames = new Map<number, FrameRequestCallback>();
    const headerHeight = () =>
        viewport.style.height ? Number.parseFloat(viewport.style.height) : fullHeight;
    const bind = (scope = 'store-a:category-a') => {
        const owner = history.state.__TSR_key;
        control = bindCategoryNavigationCollapse({
            root,
            viewport,
            navigation,
            initialCollapsed: presentation?.scope === scope && presentation.collapsed,
            onRemember: value => {
                if (history.state.__TSR_key === owner) presentation = { scope, collapsed: value };
            },
            getLocks: () => locks,
            onCollapsed: value => {
                collapsed = value;
            },
        });
    };
    function frame(ms = 16) {
        now += ms;
        const callbacks = [...frames.values()];
        frames.clear();
        callbacks.forEach(callback => callback(now));
    }
    function scroll(next: number, user = true) {
        if (user) root.dispatchEvent(new Event('wheel'));
        root.scrollTop = next;
        root.dispatchEvent(new Event('scroll'));
        frame();
    }
    function collapse() {
        scroll(320);
        frame(200);
    }

    beforeEach(() => {
        mobile = true;
        reduced = false;
        fullHeight = 160;
        contentHeight = 3000;
        y = 0;
        now = 1;
        frameId = 0;
        collapsed = false;
        presentation = null;
        locks = { freeze: false, forceExpanded: false };
        frames.clear();
        history.replaceState({ __TSR_key: 'motion-test' }, '');
        vi.stubGlobal('matchMedia', (query: string) => ({
            get matches() {
                return query.includes('max-width') ? mobile : reduced;
            },
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        }));
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            frames.set(++frameId, callback);
            return frameId;
        });
        vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
        vi.spyOn(performance, 'now').mockImplementation(() => now);
        root = document.createElement('section');
        viewport = document.createElement('div');
        navigation = document.createElement('div');
        navigation.innerHTML = '<button>Search</button>';
        viewport.append(navigation);
        document.body.append(viewport, root);
        vi.spyOn(navigation, 'getBoundingClientRect').mockImplementation(
            () => ({ height: fullHeight }) as DOMRect,
        );
        Object.defineProperties(root, {
            scrollHeight: { get: () => contentHeight },
            clientHeight: { get: () => 800 - headerHeight() },
            scrollTop: {
                get: () => y,
                set: (value: number) => {
                    y = Math.max(0, Math.min(value, contentHeight - root.clientHeight));
                },
            },
        });
        bind();
    });
    afterEach(() => {
        control.dispose();
        expect(frames.size).toBe(0);
        root.remove();
        viewport.remove();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        history.replaceState(null, '');
    });

    it('releases the complete header height while keeping the same product at the same screen position', () => {
        scroll(320);
        const anchor = headerHeight() + 700 - root.scrollTop;
        frame(100);
        expect(headerHeight()).toBeGreaterThan(0);
        expect(headerHeight()).toBeLessThan(fullHeight);
        frame(100);
        expect(collapsed).toBe(true);
        expect(headerHeight()).toBe(0);
        expect(headerHeight() + 700 - root.scrollTop).toBe(anchor);
        // A scroll event caused by compensation cannot reverse the animation.
        root.dispatchEvent(new Event('scroll'));
        frame();
        expect(collapsed).toBe(true);
    });
    it('ignores tiny reversals and restores promptly after a deliberate 12px return', () => {
        collapse();
        scroll(root.scrollTop - 5);
        frame(240);
        expect(collapsed).toBe(true);
        scroll(root.scrollTop - 8);
        frame(240);
        expect(collapsed).toBe(false);
        expect(headerHeight()).toBe(fullHeight);
    });
    it('reverses an unfinished motion from its current height without queuing another collapse', () => {
        scroll(320);
        frame(80);
        const partial = headerHeight();
        scroll(root.scrollTop - 20);
        frame(240);
        expect(partial).toBeGreaterThan(0);
        expect(headerHeight()).toBe(fullHeight);
        expect(collapsed).toBe(false);
        expect(frames.size).toBe(0);
    });
    it('does not react to router restoration, horizontal navigation or a short list', () => {
        scroll(500, false);
        frame(200);
        expect(collapsed).toBe(false);
        navigation.dispatchEvent(new Event('wheel'));
        scroll(550, false);
        frame(200);
        expect(collapsed).toBe(false);
        contentHeight = 500;
        scroll(300);
        frame(200);
        expect(headerHeight()).toBe(fullHeight);
    });
    it('requires leaving the first header-sized region before collapsing', () => {
        scroll(100);
        frame(200);
        expect(collapsed).toBe(false);
        scroll(190);
        frame(200);
        expect(collapsed).toBe(true);
    });
    it('keeps desktop navigation intact and honors reduced motion on mobile', () => {
        control.dispose();
        mobile = false;
        bind();
        scroll(400);
        frame(200);
        expect(viewport.style.height).toBe('160px');
        expect(collapsed).toBe(false);
        control.dispose();
        mobile = true;
        reduced = true;
        y = 0;
        bind();
        scroll(320);
        expect(headerHeight()).toBe(0);
        expect(frames.size).toBe(0);
    });
    it('freezes direction changes behind filters and expands when the category menu needs focus', () => {
        locks.freeze = true;
        control.synchronize();
        scroll(320);
        frame(200);
        expect(collapsed).toBe(false);
        locks.freeze = false;
        control.synchronize();
        scroll(360);
        frame(200);
        expect(collapsed).toBe(true);
        locks.forceExpanded = true;
        control.synchronize();
        frame(240);
        expect(collapsed).toBe(false);
        expect(headerHeight()).toBe(fullHeight);
    });
    it('preserves keyboard focus and fully reveals the first row when returning to the top', () => {
        navigation.querySelector('button')?.focus();
        root.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown' }));
        root.scrollTop = 320;
        root.dispatchEvent(new Event('scroll'));
        frame();
        frame(200);
        expect(collapsed).toBe(false);
        (document.activeElement as HTMLElement).blur();
        scroll(360);
        frame(200);
        expect(collapsed).toBe(true);
        scroll(0);
        frame(240);
        expect(collapsed).toBe(false);
        expect(root.scrollTop).toBe(0);
    });
    it('allows pointer browsing after closing a menu while avoiding repeated position drift', () => {
        root.scrollTop = 320;
        root.dispatchEvent(new Event('scroll'));
        frame();
        navigation.querySelector('button')?.focus();
        for (let index = 0; index < 20; index++) {
            scroll(root.scrollTop + 40);
            frame(200);
            expect(collapsed).toBe(true);
            scroll(root.scrollTop - 40);
            frame(240);
            expect(collapsed).toBe(false);
        }
        expect(root.scrollTop).toBeCloseTo(320, 5);
    });
    it('restores presentation with the existing history entry and resets a new category scope', () => {
        collapse();
        expect(presentation).toEqual({
            scope: 'store-a:category-a',
            collapsed: true,
        });
        control.dispose();
        bind();
        expect(headerHeight()).toBe(0);
        expect(collapsed).toBe(true);
        control.dispose();
        bind('store-a:category-b');
        expect(headerHeight()).toBe(fullHeight);
        expect(collapsed).toBe(false);
    });
    it('does not overwrite a newer history entry while an old page finishes its animation', () => {
        scroll(320);
        history.replaceState({ __TSR_key: 'new-page' }, '');
        frame(200);
        locks.forceExpanded = true;
        control.synchronize();
        frame(240);
        expect(history.state).toEqual({ __TSR_key: 'new-page' });
    });
    it('recomputes real header height without treating viewport changes as scroll intent', () => {
        collapse();
        fullHeight = 200;
        window.dispatchEvent(new Event('resize'));
        expect(headerHeight()).toBe(0);
        expect(collapsed).toBe(true);
        scroll(root.scrollTop - 20);
        frame(240);
        expect(headerHeight()).toBe(200);
    });
    it('releases animation work when the page leaves', () => {
        scroll(320);
        frame(20);
        control.dispose();
        expect(frames.size).toBe(0);
    });
});
