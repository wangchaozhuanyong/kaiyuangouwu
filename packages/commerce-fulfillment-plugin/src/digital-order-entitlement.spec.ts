import { Order, OrderLine, Payment } from '@vendure/core';
import { describe, expect, it } from 'vitest';

import { digitalDeliverableQuantity } from './digital-order-entitlement';

function fixture() {
    const line = new OrderLine({ id: 'line-1', quantity: 2, orderPlacedQuantity: 2 });
    const order = new Order({
        active: false,
        state: 'PaymentSettled',
        subTotalWithTax: 100,
        shippingWithTax: 0,
        payments: [new Payment({ state: 'Settled', amount: 100, method: 'real-provider', refunds: [] })],
    });
    return { order, line, quantity: () => digitalDeliverableQuantity(order, line) };
}

describe('persisted digital entitlement payment boundary', () => {
    it.each(
        ['Settled', 'Authorized', 'Declined', 'Cancelled'].flatMap(state =>
            ['method', 'server-marker'].map(identity => ({ state, identity })),
        ),
    )(
        'denies content entitlement with full real funding and $state test identity via $identity',
        ({ state, identity }) => {
            const test = fixture();
            test.order.payments.push(
                new Payment({
                    state: state as Payment['state'],
                    amount: 100,
                    method:
                        identity === 'method' ? 'controlled-test-payment-platform' : 'historical-provider',
                    metadata: { public: { testPayment: identity === 'server-marker' } },
                    refunds: [],
                }),
            );
            expect(test.quantity()).toBe(0);
        },
    );

    it.each(['Created', 'TestSettled', 'unknown', 'manual-review'])(
        'denies entitlement while payment evidence %s needs review',
        evidence => {
            const test = fixture();
            test.order.payments.push(
                new Payment({
                    state: (evidence === 'manual-review' ? 'Settled' : evidence) as Payment['state'],
                    amount: 1,
                    method: 'real-provider',
                    metadata: { manualReview: { required: evidence === 'manual-review' } },
                    refunds: [],
                }),
            );
            expect(test.quantity()).toBe(0);
        },
    );

    it('preserves historical real entitlement and item-refund quantities', () => {
        const test = fixture();
        test.order.payments.push(new Payment({ state: 'Declined', method: 'real-provider', amount: 100 }));
        expect(test.quantity()).toBe(2);
        test.order.payments[0].refunds.push({
            state: 'Pending',
            lines: [{ orderLineId: test.line.id, quantity: 1 }],
        } as any);
        expect(test.quantity()).toBe(1);
    });

    it('requires actual settled funds for the content entitlement', () => {
        const test = fixture();
        test.order.payments[0].state = 'Authorized';
        expect(test.quantity()).toBe(0);
        test.order.payments = [];
        expect(test.quantity()).toBe(0);
    });
});
