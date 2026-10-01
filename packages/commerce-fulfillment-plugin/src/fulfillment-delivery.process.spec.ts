import { describe, expect, it, vi } from 'vitest';

import { fulfillmentDeliveryProcess } from './fulfillment-delivery.process';
import { FulfillmentDeliveryService } from './fulfillment-delivery.service';

describe('fulfillmentDeliveryProcess', () => {
    it.each(['Pending', 'Shipped'])(
        'rejects a shared fulfillment containing an unpaid physical order before %s',
        async state => {
            const service = new FulfillmentDeliveryService(
                null as any,
                null as any,
                null as any,
                null as any,
                null as any,
            );
            await fulfillmentDeliveryProcess.init?.({ get: vi.fn().mockReturnValue(service) } as any);
            const fulfillment = {
                lines: [{ orderLineId: 'paid-line' }, { orderLineId: 'unpaid-line' }],
            } as any;
            const orders = [
                {
                    id: 'paid',
                    state: 'PaymentSettled',
                    lines: [{ id: 'paid-line', customFields: { fulfillmentTypeSnapshot: 'physical' } }],
                },
                {
                    id: 'unpaid',
                    state: 'ArrangingPayment',
                    lines: [{ id: 'unpaid-line', customFields: { fulfillmentTypeSnapshot: 'physical' } }],
                },
            ] as any;
            const transition = fulfillmentDeliveryProcess.onTransitionStart;
            if (!transition) throw new Error('Expected fulfillment transition guard');
            for (const sequence of [orders, [...orders].reverse()]) {
                expect(
                    await transition('Created', state, { ctx: {} as any, fulfillment, orders: sequence }),
                ).toContain('订单未付款');
            }
        },
    );

    it('records shipping and blocks proof-less physical delivery transitions', async () => {
        const service = {
            guardPhysicalFulfillmentPayment: vi.fn().mockResolvedValue(undefined),
            recordShippedTransition: vi.fn().mockResolvedValue(undefined),
            guardDeliveredTransition: vi.fn().mockResolvedValue('delivery proof required'),
            finalizeDeliveredTransition: vi.fn().mockResolvedValue(undefined),
        };
        await fulfillmentDeliveryProcess.init?.({ get: vi.fn().mockReturnValue(service) } as any);
        const data = { ctx: {}, fulfillment: { id: 'fulfillment-1' }, orders: [{ id: 'order-1' }] } as any;

        await expect(
            fulfillmentDeliveryProcess.onTransitionStart?.('Created', 'Pending', data),
        ).resolves.toBeUndefined();
        await expect(
            fulfillmentDeliveryProcess.onTransitionStart?.('Pending', 'Shipped', data),
        ).resolves.toBeUndefined();
        await fulfillmentDeliveryProcess.onTransitionEnd?.('Pending', 'Shipped', data);
        await expect(
            fulfillmentDeliveryProcess.onTransitionStart?.('Shipped', 'Delivered', data),
        ).resolves.toBe('delivery proof required');
        await fulfillmentDeliveryProcess.onTransitionEnd?.('Shipped', 'Delivered', data);

        expect(service.recordShippedTransition).toHaveBeenCalledOnce();
        expect(service.guardPhysicalFulfillmentPayment).toHaveBeenCalledTimes(2);
        expect(service.guardDeliveredTransition).toHaveBeenCalledOnce();
        expect(service.finalizeDeliveredTransition).toHaveBeenCalledOnce();
    });
});
