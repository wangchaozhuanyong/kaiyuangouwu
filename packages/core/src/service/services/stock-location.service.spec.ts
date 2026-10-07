import 'reflect-metadata';

import { DeletionResult, Permission } from '@vendure/common/lib/generated-types';
import { DataSource, EntitySchema } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { StockLocationResolver } from '../../api/resolvers/admin/stock-location.resolver';
import { EntityNotFoundError, ForbiddenError, UserInputError } from '../../common/error/errors';
import { StockLevel } from '../../entity/stock-level/stock-level.entity';
import { StockLocation } from '../../entity/stock-location/stock-location.entity';

import { StockLocationService } from './stock-location.service';

const channels = new EntitySchema<{ id: number; code: string }>({
    name: 'WarehouseMaintenanceChannel',
    columns: { id: { type: Number, primary: true }, code: { type: String } },
});
const locations = new EntitySchema<{
    id: number;
    name: string;
    description: string;
    customFields: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
    channels: Array<{ id: number }>;
}>({
    name: 'WarehouseMaintenanceLocation',
    columns: {
        id: { type: Number, primary: true, generated: true },
        name: { type: String },
        description: { type: String, default: '' },
        customFields: { type: 'simple-json', default: '{}' },
        createdAt: { type: Date, createDate: true },
        updatedAt: { type: Date, updateDate: true },
    },
    relations: {
        channels: { type: 'many-to-many', target: 'WarehouseMaintenanceChannel', joinTable: true },
    },
});
const levels = new EntitySchema<{
    id: number;
    stockLocationId: number;
    productVariantId: number;
    stockOnHand: number;
    stockAllocated: number;
}>({
    name: 'WarehouseMaintenanceLevel',
    columns: {
        id: { type: Number, primary: true, generated: true },
        stockLocationId: { type: Number },
        productVariantId: { type: Number },
        stockOnHand: { type: Number },
        stockAllocated: { type: Number },
    },
    indices: [{ columns: ['stockLocationId', 'productVariantId'], unique: true }],
    relations: {
        stockLocation: {
            type: 'many-to-one',
            target: 'WarehouseMaintenanceLocation',
            joinColumn: { name: 'stockLocationId' },
            onDelete: 'CASCADE',
        },
    },
});
const database = new DataSource({
    type: 'sqljs',
    entities: [channels, locations, levels],
    synchronize: true,
});

function fixture(channelId = 2, superAdmin = false) {
    const ctx = {
        channelId,
        channel: { id: channelId, code: channelId === 1 ? '__default_channel__' : `store-${channelId}` },
        userHasPermissions: (permissions: Permission[]) =>
            superAdmin || !permissions.includes(Permission.SuperAdmin),
        translate: (key: string) => key,
    } as any;
    const locationRepository = database.getRepository(locations);
    const connection = {
        getRepository: (_ctx: unknown, type: unknown) =>
            type === StockLevel ? database.getRepository(levels) : locationRepository,
        getEntityOrThrow: async (_ctx: unknown, _type: unknown, id: number, options: any = {}) => {
            const entity = await locationRepository.findOne({ where: { id }, relations: options.relations });
            if (!entity) throw new EntityNotFoundError('StockLocation', id);
            return entity;
        },
        findOneInChannel: (_ctx: unknown, _type: unknown, id: number, activeChannelId: number) =>
            locationRepository
                .createQueryBuilder('stockLocation')
                .innerJoin('stockLocation.channels', 'channel')
                .where('stockLocation.id = :id', { id })
                .andWhere('channel.id = :channelId', { channelId: activeChannelId })
                .getOne(),
    };
    const channelService = {
        getDefaultChannel: () => Promise.resolve({ id: 1 }),
        assignToCurrentChannel: (location: StockLocation, activeCtx: typeof ctx) => {
            location.channels = [...new Set([1, activeCtx.channelId])].map(id => ({ id })) as any;
            return Promise.resolve(location);
        },
    };
    const eventBus = { publish: vi.fn() };
    const customFields = { updateRelations: vi.fn() };
    const service = new StockLocationService(
        {} as any,
        connection as any,
        channelService as any,
        {} as any,
        {
            build: (_type: unknown, _options: unknown, queryOptions: { channelId: number }) =>
                locationRepository
                    .createQueryBuilder('stockLocation')
                    .innerJoin('stockLocation.channels', 'channel')
                    .where('channel.id = :channelId', { channelId: queryOptions.channelId }),
        } as any,
        {} as any,
        {} as any,
        customFields as any,
        eventBus as any,
    );
    return { service, ctx, eventBus, customFields, resolver: new StockLocationResolver(service) };
}

