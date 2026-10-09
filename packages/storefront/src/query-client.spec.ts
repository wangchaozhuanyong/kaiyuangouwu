import { dehydrate, QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShopApiTimeoutError } from './api';
import { ShopApiGraphQlError } from './api/helpers';
import { publicPageReadGeneration } from './public-page-transport';
import {
    createStorefrontQueryClient,
    isStorefrontScopeAccessDenied,
    LEGACY_PUBLIC_QUERY_CACHE_KEYS,
    markStorefrontPublicQuerySource,
    persistPublicQueryCache,
    PUBLIC_QUERY_CACHE_KEY,
    PUBLIC_QUERY_CACHE_MAX_AGE,
    publicQueryMeta,
    restorePublicQueryCache,
    restrictStorefrontScopePersistence,
    ROUTE_QUERY_STALE_TIME,
    storefrontQueryKeys,
    storefrontQueryRetry,
    storefrontRefetchPolicy,
    watchPublicQueryCache,
} from './query-client';
import { isStorefrontClosedError } from './storefront-access';

function allowLive(
    client: ReturnType<typeof createStorefrontQueryClient>,
    marketCode: string,
    languageCode: string,
) {
    client.setQueryData([...storefrontQueryKeys.config(marketCode, languageCode), 'public'], {
        accessMode: 'LIVE',
    });
}

function memoryStorage() {
    const values = new Map<string, string>();
    return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        values,
    };
}

describe('public cache persistence work', () => {
    it('treats closure as authoritative even with previously cached configuration, without promoting other forbidden operations to closure', async () => {
        const client = createStorefrontQueryClient();
        const queryKey = [...storefrontQueryKeys.config('fixture:CNY', 'zh_Hans'), 'public'];
        await client.fetchQuery({ queryKey, queryFn: () => Promise.resolve({ accessMode: 'PREVIEW' }) });
        const denied = new ShopApiGraphQlError(['closed'], 403, 'STOREFRONT_CLOSED');
        await expect(
            client.fetchQuery({
                queryKey,
                staleTime: 0,
                queryFn: () => Promise.reject(denied),
            }),
        ).rejects.toBe(denied);
        const state = client.getQueryState(queryKey);
        expect(state?.data).toEqual({ accessMode: 'PREVIEW' });
        expect(isStorefrontClosedError(state?.error, true)).toBe(true);
        expect(storefrontQueryRetry(0, denied)).toBe(false);
        const otherDenied = new ShopApiGraphQlError(['forbidden'], 403, 'FORBIDDEN');
        expect(isStorefrontClosedError(otherDenied)).toBe(false);
        expect(isStorefrontClosedError(otherDenied, true)).toBe(true);
        client.clear();
    });
    it('does not serialize unchanged data when pages attach and detach query observers', async () => {
        const client = createStorefrontQueryClient();
        const options = {
            queryKey: storefrontQueryKeys.product('my:MYR', 'en', '1'),
            queryFn: () => ({ id: '1', name: 'Cached product' }),
            staleTime: Infinity,
            meta: publicQueryMeta(),
        };
        await client.fetchQuery(options);
        const storage = { setItem: vi.fn() };
        vi.useFakeTimers();
        const stop = watchPublicQueryCache(client, storage);
        try {
            for (let index = 0; index < 3; index += 1) {
                const observer = new QueryObserver(client, options);
                const detach = observer.subscribe(() => undefined);
                observer.setOptions({ ...options, enabled: false });
                detach();
                await vi.advanceTimersByTimeAsync(150);
            }
            expect(storage.setItem).not.toHaveBeenCalled();
        } finally {
            stop();
            client.clear();
            vi.useRealTimers();
        }
    });

    it('batches data changes, persists removals, and cancels pending work on unsubscribe', async () => {
        const client = createStorefrontQueryClient();
        allowLive(client, 'my:MYR', 'en');
        const key = storefrontQueryKeys.product('my:MYR', 'en', '1');
        await client.fetchQuery({ queryKey: key, queryFn: () => ({ id: '1' }), meta: publicQueryMeta() });
        const storage = memoryStorage();
        const writes = vi.spyOn(storage, 'setItem');
        vi.useFakeTimers();
        const stop = watchPublicQueryCache(client, storage);
        try {
            client.setQueryData(key, { id: '1', name: 'First update' });
            client.setQueryData(key, { id: '1', name: 'Latest update' });
            await vi.advanceTimersByTimeAsync(150);
            expect(writes).toHaveBeenCalledTimes(1);
            expect(storage.values.get(PUBLIC_QUERY_CACHE_KEY)).toContain('Latest update');
            client.removeQueries({ queryKey: key });
            await vi.advanceTimersByTimeAsync(150);
            expect(writes).toHaveBeenCalledTimes(1);
            expect(storage.values.has(PUBLIC_QUERY_CACHE_KEY)).toBe(false);
            await client.fetchQuery({ queryKey: key, queryFn: () => ({ id: '1' }), meta: publicQueryMeta() });
            stop();
            await vi.advanceTimersByTimeAsync(150);
            expect(writes).toHaveBeenCalledTimes(1);
        } finally {
            stop();
            client.clear();
            vi.useRealTimers();
        }
    });
});

