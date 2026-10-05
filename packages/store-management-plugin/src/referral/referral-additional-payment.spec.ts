import { TransactionalConnection } from '@vendure/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { referralBalancePaymentHandler } from './referral-payment-handler';
import { configureReferralPaymentProofSecret, createReferralPaymentProof } from './referral-payment-proof';
import { ReferralService } from './referral.service';
function fixture() {
    const ctx: any = { channelId: 'store', activeUserId: 'owner' };
    const order: any = {
        id: 'order',
        salesChannelId: 'store',
        state: 'ArrangingAdditionalPayment',
        active: false,
        orderPlacedAt: new Date(),
        currencyCode: 'CNY',
        totalWithTax: 1500,
        customer: { id: 'customer', user: { id: 'owner' } },
        payments: [{ amount: 1000, state: 'Settled', method: 'real', metadata: {} }],
    };
    const usage: any = {
        id: 'usage',
        channelId: 'store',
        customerId: 'customer',
        currencyCode: 'CNY',
        amount: 500,
        status: 'RESERVED',
        resourceType: 'ORDER_ADDITIONAL_PAYMENT',
        resourceId: 'order:request',
        metadata: { orderId: 'order' },
    };
    const spend = {
        reserve: vi.fn().mockResolvedValue(usage),
        capture: vi.fn().mockResolvedValue(usage),
        refundCaptured: vi.fn().mockResolvedValue(usage),
    };
    const connection: any = {
        getRepository: (
            _ctx: any,
            entity: {
                name: string;
            },
        ) => ({
            findOne: vi
                .fn()
                .mockResolvedValue(entity.name === 'ReferralWalletUsage' ? usage : { availableBalance: 600 }),
        }),
    };
    const orders = {
        withOrderMutationTransaction: vi.fn((ctxValue, op) => Promise.resolve(op(ctxValue))),
        lockOrderForRefund: vi.fn(),
        findOne: vi.fn().mockResolvedValue(order),
        addPaymentToOrder: vi.fn().mockResolvedValue({ ...order, state: 'PaymentSettled' }),
    };
    const service: ReferralService = Object.assign(Object.create(ReferralService.prototype), {
        connection,
        orderService: orders,
        walletSpend: spend,
        getConfig: vi.fn().mockResolvedValue({ allowBalanceSpend: true }),
    });
    void referralBalancePaymentHandler.init?.({
        get: (token: unknown) => (token === TransactionalConnection ? connection : spend),
    } as any);
    const proof = () =>
        createReferralPaymentProof({
            reservationId: 'usage',
            walletUsage: true,
            channelId: 'store',
            orderId: 'order',
            customerId: 'customer',
            currencyCode: 'CNY',
            amount: 500,
            expiresAt: Date.now() + 60000,
        });
    return { ctx, order, usage, spend, connection, orders, service, proof };
}
beforeEach(() => configureReferralPaymentProofSecret('synthetic-wallet-proof-key-not-a-live-secret'));
describe('placed order wallet usage and refund source', () => {
    it('reserves a store/order-scoped usage before payment without creating a legacy one-use-per-order record', async () => {
        const h = fixture();
        await h.service.useAdditionalBalance(h.ctx, 'order', 500, 500, 'stable');
        expect(h.orders.lockOrderForRefund).toHaveBeenCalledWith(h.ctx, 'order');
        expect(h.spend.reserve).toHaveBeenCalledWith(
            h.ctx,
            expect.objectContaining({
                amount: 500,
                customerId: 'customer',
                resourceType: 'ORDER_ADDITIONAL_PAYMENT',
                resourceId: expect.stringMatching(/^order:/),
                metadata: { orderId: 'order' },
            }),
        );
        expect(h.orders.addPaymentToOrder).toHaveBeenCalledWith(
            h.ctx,
            'order',
            expect.objectContaining({ method: 'referral-balance' }),
        );
        expect(h.order.active).toBe(false);
    });
    it.each(['wrong-owner', 'wrong-store', 'Cancelled', 'Modifying', 'stale', 'pending'])(
        'rejects %s before reserving money',
        async reason => {
            const h = fixture();
            if (reason === 'wrong-owner') h.ctx.activeUserId = 'another-user';
            else if (reason === 'wrong-store') h.order.salesChannelId = 'other-store';
            else if (reason === 'stale') h.order.totalWithTax = 1600;
            else if (reason === 'pending') h.order.payments.push({ state: 'Created', amount: 500 });
            else h.order.state = reason;
            await expect(
                h.service.useAdditionalBalance(h.ctx, 'order', 500, 500, 'stable'),
            ).rejects.toThrow();
            expect(h.spend.reserve).not.toHaveBeenCalled();
        },
    );
    it('captures the verified reserved usage and identifies it separately from legacy balance payments', async () => {
        const h = fixture();
        const result = await referralBalancePaymentHandler.createPayment(h.ctx, h.order, 500, [], {
            proof: h.proof(),
        });
        expect(result).toMatchObject({
            state: 'Settled',
            amount: 500,
            transactionId: 'wallet-usage:usage',
            metadata: { public: { walletUsageId: 'usage' } },
        });
        expect(h.spend.capture).toHaveBeenCalledOnce();
        h.usage.status = 'CAPTURED';
        expect(
            await referralBalancePaymentHandler.createPayment(h.ctx, h.order, 500, [], { proof: h.proof() }),
        ).toMatchObject({ state: 'Declined' });
        expect(h.spend.capture).toHaveBeenCalledOnce();
    });
    it('rejects a foreign issuing store even when the order and customer identifiers match', async () => {
        const h = fixture();
        h.ctx.channelId = 'other-store';
        expect(
            await referralBalancePaymentHandler.createPayment(h.ctx, h.order, 500, [], { proof: h.proof() }),
        ).toMatchObject({ state: 'Declined' });
        expect(h.spend.capture).not.toHaveBeenCalled();
    });
    it('refunds only the source usage with a stable operation key and rejects a mismatched order', async () => {
        const h = fixture();
        h.usage.status = 'CAPTURED';
        const input: any = { paymentId: 'payment', idempotencyKey: 'stable-refund' };
        const payment: any = { id: 'payment', amount: 500, metadata: { public: { walletUsageId: 'usage' } } };
        await referralBalancePaymentHandler.createRefund(h.ctx, input, 200, h.order, payment, [], {} as any);
        const first = h.spend.refundCaptured.mock.calls[0][1];
        await referralBalancePaymentHandler.createRefund(h.ctx, input, 200, h.order, payment, [], {} as any);
        expect(h.spend.refundCaptured.mock.calls[1][1].operationKey).toBe(first.operationKey);
        h.usage.metadata.orderId = 'other-order';
        await expect(
            referralBalancePaymentHandler.createRefund(h.ctx, input, 200, h.order, payment, [], {} as any),
        ).rejects.toThrow('来源');
        expect(h.spend.refundCaptured).toHaveBeenCalledTimes(2);
    });
    it('does not automatically return captured legacy balance when only delivery is cancelled', async () => {
        const h = fixture();
        const use = { status: 'CAPTURED', amount: 500, refundedAmount: 0 };
        Object.assign(h.service, {
            connection: {
                rawConnection: { options: { type: 'sqljs' } },
                getRepository: (
                    _ctx: unknown,
                    entity: {
                        name: string;
                    },
                ) => ({
                    findOne: vi.fn().mockResolvedValue(entity.name === 'ReferralBalanceUse' ? use : null),
                }),
            },
            applyWalletDelta: vi.fn(),
        });
        await (h.service as any).handleCancelledOrder(h.ctx, 'order');
        expect((h.service as any).applyWalletDelta).not.toHaveBeenCalled();
        expect(use).toMatchObject({ status: 'CAPTURED', refundedAmount: 0 });
    });
});
