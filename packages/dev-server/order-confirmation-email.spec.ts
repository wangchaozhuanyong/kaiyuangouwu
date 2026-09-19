import { describe, expect, it } from 'vitest';

import {
    deliveryOnlyEmailHandlers,
    normalizeDeliveryEmail,
    orderConfirmationRecipient,
} from './order-confirmation-email';

describe('customer order email policy', () => {
    it('removes the generic paid-order email and preserves delivery and account mail', () => {
        const handlers = [
            { type: 'order-confirmation' },
            { type: 'auto-card-delivery' },
            { type: 'manual-digital-delivery' },
            { type: 'email-verification' },
        ];

        expect(deliveryOnlyEmailHandlers(handlers).map(handler => handler.type)).toEqual([
            'auto-card-delivery',
            'manual-digital-delivery',
            'email-verification',
        ]);
        expect(handlers).toHaveLength(4);
    });
});

describe('digital order confirmation email', () => {
    it('normalizes and uses the order-level delivery email for a digital order', () => {
        expect(normalizeDeliveryEmail('  Buyer+Digital@Example.COM ')).toBe('buyer+digital@example.com');
        expect(orderConfirmationRecipient(true, '  Buyer+Digital@Example.COM ', 'account@example.com')).toBe(
            'buyer+digital@example.com',
        );
    });

    it('falls back to the customer email for old digital orders without a delivery email', () => {
        expect(orderConfirmationRecipient(true, null, 'account@example.com')).toBe('account@example.com');
    });

    it('keeps physical order email routing unchanged', () => {
        expect(orderConfirmationRecipient(false, 'other@example.com', 'account@example.com')).toBe(
            'account@example.com',
        );
    });

    it('uses the recorded delivery email when a mixed order contains digital products', () => {
        expect(orderConfirmationRecipient(true, 'delivery@example.com', 'account@example.com')).toBe(
            'delivery@example.com',
        );
    });
});
