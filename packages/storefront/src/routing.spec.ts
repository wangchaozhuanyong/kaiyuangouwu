import { describe, expect, it } from 'vitest';

import {
    getStorefrontScrollRestorationKey,
    routeFromHash,
    routeFromRouterLocation,
    routeHref,
} from './storefront-router';

describe('storefront routing', () => {
    it('builds browser-history URLs and reads their search state', () => {
        expect(routeHref({ name: 'product', id: '42' })).toBe('/product?id=42');
        expect(routeFromRouterLocation('/product', { id: 42 })).toMatchObject({
            name: 'product',
            id: '42',
        });
        expect(routeFromRouterLocation('/orders', { tab: 'shipping' })).toMatchObject({
            name: 'orders',
            tab: 'shipping',
        });
    });

    it('keeps root-page scroll positions while isolating subpage history entries', () => {
        expect(
            getStorefrontScrollRestorationKey({
                href: '/account',
                pathname: '/account',
                state: { __TSR_key: 'account-entry-1' },
            }),
        ).toBe('root:/account');
        expect(
            getStorefrontScrollRestorationKey({
                href: '/account',
                pathname: '/account/',
                state: { __TSR_key: 'account-entry-2' },
            }),
        ).toBe('root:/account');
        expect(
            getStorefrontScrollRestorationKey({
                href: '/favorites',
                pathname: '/favorites',
                state: { __TSR_key: 'favorites-entry' },
            }),
        ).toBe('favorites-entry');
    });

    it('opens the home page for an empty hash', () => {
        expect(routeFromHash('')).toEqual({
            name: 'home',
            id: undefined,
            tab: undefined,
            token: undefined,
            term: undefined,
        });
    });

    it('accepts known paths with optional trailing slashes', () => {
        expect(routeFromHash('#/category/').name).toBe('category');
        expect(routeFromHash('#/product?id=42')).toMatchObject({ name: 'product', id: '42' });
    });

    it('restores category filters from hash query parameters', () => {
        expect(
            routeFromHash(
                '#/category?collection=1&child=2&sort=sales&fulfillment=digital&stock=1&minPrice=10&maxPrice=50',
            ),
        ).toMatchObject({
            name: 'category',
            collectionId: '1',
            childId: '2',
            sort: 'sales',
            fulfillment: 'digital',
            inStockOnly: true,
            minPrice: '10',
            maxPrice: '50',
        });
    });

    it('shows the not-found page for an unknown path', () => {
        expect(routeFromHash('#/missing-page').name).toBe('not-found');
    });

    it('keeps valid order tabs and ignores unsupported values', () => {
        expect(routeFromHash('#/orders?tab=shipping').tab).toBe('shipping');
        expect(routeFromHash('#/orders?tab=unknown').tab).toBeUndefined();
    });

    it('opens payment and guest order confirmation routes', () => {
        expect(routeFromHash('#/purchase').name).toBe('purchase');
        expect(routeFromHash('#/payment').name).toBe('payment');
        expect(routeFromHash('#/order-confirmation?id=T0001&token=signed%2Btoken')).toMatchObject({
            name: 'order-confirmation',
            id: 'T0001',
            token: 'signed+token',
        });
    });

    it('opens managed legal pages from storefront content links', () => {
        expect(routeFromHash('#/legal?id=privacy')).toMatchObject({ name: 'legal', id: 'privacy' });
        expect(routeFromHash('#/legal?id=terms')).toMatchObject({ name: 'legal', id: 'terms' });
    });

    it('opens account service, coupon, and review routes', () => {
        expect(routeFromHash('#/services').name).toBe('services');
        expect(routeFromHash('#/favorites').name).toBe('favorites');
        expect(routeFromHash('#/announcements').name).toBe('announcements');
        expect(routeFromHash('#/logistics').name).toBe('logistics');
        expect(routeFromHash('#/support').name).toBe('support');
        expect(routeFromHash('#/coupons').name).toBe('coupons');
        expect(routeFromHash('#/reviews').name).toBe('reviews');
        expect(routeFromHash('#/flash-sale').name).toBe('flash-sale');
        expect(routeFromHash('#/recommendations').name).toBe('recommendations');
    });

    it('preserves email verification and password reset tokens', () => {
        expect(routeFromHash('#/verify-account?token=verify%2Btoken')).toMatchObject({
            name: 'verify-account',
            token: 'verify+token',
        });
        expect(routeFromHash('#/reset-password?token=reset%2Btoken')).toMatchObject({
            name: 'reset-password',
            token: 'reset+token',
        });
    });
});
