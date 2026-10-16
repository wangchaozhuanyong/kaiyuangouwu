import { Injectable } from '@nestjs/common';
import { isControlledTestPaymentMethod } from '@vendure/common/lib/controlled-test-payment';
import {
    CacheService,
    Logger,
    Order,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { createHash } from 'node:crypto';

import {
    AverageOrderValueMetric,
    MetricCalculation,
    OrderCountMetric,
    OrderTotalMetric,
} from '../config/metrics-strategies.js';
import { loggerCtx } from '../constants.js';
import {
    DashboardMetricSummary,
    DashboardMetricSummaryEntry,
    DashboardMetricSummaryInput,
} from '../types.js';

export type MetricData = {
    date: Date;
    dateKey: string;
    orders: Order[];
    countedOrders: Order[];
    netSales: number;
};

const metricDateFormatters = new Map<string, Intl.DateTimeFormat>();
const METRIC_TIMEZONE = 'Asia/Shanghai';
const DAY_MS = 24 * 60 * 60 * 1000;
const BUSINESS_OFFSET_MS = 8 * 60 * 60 * 1000;
const businessDay = (date: Date) => Math.floor((date.getTime() + BUSINESS_OFFSET_MS) / DAY_MS);

export function metricDateKey(date: Date, timeZone = METRIC_TIMEZONE): string {
    const cacheKey = timeZone || 'system';
    let formatter = metricDateFormatters.get(cacheKey);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat('en', {
            ...(timeZone ? { timeZone } : {}),
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        });
        metricDateFormatters.set(cacheKey, formatter);
    }
    const parts = Object.fromEntries(
        formatter
            .formatToParts(date)
            .filter(part => part.type === 'year' || part.type === 'month' || part.type === 'day')
            .map(part => [part.type, part.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
}

export function orderNetSales(order: Pick<Order, 'payments'>): number {
    return (order.payments ?? []).reduce((orderTotal, payment) => {
        if (payment.state !== 'Settled' || isControlledTestPaymentMethod(payment.method)) {
            return orderTotal;
        }
        const refunded = (payment.refunds ?? [])
            .filter(refund => refund.state === 'Settled')
            .reduce((total, refund) => total + refund.total, 0);
        return orderTotal + Math.max(0, payment.amount - refunded);
    }, 0);
}

export function orderCountsTowardsSales(order: Pick<Order, 'state' | 'payments'>): boolean {
    return (
        order.state !== 'Cancelled' &&
        order.state !== 'Draft' &&
        (order.payments ?? []).some(
            payment => payment.state === 'Settled' && !isControlledTestPaymentMethod(payment.method),
        )
    );
}

export function buildMetricDataByDay(
    orders: Order[],
    startDate: Date,
    endDate: Date,
): Map<string, MetricData> {
    const dataPerDay = new Map<string, MetricData>();
    const firstDay = businessDay(startDate);
    const dayCount = businessDay(endDate) - firstDay + 1;
    for (let index = 0; index < dayCount; index++) {
        const currentDate = new Date((firstDay + index) * DAY_MS - BUSINESS_OFFSET_MS);
        const dateKey = metricDateKey(currentDate);
        dataPerDay.set(dateKey, {
            orders: [],
            countedOrders: [],
            netSales: 0,
            date: currentDate,
            dateKey,
        });
    }

    for (const order of orders) {
        if (!order.orderPlacedAt) continue;
        const entry = dataPerDay.get(metricDateKey(new Date(order.orderPlacedAt)));
        if (!entry) continue;
        entry.orders.push(order);
        if (orderCountsTowardsSales(order)) {
            entry.countedOrders.push(order);
            entry.netSales += orderNetSales(order);
        }
    }
    return dataPerDay;
}

@Injectable()
export class MetricsService {
    metricCalculations: MetricCalculation[];

    constructor(
        private connection: TransactionalConnection,
        private cacheService: CacheService,
    ) {
        this.metricCalculations = [
            new AverageOrderValueMetric(),
            new OrderCountMetric(),
            new OrderTotalMetric(),
        ];
    }

    async getMetrics(
        ctx: RequestContext,
        { types, refresh, startDate, endDate }: DashboardMetricSummaryInput,
    ): Promise<DashboardMetricSummary[]> {
        const calculatedStartDate = new Date(startDate);
        const calculatedEndDate = new Date(endDate);
        if (
            !Number.isFinite(calculatedStartDate.getTime()) ||
            !Number.isFinite(calculatedEndDate.getTime())
        ) {
            throw new UserInputError('统计时间格式不正确');
        }
        if (calculatedStartDate > calculatedEndDate) {
            throw new UserInputError('统计开始时间不能晚于结束时间');
        }
        // Check if we have cached result
        const hash = createHash('sha1')
            .update(
                JSON.stringify({
                    startDate: calculatedStartDate,
                    endDate: calculatedEndDate,
                    types: [...types].sort((a, b) => a.localeCompare(b)),
                    channel: ctx.channelId,
                    currency: ctx.channel.defaultCurrencyCode,
                }),
            )
            .digest('base64');
        const cacheKey = `MetricsService:${hash}`;
        const cachedMetricList = await this.cacheService.get<DashboardMetricSummary[]>(cacheKey);
        if (cachedMetricList && refresh !== true) {
            Logger.verbose(`Returning cached metrics for channel ${ctx.channelId}`, loggerCtx);
            return cachedMetricList;
        }
        // No cache, calculating new metrics
        Logger.verbose(
            `No cache hit, calculating metrics from ${calculatedStartDate.toISOString()} to ${calculatedEndDate.toISOString()} for channel ${
                ctx.channelId
            } for all orders`,
            loggerCtx,
        );
        const data = await this.loadData(ctx, calculatedStartDate, calculatedEndDate);
        const metrics: DashboardMetricSummary[] = [];
        for (const type of types) {
            const metric = this.metricCalculations.find(m => m.type === type);
            if (!metric) {
                continue;
            }
            // Calculate entries for each day
            const entries: DashboardMetricSummaryEntry[] = [];
            data.forEach(dataPerDay => {
                entries.push(metric.calculateEntry(ctx, dataPerDay));
            });
            // Create metric with calculated entries
            metrics.push({
                title: metric.getTitle(ctx),
                type: metric.type,
                entries,
            });
        }
        await this.cacheService.set(cacheKey, metrics, { ttl: 1000 * 60 * 60 * 2 }); // 2 hours
        return metrics;
    }

    async loadData(ctx: RequestContext, startDate: Date, endDate: Date): Promise<Map<string, MetricData>> {
        const orderRepo = this.connection.getRepository(ctx, Order);

        // Get orders in a loop until we have all
        let skip = 0;
        const take = 1000;
        let hasMoreOrders = true;
        const orders: Order[] = [];
        while (hasMoreOrders) {
            const query = orderRepo
                .createQueryBuilder('order')
                .leftJoinAndSelect('order.payments', 'metricPayment')
                .leftJoinAndSelect('metricPayment.refunds', 'metricRefund')
                .where('order.salesChannelId=:channelId', { channelId: ctx.channelId })
                .andWhere('order.currencyCode=:currencyCode', {
                    currencyCode: ctx.channel.defaultCurrencyCode,
                })
                .andWhere('order.orderPlacedAt >= :startDate', {
                    startDate,
                })
                .andWhere('order.orderPlacedAt <= :endDate', {
                    endDate,
                })
                .orderBy('order.id', 'ASC')
                .skip(skip)
                .take(take);
            const [items, nrOfOrders] = await query.getManyAndCount();
            orders.push(...items);
            Logger.verbose(
                `Fetched orders ${skip}-${skip + take} for channel ${ctx.channelId} for date range metrics`,
                loggerCtx,
            );
            skip += items.length;
            if (items.length === 0 || orders.length >= nrOfOrders) {
                hasMoreOrders = false;
            }
        }
        Logger.verbose(
            `Finished fetching all ${orders.length} orders for channel ${ctx.channelId} for date range metrics`,
            loggerCtx,
        );

        return buildMetricDataByDay(orders, startDate, endDate);
    }
}
