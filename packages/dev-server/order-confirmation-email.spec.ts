import { describe, expect, it } from 'vitest';

import { normalizeDeliveryEmail, shouldSendOrderConfirmation } from './order-confirmation-email';

describe('customer order email policy', () => {
    it.each([
        ['PHYSICAL', false],
        ['MIXED', false],
        ['DIGITAL', false],
    ] as const)('suppresses payment confirmation for %s orders', (fulfillmentType, expected) => {
        expect(shouldSendOrderConfirmation(fulfillmentType)).toBe(expected);
    });

    it('normalizes the read-only delivery email used by digital delivery handlers', () => {
        expect(normalizeDeliveryEmail('  Buyer+Digital@Example.COM ')).toBe('buyer+digital@example.com');
        expect(normalizeDeliveryEmail('not-an-email')).toBeUndefined();
    });
});
