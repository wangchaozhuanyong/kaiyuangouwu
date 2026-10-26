// @vitest-environment jsdom
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';

import { invalidateStorefrontRealtimeQueries, type StorefrontRealtimeEvent } from './realtime-updates';
vi.mock('./api/helpers', async importOriginal => ({
    ...(await importOriginal<typeof import('./api/helpers')>()),
    SEND_CLIENT_CHANNEL_TOKEN: false,
}));
beforeAll(async () => {
    await import('./realtime-refresh');
});
const scope = { marketCode: 'burst:MYR', languageCode: 'en' };
afterEach(() => vi.useRealTimers());
it.each([
    ['one-block', 'content'],
    ['split-blocks', 'content'],
    ['split-blocks', 'coupons'],
] as const)('bounds the same 100 public events in %s / %s', async (mode, topic) => {
    vi.useFakeTimers();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let version = 0;
    let started = 0;
    let canceled = 0;
    const queryKey = ['storefront', scope.marketCode, scope.languageCode, 'config'];
    const observer = new QueryObserver(client, {
        queryKey,
        initialData: -1,
        staleTime: Infinity,
        queryFn: ({ signal }) =>
            new Promise<number>((resolve, reject) => {
                started++;
                const value = version;
                const timer = setTimeout(() => resolve(value), 200);
                signal.addEventListener(
                    'abort',
                    () => {
                        canceled++;
                        clearTimeout(timer);
                        reject(new DOMException('Aborted', 'AbortError'));
                    },
                    { once: true },
                );
            }),
    });
    const stop = observer.subscribe(() => undefined);
    const pending: Array<Promise<void>> = [];
    try {
        for (let index = 1; index <= 100; index++) {
            version = index;
            const event: StorefrontRealtimeEvent = {
                version: 1,
                id: String(index),
                occurredAt: '',
                topics: [topic],
            };
            pending.push(invalidateStorefrontRealtimeQueries(client, event, scope));
            if (mode === 'split-blocks') await vi.advanceTimersByTimeAsync(1);
        }
        await vi.runAllTimersAsync();
        await Promise.all(pending);
        expect(client.getQueryData(queryKey)).toBe(100);
        expect(started).toBeLessThanOrEqual(2);
        expect(canceled).toBeLessThanOrEqual(1);
    } finally {
        stop();
        client.clear();
    }
});

it('fences a slow public response and performs one dirty follow-up', async () => {
    vi.useFakeTimers();
    const { syntheticPage } = await import('../e2e/seo-public/fixtures.mjs');
    const { fetchPublicPage } = await import('./storefront-page-data');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let revision = 0;
    let canceled = 0;
    const reads = vi.fn(
        (_url: unknown, init?: RequestInit) =>
            new Promise<Response>((resolve, reject) => {
                const page = syntheticPage('synthetic-a', 'en', 'home', { host: window.location.host });
                page.version = String(revision);
                const timer = setTimeout(
                    () =>
                        resolve(
                            new Response(JSON.stringify(page), {
                                headers: { 'content-type': 'application/json' },
                            }),
                        ),
                    2000,
                );
                init?.signal?.addEventListener(
                    'abort',
                    () => {
                        canceled++;
                        clearTimeout(timer);
                        reject(new DOMException('Aborted', 'AbortError'));
                    },
                    { once: true },
                );
            }),
    );
    vi.stubGlobal('fetch', reads);
    const key = ['storefront', scope.marketCode, scope.languageCode, 'config'];
    const observer = new QueryObserver(client, {
        queryKey: key,
        initialData: '0',
        staleTime: Infinity,
        queryFn: async ({ signal }) =>
            (await fetchPublicPage('en', 'MYR', signal, { kind: 'home' }, 'synthetic-a'))?.version,
    });
    const visible: unknown[] = [];
    const stop = observer.subscribe(result => {
        if (result.isSuccess) visible.push(result.data);
    });
    const operations: Array<Promise<void>> = [];
    try {
        for (let index = 1; index <= 100; index++) {
            revision = index;
            operations.push(
                invalidateStorefrontRealtimeQueries(
                    client,
                    { version: 1, id: String(index), occurredAt: '', topics: ['content'] },
                    scope,
                ),
            );
            await vi.advanceTimersByTimeAsync(10);
        }
        await vi.runAllTimersAsync();
        await Promise.all(operations);
        expect(reads).toHaveBeenCalledTimes(2);
        expect(canceled).toBe(0);
        expect(client.getQueryData(key)).toBe('100');
        expect(visible.every(value => value === '0' || value === '100')).toBe(true);
    } finally {
        stop();
        client.clear();
        vi.unstubAllGlobals();
    }
});

