import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** A receipt is issued only by the protected Admin confirmation operation. */
export interface OfflinePaymentReceipt {
    channelId: string;
    orderId: string;
    paymentId: string;
    amount: number;
    currencyCode: string;
    transactionId: string;
    evidenceReference: string;
    receivedAt: number;
    verifiedBy: string;
    idempotencyKey: string;
    purpose?: 'REFUND_ONLY';
}

// Reuse the already-required server signing key, with a distinct cryptographic domain.
// Development uses a process-local key; no new secret or database column is introduced.
const receiptKey = process.env.ORDER_CONFIRMATION_TOKEN_SECRET?.trim() || randomBytes(32).toString('hex');

export function createOfflinePaymentProof(receipt: OfflinePaymentReceipt): string {
    const encoded = Buffer.from(JSON.stringify(receipt)).toString('base64url');
    return `${encoded}.${sign(encoded)}`;
}

export function verifyOfflinePaymentProof(value: unknown): OfflinePaymentReceipt | null {
    if (typeof value !== 'string' || value.length > 8192) return null;
    const [encoded, signature, extra] = value.split('.');
    if (!encoded || !signature || extra) return null;
    const actual = Buffer.from(signature);
    const expected = Buffer.from(sign(encoded));
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    try {
        const receipt = JSON.parse(
            Buffer.from(encoded, 'base64url').toString('utf8'),
        ) as OfflinePaymentReceipt;
        if (
            !receipt.channelId ||
            !receipt.orderId ||
            !receipt.paymentId ||
            !receipt.verifiedBy ||
            !receipt.transactionId ||
            !receipt.evidenceReference ||
            !receipt.idempotencyKey ||
            !Number.isSafeInteger(receipt.amount) ||
            receipt.amount < 0 ||
            !Number.isSafeInteger(receipt.receivedAt) ||
            receipt.receivedAt <= 0 ||
            receipt.receivedAt > Date.now()
        )
            return null;
        return receipt;
    } catch {
        return null;
    }
}

function sign(encoded: string): string {
    return createHmac('sha256', receiptKey)
        .update(`vendure-offline-receipt:v1:${encoded}`)
        .digest('base64url');
}
