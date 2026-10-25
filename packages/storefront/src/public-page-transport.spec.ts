import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    awaitPublicPage,
    invalidatePublicPageReads,
    publicPageReadDeadline,
    requestPublicPage,
} from './public-page-transport';
import { createStorefrontQueryClient } from './query-client';
import { ShopApiGraphQlError, ShopApiTimeoutError } from './shop-api-errors';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

it('keeps Query automatic retry and transport inside one 20s budget', async () => {
    vi.useFakeTimers();
    const client = createStorefrontQueryClient();
    let attempts = 0;
    vi.stubGlobal(
        'fetch',
        vi.fn(
            (_url, options) =>
                new Promise((_resolve, reject) => {
                    attempts++;
                    options.signal.addEventListener(
                        'abort',
                        () => reject(new DOMException('aborted', 'AbortError')),
                        { once: true },
                    );
                    if (attempts === 1) setTimeout(() => reject(new TypeError('network failed')), 12_000);
                }),
        ),
    );
    try {
        const result = client.fetchQuery({
            queryKey: ['budget'],
            retryDelay: 0,
            queryFn: ({ signal }) =>
                requestPublicPage(
                    new URL('https://store.test/_storefront/page-data?budget=1'),
                    publicPageReadDeadline(signal),
                ),
        });
        const rejection = expect(result).rejects.toBeInstanceOf(ShopApiTimeoutError);
        await vi.advanceTimersByTimeAsync(20_000);
        await rejection;
        expect(attempts).toBe(2);
    } finally {
        client.clear();
    }
});

it('adopts an early deadline instead of resetting the timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
        'fetch',
        vi.fn(
            (_url, options) =>
                new Promise((_resolve, reject) =>
                    options.signal.addEventListener('abort', () =>
                        reject(new DOMException('aborted', 'AbortError')),
                    ),
                ),
        ),
    );
    const early = requestPublicPage(new URL('https://store.test/_storefront/page-data?early=1'));
    const rejection = expect(early).rejects.toBeInstanceOf(ShopApiTimeoutError);
    await vi.advanceTimersByTimeAsync(19_000);
    expect(publicPageReadDeadline(new AbortController().signal, early) - Date.now()).toBe(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await rejection;
});
describe('one public read transport', () => {
    it('preserves structured closure as the same lightweight Shop API error', async () => {
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValue(
                    Response.json(
                        { errorCode: 'STOREFRONT_CLOSED', message: '店铺暂未开放' },
                        { status: 403 },
                    ),
                ),
        );
        const error = await requestPublicPage(new URL('https://store.test/_storefront/page-data')).catch(
            value => value,
        );
        expect(error).toBeInstanceOf(ShopApiGraphQlError);
        expect(error).toMatchObject({ status: 403, errorCode: 'STOREFRONT_CLOSED' });
    });

    it('keeps a proxy denial visible and only falls back for missing aggregate endpoints', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response('<h1>Forbidden</h1>', { status: 403 }))
            .mockResolvedValueOnce(new Response('', { status: 404 }))
            .mockResolvedValueOnce(new Response('', { status: 501 }));
        vi.stubGlobal('fetch', fetchMock);
        const url = new URL('https://store.test/_storefront/page-data');
        await expect(requestPublicPage(url)).rejects.toMatchObject({ status: 403 });
        await expect(requestPublicPage(url)).resolves.toBeUndefined();
        await expect(requestPublicPage(url)).resolves.toBeUndefined();
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('shares the same URL while a cancelled subscriber leaves the other subscriber intact', async () => {
        let finish!: (value: Response) => void;
        const fetchMock = vi.fn(
            () =>
                new Promise<Response>(resolve => {
                    finish = resolve;
                }),
        );
        vi.stubGlobal('fetch', fetchMock);
        const url = new URL('https://store.test/_storefront/page-data?kind=catalog');
        const first = requestPublicPage(url);
        const second = requestPublicPage(url);
        const abort = new AbortController();
        const cancelled = awaitPublicPage(first, abort.signal);
        abort.abort();
        await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
        finish(Response.json({ version: 'current' }));
        await expect(second).resolves.toEqual({ version: 'current' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it('never joins a pre-invalidation download after a publication event', async () => {
        const completions: Array<(value: Response) => void> = [];
        const fetchMock = vi.fn(() => new Promise<Response>(resolve => completions.push(resolve)));
        vi.stubGlobal('fetch', fetchMock);
        const url = new URL('https://store.test/_storefront/page-data?kind=home');
        const old = requestPublicPage(url);
        invalidatePublicPageReads();
        const latest = requestPublicPage(url);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        completions[1](Response.json({ version: 'new' }));
        await expect(latest).resolves.toEqual({ version: 'new' });
        completions[0](Response.json({ version: 'old' }));
        await old;
    });
});
