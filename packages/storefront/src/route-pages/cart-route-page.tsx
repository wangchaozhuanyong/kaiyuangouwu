import { lazyRouteComponent } from '@tanstack/react-router';

import { CartPageContext } from '../storefront-page-contexts';

import '../commerce-styles';
import { registerRoutePreload, RouteGate, useRouteRuntime as useRuntime } from './shared';

const CartPage = lazyRouteComponent(() => import('../pages/cart-page'), 'CartPage');

export function CartRoutePage() {
    const runtime = useRuntime();
    return (
        <RouteGate name="cart">
            <CartPageContext.Provider
                value={{
                    isActive: true,
                    cart: runtime.cart,
                    confirmedCart: runtime.cartConfirmed,
                    customer: runtime.customer,
                    products: runtime.products,
                    market: runtime.market,
                    locale: runtime.locale,
                    language: runtime.language,
                    loading: runtime.cartLoading,
                    selectionPending: runtime.cartTotalsPending,
                    checkoutPending: runtime.checkoutStarting,
                    recoveryPending: runtime.cartRecoveryPending,
                    editingBlocked: runtime.cartEditingBlocked || runtime.cartRecoveryPending,
                    commandUnknown: runtime.cartCommandUnknown,
                    commandAcknowledged: runtime.cartCommandAcknowledged,
                    onCancelPending: () => void runtime.cancelPendingCartCommand().catch(() => undefined),
                    error: runtime.cartError,
                    favoriteProductIds: runtime.favoriteProductIds,
                    coupons: runtime.myCoupons,
                    onToggleAll: runtime.toggleAllCartLines,
                    onSelect: (lineId: string, selected: boolean) =>
                        runtime.selectCartLines([lineId], selected),
                    onSelectGroup: runtime.selectCartLines,
                    onQuantity: (lineId: string, quantity: number) =>
                        void runtime.mutateCart((revision: number) =>
                            runtime.api.setLineQuantity(lineId, quantity, revision),
                        ),
                    onRemove: (lineId: string) =>
                        void runtime.mutateCart((revision: number) =>
                            runtime.api.removeLines([lineId], revision),
                        ),
                    onFavorite: productId =>
                        void runtime.toggleFavoriteProduct(productId).catch(() => undefined),
                    onCheckout: () => void runtime.beginCheckout(),
                    onReopen: () =>
                        runtime.cart?.checkoutOrder &&
                        void runtime.reopenPendingOrder(runtime.cart.checkoutOrder),
                    onNotify: runtime.notify,
                    onRetry: () => void runtime.refreshCart().catch(() => undefined),
                    onApplyCoupon: runtime.applyCoupon,
                    onRemoveCoupon: runtime.removeCoupon,
                }}
            >
                <CartPage />
            </CartPageContext.Provider>
        </RouteGate>
    );
}

export const preloadCartRoutePage = registerRoutePreload(CartRoutePage, CartPage);
