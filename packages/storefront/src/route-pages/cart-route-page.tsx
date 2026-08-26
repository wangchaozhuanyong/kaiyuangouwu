import { lazy } from 'react';

import { ProductVariant } from '../types';

import { RoutePageContext as PageContext, RouteGate, useRouteRuntime as useRuntime } from './shared';

const CartPage = lazy(() => import('../pages/cart-page').then(module => ({ default: module.CartPage })));

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
                    error: runtime.cartError,
                    addingVariantId: runtime.addingVariantId,
                    favoriteProductIds: runtime.favoriteProductIds,
                    coupons: runtime.myCoupons,
                    onToggleAll: () =>
                        void runtime.mutateCart((revision: number) =>
                            runtime.api.setAllLinesSelected(runtime.cart?.selectionState !== 'ALL', revision),
                        ),
                    onSelect: (lineId: string, selected: boolean) =>
                        void runtime.mutateCart((revision: number) =>
                            runtime.api.setLinesSelected([lineId], selected, revision),
                        ),
                    onSelectGroup: (lineIds: string[], selected: boolean) =>
                        void runtime.mutateCart((revision: number) =>
                            runtime.api.setLinesSelected(lineIds, selected, revision),
                        ),
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
