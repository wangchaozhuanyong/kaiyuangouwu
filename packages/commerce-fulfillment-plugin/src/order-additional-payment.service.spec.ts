import { describe, expect, it, vi } from 'vitest';

import { OrderAdditionalPaymentService } from './order-additional-payment.service';
function harness() {
    const order: any = {
        id: 'order',
        salesChannelId: 'store',
        active: false,
        orderPlacedAt: new Date(),
        state: 'ArrangingAdditionalPayment',
        totalWithTax: 1500,
        customer: { user: { id: 'owner' } },
        payments: [
            {
                id: 'original',
                state: 'Settled',
                amount: 1000,
                method: 'real',
                metadata: {},
                refunds: [{ state: 'Settled', total: 100, lines: [] }],
            },
        ],
    };
    const ctx: any = { channelId: 'store', activeUserId: 'owner' };
    const phase: string[] = [];
    const orders = {
        withOrderMutationTransaction: vi.fn((ctxValue, operation) => Promise.resolve(operation(ctxValue))),
        lockOrderForRefund: vi.fn(() => {
            return Promise.resolve().then(() => {
                phase.push('lock');
            });
        }),
        getEligiblePaymentMethods: vi.fn(() =>
            Promise.resolve([
                { code: 'real', isEligible: true },
                { code: 'controlled-test-payment-fixture', isEligible: true },
                { code: 'usdt-trc20', isEligible: true },
            ]),
        ),
        addPaymentToOrder: vi.fn(() => {
            return Promise.resolve().then(() => {
                phase.push('pay');
                return { id: 'order', state: 'PaymentSettled' };
            });
        }),
    };
    const tokens = {
        verifyToken: vi.fn(token =>
            token === 'valid-proof' ? { orderId: 'order', channelId: 'store' } : undefined,
        ),
    };
    const connection = { getEntityOrThrow: vi.fn(() => Promise.resolve(order)) };
    const resources = { hold: vi.fn(() => Promise.resolve(null)) };
    const currency = {
        existingOrderUsdtQuote: vi.fn().mockResolvedValue(null),
        get: vi.fn().mockResolvedValue({
            usdtRateAvailable: false,
            usdtPaymentConfigured: false,
        }),
        createAdditionalOrderUsdtQuote: vi.fn().mockResolvedValue({ id: 'quote' }),
    };
    const referral = {
        additionalBalanceAvailability: vi.fn().mockResolvedValue(0),
        useAdditionalBalance: vi.fn().mockResolvedValue({ id: 'order', state: 'PaymentSettled' }),
    };
    const service = new OrderAdditionalPaymentService(
        connection as any,
        orders as any,
        tokens as any,
        resources as any,
        currency as any,
        referral as any,
    );
    const input = { orderId: 'order', expectedAmount: 500, payment: { method: 'real', metadata: {} } };
    return { order, ctx, orders, tokens, connection, service, input, phase, resources, currency, referral };
}
describe('placed order price difference payment boundary', () => {
    it('creates a quote for the confirmed difference without reactivating a cart or pretending money arrived', async () => {
        const h = harness();
        h.currency.get.mockResolvedValue({ usdtRateAvailable: true, usdtPaymentConfigured: true });
        await expect(
            h.service.usdtQuote(h.ctx, { orderId: 'order', expectedAmount: 500 }),
        ).resolves.toMatchObject({ id: 'quote' });
        expect(h.currency.createAdditionalOrderUsdtQuote).toHaveBeenCalledWith(h.ctx, 'order', 500);
        expect(h.orders.addPaymentToOrder).not.toHaveBeenCalled();
        expect(h.order.active).toBe(false);
        await expect(
            h.service.pay(h.ctx, { ...h.input, payment: { method: 'usdt-trc20', metadata: {} } }),
        ).rejects.toThrow('报价或余额');
    });
    it('reuses one pending quote and blocks other payment methods while its receipt remains uncertain', async () => {
        const h = harness();
        h.currency.get.mockResolvedValue({ usdtRateAvailable: true, usdtPaymentConfigured: true });
        const quote = {
            id: 'pending',
            paymentStatus: 'PENDING',
            fiatAmount: 500,
            expiresAt: new Date(Date.now() + 60000),
        };
        h.currency.existingOrderUsdtQuote.mockResolvedValue(quote);
        await expect(h.service.usdtQuote(h.ctx, { orderId: 'order', expectedAmount: 500 })).resolves.toBe(
            quote,
        );
        expect(h.currency.createAdditionalOrderUsdtQuote).not.toHaveBeenCalled();
        await expect(h.service.pay(h.ctx, h.input)).rejects.toThrow('不允许补款');
        quote.paymentStatus = 'MANUAL_REVIEW';
        await expect(h.service.usdtQuote(h.ctx, { orderId: 'order', expectedAmount: 500 })).rejects.toThrow(
            '不要重复转账',
        );
    });
    it('uses the wallet endpoint with a stable key and rejects stale amounts before any reservation', async () => {
        const h = harness();
        h.orders.getEligiblePaymentMethods.mockResolvedValue([
            { code: 'referral-balance', isEligible: true },
        ]);
        h.referral.additionalBalanceAvailability.mockResolvedValue(300);
        await h.service.useBalance(h.ctx, {
            orderId: 'order',
            expectedAmount: 500,
            amount: 300,
            idempotencyKey: 'stable',
        });
        expect(h.referral.useAdditionalBalance).toHaveBeenCalledWith(h.ctx, 'order', 300, 500, 'stable');
        h.referral.useAdditionalBalance.mockClear();
        await expect(
            h.service.useBalance(h.ctx, {
                orderId: 'order',
                expectedAmount: 501,
                amount: 300,
                idempotencyKey: 'stable',
            }),
        ).rejects.toThrow('金额已变化');
        await expect(
            h.service.useBalance(h.ctx, {
                orderId: 'order',
                expectedAmount: 500,
                amount: 301,
                idempotencyKey: 'stable',
            }),
        ).rejects.toThrow('余额不足');
        expect(h.referral.useAdditionalBalance).not.toHaveBeenCalled();
    });
    it('quotes only the price increase and pays through the existing service after the order lock', async () => {
        const h = harness();
        expect(await h.service.quote(h.ctx, 'order')).toMatchObject({
            outstandingAmount: 500,
            blockedReason: null,
        });
        await expect(h.service.pay(h.ctx, h.input)).resolves.toMatchObject({ state: 'PaymentSettled' });
        expect(h.phase).toEqual(['lock', 'pay']);
        expect(h.orders.addPaymentToOrder).toHaveBeenCalledWith(h.ctx, 'order', h.input.payment);
        expect(h.order.active).toBe(false);
    });
    it('lets an anonymous signed proof access only its own placed order', async () => {
        const h = harness();
        h.ctx.activeUserId = undefined;
        await expect(h.service.quote(h.ctx, 'order', 'valid-proof')).resolves.toMatchObject({
            outstandingAmount: 500,
        });
        await expect(
            h.service.pay(h.ctx, { ...h.input, confirmationToken: 'valid-proof' }),
        ).resolves.toMatchObject({ id: 'order' });
    });
    it.each(['expired-proof', 'no-proof', 'other-customer', 'other-order', 'other-store'])(
        'rejects %s before collecting money',
        async kind => {
            const h = harness();
            h.ctx.activeUserId = 'other-customer';
            if (kind === 'other-store') h.order.salesChannelId = 'other-store';
            if (kind === 'other-order') h.order.id = 'other-order';
            await expect(
                h.service.pay(h.ctx, {
                    ...h.input,
                    confirmationToken: ['other-order', 'other-store'].includes(kind)
                        ? 'valid-proof'
                        : kind === 'expired-proof'
                          ? 'expired'
                          : undefined,
                }),
            ).rejects.toThrow();
            expect(h.orders.addPaymentToOrder).not.toHaveBeenCalled();
        },
    );
    it.each(['Cancelled', 'Modifying', 'PaymentSettled', 'AddingItems'])(
        'rejects payment in %s',
        async state => {
            const h = harness();
            h.order.state = state;
            await expect(h.service.pay(h.ctx, h.input)).rejects.toThrow('无需补款');
            expect(h.orders.addPaymentToOrder).not.toHaveBeenCalled();
        },
    );
    it.each([0, -1, 499, 501, 1.5])('rejects an invalid or changed confirmed amount %s', async amount => {
        const h = harness();
        await expect(h.service.pay(h.ctx, { ...h.input, expectedAmount: amount })).rejects.toThrow(
            '金额已变化',
        );
        expect(h.orders.addPaymentToOrder).not.toHaveBeenCalled();
    });
    it.each(['Created', 'manual-review'])(
        'does not collect again while an original result is %s',
        async kind => {
            const h = harness();
            h.order.payments.push({
                state: kind === 'Created' ? 'Created' : 'Settled',
                amount: 500,
                method: 'real',
                metadata: kind === 'manual-review' ? { manualReview: { required: true } } : {},
            });
            await expect(h.service.pay(h.ctx, h.input)).rejects.toThrow('不要重复支付');
            expect(h.orders.addPaymentToOrder).not.toHaveBeenCalled();
        },
    );
    it.each(['PAYING', 'REVIEW', 'RELEASED'])('blocks collection from a %s resource hold', async state => {
        const h = harness();
        h.resources.hold.mockResolvedValue({ state } as never);
        await expect(h.service.pay(h.ctx, h.input)).rejects.toThrow('不要重复支付');
        expect(h.orders.addPaymentToOrder).not.toHaveBeenCalled();
    });
    it.each(['controlled-test-payment-fixture', 'usdt-trc20', 'not-enabled'])(
        'does not offer an unsupported %s shortcut',
        async method => {
            const h = harness();
            const quote = await h.service.quote(h.ctx, 'order');
            expect(quote.methods.some(item => item.code === method && item.isEligible)).toBe(false);
            await expect(
                h.service.pay(h.ctx, { ...h.input, payment: { method, metadata: {} } }),
            ).rejects.toThrow('不允许补款');
            expect(h.orders.addPaymentToOrder).not.toHaveBeenCalled();
        },
    );
});
