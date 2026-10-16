import { UserInputError } from '@vendure/core';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function rechargeKey(): Buffer {
    const key = process.env.GPT_RECHARGE_ENCRYPTION_KEY ?? '';
    if (!/^[0-9a-f]{64}$/i.test(key)) throw new Error('Recharge credential storage is not configured');
    return Buffer.from(key, 'hex');
}
export function sealRechargeSecret(value: string, context: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', rechargeKey(), iv);
    cipher.setAAD(Buffer.from(context));
    const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), body].map(part => part.toString('base64url')).join('.');
}
export function openRechargeSecret(value: string, context: string): string {
    const [iv, tag, body] = value.split('.').map(part => Buffer.from(part, 'base64url'));
    const cipher = createDecipheriv('aes-256-gcm', rechargeKey(), iv);
    cipher.setAAD(Buffer.from(context));
    cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(body), cipher.final()]).toString('utf8');
}
export function rechargeFingerprint(value: string, context: string): string {
    return createHmac('sha256', rechargeKey()).update(`${context}\0${value}`).digest('hex');
}
export function rechargeCredentialMatches(expected: string, supplied: unknown): boolean {
    return (
        typeof supplied === 'string' &&
        Buffer.byteLength(expected) === Buffer.byteLength(supplied) &&
        timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
    );
}
export function allowedRechargeOrigin(value: string): string {
    const url = new URL(value);
    const allowed = (process.env.GPT_RECHARGE_ALLOWED_ORIGINS ?? '').split(',').map(item => item.trim());
    if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== '/' ||
        !allowed.includes(url.origin)
    )
        throw new Error('Recharge destination is not allowed');
    return url.origin;
}

export const rechargeAllowedPlans = ['plus', 'pro_5x', 'pro_20x'];
export const rechargeAllowedStatuses = [
    'queued',
    'running',
    'awaiting_credentials',
    'awaiting_review',
    'succeeded',
    'failed',
];
export function safeRechargeTask(value: unknown) {
    const row = value as Record<string, unknown>;
    if (
        !row ||
        !rechargeAllowedPlans.includes(String(row.plan)) ||
        !rechargeAllowedStatuses.includes(String(row.status)) ||
        typeof row.id !== 'string' ||
        !/^[a-f0-9-]{36}$/i.test(row.id)
    )
        throw new Error('Invalid task response');
    const updatedAt = new Date(String(row.updatedAt));
    if (!Number.isFinite(updatedAt.getTime())) throw new Error('Invalid task timestamp');
    return {
        updatedAt,
        id: row.id,
        plan: String(row.plan),
        status: String(row.status),
        taskToken:
            typeof row.taskToken === 'string' && row.taskToken.length <= 100 ? row.taskToken : undefined,
    };
}

export class GptRechargeNotAcceptedError extends UserInputError {
    constructor() {
        super('本次提交未受理，请核对账号资料或稍后重试。');
        this.code = 'GPT_RECHARGE_NOT_ACCEPTED';
        this.extensions.code = this.code;
    }
}
export function validateRechargeSession(source: string): void {
    try {
        if (typeof source !== 'string' || !source.trim() || source.length > 256000) throw new Error();
        const value = JSON.parse(source);
        const token = value?.accessToken ?? value?.access_token;
        if (
            !value?.user?.id ||
            typeof value.user.email !== 'string' ||
            !value.user.email.includes('@') ||
            typeof token !== 'string' ||
            token.length < 20 ||
            token.length > 24000
        )
            throw new Error();
        if (typeof value.expires === 'string' && Date.parse(value.expires) <= Date.now()) throw new Error();
        let payload: { exp?: number } = {};
        try {
            payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString());
        } catch {
            /* Credential proof belongs to the executor. */
        }
        if (typeof payload?.exp === 'number' && payload.exp * 1000 <= Date.now()) throw new Error();
    } catch {
        throw new GptRechargeNotAcceptedError();
    }
}