describe('public React Query session cache', () => {
    it('isolates announcement list pagination and direct details by store, currency and language', () => {
        const client = createStorefrontQueryClient();
        const listKey = storefrontQueryKeys.announcements('shop-a:MYR', 'zh_Hans', 1, 12);
        const detailKey = storefrontQueryKeys.announcement('shop-a:MYR', 'zh_Hans', 'notice-1');
        client.setQueryData(listKey, { items: [{ id: 'notice-1' }], totalItems: 25 });
        client.setQueryData(detailKey, { id: 'notice-1', title: 'Only current store' });
        for (const [scope, language] of [
            ['shop-b:MYR', 'zh_Hans'],
            ['shop-a:CNY', 'zh_Hans'],
            ['shop-a:MYR', 'en'],
        ]) {
            expect(
                client.getQueryData(storefrontQueryKeys.announcements(scope, language, 1, 12)),
            ).toBeUndefined();
            expect(
                client.getQueryData(storefrontQueryKeys.announcement(scope, language, 'notice-1')),
            ).toBeUndefined();
        }
        expect(
            client.getQueryData(storefrontQueryKeys.announcements('shop-a:MYR', 'zh_Hans', 2, 12)),
        ).toBeUndefined();
        expect(
            client.getQueryData(storefrontQueryKeys.announcements('shop-a:MYR', 'zh_Hans', 1, 24)),
        ).toBeUndefined();
        expect(
            client.getQueryData(storefrontQueryKeys.announcement('shop-a:MYR', 'zh_Hans', 'notice-2')),
        ).toBeUndefined();
        client.clear();
    });

    it('respects stale time when the page mounts or regains focus', () => {
        const queryDefaults = createStorefrontQueryClient().getDefaultOptions().queries;

        expect(ROUTE_QUERY_STALE_TIME).toBe(60_000);
        expect(queryDefaults?.staleTime).toBe(ROUTE_QUERY_STALE_TIME);
        expect(queryDefaults?.refetchOnMount).toBe(storefrontRefetchPolicy);
        expect(queryDefaults?.refetchOnWindowFocus).toBe(storefrontRefetchPolicy);
        expect(storefrontRefetchPolicy({ meta: publicQueryMeta() })).toBe(true);
        expect(storefrontRefetchPolicy({})).toBe(true);
    });

    it('does not retry a request after the server timeout', () => {
        expect(storefrontQueryRetry(0, new ShopApiTimeoutError('timeout'))).toBe(false);
        expect(storefrontQueryRetry(0, new ShopApiGraphQlError(['not available'], 200, 'FORBIDDEN'))).toBe(
            false,
        );
        expect(storefrontQueryRetry(0, new Error('network'))).toBe(true);
        expect(storefrontQueryRetry(1, new Error('network'))).toBe(false);
    });

    it('deduplicates concurrent queries and refreshes after invalidation', async () => {
        const client = createStorefrontQueryClient();
        let requestCount = 0;
        const options = {
            queryKey: storefrontQueryKeys.product('cn', 'zh_Hans', '1'),
            queryFn: () => {
                requestCount += 1;
                return { id: '1', requestCount };
            },
            staleTime: 60_000,
            meta: publicQueryMeta(),
        };

        await Promise.all([client.fetchQuery(options), client.fetchQuery(options)]);
        expect(requestCount).toBe(1);
        await client.invalidateQueries({ queryKey: options.queryKey });
        await client.fetchQuery(options);
        expect(requestCount).toBe(2);
    });

    it('aborts the query function when a superseded request is cancelled', async () => {
        const client = createStorefrontQueryClient();
        let aborted = false;
        const queryKey = storefrontQueryKeys.catalog('cn', 'zh_Hans', { collectionId: '1' });
        const pending = client.fetchQuery({
            queryKey,
            queryFn: ({ signal }) =>
                new Promise((_resolve, reject) => {
                    signal.addEventListener('abort', () => {
                        aborted = true;
                        reject(new DOMException('Aborted', 'AbortError'));
                    });
                }),
        });

        await client.cancelQueries({ queryKey });
        await expect(pending).rejects.toBeDefined();
        expect(aborted).toBe(true);
    });

    it('isolates public keys by market, language and query conditions', () => {
        expect(storefrontQueryKeys.product('cn', 'zh_Hans', '1')).not.toEqual(
            storefrontQueryKeys.product('my', 'zh_Hans', '1'),
        );
        expect(storefrontQueryKeys.product('cn', 'zh_Hans', '1')).not.toEqual(
            storefrontQueryKeys.product('cn', 'en', '1'),
        );
        expect(storefrontQueryKeys.catalog('cn', 'zh_Hans', { sort: 'SALES' })).not.toEqual(
            storefrontQueryKeys.catalog('cn', 'zh_Hans', { sort: 'NEWEST' }),
        );
    });

    it('isolates the same market cache by settlement currency', () => {
        const cny = storefrontQueryKeys.market({ code: 'store-1', currencyCode: 'CNY' });
        const myr = storefrontQueryKeys.market({ code: 'store-1', currencyCode: 'MYR' });

        expect(storefrontQueryKeys.product(cny, 'zh_Hans', '1')).not.toEqual(
            storefrontQueryKeys.product(myr, 'zh_Hans', '1'),
        );
    });

    it('isolates private route data by customer and filter conditions', () => {
        const firstCustomerOrders = storefrontQueryKeys.customerOrders('my', 'zh_Hans', 'customer-1', {
            tab: 'all',
            orderCode: '',
        });

        expect(firstCustomerOrders).not.toEqual(
            storefrontQueryKeys.customerOrders('my', 'zh_Hans', 'customer-2', {
                tab: 'all',
                orderCode: '',
            }),
        );
        expect(firstCustomerOrders).not.toEqual(
            storefrontQueryKeys.customerOrders('my', 'zh_Hans', 'customer-1', {
                tab: 'shipping',
                orderCode: '',
            }),
        );
        expect(storefrontQueryKeys.order('my', 'zh_Hans', 'customer-1', 'order-1')).not.toEqual(
            storefrontQueryKeys.order('my', 'zh_Hans', 'customer-2', 'order-1'),
        );
        expect(storefrontQueryKeys.couponCampaigns('my', 'zh_Hans', 'customer-1')).not.toEqual(
            storefrontQueryKeys.couponCampaigns('my', 'zh_Hans', 'customer-2'),
        );
        expect(storefrontQueryKeys.couponCampaigns('my', 'zh_Hans', 'customer-1')).not.toEqual(
            storefrontQueryKeys.couponCampaigns('my', 'zh_Hans', null),
        );
        expect(storefrontQueryKeys.couponCampaigns('my', 'zh_Hans', null)[3]).toBe('private');
    });

    it('does not reuse account A coupon state after switching to account B in the same session', () => {
        const client = createStorefrontQueryClient();
        const accountAKey = storefrontQueryKeys.couponCampaigns('my', 'zh_Hans', 'customer-a');
        const accountBKey = storefrontQueryKeys.couponCampaigns('my', 'zh_Hans', 'customer-b');
        client.setQueryData(accountAKey, [{ id: 'campaign-1', claimed: true, claimable: false }]);

        expect(client.getQueryData(accountBKey)).toBeUndefined();

        client.removeQueries({
            predicate: query => query.queryKey[0] === 'storefront' && query.queryKey[3] === 'private',
        });
        expect(client.getQueryData(accountAKey)).toBeUndefined();
    });

    it('persists only explicitly public successful queries', async () => {
        const client = createStorefrontQueryClient();
        allowLive(client, 'cn', 'zh');
        await client.fetchQuery({
            queryKey: ['storefront', 'cn', 'zh', 'product', '1'],
            queryFn: () => ({ id: '1' }),
            meta: publicQueryMeta(),
        });
        await client.fetchQuery({
            queryKey: ['storefront', 'cn', 'zh', 'private', 'customer'],
            queryFn: () => ({ emailAddress: 'private@example.com' }),
            meta: publicQueryMeta(),
        });
        await client.fetchQuery({
            queryKey: storefrontQueryKeys.couponCampaigns('cn', 'zh', 'customer-1'),
            queryFn: () => [{ id: 'campaign-1', claimed: true }],
        });
        const storage = memoryStorage();

        persistPublicQueryCache(client, storage, 1_000);
        const serialized = storage.values.get(PUBLIC_QUERY_CACHE_KEY) ?? '';

        expect(serialized).toContain('product');
        expect(serialized).not.toContain('private@example.com');
        expect(serialized).not.toContain('customer');
        expect(serialized).not.toContain('campaign-1');
        expect(serialized).not.toContain('claimed');
    });

    it('restores a fresh cache and rejects entries older than five minutes', async () => {
        const source = createStorefrontQueryClient();
        allowLive(source, 'my', 'en');
        await source.fetchQuery({
            queryKey: ['storefront', 'my', 'en', 'content'],
            queryFn: () => ['hero'],
            meta: publicQueryMeta(),
        });
        const storage = memoryStorage();
        persistPublicQueryCache(source, storage, 1_000);

        const fresh = createStorefrontQueryClient();
        expect(restorePublicQueryCache(fresh, storage, 2_000)).toBe(true);
        expect(fresh.getQueryData(['storefront', 'my', 'en', 'content'])).toBeUndefined();
        allowLive(fresh, 'my', 'en');
        expect(restorePublicQueryCache(fresh, storage, 2_000)).toBe(true);
        expect(fresh.getQueryData(['storefront', 'my', 'en', 'content'])).toEqual(['hero']);

        const expired = createStorefrontQueryClient();
        expect(restorePublicQueryCache(expired, storage, 1_000 + PUBLIC_QUERY_CACHE_MAX_AGE + 1)).toBe(false);
        expect(storage.values.has(PUBLIC_QUERY_CACHE_KEY)).toBe(false);
    });

    it('does not persist store configuration alongside reusable catalog data', async () => {
        const client = createStorefrontQueryClient();
        await client.fetchQuery({
            queryKey: storefrontQueryKeys.config('cn-mainland:CNY', 'zh_Hans'),
            queryFn: () => ({ description: 'Old store description', accessMode: 'LIVE' }),
            meta: publicQueryMeta(),
        });
        await client.fetchQuery({
            queryKey: storefrontQueryKeys.product('cn-mainland:CNY', 'zh_Hans', '1'),
            queryFn: () => ({ id: '1' }),
            meta: publicQueryMeta(),
        });
        const storage = memoryStorage();

        persistPublicQueryCache(client, storage);

        const restored = createStorefrontQueryClient();
        allowLive(restored, 'cn-mainland:CNY', 'zh_Hans');
        expect(restorePublicQueryCache(restored, storage)).toBe(true);
        expect(
            restored.getQueryData(storefrontQueryKeys.config('cn-mainland:CNY', 'zh_Hans')),
        ).toBeUndefined();
        expect(restored.getQueryData(storefrontQueryKeys.product('cn-mainland:CNY', 'zh_Hans', '1'))).toEqual(
            { id: '1' },
        );
    });

    it('ignores previously persisted branding and fetches cleared copy on every reload', async () => {
        const source = createStorefrontQueryClient();
        const configKey = storefrontQueryKeys.config('cn-mainland:CNY', 'zh_Hans');
        const resolvedConfigKey = storefrontQueryKeys.config('__default_channel__:CNY', 'zh_Hans');
        source.setQueryData(configKey, { description: 'Old store description', tagline: 'Old tagline' });
        source.setQueryData(resolvedConfigKey, { description: '', tagline: '' });
        const storage = memoryStorage();
        storage.setItem(
            PUBLIC_QUERY_CACHE_KEY,
            JSON.stringify({
                version: 7,
                savedAt: Date.now(),
                state: dehydrate(source),
            }),
        );
        let requests = 0;

        for (let reload = 0; reload < 2; reload += 1) {
            const client = createStorefrontQueryClient();
            expect(restorePublicQueryCache(client, storage)).toBe(reload === 0);
            expect(client.getQueryData(configKey)).toBeUndefined();
            expect(client.getQueryData(resolvedConfigKey)).toBeUndefined();
            await expect(
                client.fetchQuery({
                    queryKey: configKey,
                    queryFn: () => {
                        requests += 1;
                        return { description: '', tagline: '' };
                    },
                    meta: publicQueryMeta(),
                }),
            ).resolves.toEqual({ description: '', tagline: '' });
            persistPublicQueryCache(client, storage);
            client.clear();
        }

        expect(requests).toBe(2);
    });

    it('removes legacy public caches before restoring v4 data', () => {
        const storage = memoryStorage();
        for (const key of LEGACY_PUBLIC_QUERY_CACHE_KEYS) {
            storage.setItem(key, '{"staleBranding":true}');
        }

        expect(restorePublicQueryCache(createStorefrontQueryClient(), storage, 2_000)).toBe(false);
        for (const key of LEGACY_PUBLIC_QUERY_CACHE_KEYS) {
            expect(storage.values.has(key)).toBe(false);
        }
    });
});

