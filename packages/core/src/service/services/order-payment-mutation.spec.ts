import { describe, expect, it, vi } from 'vitest';

import { OrderService } from './order.service';

function fixture(freshState = 'Authorized', salesChannelId = 'store') {
    const calls: string[] = [];
    const ctx = { channelId: 'store', translate: (key: string) => key };
    const tx = { ...ctx, transaction: 'read-committed' };
    const order = { id: 'order', salesChannelId };
    const before = { id: 'payment', state: 'Authorized', order };
    const fresh = { ...before, state: freshState };
    const paymentLock = {
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        execute: vi.fn(() => {
            calls.push('payment-lock');
            return Promise.resolve();
        }),
    };
    const paymentService = {
        findOneOrThrow: vi
            .fn()
            .mockImplementationOnce(() => {
                calls.push('read-owner');
                return Promise.resolve(before);
            })
            .mockImplementation(() => {
                calls.push('read-fresh');
                return Promise.resolve(fresh);
            }),
        getNextStates: vi.fn(payment => (payment.state === 'Authorized' ? ['Settled', 'Cancelled'] : [])),
        settlePayment: vi.fn(() => {
            calls.push('settle-handler');
            return Promise.resolve({ ...fresh, state: 'Settled' });
        }),
        cancelPayment: vi.fn(() => {
            calls.push('cancel-handler');
            return Promise.resolve({ ...fresh, state: 'Cancelled' });
        }),
        transitionToState: vi.fn((_ctx, _id, state) => {
            calls.push('transition-handler');
            return Promise.resolve({ ...fresh, state });
        }),
    };
    const lockOrderForRefund = vi.fn(() => {
        calls.push('cart-order-lock');
        return Promise.resolve();
    });
    const service = Object.assign(Object.create(OrderService.prototype), {
        paymentService,
        connection: { getRepository: vi.fn(() => ({ createQueryBuilder: () => paymentLock })) },
        withOrderMutationTransaction: vi.fn((_ctx, work) => {
            calls.push('transaction');
            return work(tx);
        }),
        lockOrderForRefund,
    }) as OrderService;
    return { service, paymentService, lockOrderForRefund, calls, ctx, tx };
}

describe('existing payment mutation boundary', () => {
    it.each(['settle', 'cancel', 'transition'] as const)(
        'locks and rereads before %s handler',
        async operation => {
            const f = fixture();
            if (operation === 'settle') await f.service.settlePayment(f.ctx as any, 'payment');
            else if (operation === 'cancel') await f.service.cancelPayment(f.ctx as any, 'payment');
            else await f.service.transitionPaymentToState(f.ctx as any, 'payment', 'Settled');
            expect(f.calls).toEqual([
                'transaction',
                'read-owner',
                'cart-order-lock',
                'payment-lock',
                'read-fresh',
                `${operation}-handler`,
            ]);
            expect(f.lockOrderForRefund).toHaveBeenCalledWith(f.tx, 'order');
            expect(f.paymentService.findOneOrThrow).toHaveBeenNthCalledWith(2, f.tx, 'payment');
        },
    );

    it.each(['settle', 'transition'] as const)(
        'does not repeat %s after locked reread observes Settled',
        async operation => {
            const f = fixture('Settled');
            const result =
                operation === 'settle'
                    ? await f.service.settlePayment(f.ctx as any, 'payment')
                    : await f.service.transitionPaymentToState(f.ctx as any, 'payment', 'Settled');
            expect(result).toMatchObject({ state: 'Settled' });
            expect(f.paymentService.settlePayment).not.toHaveBeenCalled();
            expect(f.paymentService.transitionToState).not.toHaveBeenCalled();
            expect(f.calls).toEqual([
                'transaction',
                'read-owner',
                'cart-order-lock',
                'payment-lock',
                'read-fresh',
            ]);
        },
    );

    it('does not repeat cancellation after locked reread observes Cancelled', async () => {
        const f = fixture('Cancelled');
        expect(await f.service.cancelPayment(f.ctx as any, 'payment')).toMatchObject({ state: 'Cancelled' });
        expect(f.paymentService.cancelPayment).not.toHaveBeenCalled();
    });

    it.each(['settle', 'transition'] as const)(
        'rejects %s from fresh Cancelled before a handler',
        async operation => {
            const f = fixture('Cancelled');
            const result =
                operation === 'settle'
                    ? await f.service.settlePayment(f.ctx as any, 'payment')
                    : await f.service.transitionPaymentToState(f.ctx as any, 'payment', 'Settled');
            expect(result).toMatchObject({
                __typename: 'PaymentStateTransitionError',
                fromState: 'Cancelled',
                toState: 'Settled',
            });
            expect(f.paymentService.settlePayment).not.toHaveBeenCalled();
            expect(f.paymentService.transitionToState).not.toHaveBeenCalled();
        },
    );

    it('preserves received funds when locked reread observes Settled before cancel', async () => {
        const f = fixture('Settled');
        await expect(f.service.cancelPayment(f.ctx as any, 'payment')).rejects.toThrow(
            '已到账款项必须通过退款处理',
        );
        expect(f.paymentService.cancelPayment).not.toHaveBeenCalled();
    });

    it('rejects another store before locks or handlers', async () => {
        const f = fixture('Authorized', 'another-store');
        await expect(f.service.settlePayment(f.ctx as any, 'payment')).rejects.toThrow();
        expect(f.lockOrderForRefund).not.toHaveBeenCalled();
        expect(f.paymentService.settlePayment).not.toHaveBeenCalled();
    });
});
