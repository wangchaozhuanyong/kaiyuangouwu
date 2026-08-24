const VERSIONED_ASSET_PATH = /\/assets\/[^/?#]+\.(?:css|js)$/i;

export const STOREFRONT_VERSION_CHECK_INTERVAL_MS = 60_000;

export interface StorefrontVersionFetchOptions {
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    indexPath?: string;
    now?: () => number;
}

export function storefrontAssetFingerprint(references: Iterable<string>, baseUrl: string): string | null {
    const assets = new Set<string>();
    for (const reference of references) {
        try {
            const url = new URL(reference, baseUrl);
            if (VERSIONED_ASSET_PATH.test(url.pathname)) {
                assets.add(`${url.origin}${url.pathname}${url.search}`);
            }
        } catch {
            // Ignore malformed or non-URL asset references.
        }
    }
    return assets.size > 0 ? [...assets].sort().join('|') : null;
}

export function extractStorefrontAssetFingerprint(indexHtml: string, baseUrl: string): string | null {
    const references: string[] = [];
    for (const tag of indexHtml.match(/<(?:link|script)\b[^>]*>/giu) ?? []) {
        const reference = tag.match(/\b(?:href|src)\s*=\s*(["'])(.*?)\1/iu)?.[2];
        if (reference) references.push(reference);
    }
    return storefrontAssetFingerprint(references, baseUrl);
}

export function currentStorefrontAssetFingerprint(
    documentRef: Document = document,
    baseUrl: string = window.location.href,
): string | null {
    const references = Array.from(
        documentRef.querySelectorAll<HTMLLinkElement | HTMLScriptElement>(
            'link[rel="stylesheet"][href], link[rel="modulepreload"][href], script[type="module"][src]',
        ),
        element => element.getAttribute('href') ?? element.getAttribute('src') ?? '',
    );
    return storefrontAssetFingerprint(references, baseUrl);
}

export async function fetchStorefrontAssetFingerprint(
    options: StorefrontVersionFetchOptions = {},
): Promise<string | null> {
    const baseUrl = options.baseUrl ?? window.location.href;
    const indexUrl = new URL(options.indexPath ?? '/index.html', baseUrl);
    indexUrl.searchParams.set('__storefront_version', String((options.now ?? Date.now)()));
    const response = await (options.fetchImpl ?? fetch)(indexUrl, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { accept: 'text/html' },
    });
    if (!response.ok) return null;
    return extractStorefrontAssetFingerprint(await response.text(), baseUrl);
}
