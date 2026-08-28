import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import {
    api,
    Badge,
    Button,
    ChannelCodeLabel,
    DashboardBaseWidget,
    Link,
    Skeleton,
    useChannel,
    useLocalFormat,
    useQuery,
    useWidgetFilters,
} from '@vendure/dashboard';
import { RefreshCw, Store } from 'lucide-react';

import { normalizeStoreMetrics, StoreMetrics } from './store-overview-metrics';
import { storeOverviewQuery } from './store-overview-widget.graphql';

const messages = {
    title: msg({ id: 'operations.stores.title', message: 'All-store performance' }),
    description: msg({
        id: 'operations.stores.description',
        message: 'Compare each store for the selected period',
    }),
    manageStores: msg({ id: 'operations.stores.manage', message: 'Manage stores' }),
    orders: msg({ id: 'operations.stores.orders', message: 'Orders' }),
    sales: msg({ id: 'operations.stores.sales', message: 'Sales' }),
    current: msg({ id: 'operations.stores.current', message: 'Current store' }),
    total: msg({ id: 'operations.stores.total', message: 'Total' }),
    stores: msg({ id: 'operations.stores.storeCount', message: 'stores' }),
    loadError: msg({ id: 'operations.stores.loadError', message: 'Could not load store data' }),
    unavailable: msg({ id: 'operations.stores.unavailable', message: 'Data unavailable' }),
    retry: msg({ id: 'operations.stores.retry', message: 'Retry' }),
};

const metricGridClassName = [
    'grid grid-cols-[minmax(0,1fr)_3.5rem_6rem] gap-2',
    'sm:grid-cols-[minmax(0,1fr)_6rem_8rem] sm:gap-4',
].join(' ');

export function StoreOverviewWidget() {
    const { t } = useLingui();
    const { channels, activeChannel } = useChannel();
    const { formatCurrency, formatNumber } = useLocalFormat();
    const { dateRange } = useWidgetFilters();

    const { data, isError, isPending, isRefetching, refetch } = useQuery({
        queryKey: [
            'all-store-performance',
            dateRange.from.toISOString(),
            dateRange.to.toISOString(),
            channels.map(channel => `${channel.id}:${channel.token}`).join('|'),
        ],
        queryFn: async (): Promise<StoreMetrics[]> =>
            Promise.all(
                channels.map(async channel => {
                    try {
                        const result = await api.queryForChannel(storeOverviewQuery, channel.token, {
                            startDate: dateRange.from.toISOString(),
                            endDate: dateRange.to.toISOString(),
                        });
                        const summaries = result.dashboardMetricSummary;
                        const orderCount =
                            summaries
                                .find(summary => summary.type === 'OrderCount')
                                ?.entries.reduce((total, entry) => total + entry.value, 0) ?? 0;
                        const sales =
                            summaries
                                .find(summary => summary.type === 'OrderTotal')
                                ?.entries.reduce((total, entry) => total + entry.value, 0) ?? 0;

                        return {
                            storeId: channel.id,
                            channelCode: channel.code,
                            orderCount,
                            sales,
                            error: false,
                        };
                    } catch {
                        return {
                            storeId: channel.id,
                            channelCode: channel.code,
                            orderCount: 0,
                            sales: 0,
                            error: true,
                        };
                    }
                }),
            ),
        enabled: channels.length > 0,
        refetchInterval: 60_000,
    });

    const normalizedMetrics = normalizeStoreMetrics(data ?? []);

    return (
        <DashboardBaseWidget
            id="store-overview-widget"
            title={t(messages.title)}
            description={t(messages.description)}
            actions={
                <div className="flex items-center gap-1">
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t(messages.retry)}
                        title={t(messages.retry)}
                        onClick={() => void refetch()}
                    >
                        <RefreshCw className={isRefetching ? 'animate-rotate' : ''} />
                    </Button>
                    <Button variant="outline" size="sm" render={<Link to="/channels" />}>
                        {t(messages.manageStores)}
                    </Button>
                </div>
            }
        >
            {isPending ? (
                <div className="space-y-3 py-1">
                    {[0, 1].map(row => (
                        <div key={row} className={`${metricGridClassName} items-center`}>
                            <Skeleton className="h-8 w-40" />
                            <Skeleton className="h-7 w-12 justify-self-end" />
                            <Skeleton className="h-7 w-24 justify-self-end" />
                        </div>
                    ))}
                </div>
            ) : isError ? (
                <div className="flex min-h-24 items-center justify-between gap-4">
                    <p className="text-sm text-muted-foreground">{t(messages.loadError)}</p>
                    <Button variant="outline" size="sm" onClick={() => void refetch()}>
                        {t(messages.retry)}
                    </Button>
                </div>
            ) : (
                <div className="min-w-0">
                    <div
                        className={`${metricGridClassName} mb-2 border-b pb-2 text-xs text-muted-foreground`}
                    >
                        <span className="col-span-3 sm:col-span-1">
                            {channels.length} {t(messages.stores)} · {t(messages.total)}{' '}
                            {formatNumber(normalizedMetrics.totalOrders)} {t(messages.orders).toLowerCase()}
                        </span>
                        <span className="col-start-2 text-right sm:col-start-auto">{t(messages.orders)}</span>
                        <span className="text-right">{t(messages.sales)}</span>
                    </div>
                    <div className="max-h-52 overflow-y-auto">
                        {channels.map(channel => {
                            const metrics = normalizedMetrics.metrics.find(
                                item => item.storeId === channel.id,
                            );
                            const isCurrent = channel.id === activeChannel?.id;
                            return (
                                <div
                                    key={channel.id}
                                    className={`${metricGridClassName} min-h-12 items-center border-b last:border-0`}
                                >
                                    <div className="flex min-w-0 items-center gap-2.5">
                                        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                                            <Store className="size-4" aria-hidden="true" />
                                        </div>
                                        <div className="min-w-0">
                                            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                                                <span className="truncate text-sm font-medium">
                                                    <ChannelCodeLabel code={channel.code} />
                                                </span>
                                                {isCurrent && (
                                                    <Badge variant="secondary">{t(messages.current)}</Badge>
                                                )}
                                            </div>
                                            <span className="text-xs text-muted-foreground">
                                                {channel.defaultCurrencyCode}
                                            </span>
                                        </div>
                                    </div>
                                    {metrics?.error ? (
                                        <span className="col-span-2 text-right text-xs text-destructive">
                                            {t(messages.unavailable)}
                                        </span>
                                    ) : (
                                        <>
                                            <span className="text-right font-medium tabular-nums">
                                                {formatNumber(metrics?.orderCount ?? 0)}
                                            </span>
                                            <span className="text-right font-medium tabular-nums">
                                                {formatCurrency(
                                                    metrics?.sales ?? 0,
                                                    channel.defaultCurrencyCode,
                                                )}
                                            </span>
                                        </>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </DashboardBaseWidget>
    );
}
