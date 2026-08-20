import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commerceOrderProcess } from './commerce-order-process';

describe('commerceOrderProcess digital fulfillment', () => {
    const orderService = {
        createFulfillment: vi.fn(),
    };
    const productVariantService = { getSaleableStockLevel: vi.fn() };
    const stockMovementService = { createAllocationsForOrderLines: vi.fn() };

    beforeEach(async () => {
        vi.clearAllMocks();
        orderService.createFulfillment.mockResolvedValue({ id: 'fulfillment-1' });
        const services = [orderService, productVariantService, stockMovementService];
        await commerceOrderProcess.init?.({ get: vi.fn(() => services.shift()) } as any);
    });

    it('creates a pending digital fulfillment after payment settles', async () => {
        const order = {
            lines: [
                {
                    id: 'digital-line',
                    quantity: 2,
                    customFields: { fulfillmentTypeSnapshot: 'digital' },
                    productVariant: { customFields: { fulfillmentType: 'digital' } },
                },
                {
                    id: 'physical-line',
                    quantity: 1,
                    customFields: { fulfillmentTypeSnapshot: 'physical' },
                    productVariant: { customFields: { fulfillmentType: 'physical' } },
                },
            ],
        };

        await commerceOrderProcess.onTransitionEnd?.('ArrangingPayment', 'PaymentSettled', {
            ctx: { channelId: 'channel-1' },
            order,
        } as any);

        expect(orderService.createFulfillment).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                lines: [{ orderLineId: 'digital-line', quantity: 2 }],
                handler: { code: 'digital-fulfillment', arguments: [] },
            }),
        );
    });

    it('does not create another fulfillment for unrelated transitions', async () => {
        await commerceOrderProcess.onTransitionEnd?.('PaymentSettled', 'Shipped', {
            ctx: {},
            order: { lines: [] },
        } as any);

        expect(orderService.createFulfillment).not.toHaveBeenCalled();
    });
});
