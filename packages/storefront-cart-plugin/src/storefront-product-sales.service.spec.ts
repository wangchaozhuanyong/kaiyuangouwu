import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

import {
    MAX_STOREFRONT_PRODUCT_SALES_IDS,
    StorefrontProductSalesService,
} from './storefront-product-sales.service';

function createService(rows: Array<{ productId: string | number; quantity: string | number }>) {
    const queryBuilder: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of [
        'innerJoin',
        'select',
        'addSelect',
        'where',
        'andWhere',
        'groupBy',
    ]) {
        queryBuilder[method] = vi.fn(() => queryBuilder);
    }
    queryBuilder.getRawMany = vi.fn().mockResolvedValue(rows);
    const connection = {
        getRepository: vi.fn(() => ({ createQueryBuilder: () => queryBuilder })),
    };
    return {
        service: new StorefrontProductSalesService(connection as any),
        queryBuilder,
    };
}

describe('StorefrontProductSalesService', () => {
    it('returns current-channel placed order quantities and zeroes for unsold products', async () => {
        const { service, queryBuilder } = createService([
            { productId: 'product-2', quantity: '7' },
        ]);

        const result = await service.findByProductIds(
            { channelId: 'channel-1' } as any,
            ['product-1', 'product-2', 'product-2'],
        );

        expect(result).toEqual([
            { productId: 'product-1', quantity: 0 },
            { productId: 'product-2', quantity: 7 },
        ]);
        expect(queryBuilder.innerJoin).toHaveBeenCalledWith(
            'order.channels',
            'channel',
            'channel.id = :channelId',
            { channelId: 'channel-1' },
        );
        expect(queryBuilder.andWhere).toHaveBeenCalledWith('order.orderPlacedAt IS NOT NULL');
        expect(queryBuilder.andWhere).toHaveBeenCalledWith('order.state != :cancelledState', {
            cancelledState: 'Cancelled',
        });
    });

    it('rejects oversized public requests', async () => {
        const { service } = createService([]);
        const productIds = Array.from(
            { length: MAX_STOREFRONT_PRODUCT_SALES_IDS + 1 },
            (_, index) => `product-${index}`,
        );

        await expect(
            service.findByProductIds({ channelId: 'channel-1' } as any, productIds),
        ).rejects.toThrow(/一次最多查询/);
    });
});
