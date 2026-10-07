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
    currencyCode: 'CNY',
    channel: { defaultCurrencyCode: 'CNY', customFields: {} },
} as any;

describe('StoreCouponLifecycleService', () => {
    it.each(['MYR', 'USD'])(
        'rejects direct coupon claims without conversion into %s before entitlement or issuance writes',
        async currencyCode => {
            const harness = createIssueHarness();
            await expect(harness.service.claim({ ...ctx, currencyCode }, 'promotion-1')).rejects.toThrow(
                '优惠券金额无法换算为当前币种',
            );
            expect(harness.customerCouponSave).not.toHaveBeenCalled();
            expect(harness.ledgerSave).not.toHaveBeenCalled();
        },
    );

    it('issues a same-currency percentage coupon with a genuine zero minimum without a rate', async () => {
        const harness = createIssueHarness();
        harness.promotion.actions = [
            { code: 'order_percentage_discount', args: [{ name: 'discount', value: '20' }] },
        ];
        harness.promotion.conditions = [
            { code: 'minimum_order_amount', args: [{ name: 'amount', value: '0' }] },
        ];
        await expect(harness.service.claim(ctx, 'promotion-1')).resolves.toMatchObject({
            minimumSpend: 0,
            currencyCode: 'CNY',
            discountAmount: null,
            discountRate: 8,
            usable: true,
        });
        expect(harness.customerCouponSave).toHaveBeenCalledOnce();
        expect(harness.ledgerSave).toHaveBeenCalledOnce();
    });

    it.each(['MYR', 'USD'])(
        'preserves source amounts but disables a percentage coupon without conversion into %s',
        currencyCode => {
            const service = Object.create(StoreCouponLifecycleService.prototype);
            const coupon = {
                id: 'coupon-1',
                currencyCode: 'CNY',
                minimumSpend: 10_000,
                discountAmount: null,
                discountRate: 8,
                status: 'AVAILABLE',
                validFrom: new Date(Date.now() - 60_000),
                validUntil: null,
                promotion: { enabled: true, deletedAt: null, actions: [], conditions: [] },
            };
            expect(service.toCustomerCouponView({ ...ctx, currencyCode }, coupon)).toMatchObject({
                minimumSpend: 10_000,
                currencyCode: 'CNY',
                discountRate: 8,
                usable: false,
            });
            expect(service.toCustomerCouponView(ctx, { ...coupon, minimumSpend: 0 })).toMatchObject({
                minimumSpend: 0,
                currencyCode: 'CNY',
                usable: true,
            });
        },
    );

    it('reports unconvertible history explicitly instead of hiding it or relabelling realized savings', async () => {
        const allocation = {
            id: 'usage-1',
            status: 'USED',
            currencyCode: 'CNY',
            discountAmountWithTax: 500,
            usedAt: new Date(),
            order: { code: 'ORDER-1' },
            customerCoupon: {
                currencyCode: 'CNY',
                minimumSpend: 10_000,
                discountAmount: null,
                discountRate: 8,
            },
        };
        const findAndCount = vi
            .fn()
            .mockResolvedValue([[allocation, { ...allocation, id: 'usage-2', currencyCode: 'MYR' }], 2]);
        const service = Object.assign(Object.create(StoreCouponLifecycleService.prototype), {
            activeCustomerOrThrow: vi.fn().mockResolvedValue({ id: 'customer-1' }),
            connection: { getRepository: () => ({ findAndCount }) },
        });
        await expect(service.findMyUsageRecordsPage(ctx)).rejects.toThrow('历史优惠券金额无法换算为订单币种');
        findAndCount.mockResolvedValueOnce([[allocation], 1]);
        await expect(service.findMyUsageRecordsPage(ctx)).resolves.toMatchObject({
            items: [{ id: 'usage-1', minimumSpend: 10_000, currencyCode: 'CNY', savedAmount: 500 }],
            totalItems: 1,
        });
    });

    it('scopes coupon ownership to the authenticated customer for separate email accounts', async () => {
        const find = vi.fn(async (_options?: unknown) => []);
        const findOneByUserId = vi.fn(async (_ctx: unknown, userId: string) => ({
            id: userId === 'user-1' ? 'customer-1' : 'customer-2',
            emailAddress: userId === 'user-1' ? 'account-a@example.com' : 'account-b@example.com',
        }));
        const service = new StoreCouponLifecycleService(
            {
                getRepository: () => ({
                    findAndCount: async (options: unknown) => {
                        const items = await find(options);
                        return [items, items.length];
                    },
                }),
            } as any,
            { findOneByUserId } as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
        );
        vi.spyOn(service as any, 'reconcileCustomer').mockResolvedValue(undefined);

        await service.findMine({ ...ctx, activeUserId: 'user-1' });
        await service.findMine({ ...ctx, activeUserId: 'user-2' });

        expect(find).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                where: { channelId: 'channel-1', customerId: 'customer-1' },
            }),
        );
        expect(find).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                where: { channelId: 'channel-1', customerId: 'customer-2' },
            }),
        );
    });

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
            { registerCheckoutValidator: vi.fn(), registerPaymentConfirmationValidator: vi.fn() } as any,
            {
                registerBlockingEventHandler: vi.fn((config: any) => {
                    handlers.set(config.id, config.handler);
                }),
            } as any,
            {} as any,
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

    it('backfills serialized legacy promotion operations without blocking application startup', async () => {
        const update = vi.fn(async () => undefined);
        const actions = [{ code: 'order_fixed_discount', args: [] }];
        const conditions = [{ code: 'minimum_order_amount', args: [] }];
        const service = new StoreCouponLifecycleService(
            {
                rawConnection: {
                    getRepository: () => ({
                        find: vi.fn(async () => [
                            {
                                id: 'promotion-1',
                                couponCode: 'CPN_0123456789ABCDEF0123456789ABCDEF',
                                actions: JSON.stringify(actions),
                                conditions: JSON.stringify(conditions),
                            },
                        ]),
                        update,
                    }),
                },
            } as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
        );

        await expect((service as any).backfillLegacyCouponEntitlements()).resolves.toBeUndefined();
        expect(update).toHaveBeenCalledWith(
            { id: 'promotion-1' },
            {
                conditions: [{ code: 'store_customer_coupon_entitlement', args: [] }, conditions[0]],
            },
        );
    });

    it('keeps an immediately issued coupon usable at whole-second database precision', async () => {
        const harness = createIssueHarness({});
        const coupon = await harness.service.claim(ctx, 'promotion-1');
        expect(coupon.validFrom.getMilliseconds()).toBe(0);
        expect(coupon.validFrom.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('issues a server-owned coupon before its future usage window and snapshots its validity', async () => {
        const now = Date.now();
        const startsAt = new Date(now + 24 * 60 * 60_000);
        const endsAt = new Date(now + 10 * 24 * 60 * 60_000);
        const harness = createIssueHarness({ startsAt, endsAt, validityDays: null });

        const coupon = await harness.service.claim(ctx, 'promotion-1');

        expect(coupon).toEqual(
            expect.objectContaining({
                id: 'coupon-1',
                campaignId: 'promotion-1',
                status: 'AVAILABLE',
                validFrom: startsAt,
                minimumSpend: 10_000,
                discountAmount: 2_000,
                usable: false,
            }),
        );
        expect(harness.savedCoupon.validUntil?.getTime()).toBeLessThanOrEqual(endsAt.getTime());
        expect(harness.ledgerSave).toHaveBeenCalledWith(
            expect.objectContaining({ eventType: 'CLAIMED', customerCouponId: 'coupon-1' }),
            { reload: false },
        );
    });

    it('starts seven complete days at claim time, including claims just before issuance ends', async () => {
        const end = new Date(Date.now() + 3_600_000);
        const harness = createIssueHarness({ endsAt: end, validityDays: 7 });
        const coupon = await harness.service.claim(ctx, 'promotion-1');
        expect(coupon.validFrom).toEqual(coupon.claimedAt);
        expect(Number(coupon.validUntil) - coupon.claimedAt.getTime()).toBe(7 * 86_400_000);
        expect(coupon.validUntil?.getTime()).toBeGreaterThan(end.getTime());
    });

    it('keeps an owned coupon usable until the exact expiry boundary', async () => {
        const harness = createIssueHarness({ validityDays: 7 });
        const coupon = await harness.service.claim(ctx, 'promotion-1');
        const expires = Number(coupon.validUntil);
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            vi.setSystemTime(expires - 1);
            expect((harness.service as any).toCustomerCouponView(ctx, harness.savedCoupon).usable).toBe(true);
            vi.setSystemTime(expires);
            expect((harness.service as any).toCustomerCouponView(ctx, harness.savedCoupon).usable).toBe(
                false,
            );
        } finally {
            vi.useRealTimers();
        }
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
            validFrom: new Date(Date.now() - 60_000),
            validUntil: new Date(Date.now() + 60_000),
            lockedOrderId: 'order-1',
            campaignName: '满减券',
            promotion: { couponCode: 'CPN_INTERNAL' },
            campaignConfig: {},
        } as any;
        const order = {
            id: 'order-1',
            customerId: 'customer-1',
            payments: [
                {
                    state: 'Settled',
                    metadata: { couponPaymentValidation: { paidAt: new Date().toISOString() } },
                },
            ],
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
            [
                CustomerCoupon,
                {
                    find: vi.fn(async () => [coupon]),
                    findOneOrFail: vi.fn(() => Promise.resolve({ ...coupon, status: 'LOCKED' })),
                    update: couponUpdate,
                    createQueryBuilder: () => chainQueryBuilder({ getOne: async () => coupon }),
                },
            ],
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
            {} as any,
        );

        await (service as any).redeemForPaidOrder(ctx, order.id);
        await (service as any).redeemForPaidOrder(ctx, order.id);

        expect(couponUpdate).toHaveBeenCalledTimes(2);
        expect(allocationSave).toHaveBeenCalledTimes(1);
        expect(ledgerSave).toHaveBeenCalledTimes(1);
    });

    it('returns a simulation coupon once without redeeming it or repricing the placed audit order', async () => {
        const test = simulatedCouponHarness();

        await (test.service as any).redeemForPaidOrder(ctx, test.order.id);
        await (test.service as any).redeemForPaidOrder(ctx, test.order.id);

        expect(test.coupon).toMatchObject({ status: 'AVAILABLE', lockedOrderId: null });
        expect(test.allocation).toMatchObject({ status: 'RELEASED', releasedAt: expect.any(Date) });
        expect(test.upsertAllocation).not.toHaveBeenCalled();
        expect(test.removeCouponCode).not.toHaveBeenCalled();
        expect(test.addLedger).toHaveBeenCalledExactlyOnceWith(ctx, test.coupon, 'RELEASED', {
            actorType: 'SYSTEM',
            orderId: test.order.id,
            note: '模拟订单完成，释放真实优惠券',
        });
    });

    it.each([
        'method-only',
        'metadata-only',
        'mixed-real',
        'unknown-created',
        'unknown-state',
        'manual-review',
    ])('keeps the coupon locked for unresolved %s simulation evidence', async evidence => {
        const test = simulatedCouponHarness();
        const payment = test.order.payments[0];
        if (evidence === 'method-only') payment.metadata.public.testPayment = false;
        if (evidence === 'metadata-only') payment.method = 'real-payment';
        if (evidence === 'mixed-real')
            test.order.payments.push({
                ...payment,
                method: 'real-payment',
                metadata: { public: { testPayment: false } },
            } as any);
        if (evidence === 'unknown-created') test.order.payments.push({ ...payment, state: 'Created' });
        if (evidence === 'unknown-state') test.order.payments.push({ ...payment, state: 'Error' });
        if (evidence === 'manual-review')
            Object.assign(payment.metadata, { manualReview: { required: true } });

        await (test.service as any).redeemForPaidOrder(ctx, test.order.id);

        expect(test.coupon.status).toBe('LOCKED');
        expect(test.allocation.status).toBe('LOCKED');
        expect(test.addLedger).not.toHaveBeenCalled();
        expect(test.upsertAllocation).not.toHaveBeenCalled();
    });

    it('does not write collected-payment coupon proof onto a server-owned simulation', async () => {
        const test = simulatedCouponHarness();
        const payment = test.order.payments[0];
        delete (payment.metadata as any).couponPaymentValidation;
        expect(
            await (test.service as any).validateConfirmedPayment(
                ctx,
                test.order.id,
                payment,
                'Settled',
                'handler',
            ),
        ).toBeUndefined();
        expect(payment.metadata).not.toHaveProperty('couponPaymentValidation');
    });

    it('retains a later pending checkout lock even when an earlier simulation succeeded', async () => {
        const test = simulatedCouponHarness();
        const carts = { isOrderPaymentLocked: vi.fn().mockResolvedValue(true) };
        Object.assign(test.service, { carts });
        expect(await (test.service as any).isCouponOrderPaymentPending(ctx, test.order.id)).toBe(true);
    });

    it('does not retain a completed simulation coupon after the cart payment lock ends', async () => {
        const test = simulatedCouponHarness();
        Object.assign(test.service, { carts: { isOrderPaymentLocked: vi.fn().mockResolvedValue(false) } });
        expect(await (test.service as any).isCouponOrderPaymentPending(ctx, test.order.id)).toBe(false);
    });

    it('retains a created gateway payment as pending even if the cart is no longer locked', async () => {
        const test = simulatedCouponHarness();
        test.order.payments[0].state = 'Created';
        expect(await (test.service as any).isCouponOrderPaymentPending(ctx, test.order.id)).toBe(true);
    });

    it('does not release a cancelled order coupon before an unknown payment is reconciled', async () => {
        const test = simulatedCouponHarness();
        test.order.payments[0].state = 'Created';
        await (test.service as any).handleCancelledOrder(ctx, test.order.id);
        expect(test.coupon.status).toBe('LOCKED');
        expect(test.addLedger).not.toHaveBeenCalled();
    });

    it.each(['none', 'Declined', 'Cancelled'])(
        'automatically releases an expired coupon when its native checkout hold confirms no funds: %s',
        async paymentState => {
            const test = expiredCheckoutCouponHarness();
            if (paymentState !== 'none')
                test.order.payments.push({ state: paymentState, method: 'real-payment', metadata: {} });

            expect(await test.service.reconcile()).toEqual({ expired: 0, released: 1 });
            expect(await test.service.reconcile()).toEqual({ expired: 0, released: 0 });

            expect(test.lockCalls).toEqual(['cart', 'order', 'coupon']);
            expect(test.coupon).toMatchObject({ status: 'AVAILABLE', lockedOrderId: null });
            expect(test.allocation).toMatchObject({ status: 'RELEASED' });
            expect(test.order.state).toBe('ArrangingPayment');
            expect(test.removeCouponCode).not.toHaveBeenCalled();
            expect(test.carts.withOrderChange).not.toHaveBeenCalled();
            expect(test.addLedger).toHaveBeenCalledTimes(1);
        },
    );

    it.each([
        'plugin-absent',
        'hold-absent',
        'cross-channel-hold',
        'different-order-hold',
        'HELD',
        'PAYING',
        'REVIEW',
        'not-expired',
        'cross-channel-order',
        'inactive-order',
        'Settled',
        'Authorized',
        'Created',
        'Error',
        'CustomGatewayPending',
        'TestSettled',
        'manual-review',
    ])('retains the timeout coupon for missing or unresolved server evidence: %s', async evidence => {
        const test = expiredCheckoutCouponHarness();
        if (evidence === 'plugin-absent') test.connection.rawConnection.entityMetadatas = [];
        else if (evidence === 'hold-absent') test.holdRepository.findOne.mockResolvedValue(null);
        else if (evidence === 'cross-channel-hold') test.hold.channelId = 'different-store';
        else if (evidence === 'different-order-hold') test.hold.orderId = 'different-order';
        else if (['HELD', 'PAYING', 'REVIEW'].includes(evidence)) test.hold.state = evidence;
        else if (evidence === 'not-expired') test.hold.expiresAt = new Date(Date.now() + 60_000);
        else if (evidence === 'cross-channel-order') test.order.salesChannelId = 'different-store';
        else if (evidence === 'inactive-order') test.order.active = false;
        else
            test.order.payments.push({
                state: evidence === 'manual-review' ? 'Declined' : evidence,
                method: 'real-payment',
                metadata: evidence === 'manual-review' ? { manualReview: { required: true } } : {},
            });

        expect(await test.service.reconcile()).toEqual({ expired: 0, released: 0 });
        expect(test.coupon.status).toBe('LOCKED');
        expect(test.allocation.status).toBe('LOCKED');
        expect(test.removeCouponCode).not.toHaveBeenCalled();
        expect(test.addLedger).not.toHaveBeenCalled();
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
            {} as any,
        );

        await expect(service.apply(ctx, 'coupon-1')).rejects.toThrow('优惠券已使用');
        expect(applyCouponCode).not.toHaveBeenCalled();
    });

    it.each([
        {
            name: 'applies the best coupon to an order without a coupon',
            savings: [3_000, 4_500],
            expected: 'coupon-2',
            locked: false,
        },
        {
            name: 'replaces an automatic locked coupon with the new best choice',
            savings: [3_000, 4_500],
            expected: 'coupon-2',
            locked: true,
        },
        {
            name: 'keeps the locked coupon when it still saves the most',
            savings: [4_500, 3_000],
            expected: 'coupon-1',
            locked: true,
        },
        {
            name: 'removes the locked coupon if neither candidate is eligible',
            savings: [0, 0],
            expected: null,
            locked: true,
        },
    ])('$name', async ({ savings, expected, locked }) => {
        const now = Date.now();
        const promotions = [
            { id: 'promotion-1', couponCode: 'FIXED_30', enabled: true, deletedAt: null },
            { id: 'promotion-2', couponCode: 'CATEGORY_20', enabled: true, deletedAt: null },
        ] as any[];
        const coupons = promotions.map((promotion, index) => ({
            id: `coupon-${index + 1}`,
            channelId: 'channel-1',
            customerId: 'customer-1',
            promotionId: promotion.id,
            promotion,
            campaignConfig: { stackPolicy: 'EXCLUSIVE' },
            campaignName: index === 0 ? '30元券' : '分类八折券',
            status: 'AVAILABLE',
            validFrom: new Date(now - 60_000),
            validUntil: new Date(now + 60_000),
            claimedAt: new Date(now - index * 1_000),
        })) as any[];
        if (locked) Object.assign(coupons[0], { status: 'LOCKED', lockedOrderId: 'order-1' });
        const couponRepository = {
            findOne: vi.fn(async () => (locked ? coupons[0] : null)),
            find: vi.fn().mockResolvedValueOnce(coupons).mockResolvedValue([]),
        };
        for (const promotion of promotions) Object.assign(promotion, { conditions: [] });
        const service = new StoreCouponLifecycleService(
            {
                getRepository: () => couponRepository,
            } as any,
            { findOneByUserId: vi.fn(async () => ({ id: 'customer-1' })) } as any,
            {
                getActivePromotionsInChannel: vi.fn(async () => promotions),
                getExhaustedPromotionIds: vi.fn(async () => new Set()),
                validateCouponCode: vi.fn(async (_ctx: unknown, code: string) =>
                    promotions.find(promotion => promotion.couponCode === code),
                ),
            } as any,
            {
                getActiveOrderForUser: vi.fn(async () => ({
                    id: 'order-1',
                    lines: [{ id: 'line-1' }],
                    couponCodes: [],
                })),
            } as any,
            {} as any,
            {} as any,
            {} as any,
        );
        vi.spyOn(service as any, 'reconcileCustomer').mockResolvedValue(undefined);
        const savingsService = service as unknown as {
            estimateCouponSavings: (...args: unknown[]) => Promise<number>;
        };
        vi.spyOn(savingsService, 'estimateCouponSavings').mockImplementation(async (...args: unknown[]) =>
            (args[2] as { id: string }).id === 'promotion-1' ? savings[0] : savings[1],
        );
        const apply = vi
            .spyOn(service, 'apply')
            .mockResolvedValue({ id: 'coupon-2', campaignName: '分类八折券' } as any);

        const viewService = service as unknown as {
            toCustomerCouponView: (...args: unknown[]) => Promise<{ id: string }>;
        };
        vi.spyOn(viewService, 'toCustomerCouponView').mockResolvedValue({ id: 'coupon-1' });
        const remove = vi
            .spyOn(service, 'remove')
            .mockResolvedValue({ id: 'coupon-1' } as Awaited<ReturnType<typeof service.remove>>);
        const result = await service.applyBest(ctx);
        expect(result?.id ?? null).toBe(expected);
        if (expected === 'coupon-2') expect(apply).toHaveBeenCalledWith(ctx, 'coupon-2');
        else expect(apply).not.toHaveBeenCalled();
        if (expected === null) expect(remove).toHaveBeenCalledWith(ctx, 'coupon-1');
        else expect(remove).not.toHaveBeenCalled();
        expect(couponRepository.find).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.arrayContaining([
                    expect.objectContaining({
                        status: 'LOCKED',
                        lockedOrderId: 'order-1',
                        channelId: 'channel-1',
                        customerId: 'customer-1',
                    }),
                ]),
            }),
        );
    });

    it('keeps a refunded allocation in the customer usage history', async () => {
        const find = vi.fn(async (_options?: unknown) => [
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
                    currencyCode: 'CNY',
                    minimumSpend: 10_000,
                    discountAmount: 1_000,
                    discountRate: null,
                },
            },
        ]);
        const service = new StoreCouponLifecycleService(
            {
                getRepository: () => ({
                    findAndCount: async (options: unknown) => {
                        const items = await find(options);
                        return [items, items.length];
                    },
                }),
            } as any,
            { findOneByUserId: vi.fn(async () => ({ id: 'customer-1' })) } as any,
            {} as any,
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
                where: {
                    channelId: 'channel-1',
                    customerId: 'customer-1',
                    status: expect.anything(),
                    usedAt: expect.anything(),
                },
                relations: { customerCoupon: { campaignConfig: true }, order: true },
                order: { usedAt: 'DESC', id: 'DESC' },
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

    it('does not return a coupon already redeemed by a different order', async () => {
        const harness = createRefundHarness({ settledRefundTotal: 10_000, orderTotal: 10_000 });
        harness.coupon.usedOrderId = 'order-b';
        harness.allocation.status = 'REFUNDED';
        await (harness.service as any).handleSettledRefund(ctx, 'order-1', 'refund-1');
        expect(harness.coupon).toMatchObject({ status: 'USED', usedOrderId: 'order-b', returnCount: 0 });
        expect(harness.ledgerEvents).not.toContain('RETURNED');
    });

    it('returns only once and never renews validity across repeated refund events', async () => {
        const harness = createRefundHarness({ settledRefundTotal: 10_000, orderTotal: 10_000 });
        const validUntil = harness.coupon.validUntil;
        await (harness.service as any).handleSettledRefund(ctx, 'order-1', 'refund-1');
        await (harness.service as any).handleSettledRefund(ctx, 'order-1', 'refund-1');
        expect(harness.coupon).toMatchObject({
            status: 'RETURNED',
            usedOrderId: null,
            returnCount: 1,
            validUntil,
        });
        expect(harness.ledgerEvents.filter(event => event === 'RETURNED')).toHaveLength(1);
    });

    it('uses the paid allocation total for partial refunds after an order is cancelled', async () => {
        const harness = createRefundHarness({ settledRefundTotal: 2_500, orderTotal: 0 });
        harness.allocation.orderTotalWithTax = 10_000;
        await (harness.service as any).handleSettledRefund(ctx, 'order-1', 'refund-1');
        expect(harness.coupon.status).toBe('USED');
        expect(harness.allocation.refundedAmount).toBe(500);
    });

    it('does not return an expired coupon or one with full-refund returns disabled', async () => {
        const expired = createRefundHarness({ settledRefundTotal: 10_000, orderTotal: 10_000 });
        expired.coupon.validUntil = new Date(Date.now() - 1000);
        await (expired.service as any).handleSettledRefund(ctx, 'order-1', 'refund-1');
        expect(expired.coupon).toMatchObject({ status: 'EXPIRED', returnCount: 0 });
        const disabled = createRefundHarness({ settledRefundTotal: 10_000, orderTotal: 10_000 });
        disabled.coupon.campaignConfig.returnOnFullRefund = false;
        await (disabled.service as any).handleSettledRefund(ctx, 'order-1', 'refund-1');
        expect(disabled.coupon.status).toBe('USED');
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

function simulatedCouponHarness() {
    const coupon = {
        id: 'coupon-simulated',
        channelId: ctx.channelId,
        status: 'LOCKED',
        lockedOrderId: 'simulation-order',
        returnedAt: null,
        promotion: { couponCode: 'CPN_SIMULATED' },
    } as any;
    const allocation = { status: 'LOCKED', releasedAt: null } as any;
    const order = {
        id: 'simulation-order',
        state: 'PaymentSettled',
        lines: [],
        payments: [
            {
                state: 'Settled',
                method: 'controlled-test-payment-store',
                metadata: {
                    public: { testPayment: true },
                    couponPaymentValidation: { paidAt: new Date().toISOString() },
                },
            },
        ],
    };
    const repository = {
        find: vi.fn(async () => (coupon.status === 'LOCKED' ? [coupon] : [])),
        findOneOrFail: vi.fn(async () => coupon),
        update: vi.fn(async (_criteria: unknown, changes: any) => {
            Object.assign(coupon, changes);
            return { affected: 1 };
        }),
        save: vi.fn(async (value: any) => value),
    };
    const removeCouponCode = vi.fn();
    const service = new StoreCouponLifecycleService(
        { getRepository: () => repository, getEntityOrThrow: vi.fn(async () => order) } as any,
        {} as any,
        {} as any,
        { removeCouponCode, findOne: vi.fn(async () => order) } as any,
        {} as any,
        {} as any,
        {} as any,
    );
    vi.spyOn(service as any, 'lockRow').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'allocationFor').mockResolvedValue(allocation);
    const upsertAllocation = vi.spyOn(service as any, 'upsertAllocation').mockResolvedValue(undefined);
    const addLedger = vi.spyOn(service as any, 'addLedger').mockResolvedValue(undefined);
    return { service, coupon, allocation, order, removeCouponCode, upsertAllocation, addLedger };
}

function expiredCheckoutCouponHarness() {
    const test = simulatedCouponHarness();
    const order = {
        ...test.order,
        salesChannelId: ctx.channelId as string,
        active: true,
        state: 'ArrangingPayment',
        payments: [] as Array<{ state: string; method: string; metadata: any }>,
    };
    Object.assign(test.coupon, { lockExpiresAt: new Date(Date.now() - 60_000) });
    const hold = {
        channelId: ctx.channelId as string,
        orderId: order.id,
        state: 'RELEASED',
        expiresAt: new Date(Date.now() - 60_000),
    };
    const holdTarget = class CheckoutResourceHold {};
    const holdRepository = { findOne: vi.fn<any>(async () => hold) };
    const lockCalls: string[] = [];
    const builder = {
        update: vi.fn(() => builder),
        set: vi.fn(() => builder),
        where: vi.fn(() => builder),
        execute: vi.fn(async () => {
            lockCalls.push('coupon');
            return { affected: 1 };
        }),
    };
    const repository = {
        find: vi.fn().mockResolvedValueOnce([test.coupon]).mockResolvedValue([]),
        findOne: vi.fn(async () => test.coupon),
        createQueryBuilder: vi.fn(() => builder),
        update: vi.fn(async (_criteria: unknown, changes: any) => {
            Object.assign(test.coupon, changes);
            return { affected: 1 };
        }),
        save: vi.fn(async (value: unknown) => value),
    };
    const connection = {
        rawConnection: {
            entityMetadatas: [{ name: 'CheckoutResourceHold', target: holdTarget }],
            getRepository: vi.fn(() => repository),
        },
        getRepository: vi.fn((_ctx, target) => (target === holdTarget ? holdRepository : repository)),
    };
    const carts = {
        withTransaction: vi.fn(async (workCtx, work) => work(workCtx)),
        lockForOrder: vi.fn(async () => {
            lockCalls.push('cart');
        }),
        isOrderPaymentLocked: vi.fn(async () => true),
        withOrderChange: vi.fn(),
    };
    Object.assign(test.service, {
        connection,
        carts,
        requestContextService: { create: vi.fn(async () => ctx) },
        orderService: {
            findOne: vi.fn(async () => order),
            lockOrderForRefund: vi.fn(async () => {
                lockCalls.push('order');
            }),
            removeCouponCode: test.removeCouponCode,
        },
    });
    return { ...test, order, hold, holdRepository, connection, carts, lockCalls };
}

function createIssueHarness({
    startsAt = null,
    validityDays = 3,
    endsAt = new Date(Date.now() + 10 * 24 * 60 * 60_000),
    issuedCount = 0,
    customerClaimedCount = 0,
    issueLimit = 100,
}: {
    startsAt?: Date | null;
    validityDays?: number | null;
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
        channelId: 'channel-1',
        promotionId: promotion.id,
        claimStartsAt: null,
        claimEndsAt: null,
        validityDays,
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
        {} as any,
    );
    return {
        service,
        promotion,
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
        usedOrderId: 'order-1',
        returnCount: 0,
        validUntil: new Date(Date.now() + 24 * 60 * 60_000),
        campaignConfig: { returnOnFullRefund: true },
        promotion: { couponCode: 'CPN_INTERNAL', enabled: true, deletedAt: null },
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
                createQueryBuilder: () => chainQueryBuilder({ getOne: async () => coupon }),
                update: vi.fn(async (criteria: any, changes: any) => {
                    if (coupon.status !== criteria.status || coupon.usedOrderId !== criteria.usedOrderId)
                        return { affected: 0 };
                    Object.assign(coupon, changes);
                    return { affected: 1 };
                }),
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
                refunds: [
                    { id: 'refund-1', state: 'Settled', total: settledRefundTotal, updatedAt: new Date() },
                ],
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
        { lockOrderForRefund: vi.fn(async () => undefined) } as any,
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

describe('legacy coupon configuration ownership', () => {
    it('does not let a storefront claim an unowned shared coupon configuration', async () => {
        const save = vi.fn();
        const service = new StoreCouponLifecycleService(
            { getRepository: () => ({ findOne: vi.fn(async () => null), save }) } as any,
            {} as any,
            {
                findOne: vi.fn(async () => ({
                    channels: [
                        { id: 'channel-1', code: 'a' },
                        { id: 'channel-2', code: 'b' },
                    ],
                })),
            } as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
        );
        await expect((service as any).configForPromotion(ctx, { id: 'legacy' })).rejects.toThrow(
            '唯一经营店铺',
        );
        expect(save).not.toHaveBeenCalled();
    });
});
