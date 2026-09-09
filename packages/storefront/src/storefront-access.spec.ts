import { describe, expect, it } from 'vitest';

import { isPublicStorefrontRoute } from './storefront-access';

describe('storefront account boundary', () => {
    it.each([
        'home',
        'product',
        'category',
        'search',
        'flash-sale',
        'recommendations',
        'announcements',
    ] as const)('requires an authenticated account before rendering %s', route =>
        expect(isPublicStorefrontRoute(route)).toBe(false),
    );
    it.each([
        'login',
        'register',
        'verify-account',
        'reset-password',
        'forgot-password',
        'legal',
        'support',
    ] as const)('keeps account and policy routes available: %s', route =>
        expect(isPublicStorefrontRoute(route)).toBe(true),
    );
});
