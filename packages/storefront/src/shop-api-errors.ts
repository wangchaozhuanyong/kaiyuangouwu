/** Shared by the early public transport and the Shop API without importing API initialization. */
export class ShopApiGraphQlError extends Error {
    constructor(
        readonly messages: string[],
        readonly status: number,
        readonly errorCode?: string,
        readonly requestNotExecuted = false,
    ) {
        super(messages[0] ?? `Shop API request failed (${status})`);
        this.name = 'ShopApiGraphQlError';
    }
}
