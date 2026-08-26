import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import {
    Customer,
    CustomerService,
    EventBus,
    idsAreEqual,
    isGraphQlErrorResult,
    Order,
    OrderService,
    OrderStateTransitionEvent,
    Promotion,
    PromotionService,
    RefundStateTransitionEvent,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { In, IsNull, LessThanOrEqual, Like, LockNotSupportedOnGivenDriverError, Not } from 'typeorm';

import { CouponLedgerEntry } from '../entities/coupon-ledger-entry.entity';
import {
    CouponLineAllocationSnapshot,
    CouponOrderAllocation,
} from '../entities/coupon-order-allocation.entity';
import { CustomerCoupon } from '../entities/customer-coupon.entity';
import { StoreCouponCampaignConfig } from '../entities/store-coupon-campaign-config.entity';
import {
    StoreCouponCampaignActionResult,
    StoreCouponLedgerEntryList,
    StoreCouponLedgerEntryView,
    StoreCouponLedgerListOptions,
    StoreCouponOrderAllocationView,
    StoreCouponUsageRecordView,
    StoreCustomerCouponView,
} from '../types';

import {
    COUPON_LOCK_MINUTES,
    CouponLedgerEventType,
    couponLedgerEventTypes,
    usableCustomerCouponStatuses,
} from './coupon-lifecycle.constants';
import { numberArg } from './promotion-operation-args';

@Injectable()
export class StoreCouponLifecycleService implements OnApplicationBootstrap {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly customerService: CustomerService,
        private readonly promotionService: PromotionService,
        private readonly orderService: OrderService,
        private readonly eventBus: EventBus,
        private readonly requestContextService: RequestContextService,
    ) {}

    async onApplicationBootstrap(): Promise<void> {
        this.eventBus.registerBlockingEventHandler({
            event: OrderStateTransitionEvent,
            id: 'store-coupon-handle-paid-or-cancelled-order',
            handler: event => {
                if (event.toState === 'PaymentAuthorized' || event.toState === 'PaymentSettled') {
                    return this.redeemForPaidOrder(event.ctx, event.order.id);
                }
                if (event.toState === 'Cancelled') {
                    return this.handleCancelledOrder(event.ctx, event.order.id);
                }
                return Promise.resolve();
            },
        });
        this.eventBus.registerBlockingEventHandler({
            event: RefundStateTransitionEvent,
            id: 'store-coupon-return-on-refund-settled',
            handler: event =>
                event.toState === 'Settled'
                    ? this.handleSettledRefund(event.ctx, event.order.id, event.refund.id)
                    : Promise.resolve(),
        });
        await this.backfillLegacyCouponEntitlements();
    }

    async claim(ctx: RequestContext, campaignId: ID): Promise<StoreCustomerCouponView> {
        const customer = await this.activeCustomerOrThrow(ctx);
        return this.issueCoupon(ctx, campaignId, customer, false);
    }

    async grant(ctx: RequestContext, campaignId: ID, customerId: ID): Promise<StoreCustomerCouponView> {
        const customer = await this.customerService.findOne(ctx, customerId);
        if (!customer) throw new UserInputError('找不到要发券的客户');
        return this.issueCoupon(ctx, campaignId, customer, true);
    }

    async findMine(ctx: RequestContext): Promise<StoreCustomerCouponView[]> {
        const customer = await this.activeCustomerOrThrow(ctx);
        await this.reconcileCustomer(ctx, customer.id);
        const coupons = await this.connection.getRepository(ctx, CustomerCoupon).find({
            where: { channelId: ctx.channelId, customerId: customer.id },
            relations: { promotion: true, campaignConfig: true },
            order: { claimedAt: 'DESC' },
            take: 200,
        });
        for (const coupon of coupons) {
            if (
                usableCustomerCouponStatuses.includes(coupon.status) &&
                (!coupon.promotion || coupon.promotion.deletedAt || !coupon.promotion.enabled)
            ) {
                await this.revokeCoupon(ctx, coupon, '优惠券活动已删除或停用，系统自动作废');
            }
        }
        return coupons.map(coupon => this.toCustomerCouponView(coupon));
    }

    async findMyUsageRecords(ctx: RequestContext): Promise<StoreCouponUsageRecordView[]> {
        const customer = await this.activeCustomerOrThrow(ctx);
        const allocations = await this.connection.getRepository(ctx, CouponOrderAllocation).find({
            where: {
                channelId: ctx.channelId,
                customerId: customer.id,
                status: In(['USED', 'REFUNDED']),
            },
            relations: { customerCoupon: true, order: true },
            order: { usedAt: 'DESC' },
            take: 200,
        });
        return allocations.flatMap(allocation => {
            if (!allocation.usedAt || !allocation.customerCoupon || !allocation.order) return [];
            return [
                {
                    id: allocation.id,
                    customerCouponId: allocation.customerCouponId,
                    campaignId: allocation.promotionId,
                    campaignName: allocation.campaignName,
                    campaignKind: allocation.customerCoupon.campaignKind,
                    status: allocation.status as 'USED' | 'REFUNDED',
                    currencyCode: allocation.currencyCode,
                    minimumSpend: allocation.customerCoupon.minimumSpend,
                    discountAmount: allocation.customerCoupon.discountAmount,
                    discountRate: allocation.customerCoupon.discountRate,
                    savedAmount: allocation.discountAmountWithTax,
                    usedAt: allocation.usedAt,
                    refundedAt: allocation.refundedAt,
                    orderId: allocation.orderId,
                    orderCode: allocation.order.code,
                },
            ];
        });
    }

    async apply(ctx: RequestContext, customerCouponId: ID): Promise<StoreCustomerCouponView> {
        const customer = await this.activeCustomerOrThrow(ctx);
        if (!ctx.activeUserId) throw new UserInputError('请先登录后使用优惠券');
        const order = await this.orderService.getActiveOrderForUser(ctx, ctx.activeUserId);
        if (!order || !order.lines?.length) throw new UserInputError('请先将商品加入购物车');

        await this.lockRow(ctx, CustomerCoupon, customerCouponId);
        const coupon = await this.ownedCouponOrThrow(ctx, customerCouponId, customer.id);
        const now = new Date();
        if (this.isExpired(coupon, now)) {
            await this.expireCoupon(ctx, coupon, '使用时发现优惠券已经过期');
            throw new UserInputError('优惠券已过期');
        }
        const alreadyLockedToThisOrder =
            coupon.status === 'LOCKED' && idsAreEqual(coupon.lockedOrderId, order.id);
        if (!alreadyLockedToThisOrder && !usableCustomerCouponStatuses.includes(coupon.status)) {
            throw new UserInputError(this.unusableMessage(coupon));
        }
        if (coupon.validFrom > now) throw new UserInputError('优惠券尚未到可用时间');

        const otherLocked = await this.connection.getRepository(ctx, CustomerCoupon).find({
            where: {
                channelId: ctx.channelId,
                customerId: customer.id,
                lockedOrderId: order.id,
                status: 'LOCKED',
                id: Not(coupon.id),
            },
            relations: { campaignConfig: true, promotion: true },
        });
        for (const existing of otherLocked) {
            const sameCampaign = idsAreEqual(existing.promotionId, coupon.promotionId);
            const incompatible =
                sameCampaign ||
                coupon.campaignConfig.stackPolicy === 'EXCLUSIVE' ||
                existing.campaignConfig.stackPolicy === 'EXCLUSIVE';
            if (incompatible) {
                await this.releaseLockedCoupon(ctx, existing, order, '应用其他互斥优惠券');
            }
        }

        if (!alreadyLockedToThisOrder) {
            coupon.status = 'LOCKED';
            coupon.lockedAt = now;
            coupon.lockExpiresAt = new Date(now.getTime() + COUPON_LOCK_MINUTES * 60_000);
            coupon.lockedOrderId = order.id;
            await this.connection.getRepository(ctx, CustomerCoupon).save(coupon, { reload: false });
        }

        const applyResult = await this.orderService.applyCouponCode(
            ctx,
            order.id,
            coupon.promotion.couponCode,
        );
        if (isGraphQlErrorResult(applyResult)) throw new UserInputError(applyResult.message);
        const pricedOrder = await this.loadOrder(ctx, order.id);
        await this.upsertAllocation(ctx, coupon, pricedOrder, 'LOCKED');
        if (!alreadyLockedToThisOrder) {
            await this.addLedger(ctx, coupon, 'LOCKED', {
                actorType: 'CUSTOMER',
                orderId: order.id,
                note: '优惠券已锁定到购物车订单',
            });
        }
        return this.toCustomerCouponView(coupon);
    }

    async remove(ctx: RequestContext, customerCouponId: ID): Promise<StoreCustomerCouponView> {
        const customer = await this.activeCustomerOrThrow(ctx);
        await this.lockRow(ctx, CustomerCoupon, customerCouponId);
        const coupon = await this.ownedCouponOrThrow(ctx, customerCouponId, customer.id);
        if (coupon.status !== 'LOCKED' || coupon.lockedOrderId == null) {
            return this.toCustomerCouponView(coupon);
        }
        const order = await this.orderService.findOne(ctx, coupon.lockedOrderId, ['lines', 'shippingLines']);
        await this.releaseLockedCoupon(ctx, coupon, order ?? null, '客户在购物车取消使用优惠券');
        return this.toCustomerCouponView(coupon);
    }

    async revoke(ctx: RequestContext, customerCouponId: ID, reason?: string | null) {
        await this.lockRow(ctx, CustomerCoupon, customerCouponId);
        const coupon = await this.connection.getRepository(ctx, CustomerCoupon).findOne({
            where: { id: customerCouponId, channelId: ctx.channelId },
            relations: { promotion: true, campaignConfig: true },
        });
        if (!coupon) throw new UserInputError('找不到优惠券');
        if (coupon.status === 'USED' || coupon.status === 'EXPIRED' || coupon.status === 'REVOKED') {
            throw new UserInputError('当前状态的优惠券不能撤销');
        }
        await this.revokeCoupon(ctx, coupon, reason?.trim() || '管理员撤销优惠券');
        return this.toCustomerCouponView(coupon);
    }

    async revokeCampaignOutstanding(
        ctx: RequestContext,
        campaignId: ID,
        reason?: string | null,
    ): Promise<StoreCouponCampaignActionResult> {
        const promotion = await this.promotionService.findOne(ctx, campaignId);
        if (!promotion?.couponCode) throw new UserInputError('找不到该优惠券活动');
        const config = await this.configForPromotion(ctx, promotion);
        const now = new Date();
        if (!config.claimEndsAt || config.claimEndsAt > now) {
            config.claimEndsAt = now;
            await this.connection
                .getRepository(ctx, StoreCouponCampaignConfig)
                .save(config, { reload: false });
        }

        const repository = this.connection.getRepository(ctx, CustomerCoupon);
        let affectedCount = 0;
        while (true) {
            const coupons = await repository.find({
                where: {
                    channelId: ctx.channelId,
                    promotionId: campaignId,
                    status: In(['AVAILABLE', 'RETURNED', 'LOCKED']),
                },
                relations: { promotion: true, campaignConfig: true },
                order: { id: 'ASC' },
                take: 100,
            });
            if (!coupons.length) break;
            for (const coupon of coupons) {
                await this.revokeCoupon(ctx, coupon, reason?.trim() || '管理员批量作废活动中的未使用优惠券');
                affectedCount++;
            }
        }
        return { campaignId, affectedCount };
    }

    private async revokeCoupon(ctx: RequestContext, coupon: CustomerCoupon, note: string) {
        if (coupon.status === 'LOCKED' && coupon.lockedOrderId != null) {
            const order = await this.orderService.findOne(ctx, coupon.lockedOrderId, [
                'lines',
                'shippingLines',
            ]);
            if (order) await this.orderService.removeCouponCode(ctx, order.id, coupon.promotion.couponCode);
        }
        coupon.status = 'REVOKED';
        coupon.revokedAt = new Date();
        coupon.lockedAt = null;
        coupon.lockExpiresAt = null;
        coupon.lockedOrderId = null;
        await this.connection.getRepository(ctx, CustomerCoupon).save(coupon, { reload: false });
        await this.addLedger(ctx, coupon, 'REVOKED', {
            actorType: 'ADMIN',
            note,
        });
    }

    async findLedger(
        ctx: RequestContext,
        options: StoreCouponLedgerListOptions = {},
    ): Promise<StoreCouponLedgerEntryList> {
        const skip = boundedInteger(options.skip, 0, 0, 100_000);
        const take = boundedInteger(options.take, 50, 1, 200);
        if (options.eventType && !couponLedgerEventTypes.includes(options.eventType)) {
            throw new UserInputError('优惠券流水类型无效');
        }
        const [items, totalItems] = await this.connection.getRepository(ctx, CouponLedgerEntry).findAndCount({
            where: {
                channelId: ctx.channelId,
                ...(options.campaignId ? { promotionId: options.campaignId } : {}),
                ...(options.customerId ? { customerId: options.customerId } : {}),
                ...(options.orderId ? { orderId: options.orderId } : {}),
                ...(options.eventType ? { eventType: options.eventType } : {}),
            },
            relations: { customerCoupon: true, customer: true, order: true, refund: true },
            order: { createdAt: 'DESC' },
            skip,
            take,
        });
        return { items: items.map(item => this.toLedgerView(item)), totalItems };
    }

    async findOrderAllocations(ctx: RequestContext, orderId: ID): Promise<StoreCouponOrderAllocationView[]> {
        const allocations = await this.connection.getRepository(ctx, CouponOrderAllocation).find({
            where: { channelId: ctx.channelId, orderId },
            order: { createdAt: 'ASC' },
        });
        return allocations.map(allocation => ({
            id: allocation.id,
            customerCouponId: allocation.customerCouponId,
            campaignId: allocation.promotionId,
            campaignName: allocation.campaignName,
            status: allocation.status,
            currencyCode: allocation.currencyCode,
            discountAmount: allocation.discountAmount,
            discountAmountWithTax: allocation.discountAmountWithTax,
            refundedAmount: allocation.refundedAmount,
            appliedAt: allocation.appliedAt,
            usedAt: allocation.usedAt,
            releasedAt: allocation.releasedAt,
            refundedAt: allocation.refundedAt,
            refundId: allocation.refundId,
        }));
    }

    async reconcile(): Promise<{ expired: number; released: number }> {
        const now = new Date();
        const coupons = await this.connection.rawConnection.getRepository(CustomerCoupon).find({
            where: [
                { status: In(['AVAILABLE', 'RETURNED']), validUntil: LessThanOrEqual(now) },
                { status: 'LOCKED', lockExpiresAt: LessThanOrEqual(now) },
            ],
            relations: { channel: true, promotion: true, campaignConfig: true, lockedOrder: true },
            take: 500,
        });
        let expired = 0;
        let released = 0;
        for (const coupon of coupons) {
            const ctx = await this.requestContextService.create({
                apiType: 'admin',
                channelOrToken: coupon.channel,
            });
            await this.connection.withTransaction(ctx, async txCtx => {
                const fresh = await this.connection.getRepository(txCtx, CustomerCoupon).findOne({
                    where: { id: coupon.id },
                    relations: { promotion: true, campaignConfig: true },
                });
                if (!fresh) return;
                if (fresh.status === 'LOCKED' && fresh.lockExpiresAt && fresh.lockExpiresAt <= now) {
                    const order = fresh.lockedOrderId
                        ? await this.orderService.findOne(txCtx, fresh.lockedOrderId, [
                              'lines',
                              'shippingLines',
                          ])
                        : undefined;
                    await this.releaseLockedCoupon(txCtx, fresh, order ?? null, '购物车锁定超时自动释放');
                    released++;
                }
                if (this.isExpired(fresh, now) && fresh.status !== 'USED' && fresh.status !== 'REVOKED') {
                    await this.expireCoupon(txCtx, fresh, '优惠券到期自动失效');
                    expired++;
                }
            });
        }
        return { expired, released };
    }

    private async backfillLegacyCouponEntitlements(): Promise<void> {
        const repository = this.connection.rawConnection.getRepository(Promotion);
        const promotions = await repository.find({
            where: { couponCode: Like('CPN_%'), deletedAt: IsNull() },
            take: 10_000,
        });
        for (const promotion of promotions) {
            if (
                !/^CPN_[A-F0-9]{32}$/u.test(promotion.couponCode ?? '') ||
                !promotion.actions.some(action => couponKindForAction(action.code)) ||
                promotion.conditions.some(condition => condition.code === 'store_customer_coupon_entitlement')
            ) {
                continue;
            }
            await repository.update(
                { id: promotion.id },
                {
                    conditions: [
                        { code: 'store_customer_coupon_entitlement', args: [] },
                        ...promotion.conditions,
                    ],
                },
            );
        }
    }

    private async issueCoupon(
        ctx: RequestContext,
        campaignId: ID,
        customer: Customer,
        grantedByAdmin: boolean,
    ): Promise<StoreCustomerCouponView> {
        const promotion = await this.promotionService.findOne(ctx, campaignId);
        if (!promotion?.couponCode || !promotion.enabled)
            throw new UserInputError('优惠券活动不存在或已停用');
        const config = await this.configForPromotion(ctx, promotion);
        await this.lockRow(ctx, StoreCouponCampaignConfig, config.id);
        const now = new Date();
        if (promotion.endsAt && promotion.endsAt <= now) throw new UserInputError('优惠券活动已结束');
        if (config.claimStartsAt && config.claimStartsAt > now)
            throw new UserInputError('优惠券尚未开始领取');
        if (config.claimEndsAt && config.claimEndsAt <= now) throw new UserInputError('优惠券领取已结束');

        const repository = this.connection.getRepository(ctx, CustomerCoupon);
        const [issuedCount, customerClaimedCount] = await Promise.all([
            repository.count({ where: { channelId: ctx.channelId, promotionId: promotion.id } }),
            repository.count({
                where: { channelId: ctx.channelId, promotionId: promotion.id, customerId: customer.id },
            }),
        ]);
        if (config.issueLimit != null && issuedCount >= config.issueLimit) {
            throw new UserInputError('优惠券已领完');
        }
        if (!grantedByAdmin && customerClaimedCount > 0) {
            throw new UserInputError('该优惠券已经领取');
        }

        const rule = couponRuleSnapshot(promotion);
        if (!rule) throw new UserInputError('优惠券规则无法识别');
        const validFrom = promotion.startsAt && promotion.startsAt > now ? promotion.startsAt : now;
        const relativeEnd = config.validityDays
            ? new Date(now.getTime() + config.validityDays * 24 * 60 * 60_000)
            : null;
        const validUntil = earliestDate(relativeEnd, promotion.endsAt);
        if (validUntil && validFrom >= validUntil) throw new UserInputError('优惠券领取后已经没有可用时间');
        const coupon = await repository.save(
            new CustomerCoupon({
                channelId: ctx.channelId,
                campaignConfigId: config.id,
                promotionId: promotion.id,
                customerId: customer.id,
                status: 'AVAILABLE',
                campaignName: promotion.name,
                campaignKind: rule.kind,
                minimumSpend: rule.minimumSpend,
                discountAmount: rule.discountAmount,
                discountRate: rule.discountRate,
                claimedAt: now,
                validFrom,
                validUntil,
                lockedAt: null,
                lockExpiresAt: null,
                lockedOrderId: null,
                usedAt: null,
                usedOrderId: null,
                returnedAt: null,
                expiredAt: null,
                revokedAt: null,
                returnCount: 0,
            }),
        );
        coupon.campaignConfig = config;
        coupon.promotion = promotion;
        await this.addLedger(ctx, coupon, 'CLAIMED', {
            actorType: grantedByAdmin ? 'ADMIN' : 'CUSTOMER',
            idempotencyKey: `CLAIMED:${coupon.id}`,
            note: grantedByAdmin ? '管理员发放优惠券' : '客户领取优惠券',
        });
        return this.toCustomerCouponView(coupon);
    }

    private async redeemForPaidOrder(ctx: RequestContext, orderId: ID): Promise<void> {
        const repository = this.connection.getRepository(ctx, CustomerCoupon);
        const coupons = await repository.find({
            where: { channelId: ctx.channelId, lockedOrderId: orderId, status: 'LOCKED' },
            relations: { promotion: true, campaignConfig: true },
        });
        if (!coupons.length) return;
        const order = await this.loadOrder(ctx, orderId);
        for (const coupon of coupons) {
            const discount = discountSnapshot(order, coupon.promotionId);
            if (discount.amountWithTax <= 0) {
                await this.releaseLockedCoupon(ctx, coupon, null, '订单未产生实际优惠，自动释放优惠券');
                continue;
            }
            const usedAt = new Date();
            const transition = await repository.update(
                {
                    id: coupon.id,
                    channelId: ctx.channelId,
                    status: 'LOCKED',
                    lockedOrderId: order.id,
                },
                {
                    status: 'USED',
                    usedAt,
                    usedOrderId: order.id,
                    lockExpiresAt: null,
                },
            );
            if (transition.affected !== 1) continue;
            coupon.status = 'USED';
            coupon.usedAt = usedAt;
            coupon.usedOrderId = order.id;
            coupon.lockExpiresAt = null;
            await this.upsertAllocation(ctx, coupon, order, 'USED');
            await this.addLedger(ctx, coupon, 'REDEEMED', {
                actorType: 'SYSTEM',
                orderId: order.id,
                discountAmount: discount.amountWithTax,
                idempotencyKey: `REDEEMED:${coupon.id}:${order.id}`,
                note: '订单支付成功，优惠券完成核销',
            });
        }
    }

    private async handleCancelledOrder(ctx: RequestContext, orderId: ID): Promise<void> {
        const coupons = await this.connection.getRepository(ctx, CustomerCoupon).find({
            where: [
                { channelId: ctx.channelId, lockedOrderId: orderId, status: 'LOCKED' },
                { channelId: ctx.channelId, usedOrderId: orderId, status: 'USED' },
            ],
            relations: { promotion: true, campaignConfig: true },
        });
        for (const coupon of coupons) {
            if (coupon.status === 'LOCKED') {
                await this.releaseLockedCoupon(ctx, coupon, null, '订单取消，释放未核销优惠券');
                continue;
            }
            if (coupon.campaignConfig.returnOnCancellation) {
                await this.returnCoupon(ctx, coupon, {
                    orderId,
                    key: `RETURNED:CANCELLED:${coupon.id}:${orderId}`,
                    note: '订单取消，优惠券已返还',
                });
                const allocation = await this.allocationFor(ctx, coupon.id, orderId);
                if (allocation) {
                    allocation.status = 'REFUNDED';
                    allocation.refundedAt = new Date();
                    await this.connection.getRepository(ctx, CouponOrderAllocation).save(allocation, {
                        reload: false,
                    });
                }
            }
        }
    }

    private async handleSettledRefund(ctx: RequestContext, orderId: ID, refundId: ID): Promise<void> {
        const order = await this.loadOrder(ctx, orderId);
        const settledRefundTotal = (order.payments ?? [])
            .flatMap(payment => payment.refunds ?? [])
            .filter(refund => refund.state === 'Settled')
            .reduce((total, refund) => total + refund.total, 0);
        const fullRefund = settledRefundTotal >= order.totalWithTax;
        const allocations = await this.connection.getRepository(ctx, CouponOrderAllocation).find({
            where: { channelId: ctx.channelId, orderId, status: In(['USED', 'REFUNDED']) },
        });
        for (const allocation of allocations) {
            const coupon = await this.connection.getRepository(ctx, CustomerCoupon).findOne({
                where: { id: allocation.customerCouponId },
                relations: { promotion: true, campaignConfig: true },
            });
            if (!coupon) continue;
            const previousRefundedAmount = allocation.refundedAmount;
            allocation.refundId = refundId;
            allocation.refundedAmount = Math.round(
                allocation.discountAmountWithTax *
                    Math.min(1, settledRefundTotal / Math.max(1, order.totalWithTax)),
            );
            if (fullRefund) {
                allocation.status = 'REFUNDED';
                allocation.refundedAt = new Date();
            }
            await this.connection
                .getRepository(ctx, CouponOrderAllocation)
                .save(allocation, { reload: false });
            await this.addLedger(ctx, coupon, 'REFUND_SETTLED', {
                actorType: 'SYSTEM',
                orderId,
                refundId,
                discountAmount: Math.max(0, allocation.refundedAmount - previousRefundedAmount),
                idempotencyKey: `REFUND_SETTLED:${coupon.id}:${refundId}`,
                note: fullRefund ? '订单已完成全额退款' : '订单已完成部分退款，优惠券保持已使用',
            });
            if (fullRefund && coupon.status === 'USED' && coupon.campaignConfig.returnOnFullRefund) {
                await this.returnCoupon(ctx, coupon, {
                    orderId,
                    refundId,
                    key: `RETURNED:REFUND:${coupon.id}:${refundId}`,
                    note: '订单全额退款成功，优惠券已返还',
                });
            }
        }
    }

    private async returnCoupon(
        ctx: RequestContext,
        coupon: CustomerCoupon,
        input: { orderId: ID; refundId?: ID; key: string; note: string },
    ) {
        if (this.isExpired(coupon, new Date())) {
            await this.expireCoupon(ctx, coupon, `${input.note}，但原有效期已结束`);
            return;
        }
        coupon.status = 'RETURNED';
        coupon.returnedAt = new Date();
        coupon.returnCount += 1;
        coupon.lockedAt = null;
        coupon.lockExpiresAt = null;
        coupon.lockedOrderId = null;
        await this.connection.getRepository(ctx, CustomerCoupon).save(coupon, { reload: false });
        await this.addLedger(ctx, coupon, 'RETURNED', {
            actorType: 'SYSTEM',
            orderId: input.orderId,
            refundId: input.refundId,
            idempotencyKey: input.key,
            note: input.note,
        });
    }

    private async releaseLockedCoupon(
        ctx: RequestContext,
        coupon: CustomerCoupon,
        order: Order | null,
        note: string,
    ) {
        const orderId = coupon.lockedOrderId;
        if (orderId == null) return;
        const nextStatus = coupon.returnedAt ? 'RETURNED' : 'AVAILABLE';
        const transition = await this.connection.getRepository(ctx, CustomerCoupon).update(
            {
                id: coupon.id,
                channelId: ctx.channelId,
                status: 'LOCKED',
                lockedOrderId: orderId,
            },
            {
                status: nextStatus,
                lockedAt: null,
                lockExpiresAt: null,
                lockedOrderId: null,
            },
        );
        if (transition.affected !== 1) return;
        if (order && coupon.promotion?.couponCode) {
            await this.orderService.removeCouponCode(ctx, order.id, coupon.promotion.couponCode);
        }
        coupon.status = nextStatus;
        coupon.lockedAt = null;
        coupon.lockExpiresAt = null;
        coupon.lockedOrderId = null;
        const allocation = await this.allocationFor(ctx, coupon.id, orderId);
        if (allocation && allocation.status === 'LOCKED') {
            allocation.status = 'RELEASED';
            allocation.releasedAt = new Date();
            await this.connection.getRepository(ctx, CouponOrderAllocation).save(allocation, {
                reload: false,
            });
        }
        await this.addLedger(ctx, coupon, 'RELEASED', {
            actorType: 'SYSTEM',
            orderId,
            note,
        });
    }

    private async expireCoupon(ctx: RequestContext, coupon: CustomerCoupon, note: string) {
        if (coupon.status === 'EXPIRED') return;
        coupon.status = 'EXPIRED';
        coupon.expiredAt = new Date();
        coupon.lockedAt = null;
        coupon.lockExpiresAt = null;
        coupon.lockedOrderId = null;
        await this.connection.getRepository(ctx, CustomerCoupon).save(coupon, { reload: false });
        await this.addLedger(ctx, coupon, 'EXPIRED', {
            actorType: 'SYSTEM',
            idempotencyKey: `EXPIRED:${coupon.id}`,
            note,
        });
    }

    private async reconcileCustomer(ctx: RequestContext, customerId: ID) {
        const now = new Date();
        const coupons = await this.connection.getRepository(ctx, CustomerCoupon).find({
            where: {
                channelId: ctx.channelId,
                customerId,
                status: In(['AVAILABLE', 'RETURNED']),
                validUntil: LessThanOrEqual(now),
            },
            relations: { promotion: true, campaignConfig: true },
        });
        for (const coupon of coupons) await this.expireCoupon(ctx, coupon, '优惠券到期自动失效');
    }

    private async configForPromotion(ctx: RequestContext, promotion: Promotion) {
        let config = await this.connection.getRepository(ctx, StoreCouponCampaignConfig).findOne({
            where: { channelId: ctx.channelId, promotionId: promotion.id },
        });
        if (!config) {
            config = await this.connection.getRepository(ctx, StoreCouponCampaignConfig).save(
                new StoreCouponCampaignConfig({
                    channelId: ctx.channelId,
                    promotionId: promotion.id,
                    claimStartsAt: promotion.startsAt,
                    claimEndsAt: promotion.endsAt,
                    validityDays: null,
                    issueLimit: promotion.usageLimit,
                    perCustomerClaimLimit: 1,
                    stackPolicy: 'EXCLUSIVE',
                    returnOnCancellation: true,
                    returnOnFullRefund: true,
                }),
            );
        }
        return config;
    }

    private async ownedCouponOrThrow(ctx: RequestContext, id: ID, customerId: ID) {
        const coupon = await this.connection.getRepository(ctx, CustomerCoupon).findOne({
            where: { id, channelId: ctx.channelId, customerId },
            relations: { promotion: true, campaignConfig: true },
        });
        if (!coupon) throw new UserInputError('优惠券不存在或不属于当前客户');
        return coupon;
    }

    private async upsertAllocation(
        ctx: RequestContext,
        coupon: CustomerCoupon,
        order: Order,
        status: 'LOCKED' | 'USED',
    ) {
        const repository = this.connection.getRepository(ctx, CouponOrderAllocation);
        const discount = discountSnapshot(order, coupon.promotionId);
        let allocation = await repository.findOne({
            where: { orderId: order.id, customerCouponId: coupon.id },
        });
        allocation ??= new CouponOrderAllocation({
            channelId: ctx.channelId,
            customerCouponId: coupon.id,
            promotionId: coupon.promotionId,
            customerId: coupon.customerId,
            orderId: order.id,
            refundId: null,
            campaignName: coupon.campaignName,
            currencyCode: order.currencyCode,
            refundedAmount: 0,
            appliedAt: new Date(),
            usedAt: null,
            releasedAt: null,
            refundedAt: null,
        });
        allocation.status = status;
        allocation.discountAmount = discount.amount;
        allocation.discountAmountWithTax = discount.amountWithTax;
        allocation.orderTotalWithTax = order.totalWithTax;
        allocation.lineAllocations = discount.lines;
        if (status === 'USED') allocation.usedAt = new Date();
        await repository.save(allocation, { reload: false });
    }

    private allocationFor(ctx: RequestContext, customerCouponId: ID, orderId: ID) {
        return this.connection.getRepository(ctx, CouponOrderAllocation).findOne({
            where: { customerCouponId, orderId },
        });
    }

    private async loadOrder(ctx: RequestContext, orderId: ID) {
        return this.connection.getEntityOrThrow(ctx, Order, orderId, {
            channelId: ctx.channelId,
            relations: ['customer', 'lines', 'shippingLines', 'promotions', 'payments', 'payments.refunds'],
        });
    }

    private async activeCustomerOrThrow(ctx: RequestContext) {
        if (!ctx.activeUserId) throw new UserInputError('请先登录后领取或使用优惠券');
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer) throw new UserInputError('找不到当前客户');
        return customer;
    }

    private async lockRow(
        ctx: RequestContext,
        entity: typeof CustomerCoupon | typeof StoreCouponCampaignConfig,
        id: ID,
    ) {
        try {
            await this.connection
                .getRepository(ctx, entity)
                .createQueryBuilder('row')
                .setLock('pessimistic_write')
                .where('row.id = :id', { id })
                .getOne();
        } catch (error) {
            if (!isLockNotSupportedError(error)) throw error;
        }
    }

    private isExpired(coupon: CustomerCoupon, now: Date) {
        return Boolean(coupon.validUntil && coupon.validUntil <= now);
    }

    private unusableMessage(coupon: CustomerCoupon) {
        if (coupon.status === 'LOCKED') return '优惠券正在其他订单中使用';
        if (coupon.status === 'USED') return '优惠券已使用';
        if (coupon.status === 'EXPIRED') return '优惠券已过期';
        if (coupon.status === 'REVOKED') return '优惠券已被撤销';
        return '优惠券当前不可用';
    }

    private toCustomerCouponView(coupon: CustomerCoupon): StoreCustomerCouponView {
        return {
            id: coupon.id,
            campaignId: coupon.promotionId,
            campaignName: coupon.campaignName,
            campaignKind: coupon.campaignKind,
            status: coupon.status,
            minimumSpend: coupon.minimumSpend,
            discountAmount: coupon.discountAmount,
            discountRate: coupon.discountRate,
            claimedAt: coupon.claimedAt,
            validFrom: coupon.validFrom,
            validUntil: coupon.validUntil,
            lockedAt: coupon.lockedAt,
            usedAt: coupon.usedAt,
            returnedAt: coupon.returnedAt,
            expiredAt: coupon.expiredAt,
            lockedOrderId: coupon.lockedOrderId,
            usedOrderId: coupon.usedOrderId,
            returnCount: coupon.returnCount,
            usable:
                usableCustomerCouponStatuses.includes(coupon.status) &&
                Boolean(coupon.promotion && !coupon.promotion.deletedAt && coupon.promotion.enabled),
        };
    }

    private toLedgerView(entry: CouponLedgerEntry): StoreCouponLedgerEntryView {
        const customerName = [entry.customer.firstName, entry.customer.lastName].filter(Boolean).join(' ');
        return {
            id: entry.id,
            createdAt: entry.createdAt,
            eventType: entry.eventType,
            actorType: entry.actorType,
            campaignId: entry.promotionId,
            campaignName: entry.customerCoupon.campaignName,
            customerCouponId: entry.customerCouponId,
            customerId: entry.customerId,
            customerName: customerName || entry.customer.emailAddress,
            customerEmail: entry.customer.emailAddress,
            orderId: entry.orderId,
            orderCode: entry.order?.code ?? null,
            refundId: entry.refundId,
            discountAmount: entry.discountAmount,
            note: entry.note,
        };
    }

    private async addLedger(
        ctx: RequestContext,
        coupon: CustomerCoupon,
        eventType: CouponLedgerEventType,
        input: {
            actorType: 'CUSTOMER' | 'ADMIN' | 'SYSTEM';
            orderId?: ID | null;
            refundId?: ID | null;
            discountAmount?: number | null;
            idempotencyKey?: string | null;
            note?: string | null;
            metadata?: Record<string, unknown> | null;
        },
    ) {
        const repository = this.connection.getRepository(ctx, CouponLedgerEntry);
        if (input.idempotencyKey) {
            const existing = await repository.findOne({ where: { idempotencyKey: input.idempotencyKey } });
            if (existing) return;
        }
        try {
            await repository.save(
                new CouponLedgerEntry({
                    channelId: ctx.channelId,
                    customerCouponId: coupon.id,
                    promotionId: coupon.promotionId,
                    customerId: coupon.customerId,
                    orderId: input.orderId ?? null,
                    refundId: input.refundId ?? null,
                    eventType,
                    actorType: input.actorType,
                    idempotencyKey: input.idempotencyKey ?? null,
                    discountAmount: input.discountAmount ?? null,
                    note: input.note ?? null,
                    metadata: (input.metadata ?? null) as any,
                }),
                { reload: false },
            );
        } catch (error) {
            if (!input.idempotencyKey) throw error;
            const existing = await repository.findOne({ where: { idempotencyKey: input.idempotencyKey } });
            if (!existing) throw error;
        }
    }
}

