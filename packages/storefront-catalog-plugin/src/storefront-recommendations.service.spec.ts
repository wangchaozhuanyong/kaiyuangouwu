import 'reflect-metadata';

import { Channel, Order, OrderLine, Payment, ProductVariant, Refund, RefundLine } from '@vendure/core';
import { DataSource, EntitySchema } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    rankDailyRecommendations,
    recommendationDay,
    StorefrontRecommendationsService,
} from './storefront-recommendations.service';

const idColumn = { type: Number, primary: true };
const schemas = [
    new EntitySchema<Channel>({ name: 'Channel', target: Channel, columns: { id: idColumn } }),
    new EntitySchema<Order>({
        name: 'Order',
        target: Order,
        columns: { id: idColumn, state: { type: String }, orderPlacedAt: { type: Date, nullable: true } },
        relations: {
            channels: { type: 'many-to-many', target: 'Channel', joinTable: true },
        },
    }),
    new EntitySchema<ProductVariant>({
        name: 'ProductVariant',
        target: ProductVariant,
        columns: { id: idColumn, productId: { type: Number } },
    }),
    new EntitySchema<OrderLine>({
        name: 'OrderLine',
        target: OrderLine,
        columns: { id: idColumn, quantity: { type: Number }, orderPlacedQuantity: { type: Number } },
        relations: {
            order: { type: 'many-to-one', target: 'Order', joinColumn: true },
            productVariant: { type: 'many-to-one', target: 'ProductVariant', joinColumn: true },
        },
    }),
    new EntitySchema<Payment>({
        name: 'Payment',
        target: Payment,
        columns: { id: idColumn, amount: { type: Number }, state: { type: String } },
        relations: {
            order: { type: 'many-to-one', target: 'Order', joinColumn: true },
        },
    }),
    new EntitySchema<Refund>({
        name: 'Refund',
        target: Refund,
        columns: {
            id: idColumn,
            total: { type: Number },
            state: { type: String },
            paymentId: { type: Number },
        },
    }),
    new EntitySchema<RefundLine>({
        name: 'RefundLine',
        target: RefundLine,
        columns: { id: idColumn, quantity: { type: Number }, orderLineId: { type: Number } },
        relations: {
            refund: { type: 'many-to-one', target: 'Refund', joinColumn: true },
        },
    }),
];

