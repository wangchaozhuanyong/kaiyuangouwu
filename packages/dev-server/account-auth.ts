export const ACCOUNT_TOKEN_DURATION = '24h';
export const ACCOUNT_TOKEN_EXPIRY_HOURS = 24;

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
