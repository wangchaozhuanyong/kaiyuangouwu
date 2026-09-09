import { useCallback } from 'react';

import { ShopApi, ShopApiError } from '../api';
import { CartController } from '../cart/cart-controller';
import { quantityStockMessage } from '../product-availability';
import { storefrontErrorMessage } from '../storefront-errors';
import { ActiveCustomer, Order, OrderSummary, ProductVariant, StorefrontCart } from '../types';

import { useStorefrontNavigation } from './useStorefrontNavigation';

interface StorefrontCartActionOptions {
    api: ShopApi;
    cart: StorefrontCart | null;
    customer: ActiveCustomer | null;
    cartController: CartController;
    isZh: boolean;
    text: { loadError: string };
    notify: (message: string) => void;
    navigate: ReturnType<typeof useStorefrontNavigation>['navigate'];
    setCart: (cart: StorefrontCart) => void;
    setCheckoutOrder: (order: Order | null) => void;
    setCartLoading: (loading: boolean) => void;
    setCartError: (error: string | null) => void;
    setAddingVariantId: (id: string | null) => void;
}

export function useStorefrontCartActions({
    api,
    cart,
    customer,
    cartController,
    isZh,
    text,
    notify,
    navigate,
    setCart,
    setCheckoutOrder,
    setCartLoading,
    setCartError,
    setAddingVariantId,
}: StorefrontCartActionOptions) {
    const refreshCart = useCallback(async () => {
        await cartController.recoverPending();
        const latest = await api.cart();
        setCart(latest);
        setCheckoutOrder(latest.checkoutOrder);
        setCartError(null);
        return latest;
    }, [api]);

    const mutateCart = useCallback(
        async (mutation: (revision: number) => Promise<StorefrontCart>) => {
            setCartLoading(true);
            setCartError(null);
            try {
                const current = cartController.getSnapshot().cart ?? (await api.cart());
                const updated = await mutation(current.revision);
                setCart(updated);
                setCheckoutOrder(updated.checkoutOrder);
                return updated;
            } catch (requestError) {
                if (
                    requestError instanceof ShopApiError &&
                    requestError.errorCode === 'CART_REVISION_CONFLICT_ERROR'
                ) {
                    await refreshCart().catch(() => undefined);
                    setCartError(
                        isZh ? '购物车已更新，请重新操作' : 'Your cart was updated. Please try again.',
                    );
                } else {
                    const message = storefrontErrorMessage(requestError, isZh ? 'zh' : 'en', text.loadError);
                    setCartError(message);
                    notify(message);
                }
                return null;
            } finally {
                setCartLoading(false);
            }
        },
        [api, cart, isZh, refreshCart, text.loadError],
    );

    const addToCart = useCallback(
        async (variant: ProductVariant) => {
            const current = cartController.getSnapshot().cart ?? cart;
            const existing = current?.lines.find(line => line.productVariant?.id === variant.id);
            const stockError = quantityStockMessage(
                existing?.productVariant ?? variant,
                (existing?.quantity ?? 0) + 1,
                isZh ? 'zh' : 'en',
            );
            if (stockError) {
                const message = `${variant.name}：${stockError}`;
                setCartError(message);
                notify(message);
                return null;
            }
            setAddingVariantId(variant.id);
            const updated = await mutateCart(revision => api.addItem(variant.id, revision));
            setAddingVariantId(null);
            if (updated) {
                notify(isZh ? '已加入购物车' : 'Added to cart');
            }
            return updated;
        },
        [api, cart, cartController, isZh, mutateCart, notify],
    );

    const startDirectPurchase = useCallback(
        async (variant: ProductVariant) => {
            const existing = (cartController.getSnapshot().cart ?? cart)?.lines.find(
                line => line.productVariant?.id === variant.id,
            );
            const stockError = quantityStockMessage(
                existing?.productVariant ?? variant,
                (existing?.quantity ?? 0) + 1,
                isZh ? 'zh' : 'en',
            );
            if (stockError) {
                const message = `${variant.name}：${stockError}`;
                setCartError(message);
                notify(message);
                return;
            }
            if (!customer) {
                navigate({ name: 'login', returnTo: 'purchase', id: variant.id });
                return;
            }
            setAddingVariantId(variant.id);
            setCartLoading(true);
            setCartError(null);
            try {
                const result = await cartController.execute({
                    buyNow: { productVariantId: variant.id, quantity: 1 },
                });
                const session = result.session;
                if (!session)
                    throw new Error(
                        isZh ? '结算会话已变更，请重新确认' : 'Checkout changed. Please review again.',
                    );
                setCart(session.cart);
                setCheckoutOrder(session.order);
                notify(isZh ? '已准备本次购买' : 'Your purchase is ready to review');
                navigate({ name: 'purchase' });
            } catch (requestError) {
                if (
                    requestError instanceof ShopApiError &&
                    requestError.errorCode === 'CART_REVISION_CONFLICT_ERROR'
                ) {
                    await refreshCart().catch(() => undefined);
                    setCartError(
                        isZh
                            ? '购物车已更新，请重新点击立即购买'
                            : 'Your cart was updated. Please try Buy now again.',
                    );
                } else {
                    setCartError(storefrontErrorMessage(requestError, isZh ? 'zh' : 'en', text.loadError));
                }
                const errorMessage = storefrontErrorMessage(
                    requestError,
                    isZh ? 'zh' : 'en',
                    isZh ? '暂时无法发起购买' : 'Could not start the purchase',
                );
                notify(errorMessage);
            } finally {
                setAddingVariantId(null);
                setCartLoading(false);
            }
        },
        [api, cart, customer, isZh, navigate, notify, refreshCart, setCart, text.loadError],
    );

    const addOrderToCart = useCallback(
        async (order: OrderSummary) => {
            setCartLoading(true);
            setCartError(null);
            try {
                const updated = (
                    await cartController.execute({
                        changes: {
                            add: order.lines.map(line => ({
                                productVariantId: line.productVariant.id,
                                quantity: line.quantity,
                            })),
                        },
                    })
                ).cart;
                setCart(updated);
                setCheckoutOrder(updated.checkoutOrder);
                notify(isZh ? '订单商品已加入购物车' : 'Order items added to cart');
                navigate({ name: 'cart' });
            } catch (requestError) {
                setCartError(
                    requestError instanceof Error
                        ? storefrontErrorMessage(requestError, isZh ? 'zh' : 'en')
                        : text.loadError,
                );
                navigate({ name: 'cart' });
            } finally {
                setCartLoading(false);
            }
        },
        [api, cart, isZh, navigate, notify, text.loadError],
    );

    return { refreshCart, mutateCart, addToCart, startDirectPurchase, addOrderToCart };
}
