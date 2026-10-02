import { Injectable } from '@nestjs/common';
import {
    OrderLine,
    Payment,
    ProductService,
    Refund,
    RefundLine,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { createHash } from 'node:crypto';

import { StorefrontCatalogService } from './storefront-catalog.service';

// Matches the application's enforced business timezone in dev-server/business-time.ts.
export function recommendationDay(now: Date) {
    const businessDate = new Date(now.getTime() + 8 * 60 * 60_000).toISOString().slice(0, 10);
    const start = new Date(`${businessDate}T00:00:00+08:00`);
    return { businessDate, start, expiresAt: new Date(start.getTime() + 24 * 60 * 60_000) };
}

export function rankDailyRecommendations(ids: string[], sales: Map<string, number>, seed: string): string[] {
    const scores = new Map(ids.map(id => [id, createHash('sha256').update(`${seed}:${id}`).digest('hex')]));
    return [...new Set(ids)]
        .sort(
            (a, b) =>
                (sales.get(b) ?? 0) - (sales.get(a) ?? 0) ||
                (scores.get(a) ?? '').localeCompare(scores.get(b) ?? ''),
        )
        .slice(0, 10);
}

/** Public product selection only. Order/customer details never leave this service. */
@Injectable()
export class StorefrontRecommendationsService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly catalog: StorefrontCatalogService,
        private readonly products: ProductService,
    ) {}

    async find(ctx: RequestContext, now = new Date()) {
        const { businessDate, start, expiresAt } = recommendationDay(now);
        const ids = await this.catalog.recommendationProductIds(ctx);
        if (!ids.length) return { items: [], businessDate, expiresAt };

        const refunds = this.connection
            .getRepository(ctx, RefundLine)
            .createQueryBuilder('refunded_line')
            .innerJoin('refunded_line.refund', 'refund', 'refund.state = :settledRefund', {
                settledRefund: 'Settled',
            })
            .select('refunded_line.orderLineId', 'lineId')
            .addSelect('SUM(refunded_line.quantity)', 'quantity')
            .groupBy('refunded_line.orderLineId');
        const paymentRefunds = this.connection
            .getRepository(ctx, Refund)
            .createQueryBuilder('payment_refund')
            .select('payment_refund.paymentId', 'paymentId')
            .addSelect('SUM(payment_refund.total)', 'total')
            .where('payment_refund.state = :settledRefund', { settledRefund: 'Settled' })
            .groupBy('payment_refund.paymentId');
        // Aggregate payments before joining lines, so split payments never multiply sales.
        const paidOrders = this.connection
            .getRepository(ctx, Payment)
            .createQueryBuilder('payment')
            .leftJoin(
                `(${paymentRefunds.getQuery()})`,
                'payment_refunds',
                'payment_refunds.paymentId = payment.id',
            )
            .setParameters(paymentRefunds.getParameters())
            .select('payment.orderId', 'orderId')
            .where('payment.state = :settledPayment', { settledPayment: 'Settled' })
            .groupBy('payment.orderId')
            .having('SUM(payment.amount - COALESCE(payment_refunds.total, 0)) > 0');
        const rows = await this.connection
            .getRepository(ctx, OrderLine)
            .createQueryBuilder('line')
            .innerJoin('line.order', 'placed_order')
            .innerJoin('placed_order.channels', 'channel', 'channel.id = :channelId', {
                channelId: ctx.channelId,
            })
            .innerJoin(`(${paidOrders.getQuery()})`, 'paid_order', 'paid_order.orderId = placed_order.id')
            .innerJoin('line.productVariant', 'variant')
            .leftJoin(`(${refunds.getQuery()})`, 'line_refunds', 'line_refunds.lineId = line.id')
            .setParameters({ ...paidOrders.getParameters(), ...refunds.getParameters() })
            .select('variant.productId', 'productId')
            .addSelect('line.quantity', 'quantity')
            .addSelect('line.orderPlacedQuantity', 'placedQuantity')
            .addSelect('COALESCE(line_refunds.quantity, 0)', 'refundedQuantity')
            .where('placed_order.orderPlacedAt >= :start AND placed_order.orderPlacedAt <= :now', {
                start,
                now,
            })
            .andWhere('placed_order.state != :cancelled', { cancelled: 'Cancelled' })
            .andWhere('line.quantity > 0')
            .getRawMany<{
                productId: string;
                quantity: number | string;
                placedQuantity: number | string;
                refundedQuantity: number | string;
            }>();
        const sales = new Map<string, number>();
        for (const row of rows) {
            // Cancellation already lowers quantity; do not subtract its matching refund twice.
            const net = Math.max(
                0,
                Math.min(Number(row.quantity), Number(row.placedQuantity) - Number(row.refundedQuantity)),
            );
            const id = String(row.productId);
            sales.set(id, (sales.get(id) ?? 0) + net);
        }
        const selected = rankDailyRecommendations(ids, sales, `${ctx.channelId}:${businessDate}`);
        const products = await this.products.findByIds(ctx, selected);
        const byId = new Map(
            products
                .filter(product => product.enabled && !product.deletedAt)
                .map(product => [String(product.id), product]),
        );
        return { items: selected.flatMap(id => byId.get(id) ?? []), businessDate, expiresAt };
    }
}
