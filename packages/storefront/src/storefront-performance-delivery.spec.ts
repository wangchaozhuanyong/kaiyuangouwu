// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { observeStorefrontPerformance } from './storefront-performance';

type Report = (id: string, page: string, name: string, value: number) => void;
const runtime = vi.hoisted(() => ({
    optedOut: false,
    report: undefined as Report | undefined,
    vital: undefined as ((metric: { name: string; value: number }) => void) | undefined,
}));
vi.mock('./storefront-traffic', () => ({
    TRAFFIC_PREFERENCE_EVENT: 'test:traffic-preference',
    storefrontTrafficOptedOut: () => runtime.optedOut,
}));
vi.mock('./storefront-experience-performance', () => ({
    observeStorefrontExperience: (report: Report) => {
        runtime.report = report;
        return () => undefined;
    },
}));
vi.mock('web-vitals/attribution', () => ({
    onCLS: (report: typeof runtime.vital) => {
        runtime.vital = report;
    },
    onFCP: vi.fn(),
    onINP: vi.fn(),
    onLCP: vi.fn(),
    onTTFB: vi.fn(),
}));

describe('bounded performance delivery', () => {
    let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
    let windowListeners: Array<[string, EventListenerOrEventListenerObject]>;
    let documentListeners: Array<[string, EventListenerOrEventListenerObject]>;
    const sample = (id: string, value = 100) => {
        if (!runtime.report) throw new Error('Experience observer was not registered');
        runtime.report(id, 'catalog', 'NAV_RENDER', value);
    };
    const payloads = () =>
        fetchMock.mock.calls.map(([, init]) => {
            if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body');
            return JSON.parse(init.body);
        });

    beforeEach(async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-22T10:00:00Z'));
        runtime.optedOut = false;
        runtime.report = undefined;
        runtime.vital = undefined;
        vi.stubGlobal('matchMedia', () => ({ matches: false }));
        fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
        vi.stubGlobal('fetch', fetchMock);
        windowListeners = [];
        documentListeners = [];
        const addWindow = window.addEventListener.bind(window);
        const addDocument = document.addEventListener.bind(document);
        vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
            windowListeners.push([type, listener]);
            addWindow(type, listener, options);
        });
        vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
            documentListeners.push([type, listener]);
            addDocument(type, listener, options);
        });
        observeStorefrontPerformance();
        await vi.dynamicImportSettled();
    });
    afterEach(() => {
        for (const [type, listener] of windowListeners) window.removeEventListener(type, listener);
        for (const [type, listener] of documentListeners) document.removeEventListener(type, listener);
        vi.clearAllTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('coalesces the latest metrics for each sample and spaces different samples apart', async () => {
        sample('first', 50);
        sample('first', 70);
        if (!runtime.report) throw new Error('Experience observer was not registered');
        runtime.report('first', 'catalog', 'NAV_READY', 90);
        sample('second');
        await vi.advanceTimersByTimeAsync(1000);
        expect(payloads()).toMatchObject([
            {
                sampleId: 'first',
                pageType: 'catalog',
                metrics: [
                    { name: 'NAV_RENDER', value: 70 },
                    { name: 'NAV_READY', value: 90 },
                ],
            },
        ]);
        expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'omit', keepalive: true });
        await vi.advanceTimersByTimeAsync(2999);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(payloads().map(batch => batch.sampleId)).toEqual(['first', 'second']);
    });

    it('bounds rapid navigation samples without a burst, including repeated pagehide events', async () => {
        for (let index = 0; index < 20; index++) sample(`route-${index}`);
        expect(fetchMock).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1000);
        for (let index = 0; index < 5; index++) window.dispatchEvent(new Event('pagehide'));
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(9000);
        expect(payloads().map(batch => batch.sampleId)).toEqual([
            'route-16',
            'route-17',
            'route-18',
            'route-19',
        ]);
    });

    it('never overlaps slow requests or retries a failed sample', async () => {
        let finish!: (response: Response) => void;
        fetchMock.mockImplementationOnce(
            () =>
                new Promise(resolve => {
                    finish = resolve;
                }),
        );
        sample('slow');
        sample('next');
        await vi.advanceTimersByTimeAsync(10_000);
        window.dispatchEvent(new Event('pagehide'));
        expect(fetchMock).toHaveBeenCalledTimes(1);
        finish(new Response(null, { status: 503 }));
        await vi.advanceTimersByTimeAsync(1);
        expect(payloads().map(batch => batch.sampleId)).toEqual(['slow', 'next']);
    });

    it.each(['missing', 'seconds', 'date', 'invalid'])('backs off on 429 with %s Retry-After', async mode => {
        const retryAfter =
            mode === 'seconds'
                ? '120'
                : mode === 'date'
                  ? new Date(Date.now() + 121_000).toUTCString()
                  : mode === 'invalid'
                    ? 'invalid'
                    : undefined;
        const delay = mode === 'seconds' || mode === 'date' ? 120_000 : 60_000;
        fetchMock.mockResolvedValueOnce(
            new Response(null, {
                status: 429,
                headers: retryAfter ? { 'Retry-After': retryAfter } : undefined,
            }),
        );
        sample('rejected');
        sample('stale');
        await vi.advanceTimersByTimeAsync(1000);
        sample('during-cooldown');
        window.dispatchEvent(new Event('pagehide'));
        await vi.advanceTimersByTimeAsync(delay - 1);
        sample('still-cooling');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        sample('fresh');
        await vi.advanceTimersByTimeAsync(1000);
        expect(payloads().map(batch => batch.sampleId)).toEqual(['rejected', 'fresh']);
    });

    it('drops queued metrics on opt-out and permits fresh consented samples later', async () => {
        sample('discard');
        runtime.optedOut = true;
        window.dispatchEvent(new Event('test:traffic-preference'));
        await vi.advanceTimersByTimeAsync(5000);
        if (!runtime.vital) throw new Error('Vital observer was not registered');
        runtime.vital({ name: 'CLS', value: 0.1 });
        expect(fetchMock).not.toHaveBeenCalled();
        runtime.optedOut = false;
        window.dispatchEvent(new Event('test:traffic-preference'));
        await vi.dynamicImportSettled();
        sample('fresh');
        await vi.advanceTimersByTimeAsync(1000);
        expect(payloads().map(batch => batch.sampleId)).toEqual(['fresh']);
    });
});
