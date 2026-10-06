import { InventoryLot } from '@vendure/catalog-management-plugin';
import { RequestContextCacheService, StockLevel, StockLocation } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { ProductPackagingRule } from './entities/product-packaging-rule.entity';
import { PackagingStockLocationStrategy } from './packaging-stock-location-strategy';

describe('PackagingStockLocationStrategy', () => {
    it.each([12, 48])(
        '%i physical products with 3 SKUs batch lots, location permissions and packaging rules',
        async products => {
            const strategy = new PackagingStockLocationStrategy();
            const findLots = vi.fn().mockResolvedValue([]);
            const findLocations = vi.fn().mockResolvedValue([
                { id: 'location-1', channels: [{ id: 'channel-1' }] },
                { id: 'other-store', channels: [{ id: 'channel-2' }] },
            ]);
            const findRules = vi.fn().mockResolvedValue([]);
            Object.assign(strategy, {
                connection: {
                    getRepository: (_ctx: unknown, entity: unknown) => ({
                        find:
                            entity === InventoryLot
                                ? findLots
                                : entity === StockLocation
                                  ? findLocations
                                  : findRules,
                    }),
                },
                requestContextCache: new RequestContextCacheService(),
            });
            const ctx = { channelId: 'channel-1' } as never;
            const result = await Promise.all(
                Array.from({ length: products * 3 }, (_, id) =>
                    strategy.getAvailableStockForDisplay(ctx, id, [
                        stockLevel(String(id), 10, 2),
                        stockLevel(String(id), 1000, 0, 'other-store'),
                    ]),
                ),
            );
            expect(result).toEqual(
                Array.from({ length: products * 3 }, () => ({ stockOnHand: 10, stockAllocated: 2 })),
            );
            expect(findLots).toHaveBeenCalledTimes(1);
            expect(findLocations).toHaveBeenCalledTimes(1);
            expect(findRules).toHaveBeenCalledTimes(1);
        },
    );

    it('display batching keeps package thresholds and rejects expired lots', async () => {
        const strategy = new PackagingStockLocationStrategy();
        const rule = {
            unitVariantId: 'unit',
            packageVariantId: 'package',
            unitsPerPackage: 24,
            packageVariant: { useGlobalOutOfStockThreshold: true, outOfStockThreshold: 0 },
        };
        Object.assign(strategy, {
            connection: {
                getRepository: (_ctx: unknown, entity: unknown) => ({
                    find: vi.fn(({ where }: any) => {
                        if (entity === StockLocation)
                            return Promise.resolve([{ id: 'location-1', channels: [{ id: 'channel-1' }] }]);
                        if (entity === ProductPackagingRule) return Promise.resolve([rule]);
                        if (entity === StockLevel) return Promise.resolve([stockLevel('package', 3, 1)]);
                        if (entity === InventoryLot && where.variantId._value.includes('unit'))
                            return Promise.resolve([
                                {
                                    id: 'valid',
                                    variantId: 'unit',
                                    stockLocationId: 'location-1',
                                    quantityOnHand: 4,
                                    state: 'ACTIVE',
                                    expiresAt: null,
                                },
                                {
                                    id: 'expired',
                                    variantId: 'unit',
                                    stockLocationId: 'location-1',
                                    quantityOnHand: 6,
                                    state: 'ACTIVE',
                                    expiresAt: new Date('2000-01-01'),
                                },
                            ]);
                        return Promise.resolve([]);
                    }),
                }),
            },
            requestContextCache: new RequestContextCacheService(),
            globalSettingsService: { getSettings: vi.fn().mockResolvedValue({ outOfStockThreshold: 1 }) },
        });
        await expect(
            strategy.getAvailableStockForDisplay({ channelId: 'channel-1' } as never, 'unit', [
                stockLevel('unit', 10, 1),
            ]),
        ).resolves.toEqual({ stockOnHand: 76, stockAllocated: 49 });
    });

    it('includes only convertible package stock after package allocations and threshold', async () => {
        const strategy = new PackagingStockLocationStrategy();
        const repository = vi.fn((_ctx: unknown, entity: unknown) =>
            entity === InventoryLot
                ? { find: vi.fn().mockResolvedValue([]) }
                : entity === ProductPackagingRule
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
                    entity === InventoryLot
                        ? { find: vi.fn().mockResolvedValue([]) }
                        : entity === ProductPackagingRule
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
