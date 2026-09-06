import { describe, expect, it, vi } from 'vitest';

import { createStorefrontTrafficTracker, shouldTrackStorefrontTraffic } from './storefront-traffic';

const page = { channel: 'my-malaysia', location: '/', businessDate: '2026-09-05', customerId: null };
const visitor = 'test-visitor-id-00000001';

describe('storefront traffic collection', () => {
    it('counts rerenders once, counts route navigation and returning to a previous route', async () => {
        const send = vi.fn().mockResolvedValue(true);
        const tracker = createStorefrontTrafficTracker();
        await tracker.track(page, visitor, send);
        await tracker.track(page, visitor, send);
        await tracker.track({ ...page, location: '/products/one' }, visitor, send);
        await tracker.track(page, visitor, send);
        expect(send).toHaveBeenCalledTimes(3);
        expect(new Set(send.mock.calls.map(([input]) => input.eventId)).size).toBe(3);
    });

    it('identifies login without adding a page view and serializes it after the initial view', async () => {
        const send = vi.fn().mockResolvedValue(true);
        const tracker = createStorefrontTrafficTracker();
        const first = tracker.track(page, visitor, send);
        const login = tracker.track({ ...page, customerId: 'customer-1' }, visitor, send);
        await Promise.all([first, login]);
        expect(send.mock.calls.map(([input]) => input.pageView)).toEqual([true, false]);
        expect(send.mock.calls[0][0].eventId).toBe(send.mock.calls[1][0].eventId);
    });

    it('retries an uncertain response with the same event ID', async () => {
        const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(true);
        await createStorefrontTrafficTracker().track(page, visitor, send);
        expect(send).toHaveBeenCalledTimes(2);
        expect(send.mock.calls[0][0]).toEqual(send.mock.calls[1][0]);
    });

    it('keeps the same event when reconnecting after both responses were lost', async () => {
        const send = vi
            .fn()
            .mockRejectedValueOnce(new Error('response lost'))
            .mockRejectedValueOnce(new Error('still offline'))
            .mockResolvedValue(true);
        const tracker = createStorefrontTrafficTracker();
        await tracker.track(page, visitor, send);
        await tracker.track(page, visitor, send);
        await tracker.track(page, visitor, send);
        expect(send).toHaveBeenCalledTimes(3);
        expect(send.mock.calls.map(([input]) => input)).toEqual(Array(3).fill(send.mock.calls[0][0]));
    });

    it('recovers the original view when login was queued behind an unconfirmed request', async () => {
        const send = vi
            .fn()
            .mockRejectedValueOnce(new Error('offline'))
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValue(true);
        const tracker = createStorefrontTrafficTracker();
        const first = tracker.track(page, visitor, send);
        const login = tracker.track({ ...page, customerId: 'customer-1' }, visitor, send);
        await Promise.all([first, login]);
        expect(send).toHaveBeenCalledTimes(3);
        expect(new Set(send.mock.calls.map(([input]) => input.eventId)).size).toBe(1);
        expect(send.mock.calls.map(([input]) => input.pageView)).toEqual([true, true, true]);
    });

    it('allows an unrecorded response to be retried on the next observation', async () => {
        const send = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
        const tracker = createStorefrontTrafficTracker();
        await tracker.track(page, visitor, send);
        await tracker.track(page, visitor, send);
        expect(send).toHaveBeenCalledTimes(2);
        expect(send.mock.calls[0][0]).toEqual(send.mock.calls[1][0]);
    });

    it('records a new view for a new day or a different store', async () => {
        const send = vi.fn().mockResolvedValue(true);
        const tracker = createStorefrontTrafficTracker();
        await tracker.track(page, visitor, send);
        await tracker.track({ ...page, businessDate: '2026-09-06' }, visitor, send);
        await tracker.track({ ...page, channel: 'cn-mainland' }, visitor, send);
        expect(send).toHaveBeenCalledTimes(3);
    });

    it('excludes internal, automated, hidden and opted-out page views', () => {
        const input = {
            hostname: 'shop.example',
            pathname: '/',
            visible: true,
            automated: false,
            optedOut: false,
        };
        expect(shouldTrackStorefrontTraffic(input)).toBe(true);
        for (const override of [
            { hostname: 'localhost' },
            { hostname: '127.0.0.1' },
            { hostname: '[::1]' },
            { pathname: '/dashboard/' },
            { visible: false },
            { automated: true },
            { optedOut: true },
        ])
            expect(shouldTrackStorefrontTraffic({ ...input, ...override })).toBe(false);
    });
});
