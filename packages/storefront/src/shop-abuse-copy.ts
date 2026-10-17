import type { StorefrontLanguage } from './types';

import { shopAbuseFailure } from './shop-abuse-failure';
import { storefrontErrorMessage } from './storefront-errors';

const messages: Record<string, [string, string]> = {
    SHOP_ABUSE_CHALLENGE_REQUIRED: [
        '请完成图片验证后再次提交。',
        'Complete the image verification and submit again.',
    ],
    SHOP_ABUSE_CHALLENGE_INVALID: [
        '验证码不正确或已过期，请输入新的验证码后再次提交。',
        'The verification code is incorrect or expired. Enter the new code and submit again.',
    ],
    SHOP_ABUSE_RATE_LIMITED: ['操作过于频繁，请稍后再试。', 'Too many attempts. Please wait and try again.'],
    SHOP_ABUSE_UNAVAILABLE: [
        '安全验证暂时不可用，请稍后重试。',
        'Security verification is temporarily unavailable. Please try again later.',
    ],
};
/** Loaded together with the exceptional security UI; raw provider errors never become customer copy. */
export function shopAbuseErrorMessage(
    error: unknown,
    language: StorefrontLanguage,
    fallback?: string,
): string {
    const failure = shopAbuseFailure(error);
    return failure
        ? messages[failure.code][language === 'zh' ? 0 : 1]
        : storefrontErrorMessage(error, language, fallback);
}
