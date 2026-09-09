import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cartLineCanSelect } from '../product-availability';

import { ShopApiError } from '../api';
import { resumeAuthenticatedCheckout } from '../checkout-authentication';
import { storefrontQueryKeys } from '../query-client';
import { invalidateStorefrontRealtimeQueries } from '../realtime-updates';
import { scopedStorageKey } from '../storefront-storage';
import {
    FAVORITE_PRODUCT_LIMIT,
    FAVORITE_PRODUCT_STORAGE_KEY,
    RECENT_PRODUCT_LIMIT,
    RECENT_PRODUCT_STORAGE_KEY,
    writeStoredCurrency,
    writeStoredSettlementCurrency,
} from '../storefront-utils';
import { ActiveCustomer, CreateAfterSalesRequestInput, Order, StorefrontCart } from '../types';

import { storefrontErrorMessage } from '../storefront-errors';
import { useStorefrontBootstrap } from './useStorefrontBootstrap';
import { useStorefrontCartActions } from './useStorefrontCartActions';
import { useStorefrontCoupons } from './useStorefrontCoupons';
import { useStorefrontCustomerData } from './useStorefrontCustomerData';
import { useStorefrontMetadata } from './useStorefrontDocument';
import { useStorefrontMerchandising } from './useStorefrontMerchandising';
import { useStorefrontNavigation } from './useStorefrontNavigation';
import { useStorefrontRouteData } from './useStorefrontRouteData';
import { useStorefrontTraffic } from './useStorefrontTraffic';

