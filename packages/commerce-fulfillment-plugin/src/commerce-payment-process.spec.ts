import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commercePaymentProcess } from './commerce-payment-process';

describe('commercePaymentProcess', () => {
    const connection = { getEntityOrThrow: vi.fn() };
    const orderService = {
        getNextOrderStates: vi.fn(),
        transitionFulfillmentToState: vi.fn(),
        transitionToState: vi.fn(),
    };

    beforeEach(async () => {
        vi.clearAllMocks();
        orderService.transitionFulfillmentToState.mockResolvedValue({ id: 'fulfillment-1' });
        orderService.transitionToState.mockResolvedValue({ id: 'order-1' });
        const services = [connection, orderService];
        await commercePaymentProcess.init?.({
            get: vi.fn(() => services.shift()),
        } as any);
    });

    it('delivers pending digital fulfillment after the order reaches an authorized state', async () => {
        connection.getEntityOrThrow.mockResolvedValue(digitalOrder('PaymentAuthorized', 'Pending'));

        await commercePaymentProcess.onTransitionEnd?.('Created', 'Authorized', {
            ctx: {},
            order: { id: 'order-1' },
        } as any);

        expect(orderService.transitionFulfillmentToState).toHaveBeenCalledWith(
            expect.anything(),
            'fulfillment-1',
            'Delivered',
        );
        expect(orderService.transitionToState).not.toHaveBeenCalled();
    });

    it('reconciles a previously-authorized digital-only order when payment settles', async () => {
        connection.getEntityOrThrow.mockResolvedValue(digitalOrder('PaymentSettled', 'Delivered'));
        orderService.getNextOrderStates.mockReturnValue(['Delivered']);

        await commercePaymentProcess.onTransitionEnd?.('Authorized', 'Settled', {
            ctx: {},
            order: { id: 'order-1' },
        } as any);

        expect(orderService.transitionFulfillmentToState).not.toHaveBeenCalled();
        expect(orderService.transitionToState).toHaveBeenCalledWith(
            expect.anything(),
            'order-1',
            'Delivered',
        );
    });

    it('reconciles a mixed order to partially delivered and leaves physical work pending', async () => {
        const order = digitalOrder('PaymentSettled', 'Delivered');
        order.lines.push({
            id: 'physical-line',
            quantity: 1,
            customFields: { fulfillmentTypeSnapshot: 'physical' },
            productVariant: { customFields: { fulfillmentType: 'physical' } },
        });
        connection.getEntityOrThrow.mockResolvedValue(order);
        orderService.getNextOrderStates.mockReturnValue(['PartiallyDelivered']);

        await commercePaymentProcess.onTransitionEnd?.('Authorized', 'Settled', {
            ctx: {},
            order: { id: 'order-1' },
        } as any);

        expect(orderService.transitionToState).toHaveBeenCalledWith(
            expect.anything(),
            'order-1',
            'PartiallyDelivered',
        );
    });

    it('ignores physical-only orders', async () => {
        connection.getEntityOrThrow.mockResolvedValue({
            ...digitalOrder('PaymentSettled', 'Delivered'),
            lines: [
                {
                    id: 'physical-line',
                    quantity: 1,
                    customFields: { fulfillmentTypeSnapshot: 'physical' },
                    productVariant: { customFields: { fulfillmentType: 'physical' } },
                },
            ],
            fulfillments: [],
        });

        await commercePaymentProcess.onTransitionEnd?.('Created', 'Settled', {
            ctx: {},
            order: { id: 'order-1' },
        } as any);

        expect(orderService.transitionFulfillmentToState).not.toHaveBeenCalled();
        expect(orderService.transitionToState).not.toHaveBeenCalled();
    });
});

function digitalOrder(
    state: 'PaymentAuthorized' | 'PaymentSettled',
    fulfillmentState: 'Pending' | 'Delivered',
) {
    const fulfillment = {
        id: 'fulfillment-1',
        handlerCode: 'digital-fulfillment',
        state: fulfillmentState,
        lines: [] as Array<{
            orderLineId: string;
            quantity: number;
            fulfillment: { state: 'Pending' | 'Delivered' };
        }>,
    };
    fulfillment.lines.push({
        orderLineId: 'digital-line',
        quantity: 1,
        fulfillment,
    });
    return {
        id: 'order-1',
        state,
        lines: [
            {
                id: 'digital-line',
                quantity: 1,
                customFields: { fulfillmentTypeSnapshot: 'digital' },
                productVariant: { customFields: { fulfillmentType: 'digital' } },
            },
        ],
        fulfillments: [fulfillment],
    };
}
