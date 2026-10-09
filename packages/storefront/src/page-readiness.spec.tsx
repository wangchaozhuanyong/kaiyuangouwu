// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PageReadinessBoundary, usePageReadiness } from './page-readiness';
import { PageSkeleton, RouteTransitionLoader } from './route-loading';
import { StorefrontContext, type StorefrontContextValue } from './StorefrontContext';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function RequiredQuery({ pending }: { pending: boolean }) {
    usePageReadiness(pending);
    return (
        <main>
            <button>Action</button>
            {pending ? 'Target query pending' : 'Target content'}
        </main>
    );
}
beforeAll(async () => {
    await vi.dynamicImportSettled();
});

describe('explicit route readiness', () => {
    let host: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;
    beforeEach(() => {
        vi.useFakeTimers();
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
    });
    afterEach(() => {
        act(() => root.unmount());
        host.remove();
        vi.useRealTimers();
    });
    const retry = vi.fn();
    function render(
        queryPending = false,
        key = 'category',
        pending = false,
        online = true,
        image = false,
        navigationPreparing = false,
    ) {
        act(() =>
            root.render(
                <PageReadinessBoundary
                    requestKey={key}
                    pending={pending}
                    navigationPreparing={navigationPreparing}
                    online={online}
                    language="zh"
                    onRetry={retry}
                    onBack={vi.fn()}
                >
                    <RequiredQuery pending={queryPending} />
                    {image && <img src="/never-loaded.webp" alt="Product" />}
                </PageReadinessBoundary>,
            ),
        );
    }
    const phase = () => host.querySelector('[data-page-readiness]')?.getAttribute('data-page-readiness');
    const advance = (ms: number) =>
        act(async () => {
            await vi.advanceTimersByTimeAsync(ms);
        });
    it('holds readiness for the target query regardless of geometry and uses one delayed accessible status', async () => {
        render(true);
        expect(phase()).toBe('preparing');
        expect(host.querySelectorAll('.page-readiness-progress')).toHaveLength(0);
        await advance(220);
        expect(host.querySelectorAll('[role=status]')).toHaveLength(1);
        expect(host.querySelector('[role=status]')?.className).toBe('visually-hidden');
        expect(host.querySelector('.page-readiness-progress')).toBeNull();
        render(false);
        expect(phase()).toBe('ready');
        expect(host.querySelector('.page-readiness-progress')).toBeNull();
    });
    it('does not wait for images, cached content or DOM pending-marker remnants', async () => {
        render(false, 'cached', false, true, true);
        await advance(400);
        expect(phase()).toBe('ready');
        expect(host.querySelector('.page-readiness-progress')).toBeNull();
        expect(host.querySelector('img')?.complete).toBe(false);
    });
    it('starts a new query requirement after a previously ready module', async () => {
        render();
        expect(phase()).toBe('ready');
        render(true);
        await advance(250);
        expect(phase()).toBe('preparing');
        expect(host.querySelectorAll('[role=status]')).toHaveLength(1);
        expect(host.querySelector('[role=status]')?.className).toBe('visually-hidden');
        expect(host.querySelector('.page-readiness-progress')).toBeNull();
    });
    it('times out without hiding or disabling the existing page, and recovers on late data', async () => {
        render(true);
        host.querySelector('button')?.focus();
        await advance(10_100);
        expect(phase()).toBe('error');
        expect(host.querySelector('[role=alert]')?.textContent).toContain('超时');
        expect(host.querySelector('.page-readiness-stage')?.hasAttribute('inert')).toBe(false);
        expect(document.activeElement?.textContent).toBe('Action');
        render(false);
        expect(phase()).toBe('ready');
        expect(host.querySelector('[role=alert]')).toBeNull();
    });
    it('gives a new filter its own deadline and cancels the previous deadline', async () => {
        render(true, 'empty-a');
        await advance(9000);
        render(true, 'products-b');
        await advance(2000);
        expect(phase()).toBe('preparing');
        render(false, 'products-b');
        await advance(9000);
        expect(phase()).toBe('ready');
    });
    it('handles offline required data but leaves available data usable offline', () => {
        render(true, 'offline', false, false);
        expect(phase()).toBe('error');
        expect(host.textContent).toContain('网络不可用');
        render(false, 'offline', false, false);
        expect(phase()).toBe('ready');
    });
    it('waits for route code in the same readiness boundary', async () => {
        render(false, 'module', true);
        await advance(250);
        expect(phase()).toBe('preparing');
        render(false, 'module', false);
        expect(phase()).toBe('ready');
    });
    it('retains content and shows compact branding only while product preparation is pending', async () => {
        render(false);
        expect(phase()).toBe('ready');
        render(false, 'product', false, true, false, true);
        expect(phase()).toBe('preparing');
        expect(host.querySelector('main')?.textContent).toContain('Target content');
        expect(host.querySelector('.page-readiness-stage')?.hasAttribute('inert')).toBe(false);
        await act(async () => {
            await vi.dynamicImportSettled();
        });
        expect(host.querySelectorAll('.page-readiness-navigation')).toHaveLength(1);
        expect(host.querySelector('.brand-loading--compact')).not.toBeNull();
        expect(host.querySelector('[aria-label="正在打开商品"]')).not.toBeNull();
        expect(host.querySelector('.page-readiness-progress')).toBeNull();
        render(false, 'product');
        expect(phase()).toBe('ready');
        expect(host.querySelector('.page-readiness-navigation')).toBeNull();
    });
    it('retains skeleton readiness registration and emits page-ready when its token is released', () => {
        const ready = vi.fn();
        document.addEventListener('storefront:page-ready', ready);
        const skeleton = (loading: boolean) =>
            act(() =>
                root.render(
                    <PageReadinessBoundary
                        requestKey="route"
                        pending={false}
                        online
                        language="zh"
                        onRetry={retry}
                        onBack={vi.fn()}
                    >
                        {loading ? <PageSkeleton /> : <main>Loaded</main>}
                    </PageReadinessBoundary>,
                ),
            );
        try {
            skeleton(true);
            expect(phase()).toBe('preparing');
            expect(ready).not.toHaveBeenCalled();
            skeleton(false);
            expect(phase()).toBe('ready');
            expect(ready).toHaveBeenCalledTimes(1);
        } finally {
            document.removeEventListener('storefront:page-ready', ready);
        }
    });
});

