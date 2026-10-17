export const shopAbuseActions = [
    'LOGIN',
    'REGISTER',
    'PASSWORD_RESET',
    'PASSWORD_UPDATE',
    'RECHARGE_CODE',
    'RECHARGE_SUBMIT',
] as const;
export type ShopAbuseAction = (typeof shopAbuseActions)[number];
export interface ShopAbuseProof {
    id: string;
    answer: string;
}
export interface ShopAbuseChallenge {
    id: string;
    imageDataUrl: string;
    expiresAt: string;
}
export interface ShopAbuseClient {
    createShopAbuseChallenge(
        action: ShopAbuseAction,
        target: string,
        signal?: AbortSignal,
    ): Promise<ShopAbuseChallenge>;
}
export function shopAbuseMetadata(value: unknown): { action?: ShopAbuseAction; retryAfterSeconds?: number } {
    const item = value as { action?: unknown; retryAfterSeconds?: unknown } | undefined;
    return {
        ...(shopAbuseActions.includes(item?.action as ShopAbuseAction)
            ? { action: item?.action as ShopAbuseAction }
            : {}),
        ...(Number.isInteger(item?.retryAfterSeconds) &&
        Number(item?.retryAfterSeconds) >= 0 &&
        Number(item?.retryAfterSeconds) <= 86400
            ? { retryAfterSeconds: Number(item?.retryAfterSeconds) }
            : {}),
    };
}
export function shopAbuseHeaders(proof?: ShopAbuseProof): Record<string, string> {
    return proof ? { 'x-shop-abuse-id': proof.id, 'x-shop-abuse-answer': proof.answer } : {};
}
