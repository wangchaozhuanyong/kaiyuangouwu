import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { Product, ProductVariant, RequestContextCacheService } from '@vendure/core';
import { buildSchema, parse, print, validate } from 'graphql';
import { DataSource, EntitySchema } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { digitalProductAdminSchema } from './digital-product.schema';
import { DigitalProductService } from './digital-product.service';
import { AutoCardConfig } from './entities/auto-card-config.entity';
import { AutoCardPoolItem } from './entities/auto-card-pool-item.entity';
import { DigitalOrderReservation, DigitalVariantConfig } from './entities/digital-product.entity';

// Exercise the real grouped SQL in an owned in-memory database, including partial release/consumption.
const reservations = new EntitySchema({
    name: 'WorkspaceReservation',
    columns: {
        id: { type: Number, primary: true },
        channelId: { type: String },
        configId: { type: String },
        state: { type: String },
        quantity: { type: Number },
        releasedQuantity: { type: Number },
        consumedQuantity: { type: Number },
    },
});
const cards = new EntitySchema({
    name: 'WorkspaceCard',
    columns: {
        id: { type: Number, primary: true },
        configId: { type: String },
        state: { type: String },
    },
});
const database = new DataSource({ type: 'sqljs', entities: [reservations, cards], synchronize: true });

beforeAll(() => database.initialize());
beforeEach(async () => {
    await database.getRepository(reservations).clear();
    await database.getRepository(cards).clear();
});
afterAll(async () => {
    if (database.isInitialized) await database.destroy();
});

function harness(
    policies: Array<'limited' | 'unlimited' | 'pool_derived' | 'legacy'> = ['limited'],
    sourceChannels?: string[],
) {
    const ctx = { channelId: 'store-a', currencyCode: CurrencyCode.CNY } as any;
    const variants = policies.map((_, index) => ({
        id: `${index}`,
        sku: `SKU-${index}`,
        customFields: { digitalDeliveryMode: 'manual_service' },
    }));
    const configurations = policies.flatMap((stockPolicy, index) =>
        stockPolicy === 'legacy'
            ? []
            : [
                  {
                      id: `config-${index}`,
                      channelId: sourceChannels?.[index] ?? ctx.channelId,
                      productVariantId: `${index}`,
                      deliveryMode: stockPolicy === 'pool_derived' ? 'auto_card' : 'manual_service',
                      stockPolicy,
                      availableQuantity: 7,
                  },
              ],
    );
    const cardConfigurations = policies.flatMap((policy, index) =>
        policy === 'pool_derived'
            ? [
                  {
                      id: `cards-${index}`,
                      productVariantId: `${index}`,
                      channelId: sourceChannels?.[index] ?? ctx.channelId,
                  },
              ]
            : [],
    );
    const configFind = vi.fn(
        ({ where }: { where: { channelId: string; productVariantId: { value: string[] } } }) =>
            Promise.resolve(
                configurations.filter(
                    item =>
                        item.channelId === where.channelId &&
                        where.productVariantId.value.includes(item.productVariantId),
                ),
            ),
    );
    const cardConfigFind = vi.fn(
        ({ where }: { where: { channelId: string; productVariantId: { value: string[] } } }) =>
            Promise.resolve(
                cardConfigurations.filter(
                    item =>
                        item.channelId === where.channelId &&
                        where.productVariantId.value.includes(item.productVariantId),
                ),
            ),
    );
    const contextForDisplay = vi.fn((request: typeof ctx, variantId: string) =>
        Promise.resolve({ ...request, channelId: sourceChannels?.[Number(variantId)] ?? request.channelId }),
    );
    const reservationRead = vi.fn(() =>
        database.getRepository(reservations).createQueryBuilder('reservation'),
    );
    const poolRead = vi.fn(() => database.getRepository(cards).createQueryBuilder('item'));
    const variantFind = vi.fn().mockResolvedValue(variants);
    const connection = {
        getEntityOrThrow: vi.fn().mockResolvedValue({ customFields: { fulfillmentType: 'digital' } }),
        getRepository: (_ctx: unknown, entity: unknown) => {
            if (entity === ProductVariant) return { find: variantFind };
            if (entity === DigitalVariantConfig) return { find: configFind };
            if (entity === AutoCardConfig) return { find: cardConfigFind };
            if (entity === DigitalOrderReservation) return { createQueryBuilder: reservationRead };
            if (entity === AutoCardPoolItem) return { createQueryBuilder: poolRead };
            throw new Error(`Unexpected inventory read: ${String(entity)}`);
        },
    };
    const catalog = {
        latestCost: vi.fn().mockResolvedValue(null),
        variantSupplier: vi.fn().mockResolvedValue(null),
    };
    const service = new DigitalProductService(
        connection as never,
        {} as never,
        catalog as never,
        new RequestContextCacheService(),
        undefined,
        sourceChannels ? ({ contextForDisplay } as never) : undefined,
    );
    return {
        service,
        ctx,
        connection,
        configFind,
        configurations,
        cardConfigFind,
        cardConfigurations,
        contextForDisplay,
        reservationRead,
        poolRead,
        variantFind,
    };
}

