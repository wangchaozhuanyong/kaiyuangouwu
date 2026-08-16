import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

import {
    MAX_STOREFRONT_PRODUCT_SALES_IDS,
    StorefrontProductSalesService,
} from './storefront-product-sales.service';

function createService(rows: Array<{ productId: string | number; quantity: string | number }>) {
    const queryBuilder: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ['innerJoin', 'select', 'addSelect', 'where', 'andWhere', 'groupBy']) {
        queryBuilder[method] = vi.fn(() => queryBuilder);
    }
    queryBuilder.getRawMany = vi.fn().mockResolvedValue(rows);
    const connection = {
        getRepository: vi.fn(() => ({ createQueryBuilder: () => queryBuilder })),
    };
    return { service: new StorefrontProductSalesService(connection as any), queryBuilder };
}

describe('StorefrontProductSalesService', () => {
    it('isolates placed sales to the current Channel and preserves zero quantities', async () => {
        const { service, queryBuilder } = createService([{ productId: '2', quantity: '7' }]);
        await expect(
            service.findByProductIds({ channelId: 'channel-1' } as any, ['1', '2', '2']),
        ).resolves.toEqual([
            { productId: '1', quantity: 0 },
            { productId: '2', quantity: 7 },
        ]);
        expect(queryBuilder.innerJoin).toHaveBeenCalledWith(
            'order.channels',
            'channel',
            'channel.id = :channelId',
            { channelId: 'channel-1' },
        );
    });

    it('rejects oversized public requests', async () => {
        const { service } = createService([]);
        const ids = Array.from({ length: MAX_STOREFRONT_PRODUCT_SALES_IDS + 1 }, (_, i) => `${i}`);
        await expect(service.findByProductIds({} as any, ids)).rejects.toThrow(/一次最多查询/);
    });
});
