import { StorefrontLanguage } from './types';

export const ACCOUNT_PASSWORD_MIN_LENGTH = 8;
export const ACCOUNT_PASSWORD_MAX_LENGTH = 72;

export function validateAccountPassword(
    password: string,
    confirmation: string,
    language: StorefrontLanguage,
): string | null {
    const isZh = language === 'zh';
    if (password.length < ACCOUNT_PASSWORD_MIN_LENGTH) {
        return isZh
            ? `密码至少需要 ${ACCOUNT_PASSWORD_MIN_LENGTH} 个字符`
            : `Password must be at least ${ACCOUNT_PASSWORD_MIN_LENGTH} characters`;
    }
    if (password.length > ACCOUNT_PASSWORD_MAX_LENGTH) {
        return isZh
            ? `密码不能超过 ${ACCOUNT_PASSWORD_MAX_LENGTH} 个字符`
            : `Password must not exceed ${ACCOUNT_PASSWORD_MAX_LENGTH} characters`;
    }
    if (password !== confirmation) {
        return isZh ? '两次输入的密码不一致' : 'The passwords do not match';
    }
    return null;
}
