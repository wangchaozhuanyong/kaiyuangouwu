import { describe, expect, it } from 'vitest';

import { routeFromHash } from './App';

describe('storefront hash routing', () => {
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
        expect(routeFromHash('#/payment').name).toBe('payment');
        expect(routeFromHash('#/order-confirmation?id=T0001')).toMatchObject({
            name: 'order-confirmation',
            id: 'T0001',
        });
    });

    it('opens temporary legal pages from managed footer links', () => {
        expect(routeFromHash('#/legal?id=privacy')).toMatchObject({ name: 'legal', id: 'privacy' });
        expect(routeFromHash('#/legal?id=terms')).toMatchObject({ name: 'legal', id: 'terms' });
    });

    it('opens account service, coupon, and review routes', () => {
        expect(routeFromHash('#/favorites').name).toBe('favorites');
        expect(routeFromHash('#/support').name).toBe('support');
        expect(routeFromHash('#/coupons').name).toBe('coupons');
        expect(routeFromHash('#/reviews').name).toBe('reviews');
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