export function useStorefrontAppState() {
    const queryClient = useQueryClient();

    const {
        market,
        language,
        setStorefrontContext,
        displayCurrencyCode,
        setDisplayCurrencyCode,
        storefrontContextResolved,
        favoriteProductIds,
        recentProductIds,
        setFavoriteProductIds,
        setRecentProductIds,
        storefrontCode,
        logoUrl,
        logoOnLightUrl,
        logoOnDarkUrl,
        storefrontDescription,
        storefrontTagline,
        availableCountries,
        availableProvinces,
        availableCurrencyCodes,
        currencySelectorEnabled,
        locale,
        text,
        isZh,
        storefrontName,
        vendureLanguageCode,
        cartController,
        cartState,
        api,
        queryContext,
        legalIdentity,
        refetchStorefront,
        toggleLanguage,
        products,
        collections,
        contentQuery,
        commerceModeQuery,
        contentBlocks,
        navigationBlock,
        activeFlashSales,
        systemAnnouncements,
        managedContentProducts,
        activeFlashSaleItems,
        heroAutoplayIntervalSeconds,
        configuredBlockTypes,
        loading,
        error,
        publicLoadState,
        contentError,
    } = useStorefrontBootstrap();
    const [checkoutOrder, setCheckoutOrder] = useState<Order | null>(null);
    const [completedOrder, setCompletedOrder] = useState<Order | null>(null);
    const [cartLoading, setCartLoading] = useState(false);
    const [cartError, setCartError] = useState<string | null>(null);
    const [addingVariantId, setAddingVariantId] = useState<string | null>(null);
    const [toast, setToast] = useState<string | null>(null);
    const [online, setOnline] = useState(navigator.onLine);

    const toastTimer = useRef<number | null>(null);

    const {
        route,
        displayedRoute,
        displayedRouterLocation,
        isNavigationPending,
        activeCollectionId,
        activeChildId,
        sortMode,
        fulfillmentFilter,
        inStockOnly,
        minimumPrice,
        maximumPrice,
        setMinimumPrice,
        setMaximumPrice,
        navigate,
        goBack,
        updateCategory,
        openContentTarget,
    } = useStorefrontNavigation({ collections });

    const {
        cartQueryKey,
        customerQueryKey,
        cartQuery,
        customerQuery,
        customer,
        couponCampaignsQueryKey,
        couponCampaignsQuery,
        activeCoupons,
        customerCouponQueryKey,
        customerCouponsQuery,
        myCoupons,
        customerCouponUsageRecordsQuery,
        couponUsageRecords,
        customerCouponsError,
        customerCouponUsageRecordsError,
        customerLoadError,
        customerLoadState,
        cartLoadState,
        couponCampaignsLoading,
        couponCampaignsError,
        cartQueryError,
    } = useStorefrontCustomerData(queryContext);

    const cart = cartState.cart;
    useEffect(() => {
        if (cartState.confirmed) queryClient.setQueryData(cartQueryKey, cartState.confirmed);
    }, [cartState.confirmed, queryClient, market.code, market.currencyCode, vendureLanguageCode]);

    useEffect(() => {
        if (!storefrontContextResolved) return;
        const controller = new AbortController();
        void api.watchRealtime(event => {
            void invalidateStorefrontRealtimeQueries(queryClient, event, {
                marketCode: storefrontQueryKeys.market(market),
                languageCode: vendureLanguageCode,
                customerId: customer?.id,
            });
        }, controller.signal);
        return () => controller.abort();
    }, [api, customer?.id, market, queryClient, storefrontContextResolved, vendureLanguageCode]);

    useStorefrontTraffic({
        api,
        channel: market.code,
        location: displayedRouterLocation.pathname + displayedRouterLocation.searchStr,
        customerId: customer?.id ?? null,
        enabled: storefrontContextResolved && !isNavigationPending,
    });

    const { bestSellerProducts, recommendationProducts, recommendationsBlock } = useStorefrontMerchandising({
        ...queryContext,
        customer,
        recentProductIds,
        products,
        contentBlocks,
        configuredBlockTypes,
    });

    const currentCheckoutOrder = cart?.checkoutOrder ?? checkoutOrder;

    const setCart = useCallback(
        (_nextCart: StorefrontCart) => {
            const confirmed = cartController.getSnapshot().confirmed;
            if (confirmed) queryClient.setQueryData(cartQueryKey, confirmed);
        },
        [cartController, market.code, market.currencyCode, queryClient, vendureLanguageCode],
    );
    const setCustomer = useCallback(
        (
            nextCustomer:
                ActiveCustomer | null | ((currentCustomer: ActiveCustomer | null) => ActiveCustomer | null),
        ) => {
            queryClient.setQueryData<ActiveCustomer | null>(customerQueryKey, currentCustomer =>
                typeof nextCustomer === 'function' ? nextCustomer(currentCustomer ?? null) : nextCustomer,
            );
        },
        [market.code, market.currencyCode, queryClient, vendureLanguageCode],
    );
    const clearPrivateQueryCache = useCallback(() => {
        queryClient.removeQueries({
            predicate: query =>
                query.queryKey[0] === 'storefront' &&
                typeof query.queryKey[1] === 'string' &&
                query.queryKey[1].startsWith(`${market.code}:`) &&
                query.queryKey[3] === 'private',
        });
    }, [market.code, queryClient]);
    const invalidateCustomerRouteQueries = useCallback(async () => {
        if (!customer) return;
        await queryClient.invalidateQueries({
            queryKey: storefrontQueryKeys.customerScope(
                storefrontQueryKeys.market(market),
                vendureLanguageCode,
                customer.id,
            ),
            refetchType: 'none',
        });
    }, [customer, market.code, market.currencyCode, queryClient, vendureLanguageCode]);
    const {
        productQuery,
        routeProduct,
        routeProductLoading,
        routeProductError,
        orderQuery,
        routeOrder,
        routeOrderLoading,
        routeOrderError,
    } = useStorefrontRouteData({
        ...queryContext,
        customer,
        customerLoadState,
        route,
    });

    const notify = useCallback((message: string) => {
        setToast(message);
        if (toastTimer.current) window.clearTimeout(toastTimer.current);
        toastTimer.current = window.setTimeout(() => setToast(null), 2400);
    }, []);

    useEffect(() => {
        const setConnected = () => setOnline(navigator.onLine);
        window.addEventListener('online', setConnected);
        window.addEventListener('offline', setConnected);
        return () => {
            window.removeEventListener('online', setConnected);
            window.removeEventListener('offline', setConnected);
        };
    }, []);

    useEffect(() => {
        if (cartState.confirmed) setCheckoutOrder(cartState.confirmed.checkoutOrder);
    }, [cartState.confirmed]);

    const { refreshCart, mutateCart, addToCart, startDirectPurchase, addOrderToCart } =
        useStorefrontCartActions({
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
        });
    const { applyCoupon, claimCoupon, removeCoupon } = useStorefrontCoupons({
        ...queryContext,
        cart,
        cartState,
        route,
        customer,
        myCoupons,
        customerCouponsQuery,
        customerCouponQueryKey,
        couponCampaignsQueryKey,
        notify,
        navigate,
        refreshCart,
        setCartLoading,
        setCartError,
    });

    const reopenPendingOrder = useCallback(
        async (order: Order) => {
            setCartLoading(true);
            setCartError(null);
            try {
                const current = cart ?? (await api.cart());
                if (current.state !== 'PAYMENT_PENDING' || current.checkoutOrder?.id !== order.id) {
                    throw new Error(
                        isZh
                            ? '该订单无法从当前购物车恢复，请刷新订单后重试'
                            : 'This order cannot be restored from the current cart.',
                    );
                }
                const reopened = await api.reopenCart(current.revision);
                setCart(reopened);
                setCheckoutOrder(reopened.checkoutOrder);
                await invalidateCustomerRouteQueries();
                notify(isZh ? '订单已恢复，可以继续修改' : 'Order restored for editing');
                navigate({ name: 'cart' });
            } catch (requestError) {
                setCartError(
                    requestError instanceof Error
                        ? storefrontErrorMessage(requestError, language)
                        : text.loadError,
                );
                navigate({ name: 'cart' });
            } finally {
                setCartLoading(false);
            }
        },
        [api, cart, invalidateCustomerRouteQueries, isZh, navigate, notify, text.loadError],
    );

    const cancelAuthorizedOrder = useCallback(
        async (order: Order, reason: string) => {
            const cancelledOrder = await api.cancelMyAuthorizedOrder(order.id, reason);
            queryClient.setQueryData(
                storefrontQueryKeys.order(
                    storefrontQueryKeys.market(market),
                    vendureLanguageCode,
                    customer?.id ?? 'guest',
                    order.id,
                ),
                cancelledOrder,
            );
            setCustomer(current =>
                current
                    ? {
                          ...current,
                          orders: {
                              ...current.orders,
                              items: current.orders.items.map(item =>
                                  item.id === cancelledOrder.id ? cancelledOrder : item,
                              ),
                          },
                      }
                    : current,
            );
            await invalidateCustomerRouteQueries();
            const refreshedCustomer = await api.activeCustomer().catch(() => undefined);
            if (refreshedCustomer !== undefined) setCustomer(refreshedCustomer);
            notify(
                isZh
                    ? '订单已取消，支付授权和库存已释放'
                    : 'Order cancelled. Authorization and stock were released.',
            );
        },
        [
            api,
            customer?.id,
            invalidateCustomerRouteQueries,
            isZh,
            market.code,
            notify,
            queryClient,
            vendureLanguageCode,
        ],
    );

    const createAfterSalesRequest = useCallback(
        async (input: CreateAfterSalesRequestInput) => {
            await api.createAfterSalesRequest(input);
            if (customer) {
                await queryClient.invalidateQueries({
                    queryKey: storefrontQueryKeys.afterSalesRequests(
                        storefrontQueryKeys.market(market),
                        vendureLanguageCode,
                        customer.id,
                    ),
                    refetchType: 'none',
                });
            }
            notify(isZh ? '售后申请已提交' : 'Return request submitted');
            navigate({ name: 'orders', tab: 'service' });
        },
        [
            api,
            customer,
            isZh,
            market.code,
            market.currencyCode,
            navigate,
            notify,
            queryClient,
            vendureLanguageCode,
        ],
    );

    const beginCheckout = useCallback(async () => {
        if (!cart || cart.selectedQuantity === 0) return;
        if (!customer) {
            navigate({ name: 'login', returnTo: 'checkout' });
            return;
        }
        setCartLoading(true);
        setCartError(null);
        try {
            const session = await api.beginCheckout(cart.revision);
            setCart(session.cart);
            setCheckoutOrder(session.order);
            navigate({ name: 'checkout' });
        } catch (requestError) {
            if (
                requestError instanceof ShopApiError &&
                requestError.errorCode === 'CART_REVISION_CONFLICT_ERROR'
            ) {
                await refreshCart().catch(() => undefined);
                setCartError(
                    isZh
                        ? '购物车已更新，请确认后重新结算'
                        : 'Your cart was updated. Please review it and try again.',
                );
            } else {
                setCartError(storefrontErrorMessage(requestError, language, text.loadError));
            }
        } finally {
            setCartLoading(false);
        }
    }, [api, cart, customer, isZh, navigate, refreshCart, text.loadError]);

    const completeAuthentication = useCallback(async () => {
        cartController.reset();
        clearPrivateQueryCache();
        const [nextCustomer, nextCart] = await Promise.all([api.activeCustomer(), api.cart()]);
        if (!nextCustomer) {
            throw new Error(
                isZh ? '登录状态尚未确认，请重新登录' : 'Sign-in could not be confirmed. Try again.',
            );
        }
        setCustomer(nextCustomer);
        setCart(nextCart);
        setCartError(null);
        setCheckoutOrder(nextCart.checkoutOrder);
        try {
            const resumed = await resumeAuthenticatedCheckout(api, cartController, nextCart, route);
            setCart(resumed.cart);
            setCheckoutOrder(resumed.order);
            notify(isZh ? '登录成功' : 'Signed in');
            navigate(resumed.route, true);
        } catch {
            const message = isZh
                ? '已登录，请在购物车确认商品后重新结算'
                : 'Signed in. Review your cart and try checkout again.';
            setCartError(message);
            notify(message);
            navigate({ name: 'cart' }, true);
        }
    }, [api, cartController, clearPrivateQueryCache, isZh, navigate, notify, route]);

    const selectedProduct = route.id
        ? ((routeProduct?.id === route.id ? routeProduct : null) ??
          products.find(product => product.id === route.id) ??
          null)
        : null;
    const selectedOrder = route.id && routeOrder?.id === route.id ? routeOrder : null;
    const legalContent = contentBlocks.find(block => block.type === 'LEGAL');
    const supportContent = contentBlocks.find(block => block.type === 'SUPPORT');

    useStorefrontMetadata({ isZh, route, selectedProduct, storefrontDescription, storefrontName, logoUrl });

    useEffect(() => {
        if (route.name !== 'product' || !selectedProduct || !storefrontCode) return;
        setRecentProductIds(current => {
            const next = [
                selectedProduct.id,
                ...current.filter(productId => productId !== selectedProduct.id),
            ].slice(0, RECENT_PRODUCT_LIMIT);
            if (
                next.length === current.length &&
                next.every((productId, index) => productId === current[index])
            ) {
                return current;
            }
            localStorage.setItem(
                scopedStorageKey(RECENT_PRODUCT_STORAGE_KEY, storefrontCode),
                JSON.stringify(next),
            );
            return next;
        });
    }, [route.name, selectedProduct, storefrontCode]);

    const toggleFavoriteProduct = useCallback(
        (productId: string) => {
            if (!storefrontCode) return;
            setFavoriteProductIds(current => {
                const next = current.includes(productId)
                    ? current.filter(currentProductId => currentProductId !== productId)
                    : [productId, ...current].slice(0, FAVORITE_PRODUCT_LIMIT);
                localStorage.setItem(
                    scopedStorageKey(FAVORITE_PRODUCT_STORAGE_KEY, storefrontCode),
                    JSON.stringify(next),
                );
                return next;
            });
        },
        [storefrontCode],
    );

    const switchCurrency = useCallback(
        async (currencyCode: string) => {
            if (
                currencyCode === displayCurrencyCode ||
                !availableCurrencyCodes.includes(currencyCode) ||
                cartLoading
            ) {
                return;
            }
            setCartLoading(true);
            setCartError(null);
            try {
                if (currencyCode !== 'USDT' && cart?.checkoutOrder && currencyCode !== market.currencyCode) {
                    const updatedOrder = await api.setCurrencyForOrder(currencyCode);
                    setCheckoutOrder(updatedOrder);
                }
                writeStoredCurrency(market.code, currencyCode);
                writeStoredSettlementCurrency(market.code, currencyCode);
                setDisplayCurrencyCode(currencyCode);
                if (currencyCode !== 'USDT' && currencyCode !== market.currencyCode) {
                    if (route.name === 'category' && (minimumPrice || maximumPrice)) {
                        setMinimumPrice('');
                        setMaximumPrice('');
                        navigate({ ...route, minPrice: undefined, maxPrice: undefined }, true);
                    }
                    setStorefrontContext(current => ({
                        ...current,
                        market: { ...current.market, currencyCode },
                    }));
                }
                notify(
                    language === 'zh'
                        ? `已切换为 ${currencyCode} 价格`
                        : `Prices switched to ${currencyCode}`,
                );
            } catch (requestError) {
                const message =
                    requestError instanceof Error
                        ? storefrontErrorMessage(requestError, language)
                        : text.loadError;
                setCartError(message);
                notify(message);
            } finally {
                setCartLoading(false);
            }
        },
        [
            api,
            availableCurrencyCodes,
            cart?.checkoutOrder,
            cartLoading,
            displayCurrencyCode,
            language,
            market.code,
            market.currencyCode,
            maximumPrice,
            minimumPrice,
            navigate,
            notify,
            route,
            text.loadError,
        ],
    );

    const storefrontContextValue = {
        route,
        api,
        products,
        collections,
        contentBlocks,
        managedContentProducts,
        heroAutoplayIntervalSeconds,
        configuredBlockTypes,
        activeCoupons,
        couponCampaignsQuery,
        couponCampaignsLoading,
        couponCampaignsError,
        activeFlashSales,
        activeFlashSaleItems,
        systemAnnouncements,
        bestSellerProducts,
        recommendationProducts,
        recommendationsBlock,
        contentError,
        contentQuery,
        loading,
        error,
        publicLoadState,
        market,
        locale,
        language,
        storefrontName,
        storefrontDescription,
        storefrontTagline,
        storefrontCode,
        logoUrl,
        logoOnLightUrl,
        logoOnDarkUrl,
        availableCountries,
        availableProvinces,
        availableCurrencyCodes,
        currencySelectorEnabled,
        displayCurrencyCode,
        addingVariantId,
        cart,
        cartLoading: cartLoading || cartState.pending,
        cartPending: cartState.pending,
        cartEditingBlocked: cartState.editingBlocked,
        cartCommandUnknown: cartState.phase === 'unknown',
        cancelPendingCartCommand: () => void cartController.recoverPending(true),
        selectCartLines: (ids: string[], selected: boolean) => {
            void api.setLinesSelected(ids, selected, cart?.revision ?? 0).catch(() => undefined);
        },
        toggleAllCartLines: () => {
            const available = cart?.lines.filter(cartLineCanSelect) ?? [];
            void api
                .setAllLinesSelected(
                    available.some(line => !line.selected),
                    cart?.revision ?? 0,
                )
                .catch(() => undefined);
        },
        cartError: cartState.error
            ? storefrontErrorMessage(cartState.error, language)
            : (cartError ?? cartQueryError),
        cartLoadState,
        cartQueryError,
        cartQuery,
        commerceMode: commerceModeQuery.data ?? null,
        commerceModeQuery,
        customer,
        customerLoadState,
        customerLoadError,
        customerQuery,
        myCoupons,
        customerCouponsQuery,
        customerCouponsError,
        couponUsageRecords,
        customerCouponUsageRecordsQuery,
        customerCouponUsageRecordsError,
        currentCheckoutOrder,
        completedOrder,
        activeCollectionId,
        activeChildId,
        sortMode,
        fulfillmentFilter,
        inStockOnly,
        minimumPrice,
        maximumPrice,
        favoriteProductIds,
        recentProductIds,
        selectedProduct,
        routeProductLoading,
        routeProductError,
        productQuery,
        selectedOrder,
        routeOrderLoading,
        routeOrderError,
        orderQuery,
        legalContent,
        legalIdentity,
        supportContent,
        navigate,
        goBack,
        notify,
        toggleLanguage,
        switchCurrency,
        updateCategory,
        openContentTarget,
        refetchStorefront,
        refreshCart,
        mutateCart,
        addToCart,
        startDirectPurchase,
        toggleFavoriteProduct,
        setFavoriteProductIds,
        setRecentProductIds,
        setCart,
        setCustomer,
        setCheckoutOrder,
        setCompletedOrder,
        clearPrivateQueryCache,
        invalidateCustomerRouteQueries,
        applyCoupon,
        claimCoupon,
        removeCoupon,
        beginCheckout,
        reopenPendingOrder,
        addOrderToCart,
        cancelAuthorizedOrder,
        createAfterSalesRequest,
        completeAuthentication,
    } satisfies Record<string, unknown>;

    return {
        storefrontContextValue,
        online,
        isZh,
        displayedRoute,
        navigationBlock,
        cart,
        toast,
        language,
        logoUrl,
        storefrontName,
    };
}
