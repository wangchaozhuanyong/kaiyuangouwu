import { describe, expect, it } from 'vitest';

import {
    isLikelyAutomatedStorefrontRequest,
    resolveStorefrontVisitorIdentity,
    STOREFRONT_VISITOR_COOKIE,
} from './storefront-visitor-identity';

const signingSecret = 'test-storefront-visitor-signing-secret-at-least-32-characters';
const browserHeaders = {
    'user-agent': 'Mozilla/5.0 Test Browser',
    'sec-ch-ua-platform': '"macOS"',
};

describe('storefront visitor identity', () => {
    it('signs a persistent device cookie and accepts it on the next request', () => {
        const first = resolveStorefrontVisitorIdentity({
            req: { headers: browserHeaders, ip: '203.0.113.10', secure: true },
            channelId: '1',
            visitorId: 'device-visitor-id-00000001',
            signingSecret,
            now: 1_000,
        });

        expect(first).toMatchObject({
            kind: 'DEVICE',
            keyMaterial: 'device:device-visitor-id-00000001',
        });
        expect(first?.setCookie).toContain(`${STOREFRONT_VISITOR_COOKIE}=`);
        expect(first?.setCookie).toContain('HttpOnly; SameSite=Lax; Secure');

        const cookie = first?.setCookie?.split(';')[0];
        const next = resolveStorefrontVisitorIdentity({
            req: { headers: { ...browserHeaders, cookie }, ip: '198.51.100.20' },
            channelId: '1',
            visitorId: 'different-client-value-0002',
            signingSecret,
            now: 2_000,
        });

        expect(next).toMatchObject({
            kind: 'DEVICE',
            keyMaterial: 'device:device-visitor-id-00000001',
            setCookie: null,
        });
    });

    it('rejects a tampered or cross-channel cookie', () => {
        const first = resolveStorefrontVisitorIdentity({
            req: { headers: browserHeaders, ip: '203.0.113.10' },
            channelId: '1',
            visitorId: 'device-visitor-id-00000001',
            signingSecret,
            now: 1_000,
        });
        const cookie = first?.setCookie?.split(';')[0].replace(/.$/u, 'x');

        expect(
            resolveStorefrontVisitorIdentity({
                req: { headers: { ...browserHeaders, cookie }, ip: '203.0.113.10' },
                channelId: '2',
                visitorId: null,
                signingSecret,
                now: 2_000,
            }),
        ).toMatchObject({ kind: 'FINGERPRINT' });
    });

    it('falls back to IP and browser characteristics when storage identifiers are unavailable', () => {
        const first = resolveStorefrontVisitorIdentity({
            req: { headers: browserHeaders, ip: '203.0.113.10' },
            channelId: '1',
            signingSecret,
        });
        const second = resolveStorefrontVisitorIdentity({
            req: { headers: browserHeaders, ip: '203.0.113.10' },
            channelId: '1',
            signingSecret,
        });

        expect(first).toMatchObject({ kind: 'FINGERPRINT', setCookie: null });
        expect(second?.keyMaterial).toBe(first?.keyMaterial);
    });

    it('filters common bots and requests without a browser user agent', () => {
        expect(isLikelyAutomatedStorefrontRequest({ headers: { 'user-agent': 'Googlebot/2.1' } })).toBe(true);
        expect(isLikelyAutomatedStorefrontRequest({ headers: browserHeaders })).toBe(false);
        expect(isLikelyAutomatedStorefrontRequest({ headers: {} })).toBe(true);
    });
});
