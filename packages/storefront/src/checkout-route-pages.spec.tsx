import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { PaymentRoutePage } from './route-pages/checkout-route-pages';

type Order = import('./types').Order;
type StorefrontCart = import('./types').StorefrontCart;

const testState = vi.hoisted(() => ({
    paymentProps: null as null | {
        onComplete: (order: Order, confirmationToken: string) => Promise<void>;
    },
    runtime: null as Record<string, unknown> | null,
}));

vi.mock('./lazy-storefront-pages', () => ({
    LazyCheckoutPage: () => null,
    LazyOrderConfirmationPage: () => null,
    LazyPaymentPage: (props: typeof testState.paymentProps) => {
        testState.paymentProps = props;
        return null;
    },
}));
vi.mock('./storefront-ui/page-shell', () => ({
    AuthPageBoundary: ({ children }: { children: unknown }) => children,
}));
vi.mock('./route-pages/shared', () => ({
    registerRoutePreload: () => vi.fn(),
    RouteGate: ({ children }: { children: unknown }) => children,
    useRouteRuntime: () => testState.runtime,
}));

describe('checkout route handoff', () => {
    it('shows confirmation before refreshing customer and cart data in the background', async () => {
        const order = { id: 'order-1', code: 'T0001', state: 'PaymentSettled' } as Order;
        const refreshedCart = { id: 'cart-2' } as StorefrontCart;
        const navigate = vi.fn();
        const invalidateCustomerRouteQueries = vi.fn().mockResolvedValue(undefined);
        const cart = vi.fn().mockResolvedValue(refreshedCart);
        const setCart = vi.fn();
        testState.runtime = {
            language: 'zh',
            goBack: vi.fn(),
            api: { cart },
            cart: { id: 'cart-1' },
            currentCheckoutOrder: order,
            customer: { id: 'customer-1' },
            market: { code: 'fixture' },
            displayCurrencyCode: 'MYR',
            locale: 'zh-CN',
            setCompletedOrder: vi.fn(),
            setCheckoutOrder: vi.fn(),
            notify: vi.fn(),
            navigate,
            invalidateCustomerRouteQueries,
            setCart,
        };

        renderToStaticMarkup(<PaymentRoutePage />);
        await testState.paymentProps?.onComplete(order, 'confirmation-token');

        expect(navigate).toHaveBeenCalledWith(
            { name: 'order-confirmation', id: 'T0001', token: 'confirmation-token' },
            true,
        );
        expect(navigate.mock.invocationCallOrder[0]).toBeLessThan(
            invalidateCustomerRouteQueries.mock.invocationCallOrder[0],
        );
        expect(navigate.mock.invocationCallOrder[0]).toBeLessThan(cart.mock.invocationCallOrder[0]);
        await Promise.resolve();
        expect(setCart).toHaveBeenCalledWith(refreshedCart);
    });
});
