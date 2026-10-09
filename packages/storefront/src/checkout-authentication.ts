import type { ShopApi } from './api';
import type { CartController } from './cart/cart-controller';
import type { RouteState } from './storefront-router';
import type { ActiveCustomer, Order, StorefrontCart } from './types';

import { isPublicStorefrontRoute } from './storefront-access';

interface AuthenticationCompletionContext {
    api: Pick<ShopApi, 'activeCustomer' | 'cart' | 'beginCheckout'>;
    cartController: Pick<CartController, 'reset' | 'execute'>;
    clearPrivateQueryCache(this: void): void;
    setCustomer(this: void, customer: ActiveCustomer): void;
    setCart(this: void, cart: StorefrontCart): void;
    setCartError(this: void, error: string | null): void;
    setCheckoutOrder(this: void, order: Order | null): void;
    notify(this: void, message: string): void;
    navigate(this: void, route: RouteState, replace: boolean): void;
    isZh: boolean;
}

/** Authentication completion is loaded on demand, sharing the existing checkout continuation. */
export async function completeStorefrontAuthentication(
    context: AuthenticationCompletionContext,
    intent: RouteState,
    destination?: RouteState,
    isCurrent: () => boolean = () => true,
) {
    if (!isCurrent()) return;
    const {
        api,
        cartController,
        clearPrivateQueryCache,
        setCustomer,
        setCart,
        setCartError,
        setCheckoutOrder,
        notify,
        navigate,
        isZh,
    } = context;
    cartController.reset();
    clearPrivateQueryCache();
    const [nextCustomer, nextCart] = await Promise.all([api.activeCustomer(), api.cart()]);
    if (!isCurrent()) return;
    if (!nextCustomer) {
        throw new Error(isZh ? '登录状态尚未确认，请重新登录' : 'Sign-in could not be confirmed. Try again.');
    }
    setCustomer(nextCustomer);
    setCart(nextCart);
    setCartError(null);
    setCheckoutOrder(nextCart.checkoutOrder);
    try {
        const resumed = await resumeAuthenticatedCheckout(api, cartController, nextCart, intent);
        if (!isCurrent()) return;
        setCart(resumed.cart);
        setCheckoutOrder(resumed.order);
        notify(isZh ? '登录成功' : 'Signed in');
        navigate(
            destination ??
                (!isPublicStorefrontRoute(intent.name) && !intent.returnTo ? intent : resumed.route),
            true,
        );
    } catch {
        if (!isCurrent()) return;
        const message = isZh
            ? '已登录，请在购物车确认商品后重新结算'
            : 'Signed in. Review your cart and try checkout again.';
        setCartError(message);
        notify(message);
        navigate({ name: 'cart' }, true);
    }
}

export async function resumeAuthenticatedCheckout(
    api: Pick<ShopApi, 'beginCheckout'>,
    controller: Pick<CartController, 'execute'>,
    cart: StorefrontCart,
    loginRoute: RouteState,
): Promise<{ cart: StorefrontCart; order: Order | null; route: RouteState }> {
    const returnTo = loginRoute.returnTo;
    if (!returnTo) return { cart, order: cart.checkoutOrder, route: { name: 'account' } };
    if (cart.state === 'PAYMENT_PENDING') {
        return { cart, order: cart.checkoutOrder, route: { name: 'payment' } };
    }
    if (returnTo === 'purchase' && loginRoute.id) {
        const { session: purchaseSession } = await controller.execute({
            buyNow: { productVariantId: loginRoute.id, quantity: loginRoute.quantity ?? 1 },
        });
        if (!purchaseSession) throw new Error('Checkout session is missing.');
        return { ...purchaseSession, route: { name: 'purchase' } };
    }
    if (!cart.selectedQuantity) return { cart, order: cart.checkoutOrder, route: { name: 'cart' } };
    // Login invalidates the guest order projection. Rebuild it using the authenticated cart revision.
    const session = await api.beginCheckout(cart.revision);
    return { ...session, route: { name: returnTo === 'payment' ? 'checkout' : returnTo } };
}
