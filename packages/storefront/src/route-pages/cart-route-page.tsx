import { lazyRouteComponent } from '@tanstack/react-router';

import { ProductVariant } from '../types';

import {
    RoutePageContext as PageContext,
    registerRoutePreload,
    RouteGate,
    useRouteRuntime as useRuntime,
} from './shared';

const CartPage = lazyRouteComponent(() => import('../pages/cart-page'), 'CartPage');

export function CartRoutePage() {
    const runtime = useRuntime();
    return (
        <RouteGate name="cart">
            <PageContext
                value={{
                    isActive: true,
                    cart: runtime.cart,
                    customer: runtime.customer,
                    products: runtime.products,
                    market: runtime.market,
                    locale: runtime.locale,
                    language: runtime.language,
                    loading: runtime.cartLoading,
                    selectionPending: runtime.cartPending,
                    editingBlocked: runtime.cartEditingBlocked,
                    commandUnknown: runtime.cartCommandUnknown,
                    onCancelPending: runtime.cancelPendingCartCommand,
                    error: runtime.cartError,
                    addingVariantId: runtime.addingVariantId,
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
                    onFavorite: runtime.toggleFavoriteProduct,
                    onCheckout: () => void runtime.beginCheckout(),
                    onReopen: () =>
                        runtime.cart?.checkoutOrder &&
                        void runtime.reopenPendingOrder(runtime.cart.checkoutOrder),
                    onAdd: (variant: ProductVariant) => void runtime.addToCart(variant),
                    onNotify: runtime.notify,
                    onRetry: () => void runtime.refreshCart(),
                    onApplyCoupon: runtime.applyCoupon,
                    onRemoveCoupon: runtime.removeCoupon,
                }}
            >
                <CartPage />
            </PageContext>
        </RouteGate>
    );
}

export const preloadCartRoutePage = registerRoutePreload(CartRoutePage, CartPage);
