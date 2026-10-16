import { Order } from '@vendure/core';
import { DataSource, EntitySchema } from 'typeorm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AverageOrderValueMetric, OrderCountMetric, OrderTotalMetric } from './config/metrics-strategies';
import {
    buildMetricDataByDay,
    metricDateKey,
    MetricsService,
    orderCountsTowardsSales,
    orderNetSales,
} from './service/metrics.service';
import { DashboardMetricType } from './types';

describe('dashboard sales metrics', () => {
    afterEach(() => vi.unstubAllEnvs());
    it('uses settled payments minus settled refunds as net sales', () => {
        const order = {
            payments: [
                {
                    state: 'Settled',
                    amount: 1248,
                    refunds: [
                        { state: 'Settled', total: 1125 },
                        { state: 'Pending', total: 50 },
                    ],
                },
                { state: 'Created', amount: 9999, refunds: [] },
            ],
        } as any;

        expect(orderNetSales(order)).toBe(123);
        expect(orderCountsTowardsSales({ state: 'Cancelled', payments: [] } as any)).toBe(false);
        expect(
            orderCountsTowardsSales({
                state: 'PaymentAuthorized',
                payments: [{ state: 'Authorized' }],
            } as any),
        ).toBe(false);
        expect(orderCountsTowardsSales({ state: 'Delivered', payments: [{ state: 'Settled' }] } as any)).toBe(
            true,
        );
    });

    it('keeps order count, total and average on the same business basis', () => {
        const data = {
            date: new Date('2026-08-20T00:00:00.000Z'),
            dateKey: '2026-08-20',
            orders: [{}, {}],
            countedOrders: [{}],
            netSales: 7080,
        } as any;

        expect(new OrderCountMetric().calculateEntry({} as any, data).value).toBe(1);
        expect(new OrderTotalMetric().calculateEntry({} as any, data).value).toBe(7080);
        expect(new AverageOrderValueMetric().calculateEntry({} as any, data).value).toBe(7080);
    });

    it('excludes controlled test settlement from revenue and order count', () => {
        const testPayment = {
            state: 'Settled',
            method: 'controlled-test-payment-2',
            amount: 600,
            refunds: [],
        };
        const orderPlacedAt = new Date(2026, 8, 28, 10, 0, 0);
        const simulated = { state: 'Delivered', orderPlacedAt, payments: [testPayment] } as any;
        const mixed = {
            state: 'Delivered',
            orderPlacedAt,
            payments: [testPayment, { state: 'Settled', method: 'real-method', amount: 1200, refunds: [] }],
        } as any;

        expect(orderNetSales(simulated)).toBe(0);
        expect(orderCountsTowardsSales(simulated)).toBe(false);
        expect(orderNetSales(mixed)).toBe(1200);
        expect(orderCountsTowardsSales(mixed)).toBe(true);
        const day = buildMetricDataByDay([simulated, mixed], orderPlacedAt, orderPlacedAt).get(
            metricDateKey(orderPlacedAt),
        );
        expect(new OrderCountMetric().calculateEntry({} as any, day as any).value).toBe(1);
        expect(new OrderTotalMetric().calculateEntry({} as any, day as any).value).toBe(1200);
        expect(new AverageOrderValueMetric().calculateEntry({} as any, day as any).value).toBe(1200);
    });

    it('uses the configured business timezone for daily buckets', () => {
        const instant = new Date('2026-08-19T16:30:00.000Z');

        expect(metricDateKey(instant, 'Asia/Shanghai')).toBe('2026-08-20');
        expect(metricDateKey(instant, 'America/Los_Angeles')).toBe('2026-08-19');
    });

    it('creates exactly one bucket per calendar day and excludes authorized-only orders', () => {
        const start = new Date('2026-08-19T16:00:00.000Z');
        const end = new Date('2026-08-21T15:59:59.999Z');
        const settled = {
            state: 'PaymentSettled',
            orderPlacedAt: new Date('2026-08-20T04:00:00.000Z'),
            payments: [{ state: 'Settled', amount: 33787, refunds: [] }],
        } as any;
        const authorized = {
            state: 'PaymentAuthorized',
            orderPlacedAt: new Date('2026-08-20T05:00:00.000Z'),
            payments: [{ state: 'Authorized', amount: 33787, refunds: [] }],
        } as any;

        const data = buildMetricDataByDay([settled, authorized], start, end);
        const firstDay = data.get(metricDateKey(start));

        expect(data).toHaveLength(2);
        expect(firstDay?.orders).toHaveLength(2);
        expect(firstDay?.countedOrders).toEqual([settled]);
        expect(firstDay?.netSales).toBe(33787);
    });

    it.each(['UTC', 'Asia/Shanghai', 'America/Los_Angeles'])(
        'keeps daily buckets on the Beijing calendar in server timezone %s',
        timeZone => {
            vi.stubEnv('TZ', timeZone);
            const start = new Date('2027-12-31T16:00:00.000Z');
            const end = new Date('2028-01-01T16:30:00.000Z');
            const data = buildMetricDataByDay([], start, end);
            expect([...data.keys()]).toEqual(['2028-01-01', '2028-01-02']);
            expect(metricDateKey(new Date('2028-02-29T16:00:00.000Z'))).toBe('2028-03-01');
        },
    );

    it('excludes cancelled and draft orders from both sales and count, while retaining fully refunded valid orders', () => {
        const start = new Date('2026-10-15T16:00:00.000Z');
        const end = new Date('2026-10-16T02:00:00.000Z');
        const payment = { state: 'Settled', method: 'real-method', amount: 1000, refunds: [] };
        const orders = [
            { state: 'Cancelled', orderPlacedAt: start, payments: [payment] },
            { state: 'Draft', orderPlacedAt: start, payments: [payment] },
            {
                state: 'Delivered',
                orderPlacedAt: start,
                payments: [{ ...payment, refunds: [{ state: 'Settled', total: 1000 }] }],
            },
        ] as any;
        const data = buildMetricDataByDay(orders, start, end).get('2026-10-16');
        expect(data?.orders).toHaveLength(3);
        expect(data?.countedOrders).toHaveLength(1);
        expect(data?.netSales).toBe(0);
    });
});

