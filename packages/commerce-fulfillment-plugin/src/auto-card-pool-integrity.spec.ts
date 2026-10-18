import { Subject } from 'rxjs';
import { DataSource, EntitySchema } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AutoCardPoolEnabledEvent } from './auto-card-delivery.event';
import { inconsistentPoolReservationIds, usablePoolItems } from './auto-card-pool-integrity';
import { AutoCardService } from './auto-card.service';
import { AutoCardConfig } from './entities/auto-card-config.entity';
import { AutoCardDelivery } from './entities/auto-card-delivery.entity';
import { AutoCardPoolItem } from './entities/auto-card-pool-item.entity';
import { DigitalOrderReservation, DigitalVariantConfig } from './entities/digital-product.entity';

// Real TypeORM SQL/conditional updates over the columns involved in this invariant.
// Full Vendure DI and MySQL transactions are verified by the integration selection.
const pool = new EntitySchema<any>({
    name: 'IntegrityPool',
    target: AutoCardPoolItem,
    tableName: 'auto_card_pool_item',
    columns: {
        id: { type: Number, primary: true },
        configId: { type: Number },
        sequence: { type: Number },
        state: { type: String },
        assignedAt: { type: Date, nullable: true },
        deliveryId: { type: Number, nullable: true },
        disabledReason: { type: String, nullable: true },
        encryptedPayload: { type: String, default: 'synthetic' },
    },
});
const config = new EntitySchema<any>({
    name: 'IntegrityPoolConfig',
    target: AutoCardConfig,
    tableName: 'auto_card_config',
    columns: {
        id: { type: Number, primary: true },
        channelId: { type: Number },
        productVariantId: { type: Number },
    },
});
const digital = new EntitySchema<any>({
    name: 'IntegrityDigitalConfig',
    target: DigitalVariantConfig,
    tableName: 'digital_variant_config',
    columns: {
        id: { type: Number, primary: true },
        channelId: { type: Number },
        productVariantId: { type: Number },
    },
});
const claim = new EntitySchema<any>({
    name: 'IntegrityReservation',
    target: DigitalOrderReservation,
    tableName: 'digital_order_reservation',
    columns: {
        id: { type: Number, primary: true },
        configId: { type: Number },
        orderLineId: { type: Number, default: 10 },
        state: { type: String },
        stockPolicy: { type: String },
        quantity: { type: Number },
        releasedQuantity: { type: Number },
        consumedQuantity: { type: Number },
        poolItemIdsJson: { type: String },
    },
});
const delivery = new EntitySchema<any>({
    name: 'IntegrityDelivery',
    target: AutoCardDelivery,
    tableName: 'auto_card_delivery',
    columns: {
        id: { type: Number, primary: true },
        configId: { type: Number },
        orderLineId: { type: Number },
    },
});
const database = new DataSource({
    type: 'sqljs',
    entities: [pool, config, digital, claim, delivery],
    synchronize: true,
});
const ctx = { channelId: 5 } as any;
const connection = {
    rawConnection: database,
    getRepository: (_ctx: unknown, entity: any) => database.getRepository(entity),
} as any;

beforeAll(() => database.initialize());
beforeEach(async () => {
    for (const entity of [
        DigitalOrderReservation,
        AutoCardPoolItem,
        AutoCardDelivery,
        AutoCardConfig,
        DigitalVariantConfig,
    ])
        await database.getRepository(entity).clear();
    await database.getRepository(AutoCardConfig).save({ id: 8, channelId: 5, productVariantId: 9 });
    await database.getRepository(DigitalVariantConfig).save({ id: 18, channelId: 5, productVariantId: 9 });
});
afterAll(async () => {
    if (database.isInitialized) await database.destroy();
});

