import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';

import { storefrontQueryKeys } from './query-client';
import { refreshStorefrontPrivateRealtimeReads } from './realtime-refresh';
import { refreshStorefrontAssociations } from './realtime-updates';

it('rechecks only active exact identities and flash-sale associations in the current scope and merges concurrent reads', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const readers = [
        vi.fn(() => Promise.resolve([])),
        vi.fn(() => Promise.resolve([])),
        vi.fn(() => Promise.resolve([])),
        vi.fn(() => Promise.resolve([])),
    ];
    const keys = [
        ['storefront', 'store-a', 'zh_Hans', 'products-by-ids', ['1', '2']],
        ['storefront', 'store-a', 'zh_Hans', 'flash-sale-associations'],
        ['storefront', 'store-b', 'zh_Hans', 'products-by-ids', ['1', '2']],
        ['storefront', 'store-a', 'zh_Hans', 'catalog', { take: 48 }],
    ];
    const observers = keys.map(
        (queryKey, index) =>
            new QueryObserver(client, { queryKey, queryFn: readers[index], staleTime: Infinity }),
    );
    const unsubscribe = observers.map(observer => observer.subscribe(() => undefined));
    try {
        await Promise.all(observers.map(observer => observer.refetch({ cancelRefetch: false })));
        readers.forEach(reader => expect(reader).toHaveBeenCalledTimes(1));
        const finishes: Array<() => void> = [];
        readers
            .slice(0, 2)
            .forEach(reader =>
                reader.mockImplementation(() => new Promise(resolve => finishes.push(() => resolve([])))),
            );
        const scope = { marketCode: 'store-a', languageCode: 'zh_Hans' };
        const first = refreshStorefrontAssociations(client, scope);
        const second = refreshStorefrontAssociations(client, scope);
        expect(readers[0]).toHaveBeenCalledTimes(2);
        expect(readers[1]).toHaveBeenCalledTimes(2);
        expect(readers[2]).toHaveBeenCalledTimes(1);
        expect(readers[3]).toHaveBeenCalledTimes(1);
        finishes.forEach(finish => finish());
        await Promise.all([first, second]);
        unsubscribe[0]();
        readers[1].mockResolvedValue([]);
        await refreshStorefrontAssociations(client, scope);
        expect(readers[0]).toHaveBeenCalledTimes(2);
    } finally {
        unsubscribe.forEach(stop => stop());
        client.clear();
    }
});

it('catches up active cart, coupon and order reads for the signed-in customer only', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const market = 'shop:MYR';
    const language = 'zh_Hans';
    const customer = 'customer-a';
    const keys = [
        storefrontQueryKeys.cart(market, language),
        storefrontQueryKeys.customerCoupons(market, language, customer),
        storefrontQueryKeys.order(market, language, customer, '42'),
        storefrontQueryKeys.customerOrders(market, language, customer, { skip: 20 }),
        storefrontQueryKeys.customerCoupons(market, language, 'customer-b'),
        storefrontQueryKeys.cart('shop:CNY', language),
        storefrontQueryKeys.cart(market, 'en'),
        storefrontQueryKeys.paymentMethods(market, language, '42', 'MYR', customer),
        storefrontQueryKeys.orderByCode(market, language, 'confirmation'),
        storefrontQueryKeys.products(market, language, 12),
    ];
    let finish!: (value: string) => void;
    const request = new Promise<string>(resolve => {
        finish = resolve;
    });
    const readers = keys.map(() => vi.fn(() => request));
    const stop = keys.map((queryKey, index) => {
        client.setQueryData(queryKey, 'before');
        const observer = new QueryObserver(client, {
            queryKey,
            queryFn: readers[index],
            staleTime: Infinity,
        });
        return index === 3 ? () => undefined : observer.subscribe(() => undefined);
    });
    const scope = { marketCode: market, languageCode: language };
    try {
        await refreshStorefrontPrivateRealtimeReads(client, scope);
        expect(readers.every(reader => reader.mock.calls.length === 0)).toBe(true);

        const signedIn = { ...scope, customerId: customer };
        const first = refreshStorefrontPrivateRealtimeReads(client, signedIn);
        const repeated = refreshStorefrontPrivateRealtimeReads(client, signedIn);
        expect(readers.map(reader => reader.mock.calls.length)).toEqual([1, 1, 1, 0, 0, 0, 0, 0, 0, 0]);
        expect(client.getQueryData(keys[0])).toBe('before');
        finish('after');
        await Promise.all([first, repeated]);
        expect(keys.slice(0, 3).map(key => client.getQueryData(key))).toEqual(['after', 'after', 'after']);
    } finally {
        stop.forEach(unsubscribe => unsubscribe());
        client.clear();
    }
});
