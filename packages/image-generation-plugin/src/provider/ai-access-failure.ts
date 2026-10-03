export type AiAccessFailure = 'INVALID' | 'EXPIRED' | 'DISABLED' | 'BALANCE' | 'QUOTA';
export const aiAccessReason: Record<AiAccessFailure, string> = {
    INVALID: '上游明确拒绝凭证，凭证无效或已被撤销',
    EXPIRED: '上游明确返回凭证过期',
    DISABLED: '上游明确返回账户或凭证已被停用',
    BALANCE: '上游明确返回账户余额不足',
    QUOTA: '上游明确返回账户调用或令牌额度耗尽',
};
const codes: Record<string, AiAccessFailure> = {
    invalid_api_key: 'INVALID',
    api_key_invalid: 'INVALID',
    authentication_key_invalid: 'INVALID',
    key_revoked: 'INVALID',
    api_key_expired: 'EXPIRED',
    token_expired: 'EXPIRED',
    expired_api_key: 'EXPIRED',
    account_deactivated: 'DISABLED',
    account_disabled: 'DISABLED',
    api_key_disabled: 'DISABLED',
    access_terminated: 'DISABLED',
    insufficient_balance: 'BALANCE',
    insufficient_credits: 'BALANCE',
    credit_balance_too_low: 'BALANCE',
    balance_not_enough: 'BALANCE',
    insufficient_quota: 'QUOTA',
    billing_hard_limit_reached: 'QUOTA',
    monthly_quota_exceeded: 'QUOTA',
    token_quota_exhausted: 'QUOTA',
};
/** Inspect in memory only. No raw error body, prompt, key fragments or provider message escapes this boundary. */
export function classifyAiAccessFailure(payload: unknown, status: number): AiAccessFailure | undefined {
    if (status < 400 || !payload || typeof payload !== 'object') return;
    const root = payload as Record<string, unknown>;
    const error =
        root.error && typeof root.error === 'object' ? (root.error as Record<string, unknown>) : root;
    const candidates: unknown[] = [error.code, error.type, error.reason];
    if (Array.isArray(error.details))
        for (const item of error.details.slice(0, 20)) {
            if (item && typeof item === 'object') candidates.push((item as Record<string, unknown>).reason);
        }
    for (const code of candidates)
        if (typeof code === 'string' && codes[code.toLowerCase()]) return codes[code.toLowerCase()];
    const message = typeof error.message === 'string' ? error.message.slice(0, 2000) : '';
    // Rate-per-minute, model permissions, content and per-request context limits are deliberately excluded.
    if (
        /rate.limit|per.minute|requests? per|tokens? per|context.length|model.*(permission|access)|model_not_found/i.test(
            message,
        )
    )
        return;
    if (
        /账户余额不足|余额已耗尽|insufficient (account )?(balance|credits)|credit balance.*(too low|exhausted)/i.test(
            message,
        )
    )
        return 'BALANCE';
    if (
        /账户(调用|令牌|token)额度已耗尽|monthly (usage )?(quota|budget).*exhausted|account.*token quota.*exhausted/i.test(
            message,
        )
    )
        return 'QUOTA';
}
