import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import { Payment, Refund, RequestContext, TransactionalConnection } from '@vendure/core';

const SETTLED_PAYMENT_STATE = 'Settled';
const SETTLED_REFUND_STATE = 'Settled';
const PLATFORM_DETAIL_LIMIT = 200;
const MERCHANT_DETAIL_LIMIT = 100;

export interface StorePaymentMethodStats {
    channelId: string;
    channelCode: string;
    paymentMethodCode: string;
    currencyCode: string;
    settledCount: number;
    refundCount: number;
    grossAmount: number;
    refundedAmount: number;
    netAmount: number;
}

export interface StorePaymentDetail {
    id: string;
    channelId: string;
    channelCode: string;
    orderId: string;
    orderCode: string;
    paymentMethodCode: string;
    paymentState: string;
    currencyCode: string;
    amount: number;
    refundedAmount: number;
    netAmount: number;
    transactionId: string | null;
    createdAt: Date;
}

interface SettledPaymentStatsRow {
    channelId: string | number;
    channelCode: string;
    paymentMethodCode: string;
    currencyCode: string;
    settledCount: string | number;
    grossAmount: string | number;
}

interface SettledRefundStatsRow {
    channelId: string | number;
    channelCode: string;
    paymentMethodCode: string;
    currencyCode: string;
    refundCount: string | number;
    refundedAmount: string | number;
}

interface PaymentDetailRow {
    paymentId: string | number;
    channelId: string | number;
    channelCode: string;
    orderId: string | number;
    orderCode: string;
    paymentMethodCode: string;
    paymentState: string;
    currencyCode: string;
    amount: string | number;
    refundedAmount: string | number;
    transactionId: string | null;
    createdAt: Date | string;
}

/**
 * Reports captured money by the Channel on the Order. Authorized, failed and cancelled payments remain
 * visible in the detail list, but do not contribute to collected totals until they reach Settled.
 */
@Injectable()
export class StorePaymentReportingService {
    constructor(private readonly connection: TransactionalConnection) {}

    statsForChannel(ctx: RequestContext): Promise<StorePaymentMethodStats[]> {
        return this.stats(ctx, ctx.channelId);
    }

    detailsForChannel(ctx: RequestContext): Promise<StorePaymentDetail[]> {
        return this.details(ctx, ctx.channelId, MERCHANT_DETAIL_LIMIT);
    }

    async stats(ctx: RequestContext, channelId?: ID | null): Promise<StorePaymentMethodStats[]> {
        const paymentQuery = this.connection
            .getRepository(ctx, Payment)
            .createQueryBuilder('payment')
            .innerJoin('payment.order', 'order')
            .innerJoin('order.channels', 'channel')
            .select('channel.id', 'channelId')
            .addSelect('channel.code', 'channelCode')
            .addSelect('payment.method', 'paymentMethodCode')
            .addSelect('order.currencyCode', 'currencyCode')
            .addSelect('COUNT(payment.id)', 'settledCount')
            .addSelect('COALESCE(SUM(payment.amount), 0)', 'grossAmount')
            .where('payment.state = :settledPaymentState', {
                settledPaymentState: SETTLED_PAYMENT_STATE,
            })
            .groupBy('channel.id')
            .addGroupBy('channel.code')
            .addGroupBy('payment.method')
            .addGroupBy('order.currencyCode');
        if (channelId != null) paymentQuery.andWhere('channel.id = :channelId', { channelId });

        const refundQuery = this.connection
            .getRepository(ctx, Refund)
            .createQueryBuilder('refund')
            .innerJoin('refund.payment', 'payment')
            .innerJoin('payment.order', 'order')
            .innerJoin('order.channels', 'channel')
            .select('channel.id', 'channelId')
            .addSelect('channel.code', 'channelCode')
            .addSelect('payment.method', 'paymentMethodCode')
            .addSelect('order.currencyCode', 'currencyCode')
            .addSelect('COUNT(refund.id)', 'refundCount')
            .addSelect('COALESCE(SUM(refund.total), 0)', 'refundedAmount')
            .where('refund.state = :settledRefundState', {
                settledRefundState: SETTLED_REFUND_STATE,
            })
            .groupBy('channel.id')
            .addGroupBy('channel.code')
            .addGroupBy('payment.method')
            .addGroupBy('order.currencyCode');
        if (channelId != null) refundQuery.andWhere('channel.id = :channelId', { channelId });

        const [paymentRows, refundRows] = await Promise.all([
            paymentQuery.getRawMany<SettledPaymentStatsRow>(),
            refundQuery.getRawMany<SettledRefundStatsRow>(),
        ]);
        return mergePaymentStats(paymentRows, refundRows);
    }

