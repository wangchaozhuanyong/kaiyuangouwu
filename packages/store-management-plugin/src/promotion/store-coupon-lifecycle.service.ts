import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { PaymentInput } from '@vendure/common/lib/generated-shop-types';
import { ID } from '@vendure/common/lib/shared-types';
import {
    CouponCodeEvent,
    CurrencyCode,
    Customer,
    CustomerService,
    EventBus,
    idsAreEqual,
    isGraphQlErrorResult,
    Order,
    OrderCalculator,
    OrderService,
    OrderStateTransitionEvent,
    Payment,
    PaymentState,
    Promotion,
    PromotionService,
    RefundStateTransitionEvent,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { StorefrontCartService } from '@vendure/storefront-cart-plugin';
import {
    In,
    IsNull,
    LessThanOrEqual,
    Like,
    LockNotSupportedOnGivenDriverError,
    MoreThan,
    Not,
} from 'typeorm';

import { CouponLedgerEntry } from '../entities/coupon-ledger-entry.entity';
import {
    CouponLineAllocationSnapshot,
    CouponOrderAllocation,
} from '../entities/coupon-order-allocation.entity';
import { CustomerCoupon } from '../entities/customer-coupon.entity';
import { StoreCouponCampaignConfig } from '../entities/store-coupon-campaign-config.entity';
import { StorefrontDataChangedEvent } from '../realtime/storefront-data-changed.event';
import { convertChannelAmount } from '../store-currency-price-selection-strategy';
import {
    StoreCouponCampaignActionResult,
    StoreCouponLedgerEntryList,
    StoreCouponLedgerEntryListOptions,
    StoreCouponLedgerEntryView,
    StoreCouponOrderAllocationView,
    StoreCouponUsageRecordView,
    StoreCustomerCouponView,
} from '../types';
import { verifyUsdtPaymentProof } from '../usdt/usdt-payment-proof';
import { USDT_TRC20_PAYMENT_METHOD_CODE } from '../usdt/usdt-payment.constants';

import {
    COUPON_LOCK_MINUTES,
    CouponLedgerEventType,
    couponLedgerEventTypes,
    customerCouponStatuses,
    usableCustomerCouponStatuses,
} from './coupon-lifecycle.constants';
import { idListArg, numberArg, stringArg } from './promotion-operation-args';
import { lockCouponCampaign } from './store-coupon-campaign-lock';

@Injectable()
export class StoreCouponLifecycleService implements OnApplicationBootstrap {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly customerService: CustomerService,
        private readonly promotionService: PromotionService,
        private readonly orderService: OrderService,
        private readonly eventBus: EventBus,
        private readonly requestContextService: RequestContextService,
        private readonly orderCalculator: OrderCalculator,
        private readonly carts?: StorefrontCartService,
    ) {}

    async onApplicationBootstrap(): Promise<void> {
        this.orderService.registerCheckoutValidator(
            'store-coupon-entitlements',
            (ctx, order, input, source) => this.validateBeforePayment(ctx, order.id, input, source),
        );
        this.orderService.registerPaymentConfirmationValidator(
            'store-coupon-entitlements',
            (ctx, order, payment, state, source) =>
                this.validateConfirmedPayment(ctx, order.id, payment, state, source),
        );
        this.eventBus.registerBlockingEventHandler({
            event: OrderStateTransitionEvent,
            id: 'store-coupon-handle-paid-or-cancelled-order',
            handler: event => {
                if (event.toState === 'PaymentSettled') {
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
        this.eventBus.registerBlockingEventHandler({
            event: CouponCodeEvent,
            id: 'store-coupon-release-native-removal',
            handler: async event => {
                if (event.type !== 'removed') return;
                const candidates = await this.connection.getRepository(event.ctx, CustomerCoupon).find({
                    where: {
                        channelId: event.ctx.channelId,
                        lockedOrderId: event.orderId,
                        status: 'LOCKED',
                        promotion: { couponCode: event.couponCode },
                    },
                });
                for (const candidate of candidates) {
                    await this.lockRow(event.ctx, CustomerCoupon, candidate.id);
                    const fresh = await this.connection
                        .getRepository(event.ctx, CustomerCoupon)
                        .findOneByOrFail({ id: candidate.id });
                    if (fresh.status !== 'LOCKED' || !idsAreEqual(fresh.lockedOrderId, event.orderId))
                        continue;
                    if (await this.isCouponOrderPaymentPending(event.ctx, event.orderId))
                        throw new UserInputError('订单正在付款，请先取消付款后再移除优惠券');
                    // Core applies the new price after this blocking event. Do not recursively remove the code.
                    await this.releaseLockedCouponWithinCart(event.ctx, fresh, null, '客户移除订单优惠券');
                }
            },
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
        const items: StoreCustomerCouponView[] = [];
        while (true) {
            const page = await this.findMinePage(ctx, { skip: items.length, take: 200 });
            items.push(...page.items);
            if (!page.items.length || items.length >= page.totalItems) return items;
        }
    }

    async findMinePage(
        ctx: RequestContext,
        options: { skip?: number; take?: number; statuses?: string[]; usableOnly?: boolean } = {},
    ) {
        const customer = await this.activeCustomerOrThrow(ctx);
        await this.reconcileCustomer(ctx, customer.id);
        if (options.statuses?.some(status => !customerCouponStatuses.includes(status as any)))
            throw new UserInputError('优惠券状态无效');
        const now = new Date();
        const where = {
            channelId: ctx.channelId,
            customerId: customer.id,
            ...(options.statuses?.length ? { status: In(options.statuses) } : {}),
            ...(options.usableOnly
                ? {
                      status: In(
                          usableCustomerCouponStatuses.filter(
                              status => !options.statuses?.length || options.statuses.includes(status),
                          ),
                      ),
                      validFrom: LessThanOrEqual(now),
                      promotion: { enabled: true, deletedAt: IsNull() },
                      campaignConfig: { channelId: ctx.channelId },
                  }
                : {}),
        };
        const [coupons, totalItems] = await this.connection.getRepository(ctx, CustomerCoupon).findAndCount({
            where: options.usableOnly
                ? [
                      { ...where, validUntil: IsNull() },
                      { ...where, validUntil: MoreThan(now) },
                  ]
                : where,
            relations: { promotion: true, campaignConfig: true },
            order: { claimedAt: 'DESC', id: 'DESC' },
            skip: boundedInteger(options.skip, 0, 0, Number.MAX_SAFE_INTEGER),
            take: boundedInteger(options.take, 50, 1, 200),
        });
        return { items: coupons.map(coupon => this.toCustomerCouponView(ctx, coupon)), totalItems };
    }

    async findMyUsageRecords(ctx: RequestContext): Promise<StoreCouponUsageRecordView[]> {
        const items: StoreCouponUsageRecordView[] = [];
        while (true) {
            const page = await this.findMyUsageRecordsPage(ctx, { skip: items.length, take: 200 });
            items.push(...page.items);
            if (!page.items.length || items.length >= page.totalItems) return items;
        }
    }

    async findMyUsageRecordsPage(
        ctx: RequestContext,
        options: { skip?: number; take?: number; statuses?: string[] } = {},
    ) {
        if (options.statuses?.some(status => !['USED', 'REFUNDED'].includes(status)))
            throw new UserInputError('用券记录状态无效');
        const customer = await this.activeCustomerOrThrow(ctx);
        const [allocations, totalItems] = await this.connection
            .getRepository(ctx, CouponOrderAllocation)
            .findAndCount({
                where: {
                    channelId: ctx.channelId,
                    customerId: customer.id,
                    status: In(options.statuses?.length ? options.statuses : ['USED', 'REFUNDED']),
                    usedAt: Not(IsNull()),
                },
                relations: { customerCoupon: true, order: true },
                order: { usedAt: 'DESC', id: 'DESC' },
                skip: boundedInteger(options.skip, 0, 0, Number.MAX_SAFE_INTEGER),
                take: boundedInteger(options.take, 50, 1, 200),
            });
        const items = allocations.flatMap(allocation => {
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
                    minimumSpend:
                        convertChannelAmount(
                            ctx,
                            allocation.customerCoupon.minimumSpend,
                            allocation.customerCoupon.currencyCode,
                            allocation.currencyCode,
                        ) ?? 0,
                    discountAmount:
                        allocation.customerCoupon.discountAmount == null
                            ? null
                            : convertChannelAmount(
                                  ctx,
                                  allocation.customerCoupon.discountAmount,
                                  allocation.customerCoupon.currencyCode,
                                  allocation.currencyCode,
                              ),
                    discountRate: allocation.customerCoupon.discountRate,
                    savedAmount: allocation.discountAmountWithTax,
                    usedAt: allocation.usedAt,
                    refundedAt: allocation.refundedAt,
                    orderId: allocation.orderId,
                    orderCode: allocation.order.code,
                },
            ];
        });
        return { items, totalItems };
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
        const replacing = otherLocked.filter(
            existing =>
                idsAreEqual(existing.promotionId, coupon.promotionId) ||
                coupon.campaignConfig.stackPolicy === 'EXCLUSIVE' ||
                existing.campaignConfig.stackPolicy === 'EXCLUSIVE',
        );
        const removedCodes = new Set(
            [coupon.promotion.couponCode, ...replacing.map(existing => existing.promotion.couponCode)]
                .filter((code): code is string => Boolean(code))
                .map(code => code.toLocaleLowerCase()),
        );
        const baseCodes = (order.couponCodes ?? []).filter(
            code => !removedCodes.has(code.toLocaleLowerCase()),
        );
        const validation = await this.promotionService.validateCouponCode(
            ctx,
            coupon.promotion.couponCode,
            customer.id,
            order.id,
        );
        if (isGraphQlErrorResult(validation)) throw new UserInputError(validation.message);
        const activePromotions = await this.promotionService.getActivePromotionsInChannel(ctx);
        const promotion = activePromotions.find(candidate => idsAreEqual(candidate.id, coupon.promotionId));
        if (
            !promotion ||
            (await this.estimateCouponSavings(ctx, order.id, promotion, activePromotions, baseCodes)) <= 0
        ) {
            throw new UserInputError('该优惠券不适用于当前购物车，请检查使用门槛及适用商品');
        }

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
        // A raw code may already be on the order without an entitlement. Vendure's
        // applyCouponCode is then a no-op; reprice after acquiring this coupon.
        if (
            order.couponCodes?.some(
                code => code.toLocaleLowerCase() === coupon.promotion.couponCode?.toLocaleLowerCase(),
            )
        ) {
            await this.orderService.applyPriceAdjustments(ctx, applyResult);
        }
        const pricedOrder = await this.loadOrder(ctx, order.id);
        if (discountSnapshot(pricedOrder, coupon.promotionId).amountWithTax <= 0) {
            throw new UserInputError('该优惠券未产生实际优惠，已保留原优惠券，请重新选择');
        }
        await this.upsertAllocation(ctx, coupon, pricedOrder, 'LOCKED');
        if (!alreadyLockedToThisOrder) {
            await this.addLedger(ctx, coupon, 'LOCKED', {
                actorType: 'CUSTOMER',
                orderId: order.id,
                note: '优惠券已锁定到购物车订单',
            });
        }
        await this.publishCustomerCouponChanged(ctx, customer);
        return this.toCustomerCouponView(ctx, coupon);
    }

    async applyBest(ctx: RequestContext): Promise<StoreCustomerCouponView | null> {
        const customer = await this.activeCustomerOrThrow(ctx);
        if (!ctx.activeUserId) throw new UserInputError('请先登录后使用优惠券');
        const order = await this.orderService.getActiveOrderForUser(ctx, ctx.activeUserId);
        if (!order || !order.lines?.length) return null;

        await this.reconcileCustomer(ctx, customer.id);
        const selected = await this.connection.getRepository(ctx, CustomerCoupon).findOne({
            where: {
                channelId: ctx.channelId,
                customerId: customer.id,
                lockedOrderId: order.id,
                status: 'LOCKED',
            },
            relations: { promotion: true, campaignConfig: true },
            order: { id: 'ASC' },
        });
        if (selected) return this.toCustomerCouponView(ctx, selected);
        const now = new Date();
        const allPromotions = await this.promotionService.getActivePromotionsInChannel(ctx);
        const exhaustedPromotionIds = await this.promotionService.getExhaustedPromotionIds(
            ctx,
            allPromotions,
            customer.id,
        );
        const activePromotions = allPromotions.filter(
            promotion => !exhaustedPromotionIds.has(promotion.id.toString()),
        );
        const ownedCouponCodes = new Set(
            allPromotions
                .filter(promotion =>
                    promotion.conditions.some(
                        condition => condition.code === 'store_customer_coupon_entitlement',
                    ),
                )
                .map(promotion => promotion.couponCode?.toLocaleLowerCase())
                .filter((couponCode): couponCode is string => Boolean(couponCode)),
        );
        const baseCouponCodes = (order.couponCodes ?? []).filter(
            couponCode => !ownedCouponCodes.has(couponCode.toLocaleLowerCase()),
        );
        let best: CouponSavingsEstimate | undefined;
        let cursor: ID | undefined;
        while (true) {
            const where = {
                channelId: ctx.channelId,
                customerId: customer.id,
                status: In(usableCustomerCouponStatuses),
                validFrom: LessThanOrEqual(now),
                promotion: { enabled: true, deletedAt: IsNull() },
                campaignConfig: { channelId: ctx.channelId },
                ...(cursor == null ? {} : { id: MoreThan(cursor) }),
            };
            const candidates = await this.connection.getRepository(ctx, CustomerCoupon).find({
                where: [
                    { ...where, validUntil: IsNull() },
                    { ...where, validUntil: MoreThan(now) },
                ],
                relations: { promotion: true, campaignConfig: true },
                order: { id: 'ASC' },
                take: 100,
            });
            if (!candidates.length) break;
            for (const coupon of candidates) {
                cursor = coupon.id;
                const promotion = activePromotions.find(active => idsAreEqual(active.id, coupon.promotionId));
                if (!promotion?.couponCode) continue;
                const validation = await this.promotionService.validateCouponCode(
                    ctx,
                    promotion.couponCode,
                    customer.id,
                    order.id,
                );
                if (isGraphQlErrorResult(validation)) continue;
                const amountWithTax = await this.estimateCouponSavings(
                    ctx,
                    order.id,
                    promotion,
                    activePromotions,
                    baseCouponCodes,
                );
                if (amountWithTax > 0) {
                    const estimate = { coupon, amountWithTax };
                    if (!best || compareCouponSavings(estimate, best) < 0) best = estimate;
                }
            }
        }

        return best ? this.apply(ctx, best.coupon.id) : null;
    }

    async remove(ctx: RequestContext, customerCouponId: ID): Promise<StoreCustomerCouponView> {
        const customer = await this.activeCustomerOrThrow(ctx);
        await this.lockRow(ctx, CustomerCoupon, customerCouponId);
        const coupon = await this.ownedCouponOrThrow(ctx, customerCouponId, customer.id);
        if (coupon.status !== 'LOCKED' || coupon.lockedOrderId == null) {
            return this.toCustomerCouponView(ctx, coupon);
        }
        const order = await this.orderService.findOne(ctx, coupon.lockedOrderId, ['lines', 'shippingLines']);
        await this.releaseLockedCoupon(ctx, coupon, order ?? null, '客户在购物车取消使用优惠券');
        await this.publishCustomerCouponChanged(ctx, customer);
        return this.toCustomerCouponView(ctx, coupon);
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
        const outcome = await this.revokeCoupon(ctx, coupon, reason?.trim() || '管理员撤销优惠券');
        if (!outcome.applied) throw new UserInputError(outcome.reason);
        const customer = await this.customerService.findOne(ctx, coupon.customerId);
        if (customer) await this.publishCustomerCouponChanged(ctx, customer);
        return this.toCustomerCouponView(ctx, coupon);
    }

    async revokeCampaignOutstanding(
        ctx: RequestContext,
        campaignId: ID,
        reason?: string | null,
    ): Promise<StoreCouponCampaignActionResult> {
        await this.inTransaction(ctx, async txCtx => {
            const promotion = await this.promotionService.findOne(txCtx, campaignId);
            if (!promotion?.couponCode) throw new UserInputError('找不到该优惠券活动');
            const config = await lockCouponCampaign(
                this.connection,
                txCtx,
                await this.configForPromotion(txCtx, promotion),
            );
            const now = new Date(Math.floor(Date.now() / 1000) * 1000);
            if (!config.claimEndsAt || config.claimEndsAt > now) {
                await this.connection
                    .getRepository(txCtx, StoreCouponCampaignConfig)
                    .update(config.id, { claimEndsAt: now });
            }
        });
        let affectedCount = 0;
        let skippedCount = 0;
        let failedCount = 0;
        const outcomes: Array<{ couponId: ID; status: string; reason: string }> = [];
        let cursor: ID | undefined;
        while (true) {
            const coupons = await this.connection.getRepository(ctx, CustomerCoupon).find({
                where: {
                    channelId: ctx.channelId,
                    promotionId: campaignId,
                    ...(cursor == null ? {} : { id: MoreThan(cursor) }),
                    status: In(['AVAILABLE', 'RETURNED', 'LOCKED']),
                },
                order: { id: 'ASC' },
                take: 100,
            });
            if (!coupons.length) break;
            for (const coupon of coupons) {
                cursor = coupon.id;
                try {
                    const result = await this.revokeCoupon(
                        ctx,
                        coupon,
                        reason?.trim() || '管理员批量作废活动中的未使用优惠券',
                    );
                    if (result.applied) affectedCount++;
                    else {
                        skippedCount++;
                        outcomes.push({ couponId: coupon.id, status: 'SKIPPED', reason: result.reason });
                    }
                } catch (error) {
                    failedCount++;
                    outcomes.push({
                        couponId: coupon.id,
                        status: 'FAILED',
                        reason: error instanceof Error ? error.message : '处理失败，请重试',
                    });
                }
            }
        }
        await this.eventBus.publish(
            new StorefrontDataChangedEvent(ctx, ['content'], {
                channelIds: [ctx.channelId],
                entityType: 'StoreCouponCampaign',
                entityIds: [campaignId],
            }),
        );
        return { campaignId, affectedCount, skippedCount, failedCount, outcomes };
    }

    private inTransaction<T>(ctx: RequestContext, work: (ctx: RequestContext) => Promise<T>): Promise<T> {
        return this.carts
            ? this.carts.withTransaction(ctx, work)
            : this.connection.withTransaction(
                  ctx,
                  work,
                  ['mysql', 'mariadb', 'postgres'].includes(this.connection.rawConnection.options.type)
                      ? 'READ COMMITTED'
                      : undefined,
              );
    }

    private async revokeCoupon(ctx: RequestContext, snapshot: CustomerCoupon, note: string) {
        return this.inTransaction(ctx, async txCtx => {
            const repository = this.connection.getRepository(txCtx, CustomerCoupon);
            const before = await repository.findOne({
                where: { id: snapshot.id, channelId: txCtx.channelId },
            });
            if (!before) return { applied: false, reason: '优惠券不存在' };
            await this.lockRow(txCtx, CustomerCoupon, before.id);
            const coupon = await repository.findOneOrFail({
                where: { id: before.id, channelId: txCtx.channelId },
                relations: { promotion: true, campaignConfig: true },
            });
            if (!idsAreEqual(coupon.campaignConfig.channelId, txCtx.channelId))
                throw new UserInputError('该优惠券属于其他店铺');
            if (String(before.lockedOrderId ?? '') !== String(coupon.lockedOrderId ?? ''))
                return { applied: false, reason: '订单占用已变化，请重试' };
            if (!['AVAILABLE', 'RETURNED', 'LOCKED'].includes(coupon.status))
                return { applied: false, reason: `优惠券当前状态为 ${coupon.status}` };
            if (coupon.lockedOrderId && (await this.isCouponOrderPaymentPending(txCtx, coupon.lockedOrderId)))
                return { applied: false, reason: '订单正在付款，暂不作废' };
            const work = async (workCtx: RequestContext) => {
                await this.terminalTransition(workCtx, coupon, 'REVOKED', note);
                Object.assign(snapshot, coupon);
                return { applied: true, reason: '' };
            };
            return coupon.lockedOrderId && this.carts
                ? this.carts.withOrderChange(txCtx, coupon.lockedOrderId, work)
                : work(txCtx);
        });
    }

    /** Caller holds cart (when present), then coupon. Keep allocation and ledger atomic. */
    private async isCouponOrderPaymentPending(ctx: RequestContext, orderId: ID): Promise<boolean> {
        if (await this.carts?.isOrderPaymentLocked(ctx, orderId)) return true;
        const order = await this.orderService.findOne(ctx, orderId, ['payments']);
        return (
            !!order &&
            (order.state === 'ArrangingPayment' ||
                order.payments.some(
                    payment =>
                        payment.state === 'Authorized' ||
                        payment.state === 'Settled' ||
                        payment.metadata?.manualReview?.required,
                ))
        );
    }

    private async terminalTransition(
        ctx: RequestContext,
        coupon: CustomerCoupon,
        status: 'EXPIRED' | 'REVOKED',
        note: string,
    ) {
        if (!['AVAILABLE', 'RETURNED', 'LOCKED'].includes(coupon.status)) return;
        const orderId = coupon.lockedOrderId;
        if (coupon.status === 'LOCKED' && orderId != null) {
            const order = await this.orderService.findOne(ctx, orderId, ['lines', 'shippingLines']);
            await this.releaseLockedCouponWithinCart(ctx, coupon, order ?? null, note);
        }
        const repository = this.connection.getRepository(ctx, CustomerCoupon);
        const current = await repository.findOneOrFail({ where: { id: coupon.id } });
        const now = new Date();
        const changes = {
            status,
            lockedAt: null,
            lockExpiresAt: null,
            lockedOrderId: null,
            ...(status === 'EXPIRED' ? { expiredAt: now } : { revokedAt: now }),
        };
        const result = await repository.update(
            { id: coupon.id, channelId: ctx.channelId, status: coupon.status, version: current.version },
            changes,
        );
        if (result.affected !== 1) throw new UserInputError('优惠券状态已变化，请重试');
        Object.assign(coupon, changes);
        await this.addLedger(ctx, coupon, status, {
            actorType: status === 'REVOKED' ? 'ADMIN' : 'SYSTEM',
            orderId: orderId ?? undefined,
            note,
            ...(status === 'EXPIRED' ? { idempotencyKey: `EXPIRED:${coupon.id}` } : {}),
        });
    }

    async findLedger(
        ctx: RequestContext,
        options: StoreCouponLedgerEntryListOptions = {},
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
            order: { createdAt: 'DESC', id: 'DESC' },
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
        let expired = 0;
        let released = 0;
        let cursor: ID | undefined;
        while (true) {
            const coupons = await this.connection.rawConnection.getRepository(CustomerCoupon).find({
                where: [
                    {
                        status: In(['AVAILABLE', 'RETURNED']),
                        validUntil: LessThanOrEqual(now),
                        ...(cursor == null ? {} : { id: MoreThan(cursor) }),
                    },
                    {
                        status: 'LOCKED',
                        lockExpiresAt: LessThanOrEqual(now),
                        ...(cursor == null ? {} : { id: MoreThan(cursor) }),
                    },
                ],
                relations: { channel: true, promotion: true, campaignConfig: true, lockedOrder: true },
                take: 500,
                order: { id: 'ASC' },
            });
            if (!coupons.length) break;
            for (const coupon of coupons) {
                cursor = coupon.id;
                const ctx = await this.requestContextService.create({
                    apiType: 'admin',
                    channelOrToken: coupon.channel,
                });
                await (
                    this.carts?.withTransaction.bind(this.carts) ??
                    this.connection.withTransaction.bind(this.connection)
                )(ctx, async txCtx => {
                    if (coupon.lockedOrderId) await this.carts?.lockForOrder(txCtx, coupon.lockedOrderId);
                    await this.connection
                        .getRepository(txCtx, CustomerCoupon)
                        .createQueryBuilder()
                        .update(CustomerCoupon)
                        .set({ updatedAt: () => 'updatedAt' })
                        .where({ id: coupon.id })
                        .execute();
                    const fresh = await this.connection.getRepository(txCtx, CustomerCoupon).findOne({
                        where: { id: coupon.id },
                        relations: { promotion: true, campaignConfig: true },
                    });
                    if (!fresh || String(fresh.lockedOrderId ?? '') !== String(coupon.lockedOrderId ?? ''))
                        return;
                    if (
                        fresh.lockedOrderId &&
                        (await this.isCouponOrderPaymentPending(txCtx, fresh.lockedOrderId))
                    )
                        return;
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
        }
        return { expired, released };
    }

    async reconcileRefundForOrder(
        ctx: RequestContext,
        orderId: ID,
        refundId: ID,
        customerCouponId?: ID,
    ): Promise<void> {
        await this.handleSettledRefund(ctx, orderId, refundId, customerCouponId);
    }

    async lockCouponForRepair(ctx: RequestContext, couponId: ID): Promise<void> {
        await this.lockRow(ctx, CustomerCoupon, couponId);
    }

    async releaseCouponForRepair(ctx: RequestContext, coupon: CustomerCoupon): Promise<void> {
        const order = coupon.lockedOrderId
            ? await this.orderService.findOne(ctx, coupon.lockedOrderId, ['lines', 'shippingLines'])
            : undefined;
        await this.releaseLockedCoupon(ctx, coupon, order ?? null, '定时核对：释放失效订单占用');
        if (this.isExpired(coupon, new Date()))
            await this.expireCoupon(ctx, coupon, '定时核对：按原到期时间失效');
    }

    private async backfillLegacyCouponEntitlements(): Promise<void> {
        const repository = this.connection.rawConnection.getRepository(Promotion);
        const promotions = await repository.find({
            where: { couponCode: Like('CPN_%'), deletedAt: IsNull() },
            take: 10_000,
        });
        for (const promotion of promotions) {
            const actions = storedPromotionOperations(promotion.actions);
            const conditions = storedPromotionOperations(promotion.conditions);
            if (
                !actions ||
                !conditions ||
                !/^CPN_[A-F0-9]{32}$/u.test(promotion.couponCode ?? '') ||
                !actions.some(action => couponKindForAction(action.code)) ||
                conditions.some(condition => condition.code === 'store_customer_coupon_entitlement')
            ) {
                continue;
            }
            await repository.update(
                { id: promotion.id },
                {
                    conditions: [{ code: 'store_customer_coupon_entitlement', args: [] }, ...conditions],
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
        let promotion = await this.promotionService.findOne(ctx, campaignId);
        if (!promotion?.couponCode || !promotion.enabled)
            throw new UserInputError('优惠券活动不存在或已停用');
        const config = await this.configForPromotion(ctx, promotion);
        const lockedConfig = await this.lockRow(ctx, StoreCouponCampaignConfig, config.id);
        if (lockedConfig) Object.assign(config, lockedConfig);
        promotion = await this.promotionService.findOne(ctx, campaignId);
        if (!promotion?.couponCode || !promotion.enabled || promotion.deletedAt)
            throw new UserInputError('优惠券活动不存在或已停用');
        const now = new Date();
        if (!config.validityDays && promotion.endsAt && promotion.endsAt <= now)
            throw new UserInputError('优惠券活动已结束');
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
        // Date columns use whole seconds on MySQL. An immediately usable coupon must not
        // round into the next second when it is saved and then immediately applied.
        const claimedAt = new Date(Math.floor(now.getTime() / 1000) * 1000);
        const validFrom =
            !config.validityDays && promotion.startsAt && promotion.startsAt > now
                ? promotion.startsAt
                : claimedAt;
        const relativeEnd = config.validityDays
            ? new Date(claimedAt.getTime() + config.validityDays * 24 * 60 * 60_000)
            : null;
        const validUntil = relativeEnd ?? promotion.endsAt;
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
                currencyCode: rule.currencyCode ?? ctx.channel.defaultCurrencyCode,
                discountAmount: rule.discountAmount,
                discountRate: rule.discountRate,
                claimedAt,
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
        await this.publishCustomerCouponChanged(ctx, customer, true, promotion.id);
        return this.toCustomerCouponView(ctx, coupon);
    }

    async publishCustomerCouponChanged(
        ctx: RequestContext,
        customer: Customer,
        publicContentChanged = false,
        campaignId?: ID,
    ): Promise<void> {
        if (publicContentChanged) {
            await this.eventBus.publish(
                new StorefrontDataChangedEvent(ctx, ['content'], {
                    channelIds: [ctx.channelId],
                    entityType: 'StoreCouponCampaign',
                    entityIds: campaignId == null ? undefined : [campaignId],
                }),
            );
        }
        if (customer.user?.id == null) return;
        await this.eventBus.publish(
            new StorefrontDataChangedEvent(ctx, ['coupons'], {
                channelIds: [ctx.channelId],
                userIds: [customer.user.id],
                entityType: 'CustomerCoupon',
            }),
        );
    }

    private async paymentCouponIssues(ctx: RequestContext, order: Order, paidAt: Date) {
        const issues: Array<{ coupon?: CustomerCoupon; code: string; reason: string }> = [];
        await this.carts?.lockForOrder(ctx, order.id);
        await this.orderService.lockOrderForRefund(ctx, order.id);
        for (const code of [...order.couponCodes].sort()) {
            const promotion = await this.connection
                .getRepository(ctx, Promotion)
                .findOne({ where: { couponCode: code } });
            if (!promotion) continue; // The native coupon validator handles ordinary or deleted promotions.
            const config = await this.connection
                .getRepository(ctx, StoreCouponCampaignConfig)
                .findOne({ where: { promotionId: promotion.id } });
            if (
                !config &&
                !promotion.conditions.some(
                    condition => condition.code === 'store_customer_coupon_entitlement',
                )
            )
                continue;
            const snapshot = await this.connection.getRepository(ctx, CustomerCoupon).findOne({
                where: { channelId: ctx.channelId, promotionId: promotion.id, lockedOrderId: order.id },
            });
            if (snapshot) await this.lockRow(ctx, CustomerCoupon, snapshot.id);
            const coupon = snapshot
                ? await this.connection.getRepository(ctx, CustomerCoupon).findOne({
                      where: { id: snapshot.id },
                      relations: { promotion: true, campaignConfig: true },
                  })
                : null;
            let reason = '';
            if (
                !config ||
                !idsAreEqual(config.channelId, ctx.channelId) ||
                !coupon ||
                !idsAreEqual(coupon.customerId, order.customerId)
            )
                reason = '优惠券归属或订单占用不一致';
            else if (coupon.status !== 'LOCKED' || !idsAreEqual(coupon.lockedOrderId, order.id))
                reason = '优惠券已失效或不再由本订单占用';
            else if (coupon.validFrom > paidAt || this.isExpired(coupon, paidAt))
                reason = '付款成功时间不在优惠券有效期内';
            else if (!promotion.enabled || promotion.deletedAt) reason = '优惠券活动已停用';
            else if (discountSnapshot(order, promotion.id).amountWithTax <= 0)
                reason = '优惠券未产生实际优惠';
            if (reason) issues.push({ coupon: coupon ?? undefined, code, reason });
        }
        return issues;
    }

    private async hasCouponEntitlements(ctx: RequestContext, order: Order): Promise<boolean> {
        for (const code of order.couponCodes) {
            const promotion = await this.connection
                .getRepository(ctx, Promotion)
                .findOne({ where: { couponCode: code } });
            if (
                promotion &&
                (promotion.conditions.some(
                    condition => condition.code === 'store_customer_coupon_entitlement',
                ) ||
                    (await this.connection
                        .getRepository(ctx, StoreCouponCampaignConfig)
                        .count({ where: { promotionId: promotion.id } })))
            )
                return true;
        }
        return false;
    }

    private async validateBeforePayment(
        ctx: RequestContext,
        orderId: ID,
        input: PaymentInput,
        source: 'handler' | 'manual' = 'handler',
    ) {
        const order = await this.loadOrder(ctx, orderId);
        if (source === 'manual')
            return { preserveReceivedQuote: await this.hasCouponEntitlements(ctx, order) };
        if (order.payments.some(payment => payment.metadata?.manualReview?.required))
            return { error: 'PAYMENT_REVIEW_REQUIRED: 该订单已有待核对收款，请勿重复付款' };
        if (!(await this.hasCouponEntitlements(ctx, order))) return {};
        const isUsdt = input.method === USDT_TRC20_PAYMENT_METHOD_CODE;
        const proof = isUsdt ? verifyUsdtPaymentProof(input.metadata?.proof) : null;
        if (
            isUsdt &&
            (!proof ||
                !proof.paidAt ||
                proof.channelId !== String(ctx.channelId) ||
                proof.orderId !== String(order.id) ||
                proof.fiatCurrencyCode !== String(order.currencyCode) ||
                proof.fiatAmount !==
                    order.totalWithTax -
                        (order.payments ?? [])
                            .filter(p => p.state === 'Settled' || p.state === 'Authorized')
                            .reduce((sum, p) => sum + p.amount, 0))
        ) {
            return { error: 'PAYMENT_REVIEW_REQUIRED: 付款时间或支付凭证无法核实，请人工核对到账记录' };
        }
        const issues = await this.paymentCouponIssues(ctx, order, new Date(proof?.paidAt ?? Date.now()));
        if (!issues.length) return {};
        // The verified transfer has already happened. Keep the accepted quote and funds evidence.
        if (
            isUsdt ||
            order.payments.some(
                payment =>
                    payment.state === 'Authorized' ||
                    payment.state === 'Settled' ||
                    payment.metadata?.manualReview?.required,
            )
        ) {
            return {
                error:
                    'PAYMENT_REVIEW_REQUIRED: ' +
                    issues.map(issue => issue.reason).join('；') +
                    '，已收款订单需人工核对',
            };
        }
        for (const issue of issues) {
            const coupon = issue.coupon;
            if (coupon?.status === 'LOCKED' && idsAreEqual(coupon.lockedOrderId, order.id)) {
                if (this.isExpired(coupon, new Date()))
                    await this.terminalTransition(ctx, coupon, 'EXPIRED', issue.reason);
                else await this.releaseLockedCouponWithinCart(ctx, coupon, order, issue.reason);
            } else {
                await this.orderService.removeCouponCode(ctx, order.id, issue.code);
            }
        }
        if (this.carts && (await this.carts.isOrderPaymentLocked(ctx, order.id))) {
            const cart = await this.carts.getCart(ctx);
            const reopened = await this.carts.reopenCart(ctx, cart.revision);
            if (isGraphQlErrorResult(reopened)) throw new UserInputError(reopened.message);
        }
        return { removedCouponCodes: issues.map(issue => issue.code) };
    }

    private async validateConfirmedPayment(
        ctx: RequestContext,
        orderId: ID,
        payment: Payment,
        state: PaymentState,
        source: 'handler' | 'manual',
    ): Promise<string | undefined> {
        const order = await this.loadOrder(ctx, orderId);
        if (!(await this.hasCouponEntitlements(ctx, order))) return;
        const isUsdt = payment.method === USDT_TRC20_PAYMENT_METHOD_CODE;
        const evidence = isUsdt ? payment.metadata?.verifiedUsdtPayment : null;
        let paidAt = new Date();
        if (isUsdt) {
            const proof = verifyUsdtPaymentProof(evidence?.proof);
            if (
                !proof ||
                proof.paidAt !== evidence?.paidAt ||
                proof.orderId !== evidence?.orderId ||
                proof.channelId !== evidence?.channelId ||
                proof.transactionId !== evidence?.transactionId ||
                proof.fiatAmount !== evidence?.fiatAmount
            )
                return '可信付款凭证校验失败，请人工核对';
            if (
                !evidence ||
                !Number.isSafeInteger(evidence.paidAt) ||
                evidence.paidAt <= 0 ||
                evidence.paidAt > Date.now() ||
                evidence.channelId !== String(ctx.channelId) ||
                evidence.orderId !== String(orderId) ||
                evidence.fiatCurrencyCode !== order.currencyCode ||
                evidence.fiatAmount !== payment.amount ||
                payment.transactionId !== `tron:${evidence.transactionId}`
            )
                return '可信付款时间或到账证据缺失，请人工核对';
            paidAt = new Date(evidence.paidAt);
        }
        if (!isUsdt && source === 'manual') return '人工登记的付款时间无法核实，请核对原始支付凭证';
        const issues = await this.paymentCouponIssues(ctx, order, paidAt);
        if (issues.length) return issues.map(issue => issue.reason).join('；') + '，已收款订单需人工核对';
        if (state === 'Settled')
            payment.metadata = {
                ...payment.metadata,
                couponPaymentValidation: {
                    paidAt: paidAt.toISOString(),
                    source: isUsdt ? 'VERIFIED_TRC20_BLOCK' : 'SERVER_HANDLER_SUCCESS',
                    orderId: String(orderId),
                    channelId: String(ctx.channelId),
                    transactionId: payment.transactionId,
                },
            };
    }

    private async redeemForPaidOrder(ctx: RequestContext, orderId: ID): Promise<void> {
        const repository = this.connection.getRepository(ctx, CustomerCoupon);
        const coupons = await repository.find({
            where: { channelId: ctx.channelId, lockedOrderId: orderId, status: 'LOCKED' },
            relations: { promotion: true, campaignConfig: true },
        });
        if (!coupons.length) return;
        const order = await this.loadOrder(ctx, orderId);
        const settledPayments = order.payments.filter(payment => payment.state === 'Settled');
        const times = settledPayments.map(payment =>
            Date.parse(payment.metadata?.couponPaymentValidation?.paidAt ?? ''),
        );
        if (!times.length || times.some(time => !Number.isFinite(time))) return;
        const paidAt = new Date(Math.max(...times));
        for (const candidate of coupons) {
            await this.lockRow(ctx, CustomerCoupon, candidate.id);
            const coupon = await repository.findOneOrFail({
                where: { id: candidate.id, channelId: ctx.channelId },
                relations: { promotion: true, campaignConfig: true },
            });
            if (coupon.status !== 'LOCKED' || !idsAreEqual(coupon.lockedOrderId, order.id)) continue;
            if (
                coupon.validFrom > paidAt ||
                this.isExpired(coupon, paidAt) ||
                !idsAreEqual(coupon.customerId, order.customerId)
            )
                continue;
            const discount = discountSnapshot(order, coupon.promotionId);
            if (discount.amountWithTax <= 0) {
                await this.releaseLockedCoupon(ctx, coupon, null, '订单未产生实际优惠，自动释放优惠券');
                continue;
            }
            const usedAt = paidAt;
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

    private async handleSettledRefund(
        ctx: RequestContext,
        orderId: ID,
        refundId: ID,
        customerCouponId?: ID,
    ): Promise<void> {
        await this.orderService.lockOrderForRefund(ctx, orderId);
        const order = await this.loadOrder(ctx, orderId);
        const settledRefundTotal = (order.payments ?? [])
            .flatMap(payment => payment.refunds ?? [])
            .filter(refund => refund.state === 'Settled')
            .reduce((total, refund) => total + refund.total, 0);
        const allocations = await this.connection.getRepository(ctx, CouponOrderAllocation).find({
            where: {
                channelId: ctx.channelId,
                orderId,
                status: In(['USED', 'REFUNDED']),
                ...(customerCouponId == null ? {} : { customerCouponId }),
            },
        });
        for (const allocation of allocations) {
            const paidTotal =
                allocation.orderTotalWithTax > 0 ? allocation.orderTotalWithTax : order.totalWithTax;
            const fullRefund = paidTotal > 0 && settledRefundTotal >= paidTotal;
            await this.lockRow(ctx, CustomerCoupon, allocation.customerCouponId);
            const coupon = await this.connection.getRepository(ctx, CustomerCoupon).findOne({
                where: { id: allocation.customerCouponId },
                relations: { promotion: true, campaignConfig: true },
            });
            if (!coupon) continue;
            const previousRefundedAmount = allocation.refundedAmount;
            if (!allocation.refundId || !allocation.refundedAt) allocation.refundId = refundId;
            allocation.refundedAmount = Math.round(
                allocation.discountAmountWithTax * Math.min(1, settledRefundTotal / Math.max(1, paidTotal)),
            );
            if (fullRefund) {
                allocation.status = 'REFUNDED';
                if (!allocation.refundedAt) {
                    let cumulative = 0;
                    const refunds = order.payments
                        .flatMap(payment => payment.refunds ?? [])
                        .filter(refund => refund.state === 'Settled')
                        .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
                    allocation.refundedAt =
                        refunds.find(refund => (cumulative += refund.total) >= paidTotal)?.updatedAt ??
                        new Date();
                }
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
            if (
                fullRefund &&
                coupon.status === 'USED' &&
                idsAreEqual(coupon.usedOrderId, orderId) &&
                coupon.campaignConfig.returnOnFullRefund &&
                coupon.promotion.enabled &&
                !coupon.promotion.deletedAt
            ) {
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
        if (coupon.status !== 'USED' || !idsAreEqual(coupon.usedOrderId, input.orderId)) return;
        const now = new Date();
        const expired = this.isExpired(coupon, now);
        const changes: Partial<CustomerCoupon> = {
            status: expired ? 'EXPIRED' : 'RETURNED',
            expiredAt: expired ? now : coupon.expiredAt,
            returnedAt: expired ? coupon.returnedAt : now,
            returnCount: coupon.returnCount + (expired ? 0 : 1),
            lockedAt: null,
            lockExpiresAt: null,
            lockedOrderId: null,
            usedOrderId: null,
        };
        const transition = await this.connection
            .getRepository(ctx, CustomerCoupon)
            .update(
                { id: coupon.id, channelId: ctx.channelId, status: 'USED', usedOrderId: input.orderId },
                changes,
            );
        if (transition.affected !== 1) return;
        Object.assign(coupon, changes);
        await this.addLedger(ctx, coupon, expired ? 'EXPIRED' : 'RETURNED', {
            actorType: 'SYSTEM',
            orderId: input.orderId,
            refundId: input.refundId,
            idempotencyKey: (expired ? 'EXPIRED:' : '') + input.key,
            note: expired ? input.note + '，但原有效期已结束' : input.note,
        });
    }

    private async releaseLockedCoupon(
        ctx: RequestContext,
        coupon: CustomerCoupon,
        order: Order | null,
        note: string,
    ) {
        const work = (txCtx: RequestContext) =>
            this.releaseLockedCouponWithinCart(txCtx, coupon, order, note);
        return coupon.lockedOrderId && this.carts
            ? this.carts.withOrderChange(ctx, coupon.lockedOrderId, work)
            : work(ctx);
    }

    private async releaseLockedCouponWithinCart(
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
        if (transition.affected !== 1) throw new UserInputError('优惠券状态已变化，请重试');
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

    private async expireCoupon(ctx: RequestContext, snapshot: CustomerCoupon, note: string) {
        return this.inTransaction(ctx, async txCtx => {
            await this.lockRow(txCtx, CustomerCoupon, snapshot.id);
            const fresh = await this.connection.getRepository(txCtx, CustomerCoupon).findOneOrFail({
                where: { id: snapshot.id, channelId: txCtx.channelId },
                relations: { promotion: true, campaignConfig: true },
            });
            if (
                !this.isExpired(fresh, new Date()) ||
                !['AVAILABLE', 'RETURNED', 'LOCKED'].includes(fresh.status)
            )
                return;
            if (fresh.lockedOrderId && (await this.isCouponOrderPaymentPending(txCtx, fresh.lockedOrderId)))
                return;
            const work = async (workCtx: RequestContext) => {
                await this.terminalTransition(workCtx, fresh, 'EXPIRED', note);
                Object.assign(snapshot, fresh);
            };
            return fresh.lockedOrderId && this.carts
                ? this.carts.withOrderChange(txCtx, fresh.lockedOrderId, work)
                : work(txCtx);
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
            where: { promotionId: promotion.id },
        });
        if (config && !idsAreEqual(config.channelId, ctx.channelId))
            throw new UserInputError('该优惠券属于其他店铺');
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
        if (status === 'USED') allocation.usedAt = coupon.usedAt;
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

    private async estimateCouponSavings(
        ctx: RequestContext,
        orderId: ID,
        promotion: Promotion,
        activePromotions: Promotion[],
        baseCouponCodes: string[],
    ) {
        const trialOrder = await this.orderService.findOne(ctx, orderId);
        if (!trialOrder) return 0;
        const trialPromotion = promotionWithoutCustomerEntitlement(promotion);
        const trialPromotions = activePromotions.map(active =>
            idsAreEqual(active.id, promotion.id) ? trialPromotion : active,
        );
        trialOrder.couponCodes = [...baseCouponCodes, promotion.couponCode];
        await this.orderCalculator.applyPriceAdjustments(ctx, trialOrder, trialPromotions, [], {
            recalculateShipping: false,
        });
        return discountSnapshot(trialOrder, promotion.id).amountWithTax;
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
        let observedOrderId: ID | null = null;
        if (entity === CustomerCoupon && this.carts) {
            const coupon = await this.connection
                .getRepository(ctx, CustomerCoupon)
                .findOne({ where: { id, channelId: ctx.channelId } });
            observedOrderId = coupon?.lockedOrderId ?? null;
            if (observedOrderId != null) await this.carts.lockForOrder(ctx, observedOrderId);
        }
        try {
            const locked = await this.connection
                .getRepository<CustomerCoupon | StoreCouponCampaignConfig>(ctx, entity)
                .createQueryBuilder('row')
                .setLock('pessimistic_write')
                .where('row.id = :id', { id })
                .getOne();
            if (
                entity === CustomerCoupon &&
                this.carts &&
                locked &&
                String(('lockedOrderId' in locked ? locked.lockedOrderId : null) ?? '') !==
                    String(observedOrderId ?? '')
            )
                throw new UserInputError('优惠券占用订单已变化，请重试');
            return locked;
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

    private toCustomerCouponView(ctx: RequestContext, coupon: CustomerCoupon): StoreCustomerCouponView {
        const minimumSpend =
            convertChannelAmount(ctx, coupon.minimumSpend, coupon.currencyCode, ctx.currencyCode) ?? 0;
        const discountAmount =
            coupon.discountAmount == null
                ? null
                : convertChannelAmount(ctx, coupon.discountAmount, coupon.currencyCode, ctx.currencyCode);
        const rule = coupon.promotion ? couponRuleSnapshot(coupon.promotion) : null;
        return {
            id: coupon.id,
            campaignId: coupon.promotionId,
            campaignName: coupon.campaignName,
            campaignKind: coupon.campaignKind,
            status: coupon.status,
            minimumSpend,
            currencyCode: ctx.currencyCode,
            discountAmount,
            discountRate: coupon.discountRate,
            collectionIds: rule?.collectionIds ?? [],
            productVariantIds: rule?.productVariantIds ?? [],
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
                coupon.validFrom <= new Date() &&
                !this.isExpired(coupon, new Date()) &&
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

function storedPromotionOperations(value: unknown): Promotion['actions'] | null {
    let operations = value;
    if (typeof operations === 'string') {
        try {
            operations = JSON.parse(operations) as unknown;
        } catch {
            return null;
        }
    }
    return Array.isArray(operations) ? (operations as Promotion['actions']) : null;
}

function couponRuleSnapshot(promotion: Promotion) {
    const action = promotion.actions?.find(candidate => couponKindForAction(candidate.code));
    const kind = action ? couponKindForAction(action.code) : null;
    if (!action || !kind) return null;
    const minimumCondition = promotion.conditions.find(
        candidate =>
            candidate.code === 'store_currency_minimum_order_amount' ||
            candidate.code === 'minimum_order_amount',
    );
    const percentageOff = numberArg(action, 'discount');
    return {
        kind,
        collectionIds: kind === 'COLLECTION_PERCENTAGE' ? idListArg(action, 'collectionIds') : [],
        productVariantIds: kind === 'PRODUCT_PERCENTAGE' ? idListArg(action, 'productVariantIds') : [],
        minimumSpend: numberArg(minimumCondition, 'amount'),
        currencyCode: (stringArg(minimumCondition, 'currencyCode') || stringArg(action, 'currencyCode')) as
            CurrencyCode | undefined,
        discountAmount: kind === 'ORDER_FIXED' ? numberArg(action, 'discount') : null,
        discountRate: kind === 'ORDER_FIXED' ? null : Math.round((10 - percentageOff / 10) * 100) / 100,
    } as const;
}

function couponKindForAction(code: string) {
    if (code === 'order_fixed_discount' || code === 'store_currency_order_fixed_discount') {
        return 'ORDER_FIXED' as const;
    }
    if (code === 'order_percentage_discount') return 'ORDER_PERCENTAGE' as const;
    if (code === 'store_collection_percentage_discount') return 'COLLECTION_PERCENTAGE' as const;
    if (code === 'products_percentage_discount') return 'PRODUCT_PERCENTAGE' as const;
    return null;
}

interface CouponSavingsEstimate {
    coupon: CustomerCoupon;
    amountWithTax: number;
}

function compareCouponSavings(left: CouponSavingsEstimate, right: CouponSavingsEstimate) {
    if (left.amountWithTax !== right.amountWithTax) return right.amountWithTax - left.amountWithTax;
    const leftExpiry = left.coupon.validUntil?.getTime() ?? Number.POSITIVE_INFINITY;
    const rightExpiry = right.coupon.validUntil?.getTime() ?? Number.POSITIVE_INFINITY;
    if (leftExpiry !== rightExpiry) return leftExpiry - rightExpiry;
    const claimedDifference = left.coupon.claimedAt.getTime() - right.coupon.claimedAt.getTime();
    return claimedDifference || String(left.coupon.id).localeCompare(String(right.coupon.id));
}

function promotionWithoutCustomerEntitlement(promotion: Promotion) {
    return new Promotion({
        ...promotion,
        conditions: promotion.conditions.filter(
            condition => condition.code !== 'store_customer_coupon_entitlement',
        ),
    });
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
