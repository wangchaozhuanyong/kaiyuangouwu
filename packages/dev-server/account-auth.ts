import {
    createAccountEntryProof,
    isAccountEntryRoute,
} from '@vendure/store-management-plugin/account-entry-proof';

export const ACCOUNT_TOKEN_DURATION = '24h';
export const ACCOUNT_TOKEN_EXPIRY_HOURS = 24;
const ACCOUNT_ENTRY_PROOF_DURATION_MS = ACCOUNT_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000;

export function buildAccountActionUrl(baseUrl: string, token: string | null | undefined): string {
    const normalizedToken = token?.trim();
    if (!normalizedToken) {
        throw new Error('Cannot build an account action URL without a token');
    }

    const url = new URL(baseUrl);
    if (url.hash) {
        const [hashPath, hashQuery = ''] = url.hash.slice(1).split('?');
        const params = new URLSearchParams(hashQuery);
        params.set('token', normalizedToken);
        url.hash = `${hashPath}?${params.toString()}`;
    } else {
        url.searchParams.set('token', normalizedToken);
    }
    return url.toString();
}

export function buildSignedStorefrontAccountActionUrl(
    baseUrl: string,
    token: string | null | undefined,
    signingSecret: string,
    now = Date.now(),
): string {
    const normalizedToken = token?.trim();
    if (!normalizedToken) {
        throw new Error('Cannot build an account action URL without a token');
    }
    if (!signingSecret.trim()) {
        throw new Error('Cannot build a storefront account action URL without a signing secret');
    }

    const url = new URL(baseUrl);
    const route = url.searchParams.get('route');
    if (!route || !isAccountEntryRoute(route)) {
        throw new Error('Storefront account action URL has an unsupported route');
    }
    const proof = createAccountEntryProof({
        route,
        host: url.hostname,
        token: normalizedToken,
        signingSecret,
        expiresAt: now + ACCOUNT_ENTRY_PROOF_DURATION_MS,
    });
    url.searchParams.set('token', normalizedToken);
    url.searchParams.set('proof', proof);
    return url.toString();
}
