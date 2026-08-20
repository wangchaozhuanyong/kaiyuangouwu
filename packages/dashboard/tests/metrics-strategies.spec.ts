import { describe, expect, it } from 'vitest';

import {
    AverageOrderValueMetric,
    OrderCountMetric,
    OrderTotalMetric,
} from '../plugin/config/metrics-strategies';
import {
    buildMetricDataByDay,
    metricDateKey,
    orderCountsTowardsSales,
    orderNetSales,
} from '../plugin/service/metrics.service';

describe('dashboard sales metrics', () => {
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

    it('uses the configured business timezone for daily buckets', () => {
        const instant = new Date('2026-08-19T16:30:00.000Z');

        expect(metricDateKey(instant, 'Asia/Shanghai')).toBe('2026-08-20');
        expect(metricDateKey(instant, 'America/Los_Angeles')).toBe('2026-08-19');
    });

    it('creates exactly one bucket per calendar day and excludes authorized-only orders', () => {
        const start = new Date(2026, 7, 20, 0, 0, 0);
        const end = new Date(2026, 7, 21, 23, 59, 59);
        const settled = {
            state: 'PaymentSettled',
            orderPlacedAt: new Date(2026, 7, 20, 12, 0, 0),
            payments: [{ state: 'Settled', amount: 33787, refunds: [] }],
        } as any;
        const authorized = {
            state: 'PaymentAuthorized',
            orderPlacedAt: new Date(2026, 7, 20, 13, 0, 0),
            payments: [{ state: 'Authorized', amount: 33787, refunds: [] }],
        } as any;

        const data = buildMetricDataByDay([settled, authorized], start, end);
        const firstDay = data.get(metricDateKey(start));

        expect(data).toHaveLength(2);
        expect(firstDay?.orders).toHaveLength(2);
        expect(firstDay?.countedOrders).toEqual([settled]);
        expect(firstDay?.netSales).toBe(33787);
    });
});
