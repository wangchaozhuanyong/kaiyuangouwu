import { describe, expect, it, vi } from 'vitest';

import { CatalogApi } from './catalog';
import { type ShopApiContext } from './client-context';

describe('complete public product identities', () => {
    it('batches 205 identities, preserves order, and never replaces a missing identity', async () => {
        const ids = Array.from({ length: 205 }, (_, index) => `p-${index}`);
        const request = vi.fn((_document: string, variables: any, _signal?: AbortSignal) => {
            const batch = variables.options.filter.id.in as string[];
            const items = [...batch]
                .reverse()
                .filter(id => id !== 'p-3')
                .map(id => ({ id }));
            return Promise.resolve({ products: { items, totalItems: items.length } });
        });
        const api = new CatalogApi({ request } as unknown as ShopApiContext);
        const signal = new AbortController().signal;
        expect((await api.productsByIds([...ids, 'p-0'], signal)).map(product => product.id)).toEqual(
            ids.filter(id => id !== 'p-3'),
        );
        expect(request.mock.calls.map(call => call[1].options.take)).toEqual([100, 100, 5]);
        expect(request.mock.calls.every(call => call[2] === signal)).toBe(true);
    });
    it('rejects a failed or incomplete batch instead of publishing a partial authoritative list', async () => {
        const request = vi
            .fn()
            .mockResolvedValueOnce({ products: { items: [{ id: 'p-0' }], totalItems: 1 } })
            .mockRejectedValueOnce(new Error('network'));
        const api = new CatalogApi({ request } as unknown as ShopApiContext);
        await expect(
            api.productsByIds(Array.from({ length: 101 }, (_, index) => `p-${index}`)),
        ).rejects.toThrow('network');
        request.mockReset().mockResolvedValue({ products: { items: [], totalItems: 1 } });
        await expect(api.productsByIds(['p-0'])).rejects.toThrow('incomplete');
    });
});
