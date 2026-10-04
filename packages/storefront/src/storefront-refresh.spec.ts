import { QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import {
    createStorefrontQueryClient,
    refreshStorefrontQueries,
    storefrontPlaceholderData,
    storefrontQueryKeys,
} from './query-client';

describe('shared storefront refresh lifecycle', () => {
    it('refreshes every active public read including content, joins repeated clicks, and isolates private/store/language data', async () => {
        const client = createStorefrontQueryClient();
        const scope = { marketCode: 'shop:MYR', languageCode: 'zh_Hans' };
        const keys = [
            [...storefrontQueryKeys.content(scope.marketCode, scope.languageCode), 'public'],
            storefrontQueryKeys.products(scope.marketCode, scope.languageCode, 12),
            storefrontQueryKeys.commerceMode(scope.marketCode),
            storefrontQueryKeys.customer(scope.marketCode, scope.languageCode),
            storefrontQueryKeys.content('other:MYR', scope.languageCode),
            storefrontQueryKeys.content(scope.marketCode, 'en'),
        ];
        let release!: () => void;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });
        const reads = keys.map(() =>
            vi.fn(async () => {
                await gate;
                return { updated: true };
            }),
        );
        const stop = keys.map((key, index) => {
            client.setQueryData(key, { updated: false });
            return new QueryObserver(client, {
                queryKey: key,
                queryFn: reads[index],
                staleTime: Infinity,
            }).subscribe(() => undefined);
        });
        try {
            const first = refreshStorefrontQueries(client, scope);
            const repeated = refreshStorefrontQueries(client, scope);
            expect(reads.map(fn => fn.mock.calls.length)).toEqual([1, 1, 1, 0, 0, 0]);
            release();
            await Promise.all([first, repeated]);
            expect(client.getQueryData(keys[0])).toEqual({ updated: true });
            expect(client.getQueryData(keys[3])).toEqual({ updated: false });
            await refreshStorefrontQueries(client, { ...scope, includePrivate: true });
            expect(reads[3]).toHaveBeenCalledTimes(1);
        } finally {
            stop.forEach(unsubscribe => unsubscribe());
            client.clear();
        }
    });
    it('never executes an inactive or disabled query as part of page retry', async () => {
        const client = createStorefrontQueryClient();
        const scope = { marketCode: 'shop:MYR', languageCode: 'zh_Hans' };
        const read = vi.fn(() => []);
        const key = storefrontQueryKeys.content(scope.marketCode, scope.languageCode);
        client.setQueryData(key, []);
        const observer = new QueryObserver(client, { queryKey: key, queryFn: read, enabled: false });
        const stop = observer.subscribe(() => undefined);
        await refreshStorefrontQueries(client, scope);
        expect(read).not.toHaveBeenCalled();
        stop();
        client.clear();
    });
    it('retains placeholders for a filter change but clears them across store, currency or language switches', () => {
        const previous = { pages: [{ items: [{ id: 'old' }] }] };
        const key = storefrontQueryKeys.catalog('shop:MYR', 'zh_Hans', { term: 'old' });
        expect(
            storefrontPlaceholderData(
                previous,
                key,
                storefrontQueryKeys.catalog('shop:MYR', 'zh_Hans', { term: 'new' }),
            ),
        ).toBe(previous);
        for (const next of [
            storefrontQueryKeys.catalog('other:MYR', 'zh_Hans', {}),
            storefrontQueryKeys.catalog('shop:CNY', 'zh_Hans', {}),
            storefrontQueryKeys.catalog('shop:MYR', 'en', {}),
        ])
            expect(storefrontPlaceholderData(previous, key, next)).toBeUndefined();
    });
});
