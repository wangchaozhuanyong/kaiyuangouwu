import { UserInputError } from '@vendure/core';

import { ShopAbuseOperation } from './policy';

export type ShopAbuseErrorCode =
    | 'SHOP_ABUSE_CHALLENGE_REQUIRED'
    | 'SHOP_ABUSE_CHALLENGE_INVALID'
    | 'SHOP_ABUSE_RATE_LIMITED'
    | 'SHOP_ABUSE_UNAVAILABLE';
export class ShopAbuseError extends UserInputError {
    constructor(code: ShopAbuseErrorCode, action: ShopAbuseOperation, retryAfterMs = 0) {
        super(
            code === 'SHOP_ABUSE_RATE_LIMITED'
                ? '操作频繁，请稍后重试'
                : code === 'SHOP_ABUSE_UNAVAILABLE'
                  ? '安全验证暂不可用，请稍后重试'
                  : '请完成安全验证后重试',
        );
        this.code = code;
        this.extensions.code = code;
        this.extensions.action = action;
        this.extensions.retryAfterSeconds = Math.min(900, Math.max(0, Math.ceil(retryAfterMs / 1000)));
    }
}
