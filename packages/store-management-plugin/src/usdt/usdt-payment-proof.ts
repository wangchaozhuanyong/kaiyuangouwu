import { createHmac, timingSafeEqual } from 'node:crypto';

export interface UsdtPaymentProofPayload {
    version: 1;
    channelId: string;
    quoteId: string;
    orderId: string;
    fiatCurrencyCode: string;
    fiatAmount: number;
    transactionId: string;
    usdtAmount: string;
    receivingAddressFingerprint: string;
    expiresAt: number;
}

let paymentProofSecret = 'development-usdt-payment-proof-secret';

export function configureUsdtPaymentProofSecret(secret: string): void {
    paymentProofSecret = secret;
}

export function createUsdtPaymentProof(payload: Omit<UsdtPaymentProofPayload, 'version'>): string {
    const encoded = Buffer.from(JSON.stringify({ version: 1, ...payload }), 'utf8').toString('base64url');
    return `${encoded}.${sign(encoded)}`;
}

export function verifyUsdtPaymentProof(proof: unknown): UsdtPaymentProofPayload | null {
    if (typeof proof !== 'string' || proof.length > 4096) return null;
    const [encoded, signature, extra] = proof.split('.');
    if (!encoded || !signature || extra) return null;
    const actual = Buffer.from(signature);
    const expected = Buffer.from(sign(encoded));
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    try {
        const payload = JSON.parse(
            Buffer.from(encoded, 'base64url').toString('utf8'),
        ) as Partial<UsdtPaymentProofPayload>;
        if (
            payload.version !== 1 ||
            !isSafeId(payload.channelId) ||
            !isSafeId(payload.quoteId) ||
            !isSafeId(payload.orderId) ||
            !/^[A-Z]{3}$/u.test(payload.fiatCurrencyCode ?? '') ||
            !Number.isInteger(payload.fiatAmount) ||
            Number(payload.fiatAmount) <= 0 ||
            !/^[a-fA-F0-9]{64}$/u.test(payload.transactionId ?? '') ||
            !/^\d+\.\d{6}$/u.test(payload.usdtAmount ?? '') ||
            !/^[a-f0-9]{64}$/u.test(payload.receivingAddressFingerprint ?? '') ||
            !Number.isFinite(payload.expiresAt) ||
            Number(payload.expiresAt) <= Date.now()
        ) {
            return null;
        }
        return payload as UsdtPaymentProofPayload;
    } catch {
        return null;
    }
}

export function isAcceptableUsdtPaymentProofSecret(value: string): boolean {
    return (
        value.length >= 32 && !/(?:replace|example|change[-_ ]?me|development|test[-_ ]?secret)/iu.test(value)
    );
}

function sign(value: string): string {
    return createHmac('sha256', paymentProofSecret)
        .update(`storefront-usdt-payment:v1:${value}`)
        .digest('base64url');
}

function isSafeId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 128;
}
