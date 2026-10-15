// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
    optedOut: true,
    experience: undefined as undefined | ((id: string, page: string, name: string, value: number) => void),
    metric: undefined as undefined | ((value: unknown) => void),
    stop: vi.fn(),
    observe: vi.fn(),
}));
vi.mock('./storefront-traffic', () => ({
    storefrontTrafficOptedOut: () => runtime.optedOut,
    TRAFFIC_PREFERENCE_EVENT: 'storefront-traffic-preference',
}));
vi.mock('./storefront-experience-performance', () => ({
    observeStorefrontExperience: (callback: typeof runtime.experience) => {
        runtime.experience = callback;
        runtime.observe();
        return runtime.stop;
    },
}));
vi.mock('web-vitals/attribution', () => ({
    onCLS: vi.fn(),
    onFCP: vi.fn(),
    onINP: vi.fn(),
    onTTFB: vi.fn(),
    onLCP: (callback: typeof runtime.metric) => {
        runtime.metric = callback;
    },
}));

import { observeStorefrontPerformance } from './storefront-performance';

it('respects opt-out before/after pending observations and keeps document CWV separate from SPA samples', async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('fetch', send);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const listeners: Array<{
        owner: Window | Document;
        type: string;
        listener: EventListenerOrEventListenerObject;
    }> = [];
    for (const owner of [window, document]) {
        const original = owner.addEventListener.bind(owner);
        vi.spyOn(owner, 'addEventListener').mockImplementation((type, listener, options) => {
            listeners.push({ owner, type, listener });
            original(type, listener, options);
        });
    }
    try {
        observeStorefrontPerformance();
        await vi.dynamicImportSettled();
        expect(runtime.observe).not.toHaveBeenCalled();
        runtime.optedOut = false;
        window.dispatchEvent(new Event('storefront-traffic-preference'));
        await vi.dynamicImportSettled();
        expect(runtime.observe).toHaveBeenCalledTimes(1);
        const routeId = '842d232d-2c7a-46a7-bb76-2dc46824962e';
        runtime.experience?.(routeId, 'services', 'NAV_RENDER', 40);
        runtime.experience?.(routeId, 'services', 'NAV_READY', 80);
        runtime.metric?.({ name: 'LCP', value: 1234, id: 'private', entries: [] });
        await vi.advanceTimersByTimeAsync(1000);
        expect(send).toHaveBeenCalledTimes(2);
        const payloads = send.mock.calls.map(([, options]) => JSON.parse(options.body));
        expect(payloads.find(value => value.pageType === 'services')).toMatchObject({
            sampleId: routeId,
            metrics: [
                { name: 'NAV_RENDER', value: 40 },
                { name: 'NAV_READY', value: 80 },
            ],
        });
        expect(payloads.find(value => value.pageType === 'home')?.sampleId).not.toBe(routeId);
        expect(JSON.stringify(payloads)).not.toContain('private');
        expect(send.mock.calls[0][1]).toMatchObject({ credentials: 'omit', keepalive: true });
        send.mockClear();
        runtime.experience?.(routeId, 'services', 'IMAGE_PRESENT', 200);
        runtime.optedOut = true;
        window.dispatchEvent(new Event('storefront-traffic-preference'));
        runtime.experience?.(routeId, 'services', 'IMAGE_ERROR', 1);
        runtime.metric?.({ name: 'LCP', value: 99, entries: [] });
        await vi.advanceTimersByTimeAsync(1000);
        expect(send).not.toHaveBeenCalled();
        expect(runtime.stop).toHaveBeenCalledTimes(1);
        runtime.optedOut = false;
        window.dispatchEvent(new Event('storefront-traffic-preference'));
        await vi.dynamicImportSettled();
        expect(runtime.observe).toHaveBeenCalledTimes(2);
        runtime.experience?.(routeId, 'support', 'NAV_READY', 20);
        window.dispatchEvent(new Event('pagehide'));
        expect(send).toHaveBeenCalledTimes(1);
        expect(runtime.stop).toHaveBeenCalledTimes(2);
    } finally {
        for (const { owner, type, listener } of listeners) owner.removeEventListener(type, listener);
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    }
});
