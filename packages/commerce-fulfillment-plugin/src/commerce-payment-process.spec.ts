vi.mock('./commerce-order-process', () => ({ fulfillDigitalOrder: vi.fn().mockResolvedValue(undefined) }));
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fulfillDigitalOrder } from './commerce-order-process';
import { commercePaymentProcess } from './commerce-payment-process';

vi.mock('./commerce-order-process', () => ({ fulfillDigitalOrder: vi.fn().mockResolvedValue(undefined) }));

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

    it('does not deliver digital content on authorization without actual settlement', async () => {
        connection.getEntityOrThrow.mockResolvedValue(digitalOrder('PaymentAuthorized', 'Pending'));

        await commercePaymentProcess.onTransitionEnd?.('Created', 'Authorized', {
            ctx: {},
            order: { id: 'order-1' },
        } as any);

        expect(orderService.transitionFulfillmentToState).not.toHaveBeenCalled();
        expect(fulfillDigitalOrder).not.toHaveBeenCalled();
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
        expect(fulfillDigitalOrder).not.toHaveBeenCalled();
    });

    it('uses the single delivery entry only after the linked top-up restored the persisted paid state', async () => {
        const order = digitalOrder('PaymentSettled', 'Pending');
        connection.getEntityOrThrow.mockResolvedValue(order);
        orderService.getNextOrderStates.mockReturnValue([]);
        await commercePaymentProcess.onTransitionEnd?.('Created', 'Settled', {
            ctx: {},
            order: { id: order.id, state: 'ArrangingAdditionalPayment' },
        } as any);
        expect(fulfillDigitalOrder).toHaveBeenCalledWith(expect.anything(), order.id);
        expect(orderService.transitionFulfillmentToState).toHaveBeenCalledWith(
            expect.anything(),
            'fulfillment-1',
            'Delivered',
        );
    });

    it.each(['ArrangingAdditionalPayment', 'Modifying'])(
        'keeps delivery gated while the persisted order is %s',
        async state => {
            connection.getEntityOrThrow.mockResolvedValue({
                ...digitalOrder('PaymentSettled', 'Pending'),
                state,
            });
            await commercePaymentProcess.onTransitionEnd?.('Created', 'Settled', {
                ctx: {},
                order: { id: 'order-1' },
            } as any);
            expect(fulfillDigitalOrder).not.toHaveBeenCalled();
            expect(orderService.transitionFulfillmentToState).not.toHaveBeenCalled();
        },
    );
    it('reuses digital fulfillment when an actual capture occurs after physical shipment', async () => {
        connection.getEntityOrThrow.mockResolvedValue({
            ...digitalOrder('PaymentSettled', 'Pending'),
            state: 'PartiallyShipped',
        });
        await commercePaymentProcess.onTransitionEnd?.('Authorized', 'Settled', {
            ctx: {},
            order: { id: 'order-1' },
        } as any);
        expect(fulfillDigitalOrder).toHaveBeenCalledWith(expect.anything(), 'order-1');
        expect(orderService.transitionToState).not.toHaveBeenCalled();
    });

    it.each(['controlled-test-payment-test', 'metadata-test', 'underpaid', 'manual-review'])(
        'does not use %s as settled delivery funds',
        async source => {
            const order = digitalOrder('PaymentSettled', 'Pending');
            const payment = order.payments[0];
            if (source === 'controlled-test-payment-test') payment.method = source;
            if (source === 'metadata-test') payment.metadata = { public: { testPayment: true } };
            if (source === 'manual-review') payment.metadata = { manualReview: { required: true } };
            if (source === 'underpaid') payment.amount = 99;
            connection.getEntityOrThrow.mockResolvedValue(order);
            await commercePaymentProcess.onTransitionEnd?.('Created', 'Settled', {
                ctx: {},
                order: { id: order.id },
            } as any);
            expect(fulfillDigitalOrder).not.toHaveBeenCalled();
        },
    );
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
        active: false,
        orderPlacedAt: new Date(),
        totalWithTax: 100,
        payments: [{ amount: 100, state: 'Settled', method: 'receipt', metadata: {} as any, refunds: [] }],
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
