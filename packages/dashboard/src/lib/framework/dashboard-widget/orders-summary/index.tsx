import { AnimatedCurrency, AnimatedNumber } from '@/vdb/components/shared/animated-number.js';
import { api } from '@/vdb/graphql/api.js';
import { useWidgetFilters } from '@/vdb/hooks/use-widget-filters.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { differenceInDays, subDays } from 'date-fns';
import { useMemo } from 'react';
import { DashboardBaseWidget } from '../base-widget.js';
import { orderSummaryQuery } from './order-summary-widget.graphql.js';
import { metricSummaryTotal } from './order-summary.js';

const WIDGET_ID = 'orders-summary-widget';

interface PercentageChangeProps {
    value: number;
}

function PercentageChange({ value }: PercentageChangeProps) {
    const isZero = value === 0;
    const isPositive = value > 0;
    const colorClass = isZero ? 'text-muted-foreground' : isPositive ? 'text-success-text' : 'text-destructive';
    const arrow = isZero ? null : isPositive ? '↑' : '↓';

    return (
        <p className={`text-sm ${colorClass}`}>
            {arrow} <AnimatedNumber value={Math.abs(value)} />%
        </p>
    );
}

export function OrdersSummaryWidget() {
    const { t } = useLingui();
    const { dateRange } = useWidgetFilters();

    const variables = useMemo(() => {
        const rangeLength = differenceInDays(dateRange.to, dateRange.from) + 1;
        // For the previous period, we go back by the same range length
        const previousStart = subDays(dateRange.from, rangeLength);
        const previousEnd = subDays(dateRange.to, rangeLength);

        return {
            start: dateRange.from.toISOString(),
            end: dateRange.to.toISOString(),
            previousStart: previousStart.toISOString(),
            previousEnd: previousEnd.toISOString(),
        };
    }, [dateRange]);

    const { data } = useQuery({
        queryKey: ['orders-summary', dateRange],
        queryFn: () =>
            api.query(orderSummaryQuery, {
                start: variables.start,
                end: variables.end,
            }),
    });

    const { data: previousData } = useQuery({
        queryKey: ['orders-summary', 'previous', dateRange],
        queryFn: () =>
            api.query(orderSummaryQuery, {
                start: variables.previousStart,
                end: variables.previousEnd,
            }),
    });

    const calculatePercentChange = (current: number, previous: number) => {
        if (previous === 0) return 0;
        return ((current - previous) / previous) * 100;
    };

    const currentTotalOrders = metricSummaryTotal(data?.dashboardMetricSummary, 'OrderCount');
    const previousTotalOrders = metricSummaryTotal(previousData?.dashboardMetricSummary, 'OrderCount');
    const currentRevenue = metricSummaryTotal(data?.dashboardMetricSummary, 'OrderTotal');
    const previousRevenue = metricSummaryTotal(previousData?.dashboardMetricSummary, 'OrderTotal');

    const orderChange = calculatePercentChange(currentTotalOrders, previousTotalOrders);
    const revenueChange = calculatePercentChange(currentRevenue, previousRevenue);

    return (
        <DashboardBaseWidget
            id={WIDGET_ID}
            title={t`Period overview`}
            description={t`Compared with the previous period of the same length`}
        >
            <div className="@container h-full">
                <div className="flex flex-col h-full @md:flex-row gap-8 items-center justify-center @md:justify-evenly text-center tabular-nums">
                    <div className="flex flex-col lg:gap-2">
                        <p className="lg:text-lg text-muted-foreground">
                            <Trans>Orders placed</Trans>
                        </p>
                        <p className="text-xl @md:text-3xl font-semibold">
                            <AnimatedNumber
                                animationConfig={{ mass: 0.01, stiffness: 90, damping: 3 }}
                                value={currentTotalOrders}
                            />
                        </p>
                        <PercentageChange value={orderChange} />
                    </div>
                    <div className="flex flex-col lg:gap-2">
                        <p className="lg:text-lg text-muted-foreground">
                            <Trans>Order revenue</Trans>
                        </p>
                        <p className="text-xl @md:text-3xl font-semibold">
                            <AnimatedCurrency
                                animationConfig={{ mass: 0.01, stiffness: 90, damping: 3 }}
                                value={currentRevenue}
                            />
                        </p>
                        <PercentageChange value={revenueChange} />
                    </div>
                </div>
            </div>
        </DashboardBaseWidget>
    );
}
