import { describe, expect, it } from 'vitest';

import {
    ORDER_STATUS_REFRESH_INTERVAL,
    orderNeedsStatusRefresh,
    orderStatusRefreshInterval,
} from './order-refresh';

describe('order status refresh', () => {
    it.each([
        'AddingItems',
        'ArrangingPayment',
        'PaymentAuthorized',
        'PaymentSettled',
        'PartiallyShipped',
        'Shipped',
        'PartiallyDelivered',
    ])('keeps refreshing mutable state %s', state => {
        expect(orderNeedsStatusRefresh(state)).toBe(true);
        expect(orderStatusRefreshInterval(state)).toBe(ORDER_STATUS_REFRESH_INTERVAL);
    });

    it.each(['Cancelled', 'Delivered', 'TestPaymentSettled'])('stops refreshing terminal state %s', state => {
        expect(orderNeedsStatusRefresh(state)).toBe(false);
        expect(orderStatusRefreshInterval(state)).toBe(false);
    });

    it('does not poll before an order is loaded', () => {
        expect(orderStatusRefreshInterval(undefined)).toBe(false);
    });
});
