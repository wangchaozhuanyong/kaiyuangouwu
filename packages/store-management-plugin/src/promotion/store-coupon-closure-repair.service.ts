import { Injectable } from '@nestjs/common';
import {
    Customer,
    ID,
    OrderService,
    PromotionService,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
    UserInputError,
    idsAreEqual,
} from '@vendure/core';
import { StorefrontCartService } from '@vendure/storefront-cart-plugin';
import { createHash } from 'crypto';
import { MoreThan, Not } from 'typeorm';

import { CouponLedgerEntry } from '../entities/coupon-ledger-entry.entity';
import { CouponOrderAllocation } from '../entities/coupon-order-allocation.entity';
import { CustomerCoupon } from '../entities/customer-coupon.entity';
import { StoreCouponCampaignConfig } from '../entities/store-coupon-campaign-config.entity';

import { lockCouponCampaign } from './store-coupon-campaign-lock';
import { StoreCouponLifecycleService } from './store-coupon-lifecycle.service';

const VERSION = 'coupon-closure-v2';
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const iso = (value?: Date | null) => value?.toISOString() ?? null;
type ClosureOrder = {
    id: string;
    state: string;
    active: boolean;
    totalWithTax: number;
    couponCodes: string[];
    customerId: string;
    paymentPending: boolean;
    otherEntitlementId: string | null;
    payments: Array<{
        id: string;
        state: string;
        amount: number;
        transactionId: string;
        paidAt: string | null;
        paymentSource: string | null;
        manualReview: boolean;
        refunds: Array<{ id: string; state: string; total: number; completedAt: string | null }>;
    }>;
};
type Action = {
    type: 'REFUND' | 'RELEASE_COUPON' | 'RELEASE_ALLOCATION';
    orderId: ID;
    refundId?: ID;
    allocationId?: ID;
    target: Record<string, unknown>;
};

