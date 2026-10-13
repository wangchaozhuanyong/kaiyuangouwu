import { DataSource, EntitySchema } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DefaultStockLocationStrategy } from '../../config/catalog/default-stock-location-strategy';

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

describe('StockMovementService warehouse portions and remaining allocation', () => {
    function harness() {
        const warehouses = [{ id: 'warehouse-a' }, { id: 'warehouse-b' }];
        const stock = new Map([
            ['warehouse-a', { onHand: 6, allocated: 6 }],
            ['warehouse-b', { onHand: 4, allocated: 4 }],
        ]);
        const variantFixture = { id: 'variant-1', trackInventory: 'TRUE' };
        const line = { id: 'line-1', productVariantId: variantFixture.id, productVariant: variantFixture };
        const movements: Array<{ type: string; quantity: number; stockLocationId: string }> = [
            { type: 'Allocation', quantity: 6, stockLocationId: 'warehouse-a' },
            { type: 'Allocation', quantity: 4, stockLocationId: 'warehouse-b' },
        ];
        const connection = {
            getRepository: (_ctx: unknown, entity: { name: string }) => ({
                find: () =>
                    Promise.resolve(
                        entity.name === 'OrderLine'
                            ? [line]
                            : movements.filter(item => item.type === entity.name),
                    ),
                save: (rows: any[]) => {
                    for (const row of rows) {
                        row.stockLocationId = row.stockLocation.id;
                        movements.push({
                            type: entity.name,
                            quantity: row.quantity,
                            stockLocationId: row.stockLocationId,
                        });
                    }
                    return Promise.resolve(rows);
                },
            }),
            getEntityOrThrow: () => Promise.resolve(variantFixture),
        };
        const strategy = new DefaultStockLocationStrategy();
        (strategy as any).connection = connection;
        const service = new StockMovementService(
            connection as any,
            {} as any,
            { getSettings: () => Promise.resolve({ trackInventory: true }) } as any,
            {
                updateStockAllocatedForLocation: (
                    _ctx: unknown,
                    _variant: unknown,
                    id: string,
                    delta: number,
                ) => {
                    const level = stock.get(id);
                    if (level) level.allocated += delta;
                    return Promise.resolve();
                },
                updateStockOnHandForLocation: (
                    _ctx: unknown,
                    _variant: unknown,
                    id: string,
                    delta: number,
                ) => {
                    const level = stock.get(id);
                    if (level) level.onHand += delta;
                    return Promise.resolve();
                },
            } as any,
            { publish: vi.fn() } as any,
            {
                getSaleLocations: (ctx: any, orderLine: any, quantity: number) =>
                    strategy.forSale(ctx, warehouses as any, orderLine, quantity),
                getReleaseLocations: (ctx: any, orderLine: any, quantity: number) =>
                    strategy.forRelease(ctx, warehouses as any, orderLine, quantity),
                getCancellationLocations: (ctx: any, orderLine: any, quantity: number) =>
                    strategy.forCancellation(ctx, warehouses as any, orderLine, quantity),
            } as any,
        );
        const lines = (quantity: number) => [{ orderLineId: line.id, quantity }];
        return { service, stock, lines };
    }

    it('records the 6 + 4 portions exactly once in a full sale', async () => {
        const { service, stock, lines } = harness();
        const sales = await service.createSalesForOrder({} as any, lines(10));
        expect(sales.map(item => item.quantity)).toEqual([-6, -4]);
        expect([...stock.values()]).toEqual([
            { onHand: 0, allocated: 0 },
            { onHand: 0, allocated: 0 },
        ]);
    });

    it('ships four then six from the remaining allocation of each warehouse', async () => {
        const { service, stock, lines } = harness();
        await service.createSalesForOrder({} as any, lines(4));
        const next = await service.createSalesForOrder({} as any, lines(6));
        expect(next.map(item => item.quantity)).toEqual([-2, -4]);
        expect([...stock.values()]).toEqual([
            { onHand: 0, allocated: 0 },
            { onHand: 0, allocated: 0 },
        ]);
    });

    it('partially releases only unsold allocation and uses the remaining second warehouse', async () => {
        const { service, stock, lines } = harness();
        await service.createSalesForOrder({} as any, lines(4));
        const released = await service.createReleasesForOrderLines({} as any, lines(3));
        expect(released.map(item => item.quantity)).toEqual([2, 1]);
        const remaining = await service.createSalesForOrder({} as any, lines(3));
        expect(remaining.map(item => [item.stockLocationId, item.quantity])).toEqual([['warehouse-b', -3]]);
        expect([...stock.values()]).toEqual([
            { onHand: 2, allocated: 0 },
            { onHand: 1, allocated: 0 },
        ]);
    });

    it('restores a sold portion once and rejects cancellation beyond the remaining sale', async () => {
        const { service, stock, lines } = harness();
        await service.createSalesForOrder({} as any, lines(10));
        const first = await service.createCancellationsForOrderLines({} as any, lines(7));
        expect(first.map(item => item.quantity)).toEqual([6, 1]);
        const second = await service.createCancellationsForOrderLines({} as any, lines(3));
        expect(second.map(item => item.quantity)).toEqual([3]);
        await expect(service.createCancellationsForOrderLines({} as any, lines(1))).rejects.toThrow(
            'exceeds',
        );
        expect([...stock.values()]).toEqual([
            { onHand: 6, allocated: 0 },
            { onHand: 4, allocated: 0 },
        ]);
    });
});
