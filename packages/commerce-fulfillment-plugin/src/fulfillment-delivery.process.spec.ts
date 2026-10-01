import { describe, expect, it, vi } from 'vitest';

import { fulfillmentDeliveryProcess } from './fulfillment-delivery.process';

describe('fulfillmentDeliveryProcess', () => {
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
