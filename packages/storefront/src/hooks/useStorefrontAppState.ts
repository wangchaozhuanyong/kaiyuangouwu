import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ShopApi, ShopApiError } from '../api';
import { CartController } from '../cart/cart-controller';
import { useCart } from '../cart/use-cart';
import { categoryTargetSelection } from '../category-navigation';
import { markCouponCampaignClaimed } from '../coupon-center-state';
import { claimAndVerifyCoupon } from '../coupon-claim-verification';
import {
    documentLanguageFor,
    enabledMarkets,
    languageCodeFor,
    localeFor,
    marketForStorefrontConfig,
    uiCopy,
} from '../i18n';
import { configureMoneyDisplay } from '../money-display';
import { PUBLIC_QUERY_STALE_TIME, publicQueryMeta, storefrontQueryKeys } from '../query-client';
import { invalidateStorefrontRealtimeQueries } from '../realtime-updates';
import { captureReferralAttribution } from '../referral-attribution';
import { routeFromHash, RouteName } from '../storefront-router';
import { readStoredStrings, scopedStorageKey } from '../storefront-storage';
import {
    DEFAULT_STOREFRONT_NAMES,
    FAVORITE_PRODUCT_LIMIT,
    FAVORITE_PRODUCT_STORAGE_KEY,
    normalizeStorefrontName,
    readStoredCurrency,
    readStoredLanguage,
    readStoredSettlementCurrency,
    RECENT_PRODUCT_LIMIT,
    RECENT_PRODUCT_STORAGE_KEY,
    writeManualLanguage,
    writeStoredCurrency,
    writeStoredSettlementCurrency,
} from '../storefront-utils';
import {
    ActiveCustomer,
    CreateAfterSalesRequestInput,
    MarketConfig,
    Order,
    OrderSummary,
    Product,
    ProductVariant,
    StoreCustomerCoupon,
    StorefrontCart,
    StorefrontConfig,
    StorefrontContentTargetType,
    StorefrontCouponCampaign,
    StorefrontLanguage,
    StorefrontLegalIdentity,
} from '../types';

import { useStorefrontCustomerData } from './useStorefrontCustomerData';
import { useStorefrontBrandColors, useStorefrontMetadata } from './useStorefrontDocument';
import { useStorefrontMerchandising } from './useStorefrontMerchandising';
import { useStorefrontNavigation } from './useStorefrontNavigation';
import { useStorefrontPublicData } from './useStorefrontPublicData';
import { useStorefrontRouteData } from './useStorefrontRouteData';
import { useStorefrontTraffic } from './useStorefrontTraffic';

