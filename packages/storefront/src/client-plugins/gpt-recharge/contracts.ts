import type { StorefrontLanguage } from '../../types';

export const rechargePlans = [
    { key: 'plus', label: 'Plus' },
    { key: 'pro_5x', label: 'Pro100' },
    { key: 'pro_20x', label: 'Pro200' },
] as const;
export type RechargePlan = (typeof rechargePlans)[number]['key'];
export type RechargeStatus =
    'queued' | 'running' | 'succeeded' | 'failed' | 'awaiting_review' | 'awaiting_credentials';
export interface RechargeTask {
    id: string;
    credential: string;
    plan: RechargePlan;
    status: RechargeStatus;
    updatedAt: string;
}
export interface RechargeCode {
    plan: RechargePlan;
    status: 'available' | 'reserved' | 'used' | 'disabled';
    task?: RechargeTask | null;
}
export interface GptRechargeClient {
    config(signal?: AbortSignal): Promise<{ enabled: boolean; maintenance: boolean }>;
    verify(code: string): Promise<RechargeCode>;
    submit(code: string, session: string): Promise<RechargeTask>;
    query(code: string): Promise<RechargeCode>;
    task(id: string, credential: string, signal?: AbortSignal): Promise<RechargeTask>;
}

/** Identify the account for confirmation only; the executor verifies the credential. */
export function inspectRechargeSession(
    source: string,
    language: StorefrontLanguage = 'zh',
): { email: string } {
    const t = (zh: string, en: string) => (language === 'zh' ? zh : en);
    if (source.length > 256000)
        throw new Error(
            t(
                '账号资料过长，请重新复制完整 Session JSON。',
                'Account data is too long. Copy the complete session JSON again.',
            ),
        );
    let value: {
        user?: { id?: unknown; email?: unknown };
        accessToken?: unknown;
        access_token?: unknown;
        expires?: unknown;
    };
    try {
        value = JSON.parse(source);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    } catch {
        throw new Error(
            t(
                'JSON 格式不完整，请重新全选复制账号资料。',
                'Invalid JSON. Select and copy the complete account data again.',
            ),
        );
    }
    const token = value.accessToken ?? value.access_token;
    if (
        !value.user?.id ||
        typeof value.user.email !== 'string' ||
        !value.user.email.includes('@') ||
        typeof token !== 'string' ||
        token.length < 20 ||
        token.length > 24000
    ) {
        throw new Error(
            t(
                '缺少账号资料或访问凭据，请登录目标账号后重新获取完整 JSON。',
                'Account details or access credentials are missing. Sign in to the target account and copy the complete JSON again.',
            ),
        );
    }
    if (
        typeof value.expires === 'string' &&
        Number.isFinite(Date.parse(value.expires)) &&
        Date.parse(value.expires) <= Date.now()
    ) {
        throw new Error(t('账号资料已过期，请重新获取。', 'Account data has expired. Get a fresh copy.'));
    }
    let payload: { exp?: number } = {};
    try {
        payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    } catch {
        /* The executor verifies the credential. */
    }
    if (typeof payload?.exp === 'number' && payload.exp * 1000 <= Date.now())
        throw new Error(t('账号资料已过期，请重新获取。', 'Account data has expired. Get a fresh copy.'));
    return { email: value.user.email.replace(/^(.).*(@.*)$/, '$1***$2') };
}

export function rechargePlanLabel(plan: RechargePlan): string {
    return rechargePlans.find(item => item.key === plan)?.label ?? '—';
}
