import { describe, expect, it } from 'vitest';

import { createOfflinePaymentProof, verifyOfflinePaymentProof } from './offline-payment-proof';
const receipt = {
    channelId: 'shop-a',
    orderId: 'order-a',
    paymentId: 'payment-a',
    amount: 1400,
    currencyCode: 'MYR',
    transactionId: 'local-bank-receipt',
    evidenceReference: 'synthetic://bank-receipt',
    receivedAt: Date.now() - 60_000,
    verifiedBy: 'admin-a',
    idempotencyKey: 'local-confirm-1',
};
describe('private offline receipt proof', () => {
    it('preserves actual receipt time and amount in a verified signed receipt', () => {
        expect(verifyOfflinePaymentProof(createOfflinePaymentProof(receipt))).toEqual(receipt);
    });
    it('rejects tampered amount, receipt, malformed proof, future time and invalid money', () => {
        const proof = createOfflinePaymentProof(receipt);
        const [, signature] = proof.split('.');
        const replacement = Buffer.from(JSON.stringify({ ...receipt, amount: 1 })).toString('base64url');
        expect(verifyOfflinePaymentProof(`${replacement}.${signature}`)).toBeNull();
        for (const value of [
            null,
            '',
            `${proof}.extra`,
            createOfflinePaymentProof({ ...receipt, amount: -1 }),
            createOfflinePaymentProof({ ...receipt, receivedAt: Date.now() + 60_000 }),
        ])
            expect(verifyOfflinePaymentProof(value)).toBeNull();
    });
});
