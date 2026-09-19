import { describe, expect, it } from 'vitest';

import { isPublicStorefrontRoute } from './storefront-access';

describe('storefront account boundary', () => {
    it.each([
        'account',
        'orders',
        'order-detail',
        'checkout',
        'payment',
        'cart',
        'addresses',
        'account-security',
        'notifications',
        'reviews',
        'image-studio',
        'referral',
    ] as const)('keeps customer data and actions protected: %s', route =>
        expect(isPublicStorefrontRoute(route)).toBe(false),
    );
    it.each([
        'home',
        'product',
        'category',
        'search',
        'flash-sale',
        'recommendations',
        'announcements',
        'services',
        'two-factor',
        'mail-query',
        'not-found',
    ] as const)('allows public browsing of %s', route => expect(isPublicStorefrontRoute(route)).toBe(true));
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
