import { afterEach, describe, expect, it, vi } from 'vitest';

import { calculateStorefrontRealtimeRetry, ShopApi } from './api';
import { MarketConfig } from './types';

const market: MarketConfig = {
    code: 'cn-mainland',
    defaultLanguageCode: 'zh_Hans',
    currencyCode: 'CNY',
    countryCode: 'CN',
    locale: 'zh-CN',
    label: '中国大陆',
};

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('storefront realtime retry policy', () => {
    it('adds bounded jitter to the normal exponential retry', () => {
        expect(
            calculateStorefrontRealtimeRetry({
                baseDelayMs: 1_000,
                random: 0.5,
            }),
        ).toEqual({ delayMs: 1_100, nextBaseDelayMs: 2_000 });
    });

    it('uses a five second floor and a longer cap for rate limits', () => {
        expect(
            calculateStorefrontRealtimeRetry({
                status: 429,
                baseDelayMs: 1_000,
                random: 0.5,
            }),
        ).toEqual({ delayMs: 5_500, nextBaseDelayMs: 10_000 });
        expect(
            calculateStorefrontRealtimeRetry({
                status: 429,
                baseDelayMs: 60_000,
                random: 1,
            }),
        ).toEqual({ delayMs: 60_000, nextBaseDelayMs: 60_000 });
    });

    it('honours Retry-After seconds and HTTP dates before adding positive jitter', () => {
        const nowMs = Date.parse('2026-09-02T12:00:00.000Z');

        expect(
            calculateStorefrontRealtimeRetry({
                status: 429,
                retryAfter: '10',
                baseDelayMs: 1_000,
                random: 0.5,
                nowMs,
            }),
        ).toEqual({ delayMs: 10_500, nextBaseDelayMs: 10_000 });
        expect(
            calculateStorefrontRealtimeRetry({
                status: 429,
                retryAfter: 'Wed, 02 Sep 2026 12:00:20 GMT',
                baseDelayMs: 1_000,
                random: 0,
                nowMs,
            }),
        ).toEqual({ delayMs: 20_000, nextBaseDelayMs: 10_000 });
    });

    it('caps extreme Retry-After values before scheduling a browser timer', () => {
        const nowMs = Date.parse('2026-09-02T12:00:00.000Z');

        for (const retryAfter of ['9999999999', 'Fri, 31 Dec 9999 23:59:59 GMT']) {
            expect(
                calculateStorefrontRealtimeRetry({
                    status: 429,
                    retryAfter,
                    baseDelayMs: 1_000,
                    random: 1,
                    nowMs,
                }),
            ).toEqual({ delayMs: 60_000, nextBaseDelayMs: 10_000 });
        }
        expect(
            calculateStorefrontRealtimeRetry({
                baseDelayMs: Number.MAX_SAFE_INTEGER,
                random: 1,
                nowMs,
            }),
        ).toEqual({ delayMs: 30_000, nextBaseDelayMs: 30_000 });
    });
});

describe('ShopApi storefront realtime lifecycle', () => {
    it('cancels a non-OK response body and applies the 429 Retry-After delay', async () => {
        const controller = new AbortController();
        const bodyCancel = vi.fn();
        const responseBody = new ReadableStream<Uint8Array>({ cancel: bodyCancel });
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(responseBody, {
                    status: 429,
                    headers: { 'retry-after': '7' },
                }),
            )
            .mockImplementationOnce(() => {
                controller.abort();
                return Promise.reject(new DOMException('Aborted', 'AbortError'));
            });
        const delays: number[] = [];
        stubRealtimeBrowser(delays, true);
        vi.stubGlobal('fetch', fetchMock);
        vi.spyOn(Math, 'random').mockReturnValue(0);

        await new ShopApi(market).watchRealtime(vi.fn(), controller.signal);

        expect(bodyCancel).toHaveBeenCalledWith(expect.any(Error));
        expect(delays).toEqual([7_000]);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('resets the retry delay only after a valid ready frame', async () => {
        const controller = new AbortController();
        const encoder = new TextEncoder();
        const readyBody = new ReadableStream<Uint8Array>({
            start(streamController) {
                streamController.enqueue(
                    encoder.encode('event: ready\ndata: {"version":1,"heartbeatIntervalMs":15000}\n\n'),
                );
                streamController.close();
            },
        });
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
            .mockResolvedValueOnce(new Response(readyBody, { status: 200 }))
            .mockImplementationOnce(() => {
                controller.abort();
                return Promise.reject(new DOMException('Aborted', 'AbortError'));
            });
        const delays: number[] = [];
        stubRealtimeBrowser(delays, true);
        vi.stubGlobal('fetch', fetchMock);
        vi.spyOn(Math, 'random').mockReturnValue(0);

        await new ShopApi(market).watchRealtime(vi.fn(), controller.signal);

        expect(delays).toEqual([1_000, 1_000]);
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('cancels the active stream and never reconnects after abort', async () => {
        const bodyCancel = vi.fn();
        const responseBody = new ReadableStream<Uint8Array>({ cancel: bodyCancel });
        const fetchMock = vi.fn().mockResolvedValue(new Response(responseBody, { status: 200 }));
        const delays: number[] = [];
        stubRealtimeBrowser(delays, true);
        vi.stubGlobal('fetch', fetchMock);
        const controller = new AbortController();
        const reason = new DOMException('Unmounted', 'AbortError');
        const pending = new ShopApi(market).watchRealtime(vi.fn(), controller.signal);
        await Promise.resolve();

        controller.abort(reason);

        await pending;
        expect(bodyCancel).toHaveBeenCalledWith(reason);
        expect(delays).toEqual([]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('ends an in-progress retry delay without issuing another request after abort', async () => {
        const controller = new AbortController();
        const fetchMock = vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 }));
        const scheduledCallbacks: Array<() => void> = [];
        const delays: number[] = [];
        stubRealtimeBrowser(delays, false, scheduledCallbacks);
        vi.stubGlobal('fetch', fetchMock);
        vi.spyOn(Math, 'random').mockReturnValue(0);
        const pending = new ShopApi(market).watchRealtime(vi.fn(), controller.signal);
        await waitForMicrotasks();

        controller.abort();

        await pending;
        scheduledCallbacks.forEach(callback => callback());
        await waitForMicrotasks();
        expect(delays).toEqual([1_000]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

function stubRealtimeBrowser(
    delays: number[],
    runTimers: boolean,
    scheduledCallbacks: Array<() => void> = [],
): void {
    const setTimeoutMock = vi.fn((callback: () => void, delay?: number) => {
        delays.push(delay ?? 0);
        scheduledCallbacks.push(callback);
        if (runTimers) queueMicrotask(callback);
        return scheduledCallbacks.length;
    });
    vi.stubGlobal('window', {
        location: { href: 'https://storefront.example.test/' },
        setTimeout: setTimeoutMock,
        clearTimeout: vi.fn(),
    });
}

async function waitForMicrotasks(): Promise<void> {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
}
