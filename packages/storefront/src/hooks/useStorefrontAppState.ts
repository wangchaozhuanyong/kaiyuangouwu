// organize-imports-ignore -- Preserve ESLint type groups and CSS side-effect order.
import type { RouteState } from '../storefront-router';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ShopApiError } from '../api';
import { subscribeAuthSessionChanges } from '../auth-session-sync';
import { clearStudioCache } from '../pages/ai-image-studio-cache';
import { resolveCurrentCheckoutOrder } from '../payment-readiness';
import { cartLineCanSelect } from '../product-availability';
import { publicRefreshScheduler } from '../public-refresh-scheduler';
import {
    PUBLIC_QUERY_GC_TIME,
    PUBLIC_QUERY_STALE_TIME,
    publicQueryMeta,
    refreshStorefrontQueries,
    storefrontQueryKeys,
} from '../query-client';
import { invalidateStorefrontRealtimeQueries, refreshStorefrontAssociations } from '../realtime-updates';
import { preloadStorefrontRouteComponent } from '../route-component-preload';
import { preloadRouteMedia } from '../route-media-preload';
import { storefrontErrorMessage } from '../storefront-errors';
import { writeStoredCurrency, writeStoredSettlementCurrency } from '../storefront-utils';
import { ActiveCustomer, CreateAfterSalesRequestInput, Order, StorefrontCart } from '../types';

export type ToastPayload =
    | string
    | {
          message: string;
          type?: 'success' | 'error' | 'warning' | 'info';
          title?: string;
          action?: { label: string; onClick: () => void };
      };