describe('failed background refresh persistence', () => {
    it('retains last confirmed public data without persisting errors or advancing freshness', async () => {
        const client = createStorefrontQueryClient();
        allowLive(client, 'shop:MYR', 'zh_Hans');
        const key = storefrontQueryKeys.products('shop:MYR', 'zh_Hans', 12);
        const observer = new QueryObserver(client, {
            queryKey: key,
            queryFn: () => Promise.reject(new Error('sensitive diagnostic')),
            meta: publicQueryMeta(),
            retry: false,
            staleTime: Infinity,
        });
        client.setQueryData(key, [], { updatedAt: 100 });
        const stop = observer.subscribe(() => undefined);
        await observer.refetch({ cancelRefetch: false });
        expect(observer.getCurrentResult().isRefetchError).toBe(true);
        const storage = memoryStorage();
        persistPublicQueryCache(client, storage, 200);
        expect(storage.values.get(PUBLIC_QUERY_CACHE_KEY)).not.toContain('sensitive diagnostic');
        const restored = createStorefrontQueryClient();
        allowLive(restored, 'shop:MYR', 'zh_Hans');
        expect(restorePublicQueryCache(restored, storage, 250)).toBe(true);
        expect(restored.getQueryData(key)).toEqual([]);
        expect(restored.getQueryState(key)?.dataUpdatedAt).toBe(100);
        expect(restored.getQueryState(key)?.error).toBeNull();
        stop();
        client.clear();
        restored.clear();
    });
});