describe('store-scoped initial loading and recovery', () => {
    let host: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;
    let retry: ReturnType<typeof vi.fn<() => void>>;
    let back: ReturnType<typeof vi.fn<() => void>>;
    beforeEach(() => {
        vi.useFakeTimers();
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        retry = vi.fn();
        back = vi.fn();
    });
    afterEach(() => {
        act(() => root.unmount());
        host.remove();
        vi.useRealTimers();
    });
    function render({
        scope = 'store-a',
        request = 'home',
        loading = true,
        compact = false,
        routeModule = false,
        pending = false,
        online = true,
        language = 'zh',
        initialError = false,
    }: {
        scope?: string;
        request?: string;
        loading?: boolean;
        compact?: boolean;
        routeModule?: boolean;
        pending?: boolean;
        online?: boolean;
        language?: 'zh' | 'en';
        initialError?: boolean;
    } = {}) {
        act(() =>
            root.render(
                <StorefrontContext.Provider
                    value={
                        {
                            storefrontName: scope,
                            storefrontCode: scope,
                            logoUrl: `/${scope}.svg`,
                            language,
                        } as StorefrontContextValue
                    }
                >
                    <PageReadinessBoundary
                        initialScopeKey={scope}
                        initialError={initialError}
                        requestKey={request}
                        pending={pending}
                        online={online}
                        language={language}
                        onRetry={retry}
                        onBack={back}
                    >
                        <header>
                            <button>Store navigation</button>
                        </header>
                        {loading ? (
                            routeModule ? (
                                <RouteTransitionLoader language={language} />
                            ) : (
                                <PageSkeleton compact={compact} language={language} />
                            )
                        ) : (
                            <main>
                                <button>Available content</button>
                            </main>
                        )}
                    </PageReadinessBoundary>
                </StorefrontContext.Provider>,
            ),
        );
    }
    const advance = (ms: number) =>
        act(async () => {
            await vi.advanceTimersByTimeAsync(ms);
        });
    const stage = () => host.querySelector<HTMLElement>('.page-readiness-stage');
    const initial = () => host.querySelector('.page-readiness-initial');
    const phase = () => host.querySelector('[data-page-readiness]')?.getAttribute('data-page-readiness');

    it('keeps the shell mounted but hidden from first paint, revealing one centered brand after 200 ms', async () => {
        render();
        expect(initial()).not.toBeNull();
        expect(stage()?.hidden).toBe(true);
        expect(stage()?.hasAttribute('inert')).toBe(true);
        expect(host.querySelector('header')).not.toBeNull();
        expect(host.querySelector('.brand-loading')).toBeNull();
        await advance(199);
        expect(host.querySelector('.brand-loading')).toBeNull();
        await advance(1);
        expect(host.querySelectorAll('.brand-loading')).toHaveLength(1);
        expect(initial()?.textContent).toContain('store-a');
        expect(host.querySelector('.page-skeleton')).toBeNull();
        render({ loading: false });
        expect(initial()).toBeNull();
        expect(stage()?.hidden).toBe(false);
        expect(stage()?.hasAttribute('inert')).toBe(false);
        expect(phase()).toBe('ready');
    });

    it('does not force a brand animation when required data is ready before the delay', async () => {
        render();
        await advance(100);
        render({ loading: false });
        await advance(200);
        expect(initial()).toBeNull();
        expect(host.querySelector('.brand-loading')).toBeNull();
        expect(host.textContent).toContain('Available content');
    });

    it('replaces the initial loader with one branded error and restarts only its current read', async () => {
        render();
        await advance(10_100);
        expect(phase()).toBe('error');
        expect(initial()?.textContent).toContain('store-a');
        expect(host.querySelectorAll('[role=alert]')).toHaveLength(1);
        expect(host.querySelector('.brand-loading-dots, .brand-loading-bar')).toBeNull();
        expect(host.querySelector('[aria-busy=true]')).toBeNull();
        expect(host.querySelector('.page-readiness-overlay')).toBeNull();
        act(() => host.querySelector<HTMLButtonElement>('.page-readiness-error-actions button')?.click());
        expect(retry).toHaveBeenCalledTimes(1);
        expect(phase()).toBe('preparing');
        expect(host.querySelector('[role=alert]')).toBeNull();
        await advance(200);
        expect(initial()?.textContent).toContain('store-a');
        expect(host.querySelector('.brand-loading-bar')).not.toBeNull();
        render({ loading: false });
        expect(initial()).toBeNull();
        expect(phase()).toBe('ready');
    });

    it('keeps later reads in their page region without a full brand or duplicated timeout', async () => {
        render({ loading: false });
        const navigation = host.querySelector('header button');
        (navigation as HTMLButtonElement).focus();
        render({ request: 'catalog' });
        expect(initial()).toBeNull();
        expect(stage()?.hidden).toBe(false);
        expect(document.activeElement).toBe(navigation);
        expect(host.querySelector('.brand-loading')).toBeNull();
        expect(host.querySelector('.page-loading-indicator')).not.toBeNull();
        await advance(10_100);
        expect(host.querySelectorAll('[role=alert]')).toHaveLength(1);
        expect(host.querySelector('.page-readiness-inline-error')).not.toBeNull();
        expect(host.querySelector('.page-readiness-overlay')).toBeNull();
        expect(host.querySelector('.brand-loading-dots, .brand-loading-bar')).toBeNull();
        expect(host.querySelector('[aria-busy=true]')).toBeNull();
    });

    it('does not turn a local coupon read into a full-page initial loader', async () => {
        render({ compact: true });
        expect(initial()).toBeNull();
        expect(stage()?.hidden).toBe(false);
        expect(host.querySelector('.page-loading-indicator')).not.toBeNull();
        await advance(10_100);
        expect(host.querySelector('.page-readiness-inline-error')).not.toBeNull();
        expect(host.querySelector('.brand-loading-dots, .brand-loading-bar')).toBeNull();
    });

    it('gives a new store a fresh initial deadline and cannot reuse the prior store brand', async () => {
        render();
        await advance(9000);
        render({ scope: 'store-b' });
        expect(initial()).not.toBeNull();
        expect(initial()?.textContent).not.toContain('store-a');
        await advance(2000);
        expect(phase()).toBe('preparing');
        expect(initial()?.textContent).toContain('store-b');
        expect(host.querySelector('img')?.getAttribute('src')).toBe('/store-b.svg');
        render({ scope: 'store-b', loading: false });
        render({ scope: 'store-a' });
        expect(initial()).not.toBeNull();
        await advance(200);
        expect(initial()?.textContent).toContain('store-a');
        expect(initial()?.textContent).not.toContain('store-b');
    });

    it('does not reuse the timeout or visible loading delay from a previous A to B to A visit', async () => {
        render();
        await advance(10_100);
        expect(phase()).toBe('error');
        render({ scope: 'store-b' });
        await advance(1000);
        render();
        expect(phase()).toBe('preparing');
        expect(host.querySelector('.brand-loading')).toBeNull();
        await advance(200);
        expect(initial()?.textContent).toContain('store-a');
        expect(host.querySelector('[role=alert]')).toBeNull();
        await advance(9000);
        expect(phase()).toBe('preparing');
    });

    it('keeps a store displayed across language and request changes, including route-module timeout', async () => {
        render({ loading: false });
        render({ request: 'en-new-route', language: 'en', routeModule: true });
        expect(initial()).toBeNull();
        expect(stage()?.hidden).toBe(false);
        expect(host.querySelector('.route-transition')?.textContent).toContain('Loading page');
        await advance(10_100);
        expect(host.querySelectorAll('[role=alert]')).toHaveLength(1);
        expect(host.textContent).toContain('The page took too long');
        expect(host.querySelector('.brand-loading-dots, .brand-loading-bar')).toBeNull();
        expect(host.querySelector('[aria-busy=true]')).toBeNull();
    });

    it('shows an offline initial error without motion and accepts late recovery', () => {
        render({ online: false });
        expect(initial()).not.toBeNull();
        expect(initial()?.textContent).toContain('当前网络不可用');
        expect(host.querySelector('.brand-loading-dots, .brand-loading-bar')).toBeNull();
        render({ loading: false, online: false });
        expect(initial()).toBeNull();
        expect(phase()).toBe('ready');
    });

    it('holds a failed configuration in the initial state even without a mounted page loader', async () => {
        render({ loading: false, initialError: true });
        expect(initial()).not.toBeNull();
        expect(stage()?.hidden).toBe(true);
        expect(phase()).toBe('error');
        expect(host.querySelector('.brand-loading-dots, .brand-loading-bar')).toBeNull();
        render({ loading: false, pending: true });
        expect(phase()).toBe('preparing');
        expect(initial()).not.toBeNull();
        await advance(200);
        expect(initial()?.textContent).toContain('store-a');
        render({ loading: false });
        expect(initial()).toBeNull();
        render({ loading: false, initialError: true });
        expect(initial()).toBeNull();
        expect(phase()).toBe('ready');
    });
});
