import { describe, expect, it, vi } from 'vitest';

import { defaultPaymentProcess } from './default-payment-process';

describe('defaultPaymentProcess', () => {
    it('rejects settlement when the covered order cannot enter PaymentSettled', async () => {
        const transitionError = {
            __typename: 'OrderStateTransitionError',
            errorCode: 'ORDER_STATE_TRANSITION_ERROR',
            message: 'The order could not transition',
            transitionError: 'Insufficient physical stock',
            fromState: 'ArrangingPayment',
            toState: 'PaymentSettled',
        };
        const orderService = {
            getOrderPayments: vi.fn().mockResolvedValue([{ amount: 1_500, state: 'Settled', refunds: [] }]),
            transitionToState: vi.fn().mockResolvedValue(transitionError),
        };
        const historyService = { createHistoryEntryForOrder: vi.fn().mockResolvedValue(undefined) };
        const injector = {
            get(provider: { name?: string }) {
                if (provider.name === 'OrderService') return orderService;
                if (provider.name === 'HistoryService') return historyService;
                return {};
            },
        };
        await defaultPaymentProcess.init?.(injector as any);

        await expect(
            defaultPaymentProcess.onTransitionEnd?.('Created', 'Settled', {
                ctx: {},
                payment: { id: 'payment-1' },
                order: {
                    id: 'order-1',
                    state: 'ArrangingPayment',
                    totalWithTax: 1_500,
                },
            } as any),
        ).rejects.toThrow('Insufficient physical stock');
        expect(orderService.transitionToState).toHaveBeenCalledWith(
            expect.anything(),
            'order-1',
            'PaymentSettled',
        );
    });
});
