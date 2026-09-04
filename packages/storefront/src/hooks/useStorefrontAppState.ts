import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouter, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ShopApi, ShopApiError } from '../api';
import { categoryTargetSelection } from '../category-navigation';
import { markCouponCampaignClaimed } from '../coupon-center-state';
import { claimAndVerifyCoupon } from '../coupon-claim-verification';
import { normalizeHeroAutoplayIntervalSeconds } from '../hero-carousel';
import { buildBestSellerProducts, buildRecommendationProducts } from '../home-merchandising';
import {
    documentLanguageFor,
    enabledMarkets,
    languageCodeFor,
    localeFor,
    marketForStorefrontConfig,
    uiCopy,
} from '../i18n';
import { offlineLoadError, QueryLoadState, resolveQueryLoadState } from '../loading-state';
import { configureMoneyDisplay } from '../money-display';
import { orderStatusRefreshInterval } from '../order-refresh';
import {
    PUBLIC_QUERY_GC_TIME,
    PUBLIC_QUERY_STALE_TIME,
    publicQueryMeta,
    storefrontQueryKeys,
} from '../query-client';
import { invalidateStorefrontRealtimeQueries } from '../realtime-updates';
import { captureReferralAttribution } from '../referral-attribution';
import { productDescriptionText } from '../rich-text';
import { useProductsByIdsQuery } from '../route-queries';
import { STOREFRONT_SOCIAL_IMAGE } from '../storefront-images';
import {
    routeFromHash,
    routeFromRouterLocation,
    RouteName,
    routePath,
    routeSearch,
    RouteState,
    SortMode,
} from '../storefront-router';
import { readStoredStrings, scopedStorageKey } from '../storefront-storage';
import {
    contentNumberSetting,
    contentStringArraySetting,
    DEFAULT_STOREFRONT_NAMES,
    FAVORITE_PRODUCT_LIMIT,
    FAVORITE_PRODUCT_STORAGE_KEY,
    normalizeStorefrontName,
    productImage,
    readStoredCurrency,
    readStoredLanguage,
    readStoredSettlementCurrency,
    RECENT_PRODUCT_LIMIT,
    RECENT_PRODUCT_STORAGE_KEY,
    setMetaContent,
    trimText,
    writeManualLanguage,
    writeStoredCurrency,
    writeStoredSettlementCurrency,
} from '../storefront-utils';
import { cacheLogoUrl } from '../StorefrontErrorBoundary';
import {
    ActiveCustomer,
    CreateAfterSalesRequestInput,
    FulfillmentType,
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

export function useStorefrontAppState() {
    const queryClient = useQueryClient();
    const router = useRouter();
    const tanstackNavigate = useNavigate();
    const routerLocation = useRouterState({ select: state => state.location });
    const isNavigationPending = useRouterState({ select: state => state.status === 'pending' });
    const resolvedRouterLocation = useRouterState({ select: state => state.resolvedLocation });
    const displayedRouterLocation =
        isNavigationPending && resolvedRouterLocation ? resolvedRouterLocation : routerLocation;
    const route = useMemo(
        () =>
            routeFromRouterLocation(
                routerLocation.pathname,
                routerLocation.search as Record<string, unknown>,
            ),
        [routerLocation.pathname, routerLocation.search],
    );
    const displayedRoute = useMemo(
        () =>
            routeFromRouterLocation(
                displayedRouterLocation.pathname,
                displayedRouterLocation.search as Record<string, unknown>,
            ),
        [displayedRouterLocation.pathname, displayedRouterLocation.search],
    );
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
    const [activeCollectionId, setActiveCollectionId] = useState(() => route.collectionId ?? 'all');
    const [activeChildId, setActiveChildId] = useState(() => route.childId ?? 'all');
    const [sortMode, setSortMode] = useState<SortMode>(() => route.sort ?? 'recommended');
    const [fulfillmentFilter, setFulfillmentFilter] = useState<'all' | FulfillmentType>(
        () => route.fulfillment ?? 'all',
    );
    const [inStockOnly, setInStockOnly] = useState(() => route.inStockOnly === true);
    const [minimumPrice, setMinimumPrice] = useState(() => route.minPrice ?? '');
    const [maximumPrice, setMaximumPrice] = useState(() => route.maxPrice ?? '');
    const categoryStateRef = useRef<
        Pick<
            RouteState,
            'collectionId' | 'childId' | 'sort' | 'fulfillment' | 'inStockOnly' | 'minPrice' | 'maxPrice'
        >
    >({});
    categoryStateRef.current = {
        collectionId: activeCollectionId === 'all' ? undefined : activeCollectionId,
        childId: activeChildId === 'all' ? undefined : activeChildId,
        sort: sortMode,
        fulfillment: fulfillmentFilter,
        inStockOnly,
        minPrice: minimumPrice || undefined,
        maxPrice: maximumPrice || undefined,
    };
    const toastTimer = useRef<number | null>(null);
    const locale = localeFor(language, market);
    const text = uiCopy[language];
    const isZh = language === 'zh';
    const storefrontName = storefrontNames[language];
    const vendureLanguageCode = languageCodeFor(language);
    const api = useMemo(() => new ShopApi(market, vendureLanguageCode), [market, vendureLanguageCode]);

    useEffect(() => {
        try {
            captureReferralAttribution();
        } catch {
            // Private browsing can disable localStorage; registration remains usable.
        }
    }, []);

    const productsQuery = useQuery({
        queryKey: storefrontQueryKeys.products(storefrontQueryKeys.market(market), vendureLanguageCode, 16),
        queryFn: ({ signal }) => api.products(16, signal),
        enabled: storefrontContextResolved,
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        meta: publicQueryMeta(),
    });
    const collectionsQuery = useQuery({
        queryKey: storefrontQueryKeys.collections(storefrontQueryKeys.market(market), vendureLanguageCode),
        queryFn: ({ signal }) => api.collections(signal),
        enabled: storefrontContextResolved,
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        meta: publicQueryMeta(),
    });
    const configQuery = useQuery({
        queryKey: storefrontQueryKeys.config(storefrontQueryKeys.market(market), vendureLanguageCode),
        queryFn: ({ signal }) => api.storefrontConfig(signal),
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        meta: publicQueryMeta(),
        refetchInterval: 60_000,
    });
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
    const contentQuery = useQuery({
        queryKey: storefrontQueryKeys.content(storefrontQueryKeys.market(market), vendureLanguageCode),
        queryFn: ({ signal }) => api.storefrontContent(signal),
        enabled: storefrontContextResolved,
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        meta: publicQueryMeta(),
        refetchInterval: 60_000,
    });
    const commerceModeQuery = useQuery({
        queryKey: storefrontQueryKeys.commerceMode(storefrontQueryKeys.market(market)),
        queryFn: ({ signal }) => api.activeStoreCommerceMode(signal),
        enabled: storefrontContextResolved,
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        meta: publicQueryMeta(),
        refetchInterval: 60_000,
    });
    const cartQueryKey = storefrontQueryKeys.cart(storefrontQueryKeys.market(market), vendureLanguageCode);
    const customerQueryKey = storefrontQueryKeys.customer(
        storefrontQueryKeys.market(market),
        vendureLanguageCode,
    );
    const cartQuery = useQuery({
        queryKey: cartQueryKey,
        queryFn: ({ signal }) => api.cart(signal),
        enabled: storefrontContextResolved,
        staleTime: 0,
    });
    const customerQuery = useQuery({
        queryKey: customerQueryKey,
        queryFn: ({ signal }) => api.activeCustomer(signal),
        enabled: storefrontContextResolved,
        staleTime: 0,
    });
    const customer = customerQuery.data ?? null;
    const couponCampaignsQueryKey = storefrontQueryKeys.couponCampaigns(
        storefrontQueryKeys.market(market),
        vendureLanguageCode,
        customer?.id ?? null,
    );
    const couponCampaignsQuery = useQuery({
        queryKey: couponCampaignsQueryKey,
        queryFn: ({ signal }) => api.activeCouponCampaigns(signal),
        enabled: customerQuery.data !== undefined,
        staleTime: 0,
        refetchInterval: customerQuery.data !== undefined ? 60_000 : false,
    });

    const rawProducts = productsQuery.data ?? [];
    const products = rawProducts;
    const collections = collectionsQuery.data ?? [];
    const contentBlocks = contentQuery.data?.blocks ?? [];
    const navigationBlock = contentBlocks.find(block => block.type === 'NAVIGATION');
    const activeCoupons = couponCampaignsQuery.data ?? [];
    const activeFlashSales = contentQuery.data?.flashSales ?? [];
    const systemAnnouncements = contentQuery.data?.systemAnnouncements ?? [];
    const managedContentProductIds = Array.from(
        new Set(
            contentBlocks.flatMap(block => contentStringArraySetting(block.settings?.selectedProductIds)),
        ),
    );
    const managedContentProductsQuery = useProductsByIdsQuery({
        api,
        productIds: managedContentProductIds,
        market,
        language,
    });
    const managedContentProducts = managedContentProductsQuery.data ?? [];
    const activeFlashSaleItems = activeFlashSales
        .flatMap(sale => sale.items)
        .filter(
            (item, index, items) =>
                items.findIndex(candidate => candidate.productVariantId === item.productVariantId) === index,
        );
    const heroAutoplayIntervalSeconds = normalizeHeroAutoplayIntervalSeconds(
        contentQuery.data?.settings?.heroAutoplayIntervalSeconds ?? 5,
    );
    const configuredBlockTypes = contentQuery.data?.settings?.configuredBlockTypes ?? [];
    const cart = cartQuery.data ?? null;

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

    useEffect(() => {
        if (!storefrontContextResolved) return;
        void api.recordStorefrontVisit().catch(() => undefined);
    }, [api, storefrontContextResolved]);
    const customerCouponQueryKey = storefrontQueryKeys.customerCoupons(
        storefrontQueryKeys.market(market),
        vendureLanguageCode,
        customer?.id ?? '',
    );
    const customerCouponsQuery = useQuery({
        queryKey: customerCouponQueryKey,
        queryFn: ({ signal }) => api.myCoupons(signal),
        enabled: Boolean(customer),
        staleTime: 0,
        refetchInterval: customer ? 60_000 : false,
    });
    const myCoupons = customerCouponsQuery.data ?? [];
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
    const customerCouponUsageRecordsQuery = useQuery({
        queryKey: storefrontQueryKeys.customerCouponUsageRecords(
            storefrontQueryKeys.market(market),
            vendureLanguageCode,
            customer?.id ?? '',
        ),
        queryFn: ({ signal }) => api.myCouponUsageRecords(signal),
        enabled: Boolean(customer),
        staleTime: 0,
        refetchInterval: customer ? 60_000 : false,
    });
    const couponUsageRecords = customerCouponUsageRecordsQuery.data ?? [];
    const customerCouponsError = !customer
        ? ''
        : customerCouponsQuery.isPaused && customerCouponsQuery.data === undefined
          ? offlineLoadError(language)
          : customerCouponsQuery.error instanceof Error
            ? customerCouponsQuery.error.message
            : customerCouponsQuery.error
              ? text.loadError
              : '';
    const customerCouponUsageRecordsError = !customer
        ? ''
        : customerCouponUsageRecordsQuery.isPaused && customerCouponUsageRecordsQuery.data === undefined
          ? offlineLoadError(language)
          : customerCouponUsageRecordsQuery.error instanceof Error
            ? customerCouponUsageRecordsQuery.error.message
            : customerCouponUsageRecordsQuery.error
              ? text.loadError
              : '';
    const bestSellersBlock = contentBlocks.find(block => block.type === 'BEST_SELLERS');
    const recommendationsBlock = contentBlocks.find(block => block.type === 'RECOMMENDATIONS');
    const pinnedBestSellerIds = contentStringArraySetting(bestSellersBlock?.settings?.pinnedProductIds);
    const bestSellerDisplayCount = Math.min(
        50,
        Math.max(1, contentNumberSetting(bestSellersBlock?.settings?.displayCount, 4)),
    );
    const recommendationDisplayCount = Math.min(
        50,
        Math.max(1, contentNumberSetting(recommendationsBlock?.settings?.displayCount, 6)),
    );
    const showBestSellers = Boolean(bestSellersBlock) || !configuredBlockTypes.includes('BEST_SELLERS');
    const showRecommendations =
        Boolean(recommendationsBlock) || !configuredBlockTypes.includes('RECOMMENDATIONS');
    const bestSellerCatalogQuery = useQuery({
        queryKey: storefrontQueryKeys.catalog(storefrontQueryKeys.market(market), vendureLanguageCode, {
            purpose: 'home-best-sellers',
            sort: 'sales',
            take: 48,
        }),
        queryFn: ({ signal }) => api.catalog({ sort: 'sales', take: 48 }, signal),
        enabled: storefrontContextResolved && showBestSellers,
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        meta: publicQueryMeta(),
    });
    const bestSellerCandidates = bestSellerCatalogQuery.data?.items ?? products;
    const bestSellerSalesQuery = useQuery({
        queryKey: [
            ...storefrontQueryKeys.scope(storefrontQueryKeys.market(market), vendureLanguageCode),
            'home-best-seller-sales',
            bestSellerCandidates.map(product => product.id),
        ],
        queryFn: () => api.productSales(bestSellerCandidates.map(product => product.id)),
        enabled:
            storefrontContextResolved &&
            showBestSellers &&
            !bestSellerCatalogQuery.isPending &&
            bestSellerCandidates.length > 0,
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        meta: publicQueryMeta(),
    });
    const pinnedBestSellerQuery = useProductsByIdsQuery({
        api,
        productIds: pinnedBestSellerIds,
        market,
        language,
    });
    const purchaseSourceIds = Array.from(
        new Set(
            (customer?.orders.items ?? []).flatMap(order =>
                order.lines.map(line => line.productVariant.product.id),
            ),
        ),
    );
    const personalizationSourceIds = Array.from(new Set([...purchaseSourceIds, ...recentProductIds]));
    const personalizationSourceQuery = useProductsByIdsQuery({
        api,
        productIds: personalizationSourceIds,
        market,
        language,
    });
    const recommendationCatalogQuery = useQuery({
        queryKey: storefrontQueryKeys.catalog(storefrontQueryKeys.market(market), vendureLanguageCode, {
            purpose: 'home-recommendations',
            sort: 'recommended',
            take: 48,
        }),
        queryFn: ({ signal }) => api.catalog({ sort: 'recommended', take: 48 }, signal),
        enabled: storefrontContextResolved && showRecommendations,
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        meta: publicQueryMeta(),
    });
    const recommendationCandidates = recommendationCatalogQuery.data?.items ?? products;
    const bestSellerProducts = buildBestSellerProducts({
        pinnedProducts: pinnedBestSellerQuery.data ?? [],
        candidates: bestSellerCandidates,
        salesByProductId: bestSellerSalesQuery.data ?? {},
        count: bestSellerDisplayCount,
        seed: `${market.code}:${new Date().toISOString().slice(0, 10)}:best-sellers`,
    });
    const recommendationProducts = buildRecommendationProducts({
        candidates: recommendationCandidates,
        sourceProducts: personalizationSourceQuery.data ?? [],
        purchaseSourceIds,
        recentProductIds,
        count: recommendationDisplayCount,
        seed: `${market.code}:${new Date().toISOString().slice(0, 10)}:recommendations`,
    });
    const currentCheckoutOrder = cart?.checkoutOrder ?? checkoutOrder;
    const customerLoadState = resolveQueryLoadState({
        hasData: customerQuery.data !== undefined,
        isLoading: customerQuery.isLoading,
        isPaused: customerQuery.isPaused,
        isError: customerQuery.isError,
    });
    const cartLoadState = resolveQueryLoadState({
        hasData: cartQuery.data !== undefined,
        isLoading: cartQuery.isLoading,
        isPaused: cartQuery.isPaused,
        isError: cartQuery.isError,
    });
    const criticalPublicQueries = [productsQuery, collectionsQuery, configQuery];
    const loading =
        rawProducts.length === 0 &&
        criticalPublicQueries.some(query => query.isLoading && query.data === undefined && !products.length);
    const publicPaused = criticalPublicQueries.some(
        query => query.isPaused && query.data === undefined && !products.length,
    );
    const publicQueryError =
        rawProducts.length === 0 && !products.length
            ? criticalPublicQueries.find(query => query.error && query.data === undefined)?.error
            : undefined;
    const error = publicPaused
        ? offlineLoadError(language)
        : publicQueryError instanceof Error
          ? publicQueryError.message
          : publicQueryError
            ? text.loadError
            : null;
    const publicLoadState: QueryLoadState = publicPaused
        ? 'paused'
        : loading
          ? 'loading'
          : error
            ? 'error'
            : 'ready';
    const contentError = error
        ? ''
        : contentQuery.isPaused && contentQuery.data === undefined
          ? offlineLoadError(language)
          : contentQuery.data !== undefined
            ? ''
            : contentQuery.error instanceof Error
              ? contentQuery.error.message
              : contentQuery.error
                ? text.loadError
                : '';
    const customerLoadError =
        customerLoadState === 'paused'
            ? offlineLoadError(language)
            : customerQuery.error instanceof Error
              ? customerQuery.error.message
              : text.loadError;
    const couponCampaignsLoading =
        customerQuery.data === undefined
            ? !customerQuery.isError
            : couponCampaignsQuery.isPending && couponCampaignsQuery.data === undefined;
    const couponCampaignsError =
        customerQuery.data === undefined && customerQuery.isError
            ? customerLoadError
            : couponCampaignsQuery.isPaused && couponCampaignsQuery.data === undefined
              ? offlineLoadError(language)
              : couponCampaignsQuery.error instanceof Error
                ? couponCampaignsQuery.error.message
                : couponCampaignsQuery.error
                  ? text.loadError
                  : '';
    const cartQueryError =
        cartLoadState === 'paused'
            ? offlineLoadError(language)
            : cartQuery.error instanceof Error
              ? cartQuery.error.message
              : cartQuery.error
                ? text.loadError
                : null;
    const setCart = useCallback(
        (nextCart: StorefrontCart) => queryClient.setQueryData(cartQueryKey, nextCart),
        [market.code, market.currencyCode, queryClient, vendureLanguageCode],
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
    const productQuery = useQuery({
        queryKey: storefrontQueryKeys.product(
            storefrontQueryKeys.market(market),
            vendureLanguageCode,
            route.id ?? '',
        ),
        queryFn: async ({ signal }) => {
            const product = await api.product(route.id ?? '', signal);
            if (!product) throw new Error(isZh ? '商品不存在或已下架' : 'Product not found');
            return product;
        },
        enabled: storefrontContextResolved && route.name === 'product' && !!route.id,
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        meta: publicQueryMeta(),
    });
    const routeProduct = productQuery.data ?? null;
    const routeProductLoading = productQuery.isLoading;
    const routeProductError =
        productQuery.isPaused && productQuery.data === undefined
            ? offlineLoadError(language)
            : productQuery.error instanceof Error
              ? productQuery.error.message
              : '';
    const orderQuery = useQuery({
        queryKey: storefrontQueryKeys.order(
            storefrontQueryKeys.market(market),
            vendureLanguageCode,
            customer?.id ?? '',
            route.id ?? '',
        ),
        queryFn: async ({ signal }) => {
            const order = await api.order(route.id ?? '', signal);
            if (!order) throw new Error(isZh ? '订单不存在或无权查看' : 'Order not found');
            return order;
        },
        enabled: customerLoadState === 'ready' && !!customer && route.name === 'order-detail' && !!route.id,
        staleTime: 0,
        refetchOnMount: 'always',
        refetchInterval: query => orderStatusRefreshInterval(query.state.data?.state),
        gcTime: PUBLIC_QUERY_GC_TIME,
    });
    const routeOrder = orderQuery.data ?? null;
    const routeOrderLoading = orderQuery.isLoading;
    const routeOrderError =
        orderQuery.isPaused && orderQuery.data === undefined
            ? offlineLoadError(language)
            : orderQuery.error instanceof Error
              ? orderQuery.error.message
              : '';

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

    const navigate = useCallback(
        (next: RouteState, replace = false) => {
            const resolvedNext = next.name === 'category' ? { ...categoryStateRef.current, ...next } : next;
            void tanstackNavigate({
                to: routePath(resolvedNext.name),
                search: routeSearch(resolvedNext),
                replace,
            } as never);
        },
        [tanstackNavigate],
    );

    const goBack = useCallback(() => {
        if (window.history.length > 1) router.history.back();
        else navigate({ name: 'home' }, true);
    }, [navigate, router.history]);

    useEffect(() => {
        if (route.name !== 'category') return;
        setActiveCollectionId(route.collectionId ?? 'all');
        setActiveChildId(route.childId ?? 'all');
        setSortMode(route.sort ?? 'recommended');
        setFulfillmentFilter(route.fulfillment ?? 'all');
        setInStockOnly(route.inStockOnly === true);
        setMinimumPrice(route.minPrice ?? '');
        setMaximumPrice(route.maxPrice ?? '');
    }, [route]);

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
                queryClient.setQueryData(
                    storefrontQueryKeys.config(storefrontQueryKeys.market(nextMarket), vendureLanguageCode),
                    config,
                );
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
    }, [configQuery.data, language, market, queryClient, vendureLanguageCode]);

    useEffect(() => {
        const root = document.documentElement;
        const colors = {
            '--brand-background': configQuery.data?.brandBackgroundColor,
            '--brand-primary': configQuery.data?.brandPrimaryColor,
            '--brand-accent': configQuery.data?.brandAccentColor,
            '--brand-highlight': configQuery.data?.brandHighlightColor,
            '--accent': configQuery.data?.brandPrimaryColor,
            '--accent-hover': configQuery.data?.brandHighlightColor,
            '--accent-ink': configQuery.data?.brandPrimaryColor,
        } as const;
        for (const [property, value] of Object.entries(colors)) {
            if (value && /^#[0-9A-F]{6}$/iu.test(value)) root.style.setProperty(property, value);
            else root.style.removeProperty(property);
        }
        return () => {
            for (const property of Object.keys(colors)) root.style.removeProperty(property);
        };
    }, [configQuery.data]);

    useEffect(() => {
        if (productsQuery.data) cacheProducts(productsQuery.data);
    }, [cacheProducts, productsQuery.data]);

    useEffect(() => {
        if (cartQuery.data !== undefined) setCheckoutOrder(cartQuery.data.checkoutOrder);
    }, [cartQuery.data]);

    const refetchStorefront = useCallback(async () => {
        await Promise.all([productsQuery.refetch(), collectionsQuery.refetch(), configQuery.refetch()]);
    }, [collectionsQuery, configQuery, productsQuery]);

    useEffect(() => {
        document.documentElement.lang = documentLanguageFor(language);
        document.documentElement.setAttribute('translate', 'yes');
    }, [language]);

    useEffect(() => {
        if (activeCollectionId === 'all' && collections.length) {
            setActiveCollectionId(collections[0].id);
            setActiveChildId(collections[0].children?.[0]?.id ?? collections[0].id);
        }
    }, [activeCollectionId, collections]);

    useEffect(() => {
        if (route.name !== 'category') return;
        setActiveCollectionId(route.collectionId ?? collections[0]?.id ?? 'all');
        setActiveChildId(route.childId ?? collections[0]?.children?.[0]?.id ?? collections[0]?.id ?? 'all');
        setSortMode(route.sort ?? 'recommended');
        setFulfillmentFilter(route.fulfillment ?? 'all');
        setInStockOnly(route.inStockOnly === true);
        setMinimumPrice(route.minPrice ?? '');
        setMaximumPrice(route.maxPrice ?? '');
    }, [collections, route]);

    const refreshCart = useCallback(async () => {
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
                const current = cart ?? (await api.cart());
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
                const current = cart ?? (await api.cart());
                let directCart = await api.addItem(variant.id, current.revision);
                let directLine = directCart.lines.find(line => line.productVariant?.id === variant.id);
                if (!directLine) {
                    throw new Error(
                        isZh ? '商品未能加入本次购买' : 'The product could not be prepared for purchase.',
                    );
                }
                const directLineId = directLine.id;

                const otherSelectedLineIds = directCart.lines
                    .filter(line => line.id !== directLineId && line.selected)
                    .map(line => line.id);
                if (otherSelectedLineIds.length) {
                    directCart = await api.setLinesSelected(otherSelectedLineIds, false, directCart.revision);
                    directLine = directCart.lines.find(line => line.id === directLineId);
                    if (!directLine) {
                        throw new Error(
                            isZh ? '商品未能加入本次购买' : 'The product could not be prepared for purchase.',
                        );
                    }
                }
                if (directLine && !directLine.selected) {
                    directCart = await api.setLinesSelected([directLine.id], true, directCart.revision);
                }

                const session = await api.beginCheckout(directCart.revision);
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
                let updated = cart ?? (await api.cart());
                for (const line of order.lines) {
                    updated = await api.addItem(line.productVariant.id, updated.revision, line.quantity);
                }
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
                await Promise.all([
                    refreshCart(),
                    queryClient.invalidateQueries({ queryKey: customerCouponQueryKey }),
                ]);
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
                await Promise.all([
                    refreshCart(),
                    queryClient.invalidateQueries({ queryKey: customerCouponQueryKey }),
                ]);
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
                await Promise.all([
                    refreshCart(),
                    queryClient.invalidateQueries({ queryKey: customerCouponQueryKey }),
                ]);
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

    useEffect(() => {
        const routeLabels: Partial<Record<RouteName, string>> = {
            category: isZh ? '商品' : 'Shop',
            services: isZh ? '商业服务' : 'Business services',
            cart: isZh ? '购物车' : 'Cart',
            account: isZh ? '我的账户' : 'Account',
            search: isZh ? '搜索商品' : 'Search products',
            purchase: isZh ? '确认购买' : 'Confirm purchase',
            checkout: isZh ? '确认订单' : 'Review order',
            payment: isZh ? '选择支付方式' : 'Choose payment',
            'order-confirmation': isZh ? '订单已提交' : 'Order confirmed',
            orders: isZh ? '我的订单' : 'My orders',
            logistics: isZh ? '物流动态' : 'Delivery updates',
            'order-detail': isZh ? '订单详情' : 'Order details',
            addresses: isZh ? '地址管理' : 'Addresses',
            'account-security': isZh ? '账户与安全' : 'Account and security',
            favorites: isZh ? '我的收藏' : 'My favorites',
            announcements: isZh ? '网站公告' : 'Website notices',
            history: isZh ? '浏览足迹' : 'Browsing history',
            notifications: isZh ? '消息通知' : 'Notifications',
            coupons: isZh ? '优惠券' : 'Coupons',
            referral: isZh ? '邀请返利' : 'Referral rewards',
            support: isZh ? '客服中心' : 'Customer support',
            reviews: isZh ? '评价中心' : 'Reviews',
            'two-factor': isZh ? '2FA 动态码' : '2FA codes',
            login: isZh ? '登录' : 'Sign in',
            register: isZh ? '注册账户' : 'Create account',
            'verify-account': isZh ? '验证邮箱' : 'Verify email',
            'forgot-password': isZh ? '忘记密码' : 'Forgot password',
            'reset-password': isZh ? '重置密码' : 'Reset password',
            legal:
                route.id === 'terms'
                    ? isZh
                        ? '使用条款'
                        : 'Terms of use'
                    : isZh
                      ? '隐私政策'
                      : 'Privacy Policy',
            'not-found': isZh ? '页面未找到' : 'Page not found',
        };
        const defaultStorefrontDescription = isZh
            ? `在${storefrontName}浏览商品、管理购物车并在线完成订单。`
            : `Browse products, manage your cart and place orders with ${storefrontName}.`;
        const storeSummary = trimText(storefrontDescription || defaultStorefrontDescription, 150);
        const productTitle = route.name === 'product' ? selectedProduct?.name : undefined;
        const routeTitle = productTitle ?? routeLabels[route.name];
        const title = routeTitle
            ? `${routeTitle} · ${storefrontName}`
            : isZh
              ? `${storefrontName} · 在线商城`
              : `${storefrontName} · Online store`;
        const description =
            route.name === 'product' && selectedProduct?.description.trim()
                ? trimText(productDescriptionText(selectedProduct.description), 150)
                : storeSummary;
        const imagePath =
            route.name === 'product' && selectedProduct
                ? (productImage(selectedProduct) ?? STOREFRONT_SOCIAL_IMAGE)
                : STOREFRONT_SOCIAL_IMAGE;
        const image = new URL(imagePath, window.location.origin).href;
        const imageAlt =
            route.name === 'product' && selectedProduct
                ? selectedProduct.name
                : isZh
                  ? `${storefrontName}精选商品`
                  : `Featured products from ${storefrontName}`;

        document.title = title;
        setMetaContent('meta[name="description"]', description);
        setMetaContent('meta[name="application-name"]', storefrontName);
        setMetaContent('meta[property="og:type"]', route.name === 'product' ? 'product' : 'website');
        setMetaContent('meta[property="og:site_name"]', storefrontName);
        setMetaContent('meta[property="og:title"]', title);
        setMetaContent('meta[property="og:description"]', description);
        setMetaContent('meta[property="og:image"]', image);
        setMetaContent('meta[property="og:image:alt"]', imageAlt);
        setMetaContent('meta[property="og:url"]', window.location.href);
        setMetaContent('meta[name="twitter:title"]', title);
        setMetaContent('meta[name="twitter:description"]', description);
        setMetaContent('meta[name="twitter:image"]', image);
        setMetaContent('meta[name="twitter:image:alt"]', imageAlt);
        let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
        if (!canonical) {
            canonical = document.createElement('link');
            canonical.rel = 'canonical';
            document.head.append(canonical);
        }
        canonical.href = window.location.href;
    }, [isZh, route, selectedProduct, storefrontDescription, storefrontName]);

    useEffect(() => {
        cacheLogoUrl(logoUrl);
        if (!logoUrl) return;
        const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
        if (link) {
            link.href = logoUrl;
            link.type = '';
        }
    }, [logoUrl]);

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

    const updateCategory = useCallback(
        (
            updates: Partial<
                Pick<
                    RouteState,
                    | 'collectionId'
                    | 'childId'
                    | 'sort'
                    | 'fulfillment'
                    | 'inStockOnly'
                    | 'minPrice'
                    | 'maxPrice'
                >
            >,
        ) => {
            const next = { ...categoryStateRef.current, ...updates };
            setActiveCollectionId(next.collectionId ?? 'all');
            setActiveChildId(next.childId ?? 'all');
            setSortMode(next.sort ?? 'recommended');
            setFulfillmentFilter(next.fulfillment ?? 'all');
            setInStockOnly(next.inStockOnly === true);
            setMinimumPrice(next.minPrice ?? '');
            setMaximumPrice(next.maxPrice ?? '');
            navigate({ name: 'category', ...next });
        },
        [navigate],
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
        cartLoading,
        cartError: cartError ?? cartQueryError,
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
