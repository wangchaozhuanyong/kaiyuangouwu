import { describe, expect, it } from 'vitest';

import { normalizeDeliveryEmail, shouldSendOrderConfirmation } from './order-confirmation-email';

describe('customer order email policy', () => {
    it.each([
        ['PHYSICAL', true],
        ['MIXED', true],
        ['DIGITAL', false],
    ] as const)('sends the standard confirmation for %s orders: %s', (fulfillmentType, expected) => {
        expect(shouldSendOrderConfirmation(fulfillmentType)).toBe(expected);
    });

    it('normalizes the read-only delivery email used by digital delivery handlers', () => {
        expect(normalizeDeliveryEmail('  Buyer+Digital@Example.COM ')).toBe('buyer+digital@example.com');
        expect(normalizeDeliveryEmail('not-an-email')).toBeUndefined();
    });
});
