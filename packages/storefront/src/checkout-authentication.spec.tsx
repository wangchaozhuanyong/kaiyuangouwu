// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ShopApi } from './api';
import { LoginPage, RegisterPage } from './auth-pages';
import { completeStorefrontAuthentication, resumeAuthenticatedCheckout } from './checkout-authentication';
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

function completionDependencies() {
    const customer = { id: 'customer-1' } as ActiveCustomer;
    return {
        customer,
        api: {
            activeCustomer: vi.fn<() => Promise<ActiveCustomer | null>>().mockResolvedValue(customer),
            cart: vi.fn<() => Promise<StorefrontCart>>().mockResolvedValue(cart),
            beginCheckout: vi.fn().mockResolvedValue(session),
        },
        cartController: {
            reset: vi.fn(),
            execute: vi.fn().mockResolvedValue({ session }),
        },
        clearPrivateQueryCache: vi.fn(),
        setCustomer: vi.fn(),
        setCart: vi.fn(),
        setCartError: vi.fn(),
        setCheckoutOrder: vi.fn(),
        notify: vi.fn(),
        navigate: vi.fn(),
        isZh: true,
    };
}

function pending<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((finish, fail) => {
        resolve = finish;
        reject = fail;
    });
    return { promise, resolve, reject };
}

