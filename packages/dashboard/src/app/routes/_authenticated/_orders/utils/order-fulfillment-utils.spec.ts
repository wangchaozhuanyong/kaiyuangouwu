import { describe, expect, it } from 'vitest';

import { getOrdersReadyForFulfillment, isOrderReadyForFulfillment } from './order-fulfillment-utils.js';

describe('order fulfillment queue', () => {
    it.each(['PaymentAuthorized', 'PaymentSettled'])('accepts the %s state', state => {
        expect(isOrderReadyForFulfillment({ state })).toBe(true);
    });

    it.each(['ArrangingPayment', 'Shipped', 'Delivered', 'Cancelled'])('rejects the %s state', state => {
        expect(isOrderReadyForFulfillment({ state })).toBe(false);
    });

    it('keeps only orders that can be fulfilled', () => {
        const orders = [
            { id: '1', code: 'A-1', state: 'PaymentSettled' },
            { id: '2', code: 'A-2', state: 'Delivered' },
            { id: '3', code: 'A-3', state: 'PaymentAuthorized' },
        ];

        expect(getOrdersReadyForFulfillment(orders).map(order => order.id)).toEqual(['1', '3']);
    });
});
