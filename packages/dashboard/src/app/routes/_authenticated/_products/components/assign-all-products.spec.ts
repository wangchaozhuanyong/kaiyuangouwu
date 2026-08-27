import { describe, expect, it, vi } from 'vitest';

import {
    assignProductBatchesToChannels,
    fetchAllProductIds,
    isAssignAllProductsAvailable,
} from './assign-all-products.js';

describe('isAssignAllProductsAvailable', () => {
    it('is available only in the default channel when another target channel exists', () => {
        const defaultChannel = { id: 'default', code: '__default_channel__' };
        const storeChannel = { id: 'store', code: 'store' };

        expect(
            isAssignAllProductsAvailable(
                defaultChannel,
                [defaultChannel, storeChannel],
                '__default_channel__',
            ),
        ).toBe(true);
        expect(
            isAssignAllProductsAvailable(storeChannel, [defaultChannel, storeChannel], '__default_channel__'),
        ).toBe(false);
        expect(isAssignAllProductsAvailable(defaultChannel, [defaultChannel], '__default_channel__')).toBe(
            false,
        );
    });
});

describe('fetchAllProductIds', () => {
    it('loads every page until totalItems is reached', async () => {
        const fetchPage = vi.fn(({ skip, take }: { skip: number; take: number }) =>
            Promise.resolve({
                items: Array.from({ length: Math.min(take, 5 - skip) }, (_, index) => ({
                    id: `product-${skip + index + 1}`,
                })),
                totalItems: 5,
            }),
        );
        const onProgress = vi.fn();

        const result = await fetchAllProductIds(fetchPage, onProgress, 2);

        expect(result).toEqual(['product-1', 'product-2', 'product-3', 'product-4', 'product-5']);
        expect(fetchPage).toHaveBeenCalledTimes(3);
        expect(onProgress).toHaveBeenLastCalledWith({ fetched: 5, total: 5 });
    });

    it('stops when the API returns an empty page', async () => {
        const fetchPage = vi
            .fn()
            .mockResolvedValueOnce({ items: [{ id: 'product-1' }], totalItems: 3 })
            .mockResolvedValueOnce({ items: [], totalItems: 3 });

        await expect(fetchAllProductIds(fetchPage, undefined, 1)).resolves.toEqual(['product-1']);
        expect(fetchPage).toHaveBeenCalledTimes(2);
    });
});

describe('assignProductBatchesToChannels', () => {
    it('assigns every product to every channel in bounded sequential batches', async () => {
        const mutationFn = vi.fn().mockResolvedValue({});
        const onProgress = vi.fn();

        const result = await assignProductBatchesToChannels({
            productIds: ['p1', 'p2', 'p3'],
            channelIds: ['c1', 'c2'],
            priceFactor: 1.25,
            mutationFn,
            onProgress,
            batchSize: 2,
        });

        expect(mutationFn.mock.calls).toEqual([
            [{ input: { productIds: ['p1', 'p2'], channelId: 'c1', priceFactor: 1.25 } }],
            [{ input: { productIds: ['p3'], channelId: 'c1', priceFactor: 1.25 } }],
            [{ input: { productIds: ['p1', 'p2'], channelId: 'c2', priceFactor: 1.25 } }],
            [{ input: { productIds: ['p3'], channelId: 'c2', priceFactor: 1.25 } }],
        ]);
        expect(result).toEqual({ completedAssignments: 6, failedAssignments: 0, failures: [] });
        expect(onProgress).toHaveBeenLastCalledWith({ completed: 6, total: 6 });
    });

    it('records a failed batch and continues assigning the remaining batches', async () => {
        const error = new Error('failed');
        const mutationFn = vi
            .fn()
            .mockResolvedValueOnce({})
            .mockRejectedValueOnce(error)
            .mockResolvedValueOnce({});

        const result = await assignProductBatchesToChannels({
            productIds: ['p1', 'p2', 'p3'],
            channelIds: ['c1'],
            priceFactor: 1,
            mutationFn,
            batchSize: 1,
        });

        expect(mutationFn).toHaveBeenCalledTimes(3);
        expect(result.completedAssignments).toBe(2);
        expect(result.failedAssignments).toBe(1);
        expect(result.failures).toEqual([{ channelId: 'c1', productIds: ['p2'], reason: error }]);
    });
});