async function card(id: number, values: Record<string, unknown> = {}) {
    await database.getRepository(AutoCardPoolItem).save({
        id,
        configId: 8,
        sequence: id,
        state: 'AVAILABLE',
        assignedAt: null,
        deliveryId: null,
        disabledReason: null,
        encryptedPayload: 'synthetic',
        ...values,
    });
}
async function reservation(values: Record<string, unknown> = {}) {
    await database.getRepository(DigitalOrderReservation).save({
        id: 10,
        configId: 18,
        state: 'HELD',
        stockPolicy: 'pool_derived',
        quantity: 1,
        releasedQuantity: 0,
        consumedQuantity: 0,
        poolItemIdsJson: '[1]',
        ...values,
    });
}
function maintenanceHarness() {
    const eventBus = { publish: vi.fn().mockResolvedValue(undefined) };
    const service = Object.assign(Object.create(AutoCardService.prototype), {
        connection,
        eventBus,
        cipher: { decrypt: () => ({}) },
        publishSupplyStockChange: vi.fn().mockResolvedValue(undefined),
        reconcileVariant: vi.fn().mockResolvedValue(undefined),
        ownedPoolItemOrThrow: async (_ctx: unknown, id: number) => ({
            ...(await database.getRepository(AutoCardPoolItem).findOneByOrFail({ id })),
            config: {
                id: 8,
                productVariantId: 9,
                fieldsJson: '[{"key":"code","label":"Code","secret":true}]',
            },
        }),
    });
    return { service, eventBus };
}

describe('card-pool historical claim protection', () => {
    it('skips old delivery/assigned markers rather than selecting them for a new reservation', async () => {
        await card(1, { deliveryId: 77 });
        await card(2, { assignedAt: new Date() });
        await card(3);
        expect((await usablePoolItems(ctx, connection, 8, 1)).map(item => item.id)).toEqual([3]);
    });
    it.each(['HELD', 'CONSUMED'])('quarantines an unmarked card still claimed by %s', async state => {
        await card(1);
        await card(2);
        await reservation({ state, consumedQuantity: state === 'CONSUMED' ? 1 : 0 });
        expect((await usablePoolItems(ctx, connection, 8, 1)).map(item => item.id)).toEqual([2]);
        await expect(maintenanceHarness().service.setPoolItemEnabled(ctx, 1, false)).rejects.toThrow(
            '未核清',
        );
    });
    it.each(['HELD', 'CONSUMED'])(
        'preserves legitimate partial release while %s claims remain marked',
        async state => {
            await card(1);
            if (state === 'CONSUMED')
                await database.getRepository(AutoCardDelivery).save({ id: 77, configId: 8, orderLineId: 10 });
            await card(2, {
                state: state === 'HELD' ? 'RESERVED' : 'ASSIGNED',
                deliveryId: state === 'CONSUMED' ? 77 : null,
            });
            await reservation({
                quantity: 2,
                releasedQuantity: 1,
                state,
                consumedQuantity: state === 'CONSUMED' ? 1 : 0,
                poolItemIdsJson: '[1,2]',
            });
            expect((await usablePoolItems(ctx, connection, 8, 1)).map(item => item.id)).toEqual([1]);
        },
    );
    it('reuses fully released cards and permits only the owning reserved-card list for paid allocation', async () => {
        await card(1, { state: 'RESERVED' });
        await card(2, { configId: 88, state: 'RESERVED' });
        await reservation();
        expect(
            (await usablePoolItems(ctx, connection, 8, 2, 'RESERVED', [1, 2], 10)).map(item => item.id),
        ).toEqual([1]);
        await database.getRepository(AutoCardPoolItem).update(1, { state: 'AVAILABLE' });
        await database
            .getRepository(DigitalOrderReservation)
            .update(10, { state: 'RELEASED', releasedQuantity: 1 });
        expect(await inconsistentPoolReservationIds(ctx, connection, 8, [1])).toEqual(new Set());
    });
    it.each(['RESERVED', 'ASSIGNED'])(
        'does not count a released card now owned by B as proof for A (%s)',
        async state => {
            await card(1, { state, deliveryId: state === 'ASSIGNED' ? 78 : null });
            await card(2); // A's still-required card lost its original markers.
            await card(3);
            await reservation({ quantity: 2, releasedQuantity: 1, poolItemIdsJson: '[1,2]' });
            await reservation({
                id: 11,
                orderLineId: 11,
                state: state === 'ASSIGNED' ? 'CONSUMED' : 'HELD',
                consumedQuantity: state === 'ASSIGNED' ? 1 : 0,
                poolItemIdsJson: '[1]',
            });
            if (state === 'ASSIGNED')
                await database.getRepository(AutoCardDelivery).save({ id: 78, configId: 8, orderLineId: 11 });
            expect((await usablePoolItems(ctx, connection, 8, 1)).map(item => item.id)).toEqual([3]);
            await expect(maintenanceHarness().service.setPoolItemEnabled(ctx, 2, true)).rejects.toThrow(
                '未核清',
            );
        },
    );
    it('allocates only A remaining card after its released card was legitimately reserved by B', async () => {
        await card(1, { state: 'RESERVED' });
        await card(2, { state: 'RESERVED' });
        await reservation({ quantity: 2, releasedQuantity: 1, poolItemIdsJson: '[1,2]' });
        await reservation({ id: 11, orderLineId: 11, poolItemIdsJson: '[1]' });
        expect(
            (await usablePoolItems(ctx, connection, 8, 1, 'RESERVED', [1, 2], 10)).map(item => item.id),
        ).toEqual([2]);
    });
});

