import { describe, expect, it } from 'vitest';

import { authOverlayForNavigation, readAuthOverlay } from './auth-overlay-navigation';
import {
    authOverlayLoginRoute,
    withAuthOverlay,
    withoutAuthOverlay,
} from './auth-overlay-navigation-actions';
import { normalizeRouteSearch, routeFromRouterLocation, routeHref } from './storefront-router';

describe('authentication overlay navigation targets', () => {
    it.each(['login', 'register', 'forgot-password'] as const)('reads the allowed %s mode', mode => {
        expect(readAuthOverlay({ auth: mode })).toEqual({ mode, target: undefined });
    });

    it.each([undefined, 'reset-password', 'verify-account', 'LOGIN', []])(
        'ignores an unsupported mode %j',
        auth => expect(readAuthOverlay({ auth })).toBeNull(),
    );

    it.each(['/account', '/orders?tab=pending', '/purchase?id=variant-7&quantity=3'])(
        'accepts the known private destination %s',
        authTarget => {
            const request = readAuthOverlay({ auth: 'login', authTarget });
            expect(request?.target).toBeDefined();
            if (!request?.target) throw new Error('Expected private authentication target');
            expect(routeHref(request.target)).toBe(authTarget);
        },
    );

    it.each([
        'https://external.example/account',
        '//external.example/account',
        '/\\external.example/account',
        '/verify-account?token=example-verification-token',
        '/reset-password?token=example-reset-token',
        '/login?returnTo=purchase',
        '/not-a-storefront-route',
        '/product?id=public-product',
        '/services',
    ])('rejects an external, token or public destination %s', authTarget => {
        expect(readAuthOverlay({ auth: 'register', authTarget })).toEqual({
            mode: 'register',
            target: undefined,
        });
    });

    it('preserves purchase variant and quantity through target encoding and the completion route', () => {
        const request = authOverlayForNavigation(
            { name: 'login', returnTo: 'purchase', id: 'variant & one', quantity: 3 },
            false,
        );
        expect(request).toEqual({
            mode: 'login',
            target: { name: 'purchase', id: 'variant & one', quantity: 3 },
        });
        if (!request) throw new Error('Expected purchase authentication request');
        const restored = readAuthOverlay(withAuthOverlay({ collectionId: 'original' }, request));
        if (!restored) throw new Error('Expected restored authentication request');
        expect(authOverlayLoginRoute(restored)).toEqual({
            name: 'login',
            returnTo: 'purchase',
            id: 'variant & one',
            quantity: 3,
        });
        expect(authOverlayLoginRoute({ mode: 'login', target: { name: 'orders' } })).toEqual({
            name: 'login',
        });
    });

    it('opens authentication for private guest navigation while keeping public and authenticated navigation normal', () => {
        expect(authOverlayForNavigation({ name: 'orders', tab: 'pending' }, false)).toEqual({
            mode: 'login',
            target: { name: 'orders', tab: 'pending' },
        });
        for (const name of ['product', 'services', 'verify-account', 'reset-password'] as const) {
            expect(authOverlayForNavigation({ name }, false)).toBeNull();
        }
        expect(authOverlayForNavigation({ name: 'orders' }, true)).toBeNull();
    });

    it('removes only overlay state and retains the original search and background page identity', () => {
        const original = { collectionId: 'chosen', minPrice: '10', inStockOnly: true };
        const search = withAuthOverlay(
            { ...original, auth: 'login', authTarget: '/cart' },
            { mode: 'register', target: { name: 'orders', tab: 'pending' } },
        );
        expect(search).toEqual({ ...original, auth: 'register', authTarget: '/orders?tab=pending' });
        expect(withoutAuthOverlay(search)).toEqual(original);
        expect(normalizeRouteSearch(search)).toMatchObject({
            auth: 'register',
            authTarget: '/orders?tab=pending',
        });
        expect(routeFromRouterLocation('/category', search)).toEqual(
            routeFromRouterLocation('/category', original),
        );
        expect(routeFromRouterLocation('/category', search)).not.toHaveProperty('auth');
        expect(routeFromRouterLocation('/category', search)).not.toHaveProperty('authTarget');
    });
});
