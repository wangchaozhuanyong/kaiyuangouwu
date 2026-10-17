import { shopAbuseMetadata } from './shop-abuse';

const codes = [
    'SHOP_ABUSE_CHALLENGE_REQUIRED',
    'SHOP_ABUSE_CHALLENGE_INVALID',
    'SHOP_ABUSE_RATE_LIMITED',
    'SHOP_ABUSE_UNAVAILABLE',
];
/** Separate rare security UI detection from the always-loaded transport metadata. */
export function shopAbuseFailure(error: unknown) {
    const value = error as { errorCode?: unknown } | undefined;
    const code = value?.errorCode;
    return typeof code === 'string' && codes.includes(code)
        ? { code, ...shopAbuseMetadata(error) }
        : undefined;
}