export function useStorefrontAppState() {
    const queryClient = useQueryClient();

    const [{ market, language }, setStorefrontContext] = useState<{
        market: MarketConfig;
        language: StorefrontLanguage;
    }>(() => {
        const initialMarket = enabledMarkets[0];
        const currencyCode = readStoredSettlementCurrency(initialMarket);
        return {
            market: { ...initialMarket, currencyCode },
            language: readStoredLanguage(initialMarket),
        };
    });
    const [displayCurrencyCode, setDisplayCurrencyCode] = useState(() =>
        readStoredCurrency(enabledMarkets[0]),
    );
    const [storefrontContextResolved, setStorefrontContextResolved] = useState(false);
    const [favoriteProductIds, setFavoriteProductIds] = useState<string[]>([]);
    const [recentProductIds, setRecentProductIds] = useState<string[]>([]);
    const [storefrontNames, setStorefrontNames] =
        useState<Record<StorefrontLanguage, string>>(DEFAULT_STOREFRONT_NAMES);
    const [storefrontCode, setStorefrontCode] = useState('');
    const [logoUrl, setLogoUrl] = useState<string | null>(null);
    const [logoOnLightUrl, setLogoOnLightUrl] = useState<string | null>(null);
    const [logoOnDarkUrl, setLogoOnDarkUrl] = useState<string | null>(null);
    const [storefrontDescription, setStorefrontDescription] = useState('');
    const [storefrontTagline, setStorefrontTagline] = useState('');
    const [availableCountries, setAvailableCountries] = useState<StorefrontConfig['availableCountries']>([]);
    const [availableCurrencyCodes, setAvailableCurrencyCodes] = useState<string[]>([]);
    const [currencySelectorEnabled, setCurrencySelectorEnabled] = useState(false);
    const [checkoutOrder, setCheckoutOrder] = useState<Order | null>(null);
    const [completedOrder, setCompletedOrder] = useState<Order | null>(null);
    const [cartLoading, setCartLoading] = useState(false);
    const [cartError, setCartError] = useState<string | null>(null);
    const [addingVariantId, setAddingVariantId] = useState<string | null>(null);
    const [toast, setToast] = useState<string | null>(null);
    const [online, setOnline] = useState(navigator.onLine);

    const toastTimer = useRef<number | null>(null);
    const locale = localeFor(language, market);
    const text = uiCopy[language];
    const isZh = language === 'zh';
    const storefrontName = storefrontNames[language];
    const vendureLanguageCode = languageCodeFor(language);
    const cartController = useMemo(
        () => new CartController(`${market.code}:${market.currencyCode}`),
        [market.code, market.currencyCode],
    );
    const cartState = useCart(cartController);
    const api = useMemo(() => {
        const client = new ShopApi(market, vendureLanguageCode);
        client.enableCartCommands(cartController);
        return client;
    }, [market, vendureLanguageCode, cartController]);
    useEffect(() => () => cartController.reset(false), [cartController]);

    useEffect(() => {
        try {
            captureReferralAttribution();
        } catch {
            // Private browsing can disable localStorage; registration remains usable.
        }
    }, []);

    const queryContext = { api, market, language, vendureLanguageCode, storefrontContextResolved };

    const {
        productsQuery,
        collectionsQuery,
        configQuery,
        contentQuery,
        commerceModeQuery,
        products,
        collections,
        contentBlocks,
        navigationBlock,
        activeFlashSales,
        systemAnnouncements,
        managedContentProductsQuery,
        managedContentProducts,
        activeFlashSaleItems,
        heroAutoplayIntervalSeconds,
        configuredBlockTypes,
        loading,
        error,
        publicLoadState,
        contentError,
    } = useStorefrontPublicData(queryContext);
    const {
        route,
        displayedRoute,
        displayedRouterLocation,
        isNavigationPending,
        activeCollectionId,
        setActiveCollectionId,
        setActiveChildId,
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
    } = useStorefrontNavigation({ collections });

    const legalIdentity = useMemo<StorefrontLegalIdentity>(
        () => ({
            legalEntityName: configQuery.data?.legalEntityName?.trim() || null,
            legalRegistrationCountry: configQuery.data?.legalRegistrationCountry?.trim() || null,
            supportEmail: configQuery.data?.supportEmail?.trim() || null,
            privacyEmail: configQuery.data?.privacyEmail?.trim() || null,
        }),
        [configQuery.data],
    );
    configureMoneyDisplay({
        displayCurrencyCode,
        cnyPerUsdtRate: configQuery.data?.currencyConfiguration?.cnyPerUsdtRate ?? null,
        myrPerUsdtRate: configQuery.data?.currencyConfiguration?.myrPerUsdtRate ?? null,
        usdtMarkupPercent: configQuery.data?.currencyConfiguration?.usdtMarkupPercent ?? 0,
    });

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

    const couponAutoSelectionScope =
        cart?.checkoutOrder && customer ? `${customer.id}:${cart.id}:${cart.checkoutOrder.id}` : '';
    const couponAutoSelectionAttemptKey = couponAutoSelectionScope
        ? `${couponAutoSelectionScope}:${cart?.revision ?? 0}:${myCoupons
              .map(coupon => `${coupon.id}:${coupon.status}:${coupon.lockedOrderId ?? ''}`)
              .sort()
              .join('|')}`
        : '';
    const couponAutoSelectionAttemptRef = useRef('');
    const couponAutoSelectionSuppressedRef = useRef('');

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

    const cacheProducts = useCallback(
        (items: Product[]) => {
            for (const product of items) {
                const queryKey = storefrontQueryKeys.product(
                    storefrontQueryKeys.market(market),
                    vendureLanguageCode,
                    product.id,
                );
                queryClient.setQueryData(queryKey, product);
                void queryClient.prefetchQuery({
                    queryKey,
                    queryFn: () => product,
                    staleTime: PUBLIC_QUERY_STALE_TIME,
                    meta: publicQueryMeta(),
                });
            }
        },
        [market.code, market.currencyCode, queryClient, vendureLanguageCode],
    );

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
        const config = configQuery.data;
        if (!config) return;
        const nextStorefrontCode = config.code;
        const configuredMarket = marketForStorefrontConfig(config, market);
        const currencyConfiguration = config.currencyConfiguration;
        const settlementCurrencyCodes = currencyConfiguration?.availableCurrencyCodes.length
            ? currencyConfiguration.availableCurrencyCodes
            : [configuredMarket.currencyCode];
        const nextAvailableCurrencyCodes = [
            ...settlementCurrencyCodes,
            ...(currencyConfiguration?.usdtDisplayEnabled && currencyConfiguration.usdtRateAvailable
                ? ['USDT']
                : []),
        ];
        const selectedDisplayCurrency = readStoredCurrency(configuredMarket, nextAvailableCurrencyCodes);
        const selectedSettlementCurrency =
            selectedDisplayCurrency === 'USDT'
                ? readStoredSettlementCurrency(configuredMarket, settlementCurrencyCodes)
                : selectedDisplayCurrency;
        const nextMarket = { ...configuredMarket, currencyCode: selectedSettlementCurrency };
        setAvailableCountries(config.availableCountries);
        setAvailableCurrencyCodes(nextAvailableCurrencyCodes);
        setCurrencySelectorEnabled(currencyConfiguration?.selectorEnabled === true);
        setDisplayCurrencyCode(selectedDisplayCurrency);
        if (
            nextMarket.code !== market.code ||
            nextMarket.defaultLanguageCode !== market.defaultLanguageCode ||
            nextMarket.currencyCode !== market.currencyCode ||
            nextMarket.countryCode !== market.countryCode
        ) {
            const nextLanguage = readStoredLanguage(nextMarket);
            if (nextLanguage === language) {
                const nextConfigKey = storefrontQueryKeys.config(
                    storefrontQueryKeys.market(nextMarket),
                    vendureLanguageCode,
                );
                const nextConfigState = queryClient.getQueryState(nextConfigKey);
                // Copy the response age as well as its data, and preserve a newer destination value.
                if (!nextConfigState?.data || nextConfigState.dataUpdatedAt < configQuery.dataUpdatedAt) {
                    queryClient.setQueryData(nextConfigKey, config, {
                        updatedAt: configQuery.dataUpdatedAt,
                    });
                }
            }
            setStorefrontContextResolved(false);
            setStorefrontContext({
                market: nextMarket,
                language: nextLanguage,
            });
            return;
        }
        setStorefrontContextResolved(true);
        setStorefrontCode(nextStorefrontCode);
        setFavoriteProductIds(
            readStoredStrings(
                scopedStorageKey(FAVORITE_PRODUCT_STORAGE_KEY, nextStorefrontCode),
                FAVORITE_PRODUCT_LIMIT,
            ),
        );
        setRecentProductIds(
            readStoredStrings(
                scopedStorageKey(RECENT_PRODUCT_STORAGE_KEY, nextStorefrontCode),
                RECENT_PRODUCT_LIMIT,
            ),
        );
        setStorefrontNames({
            zh: normalizeStorefrontName(config.customFields.storefrontNameZh, DEFAULT_STOREFRONT_NAMES.zh),
            en: normalizeStorefrontName(config.customFields.storefrontNameEn, DEFAULT_STOREFRONT_NAMES.en),
        });
        setLogoUrl(config.logoUrl ?? null);
        setLogoOnLightUrl(config.logoOnLightUrl ?? null);
        setLogoOnDarkUrl(config.logoOnDarkUrl ?? null);
        setStorefrontDescription(config.description?.trim() ?? '');
        setStorefrontTagline(config.tagline?.trim() ?? '');
    }, [configQuery.data, configQuery.dataUpdatedAt, language, market, queryClient, vendureLanguageCode]);

    useStorefrontBrandColors(configQuery.data);

    useEffect(() => {
        if (productsQuery.data) cacheProducts(productsQuery.data);
    }, [cacheProducts, productsQuery.data]);

    useEffect(() => {
        if (cartState.confirmed) setCheckoutOrder(cartState.confirmed.checkoutOrder);
    }, [cartState.confirmed]);

    const refetchStorefront = useCallback(async () => {
        await Promise.all([productsQuery.refetch(), collectionsQuery.refetch(), configQuery.refetch()]);
    }, [collectionsQuery, configQuery, productsQuery]);

    useEffect(() => {
        document.documentElement.lang = documentLanguageFor(language);
        document.documentElement.setAttribute('translate', 'yes');
    }, [language]);

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

    const openContentTarget = useCallback(
        (targetType: StorefrontContentTargetType, targetValue: string | null) => {
            const value = targetValue?.trim();
            if (targetType === 'NONE' || !value) return;
            if (targetType === 'PRODUCT') {
                navigate({ name: 'product', id: value });
                return;
            }
            if (targetType === 'COLLECTION' || targetType === 'CATEGORY') {
                const target = categoryTargetSelection(collections, value);
                setActiveCollectionId(target.collectionId);
                setActiveChildId(target.childId);
                navigate({ name: 'category', ...target });
                return;
            }
            if (targetType === 'SEARCH') {
                navigate({ name: 'search', term: value });
                return;
            }
            if (targetType === 'PAGE') {
                navigate(routeFromHash(value.startsWith('#') ? value : `#/${value.replace(/^\//, '')}`));
                return;
            }
            if (targetType === 'SUPPORT') {
                if (value === '/support' || value === 'support' || value === '#/support') {
                    navigate({ name: 'support' });
                } else if (/^(mailto:|tel:)/i.test(value)) {
                    window.location.assign(value);
                } else if (/^https?:\/\//i.test(value)) {
                    window.open(value, '_blank', 'noopener,noreferrer');
                } else {
                    navigate({ name: 'support' });
                }
                return;
            }
            if (value.startsWith('#/')) {
                navigate(routeFromHash(value));
            } else if (value.startsWith('/')) {
                window.location.assign(value);
            } else {
                window.open(value, '_blank', 'noopener,noreferrer');
            }
        },
        [collections, navigate],
    );

    const applyCoupon = useCallback(
        async (customerCouponId: string): Promise<string | null> => {
            couponAutoSelectionSuppressedRef.current = couponAutoSelectionScope;
            setCartLoading(true);
            setCartError(null);
            try {
                await api.applyCustomerCoupon(customerCouponId);
                await Promise.all([queryClient.invalidateQueries({ queryKey: customerCouponQueryKey })]);
                notify(isZh ? '优惠券已使用' : 'Coupon applied');
                return null;
            } catch (requestError) {
                return requestError instanceof Error ? requestError.message : text.loadError;
            } finally {
                setCartLoading(false);
            }
        },
        [
            api,
            couponAutoSelectionScope,
            customerCouponQueryKey,
            isZh,
            notify,
            queryClient,
            refreshCart,
            text.loadError,
        ],
    );

    const claimCoupon = useCallback(
        async (campaignId: string): Promise<string | null> => {
            if (!customer) {
                navigate({ name: 'login' });
                return isZh ? '请先登录后领取优惠券' : 'Sign in to claim coupons';
            }
            setCartLoading(true);
            setCartError(null);
            try {
                const result = await claimAndVerifyCoupon(api, campaignId);
                if (result.status !== 'lookup-failed') {
                    queryClient.setQueryData<StoreCustomerCoupon[]>(customerCouponQueryKey, result.coupons);
                } else {
                    void queryClient.invalidateQueries({ queryKey: customerCouponQueryKey });
                }
                if (result.status === 'verified') {
                    queryClient.setQueryData<StorefrontCouponCampaign[]>(
                        couponCampaignsQueryKey,
                        campaigns =>
                            campaigns ? markCouponCampaignClaimed(campaigns, campaignId) : campaigns,
                    );
                }
                await Promise.all([
                    queryClient.invalidateQueries({ queryKey: couponCampaignsQueryKey }),
                    queryClient.invalidateQueries({
                        queryKey: storefrontQueryKeys.customerCouponUsageRecords(
                            storefrontQueryKeys.market(market),
                            vendureLanguageCode,
                            customer.id,
                        ),
                    }),
                ]);
                if (result.status === 'lookup-failed') {
                    return isZh
                        ? '领取请求已完成，但当前账号权益核验失败。请刷新后查看，若仍未显示请联系客服。'
                        : [
                              'The claim request completed, but account ownership could not be verified.',
                              'Refresh and contact support if it is still missing.',
                          ].join(' ');
                }
                if (result.status === 'missing') {
                    return isZh
                        ? '领取请求已完成，但未在当前账号查到该优惠券。请勿重复领取，刷新后仍未显示请联系客服。'
                        : [
                              'The claim request completed, but the coupon was not found on this account.',
                              'Do not claim again; refresh and contact support if it is still missing.',
                          ].join(' ');
                }
                notify(isZh ? '优惠券领取成功' : 'Coupon claimed');
                return null;
            } catch (requestError) {
                return requestError instanceof Error ? requestError.message : text.loadError;
            } finally {
                setCartLoading(false);
            }
        },
        [
            api,
            customer,
            customerCouponQueryKey,
            couponCampaignsQueryKey,
            isZh,
            market.code,
            navigate,
            notify,
            queryClient,
            text.loadError,
            vendureLanguageCode,
        ],
    );

    const removeCoupon = useCallback(
        async (customerCouponId: string): Promise<string | null> => {
            couponAutoSelectionSuppressedRef.current = couponAutoSelectionScope;
            setCartLoading(true);
            setCartError(null);
            try {
                await api.removeCustomerCoupon(customerCouponId);
                await Promise.all([queryClient.invalidateQueries({ queryKey: customerCouponQueryKey })]);
                notify(isZh ? '已取消使用优惠券' : 'Coupon unapplied');
                return null;
            } catch (requestError) {
                return requestError instanceof Error ? requestError.message : text.loadError;
            } finally {
                setCartLoading(false);
            }
        },
        [
            api,
            couponAutoSelectionScope,
            customerCouponQueryKey,
            isZh,
            notify,
            queryClient,
            refreshCart,
            text.loadError,
        ],
    );

    useEffect(() => {
        const order = cart?.checkoutOrder;
        if (
            !customer ||
            !order?.lines.length ||
            cart?.state !== 'OPEN' ||
            cartState.pending ||
            !(['cart', 'checkout', 'purchase'] as RouteName[]).includes(route.name) ||
            customerCouponsQuery.isPending ||
            !couponAutoSelectionScope ||
            !couponAutoSelectionAttemptKey ||
            couponAutoSelectionSuppressedRef.current === couponAutoSelectionScope ||
            couponAutoSelectionAttemptRef.current === couponAutoSelectionAttemptKey ||
            myCoupons.some(coupon => coupon.lockedOrderId === order.id) ||
            !myCoupons.some(coupon => coupon.usable)
        ) {
            return;
        }

        couponAutoSelectionAttemptRef.current = couponAutoSelectionAttemptKey;
        let active = true;
        void api
            .applyBestCustomerCoupon()
            .then(async coupon => {
                if (!coupon) return;
                queryClient.setQueryData<StoreCustomerCoupon[]>(customerCouponQueryKey, current =>
                    current?.map(existing => (existing.id === coupon.id ? coupon : existing)),
                );
                if (active) {
                    notify(
                        isZh
                            ? `已自动选择最优惠券：${coupon.campaignName}`
                            : `Best coupon applied: ${coupon.campaignName}`,
                    );
                }
                await Promise.all([queryClient.invalidateQueries({ queryKey: customerCouponQueryKey })]);
            })
            .catch(() => undefined);
        return () => {
            active = false;
        };
    }, [
        api,
        cart,
        couponAutoSelectionAttemptKey,
        couponAutoSelectionScope,
        customer,
        customerCouponQueryKey,
        customerCouponsQuery.isPending,
        isZh,
        myCoupons,
        notify,
        queryClient,
        refreshCart,
        route.name,
    ]);

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
                setCartError(requestError instanceof Error ? requestError.message : text.loadError);
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
            } else if (
                requestError instanceof ShopApiError &&
                (requestError.errorCode === 'CART_PROJECTION_ERROR' ||
                    requestError.message.includes('synchronized to checkout'))
            ) {
                setCartError(
                    isZh
                        ? '所选商品库存不足或已售罄，请调整后重新结算'
                        : 'Selected items are out of stock. Please adjust your cart.',
                );
            } else {
                setCartError(requestError instanceof Error ? requestError.message : text.loadError);
            }
        } finally {
            setCartLoading(false);
        }
    }, [api, cart, isZh, navigate, refreshCart, text.loadError]);

    const completeAuthentication = useCallback(async () => {
        cartController.reset();
        clearPrivateQueryCache();
        const [nextCustomer, nextCart] = await Promise.all([api.activeCustomer(), api.cart()]);
        setCustomer(nextCustomer);
        setCart(nextCart);
        setCartError(null);
        setCheckoutOrder(nextCart.checkoutOrder);
        notify(isZh ? '登录成功' : 'Signed in');
        navigate({ name: 'account' }, true);
    }, [api, clearPrivateQueryCache, isZh, navigate, notify]);

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

    const toggleLanguage = () =>
        setStorefrontContext(currentContext => {
            const nextLanguage = currentContext.language === 'zh' ? 'en' : 'zh';
            writeManualLanguage(currentContext.market.code, nextLanguage);
            return { ...currentContext, language: nextLanguage };
        });

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
                const message = requestError instanceof Error ? requestError.message : text.loadError;
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
            const available = cart?.lines.filter(line => line.available && line.productVariant) ?? [];
            void api
                .setAllLinesSelected(
                    available.some(line => !line.selected),
                    cart?.revision ?? 0,
                )
                .catch(() => undefined);
        },
        cartError: cartState.error ?? cartError ?? cartQueryError,
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