@Injectable()
export class StoreCouponClosureRepairService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly lifecycle: StoreCouponLifecycleService,
        private readonly orders: OrderService,
        private readonly promotions: PromotionService,
        private readonly carts: StorefrontCartService,
        private readonly contexts: RequestContextService,
    ) {}

    private async ownedConfig(ctx: RequestContext, campaignId: ID) {
        const config = await this.connection
            .getRepository(ctx, StoreCouponCampaignConfig)
            .findOne({ where: { promotionId: campaignId } });
        if (!config || !idsAreEqual(config.channelId, ctx.channelId))
            throw new UserInputError('该优惠券不属于当前店铺');
        return config;
    }

    async preview(ctx: RequestContext, campaignId: ID) {
        const config = await this.ownedConfig(ctx, campaignId);
        const items: Array<Awaited<ReturnType<StoreCouponClosureRepairService['previewItem']>>> = [];
        let cursor: ID | undefined;
        while (true) {
            const coupons = await this.connection.getRepository(ctx, CustomerCoupon).find({
                where: {
                    channelId: ctx.channelId,
                    promotionId: campaignId,
                    ...(cursor == null ? {} : { id: MoreThan(cursor) }),
                },
                order: { id: 'ASC' },
                take: 200,
            });
            if (!coupons.length) break;
            for (const coupon of coupons) {
                cursor = coupon.id;
                items.push(await this.previewItem(ctx, coupon.id));
            }
        }
        const manualReview =
            config.issueLimit != null && items.length > config.issueLimit
                ? [
                      {
                          reason: 'ISSUE_LIMIT_EXCEEDED',
                          issuedCount: items.length,
                          issueLimit: config.issueLimit,
                      },
                  ]
                : [];
        const report = {
            repairVersion: VERSION,
            channelId: String(ctx.channelId),
            campaignId: String(campaignId),
            items,
            manualReview,
        };
        return { ...report, fingerprint: fingerprint(report) };
    }

    private async previewItem(ctx: RequestContext, couponId: ID) {
        const coupon = await this.connection.getRepository(ctx, CustomerCoupon).findOneOrFail({
            where: { id: couponId, channelId: ctx.channelId },
            relations: { promotion: true, campaignConfig: true },
        });
        if (!idsAreEqual(coupon.campaignConfig.channelId, ctx.channelId))
            throw new UserInputError('该优惠券属于其他店铺');
        const allocations = await this.connection.getRepository(ctx, CouponOrderAllocation).find({
            where: { customerCouponId: coupon.id, channelId: ctx.channelId },
            order: { id: 'ASC' },
        });
        const orderIds = [
            ...new Set(
                [...allocations.map(item => item.orderId), coupon.lockedOrderId, coupon.usedOrderId].filter(
                    (id): id is ID => id != null,
                ),
            ),
        ].sort((a, b) => String(a).localeCompare(String(b), 'en', { numeric: true }));
        const orders: ClosureOrder[] = [];
        for (const id of orderIds) {
            const order = await this.orders.findOne(ctx, id, ['payments', 'payments.refunds']);
            if (!order) continue;
            const otherEntitlement = await this.connection.getRepository(ctx, CustomerCoupon).findOne({
                where: {
                    id: Not(coupon.id),
                    channelId: ctx.channelId,
                    promotionId: coupon.promotionId,
                    lockedOrderId: order.id,
                    status: 'LOCKED',
                },
            });
            orders.push({
                id: String(order.id),
                state: order.state,
                active: order.active,
                totalWithTax: order.totalWithTax,
                couponCodes: order.couponCodes,
                customerId: String(order.customerId),
                paymentPending:
                    order.state === 'ArrangingPayment' ||
                    (await this.carts.isOrderPaymentLocked(ctx, order.id)),
                otherEntitlementId: otherEntitlement ? String(otherEntitlement.id) : null,
                payments: order.payments
                    .map(payment => ({
                        id: String(payment.id),
                        state: payment.state,
                        amount: payment.amount,
                        transactionId: payment.transactionId,
                        paidAt: payment.metadata?.couponPaymentValidation?.paidAt ?? null,
                        paymentSource: payment.metadata?.couponPaymentValidation?.source ?? null,
                        manualReview: Boolean(payment.metadata?.manualReview?.required),
                        refunds: (payment.refunds ?? [])
                            .map(refund => ({
                                id: String(refund.id),
                                state: refund.state,
                                total: refund.total,
                                completedAt: iso(refund.updatedAt),
                            }))
                            .sort((a, b) => a.id.localeCompare(b.id)),
                    }))
                    .sort((a, b) => a.id.localeCompare(b.id)),
            });
        }
        const snapshot = {
            coupon: {
                id: String(coupon.id),
                version: coupon.version,
                status: coupon.status,
                validFrom: iso(coupon.validFrom),
                validUntil: iso(coupon.validUntil),
                lockedOrderId: coupon.lockedOrderId == null ? null : String(coupon.lockedOrderId),
                usedOrderId: coupon.usedOrderId == null ? null : String(coupon.usedOrderId),
                lockExpiresAt: iso(coupon.lockExpiresAt),
                usedAt: iso(coupon.usedAt),
                returnedAt: iso(coupon.returnedAt),
                revokedAt: iso(coupon.revokedAt),
                returnCount: coupon.returnCount,
            },
            config: {
                id: String(coupon.campaignConfigId),
                updatedAt: iso(coupon.campaignConfig.updatedAt),
                returnOnFullRefund: coupon.campaignConfig.returnOnFullRefund,
                returnOnCancellation: coupon.campaignConfig.returnOnCancellation,
                enabled: coupon.promotion.enabled,
                deletedAt: iso(coupon.promotion.deletedAt),
            },
            allocations: allocations.map(item => ({
                id: String(item.id),
                orderId: String(item.orderId),
                status: item.status,
                updatedAt: iso(item.updatedAt),
                usedAt: iso(item.usedAt),
                refundedAt: iso(item.refundedAt),
                releasedAt: iso(item.releasedAt),
                refundId: item.refundId == null ? null : String(item.refundId),
                orderTotalWithTax: item.orderTotalWithTax,
                discountAmountWithTax: item.discountAmountWithTax,
                refundedAmount: item.refundedAmount,
            })),
            orders,
        };
        const actions: Action[] = [];
        const manualReview: string[] = [];
        const now = new Date();
        const expired = coupon.validUntil != null && coupon.validUntil <= now;
        const receivedFunds = (order: (typeof orders)[number]) =>
            order.payments.some(
                payment => ['Authorized', 'Settled'].includes(payment.state) || payment.manualReview,
            );
        if (coupon.status === 'REVOKED' && allocations.some(item => item.status === 'USED'))
            manualReview.push('REVOKED_WITH_USED_ALLOCATION');
        if (coupon.status === 'USED') {
            const order = orders.find(item => item.id === String(coupon.usedOrderId));
            if (
                !order ||
                !allocations.some(
                    item =>
                        ['USED', 'REFUNDED'].includes(item.status) &&
                        idsAreEqual(item.orderId, coupon.usedOrderId),
                )
            )
                manualReview.push('REDEMPTION_ALLOCATION_MISSING');
            if (
                order?.payments.some(
                    payment =>
                        payment.state === 'Settled' &&
                        (!payment.paidAt || !Number.isFinite(Date.parse(payment.paidAt))),
                )
            )
                manualReview.push('PAYMENT_TIME_UNVERIFIED');
            if (
                order?.payments.some(
                    payment =>
                        payment.state === 'Settled' &&
                        payment.paidAt &&
                        (Date.parse(payment.paidAt) < coupon.validFrom.getTime() ||
                            (coupon.validUntil && Date.parse(payment.paidAt) >= coupon.validUntil.getTime())),
                )
            )
                manualReview.push('PAID_OUTSIDE_COUPON_VALIDITY');
        }
        if (coupon.status === 'LOCKED') {
            const order = orders.find(item => item.id === String(coupon.lockedOrderId));
            if (!order) manualReview.push('LOCKED_ORDER_MISSING');
            else if (receivedFunds(order)) manualReview.push('PAYMENT_PENDING_REVIEW');
            else if (
                !order.paymentPending &&
                (expired ||
                    (coupon.lockExpiresAt && coupon.lockExpiresAt <= now) ||
                    order.state === 'Cancelled' ||
                    !order.couponCodes.includes(coupon.promotion.couponCode))
            ) {
                actions.push({
                    type: 'RELEASE_COUPON',
                    orderId: order.id,
                    target: {
                        couponStatus: expired ? 'EXPIRED' : coupon.returnedAt ? 'RETURNED' : 'AVAILABLE',
                        allocationStatus: 'RELEASED',
                        removeCouponCode: coupon.promotion.couponCode,
                        repriceUnpaidOrder: true,
                    },
                });
            }
        }
        for (const allocation of allocations) {
            const order = orders.find(item => item.id === String(allocation.orderId));
            if (!order) {
                manualReview.push('ALLOCATION_ORDER_MISSING');
                continue;
            }
            if (
                allocation.status === 'LOCKED' &&
                !(coupon.status === 'LOCKED' && idsAreEqual(coupon.lockedOrderId, order.id)) &&
                !(coupon.status === 'USED' && idsAreEqual(coupon.usedOrderId, order.id))
            ) {
                if (receivedFunds(order) || order.paymentPending)
                    manualReview.push('ORPHAN_ALLOCATION_WITH_PAYMENT');
                else
                    actions.push({
                        type: 'RELEASE_ALLOCATION',
                        allocationId: allocation.id,
                        orderId: order.id,
                        target: {
                            allocationStatus: 'RELEASED',
                            removeCouponCode: order.otherEntitlementId ? null : coupon.promotion.couponCode,
                            repriceUnpaidOrder: !order.otherEntitlementId,
                        },
                    });
            }
            if (!['USED', 'REFUNDED'].includes(allocation.status)) continue;
            const refunds = order.payments
                .flatMap(payment => payment.refunds)
                .filter(refund => refund.state === 'Settled')
                .sort(
                    (a, b) =>
                        (a.completedAt ?? '').localeCompare(b.completedAt ?? '') || a.id.localeCompare(b.id),
                );
            const total = refunds.reduce((sum, refund) => sum + refund.total, 0);
            const paidTotal = allocation.orderTotalWithTax || order.totalWithTax;
            const fullRefund = paidTotal > 0 && total >= paidTotal;
            const canReturn =
                fullRefund &&
                coupon.status === 'USED' &&
                idsAreEqual(coupon.usedOrderId, order.id) &&
                coupon.campaignConfig.returnOnFullRefund &&
                coupon.promotion.enabled &&
                !coupon.promotion.deletedAt;
            const targetRefunded = Math.round(
                allocation.discountAmountWithTax * Math.min(1, total / Math.max(1, paidTotal)),
            );
            if (
                refunds.length &&
                (targetRefunded !== allocation.refundedAmount ||
                    (fullRefund && allocation.status !== 'REFUNDED') ||
                    canReturn)
            ) {
                actions.push({
                    type: 'REFUND',
                    orderId: order.id,
                    refundId: refunds[refunds.length - 1].id,
                    target: {
                        refundedAmount: targetRefunded,
                        allocationStatus: fullRefund ? 'REFUNDED' : allocation.status,
                        couponStatus: canReturn ? (expired ? 'EXPIRED' : 'RETURNED') : coupon.status,
                        validUntil: iso(coupon.validUntil),
                    },
                });
            }
        }
        const report = {
            couponId: String(coupon.id),
            snapshot,
            actions,
            manualReview: [...new Set(manualReview)],
        };
        return { ...report, fingerprint: fingerprint(report) };
    }

    private async applyItem(
        ctx: RequestContext,
        campaignId: ID,
        item: Awaited<ReturnType<StoreCouponClosureRepairService['previewItem']>>,
    ) {
        return this.carts.withTransaction(ctx, async txCtx => {
            await lockCouponCampaign(this.connection, txCtx, await this.ownedConfig(txCtx, campaignId));
            for (const order of item.snapshot.orders) await this.carts.lockForOrder(txCtx, order.id);
            for (const order of item.snapshot.orders) await this.orders.lockOrderForRefund(txCtx, order.id);
            await this.lifecycle.lockCouponForRepair(txCtx, item.couponId);
            const current = await this.previewItem(txCtx, item.couponId);
            if (current.fingerprint !== item.fingerprint)
                throw new UserInputError('记录已变化，请重新预览本项');
            for (const action of current.actions) {
                const coupon = await this.connection.getRepository(txCtx, CustomerCoupon).findOneOrFail({
                    where: { id: item.couponId },
                    relations: { promotion: true, campaignConfig: true },
                });
                if (action.type === 'REFUND' && action.refundId)
                    await this.lifecycle.reconcileRefundForOrder(
                        txCtx,
                        action.orderId,
                        action.refundId,
                        coupon.id,
                    );
                if (action.type === 'RELEASE_COUPON')
                    await this.lifecycle.releaseCouponForRepair(txCtx, coupon);
                if (action.type === 'RELEASE_ALLOCATION') {
                    await this.carts.withOrderChange(txCtx, action.orderId, async workCtx => {
                        if (action.target.removeCouponCode)
                            await this.orders.removeCouponCode(
                                workCtx,
                                action.orderId,
                                coupon.promotion.couponCode,
                            );
                        const result = await this.connection
                            .getRepository(workCtx, CouponOrderAllocation)
                            .update(
                                { id: action.allocationId, channelId: ctx.channelId, status: 'LOCKED' },
                                { status: 'RELEASED', releasedAt: new Date() },
                            );
                        if (result.affected !== 1) throw new UserInputError('订单分配已变化，请重新预览');
                    });
                }
            }
            const after = await this.previewItem(txCtx, item.couponId);
            const repairedCoupon = await this.connection.getEntityOrThrow(
                txCtx,
                CustomerCoupon,
                item.couponId,
            );
            await this.connection.getRepository(txCtx, CouponLedgerEntry).save(
                new CouponLedgerEntry({
                    channelId: ctx.channelId,
                    promotionId: campaignId,
                    customerCouponId: repairedCoupon.id,
                    customerId: repairedCoupon.customerId,
                    eventType: 'CORRECTED',
                    actorType: ctx.activeUserId ? 'ADMIN' : 'SYSTEM',
                    idempotencyKey: `${VERSION}:${item.couponId}:${item.fingerprint}`,
                    note: '依据订单占用及已结算退款核对优惠券闭环；保留原有效期和历史核销',
                    metadata: {
                        repairVersion: VERSION,
                        fingerprint: item.fingerprint,
                        before: item.snapshot,
                        actions: item.actions,
                        after: after.snapshot,
                    },
                }),
            );
            const customer = await this.connection.getRepository(txCtx, Customer).findOne({
                where: { id: repairedCoupon.customerId },
                relations: { user: true },
            });
            if (customer) await this.lifecycle.publishCustomerCouponChanged(txCtx, customer);
        });
    }

    async apply(ctx: RequestContext, campaignId: ID, expectedFingerprint: string) {
        const report = await this.preview(ctx, campaignId);
        if (report.fingerprint !== expectedFingerprint)
            throw new UserInputError('预览已过期，请重新核对修复清单');
        let changedCoupons = 0;
        const conflicts: Array<{ couponId: string; reason: string }> = [];
        for (const item of report.items.filter(candidate => candidate.actions.length)) {
            try {
                await this.applyItem(ctx, campaignId, item);
                changedCoupons++;
            } catch (error) {
                conflicts.push({
                    couponId: item.couponId,
                    reason: error instanceof Error ? error.message : '修复失败',
                });
            }
        }
        return {
            appliedFingerprint: report.fingerprint,
            changedCoupons,
            conflicts,
            after: await this.preview(ctx, campaignId),
        };
    }

    async reconcile() {
        let cursor: ID | undefined;
        let corrected = 0;
        const anomalies: Array<{ campaignId: string; couponId?: string; reasons: unknown }> = [];
        while (true) {
            const configs = await this.connection.rawConnection
                .getRepository(StoreCouponCampaignConfig)
                .find({
                    where: cursor == null ? {} : { id: MoreThan(cursor) },
                    relations: { channel: true },
                    order: { id: 'ASC' },
                    take: 100,
                });
            if (!configs.length) break;
            for (const config of configs) {
                cursor = config.id;
                const ctx = await this.contexts.create({ apiType: 'admin', channelOrToken: config.channel });
                const report = await this.preview(ctx, config.promotionId);
                for (const item of report.items) {
                    if (item.actions.length) {
                        try {
                            await this.applyItem(ctx, config.promotionId, item);
                            corrected++;
                        } catch (error) {
                            anomalies.push({
                                campaignId: String(config.promotionId),
                                couponId: item.couponId,
                                reasons: error instanceof Error ? error.message : 'CONFLICT',
                            });
                        }
                    }
                    if (item.manualReview.length)
                        anomalies.push({
                            campaignId: String(config.promotionId),
                            couponId: item.couponId,
                            reasons: item.manualReview,
                        });
                }
                if (report.manualReview.length)
                    anomalies.push({ campaignId: String(config.promotionId), reasons: report.manualReview });
            }
        }
        return { corrected, anomalies };
    }
}
