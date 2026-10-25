import { shopAbuseMetadata, type ShopAbuseAction } from './shop-abuse';

/** Shared by the early public transport and the Shop API without importing API initialization. */
export class ShopApiGraphQlError extends Error {
    readonly action?: ShopAbuseAction;
    readonly retryAfterSeconds?: number;
    constructor(
        readonly messages: string[],
        readonly status: number,
        readonly errorCode?: string,
        readonly requestNotExecuted = false,
        metadata?: unknown,
    ) {
        super(messages[0] ?? `Shop API request failed (${status})`);
        this.name = 'ShopApiGraphQlError';
        Object.assign(this, shopAbuseMetadata(metadata));
    }
}

export const STOREFRONT_READ_TIMEOUT_MS = 20_000;
export class ShopApiTimeoutError extends Error {
    constructor(
        message: string,
        public readonly resultUnknown = false,
    ) {
        super(message);
        this.name = 'ShopApiTimeoutError';
    }
}
export function createShopApiTimeoutError(resultUnknown: boolean): ShopApiTimeoutError {
    return new ShopApiTimeoutError(
        resultUnknown
            ? '请求超时，提交结果暂时无法确认，请勿更改参数后重复提交'
            : '请求超时，请检查网络后重试',
        resultUnknown,
    );
}