async function snapshot() {
    return {
        locations: await database
            .getRepository(locations)
            .find({ relations: ['channels'], order: { id: 'ASC' } }),
        levels: await database.getRepository(levels).find({ order: { id: 'ASC' } }),
    };
}

describe('StockLocationService store maintenance database scope', () => {
    beforeAll(async () => {
        await database.initialize();
    });
    beforeEach(async () => {
        await database.synchronize(true);
        await database.getRepository(channels).save([
            { id: 1, code: '__default_channel__' },
            { id: 2, code: 'store-a' },
            { id: 3, code: 'store-b' },
            { id: 4, code: 'store-without-warehouse' },
            { id: 5, code: 'store-with-one-warehouse' },
        ]);
        await database.getRepository(locations).save([
            { id: 10, name: 'A source', channels: [{ id: 1 }, { id: 2 }] },
            { id: 11, name: 'A destination', channels: [{ id: 1 }, { id: 2 }] },
            { id: 20, name: 'B source', channels: [{ id: 1 }, { id: 3 }] },
            { id: 21, name: 'B destination', channels: [{ id: 1 }, { id: 3 }] },
            { id: 30, name: 'Shared A B', channels: [{ id: 1 }, { id: 2 }, { id: 3 }] },
            { id: 40, name: 'Platform only', channels: [{ id: 1 }] },
            { id: 50, name: 'Only warehouse', channels: [{ id: 1 }, { id: 5 }] },
        ]);
        await database.getRepository(levels).save([
            { stockLocationId: 10, productVariantId: 100, stockOnHand: 5, stockAllocated: 2 },
            { stockLocationId: 10, productVariantId: 101, stockOnHand: 4, stockAllocated: 0 },
            { stockLocationId: 11, productVariantId: 100, stockOnHand: 7, stockAllocated: 1 },
            { stockLocationId: 20, productVariantId: 100, stockOnHand: 9, stockAllocated: 3 },
        ]);
    });
    afterAll(async () => {
        if (database.isInitialized) await database.destroy();
    });

    it('lets an employee create, read and update their warehouse with the default platform association', async () => {
        const f = fixture();
        expect(f.ctx.userHasPermissions([Permission.SuperAdmin])).toBe(false);
        const created = await f.resolver.createStockLocation(f.ctx, { input: { name: 'New A warehouse' } });
        const saved = await database.getRepository(locations).findOneOrFail({
            where: { id: Number(created.id) },
            relations: ['channels'],
        });
        expect(saved.channels.map(channel => channel.id).sort()).toEqual([1, 2]);
        expect((await f.service.findOne(f.ctx, created.id))?.name).toBe('New A warehouse');
        expect(await f.service.findOne(fixture(3).ctx, created.id)).toBeUndefined();
        const updated = await f.resolver.updateStockLocation(f.ctx, {
            input: { id: created.id, name: 'Updated A warehouse', description: 'Store A' },
        });
        expect(updated).toMatchObject({ name: 'Updated A warehouse', description: 'Store A' });
        expect(f.customFields.updateRelations).toHaveBeenCalledOnce();
        expect((await f.service.findAll(f.ctx)).items.map(item => item.id)).not.toContain(20);
        expect((await f.resolver.deleteStockLocation(f.ctx, { input: { id: created.id } })).result).toBe(
            DeletionResult.DELETED,
        );
    });

    it.each([false, true])(
        'rejects other-store and platform-only CRUD IDs (SuperAdmin: %s)',
        async superAdmin => {
            const f = fixture(2, superAdmin);
            const before = await snapshot();
            for (const id of [20, 40, 999]) {
                await expect(f.service.update(f.ctx, { id, name: 'Forged change' })).rejects.toBeInstanceOf(
                    EntityNotFoundError,
                );
                await expect(f.service.delete(f.ctx, { id })).rejects.toBeInstanceOf(EntityNotFoundError);
            }
            expect(await snapshot()).toEqual(before);
            expect(f.eventBus.publish).not.toHaveBeenCalled();
        },
    );

    it.each([false, true])(
        'rejects maintenance of operating-store shared warehouses (SuperAdmin: %s)',
        async superAdmin => {
            const f = fixture(2, superAdmin);
            const before = await snapshot();
            await expect(
                f.service.update(f.ctx, { id: 30, name: 'Shared overwrite' }),
            ).rejects.toBeInstanceOf(ForbiddenError);
            await expect(
                f.service.delete(f.ctx, { id: 30, transferToLocationId: 11 }),
            ).rejects.toBeInstanceOf(ForbiddenError);
            expect(await snapshot()).toEqual(before);
            expect(f.eventBus.publish).not.toHaveBeenCalled();
        },
    );

    it.each([20, 30, 40, 999])(
        'rejects transfer destination %s before any inventory changes',
        async destination => {
            const f = fixture(2, true);
            const before = await snapshot();
            await expect(
                f.service.delete(f.ctx, { id: 10, transferToLocationId: destination }),
            ).rejects.toThrow();
            expect(await snapshot()).toEqual(before);
            expect(f.eventBus.publish).not.toHaveBeenCalled();
        },
    );

    it('rejects transfer to the deleted source even in platform context', async () => {
        const f = fixture(1, true);
        const before = await snapshot();
        await expect(f.service.delete(f.ctx, { id: 10, transferToLocationId: '10' })).rejects.toBeInstanceOf(
            ForbiddenError,
        );
        expect(await snapshot()).toEqual(before);
    });

    it('merges and creates same-store stock levels while preserving other-store inventory', async () => {
        const f = fixture();
        expect(await f.service.delete(f.ctx, { id: 10, transferToLocationId: 11 })).toEqual({
            result: DeletionResult.DELETED,
        });
        expect(await database.getRepository(locations).findOneBy({ id: 10 })).toBeNull();
        const savedLevels = await database.getRepository(levels).find({ order: { productVariantId: 'ASC' } });
        expect(savedLevels).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    stockLocationId: 11,
                    productVariantId: 100,
                    stockOnHand: 12,
                    stockAllocated: 3,
                }),
                expect.objectContaining({
                    stockLocationId: 11,
                    productVariantId: 101,
                    stockOnHand: 4,
                    stockAllocated: 0,
                }),
                expect.objectContaining({
                    stockLocationId: 20,
                    productVariantId: 100,
                    stockOnHand: 9,
                    stockAllocated: 3,
                }),
            ]),
        );
        expect(savedLevels).toHaveLength(3);
    });

    it('preserves the last warehouse in the active store regardless of other-store warehouse count', async () => {
        const f = fixture(5);
        const before = await snapshot();
        expect(await f.service.delete(f.ctx, { id: 50 })).toEqual({
            result: DeletionResult.NOT_DELETED,
            message: 'message.cannot-delete-last-stock-location',
        });
        expect(await snapshot()).toEqual(before);
    });

    it('deletes a batch sequentially so the final warehouse remains in the store', async () => {
        await database.getRepository(locations).delete(30);
        const f = fixture();
        const result = await f.resolver.deleteStockLocations(f.ctx, { input: [{ id: 10 }, { id: 11 }] });
        expect(result.map(response => response.result)).toEqual([
            DeletionResult.DELETED,
            DeletionResult.NOT_DELETED,
        ]);
        expect((await f.service.findAll(f.ctx)).items.map(item => item.id)).toEqual([11]);
        expect((await fixture(3).service.findAll(fixture(3).ctx)).items.map(item => item.id).sort()).toEqual([
            20, 21,
        ]);
    });

    it('retains default-platform maintenance for shared and other-store warehouses', async () => {
        const f = fixture(1, true);
        expect((await f.service.update(f.ctx, { id: 30, name: 'Platform updated shared' })).name).toBe(
            'Platform updated shared',
        );
        expect(await f.service.delete(f.ctx, { id: 20, transferToLocationId: 10 })).toEqual({
            result: DeletionResult.DELETED,
        });
        expect(
            await database.getRepository(levels).findOneBy({ stockLocationId: 10, productVariantId: 100 }),
        ).toMatchObject({
            stockOnHand: 14,
            stockAllocated: 5,
        });
        expect(await f.service.delete(f.ctx, { id: 30 })).toEqual({ result: DeletionResult.DELETED });
    });

    it('keeps the final platform warehouse and supports maintenance before default membership repair', async () => {
        await database.getRepository(locations).delete([10, 11, 20, 21, 30, 40, 50]);
        const orphan = await database.getRepository(locations).save({ name: 'Unassigned warehouse' });
        const f = fixture(1, true);
        expect((await f.service.update(f.ctx, { id: orphan.id, name: 'Platform repaired name' })).name).toBe(
            'Platform repaired name',
        );
        expect((await f.service.delete(f.ctx, { id: orphan.id })).result).toBe(DeletionResult.NOT_DELETED);
    });

    it('chooses the oldest current-store warehouse instead of the global first warehouse', async () => {
        const f = fixture(3);
        expect((await f.service.defaultStockLocation(f.ctx)).id).toBe(20);
    });

    it('keeps an existing store-owned technical inventory usable for a digital-only store', async () => {
        await database.getRepository(locations).update(20, { name: 'Store B technical inventory' });
        const f = fixture(3);
        f.ctx.channel.customFields = { commerceMode: 'DIGITAL_ONLY' };
        const before = await snapshot();
        expect(await f.service.defaultStockLocation(f.ctx)).toMatchObject({
            id: 20,
            name: 'Store B technical inventory',
        });
        expect(await snapshot()).toEqual(before);
    });

    it.each([false, true])(
        'rejects default inventory routing for a store without a warehouse (SuperAdmin: %s)',
        async superAdmin => {
            const f = fixture(4, superAdmin);
            const before = await snapshot();
            const failure = await f.service.defaultStockLocation(f.ctx).catch(error => error);
            expect(failure).toBeInstanceOf(UserInputError);
            expect(failure.message).toBe('当前店铺尚未配置库存仓库，请联系平台完成本店库存配置');
            expect(await snapshot()).toEqual(before);
        },
    );

    it('retains the platform fallback when no warehouse has default-channel membership', async () => {
        const repository = database.getRepository(locations);
        for (const location of await repository.find({ relations: ['channels'] })) {
            location.channels = location.channels.filter(channel => channel.id !== 1);
            await repository.save(location);
        }
        const f = fixture(1, true);
        expect((await f.service.defaultStockLocation(f.ctx)).id).toBe(10);
    });
});

describe('StockLocationResolver staff RBAC and transaction contract', () => {
    it.each([
        ['createStockLocation', Permission.CreateStockLocation],
        ['updateStockLocation', Permission.UpdateStockLocation],
        ['deleteStockLocation', Permission.DeleteStockLocation],
        ['deleteStockLocations', Permission.DeleteStockLocation],
    ] as const)('preserves the existing permission and transaction on %s', (method, permission) => {
        const handler = Object.getOwnPropertyDescriptor(StockLocationResolver.prototype, method)?.value;
        expect(Reflect.getMetadata('__permissions__', handler)).toEqual([permission]);
        expect(Reflect.getMetadata('__transaction_mode__', handler)).toBe('auto');
    });
});
