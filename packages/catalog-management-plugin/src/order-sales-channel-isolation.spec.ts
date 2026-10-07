import { Channel, Order } from '@vendure/core';
import { DataSource, EntitySchema } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { StorefrontOrderAttribution } from '../../store-management-plugin/src/entities/storefront-order-attribution.entity';
import { MarketingAttributionService } from '../../store-management-plugin/src/marketing-attribution.service';

import { CatalogProfitService } from './catalog-profit.service';

const channel = new EntitySchema({
    name: 'SalesChannelFixture',
    columns: {
        id: { type: Number, primary: true },
        code: { type: String },
        defaultCurrencyCode: { type: String },
    },
});
const customer = new EntitySchema({
    name: 'SalesCustomerFixture',
    columns: { id: { type: Number, primary: true } },
});
const line = new EntitySchema<{ id: number; order: unknown }>({
    name: 'SalesLineFixture',
    columns: { id: { type: Number, primary: true } },
    relations: { order: { type: 'many-to-one', target: 'SalesOrderFixture', inverseSide: 'lines' } },
});
const order = new EntitySchema<{
    id: number;
    code: string;
    salesChannelId: number;
    currencyCode: string;
    orderPlacedAt: Date;
    salesChannel: unknown;
    channels: unknown[];
    lines: unknown[];
    customer: unknown;
}>({
    name: 'SalesOrderFixture',
    columns: {
        id: { type: Number, primary: true },
        code: { type: String },
        salesChannelId: { type: Number },
        currencyCode: { type: String },
        orderPlacedAt: { type: Date },
    },
    relations: {
        salesChannel: {
            type: 'many-to-one',
            target: 'SalesChannelFixture',
            joinColumn: { name: 'salesChannelId' },
        },
        channels: { type: 'many-to-many', target: 'SalesChannelFixture', joinTable: true },
        lines: { type: 'one-to-many', target: 'SalesLineFixture', inverseSide: 'order' },
        customer: { type: 'many-to-one', target: 'SalesCustomerFixture', nullable: true },
    },
});
const database = new DataSource({
    type: 'sqljs',
    entities: [channel, customer, line, order],
    synchronize: true,
});
describe('order sales ownership despite shared channel membership', () => {
    const ctx = { channelId: 1, channel: { code: 'a' }, userHasPermissions: () => true } as any;
    const getRepository = (_ctx: any, entity: any) => {
        if (entity === Channel) return database.getRepository(channel);
        if (entity !== Order) throw new Error('Unexpected entity');
        return database.getRepository(order);
    };
    beforeAll(async () => {
        await database.initialize();
        await database.getRepository(channel).save([
            { id: 1, code: 'a', defaultCurrencyCode: 'MYR' },
            { id: 2, code: 'b', defaultCurrencyCode: 'CNY' },
            { id: 9, code: '__default_channel__', defaultCurrencyCode: 'MYR' },
        ]);
        await database.getRepository(order).save([
            {
                id: 1,
                code: 'OWN',
                salesChannelId: 1,
                currencyCode: 'MYR',
                orderPlacedAt: new Date(),
                channels: [{ id: 1 }, { id: 2 }],
            },
            {
                id: 2,
                code: 'FOREIGN',
                salesChannelId: 2,
                currencyCode: 'MYR',
                orderPlacedAt: new Date(),
                channels: [{ id: 1 }, { id: 2 }],
            },
        ]);
    });
    afterAll(async () => {
        if (database.isInitialized) await database.destroy();
    });
    it('rejects another store expense lookup and excludes it from expense import resolution', async () => {
        const service = new CatalogProfitService({ getRepository } as any);
        await expect((service as any).scopedOrderById(ctx, '2')).rejects.toThrow('当前店铺');
        await expect((service as any).scopedOrderById(ctx, '1')).resolves.toMatchObject({ code: 'OWN' });
        const rows = await (service as any).scopedExpenseImportOrders(ctx, { currencyCode: 'MYR' }, [
            { orderCode: 'OWN' },
            { orderCode: 'FOREIGN' },
        ]);
        expect(rows.map((item: any) => item.code)).toEqual(['OWN']);
    });
    it('requires an explicit operating store for platform read-only supervision', async () => {
        const service = new CatalogProfitService({ getRepository } as any);
        const platform = {
            ...ctx,
            channelId: 9,
            channel: { code: '__default_channel__' },
            copy: ({ channel: target }: any) => ({ ...ctx, channelId: target.id, channel: target }),
        };
        await expect(service.orderExpenseApplicability(platform, '2')).rejects.toThrow('先选择');
        await expect(service.orderExpenseApplicability(platform, '2', 9)).rejects.toThrow('默认频道');
        await expect(service.orderExpenseApplicability(platform, '2', 2)).resolves.toMatchObject({
            carrierShippingCostApplicable: true,
        });
        await expect(service.orderExpenseApplicability(ctx, '2', 2)).rejects.toThrow('只能查看本店');
        await expect(
            service.orderExpenseApplicability({ ...platform, userHasPermissions: () => false }, '2', 2),
        ).rejects.toThrow();
    });
    it('refuses foreign attribution even if a legacy wrong-channel snapshot exists', async () => {
        const attribution = {
            findOneBy: vi.fn(() => Promise.resolve({ id: 'legacy-wrong', channelId: 1, orderId: 2 })),
            create: vi.fn(),
            save: vi.fn(),
        };
        const service = new MarketingAttributionService(
            {
                getRepository: (context: any, entity: any) =>
                    entity === StorefrontOrderAttribution ? attribution : getRepository(context, entity),
            } as any,
            {} as any,
            { signingSecret: 'fixture-only-signing-secret' } as any,
        );
        expect(await service.captureOrderAttribution(ctx, 2)).toBeNull();
        expect(attribution.findOneBy).not.toHaveBeenCalled();
        expect(attribution.save).not.toHaveBeenCalled();
        await expect(service.captureOrderAttribution(ctx, 1)).resolves.toMatchObject({ id: 'legacy-wrong' });
    });
});
