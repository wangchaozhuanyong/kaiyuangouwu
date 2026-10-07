// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PageReadinessBoundary, usePageReadiness } from './page-readiness';
import { PageSkeleton } from './route-loading';

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
