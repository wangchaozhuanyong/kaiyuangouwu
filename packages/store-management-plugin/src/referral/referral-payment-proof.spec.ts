import { describe, expect, it } from 'vitest';

import {
    configureReferralPaymentProofSecret,
    createReferralPaymentProof,
    verifyReferralPaymentProof,
} from './referral-payment-proof';

describe('referral payment proof', () => {
    it('accepts an intact, unexpired proof and rejects tampering', () => {
        configureReferralPaymentProofSecret('test-secret-at-least-32-characters-long');
        const proof = createReferralPaymentProof({
            reservationId: 'reservation-1',
            orderId: 'order-1',
            customerId: 'customer-1',
            currencyCode: 'CNY',
            amount: 1_234,
            expiresAt: Date.now() + 60_000,
        });

        expect(verifyReferralPaymentProof(proof)).toMatchObject({ amount: 1_234, orderId: 'order-1' });
        expect(verifyReferralPaymentProof(`${proof.slice(0, -1)}x`)).toBeNull();
    });

    it('rejects expired proofs', () => {
        const proof = createReferralPaymentProof({
            reservationId: 'reservation-2',
            orderId: 'order-2',
            customerId: 'customer-2',
            currencyCode: 'MYR',
            amount: 500,
            expiresAt: Date.now() - 1,
        });
        expect(verifyReferralPaymentProof(proof)).toBeNull();
    });
});