import { useCustomerProductActivity } from './useCustomerProductActivity';
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
        storefrontUnavailable,
        storefrontAccessMode,
        favoriteProductIds: guestFavoriteProductIds,
        recentProductIds: guestRecentProductIds,
        setFavoriteProductIds: setGuestFavoriteProductIds,
        setRecentProductIds: setGuestRecentProductIds,
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
        customerAuthenticated,
        legalIdentity,
        refetchStorefront,
        toggleLanguage: toggleStoredLanguage,
        publicSeo,
        products,
        productsQuery,
        collections,
        contentQuery,
        reviewSettingsQuery,
        reviewSettingsStatus,
        configQuery,
        commerceModeQuery,
        contentBlocks,
        navigationBlock,
        activeFlashSales,
        systemAnnouncements,
        managedContentProducts,
        managedContentProductsQuery,
        activeFlashSaleItems,
        heroAutoplayIntervalSeconds,
        configuredBlockTypes,
        authSettings,
        loading,
        error,
        publicLoadState,
        contentError,
    } = useStorefrontBootstrap();
    const [checkoutOrder, setCheckoutOrder] = useState<Order | null>(null);
    const [cartLoading, setCartLoading] = useState(false);
    const [checkoutStarting, setCheckoutStarting] = useState(false);
    const [cartError, setCartError] = useState<string | null>(null);
    const [addingVariantId, setAddingVariantId] = useState<string | null>(null);
    const [toast, setToast] = useState<ToastPayload | null>(null);
    const [online, setOnline] = useState(navigator.onLine);

    const toastTimer = useRef<number | null>(null);
    const checkoutStartingRef = useRef(false);

    const prepareProductNavigation = useCallback(
        async (id: string) => {
            const queryKey = storefrontQueryKeys.product(
                storefrontQueryKeys.market(market),
                vendureLanguageCode,
                id,
            );
            await Promise.all([
                preloadStorefrontRouteComponent('product'),
                queryClient.getQueryData(queryKey) !== undefined
                    ? Promise.resolve()
                    : queryClient.fetchQuery({
                          queryKey,
                          queryFn: ({ signal }) => api.product(id, signal),
                          staleTime: PUBLIC_QUERY_STALE_TIME,
                          gcTime: PUBLIC_QUERY_GC_TIME,
                          meta: publicQueryMeta(),
                      }),
            ]);
        },
        [api, market, queryClient, vendureLanguageCode],
    );

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
        navigate,
        goBack,
        returnToRoute,
        updateCategory,
        openContentTarget,
        isPreparingProduct,
        authOverlay,
        changeAuthOverlay,
        closeAuthOverlay,
        navigateAfterAuthentication,
    } = useStorefrontNavigation({
        collections,
        contentBlocks,
        products,
        prepareProduct: storefrontContextResolved ? prepareProductNavigation : undefined,
        authenticated: customerAuthenticated,
    });

    useEffect(() => {
        const publicLanguage = route.publicLanguage;
        if (!publicLanguage) return;
        setStorefrontContext(current =>
            current.language === publicLanguage
                ? current
                : {
                      ...current,
                      language: publicLanguage,
                  },
        );
    }, [route.publicLanguage, setStorefrontContext]);
    const toggleLanguage = useCallback(() => {
        if (route.publicLanguage) {
            navigate({ ...route, publicLanguage: route.publicLanguage === 'zh' ? 'en' : 'zh' });
        } else toggleStoredLanguage();
    }, [navigate, route, toggleStoredLanguage]);

    // React DOM deduplicates resource hints. Calling this during render lets a restored public
    // query cache announce the LCP candidate before the route component commits its image node.
    preloadRouteMedia(route, contentBlocks, products);

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
        retryCustomer,
        cartLoadState,
        couponCampaignsLoading,
        couponCampaignsError,
        cartQueryError,
    } = useStorefrontCustomerData({ ...queryContext, configQuery });

    const productActivity = useCustomerProductActivity({
        api,
        market,
        language,
        customerId: customer?.id ?? null,
        storefrontCode,
        guestFavoriteProductIds,
        guestRecentProductIds,
        setGuestFavoriteProductIds,
        setGuestRecentProductIds,
    });
    const { favoriteProductIds, recentProductIds } = productActivity;

    const cart = cartState.cart;
    const checkoutOwnerRef = useRef({ api, cartController, customerId: customer?.id, cartId: cart?.id });
    const checkoutMountedRef = useRef(false);
    useEffect(() => {
        checkoutMountedRef.current = true;
        return () => {
            checkoutMountedRef.current = false;
        };
    }, []);
    const checkoutOwner = checkoutOwnerRef.current;
    if (
        checkoutOwner.api !== api ||
        checkoutOwner.cartController !== cartController ||
        checkoutOwner.customerId !== customer?.id ||
        checkoutOwner.cartId !== cart?.id
    )
        checkoutOwnerRef.current = { api, cartController, customerId: customer?.id, cartId: cart?.id };
    useEffect(() => {
        checkoutStartingRef.current = false;
        setCheckoutStarting(false);
    }, [api, cartController, customer?.id, cart?.id]);
    useEffect(() => {
        if (cartState.confirmed) queryClient.setQueryData(cartQueryKey, cartState.confirmed);
    }, [cartState.confirmed, queryClient, market.code, market.currencyCode, vendureLanguageCode]);

    useEffect(() => {
        if (!storefrontContextResolved) return;
        const controller = new AbortController();
        const scheduler = publicRefreshScheduler(
            () => {
                void refreshStorefrontQueries(queryClient, {
                    marketCode: storefrontQueryKeys.market(market),
                    languageCode: vendureLanguageCode,
                });
            },
            () => {
                void refreshStorefrontAssociations(queryClient, {
                    marketCode: storefrontQueryKeys.market(market),
                    languageCode: vendureLanguageCode,
                });
            },
        );
        void api.watchRealtime(
            event => {
                void invalidateStorefrontRealtimeQueries(queryClient, event, {
                    marketCode: storefrontQueryKeys.market(market),
                    languageCode: vendureLanguageCode,
                    customerId: customer?.id,
                });
            },
            controller.signal,
            connected => scheduler.connection(connected),
        );
        return () => {
            scheduler.dispose();
            controller.abort();
        };
    }, [
        api,
        customerAuthenticated,
        customer?.id,
        market,
        queryClient,
        storefrontContextResolved,
        vendureLanguageCode,
    ]);

    useStorefrontTraffic({
        api,
        channel: market.code,
        location: displayedRouterLocation.pathname + displayedRouterLocation.searchStr,
        customerId: customer?.id ?? null,
        enabled: storefrontContextResolved && !isNavigationPending,
    });

    const {
        bestSellerProducts,
        recommendationProducts,
        recommendationsBlock,
        bestSellersLoading,
        recommendationsLoading,
    } = useStorefrontMerchandising({
        ...queryContext,
        customer,
        recentProductIds,
        personalizationReady: customerLoadState !== 'loading' && !productActivity.initialLoadPending,
        products,
        contentBlocks,
        configuredBlockTypes,
        activeRoute: route.name,
        contentReady: contentQuery.data !== undefined,
    });

    const currentCheckoutOrder = resolveCurrentCheckoutOrder(cart?.checkoutOrder, checkoutOrder);

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
        clearStudioCache();
        queryClient.removeQueries({
            predicate: query =>
                query.queryKey[0] === 'storefront' &&
                typeof query.queryKey[1] === 'string' &&
                query.queryKey[1].startsWith(`${market.code}:`) &&
                query.queryKey[3] !== 'config',
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
    useEffect(() => {
        let refreshId = 0;
        const unsubscribe = subscribeAuthSessionChanges(market.code, () => {
            const currentRefreshId = ++refreshId;
            cartController.reset();
            clearPrivateQueryCache();
            void Promise.all([api.activeCustomer(), api.cart()])
                .then(([nextCustomer, nextCart]) => {
                    if (currentRefreshId !== refreshId) return;
                    setCustomer(nextCustomer);
                    setCart(nextCart);
                    setCartError(null);
                    setCheckoutOrder(nextCart.checkoutOrder);
                })
                .catch(() => undefined);
        });
        return () => {
            refreshId++;
            unsubscribe();
        };
    }, [api, cartController, clearPrivateQueryCache, market.code, setCart, setCustomer]);
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

    const notify = useCallback((payload: ToastPayload) => {
        setToast(payload);
        if (toastTimer.current) window.clearTimeout(toastTimer.current);
        const duration = typeof payload === 'object' && payload.type === 'error' ? 3600 : 2400;
        toastTimer.current = window.setTimeout(() => setToast(null), duration);
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

    const {
        refreshCart,
        cancelPendingCartCommand,
        cartRecoveryPending,
        cartActionsBlocked,
        mutateCart,
        addToCart,
        startDirectPurchase,
        addOrderToCart,
    } = useStorefrontCartActions({
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
        if (cartActionsBlocked() || cartController.getSnapshot().pending) return;
        if (!customer) {
            navigate({ name: 'login', returnTo: 'checkout' });
            return;
        }
        if (checkoutStartingRef.current) return;
        checkoutStartingRef.current = true;
        setCheckoutStarting(true);
        setCartError(null);
        const requestOwner = checkoutOwnerRef.current;
        const isCurrent = () => checkoutMountedRef.current && checkoutOwnerRef.current === requestOwner;
        void preloadStorefrontRouteComponent('checkout');
        try {
            const session = await api.runWithinDeadline(async signal => {
                const confirmedSession = await api.beginCheckout(cart.revision);
                signal.throwIfAborted();
                return confirmedSession;
            });
            if (!isCurrent()) return;
            setCart(session.cart);
            setCheckoutOrder(session.order);
            navigate({ name: 'checkout' });
        } catch (requestError) {
            if (!isCurrent()) return;
            if (
                requestError instanceof ShopApiError &&
                requestError.errorCode === 'CART_REVISION_CONFLICT_ERROR'
            ) {
                checkoutStartingRef.current = false;
                await refreshCart().catch(() => undefined);
                if (!isCurrent()) return;
                setCartError(
                    isZh
                        ? '购物车已更新，请确认后重新结算'
                        : 'Your cart was updated. Please review it and try again.',
                );
            } else {
                setCartError(storefrontErrorMessage(requestError, language, text.loadError));
            }
        } finally {
            if (isCurrent()) {
                checkoutStartingRef.current = false;
                setCheckoutStarting(false);
            }
        }
    }, [
        api,
        cart,
        cartActionsBlocked,
        cartController,
        customer,
        isZh,
        navigate,
        refreshCart,
        text.loadError,
    ]);

    const completeAuthentication = useCallback(
        async (
            authenticationRoute?: RouteState,
            destination?: RouteState,
            isCurrent: () => boolean = () => true,
        ) => {
            if (!isCurrent()) return;
            const { completeStorefrontAuthentication } = await import('../checkout-authentication');
            await completeStorefrontAuthentication(
                {
                    api,
                    cartController,
                    clearPrivateQueryCache,
                    setCustomer,
                    setCart,
                    setCartError,
                    setCheckoutOrder,
                    notify,
                    navigate: navigateAfterAuthentication,
                    isZh,
                },
                authenticationRoute ?? route,
                destination,
                isCurrent,
            );
        },
        [api, cartController, clearPrivateQueryCache, isZh, navigateAfterAuthentication, notify, route],
    );

    const selectedProduct = route.id
        ? ((routeProduct?.id === route.id ? routeProduct : null) ??
          (productQuery.data === undefined ? products.find(product => product.id === route.id) : null) ??
          null)
        : null;
    const selectedOrder = route.id && routeOrder?.id === route.id ? routeOrder : null;
    const legalContent = contentBlocks.find(block => block.type === 'LEGAL');
    const supportContent = contentBlocks.find(block => block.type === 'SUPPORT');

    useStorefrontMetadata({
        isZh,
        route,
        selectedProduct,
        storefrontDescription,
        storefrontName,
        logoUrl,
        brandingScopeKey: market.code,
        brandingReady: storefrontUnavailable || Boolean(configQuery.data && configQuery.isFetchedAfterMount),
        publicSeo,
        seoAccessMode: storefrontUnavailable ? 'CLOSED' : configQuery.data?.accessMode,
    });

    const visitProductRef = useRef(productActivity.visitProduct);
    visitProductRef.current = productActivity.visitProduct;
    useEffect(() => {
        if (route.name !== 'product' || !selectedProduct?.id || !storefrontCode) return;
        void visitProductRef.current(selectedProduct.id).catch(() => {
            // A failed passive visit must not interrupt product browsing.
        });
    }, [route.name, selectedProduct?.id, storefrontCode, customer?.id]);

    const toggleFavoriteProduct = useCallback(
        async (productId: string) => {
            try {
                await productActivity.toggleFavoriteProduct(productId);
                return true;
            } catch (activityError) {
                notify({ message: storefrontErrorMessage(activityError, language), type: 'error' });
                return false;
            }
        },
        [productActivity.toggleFavoriteProduct, language, notify],
    );

    const removeFavoriteProducts = useCallback(
        async (productIds: string[]) => {
            try {
                await productActivity.removeFavoriteProducts(productIds);
                return true;
            } catch (activityError) {
                notify({ message: storefrontErrorMessage(activityError, language), type: 'error' });
                return false;
            }
        },
        [productActivity.removeFavoriteProducts, language, notify],
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
                if (cart?.checkoutOrder) {
                    const updatedOrder = await api.setPaymentCurrencyForOrder(currencyCode);
                    setCheckoutOrder(updatedOrder);
                }
                writeStoredCurrency(market.code, currencyCode);
                writeStoredSettlementCurrency(market.code, currencyCode);
                setDisplayCurrencyCode(currencyCode);
                if (currencyCode !== 'USDT' && currencyCode !== market.currencyCode) {
                    if (route.name === 'category' && (minimumPrice || maximumPrice)) {
                        navigate({ ...route, minPrice: undefined, maxPrice: undefined }, true);
                    }
                    setStorefrontContext(current => ({
                        ...current,
                        market: { ...current.market, currencyCode },
                    }));
                }
                notify(
                    language === 'zh'
                        ? `已切换为 ${currencyCode} 付款`
                        : `Payment currency switched to ${currencyCode}`,
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
        retryAccount: retryCustomer,
        storefrontContextResolved,
        route,
        displayedRoute,
        api,
        products,
        productsQuery,
        collections,
        contentBlocks,
        reviewSettingsStatus,
        reviewSettingsQuery,
        managedContentProducts,
        managedContentLoading: managedContentProductsQuery.isLoading || productsQuery.isLoading,
        managedContentResolved: managedContentProductsQuery.data !== undefined,
        heroAutoplayIntervalSeconds,
        configuredBlockTypes,
        authSettings,
        activeCoupons,
        couponCampaignsQuery,
        couponCampaignsLoading,
        couponCampaignsError,
        activeFlashSales,
        activeFlashSaleItems,
        systemAnnouncements,
        bestSellerProducts,
        recommendationProducts,
        bestSellersLoading,
        recommendationsLoading,
        recommendationsBlock,
        contentError,
        contentQuery,
        configQuery,
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
        cartConfirmed: cartState.confirmed,
        cartLoading: cartLoading || cartState.pending,
        cartPending: cartState.pending,
        cartTotalsPending: cartState.totalsPending,
        checkoutStarting,
        cartRecoveryPending: cartRecoveryPending || cartState.phase === 'recovering',
        cartEditingBlocked: cartState.editingBlocked,
        cartCommandUnknown: cartState.phase === 'unknown' || cartState.phase === 'recovering',
        cartCommandAcknowledged: cartState.commandAcknowledged,
        cancelPendingCartCommand,
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
        customerCouponQueryKey,
        customerCouponsQuery,
        customerCouponsError,
        couponUsageRecords,
        customerCouponUsageRecordsQuery,
        customerCouponUsageRecordsError,
        currentCheckoutOrder,
        activeCollectionId,
        activeChildId,
        sortMode,
        fulfillmentFilter,
        inStockOnly,
        minimumPrice,
        maximumPrice,
        favoriteProductIds,
        recentProductIds,
        productActivity,
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
        returnToRoute,
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
        removeFavoriteProducts,
        setCart,
        setCustomer,
        setCheckoutOrder,
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
        authOverlay,
        changeAuthOverlay,
        closeAuthOverlay,
    } satisfies Record<string, unknown>;

    return {
        // The shell only depends on resolving the current store identity. Route components own
        // their content/query skeletons, so an unrelated content request never blocks the app.
        pageDataPending: !storefrontContextResolved && !storefrontUnavailable && !configQuery.isError,
        storefrontUnavailable,
        storefrontAccessMode,
        isNavigationPending,
        isPreparingProduct,
        storefrontContextValue,
        customer,
        customerLoadState,
        customerLoadError,
        retryAccount: retryCustomer,
        retryPageLoad: () =>
            refreshStorefrontQueries(queryClient, {
                marketCode: storefrontQueryKeys.market(market),
                languageCode: vendureLanguageCode,
                includePrivate: true,
            }),
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
