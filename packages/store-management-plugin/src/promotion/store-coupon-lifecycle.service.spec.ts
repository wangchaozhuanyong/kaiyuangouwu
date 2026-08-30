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
    it('redeems only after payment succeeds, not when checkout merely enters payment', async () => {
        const handlers = new Map<string, (event: any) => Promise<void>>();
        const service = new StoreCouponLifecycleService(
            {
                rawConnection: {
                    getRepository: () => ({ find: vi.fn(async () => []) }),
                },
            } as any,
            {} as any,
            {} as any,
            {} as any,
            {
                registerBlockingEventHandler: vi.fn((config: any) => {
                    handlers.set(config.id, config.handler);
                }),
            } as any,
            {} as any,
        );
        const redeem = vi.spyOn(service as any, 'redeemForPaidOrder').mockResolvedValue(undefined);

        await service.onApplicationBootstrap();
        const handleOrder = handlers.get('store-coupon-handle-paid-or-cancelled-order');
        expect(handleOrder).toBeDefined();

        await handleOrder?.({ ctx, order: { id: 'order-1' }, toState: 'ArrangingPayment' });
        expect(redeem).not.toHaveBeenCalled();

        await handleOrder?.({ ctx, order: { id: 'order-1' }, toState: 'PaymentSettled' });
        expect(redeem).toHaveBeenCalledOnce();
    });

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

    it('prevents a customer from claiming the same campaign twice', async () => {
        const harness = createIssueHarness({ customerClaimedCount: 1 });

        await expect(harness.service.claim(ctx, 'promotion-1')).rejects.toThrow('该优惠券已经领取');
        expect(harness.customerCouponSave).not.toHaveBeenCalled();
    });

    it('redeems a locked coupon at most once when the order event is repeated', async () => {
        const coupon = {
            id: 'coupon-1',
            channelId: 'channel-1',
            promotionId: 'promotion-1',
            customerId: 'customer-1',
            status: 'LOCKED',
            lockedOrderId: 'order-1',
            campaignName: '满减券',
            promotion: { couponCode: 'CPN_INTERNAL' },
            campaignConfig: {},
        } as any;
        const order = {
            id: 'order-1',
            currencyCode: 'CNY',
            totalWithTax: 10_000,
            lines: [
                {
                    id: 'line-1',
                    quantity: 1,
                    discounts: [
                        {
                            adjustmentSource: 'promotion:promotion-1',
                            amount: -2_000,
                            amountWithTax: -2_000,
                        },
                    ],
                },
            ],
            shippingLines: [],
        } as any;
        const couponUpdate = vi
            .fn()
            .mockResolvedValueOnce({ affected: 1 })
            .mockResolvedValueOnce({ affected: 0 });
        const allocationSave = vi.fn(async (value: unknown) => value);
        const ledgerSave = vi.fn(async (value: unknown) => value);
        const repositories = new Map<any, any>([
            [CustomerCoupon, { find: vi.fn(async () => [coupon]), update: couponUpdate }],
            [CouponOrderAllocation, { findOne: vi.fn(async () => undefined), save: allocationSave }],
            [CouponLedgerEntry, { findOne: vi.fn(async () => undefined), save: ledgerSave }],
        ]);
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

        await (service as any).redeemForPaidOrder(ctx, order.id);
        await (service as any).redeemForPaidOrder(ctx, order.id);

        expect(couponUpdate).toHaveBeenCalledTimes(2);
        expect(allocationSave).toHaveBeenCalledTimes(1);
        expect(ledgerSave).toHaveBeenCalledTimes(1);
    });

    it('rejects applying a coupon that has already been used', async () => {
        const applyCouponCode = vi.fn();
        const couponRepository = {
            createQueryBuilder: vi.fn(() => chainQueryBuilder({ getOne: async () => ({ id: 'coupon-1' }) })),
            findOne: vi.fn(async () => ({
                id: 'coupon-1',
                channelId: 'channel-1',
                customerId: 'customer-1',
                status: 'USED',
                validFrom: new Date(Date.now() - 60_000),
                validUntil: new Date(Date.now() + 60_000),
                promotion: { couponCode: 'CPN_INTERNAL' },
                campaignConfig: { stackPolicy: 'EXCLUSIVE' },
            })),
        };
        const service = new StoreCouponLifecycleService(
            { getRepository: () => couponRepository } as any,
            { findOneByUserId: vi.fn(async () => ({ id: 'customer-1' })) } as any,
            {} as any,
            {
                getActiveOrderForUser: vi.fn(async () => ({ id: 'order-2', lines: [{ id: 'line-1' }] })),
                applyCouponCode,
            } as any,
            {} as any,
            {} as any,
        );

        await expect(service.apply(ctx, 'coupon-1')).rejects.toThrow('优惠券已使用');
        expect(applyCouponCode).not.toHaveBeenCalled();
    });

    it('keeps a refunded allocation in the customer usage history', async () => {
        const find = vi.fn(async () => [
            {
                id: 'allocation-1',
                customerCouponId: 'coupon-1',
                promotionId: 'promotion-1',
                campaignName: '退款返券活动',
                status: 'REFUNDED',
                currencyCode: 'CNY',
                discountAmountWithTax: 1_000,
                usedAt: new Date('2026-08-26T00:00:00.000Z'),
                refundedAt: new Date('2026-08-27T00:00:00.000Z'),
                orderId: 'order-1',
                order: { code: 'T0001' },
                customerCoupon: {
                    campaignKind: 'ORDER_FIXED',
                    minimumSpend: 10_000,
                    discountAmount: 1_000,
                    discountRate: null,
                },
            },
        ]);
        const service = new StoreCouponLifecycleService(
            { getRepository: () => ({ find }) } as any,
            { findOneByUserId: vi.fn(async () => ({ id: 'customer-1' })) } as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
        );

        await expect(service.findMyUsageRecords(ctx)).resolves.toEqual([
            expect.objectContaining({
                id: 'allocation-1',
                status: 'REFUNDED',
                orderCode: 'T0001',
                savedAmount: 1_000,
            }),
        ]);
        expect(find).toHaveBeenCalledWith(
            expect.objectContaining({
                relations: { customerCoupon: true, order: true },
                order: { usedAt: 'DESC' },
            }),
        );
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
    customerClaimedCount = 0,
    issueLimit = 100,
}: {
    startsAt?: Date | null;
    endsAt?: Date | null;
    issuedCount?: number;
    customerClaimedCount?: number;
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
                count: vi.fn().mockResolvedValueOnce(issuedCount).mockResolvedValueOnce(customerClaimedCount),
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
        { publish: vi.fn(async () => undefined) } as any,
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
