import { describe, expect, it } from 'vitest';

import { normalizeDeliveryEmail, orderConfirmationRecipient } from './order-confirmation-email';

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
