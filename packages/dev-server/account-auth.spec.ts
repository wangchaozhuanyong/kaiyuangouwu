import { describe, expect, it } from 'vitest';

import { buildAccountActionUrl, buildSignedStorefrontAccountActionUrl } from './account-auth';

const signingSecret = 'test-signing-secret-that-is-at-least-thirty-two-characters';

describe('account email action URLs', () => {
    it('adds an encoded token inside a hash route', () => {
        expect(buildAccountActionUrl('https://shop.example.com/#/verify-account', 'token+/?=& value')).toBe(
            'https://shop.example.com/#/verify-account?token=token%2B%2F%3F%3D%26+value',
        );
    });

    it('preserves existing route parameters', () => {
        expect(buildAccountActionUrl('https://shop.example.com/#/reset-password?market=cn', 'token')).toBe(
            'https://shop.example.com/#/reset-password?market=cn&token=token',
        );
    });

    it('rejects a missing token', () => {
        expect(() => buildAccountActionUrl('https://shop.example.com/#/verify-account', '')).toThrow(
            'without a token',
        );
    });

    it('signs storefront account entry links without exposing the token in the proof payload', () => {
        const url = new URL(
            buildSignedStorefrontAccountActionUrl(
                'https://shop.example.com/promo/account-entry?route=verify-account',
                'verification-token',
                signingSecret,
                Date.parse('2026-08-23T00:00:00.000Z'),
            ),
        );

        expect(url.searchParams.get('route')).toBe('verify-account');
        expect(url.searchParams.get('token')).toBe('verification-token');
        expect(url.searchParams.get('proof')).toMatch(/^[^.]+\.[^.]+$/);
        expect(url.searchParams.get('proof')).not.toContain('verification-token');
    });

    it('rejects unsupported storefront account routes', () => {
        expect(() =>
            buildSignedStorefrontAccountActionUrl(
                'https://shop.example.com/promo/account-entry?route=change-email',
                'token',
                signingSecret,
            ),
        ).toThrow(/unsupported route/);
    });
});
