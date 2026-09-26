import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    currentStorefrontAssetFingerprint,
    extractStorefrontAssetFingerprint,
    fetchStorefrontAssetFingerprint,
    storefrontAssetFingerprint,
} from './storefront-version';

const baseUrl = 'https://shop.example.com/category';

afterEach(() => vi.useRealTimers());

describe('storefront version detection', () => {
    it('creates a stable fingerprint from versioned JavaScript and CSS assets', () => {
        expect(
            storefrontAssetFingerprint(
                ['/assets/index-new.js', '/assets/index-new.css', '/favicon.png', '/assets/index-new.js'],
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

    it('ignores route modulepreloads injected after the entry bundle starts', () => {
        expect(
            extractStorefrontAssetFingerprint(
                [
                    '<script type="module" src="/assets/index-a.js"></script>',
                    '<link rel="stylesheet" href="/assets/index-b.css">',
                    '<link rel="modulepreload" href="/assets/product-route.js">',
                ].join(''),
                baseUrl,
            ),
        ).toBe('https://shop.example.com/assets/index-a.js|https://shop.example.com/assets/index-b.css');

        const querySelectorAll = vi.fn(() => []);
        currentStorefrontAssetFingerprint({ querySelectorAll } as unknown as Document, baseUrl);
        expect(querySelectorAll).toHaveBeenCalledWith(
            'link[rel="stylesheet"][href], script[type="module"][src]',
        );
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
                signal: expect.any(AbortSignal),
            },
        );
    });

    it('aborts a stalled version request so the next check can run', async () => {
        vi.useFakeTimers();
        let requestSignal: AbortSignal | null | undefined;
        const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
            requestSignal = init?.signal;
            return new Promise((_resolve, reject) => {
                requestSignal?.addEventListener(
                    'abort',
                    () => reject(new DOMException('Aborted', 'AbortError')),
                    { once: true },
                );
            });
        });
        const result = fetchStorefrontAssetFingerprint({ baseUrl, fetchImpl }).catch(error => error);
        await vi.advanceTimersByTimeAsync(5_001);

        expect(requestSignal?.aborted).toBe(true);
        expect(await result).toBeInstanceOf(DOMException);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('cancels an unread error response instead of leaving its body streaming', async () => {
        vi.useFakeTimers();
        const cancel = vi.fn();
        const body = new ReadableStream<Uint8Array>({ cancel });
        const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 503 }));

        await expect(fetchStorefrontAssetFingerprint({ baseUrl, fetchImpl })).resolves.toBeNull();
        expect(cancel).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('cancels an in-flight check when its caller is disposed', async () => {
        const controller = new AbortController();
        let requestSignal: AbortSignal | null | undefined;
        const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
            requestSignal = init?.signal;
            return new Promise((_resolve, reject) => {
                requestSignal?.addEventListener(
                    'abort',
                    () => reject(new DOMException('Aborted', 'AbortError')),
                    { once: true },
                );
            });
        });
        const result = fetchStorefrontAssetFingerprint({
            baseUrl,
            fetchImpl,
            signal: controller.signal,
        }).catch(error => error);
        controller.abort();

        expect(requestSignal?.aborted).toBe(true);
        expect(await result).toBeInstanceOf(DOMException);
    });
});
