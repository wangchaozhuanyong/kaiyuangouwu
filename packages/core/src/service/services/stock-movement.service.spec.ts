import { DataSource, EntitySchema } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { StockMovementService } from './stock-movement.service';

const channel = new EntitySchema<{ id: string }>({
    name: 'MovementChannelFixture',
    columns: { id: { type: String, primary: true } },
});
const location = new EntitySchema<{ id: string; channels: Array<{ id: string }> }>({
    name: 'MovementWarehouseFixture',
    columns: { id: { type: String, primary: true } },
    relations: { channels: { type: 'many-to-many', target: 'MovementChannelFixture', joinTable: true } },
});
const variant = new EntitySchema<{ id: string }>({
    name: 'MovementVariantFixture',
    columns: { id: { type: String, primary: true } },
});
const movement = new EntitySchema<{
    id: string;
    type: string;
    stockLocation: unknown;
    productVariant: unknown;
}>({
    name: 'MovementFixture',
    columns: { id: { type: String, primary: true }, type: { type: String } },
    relations: {
        stockLocation: { type: 'many-to-one', target: 'MovementWarehouseFixture' },
        productVariant: { type: 'many-to-one', target: 'MovementVariantFixture' },
    },
});
const database = new DataSource({
    type: 'sqljs',
    entities: [channel, location, variant, movement],
    synchronize: true,
});
describe('StockMovementService shared SKU warehouse database scope', () => {
    const service = new StockMovementService(
        {} as any,
        { build: () => database.getRepository(movement).createQueryBuilder('stockmovement') } as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
    );
    beforeAll(async () => {
        await database.initialize();
        await database
            .getRepository(channel)
            .save([{ id: 'store-a' }, { id: 'store-b' }, { id: 'platform' }]);
        await database.getRepository(location).save([
            { id: 'warehouse-a', channels: [{ id: 'store-a' }, { id: 'platform' }] },
            { id: 'warehouse-b', channels: [{ id: 'store-b' }] },
        ]);
        await database.getRepository(variant).save([{ id: 'shared-sku' }, { id: 'other-sku' }]);
        await database.getRepository(movement).save([
            {
                id: 'movement-a',
                type: 'ADJUSTMENT',
                stockLocation: { id: 'warehouse-a' },
                productVariant: { id: 'shared-sku' },
            },
            {
                id: 'movement-b',
                type: 'ADJUSTMENT',
                stockLocation: { id: 'warehouse-b' },
                productVariant: { id: 'shared-sku' },
            },
            {
                id: 'other-movement',
                type: 'ADJUSTMENT',
                stockLocation: { id: 'warehouse-a' },
                productVariant: { id: 'other-sku' },
            },
            {
                id: 'sale-a',
                type: 'SALE',
                stockLocation: { id: 'warehouse-a' },
                productVariant: { id: 'shared-sku' },
            },
        ]);
    });
    afterAll(async () => {
        if (database.isInitialized) await database.destroy();
    });
    it.each(['store-a', 'store-b'])(
        'restricts shared SKU movement to %s warehouse even for SuperAdmin',
        async channelId => {
            const result = await service.getStockMovementsByProductVariantId(
                { channelId, channel: { code: channelId }, userHasPermissions: () => true } as any,
                'shared-sku',
                { type: 'ADJUSTMENT' } as any,
            );
            expect(result.items.map(item => item.id)).toEqual([
                channelId === 'store-a' ? 'movement-a' : 'movement-b',
            ]);
            expect(result.totalItems).toBe(1);
        },
    );
    it('returns no movement for a store without its own warehouse', async () => {
        const result = await service.getStockMovementsByProductVariantId(
            { channelId: 'store-c', channel: { code: 'store-c' } } as any,
            'shared-sku',
        );
        expect(result).toEqual({ items: [], totalItems: 0 });
    });
    it('lets the platform see all warehouses while preserving SKU and movement-type filters', async () => {
        const result = await service.getStockMovementsByProductVariantId(
            { channelId: 'platform', channel: { code: '__default_channel__' } } as any,
            'shared-sku',
            { type: 'ADJUSTMENT' } as any,
        );
        expect(result.items.map(item => item.id).sort()).toEqual(['movement-a', 'movement-b']);
        expect(result.totalItems).toBe(2);
    });
});