it.each([false, true])('disposal drops follow-up work, in-flight=%s', async inFlight => {
    vi.useFakeTimers();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const controller = new AbortController();
    const read = vi.fn(
        ({ signal }: { signal: AbortSignal }) =>
            new Promise<number>((resolve, reject) => {
                const timer = setTimeout(() => resolve(1), 1000);
                signal.addEventListener(
                    'abort',
                    () => {
                        clearTimeout(timer);
                        reject(new DOMException('Aborted', 'AbortError'));
                    },
                    { once: true },
                );
            }),
    );
    const observer = new QueryObserver(client, {
        queryKey: ['storefront', scope.marketCode, scope.languageCode, 'config'],
        initialData: 0,
        staleTime: Infinity,
        queryFn: read,
    });
    const stop = observer.subscribe(() => undefined);
    const event: StorefrontRealtimeEvent = { version: 1, id: 'cancel', occurredAt: '', topics: ['content'] };
    const operation = invalidateStorefrontRealtimeQueries(client, event, scope, controller.signal);
    if (inFlight) {
        await vi.advanceTimersByTimeAsync(100);
        void invalidateStorefrontRealtimeQueries(client, event, scope, controller.signal);
    }
    controller.abort();
    stop();
    await operation;
    await vi.runAllTimersAsync();
    expect(read).toHaveBeenCalledTimes(inFlight ? 1 : 0);
    expect(vi.getTimerCount()).toBe(0);
    client.clear();
});

it('unions IDs without crossing scope or narrowing a broad event', async () => {
    vi.useFakeTimers();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const keys = [
        ['storefront', scope.marketCode, 'en', 'product', '1'],
        ['storefront', scope.marketCode, 'en', 'product', '2'],
        ['storefront', scope.marketCode, 'en', 'product', '3'],
        ['storefront', 'another:MYR', 'en', 'product', '1'],
        ['storefront', scope.marketCode, 'zh_Hans', 'product', '1'],
    ];
    const reads = keys.map(() => vi.fn(() => Promise.resolve(1)));
    const observers = keys.map(
        (queryKey, index) =>
            new QueryObserver(client, {
                queryKey,
                queryFn: reads[index],
                initialData: 0,
                staleTime: Infinity,
            }),
    );
    const stops = observers.map(observer => observer.subscribe(() => undefined));
    const send = (entityIds?: string[]) =>
        invalidateStorefrontRealtimeQueries(
            client,
            { version: 1, id: 'ids', occurredAt: '', topics: ['catalog'], entityType: 'Product', entityIds },
            scope,
        );
    try {
        const first = send(['1']);
        const second = send(['2']);
        await vi.runAllTimersAsync();
        await Promise.all([first, second]);
        expect(reads.map(read => read.mock.calls.length)).toEqual([1, 1, 0, 0, 0]);
        const broad = send();
        const narrow = send(['1']);
        await vi.runAllTimersAsync();
        await Promise.all([broad, narrow]);
        expect(reads.map(read => read.mock.calls.length)).toEqual([2, 2, 1, 0, 0]);
    } finally {
        stops.forEach(stop => stop());
        client.clear();
    }
});
