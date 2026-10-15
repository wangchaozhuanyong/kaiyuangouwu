// @vitest-environment jsdom
import type { AnyRouter } from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { trackStorefrontRouteFocus } from './route-focus';

function setup() {
    const listeners = new Map<string, (event: any) => void>();
    let historyListener: (event: any) => void = () => undefined;
    const state = { location: { href: '/zh/category' } };
    const router = {
        state,
        subscribe: (name: string, fn: (event: any) => void) => {
            listeners.set(name, fn);
            return () => {
                listeners.delete(name);
            };
        },
        history: {
            subscribe: (fn: (event: any) => void) => {
                historyListener = fn;
                return () => undefined;
            },
        },
    };
    const dispose = trackStorefrontRouteFocus(router as unknown as AnyRouter);
    const location = (href: string) => {
        const url = new URL(href, 'https://fixture.invalid');
        return { href, pathname: url.pathname, search: Object.fromEntries(url.searchParams) };
    };
    const start = (from: string, to: string, action = 'PUSH') => {
        historyListener({ action: { type: action } });
        listeners.get('onBeforeNavigate')?.({ fromLocation: location(from), toLocation: location(to) });
        state.location = { href: to };
    };
    const commit = (href: string) => listeners.get('onRendered')?.({ toLocation: location(href) });
    return { dispose, start, commit };
}
afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.useRealTimers();
});
function page() {
    document.body.innerHTML =
        '<a id="source" href="/zh/product?id=2">Product</a>' +
        '<div data-route="product"><div id="storefront-content" tabindex="-1"><h1>New product</h1><button>Buy</button></div></div>';
    requiredElement<HTMLAnchorElement>('#source').focus();
    const heading = requiredElement<HTMLHeadingElement>('h1');
    vi.spyOn(heading, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    return heading;
}
function requiredElement<T extends Element>(selector: string) {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Expected the route focus fixture element: ${selector}`);
    return element;
}
const flush = () => vi.runAllTimers();
describe('committed route focus', () => {
    it('falls back to the content anchor when the heading is hidden by responsive CSS', () => {
        vi.useFakeTimers();
        const heading = page();
        const t = setup();
        vi.spyOn(heading, 'getClientRects').mockReturnValue([] as unknown as DOMRectList);
        t.start('/zh/category', '/zh/product?id=2');
        t.commit('/zh/product?id=2');
        flush();
        expect(document.activeElement).toBe(document.getElementById('storefront-content'));
        t.dispose();
    });
    it('focuses the heading after commit and preserves scroll', () => {
        vi.useFakeTimers();
        const heading = page();
        const focus = vi.spyOn(heading, 'focus');
        const t = setup();
        t.start('/zh/product?id=1', '/zh/product?id=2');
        expect(focus).not.toHaveBeenCalled();
        t.commit('/zh/product?id=2');
        flush();
        expect(document.activeElement).toBe(heading);
        expect(focus).toHaveBeenCalledWith({ preventScroll: true });
        requiredElement<HTMLButtonElement>('button').focus();
        expect(heading.hasAttribute('tabindex')).toBe(false);
        t.dispose();
    });
    it.each([
        ['/zh/category?sort=price-asc', '/zh/category?sort=price-desc'],
        ['/zh/product?id=2', '/zh/product?id=2&variantId=5'],
        ['/zh/search?term=a', '/zh/search?term=b'],
        ['/zh/product?id=2', '/zh/product?id=2&auth=login'],
    ])('preserves focus for same-page state %s -> %s', (from, to) => {
        vi.useFakeTimers();
        page();
        const t = setup();
        const source = document.activeElement;
        t.start(from, to);
        t.commit(to);
        flush();
        expect(document.activeElement).toBe(source);
        t.dispose();
    });
    it('ignores initial, background and canceled renders', () => {
        vi.useFakeTimers();
        page();
        const t = setup();
        const source = document.activeElement;
        t.commit('/zh/product?id=2');
        flush();
        expect(document.activeElement).toBe(source);
        t.start('/zh/category', '/zh/product?id=1');
        t.start('/zh/category', '/zh/product?id=2');
        t.commit('/zh/product?id=1');
        flush();
        expect(document.activeElement).toBe(source);
        t.dispose();
        t.commit('/zh/product?id=2');
        flush();
        expect(document.activeElement).toBe(source);
    });
    it.each(['BACK', 'FORWARD', 'GO'])('preserves native %s context', action => {
        vi.useFakeTimers();
        page();
        const t = setup();
        const source = document.activeElement;
        t.start('/zh/category', '/zh/product?id=2', action);
        t.commit('/zh/product?id=2');
        flush();
        expect(document.activeElement).toBe(source);
        t.dispose();
    });
    it('respects dialogs and a user focus change while waiting', () => {
        vi.useFakeTimers();
        const heading = page();
        const focus = vi.spyOn(heading, 'focus');
        const t = setup();
        t.start('/zh/category', '/zh/product?id=2');
        requiredElement<HTMLButtonElement>('button').focus();
        t.commit('/zh/product?id=2');
        flush();
        expect(focus).not.toHaveBeenCalled();
        t.start('/zh/category', '/zh/product?id=2');
        document.body.insertAdjacentHTML('beforeend', '<div role="dialog" aria-modal="true">Dialog</div>');
        t.commit('/zh/product?id=2');
        flush();
        expect(focus).not.toHaveBeenCalled();
        t.dispose();
    });
});
