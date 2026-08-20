import { describe, expect, it } from 'vitest';

import { buildAccountActionUrl } from './account-auth';

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
});
