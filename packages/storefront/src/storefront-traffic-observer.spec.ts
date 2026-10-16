// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ShopApi } from './api';
import { routeFromRouterLocation, routeHref } from './storefront-router';
import { setStorefrontTrafficConsent } from './storefront-traffic';
import { observeStorefrontTraffic, type TrafficTracker } from './storefront-traffic-observer';

describe('displayed storefront traffic observation', () => {
    let browser: EventTarget & {
        location: URL;
        setInterval: ReturnType<typeof vi.fn>;
        clearInterval: ReturnType<typeof vi.fn>;
    };
    let tracker: { current: TrafficTracker | null };
    let send: ReturnType<typeof vi.fn>;
    let cleanups: Array<() => void>;
    const flush = async () => {
        for (let index = 0; index < 6; index++) await Promise.resolve();
    };
    const observe = (location = '/zh/', channel = 'shop-one', customerId: string | null = null) => {
        const api = {
            recordStorefrontPageView: send,
            contentReviewsApi: { recordStorefrontHeartbeat: vi.fn().mockResolvedValue(true) },
        } as unknown as ShopApi;
        const cleanup = observeStorefrontTraffic(
            { api, channel, location, customerId, enabled: true },
            tracker,
        );
        cleanups.push(cleanup);
        return cleanup;
    };

    beforeEach(() => {
        localStorage.clear();
        document.cookie = 'storefront_analytics_consent=; Path=/; Max-Age=0';
        document.cookie = 'storefront_analytics_opt_out=; Path=/; Max-Age=0';
        browser = Object.assign(new EventTarget(), {
            location: new URL('https://shop.example/zh/'),
            setInterval: vi.fn().mockReturnValue(1),
            clearInterval: vi.fn(),
        });
        vi.stubGlobal('window', browser);
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
        tracker = { current: null };
        send = vi.fn().mockResolvedValue(true);
        cleanups = [];
    });

    afterEach(() => {
        cleanups.forEach(cleanup => cleanup());
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('starts only after consent and does not recount focus, reconnect or repeat consent', async () => {
        observe();
        await flush();
        expect(send).not.toHaveBeenCalled();

        setStorefrontTrafficConsent(true);
        await flush();
        browser.dispatchEvent(new Event('focus'));
        browser.dispatchEvent(new Event('online'));
        setStorefrontTrafficConsent(true);
        await flush();
        expect(send).toHaveBeenCalledOnce();

        setStorefrontTrafficConsent(false);
        browser.dispatchEvent(new Event('focus'));
        await flush();
        expect(send).toHaveBeenCalledOnce();
    });

    it('captures allowed entry tags from the actual URL instead of the sanitized router URL', async () => {
        setStorefrontTrafficConsent(true);
        browser.location = new URL(
            'https://shop.example/zh/?utm_source=Google&utm_medium=CPC&utm_campaign=Launch&utm_term=red+shoe&email=private&token=secret&gclid=private-click',
        );
        const route = routeFromRouterLocation(
            browser.location.pathname,
            Object.fromEntries(browser.location.searchParams),
        );
        const displayedLocation = routeHref(route);
        expect(displayedLocation).not.toContain('utm_');
        observe(displayedLocation);
        await flush();
        expect(send).toHaveBeenCalledWith(
            expect.objectContaining({
                path: '/zh/',
                source: 'Google',
                medium: 'CPC',
                campaign: 'Launch',
                term: 'red shoe',
            }),
        );
        const payload = JSON.stringify(send.mock.calls[0][0]);
        for (const privateValue of ['email', 'private', 'token', 'secret', 'gclid'])
            expect(payload).not.toContain(privateValue);
    });

    it('does not attach a pending or foreign route campaign to the displayed page', async () => {
        setStorefrontTrafficConsent(true);
        browser.location = new URL('https://shop.example/zh/product?id=next&utm_campaign=wrong-page');
        observe('/zh/');
        await flush();
        expect(send.mock.calls[0][0]).toMatchObject({ path: '/zh/', campaign: null });

        cleanups.pop()?.();
        observe('https://another.example/zh/product');
        await flush();
        expect(send.mock.calls[1][0]).toMatchObject({ campaign: null });
    });

    it('counts displayed SPA routes, back, store changes and reload with distinct event IDs', async () => {
        setStorefrontTrafficConsent(true);
        let cleanup = observe();
        await flush();
        cleanup();
        browser.location = new URL('https://shop.example/zh/product?id=one');
        cleanup = observe('/zh/product?id=one');
        await flush();
        cleanup();
        browser.location = new URL('https://shop.example/zh/');
        cleanup = observe();
        await flush();
        cleanup();
        cleanup = observe('/zh/', 'shop-two');
        await flush();
        cleanup();
        tracker = { current: null }; // A new document owns a new tracker, even at the same route.
        observe('/zh/', 'shop-two');
        await flush();
        expect(send).toHaveBeenCalledTimes(5);
        expect(new Set(send.mock.calls.map(([input]) => input.eventId)).size).toBe(5);
        expect(send.mock.calls.every(([input]) => input.pageView)).toBe(true);
    });

    it('identifies login without counting another view and retries lost responses with the same ID', async () => {
        setStorefrontTrafficConsent(true);
        send.mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('response lost'));
        const cleanup = observe();
        await flush();
        browser.dispatchEvent(new Event('online'));
        await flush();
        cleanup();
        observe('/zh/', 'shop-one', 'customer-one');
        await flush();
        expect(send).toHaveBeenCalledTimes(4);
        expect(new Set(send.mock.calls.map(([input]) => input.eventId)).size).toBe(1);
        expect(send.mock.calls.map(([input]) => input.pageView)).toEqual([true, true, true, false]);
    });

    it('ignores hidden and embedded preview documents', async () => {
        setStorefrontTrafficConsent(true);
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        const cleanup = observe();
        await flush();
        expect(send).not.toHaveBeenCalled();
        cleanup();
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
        browser.location = new URL('https://shop.example/zh/?storefrontPreviewEmbedded=1');
        observe();
        await flush();
        expect(send).not.toHaveBeenCalled();
    });
});
