import { describe, expect, it, vi } from 'vitest';

import { DigitalProductService } from './digital-product.service';

function fixture() {
    const orders = { registerOrderModificationValidator: vi.fn() };
    const service = new DigitalProductService({} as any, orders as any, {} as any);
    const order = {
        id: 'order',
        orderPlacedAt: new Date(),
        lines: [
            {
                id: 'digital-line',
                productVariantId: 'variant',
                quantity: 2,
                customFields: { fulfillmentTypeSnapshot: 'digital' },
            },
        ],
        payments: [
            {
                state: 'Settled',
                refunds: [{ state: 'Pending', lines: [{ orderLineId: 'digital-line', quantity: 1 }] }],
            },
        ],
    } as any;
    return { service, orders, order };
}

describe('digital modification before payment or inventory side effects', () => {
    it('registers one shared core modification validator', () => {
        const test = fixture();
        test.service.onApplicationBootstrap();
        expect(test.orders.registerOrderModificationValidator).toHaveBeenCalledWith(
            'commerce-digital-refunded-unit-increase',
            expect.any(Function),
        );
    });

    it.each(['Pending', 'Settled'])(
        'rejects a refunded existing legacy line increase in %s without requiring a reservation',
        state => {
            const test = fixture();
            test.order.payments[0].refunds[0].state = state;
            const before = JSON.stringify(test.order);
            for (const dryRun of [true, false]) {
                expect(() =>
                    test.service.validateModification(test.order, {
                        orderId: 'order',
                        dryRun,
                        adjustOrderLines: [{ orderLineId: 'digital-line', quantity: 3 }],
                    }),
                ).toThrow('请新建订单购买');
                expect(() =>
                    test.service.validateModification(test.order, {
                        orderId: 'order',
                        dryRun,
                        addItems: [{ productVariantId: 'variant', quantity: 1 }],
                    }),
                ).toThrow('请新建订单购买');
            }
            expect(JSON.stringify(test.order)).toBe(before);
        },
    );

    it('rejects restoring a fully refunded zero-quantity existing line', () => {
        const test = fixture();
        test.order.lines[0].quantity = 0;
        test.order.payments[0].refunds[0].state = 'Settled';
        test.order.payments[0].refunds[0].lines[0].quantity = 2;
        expect(() =>
            test.service.validateModification(test.order, {
                orderId: 'order',
                dryRun: false,
                adjustOrderLines: [{ orderLineId: 'digital-line', quantity: 1 }],
            }),
        ).toThrow('不能在原订单增加数量');
    });

    it.each(['compensation', 'Failed', 'other-line'])('does not block a safe increase for %s', condition => {
        const test = fixture();
        if (condition === 'compensation') test.order.payments[0].refunds[0].lines = [];
        if (condition === 'Failed') test.order.payments[0].refunds[0].state = 'Failed';
        if (condition === 'other-line')
            test.order.payments[0].refunds[0].lines[0].orderLineId = 'another-line';
        expect(() =>
            test.service.validateModification(test.order, {
                orderId: 'order',
                dryRun: false,
                adjustOrderLines: [{ orderLineId: 'digital-line', quantity: 3 }],
            }),
        ).not.toThrow();
    });

    it('allows reduction and a new SKU without reactivating the refunded units', () => {
        const test = fixture();
        expect(() =>
            test.service.validateModification(test.order, {
                orderId: 'order',
                dryRun: true,
                adjustOrderLines: [{ orderLineId: 'digital-line', quantity: 1 }],
                addItems: [{ productVariantId: 'new-variant', quantity: 1 }],
            }),
        ).not.toThrow();
    });
});
