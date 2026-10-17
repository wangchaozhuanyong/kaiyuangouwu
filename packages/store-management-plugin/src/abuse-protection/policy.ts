export const challengeActions = [
    'LOGIN',
    'REGISTER',
    'PASSWORD_RESET',
    'PASSWORD_UPDATE',
    'RECHARGE_CODE',
    'RECHARGE_SUBMIT',
] as const;
export type ShopAbuseAction = (typeof challengeActions)[number];
export type ShopAbuseOperation = ShopAbuseAction | 'RECHARGE_CONFIG' | 'RECHARGE_TASK';
export interface AbuseOperation {
    action: ShopAbuseOperation;
    target: string;
    email: boolean;
    targetRisk: boolean;
}
export const minute = 60_000;
export const riskWindow = 10 * minute;
export const requestLimits: Record<ShopAbuseOperation, number> = {
    LOGIN: 20,
    REGISTER: 5,
    PASSWORD_RESET: 5,
    PASSWORD_UPDATE: 10,
    RECHARGE_CODE: 20,
    RECHARGE_SUBMIT: 5,
    RECHARGE_CONFIG: 30,
    RECHARGE_TASK: 60,
};
export function isChallengeAction(value: string): value is ShopAbuseAction {
    return challengeActions.includes(value as ShopAbuseAction);
}
export function normalizeAbuseTarget(action: ShopAbuseOperation, value: string): string {
    if (typeof value !== 'string' || value.length > 4096) return '';
    if (action === 'LOGIN' || action === 'REGISTER' || action === 'PASSWORD_RESET')
        return value.trim().normalize('NFKC').toLowerCase();
    if (action === 'RECHARGE_CODE' || action === 'RECHARGE_SUBMIT')
        return value.trim().normalize('NFKC').toUpperCase();
    return value;
}
/** Resolve actual schema fields, never the client-selected operation name or alias. */
export function protectedOperation(
    field: string,
    args: Record<string, any>,
    activeUserId?: string | number,
): AbuseOperation | null {
    let action: ShopAbuseOperation;
    let target: string | undefined;
    switch (field) {
        case 'login':
            action = 'LOGIN';
            target = args.username;
            break;
        case 'authenticate':
            action = 'LOGIN';
            target = args.input?.native?.username ?? 'oauth:google';
            break;
        case 'registerCustomerAccount':
        case 'registerCustomerWithReferral':
            action = 'REGISTER';
            target = args.input?.emailAddress;
            break;
        case 'refreshCustomerVerification':
            action = 'REGISTER';
            target = args.emailAddress;
            break;
        case 'requestPasswordReset':
            action = 'PASSWORD_RESET';
            target = args.emailAddress;
            break;
        case 'resetPassword':
        case 'updateCustomerEmailAddress':
        case 'verifyCustomerAccount':
            action = 'PASSWORD_UPDATE';
            target = args.token;
            break;
        case 'updateCustomerPassword':
        case 'requestUpdateCustomerEmailAddress':
            action = 'PASSWORD_UPDATE';
            target = activeUserId ? `user:${activeUserId}` : '';
            break;
        case 'verifyGptRechargeCode':
        case 'queryGptRechargeCode':
            action = 'RECHARGE_CODE';
            target = args.code;
            break;
        case 'submitGptRecharge':
            action = 'RECHARGE_SUBMIT';
            target = args.code;
            break;
        case 'gptRechargeConfig':
            action = 'RECHARGE_CONFIG';
            break;
        case 'gptRechargeTask':
            action = 'RECHARGE_TASK';
            target = args.id;
            break;
        default:
            return null;
    }
    const normalized = normalizeAbuseTarget(action, typeof target === 'string' ? target : '');
    return {
        action,
        target: normalized,
        email: ['LOGIN', 'REGISTER', 'PASSWORD_RESET'].includes(action),
        targetRisk: Boolean(normalized) && normalized !== 'oauth:google',
    };
}
export function riskFamily(action: ShopAbuseOperation): string {
    return action.startsWith('RECHARGE_') ? 'RECHARGE' : 'ACCOUNT';
}
export function cooldownMs(failures: number): number {
    return failures >= 30 ? 15 * minute : failures >= 16 ? 2 * minute : failures >= 8 ? 30_000 : 0;
}
