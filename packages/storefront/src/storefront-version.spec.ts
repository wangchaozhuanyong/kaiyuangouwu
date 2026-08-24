import { describe, expect, it, vi } from 'vitest';

import {
    extractStorefrontAssetFingerprint,
    fetchStorefrontAssetFingerprint,
    storefrontAssetFingerprint,
} from './storefront-version';

const baseUrl = 'https://shop.example.com/category';

describe('storefront version detection', () => {
    it('creates a stable fingerprint from versioned JavaScript and CSS assets', () => {
        expect(
            storefrontAssetFingerprint(
                ['/assets/index-new.js', '/assets/index-new.css', '/favicon.svg', '/assets/index-new.js'],
                baseUrl,
            ),
        ).toBe('https://shop.example.com/assets/index-new.css|https://shop.example.com/assets/index-new.js');
    });

    it('extracts the same fingerprint regardless of asset tag order', () => {
        const first = extractStorefrontAssetFingerprint(
            '<script type="module" src="/assets/index-a.js"></script><link rel="stylesheet" href="/assets/index-b.css">',
            baseUrl,
        );
        const second = extractStorefrontAssetFingerprint(
            '<link href="/assets/index-b.css" rel="stylesheet"><script src="/assets/index-a.js" type="module"></script>',
            baseUrl,
        );

        expect(first).toBe(second);
    });

    it('ignores HTML without a built storefront asset', () => {
        expect(extractStorefrontAssetFingerprint('<html><body>Promotion gate</body></html>', baseUrl)).toBe(
            null,
        );
    });

    it('fetches the uncached production index with same-origin credentials', async () => {
        const fetchImpl = vi.fn<typeof fetch>(() =>
            Promise.resolve(
                new Response('<script type="module" src="/assets/index-current.js"></script>', {
                    status: 200,
                    headers: { 'content-type': 'text/html' },
                }),
            ),
        );

        await expect(
            fetchStorefrontAssetFingerprint({
                baseUrl,
                fetchImpl,
                now: () => 1234,
            }),
        ).resolves.toBe('https://shop.example.com/assets/index-current.js');
        expect(fetchImpl).toHaveBeenCalledWith(
            new URL('https://shop.example.com/index.html?__storefront_version=1234'),
            {
                cache: 'no-store',
                credentials: 'same-origin',
                headers: { accept: 'text/html' },
            },
        );
    });
});
