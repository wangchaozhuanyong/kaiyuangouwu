import { useCallback, useRef, useState } from 'react';

import { ShopApi, ShopApiError } from '../api';
import { CartController } from '../cart/cart-controller';
import { quantityStockMessage } from '../product-availability';
import { preloadStorefrontRouteComponent } from '../route-component-preload';
import { storefrontErrorCode, storefrontErrorMessage } from '../storefront-errors';
import { ActiveCustomer, Order, OrderSummary, ProductVariant, StorefrontCart } from '../types';

import { useStorefrontNavigation } from './useStorefrontNavigation';

interface StorefrontCartActionOptions {
    api: ShopApi;
    cart: StorefrontCart | null;
    customer: ActiveCustomer | null;
    cartController: CartController;
    checkoutStartingRef?: { current: boolean };
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
    checkoutStartingRef,
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
    const recoveryRequestRef = useRef<Promise<StorefrontCart> | null>(null);
    const [cartRecoveryPending, setCartRecoveryPending] = useState(false);
    const pendingResultMessage = isZh
        ? '结果待确认，请核对购物车。'
        : 'Result unconfirmed. Review your cart.';
    const cartErrorMessage = useCallback(
        (error: unknown, fallback = text.loadError) =>
            storefrontErrorCode(error) === 'UNKNOWN_RESULT'
                ? pendingResultMessage
                : storefrontErrorMessage(error, isZh ? 'zh' : 'en', fallback),
        [isZh, pendingResultMessage, text.loadError],
    );
    const cartActionsBlocked = useCallback(
        () =>
            !!recoveryRequestRef.current ||
            !!checkoutStartingRef?.current ||
            cartController.getSnapshot().editingBlocked,
        [cartController, checkoutStartingRef],
    );
    const refreshCart = useCallback(
        (cancelPending = false): Promise<StorefrontCart> => {
            if (recoveryRequestRef.current) return recoveryRequestRef.current;
            const phase = cartController.getSnapshot().phase;
            if (checkoutStartingRef?.current || phase === 'queued' || phase === 'saving') {
                return Promise.reject(
                    new Error(
                        isZh ? '购物车正在更新，请稍后再核对。' : 'Cart is updating. Review it shortly.',
                    ),
                );
            }
            setCartRecoveryPending(true);
            const request = (async () => {
                const recovered = await cartController.recoverPending(cancelPending);
                const latest = await api.cart();
                setCart(latest);
                setCheckoutOrder(latest.checkoutOrder);
                const currentPhase = cartController.getSnapshot().phase;
                setCartError(
                    !recovered || currentPhase === 'unknown' || currentPhase === 'recovering'
                        ? pendingResultMessage
                        : null,
                );
                return latest;
            })()
                .catch(requestError => {
                    const failedPhase = cartController.getSnapshot().phase;
                    setCartError(
                        failedPhase === 'unknown' || failedPhase === 'recovering'
                            ? pendingResultMessage
                            : cartErrorMessage(requestError),
                    );
                    throw requestError;
                })
                .finally(() => {
                    recoveryRequestRef.current = null;
                    setCartRecoveryPending(false);
                });
            recoveryRequestRef.current = request;
            return request;
        },
        [
            api,
            cartController,
            cartErrorMessage,
            checkoutStartingRef,
            isZh,
            pendingResultMessage,
            setCart,
            setCartError,
            setCheckoutOrder,
        ],
    );

    const mutateCart = useCallback(
        async (mutation: (revision: number) => Promise<StorefrontCart>) => {
            if (cartActionsBlocked()) return null;
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
                    const message = cartErrorMessage(requestError);
                    setCartError(message);
                    notify(message);
                }
                return null;
            } finally {
                setCartLoading(false);
            }
        },
        [api, cart, cartActionsBlocked, cartErrorMessage, isZh, refreshCart, text.loadError],
    );

    const addToCart = useCallback(
        async (variant: ProductVariant, quantity = 1) => {
            if (cartActionsBlocked()) return null;
            if (!Number.isSafeInteger(quantity) || quantity < 1) return null;
            const current = cartController.getSnapshot().cart ?? cart;
            const existing = current?.lines.find(line => line.productVariant?.id === variant.id);
            const stockError = quantityStockMessage(
                existing?.productVariant ?? variant,
                (existing?.quantity ?? 0) + quantity,
                isZh ? 'zh' : 'en',
            );
            if (stockError) {
                const message = `${variant.name}：${stockError}`;
                setCartError(message);
                notify(message);
                return null;
            }
            setAddingVariantId(variant.id);
            const updated = await mutateCart(revision => api.addItem(variant.id, revision, quantity));
            setAddingVariantId(null);
            if (updated) {
                notify(isZh ? '已加入购物车' : 'Added to cart');
            }
            return updated;
        },
        [api, cart, cartActionsBlocked, cartController, isZh, mutateCart, notify],
    );

    const startDirectPurchase = useCallback(
        async (variant: ProductVariant, quantity = 1) => {
            if (cartActionsBlocked()) return;
            if (!Number.isSafeInteger(quantity) || quantity < 1) return;
            const stockError = quantityStockMessage(variant, quantity, isZh ? 'zh' : 'en');
            if (stockError) {
                const message = `${variant.name}：${stockError}`;
                setCartError(message);
                notify(message);
                return;
            }
            if (!customer) {
                navigate({ name: 'login', returnTo: 'purchase', id: variant.id, quantity });
                return;
            }
            setAddingVariantId(variant.id);
            setCartLoading(true);
            setCartError(null);
            try {
                void preloadStorefrontRouteComponent('purchase');
                const result = await cartController.execute({
                    buyNow: { productVariantId: variant.id, quantity },
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
                }
                const errorMessage = cartErrorMessage(
                    requestError,
                    isZh ? '暂时无法发起购买' : 'Could not start the purchase',
                );
                setCartError(errorMessage);
                notify(errorMessage);
            } finally {
                setAddingVariantId(null);
                setCartLoading(false);
            }
        },
        [
            api,
            cart,
            cartActionsBlocked,
            cartErrorMessage,
            customer,
            isZh,
            navigate,
            notify,
            refreshCart,
            setCart,
            text.loadError,
        ],
    );

    const addOrderToCart = useCallback(
        async (order: OrderSummary) => {
            if (cartActionsBlocked()) return;
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
        [api, cart, cartActionsBlocked, isZh, navigate, notify, text.loadError],
    );

    return {
        refreshCart,
        cancelPendingCartCommand: () => refreshCart(true),
        cartRecoveryPending,
        cartActionsBlocked,
        mutateCart,
        addToCart,
        startDirectPurchase,
        addOrderToCart,
    };
}
