export const DEFAULT_CHANNEL_CODE = '__default_channel__';

export interface StoreMetrics {
    storeId: string;
    channelCode: string;
    orderCount: number;
    sales: number;
    error: boolean;
}

export interface NormalizedStoreMetrics {
    metrics: StoreMetrics[];
    totalOrders: number;
}

/**
 * Vendure assigns every Order to both the active Channel and the default
 * Channel. The default Channel therefore represents the unique platform-wide
 * total, not an independent store total. Subtract the named stores from that
 * aggregate to show only Orders placed directly in the default Channel, while
 * retaining the aggregate count as the all-store total.
 */
export function normalizeStoreMetrics(metrics: StoreMetrics[]): NormalizedStoreMetrics {
    const defaultMetrics = metrics.find(item => item.channelCode === DEFAULT_CHANNEL_CODE);
    if (!defaultMetrics || defaultMetrics.error) {
        return {
            metrics,
            totalOrders: metrics
                .filter(item => !item.error)
                .reduce((total, item) => total + item.orderCount, 0),
        };
    }

    const namedStoreMetrics = metrics.filter(item => item.channelCode !== DEFAULT_CHANNEL_CODE);
    const hasIncompleteNamedStoreData = namedStoreMetrics.some(item => item.error);
    const namedStoreOrders = namedStoreMetrics
        .filter(item => !item.error)
        .reduce((total, item) => total + item.orderCount, 0);
    const namedStoreSales = namedStoreMetrics
        .filter(item => !item.error)
        .reduce((total, item) => total + item.sales, 0);

    return {
        metrics: metrics.map(item =>
            item.channelCode === DEFAULT_CHANNEL_CODE
                ? {
                      ...item,
                      orderCount: Math.max(0, item.orderCount - namedStoreOrders),
                      sales: Math.max(0, item.sales - namedStoreSales),
                      error: hasIncompleteNamedStoreData,
                  }
                : item,
        ),
        totalOrders: defaultMetrics.orderCount,
    };
}
