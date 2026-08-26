import { createHmac, timingSafeEqual } from 'node:crypto';

export interface ReferralPaymentProofPayload {
    version: 1;
    reservationId: string;
    orderId: string;
    customerId: string;
    currencyCode: string;
    amount: number;
    expiresAt: number;
}

let paymentProofSecret = 'development-referral-payment-proof-secret';

export function configureReferralPaymentProofSecret(secret: string): void {
    paymentProofSecret = secret;
}

export function createReferralPaymentProof(payload: Omit<ReferralPaymentProofPayload, 'version'>): string {
    const encoded = Buffer.from(JSON.stringify({ version: 1, ...payload }), 'utf8').toString('base64url');
    return `${encoded}.${sign(encoded)}`;
}

export function verifyReferralPaymentProof(proof: unknown): ReferralPaymentProofPayload | null {
    if (typeof proof !== 'string') return null;
    const [encoded, signature, extra] = proof.split('.');
    if (!encoded || !signature || extra) return null;
    const actual = Buffer.from(signature);
    const expected = Buffer.from(sign(encoded));
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    try {
        const payload = JSON.parse(
            Buffer.from(encoded, 'base64url').toString('utf8'),
        ) as Partial<ReferralPaymentProofPayload>;
        if (
            payload.version !== 1 ||
            !payload.reservationId ||
            !payload.orderId ||
            !payload.customerId ||
            !payload.currencyCode ||
            !Number.isInteger(payload.amount) ||
            Number(payload.amount) <= 0 ||
            !Number.isFinite(payload.expiresAt) ||
            Number(payload.expiresAt) <= Date.now()
        ) {
            return null;
        }
        return payload as ReferralPaymentProofPayload;
    } catch {
        return null;
    }
}

function sign(value: string): string {
    return createHmac('sha256', paymentProofSecret).update(value).digest('base64url');
}
