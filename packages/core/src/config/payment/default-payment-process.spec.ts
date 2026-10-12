import { describe, expect, it, vi } from 'vitest';

import { defaultPaymentProcess } from './default-payment-process';

describe('defaultPaymentProcess', () => {
    it('records a zero-total pending receipt without advancing the paid order state', async () => {
        const orderService = {
            getOrderPayments: vi.fn().mockResolvedValue([{ amount: 0, state: 'PendingManual' }]),
            transitionToState: vi.fn(),
        };
        const historyService = { createHistoryEntryForOrder: vi.fn() };
        await defaultPaymentProcess.init?.({
            get: (provider: { name: string }) =>
                provider.name === 'OrderService'
                    ? orderService
                    : provider.name === 'HistoryService'
                      ? historyService
                      : {},
        } as any);
        await defaultPaymentProcess.onTransitionEnd?.(
            'Created',
            'PendingManual' as any,
            {
                ctx: {},
                payment: { id: 'payment-0' },
                order: { id: 'order-0', state: 'ArrangingPayment', totalWithTax: 0 },
            } as any,
        );
        expect(historyService.createHistoryEntryForOrder).toHaveBeenCalledTimes(1);
        expect(orderService.transitionToState).not.toHaveBeenCalled();
    });

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