describe('shared daily recommendations', () => {
    let db: DataSource;
    let service: StorefrontRecommendationsService;
    let eligible: string[];
    const now = new Date('2026-10-02T06:00:00Z');
    const ctx = { channelId: 1 } as any;
    let sequence: number;
    beforeEach(async () => {
        sequence = 0;
        db = await new DataSource({ type: 'sqljs', entities: schemas, synchronize: true }).initialize();
        await db.getRepository(Channel).save([{ id: 1 }, { id: 2 }]);
        eligible = Array.from({ length: 25 }, (_, i) => String(i + 1));
        service = new StorefrontRecommendationsService(
            { getRepository: (_ctx: unknown, entity: any) => db.getRepository(entity) } as any,
            { recommendationProductIds: vi.fn(() => Promise.resolve(eligible)) } as any,
            {
                findByIds: vi.fn((_ctx: unknown, ids: string[]) =>
                    Promise.resolve(ids.map(id => ({ id, enabled: true, deletedAt: null }))),
                ),
            } as any,
        );
    });
    afterEach(async () => {
        if (db?.isInitialized) await db.destroy();
    });

    async function sale(
        productId: number,
        quantity: number,
        options: {
            channel?: number;
            placedAt?: string;
            state?: Order['state'];
            paid?: boolean;
            placedQuantity?: number;
            refundQuantity?: number;
            refundState?: Refund['state'];
            fullRefund?: boolean;
            splitPayment?: boolean;
        } = {},
    ) {
        const key = ++sequence;
        await db.getRepository(ProductVariant).save({ id: key, productId });
        await db.getRepository(Order).save({
            id: key,
            state: options.state ?? 'PaymentSettled',
            orderPlacedAt: new Date(options.placedAt ?? '2026-10-02T01:00:00Z'),
            channels: [{ id: options.channel ?? 1 }],
        });
        await db.getRepository(OrderLine).save({
            id: key,
            quantity,
            orderPlacedQuantity: options.placedQuantity ?? quantity,
            order: { id: key },
            productVariant: { id: key },
        });
        if (options.paid !== false)
            await db
                .getRepository(Payment)
                .save({ id: key, amount: 1000, state: 'Settled', order: { id: key } });
        if (options.splitPayment)
            await db
                .getRepository(Payment)
                .save({ id: key + 1000, amount: 500, state: 'Settled', order: { id: key } });
        if (options.refundQuantity || options.fullRefund) {
            await db.getRepository(Refund).save({
                id: key,
                total: options.fullRefund ? 1000 : 100,
                state: options.refundState ?? 'Settled',
                paymentId: key,
            });
            if (options.refundQuantity)
                await db.getRepository(RefundLine).save({
                    id: key,
                    quantity: options.refundQuantity,
                    orderLineId: key,
                    refund: { id: key },
                });
        }
    }

    it('uses UTC+8 business midnight independent of the browser and server locale', () => {
        expect(recommendationDay(new Date('2026-10-01T16:00:00Z'))).toEqual({
            businessDate: '2026-10-02',
            start: new Date('2026-10-01T16:00:00Z'),
            expiresAt: new Date('2026-10-02T16:00:00Z'),
        });
        expect(recommendationDay(new Date('2026-10-01T15:59:59Z')).businessDate).toBe('2026-10-01');
    });

    it('ranks paid sales, combines variants and does not multiply split payments', async () => {
        await sale(1, 2, { splitPayment: true });
        await sale(2, 3);
        await sale(3, 2);
        await sale(3, 2);
        const result = await service.find(ctx, now);
        expect(result.items.slice(0, 3).map(p => String(p.id))).toEqual(['3', '2', '1']);
        expect(result.items).toHaveLength(10);
    });

    it('excludes other stores, unpaid/cancelled orders, past/future days and completed refunds', async () => {
        await sale(1, 2);
        await sale(2, 99, { channel: 2 });
        await sale(3, 99, { paid: false });
        await sale(4, 99, { state: 'Cancelled' });
        await sale(5, 99, { placedAt: '2026-10-01T15:59:59Z' });
        await sale(6, 99, { placedAt: '2026-10-02T07:00:00Z' });
        await sale(7, 99, { fullRefund: true });
        await sale(8, 99, { refundQuantity: 99 });
        const result = await service.find(ctx, now);
        expect(String(result.items[0].id)).toBe('1');
        expect(result.items.slice(1).map(p => String(p.id))).toEqual(
            rankDailyRecommendations(
                eligible.filter(id => id !== '1'),
                new Map(),
                '1:2026-10-02',
            ).slice(0, 9),
        );
    });

    it('deducts settled refunds once when cancellation already reduced the same line', async () => {
        await sale(1, 4, { placedQuantity: 6, refundQuantity: 2 });
        await sale(2, 3);
        await sale(3, 6, { refundQuantity: 3 });
        await sale(4, 5, { refundQuantity: 5, refundState: 'Pending' });
        expect((await service.find(ctx, now)).items.slice(0, 2).map(p => String(p.id))).toEqual(['4', '1']);
    });

    it('randomizes across the whole eligible catalog, remains stable per day/store and handles short catalogs', async () => {
        const first = await service.find(ctx, now);
        expect(await service.find(ctx, now)).toEqual(first);
        expect((await service.find({ channelId: 2 } as any, now)).items).not.toEqual(first.items);
        expect((await service.find(ctx, new Date('2026-10-03T06:00:00Z'))).items).not.toEqual(first.items);
        expect(first.items.some(p => Number(p.id) > 12)).toBe(true);
        eligible = ['3', '9'];
        expect((await service.find(ctx, now)).items).toHaveLength(2);
        eligible = [];
        expect((await service.find(ctx, now)).items).toEqual([]);
    });

    it('filters stale deleted/disabled products before applying the ten-product display limit', async () => {
        eligible = Array.from({ length: 110 }, (_, index) => String(index + 1));
        const ranked = rankDailyRecommendations(eligible, new Map(), '1:2026-10-02', eligible.length);
        const unavailable = new Set(ranked.slice(0, 100));
        const products = (service as any).products.findByIds;
        products.mockImplementation((_ctx: unknown, ids: string[]) =>
            Promise.resolve(
                ids.map(id => ({
                    id,
                    enabled: id !== ranked[99],
                    deletedAt: unavailable.has(id) && id !== ranked[99] ? new Date() : null,
                })),
            ),
        );
        const result = await service.find(ctx, now);
        expect(result.items.map(product => String(product.id))).toEqual(ranked.slice(100));
        expect(products.mock.calls.map((call: any[]) => call[1].length)).toEqual([100, 10]);
        expect(result.items).toHaveLength(10);
    });

    it('does not treat hydration read failure as confirmed product deletion', async () => {
        const products = (service as any).products.findByIds;
        products.mockRejectedValue(new Error('synthetic hydration read failed'));
        await expect(service.find(ctx, now)).rejects.toThrow('synthetic hydration read failed');
        expect(eligible).toHaveLength(25);
    });
});
