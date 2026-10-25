// @vitest-environment jsdom
import { lazyRouteComponent } from '@tanstack/react-router';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(join(__dirname, '../public/storefront/document-loading.js'), 'utf8');
vi.mock('@tanstack/router-core/isServer', () => ({ isServer: false }));

describe('document startup feedback without hiding available content', () => {
    const cleanup: Array<() => void> = [];
    const reload = vi.fn();
    const history = { scrollRestoration: 'manual' };
    beforeEach(() => {
        vi.useFakeTimers();
        reload.mockClear();
        sessionStorage.clear();
        history.scrollRestoration = 'manual';
        vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete');
        document.documentElement.lang = 'zh-CN';
        document.body.innerHTML = `
            <div id="root" data-public-rendered="1">
                <main data-page-readiness="ready"><a href="/category">Catalog</a><button>Action</button></main>
            </div>
            <main id="storefront-boot-loading">
                <span class="brand-loading">
                    <strong class="brand-loading-name">当前店铺</strong>
                    <span class="brand-loading-label">正在连接</span>
                    <span class="brand-loading-bar"><i></i></span>
                </span>
            </main>`;
    });
    function start(search = '') {
        const target = (owner: Document | Window) => ({
            addEventListener(
                name: string,
                listener: EventListener,
                options?: AddEventListenerOptions | boolean,
            ) {
                owner.addEventListener(name, listener, options);
                cleanup.push(() => owner.removeEventListener(name, listener, options));
            },
            removeEventListener(
                name: string,
                listener: EventListener,
                options?: EventListenerOptions | boolean,
            ) {
                owner.removeEventListener(name, listener, options);
            },
        });
        runInNewContext(source, {
            document: {
                documentElement: document.documentElement,
                get readyState() {
                    return document.readyState;
                },
                getElementById: (id: string) => document.getElementById(id),
                querySelector: (selector: string) => document.querySelector(selector),
                createElement: (tag: string) => document.createElement(tag),
                ...target(document),
            },
            window: target(window),
            sessionStorage,
            history,
            location: { search, reload },
            URLSearchParams,
            setTimeout,
            clearTimeout,
        });
    }
    afterEach(() => {
        cleanup.splice(0).forEach(dispose => dispose());
        for (const name of [
            'data-storefront-boot-pending',
            'data-storefront-boot-error',
            'data-storefront-app-owned',
        ])
            document.documentElement.removeAttribute(name);
        document.body.innerHTML = '';
        vi.restoreAllMocks();
        vi.useRealTimers();
    });
    const active = () => document.documentElement.hasAttribute('data-storefront-boot-pending');
    const boot = () => document.getElementById('storefront-boot-loading');
    const root = () => {
        const element = document.getElementById('root');
        if (!element) throw new Error('Fixture root is missing');
        return element;
    };
    const owned = () => {
        document.documentElement.setAttribute('data-storefront-app-owned', '');
        document.dispatchEvent(new Event('storefront:app-owned'));
    };

    it.each([
        'Failed to fetch dynamically imported module: https://store.test/assets/route-12345678.js',
        'error loading dynamically imported module: https://store.test/assets/route-12345678.js',
        'Importing a module script failed.',
    ])(
        'keeps the actual TanStack lazy component on manual recovery after app ownership: %s',
        async message => {
            start();
            owned();
            const error = new TypeError(message);
            const event = Object.assign(new Event('vite:preloadError', { cancelable: true }), {
                payload: error,
            });
            window.dispatchEvent(event);
            expect(event.defaultPrevented).toBe(false);
            expect(event.payload).toBe(error);
            expect(sessionStorage.getItem('tanstack_router_reload:' + message)).toBe('1');
            const Lazy = lazyRouteComponent(() => Promise.reject<{ default: () => null }>(error));
            await Lazy.preload?.();
            expect(() => Lazy({})).toThrow(error);
            expect(active()).toBe(false);
            expect(root().hasChildNodes()).toBe(true);
        },
    );

    it('does not convert unrelated data errors into module recovery state', () => {
        start();
        owned();
        window.dispatchEvent(
            Object.assign(new Event('vite:preloadError'), { payload: new Error('Read failed') }),
        );
        expect(sessionStorage.length).toBe(0);
        expect(reload).not.toHaveBeenCalled();
    });

    it('hands full-document restoration back to the browser before replacement', () => {
        start();
        owned();
        window.dispatchEvent(new Event('beforeunload'));
        expect(history.scrollRestoration).toBe('manual');
        window.dispatchEvent(new Event('pagehide'));
        expect(history.scrollRestoration).toBe('auto');
        expect(root().hasChildNodes()).toBe(true);
        expect(root().inert).not.toBe(true);
    });

    it('returns a resumed document to Router restoration without replaying startup', () => {
        start();
        owned();
        window.dispatchEvent(new Event('pagehide'));
        expect(history.scrollRestoration).toBe('auto');
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        expect(history.scrollRestoration).toBe('manual');
        expect(active()).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('leaves an unowned document on native restoration until Router starts', () => {
        start();
        window.dispatchEvent(new Event('pagehide'));
        window.dispatchEvent(new PageTransitionEvent('pageshow'));
        expect(history.scrollRestoration).toBe('auto');
    });
    function leave(cancelled = false) {
        const event = new Event('beforeunload', { cancelable: true });
        if (cancelled) event.preventDefault();
        window.dispatchEvent(event);
        return event;
    }
    function failScript(async = false) {
        const script = document.createElement('script');
        script.type = 'module';
        script.async = async;
        script.src = '/assets/main.js';
        document.head.append(script);
        script.dispatchEvent(new Event('error'));
        script.remove();
    }

    it('retains SSR content and native links, then gives slow startup compact feedback', async () => {
        const main = root().firstElementChild;
        start();
        expect(active()).toBe(false);
        expect(root().inert).not.toBe(true);
        expect(root().hidden).toBe(false);
        await vi.advanceTimersByTimeAsync(200);
        expect(active()).toBe(true);
        expect(boot()?.getAttribute('data-presentation')).toBe('status');
        expect(root().firstElementChild).toBe(main);
        expect(root().querySelector('a')?.closest('[inert], [hidden]')).toBeNull();
        owned();
        expect(active()).toBe(false);
        expect(boot()?.getAttribute('aria-hidden')).toBe('true');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('uses full branding only while the document is actually empty', () => {
        root().replaceChildren();
        start();
        expect(active()).toBe(true);
        expect(boot()?.getAttribute('data-presentation')).toBe('initial');
        expect(boot()?.textContent).toContain('当前店铺');
        owned();
        expect(boot()?.getAttribute('aria-busy')).toBe('false');
    });
    it('gives an attempted JS action startup feedback without replaying it, while native links stay free', () => {
        start();
        const action = root().querySelector('button');
        const handler = vi.fn();
        action?.addEventListener('click', handler);
        action?.click();
        expect(handler).not.toHaveBeenCalled();
        expect(active()).toBe(true);
        expect(boot()?.textContent).toContain('交互正在准备');
        const nativeClick = new MouseEvent('click', { bubbles: true, cancelable: true });
        root().querySelector('a')?.setAttribute('href', '#catalog');
        root().querySelector('a')?.dispatchEvent(nativeClick);
        expect(nativeClick.defaultPrevented).toBe(false);
        owned();
        action?.click();
        expect(handler).toHaveBeenCalledOnce();
        expect(root().inert).not.toBe(true);
    });
    it('prevents unattached forms from submitting and releases the guard after the real handoff', () => {
        const form = document.createElement('form');
        root().append(form);
        start();
        const early = new Event('submit', { bubbles: true, cancelable: true });
        form.dispatchEvent(early);
        expect(early.defaultPrevented).toBe(true);
        expect(boot()?.textContent).toContain('交互正在准备');
        owned();
        const later = new Event('submit', { bubbles: true, cancelable: true });
        form.dispatchEvent(later);
        expect(later.defaultPrevented).toBe(false);
    });

    it('does not treat server ready markers or data events as an actual client handoff', async () => {
        start();
        document.dispatchEvent(new Event('storefront:page-ready'));
        await vi.advanceTimersByTimeAsync(200);
        expect(active()).toBe(true);
        owned();
        expect(active()).toBe(false);
        // A later local read never restarts document startup feedback.
        document.dispatchEvent(new Event('storefront:page-ready'));
        await vi.advanceTimersByTimeAsync(10_000);
        expect(active()).toBe(false);
        expect(document.getElementById('storefront-boot-error')).toBeNull();
    });

    it('keeps the old document usable throughout refresh, cancellation and back/forward', async () => {
        start();
        owned();
        const main = root().firstElementChild;
        for (const cancelled of [false, true]) {
            expect(leave(cancelled).defaultPrevented).toBe(cancelled);
            await vi.advanceTimersByTimeAsync(10_000);
            expect(active()).toBe(false);
            expect(root().inert).not.toBe(true);
            expect(root().firstElementChild).toBe(main);
        }
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        expect(active()).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('hands off to React error UI without covering its retry controls', () => {
        start();
        document.dispatchEvent(new Event('storefront:page-error'));
        expect(active()).toBe(false);
        expect(root().inert).not.toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('stops a stalled startup at ten seconds with usable recovery alongside the retained content', async () => {
        start();
        await vi.advanceTimersByTimeAsync(9999);
        expect(document.getElementById('storefront-boot-error')).toBeNull();
        await vi.advanceTimersByTimeAsync(1);
        expect(active()).toBe(true);
        expect(boot()?.getAttribute('data-presentation')).toBe('status');
        expect(boot()?.getAttribute('aria-busy')).toBe('false');
        expect(root().inert).not.toBe(true);
        expect(root().querySelector('a')?.textContent).toBe('Catalog');
        const retry = document.querySelector<HTMLButtonElement>('#storefront-boot-error button');
        expect(retry?.textContent).toBe('重新加载');
        expect(retry?.disabled).toBe(false);
        retry?.click();
        expect(reload).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('reports entry failure, while image and optional bootstrap failures stay local', () => {
        start();
        document.documentElement.lang = 'en';
        const image = document.createElement('img');
        document.body.append(image);
        image.dispatchEvent(new Event('error'));
        failScript(true);
        expect(document.getElementById('storefront-boot-error')).toBeNull();
        failScript();
        expect(document.getElementById('storefront-boot-error')?.textContent).toContain(
            'Interactive controls could not start.',
        );
        expect(document.querySelector('#storefront-boot-error button')?.textContent).toBe('Reload page');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('can present an entry failure that happened before its feedback node was parsed', () => {
        vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
        const nodes = Array.from(document.body.childNodes);
        document.body.replaceChildren();
        start();
        failScript();
        document.body.append(...nodes);
        document.dispatchEvent(new Event('DOMContentLoaded'));
        expect(document.querySelectorAll('#storefront-boot-error')).toHaveLength(1);
        expect(boot()?.getAttribute('aria-busy')).toBe('false');
    });

    it('removes startup failures after a late real commit and never observes later route resources', async () => {
        start();
        await vi.advanceTimersByTimeAsync(10_000);
        expect(document.getElementById('storefront-boot-error')).not.toBeNull();
        owned();
        expect(document.getElementById('storefront-boot-error')).toBeNull();
        expect(active()).toBe(false);
        failScript();
        expect(document.getElementById('storefront-boot-error')).toBeNull();
    });

    it('does not restart startup if the deferred script arrives after React owns the page', async () => {
        owned();
        start();
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(active()).toBe(false);
    });

    it('leaves embedded previews to their own lifecycle', () => {
        start('?storefrontPreviewEmbedded=1');
        window.dispatchEvent(new Event('pagehide'));
        expect(history.scrollRestoration).toBe('manual');
        expect(active()).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('ships a nonblocking startup script and no root-hiding CSS rule', () => {
        const html = readFileSync(join(__dirname, '../index.html'), 'utf8');
        const css = readFileSync(join(__dirname, './styles/skeletons.css'), 'utf8');
        expect(html).toMatch(/<script defer src="\/storefront\/document-loading\.js\?v=[^"]+">/u);
        expect(html.indexOf('<div id="root">')).toBeLessThan(html.indexOf('id="storefront-boot-loading"'));
        expect(html + css).not.toMatch(/boot-pending[^{}]*#root\s*\{[^}]*visibility:\s*hidden/u);
        expect(source).not.toMatch(/root\.inert\s*=\s*true/u);
    });
});
