import { describe, expect, it } from 'vitest';

import {
    PUBLIC_QUERY_CACHE_KEY,
    PUBLIC_QUERY_CACHE_MAX_AGE,
    createStorefrontQueryClient,
    persistPublicQueryCache,
    publicQueryMeta,
    restorePublicQueryCache,
    storefrontQueryKeys,
} from './query-client';

function memoryStorage() {
    const values = new Map<string, string>();
    return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        values,
    };
}

describe('public React Query session cache', () => {
    it('deduplicates concurrent queries and refreshes after invalidation', async () => {
        const client = createStorefrontQueryClient();
        let requestCount = 0;
        const options = {
            queryKey: storefrontQueryKeys.product('cn', 'zh_Hans', '1'),
            queryFn: async () => {
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
    });

    it('persists only explicitly public successful queries', async () => {
        const client = createStorefrontQueryClient();
        await client.fetchQuery({
            queryKey: ['storefront', 'cn', 'zh', 'product', '1'],
            queryFn: async () => ({ id: '1' }),
            meta: publicQueryMeta(),
        });
        await client.fetchQuery({
            queryKey: ['storefront', 'cn', 'zh', 'private', 'customer'],
            queryFn: async () => ({ emailAddress: 'private@example.com' }),
        });
        const storage = memoryStorage();

        persistPublicQueryCache(client, storage as any, 1_000);
        const serialized = storage.values.get(PUBLIC_QUERY_CACHE_KEY) ?? '';

        expect(serialized).toContain('product');
        expect(serialized).not.toContain('private@example.com');
        expect(serialized).not.toContain('customer');
    });

    it('restores a fresh cache and rejects entries older than five minutes', async () => {
        const source = createStorefrontQueryClient();
        await source.fetchQuery({
            queryKey: ['storefront', 'my', 'en', 'content'],
            queryFn: async () => ['hero'],
            meta: publicQueryMeta(),
        });
        const storage = memoryStorage();
        persistPublicQueryCache(source, storage as any, 1_000);

        const fresh = createStorefrontQueryClient();
        expect(restorePublicQueryCache(fresh, storage as any, 2_000)).toBe(true);
        expect(fresh.getQueryData(['storefront', 'my', 'en', 'content'])).toEqual(['hero']);

        const expired = createStorefrontQueryClient();
        expect(restorePublicQueryCache(expired, storage as any, 1_000 + PUBLIC_QUERY_CACHE_MAX_AGE + 1)).toBe(
            false,
        );
        expect(storage.values.has(PUBLIC_QUERY_CACHE_KEY)).toBe(false);
    });
});
