import { Injectable } from '@nestjs/common';
import {
    EventBus,
    ID,
    Promotion,
    PromotionEvent,
    PromotionService,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { createHash } from 'crypto';

import { CouponLedgerEntry } from '../entities/coupon-ledger-entry.entity';
import { CouponOrderAllocation } from '../entities/coupon-order-allocation.entity';
import { CustomerCoupon } from '../entities/customer-coupon.entity';
import { StoreCouponCampaignConfig } from '../entities/store-coupon-campaign-config.entity';
import { StorefrontDataChangedEvent } from '../realtime/storefront-data-changed.event';

const REPAIR_VERSION = 'coupon-lifecycle-v1';
const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;

export function couponRepairChange(
    coupon: CustomerCoupon,
    config: StoreCouponCampaignConfig,
    promotion: Promotion,
    allocations: CouponOrderAllocation[],
    now: Date,
) {
    if (!config.validityDays || !coupon.validUntil || coupon.status === 'REVOKED' || coupon.revokedAt)
        return null;
    const validFrom = new Date(Math.floor(coupon.claimedAt.getTime() / 1000) * 1000);
    const validUntil = new Date(validFrom.getTime() + config.validityDays * 86_400_000);
    // Never reduce an explicitly extended entitlement or reopen a paid allocation.
    if (coupon.validUntil && coupon.validUntil > validUntil) return null;
    const canRestore =
        coupon.status === 'EXPIRED' &&
        validUntil > now &&
        promotion.enabled &&
        !promotion.deletedAt &&
        !allocations.some(allocation => allocation.status === 'USED');
    const status = canRestore ? (coupon.returnedAt ? 'RETURNED' : 'AVAILABLE') : coupon.status;
    const after = {
        validFrom: validFrom.toISOString(),
        validUntil: validUntil.toISOString(),
        status,
        expiredAt: canRestore ? null : iso(coupon.expiredAt),
    };
    const before = {
        validFrom: iso(coupon.validFrom),
        validUntil: iso(coupon.validUntil),
        status: coupon.status,
        expiredAt: iso(coupon.expiredAt),
    };
    return JSON.stringify(before) === JSON.stringify(after)
        ? null
        : { id: String(coupon.id), version: coupon.version, before, after };
}

@Injectable()
export class StoreCouponRepairService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly promotions: PromotionService,
        private readonly events: EventBus,
    ) {}

    async preview(ctx: RequestContext, campaignId: ID) {
        const promotion = await this.promotions.findOne(ctx, campaignId);
        const config = await this.connection.getRepository(ctx, StoreCouponCampaignConfig).findOne({
            where: { channelId: ctx.channelId, promotionId: campaignId },
        });
        if (
            !promotion ||
            !config ||
            !promotion.conditions.some(condition => condition.code === 'store_customer_coupon_entitlement')
        ) {
            throw new UserInputError('只能修复当前店铺已启用实体券管理的优惠券活动');
        }
        const [coupons, allocations] = await Promise.all([
            this.connection
                .getRepository(ctx, CustomerCoupon)
                .find({ where: { channelId: ctx.channelId, promotionId: campaignId }, order: { id: 'ASC' } }),
            this.connection
                .getRepository(ctx, CouponOrderAllocation)
                .find({ where: { channelId: ctx.channelId, promotionId: campaignId }, order: { id: 'ASC' } }),
        ]);
        const relative = !!config.validityDays;
        const promotionBefore = {
            startsAt: iso(promotion.startsAt),
            endsAt: iso(promotion.endsAt),
            usageLimit: promotion.usageLimit ?? null,
            perCustomerUsageLimit: promotion.perCustomerUsageLimit ?? null,
        };
        const promotionAfter = {
            startsAt: relative ? null : promotionBefore.startsAt,
            endsAt: relative ? null : promotionBefore.endsAt,
            usageLimit: null,
            perCustomerUsageLimit: null,
        };
        const configBefore = {
            claimStartsAt: iso(config.claimStartsAt),
            claimEndsAt: iso(config.claimEndsAt),
            issueLimit: config.issueLimit,
        };
        const configAfter = {
            claimStartsAt: configBefore.claimStartsAt ?? promotionBefore.startsAt,
            claimEndsAt: configBefore.claimEndsAt ?? promotionBefore.endsAt,
            issueLimit: config.issueLimit ?? promotion.usageLimit ?? null,
        };
        const now = new Date();
        const couponChanges = coupons.flatMap(coupon => {
            const change = couponRepairChange(
                coupon,
                config,
                promotion,
                allocations.filter(allocation => String(allocation.customerCouponId) === String(coupon.id)),
                now,
            );
            return change ? [change] : [];
        });
        const snapshot = {
            promotion: {
                id: String(promotion.id),
                updatedAt: iso(promotion.updatedAt),
                enabled: promotion.enabled,
                deletedAt: iso(promotion.deletedAt),
                ...promotionBefore,
            },
            config: {
                id: String(config.id),
                updatedAt: iso(config.updatedAt),
                validityDays: config.validityDays,
                archivedAt: iso(config.archivedAt),
                ...configBefore,
            },
            coupons: coupons.map(coupon => ({
                id: String(coupon.id),
                version: coupon.version,
                status: coupon.status,
                claimedAt: iso(coupon.claimedAt),
                validFrom: iso(coupon.validFrom),
                validUntil: iso(coupon.validUntil),
                expiredAt: iso(coupon.expiredAt),
                returnedAt: iso(coupon.returnedAt),
                revokedAt: iso(coupon.revokedAt),
                lockedOrderId: coupon.lockedOrderId,
                usedOrderId: coupon.usedOrderId,
            })),
            allocations: allocations.map(allocation => ({
                id: String(allocation.id),
                couponId: String(allocation.customerCouponId),
                orderId: String(allocation.orderId),
                status: allocation.status,
                usedAt: iso(allocation.usedAt),
            })),
        };
        const changes = {
            promotion:
                JSON.stringify(promotionBefore) === JSON.stringify(promotionAfter)
                    ? null
                    : { before: promotionBefore, after: promotionAfter },
            config:
                JSON.stringify(configBefore) === JSON.stringify(configAfter)
                    ? null
                    : { before: configBefore, after: configAfter },
            coupons: couponChanges,
        };
        const report = {
            repairVersion: REPAIR_VERSION,
            channelId: String(ctx.channelId),
            campaignId: String(campaignId),
            snapshot,
            changes,
        };
        return { ...report, fingerprint: createHash('sha256').update(JSON.stringify(report)).digest('hex') };
    }

    // The resolver owns the transaction: a conflicting coupon version rolls everything back.
    async apply(ctx: RequestContext, campaignId: ID, expectedFingerprint: string) {
        const config = await this.connection
            .getRepository(ctx, StoreCouponCampaignConfig)
            .findOne({ where: { channelId: ctx.channelId, promotionId: campaignId } });
        if (!config) throw new UserInputError('找不到当前店铺的优惠券配置');
        // Claims already lock this row. A no-op UPDATE also works on SQL.js and retains the lock on MySQL.
        await this.connection
            .getRepository(ctx, StoreCouponCampaignConfig)
            .createQueryBuilder()
            .update()
            .set({ updatedAt: () => 'updatedAt' })
            .where({ id: config.id, channelId: ctx.channelId })
            .execute();
        await this.connection
            .getRepository(ctx, Promotion)
            .createQueryBuilder()
            .update()
            .set({ updatedAt: () => 'updatedAt' })
            .where({ id: campaignId })
            .execute();
        const report = await this.preview(ctx, campaignId);
        if (report.fingerprint !== expectedFingerprint)
            throw new UserInputError('优惠券数据已变化，请重新预览修复清单');
        if (report.changes.config) {
            const after = report.changes.config.after;
            await this.connection.getRepository(ctx, StoreCouponCampaignConfig).update(config.id, {
                claimStartsAt: after.claimStartsAt ? new Date(after.claimStartsAt) : null,
                claimEndsAt: after.claimEndsAt ? new Date(after.claimEndsAt) : null,
                issueLimit: after.issueLimit,
            });
        }
        if (report.changes.promotion) {
            const after = report.changes.promotion.after;
            await this.connection
                .getRepository(ctx, Promotion)
                .createQueryBuilder()
                .update()
                .set({
                    startsAt: after.startsAt ? new Date(after.startsAt) : () => 'NULL',
                    endsAt: after.endsAt ? new Date(after.endsAt) : () => 'NULL',
                    usageLimit: () => 'NULL',
                    perCustomerUsageLimit: () => 'NULL',
                })
                .where({ id: campaignId })
                .execute();
            const updated = await this.promotions.findOne(ctx, campaignId);
            if (updated) await this.events.publish(new PromotionEvent(ctx, updated, 'updated'));
        }
        for (const change of report.changes.coupons) {
            const result = await this.connection.getRepository(ctx, CustomerCoupon).update(
                { id: change.id, channelId: ctx.channelId, version: change.version },
                {
                    validFrom: new Date(change.after.validFrom),
                    validUntil: new Date(change.after.validUntil),
                    status: change.after.status,
                    expiredAt: change.after.expiredAt ? new Date(change.after.expiredAt) : null,
                },
            );
            if (result.affected !== 1) throw new UserInputError('优惠券在修复期间发生变化，本次修复已回滚');
            const coupon = await this.connection.getEntityOrThrow(ctx, CustomerCoupon, change.id);
            await this.connection.getRepository(ctx, CouponLedgerEntry).save(
                new CouponLedgerEntry({
                    channelId: ctx.channelId,
                    promotionId: campaignId,
                    customerCouponId: coupon.id,
                    customerId: coupon.customerId,
                    eventType: 'CORRECTED',
                    actorType: 'ADMIN',
                    idempotencyKey: REPAIR_VERSION + ':' + coupon.id + ':' + change.version,
                    note: '按原领取时间补足有效期；历史核销及退款流水保持不变',
                    metadata: {
                        repairVersion: REPAIR_VERSION,
                        fingerprint: report.fingerprint,
                        before: change.before,
                        after: change.after,
                    },
                }),
            );
        }
        await this.events.publish(
            new StorefrontDataChangedEvent(ctx, ['coupons', 'content'], {
                channelIds: [ctx.channelId],
                entityType: 'StoreCouponCampaign',
                entityIds: [campaignId],
            }),
        );
        return {
            appliedFingerprint: report.fingerprint,
            changedCoupons: report.changes.coupons.length,
            after: await this.preview(ctx, campaignId),
        };
    }
}
