import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { ShopApi, ShopApiError } from '../api';
import { CartController, type CartState } from '../cart/cart-controller';
import { type CartCheckoutIntent, type CartCommandResult } from '../cart/cart-intents';
import {
    checkoutContinuationIsCurrent,
    checkoutContinuationOwnerMatches,
    claimCheckoutContinuation,
    registerCheckoutContinuationOwner,
} from '../cart/checkout-continuation';
import { quantityStockMessage } from '../product-availability';
import { preloadStorefrontRouteComponent } from '../route-component-preload';
import { storefrontErrorCode, storefrontErrorMessage } from '../storefront-errors';
import {
    ActiveCustomer,
    Order,
    OrderSummary,
    ProductVariant,
    StorefrontCart,
    StorefrontCheckoutSession,
} from '../types';

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
    const cartState = useSyncExternalStore(cartController.subscribe, cartController.getSnapshot);
    const actionOwnerRef = useRef({ api, cartController, customerId: customer?.id });
    const owner = actionOwnerRef.current;
    registerCheckoutContinuationOwner(
        cartController,
        cartState.pendingCommandId ?? cartState.lastRecovery?.commandId,
        owner.cartController === cartController ? owner.api : api,
    );
    if (owner.api !== api || owner.cartController !== cartController || owner.customerId !== customer?.id) {
        actionOwnerRef.current = { api, cartController, customerId: customer?.id };
        recoveryRequestRef.current = null;
    }
    const mountedRef = useRef(false);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);
    const [cartRecoveryPending, setCartRecoveryPending] = useState(false);
    useEffect(() => setCartRecoveryPending(false), [api, cartController, customer?.id]);
    const pendingResultMessage = isZh
        ? '结果待确认，请核对购物车。'
        : 'Result unconfirmed. Review your cart.';
    const acknowledgedResultMessage = isZh
        ? '操作已确认，请重试读取购物车。'
        : 'The operation is confirmed. Retry loading your cart.';
    const continuationMessage = useCallback(
        (acknowledged: boolean) =>
            isZh
                ? acknowledged
                    ? '购买操作已确认，请继续读取本次购买，勿重复提交。'
                    : '购买结果待确认，请继续确认本次购买，勿重复提交。'
                : acknowledged
                  ? 'Your purchase is confirmed. Continue loading it; do not submit again.'
                  : 'Your purchase result is unconfirmed. Continue checking it; do not submit again.',
        [isZh],
    );
    const cartErrorMessage = useCallback(
        (error: unknown, fallback = text.loadError) => {
            const state = cartController.getSnapshot();
            const uncertain = state.phase === 'unknown' || state.phase === 'recovering';
            if (uncertain && state.pendingCheckoutIntent === 'buyNow')
                return continuationMessage(state.commandAcknowledged);
            if (uncertain)
                return state.commandAcknowledged ? acknowledgedResultMessage : pendingResultMessage;
            return state.commandAcknowledged
                ? acknowledgedResultMessage
                : storefrontErrorCode(error) === 'UNKNOWN_RESULT'
                  ? pendingResultMessage
                  : storefrontErrorMessage(error, isZh ? 'zh' : 'en', fallback);
        },
        [
            acknowledgedResultMessage,
            cartController,
            continuationMessage,
            isZh,
            pendingResultMessage,
            text.loadError,
        ],
    );
    const continueCheckoutSession = useCallback(
        (
            session: StorefrontCheckoutSession,
            intent: CartCheckoutIntent,
            replace = true,
            commandId?: string,
        ): boolean => {
            const state = cartController.getSnapshot();
            if (
                state.pending ||
                state.phase === 'unknown' ||
                state.phase === 'recovering' ||
                !checkoutContinuationIsCurrent(session, state.confirmed, customer?.id, intent)
            )
                return false;
            const recovery = state.lastRecovery;
            const recoveredCommand =
                recovery?.status === 'APPLIED' &&
                recovery.checkoutIntent === intent &&
                recovery.result.session?.order.id === session.order.id &&
                recovery.result.cart.id === session.cart.id &&
                recovery.result.cart.revision === session.cart.revision
                    ? recovery.commandId
                    : undefined;
            const continuationCommand = commandId ?? recoveredCommand;
            if (!checkoutContinuationOwnerMatches(cartController, continuationCommand, api)) return false;
            registerCheckoutContinuationOwner(cartController, continuationCommand, api);
            if (!claimCheckoutContinuation(cartController, continuationCommand)) return true;
            setCart(session.cart);
            setCheckoutOrder(session.order);
            setCartError(null);
            const destination =
                intent === 'beginCheckout' ? 'checkout' : intent === 'buyNow' ? 'purchase' : 'payment';
            void preloadStorefrontRouteComponent(destination);
            navigate({ name: destination }, replace);
            return true;
        },
        [api, cartController, customer?.id, navigate, setCart, setCartError, setCheckoutOrder],
    );
    const continueCheckout = useCallback(
        (result: CartCommandResult, intent: CartCheckoutIntent, replace = true): boolean =>
            result.status === 'APPLIED' &&
            !!result.session &&
            result.cart.id === result.session.cart.id &&
            result.cart.revision === result.session.cart.revision &&
            continueCheckoutSession(result.session, intent, replace, result.commandId),
        [continueCheckoutSession],
    );
    const consumeRecovery = useCallback(
        (state: CartState) => {
            const recovery = state.lastRecovery;
            if (
                !recovery ||
                state.pending ||
                state.phase === 'unknown' ||
                state.phase === 'recovering' ||
                recovery.commandId !== recovery.result.commandId ||
                recovery.status !== recovery.result.status ||
                !checkoutContinuationOwnerMatches(cartController, recovery.commandId, api) ||
                recovery.result.cart.id !== state.confirmed?.id ||
                recovery.result.cart.revision !== state.confirmed.revision
            )
                return;
            if (recovery.status !== 'APPLIED') {
                setCartError(
                    storefrontErrorMessage(
                        new ShopApiError(
                            recovery.result.errorCode ?? 'CART_COMMAND_CANCELLED',
                            recovery.result.message ?? '',
                        ),
                        isZh ? 'zh' : 'en',
                    ),
                );
                return;
            }
            if (recovery.checkoutIntent) continueCheckout(recovery.result, recovery.checkoutIntent);
        },
        [api, cartController, continueCheckout, isZh, setCartError],
    );
    useEffect(() => {
        consumeRecovery(cartState);
    }, [cartState, consumeRecovery]);
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
            const beforeRecovery = cartController.getSnapshot();
            const phase = beforeRecovery.phase;
            if (checkoutStartingRef?.current || phase === 'queued' || phase === 'saving') {
                return Promise.reject(
                    new Error(
                        isZh ? '购物车正在更新，请稍后再核对。' : 'Cart is updating. Review it shortly.',
                    ),
                );
            }
            const requestOwner = actionOwnerRef.current;
            const isCurrent = () => mountedRef.current && actionOwnerRef.current === requestOwner;
            const hadPendingCommand = phase === 'unknown' || phase === 'recovering';
            setCartRecoveryPending(true);
            const request = (async () => {
                const recovered = await cartController.recoverPending(cancelPending);
                const state = cartController.getSnapshot();
                const latest = hadPendingCommand
                    ? (state.lastRecovery?.result.cart ?? state.confirmed)
                    : await api.cart();
                if (!isCurrent()) throw new Error('Cart session changed.');
                if (!latest) throw new Error(pendingResultMessage);
                setCart(latest);
                setCheckoutOrder(latest.checkoutOrder);
                const currentPhase = cartController.getSnapshot().phase;
                setCartError(
                    !recovered || currentPhase === 'unknown' || currentPhase === 'recovering'
                        ? cartErrorMessage(state.error)
                        : null,
                );
                if (hadPendingCommand && recovered) consumeRecovery(state);
                return latest;
            })()
                .catch(requestError => {
                    if (!isCurrent()) throw requestError;
                    setCartError(cartErrorMessage(requestError));
                    throw requestError;
                })
                .finally(() => {
                    if (recoveryRequestRef.current === request) recoveryRequestRef.current = null;
                    if (isCurrent()) setCartRecoveryPending(false);
                });
            recoveryRequestRef.current = request;
            return request;
        },
        [
            api,
            cartController,
            cartErrorMessage,
            checkoutStartingRef,
            consumeRecovery,
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
            const requestOwner = actionOwnerRef.current;
            const isCurrent = () => mountedRef.current && actionOwnerRef.current === requestOwner;
            try {
                void preloadStorefrontRouteComponent('purchase');
                const result = await cartController.execute({
                    buyNow: { productVariantId: variant.id, quantity },
                });
                const session = result.session;
                if (!isCurrent()) return;
                if (!session)
                    throw new Error(
                        isZh ? '结算会话已变更，请重新确认' : 'Checkout changed. Please review again.',
                    );
                if (!continueCheckout(result, 'buyNow', false))
                    throw new Error(
                        isZh ? '结算会话已变更，请重新确认' : 'Checkout changed. Please review again.',
                    );
                notify(isZh ? '已准备本次购买' : 'Your purchase is ready to review');
            } catch (requestError) {
                if (!isCurrent()) return;
                if (
                    requestError instanceof ShopApiError &&
                    requestError.errorCode === 'CART_REVISION_CONFLICT_ERROR'
                ) {
                    await refreshCart().catch(() => undefined);
                }
                if (!isCurrent()) return;
                const errorMessage = cartErrorMessage(
                    requestError,
                    isZh ? '暂时无法发起购买' : 'Could not start the purchase',
                );
                setCartError(errorMessage);
                notify(errorMessage);
            } finally {
                if (isCurrent()) {
                    setAddingVariantId(null);
                    setCartLoading(false);
                }
            }
        },
        [
            api,
            cart,
            cartActionsBlocked,
            cartErrorMessage,
            continueCheckout,
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
        formatCartActionError: cartErrorMessage,
        mutateCart,
        addToCart,
        startDirectPurchase,
        continueCheckoutSession,
        addOrderToCart,
    };
}
