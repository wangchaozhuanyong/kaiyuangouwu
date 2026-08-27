import { describe, expect, it } from 'vitest';

import {
    attributionWithinWindow,
    captureReferralAttribution,
    normalizeReferralCode,
    readReferralAttribution,
    storefrontVisitorId,
} from './referral-attribution';

function memoryStorage() {
    const values = new Map<string, string>();
    return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
    };
}

describe('referral attribution', () => {
    it('captures a normalized code and poster source from the registration URL', () => {
        const storage = memoryStorage();
        const captured = captureReferralAttribution(
            { search: '?ref= ab 12 cd &source=poster' },
            storage,
            1_000,
        );

        expect(captured).toEqual({ code: 'AB12CD', source: 'POSTER', capturedAt: 1_000 });
        expect(readReferralAttribution(storage)).toEqual(captured);
    });

    it('expires captured attribution outside the configured window', () => {
        const attribution = { code: 'AB12CD', source: 'LINK' as const, capturedAt: 1_000 };
        expect(attributionWithinWindow(attribution, 30, 1_000 + 30 * 86_400_000)).toEqual(attribution);
        expect(attributionWithinWindow(attribution, 30, 1_001 + 30 * 86_400_000)).toBeNull();
    });

    it('normalizes and caps user-entered codes', () => {
        expect(normalizeReferralCode(' abc def 123456789 ')).toBe('ABCDEF123456');
    });

    it('does not access browser globals during server-side rendering', () => {
        expect(captureReferralAttribution()).toBeNull();
        expect(readReferralAttribution()).toBeNull();
        expect(storefrontVisitorId()).toBeNull();
    });

    it('reuses one anonymous device id and survives unavailable storage', () => {
        const storage = memoryStorage();
        expect(storefrontVisitorId(storage, () => 'visitor-device-id-00000001')).toBe(
            'visitor-device-id-00000001',
        );
        expect(storefrontVisitorId(storage, () => 'visitor-device-id-00000002')).toBe(
            'visitor-device-id-00000001',
        );
        expect(
            storefrontVisitorId(
                {
                    getItem: () => {
                        throw new Error('storage blocked');
                    },
                    setItem: () => undefined,
                },
                () => 'visitor-device-id-00000003',
            ),
        ).toBeNull();
    });
});
