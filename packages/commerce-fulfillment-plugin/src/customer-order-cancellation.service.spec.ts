import { describe, expect, it, vi } from 'vitest';

import { CustomerOrderCancellationService } from './customer-order-cancellation.service';

function physicalOrder(overrides: Record<string, unknown> = {}) {
    return {
        id: 'order-1',
        state: 'PaymentAuthorized',
        customer: { user: { id: 'user-1' } },
        lines: [
            {
                customFields: { fulfillmentTypeSnapshot: 'physical' },
                productVariant: { customFields: { fulfillmentType: 'physical' } },
            },
        ],
        payments: [{ id: 'payment-1', state: 'Authorized' }],
        fulfillments: [],
        ...overrides,
    } as any;
}

function createService(order: any) {
    const connection = { getEntityOrThrow: vi.fn().mockResolvedValue(order) };
    const orderService = {
        cancelPayment: vi.fn().mockResolvedValue({ id: 'payment-1', state: 'Cancelled' }),
        cancelOrder: vi.fn().mockResolvedValue({ ...order, state: 'Cancelled' }),
    };
    const service = new CustomerOrderCancellationService(connection as any, orderService as any);
    const ctx = {
        activeUserId: 'user-1',
        channelId: 'channel-1',
        translate: (key: string) => key,
    } as any;
    return { service, connection, orderService, ctx };
}

describe('CustomerOrderCancellationService', () => {
    it('cancels an authorized payment before cancelling an unfulfilled physical order', async () => {
        const test = createService(physicalOrder());

        await expect(
            test.service.cancelAuthorizedPhysicalOrder(test.ctx, 'order-1', 'Changed my mind'),
        ).resolves.toMatchObject({ state: 'Cancelled' });

        expect(test.orderService.cancelPayment).toHaveBeenCalledWith(test.ctx, 'payment-1');
        expect(test.orderService.cancelOrder).toHaveBeenCalledWith(test.ctx, {
            orderId: 'order-1',
            cancelShipping: true,
            reason: 'Changed my mind',
        });
        expect(test.orderService.cancelPayment.mock.invocationCallOrder[0]).toBeLessThan(
            test.orderService.cancelOrder.mock.invocationCallOrder[0],
        );
    });

    it('rejects orders owned by another customer', async () => {
        const test = createService(physicalOrder({ customer: { user: { id: 'user-2' } } }));

        await expect(
            test.service.cancelAuthorizedPhysicalOrder(test.ctx, 'order-1', 'No longer needed'),
        ).rejects.toThrow('message.commerce-order-cancel-not-owned');
        expect(test.orderService.cancelPayment).not.toHaveBeenCalled();
    });

    it('rejects settled, digitally delivered and fulfilled orders', async () => {
        const settled = createService(
            physicalOrder({ state: 'PaymentSettled', payments: [{ id: 'payment-1', state: 'Settled' }] }),
        );
        const digital = createService(
            physicalOrder({
                lines: [
                    {
                        customFields: { fulfillmentTypeSnapshot: 'digital' },
                        productVariant: { customFields: { fulfillmentType: 'digital' } },
                    },
                ],
            }),
        );
        const fulfilled = createService(physicalOrder({ fulfillments: [{ id: 'fulfillment-1' }] }));

        await expect(
            settled.service.cancelAuthorizedPhysicalOrder(settled.ctx, 'order-1', 'Cancel'),
        ).rejects.toThrow('message.commerce-order-cancel-not-authorized');
        await expect(
            digital.service.cancelAuthorizedPhysicalOrder(digital.ctx, 'order-1', 'Cancel'),
        ).rejects.toThrow('message.commerce-order-cancel-digital-not-supported');
        await expect(
            fulfilled.service.cancelAuthorizedPhysicalOrder(fulfilled.ctx, 'order-1', 'Cancel'),
        ).rejects.toThrow('message.commerce-order-cancel-already-fulfilled');
    });

    it('requires a non-empty reason and propagates payment cancellation failures', async () => {
        const empty = createService(physicalOrder());
        await expect(
            empty.service.cancelAuthorizedPhysicalOrder(empty.ctx, 'order-1', '   '),
        ).rejects.toThrow('message.commerce-order-cancel-reason-required');

        const failed = createService(physicalOrder());
        failed.orderService.cancelPayment.mockResolvedValue({
            __typename: 'CancelPaymentError',
            errorCode: 'CANCEL_PAYMENT_ERROR',
            message: 'Provider rejected cancellation',
        });
        await expect(
            failed.service.cancelAuthorizedPhysicalOrder(failed.ctx, 'order-1', 'Cancel'),
        ).rejects.toThrow('Provider rejected cancellation');
        expect(failed.orderService.cancelOrder).not.toHaveBeenCalled();
    });
});
