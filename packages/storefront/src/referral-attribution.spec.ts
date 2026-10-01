import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    attributionWithinWindow,
    captureReferralAttribution,
    normalizeReferralCode,
    readReferralAttribution,
    referralShareUrl,
    storefrontVisitorId,
} from './referral-attribution';
import { setStorefrontPreviewParameters } from './storefront-preview-parameters';

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

    it.each(['LINK', 'POSTER'] as const)(
        'keeps a stored %s invitation after years when days is zero',
        source => {
            const storage = memoryStorage();
            const captured = captureReferralAttribution(
                { search: `?ref=AB12CD&source=${source}` },
                storage,
                1_000,
            );
            const laterVisit = captureReferralAttribution(
                { search: '' },
                storage,
                1_000 + 10 * 365 * 86_400_000,
            );

            expect(attributionWithinWindow(laterVisit, 0, 1_000 + 10 * 365 * 86_400_000)).toEqual(captured);
            expect(attributionWithinWindow(laterVisit, 365, 1_000 + 10 * 365 * 86_400_000)).toBeNull();
        },
    );

    it('refreshes attribution when the same invitation URL is opened again years later', () => {
        const storage = memoryStorage();
        const location = { search: '?ref=AB12CD&source=LINK' };
        captureReferralAttribution(location, storage, 1_000);
        const now = 1_000 + 10 * 365 * 86_400_000;
        const captured = captureReferralAttribution(location, storage, now);

        expect(attributionWithinWindow(captured, 30, now + 1_000)).toEqual({
            code: 'AB12CD',
            source: 'LINK',
            capturedAt: now,
        });
    });

    it('still rejects missing and future-dated attribution when days is zero', () => {
        expect(attributionWithinWindow(null, 0, 1_000)).toBeNull();
        expect(
            attributionWithinWindow({ code: 'AB12CD', source: 'LINK', capturedAt: 1_001 }, 0, 1_000),
        ).toBeNull();
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

describe('referral share links', () => {
    afterEach(() => {
        setStorefrontPreviewParameters(new URLSearchParams());
        vi.unstubAllGlobals();
    });

    it('keeps the public store origin and normalizes poster invitations', () => {
        vi.stubGlobal('window', {
            location: { origin: 'https://shop.example.test', href: 'https://shop.example.test/referral' },
        });
        expect(referralShareUrl(' ab 12 ', 'POSTER')).toBe(
            'https://shop.example.test/register?ref=AB12&source=POSTER',
        );
    });

    it('uses the existing preview document address inside an Admin srcdoc frame', () => {
        vi.stubGlobal('window', { location: { origin: 'null', href: 'about:srcdoc' } });
        setStorefrontPreviewParameters(
            new URLSearchParams({ storefrontPreviewDocumentUrl: 'https://preview.example.test/' }),
        );
        expect(referralShareUrl('AB12')).toBe('https://preview.example.test/register?ref=AB12&source=LINK');
    });
});
