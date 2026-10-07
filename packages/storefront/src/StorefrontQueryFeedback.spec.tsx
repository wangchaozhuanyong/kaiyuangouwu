// @vitest-environment jsdom
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStorefrontQueryClient, refreshStorefrontQueries, storefrontQueryKeys } from './query-client';
import { StorefrontQueryFeedback } from './StorefrontQueryFeedback';

const cleanup: Array<() => void> = [];
afterEach(async () => {
    await act(async () => {
        cleanup.splice(0).forEach(fn => fn());
        await Promise.resolve();
    });
    vi.useRealTimers();
});

async function mount() {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    const client = createStorefrontQueryClient();
    const scope = { marketCode: 'shop:MYR', languageCode: 'zh_Hans', includePrivate: true };
    const key = storefrontQueryKeys.products(scope.marketCode, scope.languageCode, 12);
    client.setQueryData(key, ['已有商品']);
    let resolve!: (data: string[]) => void;
    let reject!: (error: Error) => void;
    const read = vi.fn(
        () =>
            new Promise<string[]>((ok, fail) => {
                resolve = ok;
                reject = fail;
            }),
    );
    function Page() {
        const query = useQuery({ queryKey: key, queryFn: read, staleTime: Infinity, retry: false });
        return (
            <>
                <main>{query.data?.join(',')}</main>
                <StorefrontQueryFeedback scope={scope} language="zh" />
            </>
        );
    }
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
        root.render(
            <QueryClientProvider client={client}>
                <Page />
            </QueryClientProvider>,
        );
        await Promise.resolve();
    });
    cleanup.push(() => {
        root.unmount();
        client.clear();
        container.remove();
    });
    return {
        client,
        scope,
        container,
        read,
        start: () => refreshStorefrontQueries(client, scope),
        succeed: (data: string[]) => resolve(data),
        fail: () => reject(new Error('Network unavailable')),
        tick: async (ms = 250) => {
            await act(async () => vi.advanceTimersByTimeAsync(ms));
        },
    };
}

describe('shared background query feedback', () => {
    it('keeps routine background refresh silent even when it is slow, then updates content', async () => {
        const page = await mount();
        let refresh!: Promise<void>;
        await act(async () => {
            refresh = page.start();
            await Promise.resolve();
        });
        expect(page.container.querySelector('main')?.textContent).toBe('已有商品');
        expect(page.container.querySelector('aside')).toBeNull();
        await page.tick(10_000);
        expect(page.read).toHaveBeenCalledTimes(1);
        expect(page.container.querySelector('main')?.textContent).toBe('已有商品');
        expect(page.container.querySelector('aside')).toBeNull();
        expect(page.container.querySelector('[role=status]')).toBeNull();
        await act(async () => {
            page.succeed(['新商品']);
            await refresh;
            await vi.advanceTimersByTimeAsync(1);
        });
        expect(page.container.querySelector('main')?.textContent).toBe('新商品');
        expect(page.container.querySelector('aside')).toBeNull();
    });
    it('keeps a dismissed failure quiet during the next refresh but exposes a new failure', async () => {
        const page = await mount();
        await act(async () => {
            const initialRefresh = page.start();
            page.fail();
            await initialRefresh;
            await vi.advanceTimersByTimeAsync(1);
        });
        const dismiss = page.container.querySelector<HTMLButtonElement>('button[aria-label="关闭更新提示"]');
        if (!dismiss) throw new Error('Expected dismiss action');
        await act(async () => {
            dismiss.click();
            await Promise.resolve();
        });
        expect(page.container.querySelector('aside')).toBeNull();
        let refresh!: Promise<void>;
        await act(async () => {
            refresh = page.start();
            await Promise.resolve();
        });
        await page.tick(1000);
        expect(page.container.querySelector('aside')).toBeNull();
        await act(async () => {
            page.fail();
            await refresh;
            await vi.advanceTimersByTimeAsync(1);
        });
        expect(page.container.querySelector('[role=alert]')?.textContent).toContain('更新失败');
        expect(page.container.querySelector('main')?.textContent).toBe('已有商品');
    });

    it('keeps cached data after failure and exposes one local retry with a busy state', async () => {
        const page = await mount();
        let refresh!: Promise<void>;
        await act(async () => {
            refresh = page.start();
            page.fail();
            await refresh;
            await vi.advanceTimersByTimeAsync(1);
        });
        expect(page.container.querySelector('main')?.textContent).toBe('已有商品');
        expect(page.container.querySelector('[role=alert]')?.textContent).toContain('保留上次内容');
        const retry = page.container.querySelector('button');
        if (!retry) throw new Error('Expected local retry action');
        await act(async () => {
            retry.click();
            retry.click();
            await Promise.resolve();
        });
        await page.tick(1);
        expect(page.read).toHaveBeenCalledTimes(2);
        expect(retry.disabled).toBe(true);
        expect(retry.getAttribute('aria-busy')).toBe('true');
        expect(page.container.querySelector('[role=alert]')).not.toBeNull();
        await act(async () => {
            page.succeed(['恢复']);
            await vi.advanceTimersByTimeAsync(1);
        });
        expect(page.container.querySelector('main')?.textContent).toBe('恢复');
        expect(page.container.querySelector('aside')).toBeNull();
    });
});
