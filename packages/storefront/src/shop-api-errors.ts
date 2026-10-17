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
