import { describe, expect, it } from 'vitest';

import { normalizeStoreMetrics, StoreMetrics } from './store-overview-metrics';

describe('normalizeStoreMetrics', () => {
    it('does not double-count named-store orders included in the default Channel aggregate', () => {
        const result = normalizeStoreMetrics([
            metric('default', '__default_channel__', 9, 117_996),
            metric('cn', 'cn-mainland', 2, 67_574),
            metric('catalog', 'catalog-store', 2, 7_874),
            metric('seller-a', 'seller-a', 1, 3_937),
            metric('seller-b', 'seller-b', 1, 3_937),
        ]);

        expect(result.totalOrders).toBe(9);
        expect(result.metrics.find(item => item.storeId === 'default')).toMatchObject({
            orderCount: 3,
            sales: 34_674,
            error: false,
        });
        expect(result.metrics.reduce((total, item) => total + item.orderCount, 0)).toBe(9);
    });

    it('falls back to summing accessible stores when the default Channel is unavailable', () => {
        const result = normalizeStoreMetrics([
            metric('cn', 'cn-mainland', 2, 67_574),
            metric('my', 'my-malaysia', 3, 80_000),
        ]);

        expect(result.totalOrders).toBe(5);
    });

    it('does not present an inaccurate direct-default value when a named store failed to load', () => {
        const failedStore = metric('my', 'my-malaysia', 0, 0);
        failedStore.error = true;
        const result = normalizeStoreMetrics([
            metric('default', '__default_channel__', 5, 90_000),
            metric('cn', 'cn-mainland', 2, 67_574),
            failedStore,
        ]);

        expect(result.totalOrders).toBe(5);
        expect(result.metrics.find(item => item.storeId === 'default')?.error).toBe(true);
    });
});

function metric(storeId: string, channelCode: string, orderCount: number, sales: number): StoreMetrics {
    return { storeId, channelCode, orderCount, sales, error: false };
}
