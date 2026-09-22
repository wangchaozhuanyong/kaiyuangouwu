// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    setStorefrontTrafficConsent,
    storefrontTrafficConsent,
    storefrontTrafficConsentId,
    storefrontTrafficOptedOut,
} from './storefront-traffic';

describe('storefront analytics consent', () => {
    beforeEach(() => {
        localStorage.clear();
        document.cookie = 'storefront_analytics_consent=; Path=/; Max-Age=0';
        document.cookie = 'storefront_analytics_opt_out=; Path=/; Max-Age=0';
    });

    it('keeps analytics off until a visitor explicitly chooses', () => {
        expect(storefrontTrafficConsent()).toBe('unknown');
        expect(storefrontTrafficOptedOut()).toBe(true);
    });

    it('persists grant and withdrawal choices in same-origin storage', () => {
        setStorefrontTrafficConsent(true);
        expect(storefrontTrafficConsent()).toBe('granted');
        expect(storefrontTrafficOptedOut()).toBe(false);

        setStorefrontTrafficConsent(false);
        expect(storefrontTrafficConsent()).toBe('denied');
        expect(storefrontTrafficOptedOut()).toBe(true);
    });

    it('uses a stable random consent identifier without exposing network identity', () => {
        vi.stubGlobal('crypto', { randomUUID: () => '00000000-0000-4000-8000-000000000123' });
        expect(storefrontTrafficConsentId()).toBe('00000000-0000-4000-8000-000000000123');
        expect(storefrontTrafficConsentId()).toBe('00000000-0000-4000-8000-000000000123');
        vi.unstubAllGlobals();
    });

    it('replaces a malformed stored identifier before sending consent evidence', () => {
        localStorage.setItem('storefront-analytics-consent-id:v1', 'ffffffff-ffff-ffff-ffff-ffffffffffff');
        vi.stubGlobal('crypto', { randomUUID: () => '00000000-0000-4000-8000-000000000124' });
        expect(storefrontTrafficConsentId()).toBe('00000000-0000-4000-8000-000000000124');
        vi.unstubAllGlobals();
    });
});
