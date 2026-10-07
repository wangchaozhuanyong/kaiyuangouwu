// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDeferredStorefrontUi } from './storefront-deferred-ui';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('noncritical UI readiness and idle boundary', () => {
    let root: ReturnType<typeof createRoot>;
    let ready = false;
    let visibility: DocumentVisibilityState;
    let state: DocumentReadyState;
    const pending = new Map<number, IdleRequestCallback>();
    let next = 0;
    function Harness({ enabled, owner }: { enabled: boolean; owner: string }) {
        ready = useDeferredStorefrontUi(enabled, owner);
        return null;
    }
    const render = (enabled = true, owner = 'home') =>
        act(() => root.render(<Harness enabled={enabled} owner={owner} />));
    const idle = () =>
        act(() => {
            const callbacks = [...pending.values()];
            pending.clear();
            callbacks.forEach(callback => callback({ didTimeout: false, timeRemaining: () => 50 }));
        });
    beforeEach(() => {
        vi.useFakeTimers();
        visibility = 'visible';
        state = 'loading';
        ready = false;
        next = 0;
        pending.clear();
        vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
        vi.spyOn(document, 'readyState', 'get').mockImplementation(() => state);
        vi.stubGlobal(
            'requestIdleCallback',
            vi.fn((callback: IdleRequestCallback) => {
                pending.set(++next, callback);
                return next;
            }),
        );
        vi.stubGlobal(
            'cancelIdleCallback',
            vi.fn((id: number) => pending.delete(id)),
        );
        root = createRoot(document.createElement('div'));
    });
    afterEach(() => {
        act(() => root.unmount());
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });
    it('requires page readiness followed by idle, and deduplicates page-ready/load signals', () => {
        render();
        expect(ready).toBe(false);
        expect(pending.size).toBe(0);
        act(() => {
            document.dispatchEvent(new Event('storefront:page-ready'));
            window.dispatchEvent(new Event('load'));
        });
        expect(ready).toBe(false);
        expect(pending.size).toBe(1);
        idle();
        expect(ready).toBe(true);
        render(true, 'category');
        expect(ready).toBe(true);
        expect(pending.size).toBe(0);
    });
    it('uses a bounded deferred task after load when idle callbacks are unavailable', () => {
        vi.stubGlobal('requestIdleCallback', undefined);
        state = 'complete';
        render();
        expect(ready).toBe(false);
        act(() => {
            vi.advanceTimersByTime(249);
        });
        expect(ready).toBe(false);
        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(ready).toBe(true);
    });
    it('cancels a hidden document task and resumes only when visible', () => {
        state = 'complete';
        render();
        expect(pending.size).toBe(1);
        act(() => {
            visibility = 'hidden';
            document.dispatchEvent(new Event('visibilitychange'));
        });
        expect(pending.size).toBe(0);
        expect(ready).toBe(false);
        act(() => {
            visibility = 'visible';
            document.dispatchEvent(new Event('visibilitychange'));
        });
        expect(pending.size).toBe(1);
        idle();
        expect(ready).toBe(true);
    });
    it('cancels replaced, disabled, and unmounted ownership tasks and ignores late callbacks', () => {
        state = 'complete';
        render();
        const first = [...pending.values()][0];
        render(true, 'product');
        expect(pending.size).toBe(1);
        act(() => first({ didTimeout: false, timeRemaining: () => 50 }));
        expect(ready).toBe(false);
        render(false, 'product');
        expect(pending.size).toBe(0);
        expect(ready).toBe(false);
        render(true, 'product');
        expect(pending.size).toBe(1);
        act(() => root.unmount());
        expect(pending.size).toBe(0);
        root = createRoot(document.createElement('div'));
    });
    it('pauses scheduling on pagehide and resumes idle loading when BFCache restores the page', () => {
        state = 'complete';
        render();
        expect(pending.size).toBe(1);
        act(() => {
            window.dispatchEvent(new Event('pagehide'));
        });
        expect(pending.size).toBe(0);
        act(() => {
            window.dispatchEvent(new Event('load'));
        });
        expect(pending.size).toBe(0);
        expect(ready).toBe(false);
        act(() => {
            window.dispatchEvent(new Event('pageshow'));
        });
        expect(pending.size).toBe(1);
        idle();
        expect(ready).toBe(true);
    });
});

it('captures raw initial resources once and never adds later route CSS or modulepreloads', async () => {
    vi.resetModules();
    document.head.innerHTML =
        '<script type="module" src="/assets/entry.js"></script><link rel="stylesheet" href="/assets/entry.css"><link rel="modulepreload" href="/assets/vendor.js">';
    const module = await import('./storefront-deferred-ui');
    document.head.insertAdjacentHTML('beforeend', '<link rel="stylesheet" href="/assets/lazy-route.css">');
    expect(module.initialStorefrontAssetReferences).toEqual(['/assets/entry.js', '/assets/entry.css']);
    document.head.innerHTML = '';
});
