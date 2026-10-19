import type { ShopApi } from './api';
import type { CartController } from './cart/cart-controller';
import type { RouteState } from './storefront-router';
import type { ActiveCustomer, Order, StorefrontCart } from './types';

import {
    checkoutContinuationIsCurrent,
    checkoutContinuationOwnerMatches,
    claimCheckoutContinuation,
    registerCheckoutContinuationOwner,
} from './cart/checkout-continuation';
import { isPublicStorefrontRoute } from './storefront-access';
import { storefrontErrorMessage } from './storefront-errors';

interface AuthenticationCompletionContext {
    api: Pick<ShopApi, 'activeCustomer' | 'cart' | 'beginCheckout'>;
    cartController: Pick<CartController, 'reset' | 'execute' | 'getSnapshot'>;
    purchaseFallbackRoute?: RouteState;
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
    const [customerResult, cartResult] = await Promise.allSettled([api.activeCustomer(), api.cart()]);
    if (!isCurrent()) return;
    if (customerResult.status === 'rejected') throw customerResult.reason;
    const nextCustomer = customerResult.value;
    if (!nextCustomer) {
        throw new Error(isZh ? '登录状态尚未确认，请重新登录' : 'Sign-in could not be confirmed. Try again.');
    }
    setCustomer(nextCustomer);
    if (cartResult.status === 'rejected') {
        const message = isZh
            ? '已登录，购物车暂时无法加载，请稍后重试。'
            : 'Signed in. Your cart could not load. Please try again shortly.';
        setCartError(message);
        setCheckoutOrder(null);
        notify(message);
        navigate(
            destination ??
                (intent.returnTo
                    ? { name: 'cart' }
                    : isPublicStorefrontRoute(intent.name)
                      ? { name: 'account' }
                      : intent),
            true,
        );
        return;
    }
    const nextCart = cartResult.value;
    setCart(nextCart);
    setCartError(null);
    setCheckoutOrder(nextCart.checkoutOrder);
    try {
        const resumed = await resumeAuthenticatedCheckout(api, cartController, nextCart, intent);
        if (!isCurrent()) return;
        if (resumed.route.name === 'purchase' || resumed.route.name === 'checkout') {
            const continuationIntent = resumed.route.name === 'purchase' ? 'buyNow' : 'beginCheckout';
            if (
                !resumed.order ||
                !checkoutContinuationIsCurrent(
                    { ...resumed, order: resumed.order, checkout: null },
                    cartController.getSnapshot().confirmed,
                    nextCustomer.id,
                    continuationIntent,
                )
            )
                throw new Error(
                    isZh ? '结算会话已变更，请重新确认' : 'Checkout changed. Please review again.',
                );
        }
        setCart(resumed.cart);
        setCheckoutOrder(resumed.order);
        notify(isZh ? '登录成功' : 'Signed in');
        const recovery = cartController.getSnapshot().lastRecovery;
        const commandId =
            resumed.commandId ??
            (recovery && recovery.result.session?.order.id === resumed.order?.id
                ? recovery.commandId
                : undefined);
        if (!checkoutContinuationOwnerMatches(cartController, commandId, api)) return;
        registerCheckoutContinuationOwner(cartController, commandId, api);
        if (intent.returnTo && !claimCheckoutContinuation(cartController, commandId)) return;
        navigate(
            destination ??
                (!isPublicStorefrontRoute(intent.name) && !intent.returnTo ? intent : resumed.route),
            true,
        );
    } catch (error) {
        if (!isCurrent()) return;
        const state = cartController.getSnapshot();
        const unknown = state.phase === 'unknown' || state.phase === 'recovering';
        const buying = intent.returnTo === 'purchase' && !!intent.id;
        const message = unknown
            ? isZh
                ? state.commandAcknowledged
                    ? '已登录，购买操作已确认，请继续读取本次购买，勿重复提交。'
                    : '已登录，购买结果待确认，请继续确认本次购买，勿重复提交。'
                : state.commandAcknowledged
                  ? 'Signed in. Your purchase is confirmed. Continue loading it; do not submit again.'
                  : 'Signed in. Your purchase result is unconfirmed. Continue checking it; do not submit again.'
            : storefrontErrorMessage(
                  error,
                  isZh ? 'zh' : 'en',
                  isZh
                      ? '本次购买未能准备，请检查后重试。'
                      : 'Could not prepare this purchase. Review and retry.',
              );
        setCartError(message);
        notify(message);
        const fallback = context.purchaseFallbackRoute;
        navigate(
            buying && fallback?.name === 'product'
                ? { ...fallback, variantId: intent.id, quantity: intent.quantity }
                : (destination ?? { name: 'cart' }),
            true,
        );
    }
}

export async function resumeAuthenticatedCheckout(
    api: Pick<ShopApi, 'beginCheckout'>,
    controller: Pick<CartController, 'execute'>,
    cart: StorefrontCart,
    loginRoute: RouteState,
): Promise<{ cart: StorefrontCart; order: Order | null; route: RouteState; commandId?: string }> {
    const returnTo = loginRoute.returnTo;
    if (!returnTo) return { cart, order: cart.checkoutOrder, route: { name: 'account' } };
    if (cart.state === 'PAYMENT_PENDING') {
        return { cart, order: cart.checkoutOrder, route: { name: 'payment' } };
    }
    if (returnTo === 'purchase' && loginRoute.id) {
        const { session: purchaseSession, commandId } = await controller.execute({
            buyNow: { productVariantId: loginRoute.id, quantity: loginRoute.quantity ?? 1 },
        });
        if (!purchaseSession) throw new Error('Checkout session is missing.');
        return { ...purchaseSession, route: { name: 'purchase' }, commandId };
    }
    if (!cart.selectedQuantity) return { cart, order: cart.checkoutOrder, route: { name: 'cart' } };
    // Login invalidates the guest order projection. Rebuild it using the authenticated cart revision.
    const session = await api.beginCheckout(cart.revision);
    return { ...session, route: { name: returnTo === 'payment' ? 'checkout' : returnTo } };
}