describe('authoritative scope access and preview persistence', () => {
    const clients: Array<ReturnType<typeof createStorefrontQueryClient>> = [];
    const scope = { marketCode: 'shop:MYR', languageCode: 'en' };
    const configKey = [...storefrontQueryKeys.config(scope.marketCode, scope.languageCode), 'public'];
    const productKey = storefrontQueryKeys.product(scope.marketCode, scope.languageCode, 'one');
    const closed = () => new ShopApiGraphQlError(['closed'], 403, 'STOREFRONT_CLOSED');
    const clientForTest = () => {
        const client = createStorefrontQueryClient();
        clients.push(client);
        return client;
    };
    const failClosed = async (client: ReturnType<typeof clientForTest>) => {
        await expect(
            client.fetchQuery({
                queryKey: productKey,
                queryFn: () => Promise.reject(closed()),
                retry: false,
                staleTime: 0,
            }),
        ).rejects.toBeDefined();
    };
    afterEach(() => clients.splice(0).forEach(client => client.clear()));

    it('clears public and private data immediately, isolates other scopes, and never retries CLOSED', async () => {
        const client = clientForTest();
        allowLive(client, scope.marketCode, scope.languageCode);
        const privateKey = storefrontQueryKeys.customer(scope.marketCode, scope.languageCode);
        const otherKey = storefrontQueryKeys.product(scope.marketCode, 'zh_Hans', 'one');
        client.setQueryData(productKey, { id: 'one' });
        client.setQueryData(privateKey, { id: 'customer' });
        client.setQueryData(otherKey, { id: 'other' });
        const generation = publicPageReadGeneration();
        await failClosed(client);
        expect(isStorefrontScopeAccessDenied(client, scope)).toBe(true);
        expect(client.getQueryData(productKey)).toBeUndefined();
        expect(client.getQueryData(privateKey)).toBeUndefined();
        expect(client.getQueryData(otherKey)).toEqual({ id: 'other' });
        expect(publicPageReadGeneration()).toBeGreaterThan(generation);
        expect(storefrontQueryRetry(0, closed())).toBe(false);
    });

    it('rejects late manual seeds and pre-denial config completion; only a new current query restores access', async () => {
        const client = clientForTest();
        let resolve!: (value: { accessMode: string }) => void;
        const oldRead = client
            .fetchQuery({
                queryKey: configKey,
                queryFn: () =>
                    new Promise<{ accessMode: string }>(done => {
                        resolve = done;
                    }),
            })
            .catch(() => undefined);
        await failClosed(client);
        client.setQueryData(configKey, { accessMode: 'LIVE' });
        client.setQueryData(productKey, { id: 'late' });
        resolve({ accessMode: 'LIVE' });
        await oldRead;
        expect(isStorefrontScopeAccessDenied(client, scope)).toBe(true);
        expect(client.getQueryData(productKey)).toBeUndefined();
        await client.fetchQuery({
            queryKey: configKey,
            queryFn: () => ({ accessMode: 'LIVE' }),
            staleTime: 0,
        });
        expect(isStorefrontScopeAccessDenied(client, scope)).toBe(false);
    });

    it('does not grant authority to a removed config query that resolves after a replacement', async () => {
        const client = clientForTest();
        let resolve!: (value: { accessMode: string }) => void;
        const oldRead = client
            .fetchQuery({
                queryKey: configKey,
                queryFn: () =>
                    new Promise<{ accessMode: string }>(done => {
                        resolve = done;
                    }),
            })
            .catch(() => undefined);
        client.removeQueries({ queryKey: configKey, exact: true });
        await failClosed(client);
        client.setQueryData(configKey, { accessMode: 'LIVE' });
        resolve({ accessMode: 'LIVE' });
        await oldRead;
        expect(isStorefrontScopeAccessDenied(client, scope)).toBe(true);
    });

    it('treats public config FORBIDDEN as closure but keeps private permission errors separate', async () => {
        const client = clientForTest();
        const forbidden = new ShopApiGraphQlError(['forbidden'], 403, 'FORBIDDEN');
        await client
            .fetchQuery({
                queryKey: storefrontQueryKeys.customer(scope.marketCode, scope.languageCode),
                queryFn: () => Promise.reject(forbidden),
                retry: false,
            })
            .catch(() => undefined);
        expect(isStorefrontScopeAccessDenied(client, scope)).toBe(false);
        await client
            .fetchQuery({ queryKey: configKey, queryFn: () => Promise.reject(forbidden), retry: false })
            .catch(() => undefined);
        expect(isStorefrontScopeAccessDenied(client, scope)).toBe(true);
    });

    it('removes LIVE data on PREVIEW restriction and prevents the pre-config seed persistence window', async () => {
        const client = clientForTest();
        const storage = memoryStorage();
        allowLive(client, scope.marketCode, scope.languageCode);
        await client.fetchQuery({
            queryKey: productKey,
            queryFn: () => ({ id: 'live' }),
            meta: publicQueryMeta(),
        });
        restrictStorefrontScopePersistence(client, scope);
        expect(client.getQueryData(productKey)).toBeUndefined();
        await client.fetchQuery({
            queryKey: productKey,
            queryFn: () => ({ id: 'preview' }),
            meta: publicQueryMeta(),
        });
        persistPublicQueryCache(client, storage);
        expect(storage.values.has(PUBLIC_QUERY_CACHE_KEY)).toBe(false);
        client.setQueryData(configKey, { accessMode: 'PREVIEW' });
        expect(client.getQueryData(productKey)).toEqual({ id: 'preview' });
        client.setQueryData(configKey, { accessMode: 'LIVE' });
        persistPublicQueryCache(client, storage);
        expect(storage.values.has(PUBLIC_QUERY_CACHE_KEY)).toBe(false);
        await client.fetchQuery({
            queryKey: configKey,
            queryFn: () => ({ accessMode: 'LIVE' }),
            staleTime: 0,
        });
        persistPublicQueryCache(client, storage);
        expect(storage.values.has(PUBLIC_QUERY_CACHE_KEY)).toBe(false);
        expect(client.getQueryData(productKey)).toBeUndefined();
    });

    it('preserves newly seeded LIVE entities while clearing old PREVIEW entities on a fresh LIVE config', async () => {
        const client = clientForTest();
        restrictStorefrontScopePersistence(client, scope);
        const oldKey = storefrontQueryKeys.product(scope.marketCode, scope.languageCode, 'old-preview');
        await client.fetchQuery({
            queryKey: oldKey,
            queryFn: () => ({ id: 'old-preview' }),
            meta: publicQueryMeta(),
        });
        client.setQueryDefaults(productKey, { meta: publicQueryMeta() });
        await client.fetchQuery({
            queryKey: configKey,
            queryFn: () => {
                client.setQueryData(productKey, { id: 'new-live' });
                markStorefrontPublicQuerySource(client, productKey, 'LIVE');
                return { accessMode: 'LIVE' };
            },
            staleTime: 0,
        });
        expect(client.getQueryData(oldKey)).toBeUndefined();
        expect(client.getQueryData(productKey)).toEqual({ id: 'new-live' });
        const storage = memoryStorage();
        persistPublicQueryCache(client, storage);
        expect(storage.values.get(PUBLIC_QUERY_CACHE_KEY)).toContain('new-live');
        expect(storage.values.get(PUBLIC_QUERY_CACHE_KEY)).not.toContain('old-preview');
    });

    it('does not relax a restriction for a LIVE config fetch started before PREVIEW was received', async () => {
        const client = clientForTest();
        let resolve!: (value: { accessMode: string }) => void;
        const oldRead = client.fetchQuery({
            queryKey: configKey,
            queryFn: () =>
                new Promise<{ accessMode: string }>(done => {
                    resolve = done;
                }),
        });
        restrictStorefrontScopePersistence(client, scope);
        await client.fetchQuery({
            queryKey: productKey,
            queryFn: () => ({ id: 'preview' }),
            meta: publicQueryMeta(),
        });
        resolve({ accessMode: 'LIVE' });
        await oldRead;
        const storage = memoryStorage();
        persistPublicQueryCache(client, storage);
        expect(storage.values.has(PUBLIC_QUERY_CACHE_KEY)).toBe(false);
    });

    it('allows fresh PREVIEW recovery without writing a public cache, and never persists unspecified modes', async () => {
        const client = clientForTest();
        await failClosed(client);
        await client.fetchQuery({
            queryKey: configKey,
            queryFn: () => ({ accessMode: 'PREVIEW' }),
            staleTime: 0,
        });
        expect(isStorefrontScopeAccessDenied(client, scope)).toBe(false);
        await client.fetchQuery({
            queryKey: productKey,
            queryFn: () => ({ id: 'preview' }),
            meta: publicQueryMeta(),
        });
        const storage = memoryStorage();
        persistPublicQueryCache(client, storage);
        expect(storage.values.has(PUBLIC_QUERY_CACHE_KEY)).toBe(false);
        await client.fetchQuery({ queryKey: configKey, queryFn: () => ({ code: 'legacy' }), staleTime: 0 });
        persistPublicQueryCache(client, storage);
        expect(storage.values.has(PUBLIC_QUERY_CACHE_KEY)).toBe(false);
    });
});
