import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';

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
