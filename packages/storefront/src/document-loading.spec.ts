// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(join(__dirname, '../public/storefront/document-loading.js'), 'utf8');

describe('document loading feedback across a real page lifecycle', () => {
    const cleanup: Array<() => void> = [];
    const reload = vi.fn();
    beforeEach(() => {
        vi.useFakeTimers();
        reload.mockClear();
        document.documentElement.lang = 'zh-CN';
        document.body.innerHTML = `
            <main id="storefront-boot-loading">
                <span class="brand-loading">
                    <strong class="brand-loading-name">当前店铺</strong>
                    <span class="brand-loading-bar"><i></i></span>
                </span>
            </main>
            <div id="root" data-public-rendered="1">
                <main data-page-readiness="ready">Server page</main>
            </div>`;
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
                getElementById: (id: string) => document.getElementById(id),
                createElement: (tag: string) => document.createElement(tag),
                ...target(document),
            },
            window: target(window),
            location: { search: '', reload },
            URLSearchParams,
            queueMicrotask,
            setTimeout,
            clearTimeout,
        });
    });
    afterEach(() => {
        cleanup.splice(0).forEach(dispose => dispose());
        document.documentElement.removeAttribute('data-storefront-boot-pending');
        document.documentElement.removeAttribute('data-storefront-boot-error');
        document.body.innerHTML = '';
        vi.useRealTimers();
    });
    const active = () => document.documentElement.hasAttribute('data-storefront-boot-pending');
    const ready = () => document.dispatchEvent(new Event('storefront:page-ready'));
    async function leave(cancelled = false) {
        const event = new Event('beforeunload', { cancelable: true });
        Object.defineProperty(event, 'returnValue', { value: '', writable: true });
        if (cancelled) event.preventDefault();
        window.dispatchEvent(event);
        await Promise.resolve();
        return event;
    }
    it('keeps SSR controls inert until the client commits instead of treating HTML ready as interactive', () => {
        document.dispatchEvent(new Event('DOMContentLoaded'));
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
        expect(active()).toBe(true);
        expect(document.getElementById('root')?.inert).toBe(true);
        ready();
        expect(active()).toBe(false);
        expect(document.getElementById('root')?.inert).toBe(false);
        expect(document.getElementById('storefront-boot-loading')?.getAttribute('aria-busy')).toBe('false');
    });
    it('shows the retained loader during document navigation without cancelling it or being dismissed by old reads', async () => {
        ready();
        const event = await leave();
        expect(event.defaultPrevented).toBe(false);
        expect(active()).toBe(true);
        ready();
        expect(active()).toBe(true);
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        expect(active()).toBe(false);
        expect(document.getElementById('root')?.inert).toBe(false);
    });
    it('preserves the usable page when document navigation is cancelled', async () => {
        ready();
        await leave(true);
        expect(active()).toBe(false);
        await leave();
        window.dispatchEvent(new Event('focus'));
        expect(active()).toBe(false);
        await leave();
        await vi.advanceTimersByTimeAsync(10_000);
        expect(active()).toBe(false);
    });
    it('hands off to the existing failure surface instead of leaving a moving loader over retry controls', () => {
        document.dispatchEvent(new Event('storefront:page-error'));
        expect(active()).toBe(false);
        expect(document.getElementById('root')?.inert).toBe(false);
    });

    it('stops a stalled startup after the existing ten-second deadline and keeps the confirmed brand with usable recovery', async () => {
        await vi.advanceTimersByTimeAsync(9999);
        expect(document.getElementById('storefront-boot-error')).toBeNull();
        await vi.advanceTimersByTimeAsync(1);
        expect(active()).toBe(true);
        expect(document.documentElement.hasAttribute('data-storefront-boot-error')).toBe(true);
        expect(document.querySelector('.brand-loading-name')?.textContent).toBe('当前店铺');
        expect(document.getElementById('storefront-boot-loading')?.getAttribute('aria-busy')).toBe('false');
        expect(document.getElementById('root')?.inert).toBe(true);
        const retry = document.querySelector<HTMLButtonElement>('#storefront-boot-error button');
        expect(retry?.textContent).toBe('重新加载');
        expect(retry?.disabled).toBe(false);
        expect(retry?.closest('[inert]')).toBeNull();
        retry?.click();
        expect(reload).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('reports failed module resources immediately while ordinary failed images stay local', () => {
        document.documentElement.lang = 'en';
        const image = document.createElement('img');
        document.body.append(image);
        image.dispatchEvent(new Event('error'));
        expect(document.getElementById('storefront-boot-error')).toBeNull();
        const earlyEntry = document.createElement('script');
        earlyEntry.type = 'module';
        earlyEntry.async = true;
        earlyEntry.src = '/assets/public-page-bootstrap.js';
        document.head.append(earlyEntry);
        earlyEntry.dispatchEvent(new Event('error'));
        expect(document.getElementById('storefront-boot-error')).toBeNull();
        earlyEntry.remove();
        const script = document.createElement('script');
        script.type = 'module';
        script.src = '/assets/main.js';
        document.head.append(script);
        script.dispatchEvent(new Event('error'));
        expect(document.getElementById('storefront-boot-error')?.textContent).toContain(
            'This page could not be loaded. Try again.',
        );
        expect(document.querySelector('#storefront-boot-error button')?.textContent).toBe('Reload page');
        expect(document.querySelector('.brand-loading-name')?.textContent).toBe('当前店铺');
        expect(vi.getTimerCount()).toBe(0);
        script.remove();
    });

    it('can present a module failure that happened before the startup stage was parsed', () => {
        const initialNodes = Array.from(document.body.childNodes);
        document.body.replaceChildren();
        const script = document.createElement('script');
        script.type = 'module';
        script.src = '/assets/main.js';
        document.head.append(script);
        script.dispatchEvent(new Event('error'));
        expect(document.documentElement.hasAttribute('data-storefront-boot-error')).toBe(true);
        document.body.append(...initialNodes);
        document.dispatchEvent(new Event('DOMContentLoaded'));
        expect(document.querySelector('#storefront-boot-error button')).not.toBeNull();
        expect(document.querySelectorAll('#storefront-boot-error')).toHaveLength(1);
        expect(document.getElementById('storefront-boot-loading')?.getAttribute('aria-busy')).toBe('false');
        script.remove();
    });

    it('clears the startup watchdog and resource observer when React owns the document', async () => {
        ready();
        expect(vi.getTimerCount()).toBe(0);
        const script = document.createElement('script');
        script.type = 'module';
        script.src = '/assets/later-route.js';
        document.head.append(script);
        script.dispatchEvent(new Event('error'));
        await vi.advanceTimersByTimeAsync(10_000);
        expect(document.getElementById('storefront-boot-error')).toBeNull();
        expect(active()).toBe(false);
        script.remove();
    });

    it('recovers from the startup error if the real route subsequently commits', async () => {
        await vi.advanceTimersByTimeAsync(10_000);
        expect(document.getElementById('storefront-boot-error')).not.toBeNull();
        ready();
        expect(active()).toBe(false);
        expect(document.documentElement.hasAttribute('data-storefront-boot-error')).toBe(false);
        expect(document.getElementById('storefront-boot-error')).toBeNull();
        expect(document.getElementById('root')?.inert).toBe(false);
        await leave();
        expect(active()).toBe(true);
        expect(document.getElementById('storefront-boot-error')).toBeNull();
        expect(document.getElementById('storefront-boot-loading')?.getAttribute('aria-busy')).toBe('true');
    });

    it('respects cancellation from a later beforeunload listener before presenting any wait', async () => {
        ready();
        const cancel = (event: Event) => event.preventDefault();
        window.addEventListener('beforeunload', cancel);
        try {
            const event = await leave();
            expect(event.defaultPrevented).toBe(true);
            expect(active()).toBe(false);
            expect(document.getElementById('root')?.inert).toBe(false);
        } finally {
            window.removeEventListener('beforeunload', cancel);
        }
    });
});