const channelSchema = new EntitySchema({
    name: 'MetricChannelFixture',
    columns: { id: { type: Number, primary: true } },
});
const orderSchema = new EntitySchema<{
    id: number;
    state: string;
    currencyCode: string;
    orderPlacedAt: Date;
    salesChannelId: number | null;
    channels: unknown[];
    payments: unknown[];
}>({
    name: 'MetricOrderFixture',
    columns: {
        id: { type: Number, primary: true },
        state: { type: String },
        currencyCode: { type: String },
        orderPlacedAt: { type: Date },
        salesChannelId: { type: Number, nullable: true },
    },
    relations: {
        channels: { type: 'many-to-many', target: 'MetricChannelFixture', joinTable: true },
        payments: { type: 'one-to-many', target: 'MetricPaymentFixture', inverseSide: 'order' },
    },
});
const paymentSchema = new EntitySchema<{
    id: number;
    state: string;
    method: string;
    amount: number;
    order: unknown;
    refunds: unknown[];
}>({
    name: 'MetricPaymentFixture',
    columns: {
        id: { type: Number, primary: true },
        state: { type: String },
        method: { type: String },
        amount: { type: Number },
    },
    relations: {
        order: { type: 'many-to-one', target: 'MetricOrderFixture', inverseSide: 'payments' },
        refunds: { type: 'one-to-many', target: 'MetricRefundFixture', inverseSide: 'payment' },
    },
});
const refundSchema = new EntitySchema<{
    id: number;
    state: string;
    total: number;
    payment: unknown;
}>({
    name: 'MetricRefundFixture',
    columns: {
        id: { type: Number, primary: true },
        state: { type: String },
        total: { type: Number },
    },
    relations: {
        payment: { type: 'many-to-one', target: 'MetricPaymentFixture', inverseSide: 'refunds' },
    },
});