describe('on-demand authentication completion', () => {
    it('returns an ordinary overlay login to its browsing page without starting checkout', async () => {
        const context = completionDependencies();
        const background = { name: 'category', collectionId: 'chosen', minPrice: '10' } as const;
        await completeStorefrontAuthentication(context, { name: 'login' }, background);
        expect(context.cartController.reset).toHaveBeenCalledOnce();
        expect(context.clearPrivateQueryCache).toHaveBeenCalledOnce();
        expect(context.setCustomer).toHaveBeenCalledWith(context.customer);
        expect(context.setCart).toHaveBeenCalledWith(cart);
        expect(context.setCartError).toHaveBeenCalledWith(null);
        expect(context.api.beginCheckout).not.toHaveBeenCalled();
        expect(context.cartController.execute).not.toHaveBeenCalled();
        expect(context.navigate).toHaveBeenCalledExactlyOnceWith(background, true);
    });

    it('returns a private destination with its query details and no checkout command', async () => {
        const context = completionDependencies();
        const target = { name: 'orders', tab: 'pending' } as const;
        await completeStorefrontAuthentication(context, target);
        expect(context.navigate).toHaveBeenCalledExactlyOnceWith(target, true);
        expect(context.api.beginCheckout).not.toHaveBeenCalled();
        expect(context.cartController.execute).not.toHaveBeenCalled();
    });

    it('keeps standalone login returning to the account page', async () => {
        const context = completionDependencies();
        await completeStorefrontAuthentication(context, { name: 'login' });
        expect(context.navigate).toHaveBeenCalledExactlyOnceWith({ name: 'account' }, true);
    });

    it('continues the existing Buy now flow using the selected variant and quantity', async () => {
        const context = completionDependencies();
        await completeStorefrontAuthentication(context, {
            name: 'login',
            returnTo: 'purchase',
            id: 'chosen-variant',
            quantity: 3,
        });
        expect(context.cartController.execute).toHaveBeenCalledExactlyOnceWith({
            buyNow: { productVariantId: 'chosen-variant', quantity: 3 },
        });
        expect(context.api.beginCheckout).not.toHaveBeenCalled();
        expect(context.setCart).toHaveBeenLastCalledWith(session.cart);
        expect(context.setCheckoutOrder).toHaveBeenLastCalledWith(order);
        expect(context.navigate).toHaveBeenCalledExactlyOnceWith({ name: 'purchase' }, true);
    });

    it.each([true, false])(
        'rejects an unconfirmed customer before updating state (Chinese: %s)',
        async isZh => {
            const context = { ...completionDependencies(), isZh };
            context.api.activeCustomer.mockResolvedValue(null);
            await expect(completeStorefrontAuthentication(context, { name: 'login' })).rejects.toThrow(
                isZh ? '登录状态尚未确认，请重新登录' : 'Sign-in could not be confirmed. Try again.',
            );
            expect(context.setCustomer).not.toHaveBeenCalled();
            expect(context.setCart).not.toHaveBeenCalled();
            expect(context.setCheckoutOrder).not.toHaveBeenCalled();
            expect(context.notify).not.toHaveBeenCalled();
            expect(context.navigate).not.toHaveBeenCalled();
        },
    );

    it('does nothing if its owner is already invalid when the lazy module begins', async () => {
        const context = completionDependencies();
        await completeStorefrontAuthentication(context, { name: 'login' }, undefined, () => false);
        expect(context.cartController.reset).not.toHaveBeenCalled();
        expect(context.clearPrivateQueryCache).not.toHaveBeenCalled();
        expect(context.api.activeCustomer).not.toHaveBeenCalled();
        expect(context.api.cart).not.toHaveBeenCalled();
        expect(context.setCustomer).not.toHaveBeenCalled();
        expect(context.navigate).not.toHaveBeenCalled();
    });

    it('ignores customer and cart responses that arrive after the authentication owner is invalidated', async () => {
        const context = completionDependencies();
        const customerResponse = pending<ActiveCustomer>();
        context.api.activeCustomer.mockReturnValue(customerResponse.promise);
        let current = true;
        const completion = completeStorefrontAuthentication(
            context,
            { name: 'login', returnTo: 'checkout' },
            undefined,
            () => current,
        );
        current = false;
        customerResponse.resolve(context.customer);
        await completion;
        expect(context.setCustomer).not.toHaveBeenCalled();
        expect(context.setCart).not.toHaveBeenCalled();
        expect(context.setCartError).not.toHaveBeenCalled();
        expect(context.setCheckoutOrder).not.toHaveBeenCalled();
        expect(context.api.beginCheckout).not.toHaveBeenCalled();
        expect(context.notify).not.toHaveBeenCalled();
        expect(context.navigate).not.toHaveBeenCalled();
    });

    it.each(['resolve', 'reject'] as const)(
        'does not update or redirect after an invalid owner receives a checkout %s',
        async outcome => {
            const context = completionDependencies();
            const checkoutResponse = pending<typeof session>();
            context.api.beginCheckout.mockReturnValue(checkoutResponse.promise);
            let current = true;
            const completion = completeStorefrontAuthentication(
                context,
                { name: 'login', returnTo: 'checkout' },
                undefined,
                () => current,
            );
            await vi.waitFor(() => expect(context.api.beginCheckout).toHaveBeenCalledWith(cart.revision));
            const cartUpdates = context.setCart.mock.calls.length;
            const orderUpdates = context.setCheckoutOrder.mock.calls.length;
            current = false;
            if (outcome === 'resolve') checkoutResponse.resolve(session);
            else checkoutResponse.reject(new Error('Checkout continuation failed'));
            await completion;
            expect(context.setCart).toHaveBeenCalledTimes(cartUpdates);
            expect(context.setCheckoutOrder).toHaveBeenCalledTimes(orderUpdates);
            expect(context.setCartError).toHaveBeenCalledExactlyOnceWith(null);
            expect(context.notify).not.toHaveBeenCalled();
            expect(context.navigate).not.toHaveBeenCalled();
        },
    );

    it('keeps a confirmed session and returns checkout continuation failures to the cart', async () => {
        const context = completionDependencies();
        context.api.beginCheckout.mockRejectedValue(new Error('Checkout continuation failed'));
        await completeStorefrontAuthentication(context, { name: 'login', returnTo: 'checkout' });
        const message = '已登录，请在购物车确认商品后重新结算';
        expect(context.setCustomer).toHaveBeenCalledWith(context.customer);
        expect(context.setCartError).toHaveBeenLastCalledWith(message);
        expect(context.notify).toHaveBeenCalledExactlyOnceWith(message);
        expect(context.navigate).toHaveBeenCalledExactlyOnceWith({ name: 'cart' }, true);
    });
});

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
            quantity: 3,
        });
        expect(controller.execute).toHaveBeenCalledWith({
            buyNow: { productVariantId: 'chosen-variant', quantity: 3 },
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
                        returnQuantity={3}
                    />,
                ),
            );
            const buttons = [...container.querySelectorAll('button')];
            act(() => buttons.find(button => button.textContent?.includes('忘记密码'))?.click());
            expect(navigate).toHaveBeenCalledWith({
                to: '/forgot-password',
                search: { returnTo: 'purchase', id: 'selected-variant', quantity: 3 },
            });
            act(() => container.querySelector<HTMLButtonElement>('.auth-switch button')?.click());
            expect(navigate).toHaveBeenCalledWith({
                to: '/register',
                search: { returnTo: 'purchase', id: 'selected-variant', quantity: 3 },
                replace: true,
            });
        } finally {
            act(() => root.unmount());
        }
    });

    it('replaces both directions of the login and registration tab switch', () => {
        const loginContainer = document.createElement('div');
        const loginRoot = createRoot(loginContainer);
        navigate.mockClear();
        try {
            act(() =>
                loginRoot.render(
                    <LoginPage
                        api={{} as ShopApi}
                        language="zh"
                        storefrontName="Test store"
                        onBack={vi.fn()}
                        onSuccess={vi.fn()}
                        onContentTarget={vi.fn()}
                    />,
                ),
            );
            act(() => loginContainer.querySelector<HTMLButtonElement>('.auth-switch button')?.click());
            expect(navigate).toHaveBeenLastCalledWith({ to: '/register', search: {}, replace: true });
        } finally {
            act(() => loginRoot.unmount());
        }

        const registerContainer = document.createElement('div');
        const registerRoot = createRoot(registerContainer);
        navigate.mockClear();
        try {
            act(() =>
                registerRoot.render(
                    <RegisterPage
                        api={
                            {
                                referralProgram: vi.fn().mockResolvedValue({ enabled: false }),
                            } as unknown as ShopApi
                        }
                        language="zh"
                        storefrontName="Test store"
                        onBack={vi.fn()}
                        onContentTarget={vi.fn()}
                    />,
                ),
            );
            act(() => registerContainer.querySelector<HTMLButtonElement>('.auth-switch button')?.click());
            expect(navigate).toHaveBeenLastCalledWith({ to: '/login', search: {}, replace: true });
        } finally {
            act(() => registerRoot.unmount());
        }
    });
});