function isLockNotSupportedError(error: unknown): boolean {
    if (error instanceof LockNotSupportedOnGivenDriverError) return true;
    if (!(error instanceof Error)) return false;
    return (
        error.name === 'LockNotSupportedOnGivenDriverError' ||
        error.message.toLowerCase().includes('locking not supported')
    );
}

function couponRuleSnapshot(promotion: Promotion) {
    const action = promotion.actions.find(candidate => couponKindForAction(candidate.code));
    const kind = action ? couponKindForAction(action.code) : null;
    if (!action || !kind) return null;
    const minimumCondition = promotion.conditions.find(
        candidate => candidate.code === 'minimum_order_amount',
    );
    const percentageOff = numberArg(action, 'discount');
    return {
        kind,
        minimumSpend: numberArg(minimumCondition, 'amount'),
        discountAmount: kind === 'ORDER_FIXED' ? numberArg(action, 'discount') : null,
        discountRate: kind === 'ORDER_FIXED' ? null : Math.round((10 - percentageOff / 10) * 100) / 100,
    } as const;
}

function couponKindForAction(code: string) {
    if (code === 'order_fixed_discount') return 'ORDER_FIXED' as const;
    if (code === 'order_percentage_discount') return 'ORDER_PERCENTAGE' as const;
    if (code === 'store_collection_percentage_discount') return 'COLLECTION_PERCENTAGE' as const;
    if (code === 'products_percentage_discount') return 'PRODUCT_PERCENTAGE' as const;
    return null;
}

