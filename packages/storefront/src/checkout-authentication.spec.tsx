// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ShopApi } from './api';
import { LoginPage } from './auth-pages';
import { resumeAuthenticatedCheckout } from './checkout-authentication';
import { RouteGate } from './route-pages/shared';
import { RouteName } from './storefront-router';
import { StorefrontContext, StorefrontContextValue } from './StorefrontContext';
import { ActiveCustomer, Order, StorefrontCart } from './types';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => navigate,
    Navigate: (props: unknown) => {
        navigate(props);
        return null;
    },
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cart = {
    id: 'cart-1',
    selectedQuantity: 1,
    revision: 7,
    state: 'OPEN',
    checkoutOrder: null,
} as StorefrontCart;
const order = { id: 'rebuilt-order' } as Order;
const session = { cart: { ...cart, checkoutOrder: order }, order };

function dependencies() {
    return {
        api: { beginCheckout: vi.fn().mockResolvedValue(session) },
        controller: { execute: vi.fn().mockResolvedValue({ session }) },
    };
}

describe('checkout authentication continuation', () => {
    it('keeps ordinary login on the account page without starting checkout', async () => {
        const { api, controller } = dependencies();
        const resumed = await resumeAuthenticatedCheckout(api, controller, cart, { name: 'login' });
        expect(resumed.route).toEqual({ name: 'account' });
        expect(api.beginCheckout).not.toHaveBeenCalled();
        expect(controller.execute).not.toHaveBeenCalled();
    });

    it.each(['purchase', 'checkout', 'payment'] as const)(
        'rebuilds the merged cart before returning to %s',
        async returnTo => {
            const { api, controller } = dependencies();
            const resumed = await resumeAuthenticatedCheckout(api, controller, cart, {
                name: 'login',
                returnTo,
            });
            expect(api.beginCheckout).toHaveBeenCalledWith(7);
            expect(resumed).toEqual({
                ...session,
                route: { name: returnTo === 'payment' ? 'checkout' : returnTo },
            });
        },
    );

    it('resumes exactly the variant selected by Buy now after login', async () => {
        const { api, controller } = dependencies();
        const resumed = await resumeAuthenticatedCheckout(api, controller, cart, {
            name: 'login',
            returnTo: 'purchase',
            id: 'chosen-variant',
        });
        expect(controller.execute).toHaveBeenCalledWith({
            buyNow: { productVariantId: 'chosen-variant', quantity: 1 },
        });
        expect(api.beginCheckout).not.toHaveBeenCalled();
        expect(resumed.route).toEqual({ name: 'purchase' });
    });

    it('returns an empty selection to the cart without creating an order', async () => {
        const { api, controller } = dependencies();
        const resumed = await resumeAuthenticatedCheckout(
            api,
            controller,
            { ...cart, selectedQuantity: 0 },
            { name: 'login', returnTo: 'checkout' },
        );
        expect(resumed.route).toEqual({ name: 'cart' });
        expect(api.beginCheckout).not.toHaveBeenCalled();
    });

    it('keeps a pending payment intact without another buy or checkout command', async () => {
        const { api, controller } = dependencies();
        const resumed = await resumeAuthenticatedCheckout(
            api,
            controller,
            { ...session.cart, state: 'PAYMENT_PENDING' },
            { name: 'login', returnTo: 'purchase', id: 'chosen-variant' },
        );
        expect(resumed.route).toEqual({ name: 'payment' });
        expect(api.beginCheckout).not.toHaveBeenCalled();
        expect(controller.execute).not.toHaveBeenCalled();
    });

    it('does not return to purchase if the checkout command did not create a session', async () => {
        const { api, controller } = dependencies();
        controller.execute.mockResolvedValue({ session: null });
        await expect(
            resumeAuthenticatedCheckout(api, controller, cart, {
                name: 'login',
                returnTo: 'purchase',
                id: 'chosen-variant',
            }),
        ).rejects.toThrow('Checkout session is missing');
    });
});

describe('checkout route authentication gate', () => {
    function render(name: RouteName, overrides: Partial<StorefrontContextValue> = {}) {
        navigate.mockClear();
        const runtime = {
            customer: null,
            customerLoadState: 'ready',
            cartLoadState: 'ready',
            publicLoadState: 'ready',
            language: 'zh',
            goBack: vi.fn(),
            customerQuery: { refetch: vi.fn() },
            cartQuery: { refetch: vi.fn() },
            ...overrides,
        } as unknown as StorefrontContextValue;
        return renderToStaticMarkup(
            <StorefrontContext.Provider value={runtime}>
                <RouteGate name={name}>
                    <p>protected content</p>
                </RouteGate>
            </StorefrontContext.Provider>,
        );
    }

    it.each(['purchase', 'checkout', 'payment'] as const)(
        'redirects anonymous %s access before mounting the page',
        name => {
            expect(render(name)).not.toContain('protected content');
            expect(navigate).toHaveBeenCalledWith({
                to: '/login',
                search: { returnTo: name },
                replace: true,
            });
        },
    );

    it('waits for customer resolution and never treats a network error as a guest', () => {
        for (const customerLoadState of ['loading', 'error'] as const) {
            expect(render('checkout', { customerLoadState })).not.toContain('protected content');
            expect(navigate).not.toHaveBeenCalled();
        }
    });

    it('allows a confirmed customer and leaves the guest cart accessible', () => {
        expect(render('checkout', { customer: { id: 'customer-1' } as ActiveCustomer })).toContain(
            'protected content',
        );
        expect(navigate).not.toHaveBeenCalled();
        expect(render('cart')).toContain('protected content');
        expect(navigate).not.toHaveBeenCalled();
    });
});

describe('guest Buy now and auth-page navigation', () => {
    it('keeps the purchase destination when opening registration or password recovery', () => {
        const container = document.createElement('div');
        const root = createRoot(container);
        navigate.mockClear();
        try {
            act(() =>
                root.render(
                    <LoginPage
                        api={{} as ShopApi}
                        language="zh"
                        storefrontName="Test store"
                        onBack={vi.fn()}
                        onSuccess={vi.fn()}
                        onContentTarget={vi.fn()}
                        returnTo="purchase"
                        returnVariantId="selected-variant"
                    />,
                ),
            );
            const buttons = [...container.querySelectorAll('button')];
            act(() => buttons.find(button => button.textContent?.includes('忘记密码'))?.click());
            expect(navigate).toHaveBeenCalledWith({
                to: '/forgot-password',
                search: { returnTo: 'purchase', id: 'selected-variant' },
            });
            act(() => buttons.find(button => button.textContent === '注册')?.click());
            expect(navigate).toHaveBeenCalledWith({
                to: '/register',
                search: { returnTo: 'purchase', id: 'selected-variant' },
            });
        } finally {
            act(() => root.unmount());
        }
    });
});