    async details(
        ctx: RequestContext,
        channelId?: ID | null,
        limit = PLATFORM_DETAIL_LIMIT,
    ): Promise<StorePaymentDetail[]> {
        const query = this.connection
            .getRepository(ctx, Payment)
            .createQueryBuilder('payment')
            .innerJoin('payment.order', 'order')
            .innerJoin('order.channels', 'channel')
            .leftJoin('payment.refunds', 'refund', 'refund.state = :settledRefundState', {
                settledRefundState: SETTLED_REFUND_STATE,
            })
            .select('payment.id', 'paymentId')
            .addSelect('channel.id', 'channelId')
            .addSelect('channel.code', 'channelCode')
            .addSelect('order.id', 'orderId')
            .addSelect('order.code', 'orderCode')
            .addSelect('payment.method', 'paymentMethodCode')
            .addSelect('payment.state', 'paymentState')
            .addSelect('order.currencyCode', 'currencyCode')
            .addSelect('payment.amount', 'amount')
            .addSelect('COALESCE(SUM(refund.total), 0)', 'refundedAmount')
            .addSelect('payment.transactionId', 'transactionId')
            .addSelect('payment.createdAt', 'createdAt')
            .groupBy('payment.id')
            .addGroupBy('channel.id')
            .addGroupBy('channel.code')
            .addGroupBy('order.id')
            .addGroupBy('order.code')
            .addGroupBy('payment.method')
            .addGroupBy('payment.state')
            .addGroupBy('order.currencyCode')
            .addGroupBy('payment.amount')
            .addGroupBy('payment.transactionId')
            .addGroupBy('payment.createdAt')
            .orderBy('payment.createdAt', 'DESC')
            .limit(Math.max(1, Math.min(PLATFORM_DETAIL_LIMIT, Math.trunc(limit))));
        if (channelId != null) query.andWhere('channel.id = :channelId', { channelId });

        const rows = await query.getRawMany<PaymentDetailRow>();
        return rows.map(row => {
            const amount = Number(row.amount);
            const refundedAmount = Number(row.refundedAmount);
            const settledAmount = row.paymentState === SETTLED_PAYMENT_STATE ? amount : 0;
            return {
                id: String(row.paymentId),
                channelId: String(row.channelId),
                channelCode: row.channelCode,
                orderId: String(row.orderId),
                orderCode: row.orderCode,
                paymentMethodCode: row.paymentMethodCode,
                paymentState: row.paymentState,
                currencyCode: row.currencyCode,
                amount,
                refundedAmount,
                netAmount: settledAmount - refundedAmount,
                transactionId: row.transactionId,
                createdAt: new Date(row.createdAt),
            };
        });
    }
}

export function mergePaymentStats(
    paymentRows: SettledPaymentStatsRow[],
    refundRows: SettledRefundStatsRow[],
): StorePaymentMethodStats[] {
    const grouped = new Map<string, StorePaymentMethodStats>();
    for (const row of paymentRows) {
        const key = paymentStatsKey(row);
        grouped.set(key, {
            channelId: String(row.channelId),
            channelCode: row.channelCode,
            paymentMethodCode: row.paymentMethodCode,
            currencyCode: row.currencyCode,
            settledCount: Number(row.settledCount),
            refundCount: 0,
            grossAmount: Number(row.grossAmount),
            refundedAmount: 0,
            netAmount: Number(row.grossAmount),
        });
    }
    for (const row of refundRows) {
        const key = paymentStatsKey(row);
        const summary = grouped.get(key) ?? {
            channelId: String(row.channelId),
            channelCode: row.channelCode,
            paymentMethodCode: row.paymentMethodCode,
            currencyCode: row.currencyCode,
            settledCount: 0,
            refundCount: 0,
            grossAmount: 0,
            refundedAmount: 0,
            netAmount: 0,
        };
        summary.refundCount = Number(row.refundCount);
        summary.refundedAmount = Number(row.refundedAmount);
        summary.netAmount = summary.grossAmount - summary.refundedAmount;
        grouped.set(key, summary);
    }
    return Array.from(grouped.values()).sort(
        (left, right) =>
            left.channelCode.localeCompare(right.channelCode) ||
            left.currencyCode.localeCompare(right.currencyCode) ||
            left.paymentMethodCode.localeCompare(right.paymentMethodCode),
    );
}

function paymentStatsKey(row: {
    channelId: string | number;
    paymentMethodCode: string;
    currencyCode: string;
}): string {
    return `${String(row.channelId)}\u0000${row.paymentMethodCode}\u0000${row.currencyCode}`;
}
