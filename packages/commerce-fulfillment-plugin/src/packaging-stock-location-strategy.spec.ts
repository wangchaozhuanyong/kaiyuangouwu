import { StockLevel } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { ProductPackagingRule } from './entities/product-packaging-rule.entity';
import { PackagingStockLocationStrategy } from './packaging-stock-location-strategy';

describe('PackagingStockLocationStrategy', () => {
    it('includes only convertible package stock after package allocations and threshold', async () => {
        const strategy = new PackagingStockLocationStrategy();
        const repository = vi.fn((_ctx: unknown, entity: unknown) =>
            entity === ProductPackagingRule
                ? {
                      findOne: vi.fn().mockResolvedValue({
                          packageVariantId: 'package-variant',
                          unitsPerPackage: 24,
                          packageVariant: {
                              useGlobalOutOfStockThreshold: true,
                              outOfStockThreshold: 0,
                          },
                      }),
                  }
                : {
                      find: vi.fn().mockResolvedValue([stockLevel('package-variant', 3, 1)]),
                  },
        );
        Object.assign(strategy, {
            connection: { getRepository: repository },
            globalSettingsService: {
                getSettings: vi.fn().mockResolvedValue({ outOfStockThreshold: 1 }),
            },
            channelIdCache: {
                get: vi.fn().mockResolvedValue(['channel-1']),
            },
        });

        await expect(
            strategy.getAvailableStock({ channelId: 'channel-1' } as never, 'unit-variant', [
                stockLevel('unit-variant', 4, 1),
            ]),
        ).resolves.toEqual({
            stockOnHand: 76,
            stockAllocated: 49,
        });
    });

    it('applies the stock threshold once when allocating packaging variants across locations', async () => {
        const strategy = new PackagingStockLocationStrategy();
        const locations = [{ id: 'location-1' }, { id: 'location-2' }];
        Object.assign(strategy, {
            connection: {
                getRepository: vi.fn((_ctx: unknown, entity: unknown) =>
                    entity === ProductPackagingRule
                        ? { findOne: vi.fn().mockResolvedValue({ id: 'rule-1' }) }
                        : {
                              find: vi
                                  .fn()
                                  .mockResolvedValue([
                                      stockLevel('package-variant', 1, 0, 'location-1'),
                                      stockLevel('package-variant', 1, 0, 'location-2'),
                                  ]),
                          },
                ),
                getEntityOrThrow: vi.fn().mockResolvedValue({
                    trackInventory: 'TRUE',
                    useGlobalOutOfStockThreshold: true,
                    outOfStockThreshold: 0,
                }),
            },
            globalSettingsService: {
                getSettings: vi.fn().mockResolvedValue({
                    trackInventory: true,
                    outOfStockThreshold: 1,
                }),
            },
        });

        await expect(
            strategy.forAllocation(
                { channelId: 'channel-1' } as never,
                locations as never,
                { productVariantId: 'package-variant' } as never,
                1,
            ),
        ).resolves.toEqual([{ location: locations[1], quantity: 1 }]);
    });
});

function stockLevel(
    productVariantId: string,
    stockOnHand: number,
    stockAllocated: number,
    stockLocationId = 'location-1',
): StockLevel {
    return new StockLevel({
        productVariantId,
        stockLocationId,
        stockOnHand,
        stockAllocated,
    });
}