describe('card-pool maintenance conditional updates', () => {
    it.each([
        [false, 'RESERVED'],
        [false, 'ASSIGNED'],
        [true, 'RESERVED'],
        [true, 'ASSIGNED'],
    ] as const)(
        'does not overwrite a concurrent %s/%s transition from an old snapshot',
        async (enabled, state) => {
            await card(1, { state: enabled ? 'DISABLED' : 'AVAILABLE' });
            const { service } = maintenanceHarness();
            const read = service.ownedPoolItemOrThrow;
            service.ownedPoolItemOrThrow = async (...args: unknown[]) => {
                const old = await read(...args);
                await database.getRepository(AutoCardPoolItem).update(1, {
                    state,
                    deliveryId: state === 'ASSIGNED' ? 77 : null,
                    assignedAt: state === 'ASSIGNED' ? new Date('2026-10-17T00:00:00Z') : null,
                });
                return old;
            };
            await expect(service.setPoolItemEnabled(ctx, 1, enabled)).rejects.toThrow('状态已变化');
            expect(await database.getRepository(AutoCardPoolItem).findOneByOrFail({ id: 1 })).toMatchObject({
                state,
                deliveryId: state === 'ASSIGNED' ? 77 : null,
            });
            expect(service.publishSupplyStockChange).not.toHaveBeenCalled();
        },
    );
    it('makes duplicate enables idempotent and queues recovery instead of allocating while holding the item lock', async () => {
        await card(1, { state: 'DISABLED' });
        const { service, eventBus } = maintenanceHarness();
        await service.setPoolItemEnabled(ctx, 1, true);
        await service.setPoolItemEnabled(ctx, 1, true);
        expect(service.reconcileVariant).not.toHaveBeenCalled();
        expect(eventBus.publish).toHaveBeenCalledExactlyOnceWith(expect.any(AutoCardPoolEnabledEvent));
        expect(service.publishSupplyStockChange).toHaveBeenCalledTimes(1);
    });
    it('reconciles in a fresh transaction when the committed event arrives and unsubscribes at shutdown', () => {
        const { service } = maintenanceHarness();
        const committed = new Subject<AutoCardPoolEnabledEvent>();
        const tx = { channelId: 5, freshTransaction: true };
        const withTransaction = vi.fn((_ctx, work) => work(tx));
        service.connection = { withTransaction };
        service.eventBus = { ofType: vi.fn(() => committed) };
        service.onApplicationBootstrap();
        expect(service.reconcileVariant).not.toHaveBeenCalled();
        committed.next(new AutoCardPoolEnabledEvent(ctx, '9'));
        expect(service.reconcileVariant).toHaveBeenCalledExactlyOnceWith(tx, '9');
        service.onModuleDestroy();
        committed.next(new AutoCardPoolEnabledEvent(ctx, '9'));
        expect(withTransaction).toHaveBeenCalledTimes(1);
    });
});
