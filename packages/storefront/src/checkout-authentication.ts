import type { ShopApi } from './api';
import type { CartController } from './cart/cart-controller';
import type { RouteState } from './storefront-router';
import type { Order, StorefrontCart } from './types';

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
            buyNow: { productVariantId: loginRoute.id, quantity: 1 },
        });
        if (!purchaseSession) throw new Error('Checkout session is missing.');
        return { ...purchaseSession, route: { name: 'purchase' } };
    }
    if (!cart.selectedQuantity) return { cart, order: cart.checkoutOrder, route: { name: 'cart' } };
    // Login invalidates the guest order projection. Rebuild it using the authenticated cart revision.
    const session = await api.beginCheckout(cart.revision);
    return { ...session, route: { name: returnTo === 'payment' ? 'checkout' : returnTo } };
}
