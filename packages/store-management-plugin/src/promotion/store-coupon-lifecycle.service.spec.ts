/* eslint-disable @typescript-eslint/require-await -- Repository mocks preserve async database APIs. */
import { describe, expect, it, vi } from 'vitest';

import { CouponLedgerEntry } from '../entities/coupon-ledger-entry.entity';
import { CouponOrderAllocation } from '../entities/coupon-order-allocation.entity';
import { CustomerCoupon } from '../entities/customer-coupon.entity';
import { StoreCouponCampaignConfig } from '../entities/store-coupon-campaign-config.entity';

import { StoreCouponLifecycleService } from './store-coupon-lifecycle.service';

const ctx = {
    channelId: 'channel-1',
    activeUserId: 'user-1',
} as any;

describe('StoreCouponLifecycleService', () => {
    it('backfills the entitlement guard onto legacy generated coupon promotions', async () => {
        const update = vi.fn(async () => undefined);
        const promotion = {
            id: 'promotion-1',
            couponCode: 'CPN_0123456789ABCDEF0123456789ABCDEF',
            actions: [{ code: 'order_fixed_discount', args: [] }],
            conditions: [{ code: 'minimum_order_amount', args: [] }],
        };
        const service = new StoreCouponLifecycleService(
            {
                rawConnection: {
                    getRepository: () => ({ find: vi.fn(async () => [promotion]), update }),
                },
            } as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
        );

        await (service as any).backfillLegacyCouponEntitlements();

        expect(update).toHaveBeenCalledWith(
            { id: promotion.id },
            {
                conditions: [
                    { code: 'store_customer_coupon_entitlement', args: [] },
                    promotion.conditions[0],
                ],
            },
        );
    });

    it('issues a server-owned coupon before its future usage window and snapshots its validity', async () => {
        const now = Date.now();
        const startsAt = new Date(now + 24 * 60 * 60_000);
        const endsAt = new Date(now + 10 * 24 * 60 * 60_000);
        const harness = createIssueHarness({ startsAt, endsAt });

        const coupon = await harness.service.claim(ctx, 'promotion-1');

        expect(coupon).toEqual(
            expect.objectContaining({
                id: 'coupon-1',
                campaignId: 'promotion-1',
                status: 'AVAILABLE',
                validFrom: startsAt,
                minimumSpend: 10_000,
                discountAmount: 2_000,
                usable: true,
            }),
        );
        expect(harness.savedCoupon.validUntil?.getTime()).toBeLessThanOrEqual(endsAt.getTime());
        expect(harness.ledgerSave).toHaveBeenCalledWith(
            expect.objectContaining({ eventType: 'CLAIMED', customerCouponId: 'coupon-1' }),
            { reload: false },
        );
    });

    it('enforces the campaign issue limit inside the claim transaction', async () => {
        const harness = createIssueHarness({ issuedCount: 100, issueLimit: 100 });

        await expect(harness.service.claim(ctx, 'promotion-1')).rejects.toThrow('优惠券已领完');
        expect(harness.customerCouponSave).not.toHaveBeenCalled();
    });

    it('returns a used coupon only after a full settled refund', async () => {
        const harness = createRefundHarness({ settledRefundTotal: 10_000, orderTotal: 10_000 });

        await (harness.service as any).handleSettledRefund(ctx, 'order-1', 'refund-1');

        expect(harness.coupon.status).toBe('RETURNED');
        expect(harness.coupon.returnCount).toBe(1);
        expect(harness.allocation).toEqual(
            expect.objectContaining({
                status: 'REFUNDED',
                refundId: 'refund-1',
                refundedAmount: 2_000,
            }),
        );
        expect(harness.ledgerEvents).toEqual(expect.arrayContaining(['REFUND_SETTLED', 'RETURNED']));
    });

    it('keeps a coupon used after a partial refund and records the prorated discount', async () => {
        const harness = createRefundHarness({ settledRefundTotal: 2_500, orderTotal: 10_000 });

        await (harness.service as any).handleSettledRefund(ctx, 'order-1', 'refund-1');

        expect(harness.coupon.status).toBe('USED');
        expect(harness.allocation.status).toBe('USED');
        expect(harness.allocation.refundedAmount).toBe(500);
        expect(harness.ledgerEvents).toEqual(['REFUND_SETTLED']);
    });
});