describe('unified channel-scoped digital inventory projection', () => {
    it('keeps remaining quota intact and sums held remainder separately from consumed units', async () => {
        await database.getRepository(reservations).save([
            {
                id: 1,
                channelId: 'store-a',
                configId: 'config-0',
                state: 'HELD',
                quantity: 10,
                releasedQuantity: 3,
                consumedQuantity: 2,
            },
            {
                id: 2,
                channelId: 'store-a',
                configId: 'config-0',
                state: 'CONSUMED',
                quantity: 4,
                releasedQuantity: 0,
                consumedQuantity: 4,
            },
            {
                id: 3,
                channelId: 'store-a',
                configId: 'config-0',
                state: 'RELEASED',
                quantity: 3,
                releasedQuantity: 3,
                consumedQuantity: 0,
            },
            {
                id: 4,
                channelId: 'store-b',
                configId: 'config-0',
                state: 'HELD',
                quantity: 100,
                releasedQuantity: 0,
                consumedQuantity: 0,
            },
            {
                id: 5,
                channelId: 'store-a',
                configId: 'unrelated-config',
                state: 'HELD',
                quantity: 100,
                releasedQuantity: 0,
                consumedQuantity: 0,
            },
        ]);
        const test = harness();
        const result = await test.service.workspace(test.ctx, 'product');
        expect(result.variants[0].inventory).toMatchObject({
            source: 'LIMITED_QUOTA',
            availableQuantity: 7,
            reservedQuantity: 5,
            consumedQuantity: 6,
            observedAt: expect.any(Date),
        });
        expect(result.variants[0].availableQuantity).toBe(7);
        expect(test.connection.getEntityOrThrow).toHaveBeenCalledWith(test.ctx, Product, 'product', {
            channelId: 'store-a',
        });
        expect(test.variantFind).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ productId: 'product', channels: { id: 'store-a' } }),
            }),
        );
        expect(await database.getRepository(reservations).count()).toBe(5);
    });

    it('distinguishes unlimited supply from a measured zero while still reporting order usage', async () => {
        await database.getRepository(reservations).save({
            id: 1,
            channelId: 'store-a',
            configId: 'config-0',
            state: 'HELD',
            quantity: 5,
            releasedQuantity: 0,
            consumedQuantity: 2,
        });
        const test = harness(['unlimited']);
        const result = await test.service.workspace(test.ctx, 'product');
        expect(result.variants[0].inventory).toMatchObject({
            source: 'UNLIMITED',
            availableQuantity: null,
            reservedQuantity: 3,
            consumedQuantity: 2,
        });
    });

    it('uses actual AVAILABLE cards rather than the quota field, without subtracting reservations twice', async () => {
        await database
            .getRepository(cards)
            .save([
                ...Array.from({ length: 3 }, (_, id) => ({ id, configId: 'cards-0', state: 'AVAILABLE' })),
                { id: 4, configId: 'cards-0', state: 'RESERVED' },
                { id: 5, configId: 'cards-0', state: 'SENT' },
                { id: 6, configId: 'other-store-cards', state: 'AVAILABLE' },
            ]);
        await database.getRepository(reservations).save({
            id: 1,
            channelId: 'store-a',
            configId: 'config-0',
            state: 'HELD',
            quantity: 2,
            releasedQuantity: 0,
            consumedQuantity: 0,
        });
        const test = harness(['pool_derived']);
        test.configurations[0].availableQuantity = 999;
        const result = await test.service.workspace(test.ctx, 'product');
        expect(result.variants[0].inventory).toMatchObject({
            source: 'CARD_POOL',
            availableQuantity: 3,
            reservedQuantity: 2,
            consumedQuantity: 0,
        });
        expect(result.variants[0].availableQuantity).toBe(999); // Legacy edit/CAS contract is unchanged.
        expect(test.cardConfigFind).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ channelId: 'store-a', enabled: true }),
            }),
        );
        expect(test.poolRead).toHaveBeenCalledTimes(1);
        expect(result.variants[0].inventory).not.toHaveProperty('poolItemIds');
    });

    it('returns measured zero for an active empty configuration or missing enabled card source', async () => {
        const test = harness(['limited', 'pool_derived']);
        test.configurations[0].availableQuantity = 0;
        test.cardConfigFind.mockResolvedValue([]);
        const result = await test.service.workspace(test.ctx, 'product');
        expect(result.variants.map(item => item.inventory)).toEqual([
            expect.objectContaining({
                source: 'LIMITED_QUOTA',
                availableQuantity: 0,
                reservedQuantity: 0,
                consumedQuantity: 0,
            }),
            expect.objectContaining({
                source: 'CARD_POOL',
                availableQuantity: 0,
                reservedQuantity: 0,
                consumedQuantity: 0,
            }),
        ]);
        expect(test.poolRead).not.toHaveBeenCalled();
    });

    it('keeps all legacy quantities unknown without querying or creating a second stock ledger', async () => {
        const test = harness(['legacy']);
        const result = await test.service.workspace(test.ctx, 'product');
        expect(result.variants[0]).toMatchObject({
            migrationRequired: true,
            inventory: {
                source: 'LEGACY_UNMIGRATED',
                availableQuantity: null,
                reservedQuantity: null,
                consumedQuantity: null,
            },
        });
        expect(test.reservationRead).not.toHaveBeenCalled();
        expect(test.poolRead).not.toHaveBeenCalled();
    });

    it('batches 48 specifications into one reservation and one available-card aggregate', async () => {
        const test = harness(Array.from({ length: 48 }, () => 'pool_derived'));
        const result = await test.service.workspace(test.ctx, 'product');
        expect(result.variants).toHaveLength(48);
        expect(test.configFind).toHaveBeenCalledTimes(1);
        expect(test.cardConfigFind).toHaveBeenCalledTimes(1);
        expect(test.reservationRead).toHaveBeenCalledTimes(1);
        expect(test.poolRead).toHaveBeenCalledTimes(1);
        expect(new Set(result.variants.map(item => item.inventory.observedAt)).size).toBe(1);
    });

    it('propagates a failed inventory read instead of inventing zero availability', async () => {
        const test = harness();
        test.reservationRead.mockImplementation(() => {
            throw new Error('Inventory read unavailable');
        });
        await expect(test.service.workspace(test.ctx, 'product')).rejects.toThrow(
            'Inventory read unavailable',
        );
    });

    it('accepts the inventory projection while preserving the previous workspace query', () => {
        const schema = buildSchema(`${print(digitalProductAdminSchema)}
            interface Node { id: ID! createdAt: DateTime! updatedAt: DateTime! }
            scalar DateTime
            scalar Upload
            type Product { id: ID! }
            type CatalogSupplier { id: ID! }
            type Query { noop: Boolean }
            type Mutation { noop: Boolean }
        `);
        expect(
            validate(
                schema,
                parse(`query Workspace { digitalProductWorkspace(productId:"1") {
            variants { id availableQuantity migrationRequired inventory { source availableQuantity reservedQuantity consumedQuantity observedAt } }
        } }`),
            ),
        ).toEqual([]);
    });

    it('keeps authorized source pools separate in one request and exposes only the current store order totals', async () => {
        const scenario = harness(['pool_derived', 'pool_derived'], ['source-a', 'source-b']);
        scenario.cardConfigurations.push({
            id: 'target-local-cards',
            productVariantId: '0',
            channelId: 'store-a',
        });
        await database.getRepository(cards).save([
            { id: 1, configId: 'cards-0', state: 'AVAILABLE' },
            { id: 2, configId: 'cards-0', state: 'AVAILABLE' },
            { id: 3, configId: 'cards-0', state: 'AVAILABLE' },
            { id: 4, configId: 'cards-1', state: 'AVAILABLE' },
            { id: 5, configId: 'target-local-cards', state: 'AVAILABLE' },
            { id: 6, configId: 'unrelated-cards', state: 'AVAILABLE' },
        ]);
        await database.getRepository(reservations).save([
            {
                id: 1,
                configId: 'config-0',
                channelId: 'store-a',
                state: 'HELD',
                quantity: 2,
                consumedQuantity: 0,
                releasedQuantity: 0,
            },
            {
                id: 2,
                configId: 'config-0',
                channelId: 'other-store',
                state: 'HELD',
                quantity: 50,
                consumedQuantity: 11,
                releasedQuantity: 0,
            },
            {
                id: 3,
                configId: 'config-1',
                channelId: 'store-a',
                state: 'HELD',
                quantity: 4,
                consumedQuantity: 0,
                releasedQuantity: 0,
            },
            {
                id: 4,
                configId: 'config-1',
                channelId: 'other-store',
                state: 'CONSUMED',
                quantity: 50,
                consumedQuantity: 50,
                releasedQuantity: 0,
            },
        ]);
        const result = await scenario.service.workspace(scenario.ctx, 'product');
        expect(result.variants.map(item => item.inventory)).toEqual([
            expect.objectContaining({
                source: 'CARD_POOL',
                availableQuantity: 3,
                reservedQuantity: 2,
                consumedQuantity: 0,
            }),
            expect.objectContaining({
                source: 'CARD_POOL',
                availableQuantity: 1,
                reservedQuantity: 4,
                consumedQuantity: 0,
            }),
        ]);
        expect(scenario.configFind.mock.calls.map(([options]) => options.where.channelId)).toEqual([
            'source-a',
            'source-b',
        ]);
        expect(scenario.cardConfigFind.mock.calls.map(([options]) => options.where.channelId)).toEqual([
            'source-a',
            'source-b',
        ]);
        expect(scenario.poolRead).toHaveBeenCalledTimes(1);
        expect(scenario.reservationRead).toHaveBeenCalledTimes(2);
    });

    it('keeps source authorization failures visible and never reads unauthorized quantities', async () => {
        const scenario = harness(['limited'], ['source-a']);
        scenario.contextForDisplay.mockRejectedValue(new Error('Source authorization changed'));
        await expect(scenario.service.workspace(scenario.ctx, 'product')).rejects.toThrow(
            'Source authorization changed',
        );
        expect(scenario.configFind).not.toHaveBeenCalled();
        expect(scenario.reservationRead).not.toHaveBeenCalled();
        expect(scenario.poolRead).not.toHaveBeenCalled();
    });

    it('keeps managed target products read-only at the explicit migration entry', async () => {
        const scenario = harness();
        const sourceGuard = {
            assertEditable: vi.fn().mockRejectedValue(new Error('Managed source is read-only')),
        };
        const service: DigitalProductService = Reflect.construct(DigitalProductService, [
            scenario.connection,
            {},
            {},
            new RequestContextCacheService(),
            undefined,
            sourceGuard,
        ]);
        vi.spyOn(service, 'lock').mockImplementation((_request, entity) =>
            Promise.resolve(
                entity === ProductVariant
                    ? ({ id: '0', productId: 'product' } as never)
                    : ({ customFields: { fulfillmentType: 'digital' } } as never),
            ),
        );
        const ctx = { ...scenario.ctx, channel: { code: 'current-store' } };
        await expect(service.migrate(ctx, '0', 7, 0)).rejects.toThrow('Managed source is read-only');
        expect(sourceGuard.assertEditable).toHaveBeenCalledExactlyOnceWith(ctx, 'product');
        expect(scenario.configFind).not.toHaveBeenCalled();
        expect(scenario.reservationRead).not.toHaveBeenCalled();
    });
});
