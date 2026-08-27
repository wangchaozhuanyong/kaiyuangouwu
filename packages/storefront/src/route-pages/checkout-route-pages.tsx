import { LazyCheckoutPage, LazyOrderConfirmationPage, LazyPaymentPage } from '../lazy-storefront-pages';
import { AuthPageBoundary } from '../storefront-ui/page-shell';
import { Order, StorefrontCart, StorefrontCheckoutSession } from '../types';

import { RouteGate, useRouteRuntime as useRuntime } from './shared';

function CheckoutRoutePage({ mode }: { mode?: 'purchase' }) {
    const runtime = useRuntime();
    const name = mode === 'purchase' ? 'purchase' : 'checkout';
    return (
        <RouteGate name={name}>
            <AuthPageBoundary language={runtime.language} onBack={runtime.goBack}>
                <LazyCheckoutPage
                    mode={mode}
                    api={runtime.api}
                    cart={runtime.cart}
                    order={runtime.currentCheckoutOrder}
                    customer={runtime.customer}
                    market={runtime.market}
                    availableCountries={runtime.availableCountries}
                    locale={runtime.locale}
                    language={runtime.language}
                    onBack={runtime.goBack}
                    onSessionChange={(session: StorefrontCheckoutSession) => {
                        runtime.setCart(session.cart);
                        runtime.setCheckoutOrder(session.order);
                    }}
                    onCartChange={(cart: StorefrontCart) => {
                        runtime.setCart(cart);
                        runtime.setCheckoutOrder(cart.checkoutOrder);
                    }}
                    onNotify={runtime.notify}
                    coupons={runtime.myCoupons}
                    onApplyCoupon={runtime.applyCoupon}
                    onRemoveCoupon={runtime.removeCoupon}
                />
            </AuthPageBoundary>
        </RouteGate>
    );
}

export function PurchaseRoutePage() {
    return <CheckoutRoutePage mode="purchase" />;
}

export function CheckoutPageRoute() {
    return <CheckoutRoutePage />;
}

export function PaymentRoutePage() {
    const runtime = useRuntime();
    const isZh = runtime.language === 'zh';
    return (
        <RouteGate name="payment">
            <AuthPageBoundary language={runtime.language} onBack={runtime.goBack}>
                <LazyPaymentPage
                    api={runtime.api}
                    cart={runtime.cart}
                    order={runtime.currentCheckoutOrder}
                    customer={runtime.customer}
                    market={runtime.market}
                    displayCurrencyCode={runtime.displayCurrencyCode}
                    locale={runtime.locale}
                    language={runtime.language}
                    onCancel={(order: Order) => void runtime.reopenPendingOrder(order)}
                    onOrderChange={(order: Order) => runtime.setCheckoutOrder(order)}
                    onComplete={async (order: Order, confirmationToken: string) => {
                        runtime.setCompletedOrder(order);
                        runtime.setCheckoutOrder(order);
                        await runtime.invalidateCustomerRouteQueries();
                        runtime.notify(isZh ? '支付状态已更新' : 'Payment status updated');
                        try {
                            runtime.setCart(await runtime.api.cart());
                        } catch {
                            // The cart query will recover independently after a successful payment.
                        }
                        runtime.navigate(
                            { name: 'order-confirmation', id: order.code, token: confirmationToken },
                            true,
                        );
                    }}
                />
            </AuthPageBoundary>
        </RouteGate>
    );
}

export function OrderConfirmationRoutePage() {
    const runtime = useRuntime();
    return (
        <RouteGate name="order-confirmation">
            <AuthPageBoundary language={runtime.language} onBack={runtime.goBack}>
                <LazyOrderConfirmationPage
                    api={runtime.api}
                    code={runtime.route.id ?? ''}
                    confirmationToken={runtime.route.token ?? ''}
                    initialOrder={runtime.completedOrder}
                    customer={runtime.customer}
                    market={runtime.market}
                    locale={runtime.locale}
                    language={runtime.language}
                />
            </AuthPageBoundary>
        </RouteGate>
    );
}
