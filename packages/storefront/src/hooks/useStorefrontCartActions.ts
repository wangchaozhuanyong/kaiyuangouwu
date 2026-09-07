import { useCallback } from 'react';
import type { CartController } from '../cart/cart-controller';
import type { Order, OrderSummary, ProductVariant, StorefrontCart } from '../types';
import type { useStorefrontNavigation } from './useStorefrontNavigation';

import { ShopApi, ShopApiError } from '../api';

interface StorefrontCartActionOptions {
    api: ShopApi;
    cart: StorefrontCart | null;
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
                } else if (
                    requestError instanceof ShopApiError &&
                    (requestError.errorCode === 'CART_PROJECTION_ERROR' ||
                        requestError.message.includes('synchronized to checkout'))
                ) {
                    const message = isZh ? '商品库存不足或已售罄' : 'The item is out of stock';
                    setCartError(message);
                    notify(message);
                } else {
                    setCartError(requestError instanceof Error ? requestError.message : text.loadError);
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
            setAddingVariantId(variant.id);
            const updated = await mutateCart(revision => api.addItem(variant.id, revision));
            setAddingVariantId(null);
            if (updated) {
                notify(isZh ? '已加入购物车' : 'Added to cart');
            }
            return updated;
        },
        [api, isZh, mutateCart, notify],
    );

    const startDirectPurchase = useCallback(
        async (variant: ProductVariant) => {
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
                } else if (
                    requestError instanceof ShopApiError &&
                    (requestError.errorCode === 'CART_PROJECTION_ERROR' ||
                        requestError.message.includes('synchronized to checkout'))
                ) {
                    setCartError(isZh ? '所选商品库存不足或已售罄' : 'The selected item is out of stock');
                } else {
                    setCartError(requestError instanceof Error ? requestError.message : text.loadError);
                }
                const errorMessage =
                    requestError instanceof ShopApiError &&
                    (requestError.errorCode === 'CART_PROJECTION_ERROR' ||
                        requestError.message.includes('synchronized to checkout'))
                        ? isZh
                            ? '所选商品库存不足或已售罄'
                            : 'The selected item is out of stock'
                        : requestError instanceof Error
                          ? requestError.message
                          : isZh
                            ? '暂时无法发起购买'
                            : 'Could not start the purchase';
                notify(errorMessage);
            } finally {
                setAddingVariantId(null);
                setCartLoading(false);
            }
        },
        [api, cart, isZh, navigate, notify, refreshCart, setCart, text.loadError],
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
                setCartError(requestError instanceof Error ? requestError.message : text.loadError);
                navigate({ name: 'cart' });
            } finally {
                setCartLoading(false);
            }
        },
        [api, cart, isZh, navigate, notify, text.loadError],
    );

    return { refreshCart, mutateCart, addToCart, startDirectPurchase, addOrderToCart };
}
