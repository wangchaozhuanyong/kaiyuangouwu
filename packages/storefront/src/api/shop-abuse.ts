import { type ShopAbuseAction, type ShopAbuseChallenge } from '../shop-abuse';

export function requestShopAbuseChallenge(
    client: {
        request: <T>(query: string, variables?: Record<string, unknown>, signal?: AbortSignal) => Promise<T>;
    },
    action: ShopAbuseAction,
    target: string,
    signal?: AbortSignal,
): Promise<ShopAbuseChallenge> {
    return client
        .request<{ createShopAbuseChallenge: ShopAbuseChallenge }>(
            `mutation CreateShopAbuseChallenge($action:String!,$target:String!) {
            createShopAbuseChallenge(action:$action,target:$target) { id imageDataUrl expiresAt }
        }`,
            { action, target },
            signal,
        )
        .then(value => value.createShopAbuseChallenge);
}