function earliestDate(first: Date | null | undefined, second: Date | null | undefined): Date | null {
    if (!first) return second ?? null;
    if (!second) return first;
    return first <= second ? first : second;
}

function discountSnapshot(order: Order, promotionId: ID) {
    let amount = 0;
    let amountWithTax = 0;
    const lines: CouponLineAllocationSnapshot[] = [];
    for (const line of order.lines ?? []) {
        const matching = (line.discounts ?? []).filter(discount =>
            adjustmentBelongsToPromotion(discount.adjustmentSource, promotionId),
        );
        const lineAmount = Math.abs(matching.reduce((total, discount) => total + discount.amount, 0));
        const lineAmountWithTax = Math.abs(
            matching.reduce((total, discount) => total + discount.amountWithTax, 0),
        );
        if (lineAmount || lineAmountWithTax) {
            lines.push({
                orderLineId: String(line.id),
                quantity: line.quantity,
                amount: lineAmount,
                amountWithTax: lineAmountWithTax,
            });
            amount += lineAmount;
            amountWithTax += lineAmountWithTax;
        }
    }
    for (const line of order.shippingLines ?? []) {
        const matching = (line.discounts ?? []).filter(discount =>
            adjustmentBelongsToPromotion(discount.adjustmentSource, promotionId),
        );
        amount += Math.abs(matching.reduce((total, discount) => total + discount.amount, 0));
        amountWithTax += Math.abs(matching.reduce((total, discount) => total + discount.amountWithTax, 0));
    }
    return { amount, amountWithTax, lines };
}

function adjustmentBelongsToPromotion(source: string, promotionId: ID) {
    try {
        const [, encodedId] = source.split(':');
        const decodedId = Number.isNaN(+encodedId) ? encodedId : +encodedId;
        return idsAreEqual(decodedId, promotionId);
    } catch {
        return false;
    }
}

function boundedInteger(
    value: number | null | undefined,
    fallback: number,
    minimum: number,
    maximum: number,
) {
    if (value == null) return fallback;
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
        throw new UserInputError(`数值必须是 ${minimum} 到 ${maximum} 之间的整数`);
    }
    return value;
}
