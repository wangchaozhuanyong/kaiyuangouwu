import { describe, expect, it } from 'vitest';

import { isConfirmedControlledTestPayment } from './controlled-test-payment';

describe('confirmed controlled test payment evidence', () => {
    it('requires the controlled handler method and its boolean server marker', () => {
        expect(
            isConfirmedControlledTestPayment({
                method: 'controlled-test-payment-store',
                metadata: { public: { testPayment: true } },
            }),
        ).toBe(true);
    });

    it.each([
        {},
        { method: 'controlled-test-payment-store' },
        { method: 'real-payment', metadata: { public: { testPayment: true } } },
        { method: 'controlled-test-payment-store', metadata: { public: { testPayment: false } } },
        { method: 'controlled-test-payment-store', metadata: { public: { testPayment: 'true' } } },
    ])('does not establish simulation from incomplete or client-only evidence: %j', payment => {
        expect(isConfirmedControlledTestPayment(payment)).toBe(false);
    });
});
