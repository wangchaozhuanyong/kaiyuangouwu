import { StockAdjustment, StockLevel, StockMovementEvent } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { PackagingUnpackEvent } from './entities/packaging-unpack-event.entity';
import { ProductPackagingRule } from './entities/product-packaging-rule.entity';
import { ProductPackagingService } from './product-packaging.service';

describe('ProductPackagingService automatic unpacking', () => {
    it('opens the minimum packages, transfers stock and publishes stock movements', async () => {
        const stockLevelSave = vi.fn().mockImplementation(values => Promise.resolve(values));
        const stockAdjustmentSave = vi.fn().mockImplementation(values => Promise.resolve(values));
        const unpackEventSave = vi.fn().mockImplementation(value => Promise.resolve(value));
        const connection = {
            getRepository: vi.fn((_ctx: unknown, entity: unknown) => {
                if (entity === StockLevel) return { save: stockLevelSave };
                if (entity === StockAdjustment) return { save: stockAdjustmentSave };
                if (entity === PackagingUnpackEvent) return { save: unpackEventSave };
                throw new Error('Unexpected repository');
            }),
        };
        const eventBus = { publish: vi.fn().mockResolvedValue(undefined) };
        const service = new ProductPackagingService(
            connection as never,
            { getSettings: vi.fn().mockResolvedValue({ outOfStockThreshold: 0 }) } as never,
            eventBus as never,
        );
        const rule = new ProductPackagingRule({
            id: 'rule-1',
            channelId: 'channel-1',
            unitVariantId: 'unit-variant',
            packageVariantId: 'package-variant',
            unitsPerPackage: 24,
            autoUnpack: true,
            unitVariant: {
                name: 'Bottle',
                useGlobalOutOfStockThreshold: true,
                outOfStockThreshold: 0,
            },
            packageVariant: {
                name: 'Case',
                useGlobalOutOfStockThreshold: true,
                outOfStockThreshold: 0,
            },
        });
        const unitStock = stockLevel('unit-variant', 2);
        const packageStock = stockLevel('package-variant', 2);

        await expect(
            service.autoUnpackForOrder(
                { channelId: 'channel-1', languageCode: 'en' } as never,
                { id: 'order-1' } as never,
                [{ productVariantId: 'unit-variant', quantity: 5 }] as never,
                [rule],
                [unitStock, packageStock],
            ),
        ).resolves.toBeUndefined();

        expect(packageStock.stockOnHand).toBe(1);
        expect(unitStock.stockOnHand).toBe(26);
        expect(stockLevelSave).toHaveBeenCalledWith([packageStock, unitStock]);
        expect(stockAdjustmentSave).toHaveBeenCalledWith([
            expect.objectContaining({ quantity: -1 }),
            expect.objectContaining({ quantity: 24 }),
        ]);
        expect(unpackEventSave).toHaveBeenCalledWith(
            expect.objectContaining({
                orderId: 'order-1',
                packagesOpened: 1,
                unitsCreated: 24,
                packageStockBefore: 2,
                packageStockAfter: 1,
                unitStockBefore: 2,
                unitStockAfter: 26,
            }),
        );
        expect(eventBus.publish).toHaveBeenCalledWith(expect.any(StockMovementEvent));
    });
});

function stockLevel(productVariantId: string, stockOnHand: number): StockLevel {
    const level = new StockLevel({
        productVariantId,
        stockLocationId: 'location-1',
        stockOnHand,
        stockAllocated: 0,
    });
    level.stockLocation = { channels: [{ id: 'channel-1' }] } as never;
    return level;
}