describe('dashboard metrics with a real SQLJS repository', () => {
    const database = new DataSource({
        type: 'sqljs',
        entities: [channelSchema, orderSchema, paymentSchema, refundSchema],
        synchronize: true,
    });
    const ctx = {
        channelId: 1,
        channel: { defaultCurrencyCode: 'CNY' },
    } as any;
    const cacheEntries = new Map<string, unknown>();
    const cache = {
        get: vi.fn((key: string) => Promise.resolve(cacheEntries.get(key))),
        set: vi.fn((key: string, value: unknown) => Promise.resolve(cacheEntries.set(key, value))),
    };
    const connection = {
        getRepository: (_ctx: unknown, entity: unknown) => {
            if (entity !== Order) throw new Error('Unexpected metric entity');
            return database.getRepository(orderSchema);
        },
    };
    const service = new MetricsService(connection as any, cache as any);
    const input = {
        types: [DashboardMetricType.OrderCount, DashboardMetricType.OrderTotal],
        startDate: '2026-10-15T16:00:00.000Z',
        endDate: '2026-10-16T02:00:00.000Z',
        refresh: true,
    };
    beforeAll(async () => {
        await database.initialize();
        await database.getRepository(channelSchema).save([{ id: 1 }, { id: 2 }, { id: 3 }]);
        await database.getRepository(orderSchema).save(
            [
                { id: 1, currencyCode: 'CNY', orderPlacedAt: new Date(input.startDate), salesChannelId: 1 },
                { id: 2, currencyCode: 'CNY', orderPlacedAt: new Date(input.endDate), salesChannelId: 1 },
                { id: 3, currencyCode: 'MYR', orderPlacedAt: new Date(input.startDate), salesChannelId: 1 },
                { id: 4, currencyCode: 'CNY', orderPlacedAt: new Date(input.startDate), salesChannelId: 2 },
                {
                    id: 5,
                    currencyCode: 'CNY',
                    orderPlacedAt: new Date(Date.parse(input.startDate) - 1),
                    salesChannelId: 1,
                },
                {
                    id: 6,
                    currencyCode: 'CNY',
                    orderPlacedAt: new Date(Date.parse(input.endDate) + 1),
                    salesChannelId: 1,
                },
                {
                    id: 7,
                    currencyCode: 'CNY',
                    orderPlacedAt: new Date(input.startDate),
                    salesChannelId: null,
                },
            ].map(order => ({
                ...order,
                state: 'PaymentSettled',
                channels: order.id === 4 ? [{ id: 1 }, { id: 2 }] : [{ id: order.salesChannelId ?? 1 }],
            })),
        );
        await database.getRepository(paymentSchema).save(
            [
                { id: 1, amount: 1000, order: { id: 1 } },
                { id: 2, amount: 2000, order: { id: 2 } },
                { id: 3, amount: 3000, order: { id: 3 } },
                { id: 4, amount: 4000, order: { id: 4 } },
                { id: 5, amount: 5000, order: { id: 5 } },
                { id: 6, amount: 6000, order: { id: 6 } },
                { id: 7, amount: 7000, order: { id: 7 } },
            ].map(payment => ({ ...payment, state: 'Settled', method: 'real-method' })),
        );
        await database.getRepository(refundSchema).save({
            id: 1,
            state: 'Settled',
            total: 100,
            payment: { id: 1 },
        });
    });
    afterAll(async () => {
        if (database.isInitialized) await database.destroy();
    });
    afterEach(() => {
        vi.unstubAllEnvs();
        cacheEntries.clear();
        cache.get.mockClear();
        cache.set.mockClear();
    });

    it.each(['UTC', 'Asia/Shanghai', 'America/Los_Angeles'])(
        'honours exact DateTime endpoints, currency and store in server timezone %s',
        async timeZone => {
            vi.stubEnv('TZ', timeZone);
            const data = await service.getMetrics(ctx, input);
            expect(data.find(metric => metric.type === DashboardMetricType.OrderCount)?.entries).toEqual([
                { label: '2026-10-16', value: 2 },
            ]);
            expect(data.find(metric => metric.type === DashboardMetricType.OrderTotal)?.entries).toEqual([
                { label: '2026-10-16', value: 2900 },
            ]);
        },
    );

    it('separates cached metrics by the store reporting currency', async () => {
        const cachedInput = { ...input, refresh: false };
        const cny = await service.getMetrics(ctx, cachedInput);
        const myrCtx = { ...ctx, channel: { defaultCurrencyCode: 'MYR' } };
        const myr = await service.getMetrics(myrCtx, cachedInput);
        expect(cny.find(metric => metric.type === DashboardMetricType.OrderTotal)?.entries[0].value).toBe(
            2900,
        );
        expect(myr.find(metric => metric.type === DashboardMetricType.OrderTotal)?.entries[0].value).toBe(
            3000,
        );
        expect(cache.set).toHaveBeenCalledTimes(2);
        expect(cache.set.mock.calls[0][0]).not.toBe(cache.set.mock.calls[1][0]);
        await service.getMetrics(ctx, cachedInput);
        expect(cache.set).toHaveBeenCalledTimes(2);
    });

    it('keeps the same-currency cache isolated between sales owners with shared channel membership', async () => {
        const cachedInput = { ...input, refresh: false };
        await service.getMetrics(ctx, cachedInput);
        const foreignCtx = { ...ctx, channelId: 2 };
        const data = await service.getMetrics(foreignCtx, cachedInput);
        expect(data.find(metric => metric.type === DashboardMetricType.OrderCount)?.entries[0].value).toBe(1);
        expect(data.find(metric => metric.type === DashboardMetricType.OrderTotal)?.entries[0].value).toBe(
            4000,
        );
        expect(cache.set.mock.calls[0][0]).not.toBe(cache.set.mock.calls[1][0]);
    });

    it('counts all orders across the native 1000-order page boundary', async () => {
        const rows = Array.from({ length: 1001 }, (_, index) => ({
            id: 10000 + index,
            state: 'PaymentSettled',
            currencyCode: 'CNY',
            orderPlacedAt: new Date(input.startDate),
            salesChannelId: 3,
        }));
        await database.getRepository(orderSchema).insert(rows);
        await database.getRepository(paymentSchema).insert(
            rows.map(row => ({
                id: row.id,
                state: 'Settled',
                method: 'real-method',
                amount: 100,
                order: { id: row.id },
            })),
        );
        const data = await service.getMetrics({ ...ctx, channelId: 3 }, input);
        expect(data.find(metric => metric.type === DashboardMetricType.OrderCount)?.entries[0].value).toBe(
            1001,
        );
        expect(data.find(metric => metric.type === DashboardMetricType.OrderTotal)?.entries[0].value).toBe(
            100100,
        );
    });

    it.each([
        { startDate: 'invalid', endDate: input.endDate },
        { startDate: input.startDate, endDate: 'invalid' },
        { startDate: input.endDate, endDate: input.startDate },
    ])('rejects malformed or reversed ranges before cache or database reads: %j', async range => {
        await expect(service.getMetrics(ctx, { ...input, ...range })).rejects.toThrow('统计');
        expect(cache.get).not.toHaveBeenCalled();
        expect(cache.set).not.toHaveBeenCalled();
    });
});