function createIssueHarness({
    startsAt = null,
    endsAt = new Date(Date.now() + 10 * 24 * 60 * 60_000),
    issuedCount = 0,
    issueLimit = 100,
}: {
    startsAt?: Date | null;
    endsAt?: Date | null;
    issuedCount?: number;
    issueLimit?: number | null;
} = {}) {
    const customer = { id: 'customer-1' };
    const promotion = {
        id: 'promotion-1',
        name: '新客满减',
        enabled: true,
        couponCode: 'CPN_INTERNAL',
        startsAt,
        endsAt,
        actions: [{ code: 'order_fixed_discount', args: [{ name: 'discount', value: '2000' }] }],
        conditions: [{ code: 'minimum_order_amount', args: [{ name: 'amount', value: '10000' }] }],
    };
    const config = {
        id: 'config-1',
        promotionId: promotion.id,
        claimStartsAt: null,
        claimEndsAt: null,
        validityDays: 3,
        issueLimit,
        perCustomerClaimLimit: 1,
        stackPolicy: 'EXCLUSIVE',
        returnOnCancellation: true,
        returnOnFullRefund: true,
    };
    let savedCoupon: CustomerCoupon | undefined;
    const customerCouponSave = vi.fn(async (coupon: CustomerCoupon) => {
        coupon.id = 'coupon-1';
        savedCoupon = coupon;
        return coupon;
    });
    const ledgerSave = vi.fn(async (entry: CouponLedgerEntry) => entry);
    const lockQueryBuilder = chainQueryBuilder({ getOne: async () => config });
    const repositories = new Map<any, any>([
        [
            StoreCouponCampaignConfig,
            {
                findOne: vi.fn(async () => config),
                createQueryBuilder: vi.fn(() => lockQueryBuilder),
            },
        ],
        [
            CustomerCoupon,
            {
                count: vi.fn().mockResolvedValueOnce(issuedCount).mockResolvedValueOnce(0),
                save: customerCouponSave,
            },
        ],
        [
            CouponLedgerEntry,
            {
                findOne: vi.fn(async () => undefined),
                save: ledgerSave,
            },
        ],
    ]);
    const service = new StoreCouponLifecycleService(
        { getRepository: (_ctx: unknown, entity: any) => repositories.get(entity) } as any,
        { findOneByUserId: vi.fn(async () => customer) } as any,
        { findOne: vi.fn(async () => promotion) } as any,
        {} as any,
        {} as any,
        {} as any,
    );
    return {
        service,
        customerCouponSave,
        ledgerSave,
        get savedCoupon() {
            if (!savedCoupon) throw new Error('Expected the coupon to have been saved');
            return savedCoupon;
        },
    };
}

function createRefundHarness({
    settledRefundTotal,
    orderTotal,
}: {
    settledRefundTotal: number;
    orderTotal: number;
}) {
    const coupon = {
        id: 'coupon-1',
        channelId: 'channel-1',
        promotionId: 'promotion-1',
        customerId: 'customer-1',
        status: 'USED',
        returnCount: 0,
        validUntil: new Date(Date.now() + 24 * 60 * 60_000),
        campaignConfig: { returnOnFullRefund: true },
        promotion: { couponCode: 'CPN_INTERNAL' },
    } as any;
    const allocation = {
        id: 'allocation-1',
        customerCouponId: coupon.id,
        status: 'USED',
        discountAmountWithTax: 2_000,
        refundedAmount: 0,
    } as any;
    const ledgerEvents: string[] = [];
    const repositories = new Map<any, any>([
        [
            CouponOrderAllocation,
            {
                find: vi.fn(async () => [allocation]),
                save: vi.fn(async (value: unknown) => value),
            },
        ],
        [
            CustomerCoupon,
            {
                findOne: vi.fn(async () => coupon),
                save: vi.fn(async (value: unknown) => value),
            },
        ],
        [
            CouponLedgerEntry,
            {
                findOne: vi.fn(async () => undefined),
                save: vi.fn(async (entry: CouponLedgerEntry) => {
                    ledgerEvents.push(entry.eventType);
                    return entry;
                }),
            },
        ],
    ]);
    const order = {
        id: 'order-1',
        totalWithTax: orderTotal,
        payments: [
            {
                refunds: [{ id: 'refund-1', state: 'Settled', total: settledRefundTotal }],
            },
        ],
    };
    const service = new StoreCouponLifecycleService(
        {
            getRepository: (_ctx: unknown, entity: any) => repositories.get(entity),
            getEntityOrThrow: vi.fn(async () => order),
        } as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
    );
    return { service, coupon, allocation, ledgerEvents };
}

function chainQueryBuilder(overrides: Record<string, (...args: any[]) => any>) {
    const builder: Record<string, any> = {};
    for (const method of ['select', 'from', 'where', 'andWhere', 'limit', 'setLock']) {
        builder[method] = vi.fn(() => builder);
    }
    Object.assign(builder, overrides);
    return builder;
}
