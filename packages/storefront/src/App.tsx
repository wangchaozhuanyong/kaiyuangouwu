import {
    ArrowLeft,
    ArrowUpDown,
    Bell,
    Check,
    ChevronRight,
    CircleAlert,
    CircleCheck,
    ClipboardList,
    Clock3,
    Cloud,
    Coffee,
    Download,
    Fingerprint,
    Headphones,
    Heart,
    House,
    LayoutGrid,
    MapPin,
    Minus,
    Navigation,
    Package,
    Pause,
    Play,
    Plus,
    RotateCcw,
    Search,
    Settings,
    Share2,
    ShoppingBag,
    ShoppingCart,
    SlidersHorizontal,
    Sparkles,
    Store,
    TicketPercent,
    Trash2,
    Truck,
    UserRound,
    WalletCards,
    WifiOff,
    X,
} from 'lucide-react';
import {
    Activity,
    FormEvent,
    ImgHTMLAttributes,
    lazy,
    ReactNode,
    Suspense,
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
    useTransition,
} from 'react';

import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShopApi, ShopApiError } from './api';
import { formatBusinessDate } from './business-time';
import {
    enabledMarkets,
    languageCodeFor,
    localeFor,
    marketForStorefrontConfig,
    resolveStorefrontLanguage,
    uiCopy,
} from './i18n';
import { resolveManagedLegalDocument } from './legal-content';
import { orderStatusRefreshInterval } from './order-refresh';
import {
    PUBLIC_QUERY_GC_TIME,
    PUBLIC_QUERY_STALE_TIME,
    publicQueryMeta,
    ROUTE_QUERY_STALE_TIME,
    storefrontQueryKeys,
} from './query-client';
import { responsiveImageSources, StorefrontImageKind } from './responsive-image';
import { ProductReviewsSection, ReviewCenterPage } from './review-pages';
import { PageSkeleton } from './route-loading';
import { useProductsByIdsQuery } from './route-queries';
import {
    ActiveCustomer,
    AfterSalesRequest,
    CollectionSummary,
    CreateAfterSalesRequestInput,
    CustomerAddress,
    FulfillmentType,
    MarketConfig,
    Order,
    Product,
    ProductSearchSort,
    ProductVariant,
    StorefrontCart,
    StorefrontCheckoutSession,
    StorefrontConfig,
    StorefrontContentBlock,
    StorefrontContentItem,
    StorefrontContentTargetType,
    StorefrontLanguage,
} from './types';

type MainPage = 'home' | 'category' | 'cart' | 'account';
type RouteName =
    | MainPage
    | 'product'
    | 'search'
    | 'checkout'
    | 'payment'
    | 'order-confirmation'
    | 'orders'
    | 'order-detail'
    | 'addresses'
    | 'account-security'
    | 'favorites'
    | 'history'
    | 'notifications'
    | 'coupons'
    | 'support'
    | 'reviews'
    | 'login'
    | 'register'
    | 'verify-account'
    | 'forgot-password'
    | 'reset-password'
    | 'legal'
    | 'not-found';
type OrderTab = 'all' | 'pending' | 'shipping' | 'receiving' | 'service';
type SortMode = ProductSearchSort;

const STOREFRONT_NAME_MAX_DISPLAY_UNITS = 16;
const FAVORITE_PRODUCT_STORAGE_KEY = 'storefront-favorite-product-ids';
const RECENT_PRODUCT_STORAGE_KEY = 'storefront-recent-product-ids';
const SEARCH_HISTORY_STORAGE_KEY = 'storefront-search-history';
const STOREFRONT_LANGUAGE_STORAGE_KEY = 'storefront-language';
const FAVORITE_PRODUCT_LIMIT = 100;
const RECENT_PRODUCT_LIMIT = 20;

const LazyLoginPage = lazy(() => import('./auth-pages').then(module => ({ default: module.LoginPage })));
const LazyRegisterPage = lazy(() =>
    import('./auth-pages').then(module => ({ default: module.RegisterPage })),
);
const LazyVerifyAccountPage = lazy(() =>
    import('./auth-pages').then(module => ({ default: module.VerifyAccountPage })),
);
const LazyForgotPasswordPage = lazy(() =>
    import('./auth-pages').then(module => ({ default: module.ForgotPasswordPage })),
);
const LazyResetPasswordPage = lazy(() =>
    import('./auth-pages').then(module => ({ default: module.ResetPasswordPage })),
);
const LazyOrdersPage = lazy(() => import('./order-pages').then(module => ({ default: module.OrdersPage })));
const LazyOrderDetailPage = lazy(() =>
    import('./order-pages').then(module => ({ default: module.OrderDetailPage })),
);
const LazyPaymentPage = lazy(() =>
    import('./payment-pages').then(module => ({ default: module.PaymentPage })),
);
const LazyOrderConfirmationPage = lazy(() =>
    import('./payment-pages').then(module => ({ default: module.OrderConfirmationPage })),
);
const LazyCheckoutPage = lazy(() =>
    import('./checkout-page').then(module => ({ default: module.CheckoutPage })),
);
const LazyAccountSecurityPage = lazy(() =>
    import('./account-security-page').then(module => ({ default: module.AccountSecurityPage })),
);
const LazyAddressesPage = lazy(() =>
    import('./addresses-page').then(module => ({ default: module.AddressesPage })),
);

function sortCategoryProducts(
    products: Product[],
    sortMode: SortMode,
    locale: string,
    salesByProductId: Record<string, number> = {},
): Product[] {
    return [...products].sort((first, second) => {
        if (sortMode === 'sales') {
            const salesDifference = (salesByProductId[second.id] ?? 0) - (salesByProductId[first.id] ?? 0);
            if (salesDifference !== 0) return salesDifference;
            return Date.parse(second.createdAt) - Date.parse(first.createdAt);
        }
        if (sortMode === 'newest') return Date.parse(second.createdAt) - Date.parse(first.createdAt);
        if (sortMode === 'name') return first.name.localeCompare(second.name, locale);
        if (sortMode === 'price-asc') return minimumPrice(first) - minimumPrice(second);
        if (sortMode === 'price-desc') return minimumPrice(second) - minimumPrice(first);
        return 0;
    });
}

function storefrontNameDisplayUnits(value: string): number {
    return Array.from(value).reduce((total, character) => {
        const isWideCharacter = /[\p{Script=Han}\uFF01-\uFF60]/u.test(character);
        return total + (isWideCharacter ? 2 : 1);
    }, 0);
}

function normalizeStorefrontName(value: string | null | undefined, fallback: string): string {
    const normalized = value?.trim() ?? '';
    if (!normalized || storefrontNameDisplayUnits(normalized) > STOREFRONT_NAME_MAX_DISPLAY_UNITS) {
        return fallback;
    }
    return normalized;
}

function scopedStorageKey(baseKey: string, channelCode: string): string {
    return channelCode ? `${baseKey}:${channelCode}` : '';
}

function readStoredLanguage(market: MarketConfig, includeLegacyPreference = false): StorefrontLanguage {
    try {
        const scopedPreference = localStorage.getItem(
            scopedStorageKey(STOREFRONT_LANGUAGE_STORAGE_KEY, market.code),
        );
        const legacyPreference =
            includeLegacyPreference && scopedPreference === null
                ? localStorage.getItem(STOREFRONT_LANGUAGE_STORAGE_KEY)
                : null;
        return resolveStorefrontLanguage(market, scopedPreference ?? legacyPreference);
    } catch {
        return resolveStorefrontLanguage(market, null);
    }
}

function readStoredStrings(storageKey: string, limit: number): string[] {
    if (!storageKey) return [];
    try {
        const value = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
        return Array.isArray(value)
            ? value.filter((item): item is string => typeof item === 'string').slice(0, limit)
            : [];
    } catch {
        return [];
    }
}

function setMetaContent(selector: string, content: string): void {
    document.querySelector<HTMLMetaElement>(selector)?.setAttribute('content', content);
}

const DEFAULT_STOREFRONT_NAMES: Record<StorefrontLanguage, string> = {
    zh: '云桥Ai',
    en: 'Yunqiao Ai',
};

interface RouteState {
    name: RouteName;
    id?: string;
    tab?: OrderTab;
    token?: string;
    term?: string;
    collectionId?: string;
    childId?: string;
    sort?: SortMode;
    fulfillment?: 'all' | FulfillmentType;
    inStockOnly?: boolean;
    minPrice?: string;
    maxPrice?: string;
}

const rootPages: MainPage[] = ['home', 'category', 'cart', 'account'];
const orderTabs: OrderTab[] = ['all', 'pending', 'shipping', 'receiving', 'service'];

function routeFromLocation(): RouteState {
    return routeFromHash(window.location.hash);
}

export function routeFromHash(hash: string): RouteState {
    const raw = hash.replace(/^#\/?/, '');
    const [rawPath = 'home', query = ''] = raw.split('?');
    const path = rawPath.replace(/^\/+|\/+$/g, '') || 'home';
    const name = path as RouteName;
    const params = new URLSearchParams(query);
    const validNames: RouteName[] = [
        'home',
        'category',
        'cart',
        'account',
        'product',
        'search',
        'checkout',
        'payment',
        'order-confirmation',
        'orders',
        'order-detail',
        'addresses',
        'account-security',
        'favorites',
        'history',
        'notifications',
        'coupons',
        'support',
        'reviews',
        'login',
        'register',
        'verify-account',
        'forgot-password',
        'reset-password',
        'legal',
    ];
    const tab = params.get('tab');
    const sort = params.get('sort');
    const fulfillment = params.get('fulfillment');
    return {
        name: validNames.includes(name) ? name : 'not-found',
        id: params.get('id') ?? undefined,
        tab: orderTabs.includes(tab as OrderTab) ? (tab as OrderTab) : undefined,
        token: params.get('token') ?? undefined,
        term: params.get('term') ?? undefined,
        collectionId: params.get('collection') ?? undefined,
        childId: params.get('child') ?? undefined,
        sort: ['recommended', 'sales', 'newest', 'name', 'price-asc', 'price-desc'].includes(sort ?? '')
            ? (sort as SortMode)
            : undefined,
        fulfillment: ['all', 'physical', 'digital'].includes(fulfillment ?? '')
            ? (fulfillment as 'all' | FulfillmentType)
            : undefined,
        inStockOnly: params.get('stock') === '1' || undefined,
        minPrice: params.get('minPrice') ?? undefined,
        maxPrice: params.get('maxPrice') ?? undefined,
    };
}

function routeHash(route: RouteState): string {
    const params = new URLSearchParams();
    if (route.id) params.set('id', route.id);
    if (route.tab) params.set('tab', route.tab);
    if (route.token) params.set('token', route.token);
    if (route.term) params.set('term', route.term);
    if (route.collectionId) params.set('collection', route.collectionId);
    if (route.childId) params.set('child', route.childId);
    if (route.sort && route.sort !== 'recommended') params.set('sort', route.sort);
    if (route.fulfillment && route.fulfillment !== 'all') params.set('fulfillment', route.fulfillment);
    if (route.inStockOnly) params.set('stock', '1');
    if (route.minPrice) params.set('minPrice', route.minPrice);
    if (route.maxPrice) params.set('maxPrice', route.maxPrice);
    return `#/${route.name}${params.size ? `?${params.toString()}` : ''}`;
}

function scrollStorageKey(marketCode: string, route: RouteState): string {
    return `vendure-storefront-scroll:${marketCode}:${routeHash(route)}`;
}

function saveScrollPosition(marketCode: string, route: RouteState, scrollTop: number): void {
    try {
        sessionStorage.setItem(scrollStorageKey(marketCode, route), String(Math.max(0, scrollTop)));
    } catch {
        // Scroll restoration remains available in memory when storage is unavailable.
    }
}

function readScrollPosition(marketCode: string, route: RouteState): number {
    try {
        const value = Number(sessionStorage.getItem(scrollStorageKey(marketCode, route)) ?? 0);
        return Number.isFinite(value) && value >= 0 ? value : 0;
    } catch {
        return 0;
    }
}

function priceInputToMinorUnits(value: string): number | undefined {
    if (!value.trim()) return;
    const amount = Number(value);
    return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : undefined;
}

export function App() {
    const queryClient = useQueryClient();
    const [isNavigationPending, startNavigationTransition] = useTransition();
    const [{ market, language }, setStorefrontContext] = useState<{
        market: MarketConfig;
        language: StorefrontLanguage;
    }>(() => {
        const initialMarket = enabledMarkets[0];
        return {
            market: initialMarket,
            language: readStoredLanguage(initialMarket, true),
        };
    });
    const [route, setRoute] = useState<RouteState>(routeFromLocation);
    const [products, setProducts] = useState<Product[]>([]);
    const [favoriteProductIds, setFavoriteProductIds] = useState<string[]>([]);
    const [recentProductIds, setRecentProductIds] = useState<string[]>([]);
    const [collections, setCollections] = useState<CollectionSummary[]>([]);
    const [contentBlocks, setContentBlocks] = useState<StorefrontContentBlock[]>([]);
    const [contentError, setContentError] = useState('');
    const [storefrontNames, setStorefrontNames] =
        useState<Record<StorefrontLanguage, string>>(DEFAULT_STOREFRONT_NAMES);
    const [storefrontCode, setStorefrontCode] = useState('');
    const [availableCountries, setAvailableCountries] = useState<StorefrontConfig['availableCountries']>([]);
    const [cart, setCart] = useState<StorefrontCart | null>(null);
    const [customer, setCustomer] = useState<ActiveCustomer | null>(null);
    const [checkoutOrder, setCheckoutOrder] = useState<Order | null>(null);
    const [completedOrder, setCompletedOrder] = useState<Order | null>(null);
    const [loading, setLoading] = useState(true);
    const [sessionLoading, setSessionLoading] = useState(true);
    const [cartLoading, setCartLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [cartError, setCartError] = useState<string | null>(null);
    const [addingVariantId, setAddingVariantId] = useState<string | null>(null);
    const [toast, setToast] = useState<string | null>(null);
    const [online, setOnline] = useState(navigator.onLine);
    const [activeCollectionId, setActiveCollectionId] = useState(
        () => routeFromLocation().collectionId ?? 'all',
    );
    const [activeChildId, setActiveChildId] = useState(() => routeFromLocation().childId ?? 'all');
    const [sortMode, setSortMode] = useState<SortMode>(() => routeFromLocation().sort ?? 'recommended');
    const [fulfillmentFilter, setFulfillmentFilter] = useState<'all' | FulfillmentType>(
        () => routeFromLocation().fulfillment ?? 'all',
    );
    const [inStockOnly, setInStockOnly] = useState(() => routeFromLocation().inStockOnly === true);
    const [minimumPrice, setMinimumPrice] = useState(() => routeFromLocation().minPrice ?? '');
    const [maximumPrice, setMaximumPrice] = useState(() => routeFromLocation().maxPrice ?? '');
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
    const storefrontLoadId = useRef(0);
    const routeRef = useRef(route);
    const mainPageScrollPositions = useRef<Partial<Record<MainPage, number>>>({});
    const restoredInitialScroll = useRef(false);

    const locale = localeFor(language, market);
    const text = uiCopy[language];
    const isZh = language === 'zh';
    const storefrontName = storefrontNames[language];
    const vendureLanguageCode = languageCodeFor(language);
    const api = useMemo(() => new ShopApi(market, vendureLanguageCode), [market, vendureLanguageCode]);
    const clearPrivateQueryCache = useCallback(() => {
        queryClient.removeQueries({
            queryKey: storefrontQueryKeys.privateScope(market.code, vendureLanguageCode),
        });
    }, [market.code, queryClient, vendureLanguageCode]);
    const invalidateCustomerRouteQueries = useCallback(async () => {
        if (!customer) return;
        await queryClient.invalidateQueries({
            queryKey: storefrontQueryKeys.customerScope(market.code, vendureLanguageCode, customer.id),
            refetchType: 'none',
        });
    }, [customer, market.code, queryClient, vendureLanguageCode]);
    const productQuery = useQuery({
        queryKey: storefrontQueryKeys.product(market.code, vendureLanguageCode, route.id ?? ''),
        queryFn: async ({ signal }) => {
            const product = await api.product(route.id ?? '', signal);
            if (!product) throw new Error(isZh ? '商品不存在或已下架' : 'Product not found');
            return product;
        },
        enabled: route.name === 'product' && !!route.id,
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        meta: publicQueryMeta(),
    });
    const routeProduct = productQuery.data ?? null;
    const routeProductLoading = productQuery.isPending && productQuery.fetchStatus === 'fetching';
    const routeProductError = productQuery.error instanceof Error ? productQuery.error.message : '';
    const orderQuery = useQuery({
        queryKey: storefrontQueryKeys.order(
            market.code,
            vendureLanguageCode,
            customer?.id ?? 'guest',
            route.id ?? '',
        ),
        queryFn: async ({ signal }) => {
            const order = await api.order(route.id ?? '', signal);
            if (!order) throw new Error(isZh ? '订单不存在或无权查看' : 'Order not found');
            return order;
        },
        enabled: route.name === 'order-detail' && !!route.id,
        staleTime: 0,
        refetchOnMount: 'always',
        refetchInterval: query => orderStatusRefreshInterval((query.state.data as Order | undefined)?.state),
        gcTime: PUBLIC_QUERY_GC_TIME,
    });
    const routeOrder = orderQuery.data ?? null;
    const routeOrderLoading = orderQuery.isPending && orderQuery.fetchStatus === 'fetching';
    const routeOrderError = orderQuery.error instanceof Error ? orderQuery.error.message : '';

    const cacheProducts = useCallback(
        (items: Product[]) => {
            for (const product of items) {
                const queryKey = storefrontQueryKeys.product(market.code, vendureLanguageCode, product.id);
                queryClient.setQueryData(queryKey, product);
                void queryClient.prefetchQuery({
                    queryKey,
                    queryFn: async () => product,
                    staleTime: PUBLIC_QUERY_STALE_TIME,
                    meta: publicQueryMeta(),
                });
            }
        },
        [market.code, queryClient, vendureLanguageCode],
    );

    const notify = useCallback((message: string) => {
        setToast(message);
        if (toastTimer.current) window.clearTimeout(toastTimer.current);
        toastTimer.current = window.setTimeout(() => setToast(null), 2400);
    }, []);

    const navigate = useCallback(
        (next: RouteState, replace = false) => {
            const resolvedNext = next.name === 'category' ? { ...categoryStateRef.current, ...next } : next;
            const currentRoute = routeRef.current;
            if (rootPages.includes(currentRoute.name as MainPage)) {
                mainPageScrollPositions.current[currentRoute.name as MainPage] = window.scrollY;
            }
            saveScrollPosition(market.code, currentRoute, window.scrollY);
            const hash = routeHash(resolvedNext);
            if (replace) window.history.replaceState(resolvedNext, '', hash);
            else window.history.pushState(resolvedNext, '', hash);
            routeRef.current = resolvedNext;
            startNavigationTransition(() => setRoute(resolvedNext));
            const nextScrollTop = rootPages.includes(resolvedNext.name as MainPage)
                ? (mainPageScrollPositions.current[resolvedNext.name as MainPage] ??
                  readScrollPosition(market.code, resolvedNext))
                : readScrollPosition(market.code, resolvedNext);
            window.requestAnimationFrame(() => window.scrollTo({ top: nextScrollTop, behavior: 'instant' }));
        },
        [market.code, startNavigationTransition],
    );

    const goBack = useCallback(() => {
        if (window.history.length > 1) window.history.back();
        else navigate({ name: 'home' }, true);
    }, [navigate]);

    useEffect(() => {
        if (!window.location.hash) navigate({ name: 'home' }, true);
        const onPopState = () => {
            const currentRoute = routeRef.current;
            if (rootPages.includes(currentRoute.name as MainPage)) {
                mainPageScrollPositions.current[currentRoute.name as MainPage] = window.scrollY;
            }
            saveScrollPosition(market.code, currentRoute, window.scrollY);
            const nextRoute = routeFromLocation();
            routeRef.current = nextRoute;
            startNavigationTransition(() => setRoute(nextRoute));
            const nextScrollTop = rootPages.includes(nextRoute.name as MainPage)
                ? (mainPageScrollPositions.current[nextRoute.name as MainPage] ??
                  readScrollPosition(market.code, nextRoute))
                : readScrollPosition(market.code, nextRoute);
            window.requestAnimationFrame(() => window.scrollTo({ top: nextScrollTop, behavior: 'instant' }));
        };
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, [market.code, navigate, startNavigationTransition]);

    useEffect(() => {
        if (!restoredInitialScroll.current) {
            restoredInitialScroll.current = true;
            window.requestAnimationFrame(() =>
                window.scrollTo({
                    top: readScrollPosition(market.code, routeRef.current),
                    behavior: 'instant',
                }),
            );
        }
        const saveCurrentScroll = () => saveScrollPosition(market.code, routeRef.current, window.scrollY);
        window.addEventListener('pagehide', saveCurrentScroll);
        return () => window.removeEventListener('pagehide', saveCurrentScroll);
    }, [market.code]);

    useEffect(() => {
        const setConnected = () => setOnline(navigator.onLine);
        window.addEventListener('online', setConnected);
        window.addEventListener('offline', setConnected);
        return () => {
            window.removeEventListener('online', setConnected);
            window.removeEventListener('offline', setConnected);
        };
    }, []);

    const loadSession = useCallback(
        async (loadId: number) => {
            setSessionLoading(true);
            setCartError(null);
            const [cartResult, customerResult] = await Promise.allSettled([
                queryClient.fetchQuery({
                    queryKey: storefrontQueryKeys.cart(market.code, vendureLanguageCode),
                    queryFn: ({ signal }) => api.cart(signal),
                    staleTime: 0,
                }),
                queryClient.fetchQuery({
                    queryKey: storefrontQueryKeys.customer(market.code, vendureLanguageCode),
                    queryFn: ({ signal }) => api.activeCustomer(signal),
                    staleTime: 0,
                }),
            ]);
            if (storefrontLoadId.current !== loadId) return;

            if (cartResult.status === 'fulfilled') {
                setCart(cartResult.value);
                setCheckoutOrder(cartResult.value.checkoutOrder);
            } else {
                setCartError(cartResult.reason instanceof Error ? cartResult.reason.message : text.loadError);
            }
            if (customerResult.status === 'fulfilled') setCustomer(customerResult.value);
            setSessionLoading(false);
        },
        [api, market.code, queryClient, text.loadError, vendureLanguageCode],
    );

    const loadStorefront = useCallback(async () => {
        const loadId = ++storefrontLoadId.current;
        setLoading(true);
        setError(null);
        setContentError('');
        const [productResult, collectionResult, configResult, contentResult] = await Promise.allSettled([
            queryClient.fetchQuery({
                queryKey: storefrontQueryKeys.products(market.code, vendureLanguageCode, 16),
                queryFn: ({ signal }) => api.products(16, signal),
                staleTime: PUBLIC_QUERY_STALE_TIME,
                meta: publicQueryMeta(),
            }),
            queryClient.fetchQuery({
                queryKey: storefrontQueryKeys.collections(market.code, vendureLanguageCode),
                queryFn: ({ signal }) => api.collections(signal),
                staleTime: PUBLIC_QUERY_STALE_TIME,
                meta: publicQueryMeta(),
            }),
            queryClient.fetchQuery({
                queryKey: storefrontQueryKeys.config(market.code, vendureLanguageCode),
                queryFn: ({ signal }) => api.storefrontConfig(signal),
                staleTime: PUBLIC_QUERY_STALE_TIME,
                meta: publicQueryMeta(),
            }),
            queryClient.fetchQuery({
                queryKey: storefrontQueryKeys.content(market.code, vendureLanguageCode),
                queryFn: ({ signal }) => api.storefrontContent(signal),
                staleTime: PUBLIC_QUERY_STALE_TIME,
                meta: publicQueryMeta(),
            }),
        ]);
        if (storefrontLoadId.current !== loadId) return;

        if (configResult.status === 'fulfilled') {
            const nextStorefrontCode = configResult.value.code;
            const nextMarket = marketForStorefrontConfig(configResult.value, market);
            setAvailableCountries(configResult.value.availableCountries);
            if (
                nextMarket.code !== market.code ||
                nextMarket.defaultLanguageCode !== market.defaultLanguageCode ||
                nextMarket.currencyCode !== market.currencyCode ||
                nextMarket.countryCode !== market.countryCode
            ) {
                setStorefrontContext({
                    market: nextMarket,
                    language: readStoredLanguage(nextMarket),
                });
                return;
            }
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
                zh: normalizeStorefrontName(
                    configResult.value.customFields.storefrontNameZh,
                    DEFAULT_STOREFRONT_NAMES.zh,
                ),
                en: normalizeStorefrontName(
                    configResult.value.customFields.storefrontNameEn,
                    DEFAULT_STOREFRONT_NAMES.en,
                ),
            });
        }
        if (productResult.status === 'fulfilled') {
            setProducts(productResult.value);
            cacheProducts(productResult.value);
        } else
            setError(productResult.reason instanceof Error ? productResult.reason.message : text.loadError);
        if (collectionResult.status === 'fulfilled') setCollections(collectionResult.value);
        if (contentResult.status === 'fulfilled') setContentBlocks(contentResult.value);
        else {
            setContentBlocks([]);
            setContentError(
                contentResult.reason instanceof Error ? contentResult.reason.message : text.loadError,
            );
        }
        setLoading(false);
        void loadSession(loadId);
    }, [api, cacheProducts, loadSession, market, queryClient, text.loadError, vendureLanguageCode]);

    useEffect(() => {
        localStorage.setItem(scopedStorageKey(STOREFRONT_LANGUAGE_STORAGE_KEY, market.code), language);
        document.documentElement.lang = locale;
        void loadStorefront();
    }, [language, loadStorefront, locale, market.code]);

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

    useEffect(() => {
        if (cart) {
            queryClient.setQueryData(storefrontQueryKeys.cart(market.code, vendureLanguageCode), cart);
        }
    }, [cart, market.code, queryClient, vendureLanguageCode]);

    useEffect(() => {
        queryClient.setQueryData(storefrontQueryKeys.customer(market.code, vendureLanguageCode), customer);
    }, [customer, market.code, queryClient, vendureLanguageCode]);

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
        async (variant: ProductVariant, openCart = false) => {
            setAddingVariantId(variant.id);
            const updated = await mutateCart(revision => api.addItem(variant.id, revision));
            setAddingVariantId(null);
            if (updated) {
                notify(isZh ? '已加入购物车' : 'Added to cart');
                if (openCart) navigate({ name: 'cart' });
            }
            return updated;
        },
        [api, isZh, mutateCart, navigate, notify],
    );

    const addOrderToCart = useCallback(
        async (order: Order) => {
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
                setActiveCollectionId(value);
                setActiveChildId(value);
                navigate({ name: 'category', collectionId: value, childId: value });
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
                if (/^(mailto:|tel:)/i.test(value)) {
                    window.location.assign(value);
                } else if (/^https?:\/\//i.test(value)) {
                    window.open(value, '_blank', 'noopener,noreferrer');
                } else {
                    navigate({ name: 'account' });
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
        [navigate],
    );

    const applyCoupon = useCallback(
        async (couponCode: string): Promise<string | null> => {
            setCartLoading(true);
            setCartError(null);
            try {
                await api.applyCouponCode(couponCode);
                await refreshCart();
                notify(isZh ? '优惠码已应用' : 'Coupon applied');
                return null;
            } catch (requestError) {
                return requestError instanceof Error ? requestError.message : text.loadError;
            } finally {
                setCartLoading(false);
            }
        },
        [api, isZh, notify, refreshCart, text.loadError],
    );

    const removeCoupon = useCallback(
        async (couponCode: string): Promise<string | null> => {
            setCartLoading(true);
            setCartError(null);
            try {
                await api.removeCouponCode(couponCode);
                await refreshCart();
                notify(isZh ? '优惠码已移除' : 'Coupon removed');
                return null;
            } catch (requestError) {
                return requestError instanceof Error ? requestError.message : text.loadError;
            } finally {
                setCartLoading(false);
            }
        },
        [api, isZh, notify, refreshCart, text.loadError],
    );

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
                    market.code,
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
                        market.code,
                        vendureLanguageCode,
                        customer.id,
                    ),
                    refetchType: 'none',
                });
            }
            notify(isZh ? '售后申请已提交' : 'After-sales request submitted');
            navigate({ name: 'orders', tab: 'service' });
        },
        [api, customer, isZh, market.code, navigate, notify, queryClient, vendureLanguageCode],
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
    const selectedOrder = route.id
        ? (customer?.orders.items.find(order => order.id === route.id) ??
          (routeOrder?.id === route.id ? routeOrder : null))
        : null;
    const legalContent = contentBlocks.find(block => block.type === 'LEGAL');
    const supportContent = contentBlocks.find(block => block.type === 'SUPPORT');

    useEffect(() => {
        const routeLabels: Partial<Record<RouteName, string>> = {
            category: isZh ? '商品' : 'Shop',
            cart: isZh ? '购物车' : 'Cart',
            account: isZh ? '我的账户' : 'Account',
            search: isZh ? '搜索商品' : 'Search products',
            checkout: isZh ? '确认订单' : 'Review order',
            payment: isZh ? '选择支付方式' : 'Choose payment',
            'order-confirmation': isZh ? '订单已提交' : 'Order confirmed',
            orders: isZh ? '我的订单' : 'My orders',
            'order-detail': isZh ? '订单详情' : 'Order details',
            addresses: isZh ? '地址管理' : 'Addresses',
            'account-security': isZh ? '账户与安全' : 'Account and security',
            favorites: isZh ? '我的收藏' : 'My favorites',
            history: isZh ? '浏览足迹' : 'Browsing history',
            notifications: isZh ? '消息通知' : 'Notifications',
            coupons: isZh ? '优惠券' : 'Coupons',
            support: isZh ? '客服中心' : 'Customer support',
            reviews: isZh ? '评价中心' : 'Reviews',
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
                      ? '隐私说明'
                      : 'Privacy notice',
            'not-found': isZh ? '页面未找到' : 'Page not found',
        };
        const storefrontDescription = isZh
            ? `在${storefrontName}浏览商品、管理购物车并在线完成订单。`
            : `Browse products, manage your cart and place orders with ${storefrontName}.`;
        const productTitle = route.name === 'product' ? selectedProduct?.name : undefined;
        const routeTitle = productTitle ?? routeLabels[route.name];
        const title = routeTitle
            ? `${routeTitle} · ${storefrontName}`
            : isZh
              ? `${storefrontName} · 在线商城`
              : `${storefrontName} · Online store`;
        const description =
            route.name === 'product' && selectedProduct?.description.trim()
                ? trimText(selectedProduct.description.trim(), 150)
                : storefrontDescription;
        const imagePath =
            route.name === 'product' && selectedProduct
                ? (productImage(selectedProduct) ?? '/storefront/default-hero.jpg')
                : '/storefront/default-hero.jpg';
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
    }, [isZh, route, selectedProduct, storefrontName]);

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

    const mainPage: MainPage = rootPages.includes(route.name as MainPage)
        ? (route.name as MainPage)
        : route.name === 'product' || route.name === 'search'
          ? 'category'
          : route.name === 'checkout' || route.name === 'payment'
            ? 'cart'
            : 'account';

    const toggleLanguage = () =>
        setStorefrontContext(currentContext => ({
            ...currentContext,
            language: currentContext.language === 'zh' ? 'en' : 'zh',
        }));

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

    const renderPage = (route: RouteState) => {
        switch (route.name) {
            case 'home':
                return (
                    <HomePage
                        products={products}
                        collections={collections}
                        contentBlocks={contentBlocks}
                        contentError={contentError}
                        loading={loading}
                        error={error}
                        market={market}
                        locale={locale}
                        language={language}
                        storefrontName={storefrontName}
                        addingVariantId={addingVariantId}
                        onNavigate={navigate}
                        onCategorySelect={collection => {
                            setActiveCollectionId(collection.id);
                            setActiveChildId(collection.children?.[0]?.id ?? collection.id);
                            navigate({
                                name: 'category',
                                collectionId: collection.id,
                                childId: collection.children?.[0]?.id ?? collection.id,
                            });
                        }}
                        onAdd={variant => void addToCart(variant)}
                        onToggleLanguage={toggleLanguage}
                        onNotifications={() => navigate({ name: 'notifications' })}
                        onContentTarget={openContentTarget}
                        onRetry={() => void loadStorefront()}
                    />
                );
            case 'category':
                return (
                    <CategoryPage
                        api={api}
                        products={products}
                        collections={collections}
                        loading={loading}
                        error={error}
                        market={market}
                        locale={locale}
                        language={language}
                        activeCollectionId={activeCollectionId}
                        activeChildId={activeChildId}
                        sortMode={sortMode}
                        fulfillmentFilter={fulfillmentFilter}
                        inStockOnly={inStockOnly}
                        minimumPrice={minimumPrice}
                        maximumPrice={maximumPrice}
                        addingVariantId={addingVariantId}
                        onCollectionChange={(collectionId, childId) => {
                            updateCategory({ collectionId, childId });
                        }}
                        onChildChange={childId => updateCategory({ childId })}
                        onSortChange={sort => updateCategory({ sort })}
                        onFilterChange={(type, inStock, nextMinimumPrice, nextMaximumPrice) =>
                            updateCategory({
                                fulfillment: type,
                                inStockOnly: inStock,
                                minPrice: nextMinimumPrice || undefined,
                                maxPrice: nextMaximumPrice || undefined,
                            })
                        }
                        onNavigate={navigate}
                        onAdd={variant => void addToCart(variant)}
                        onNotify={() => navigate({ name: 'notifications' })}
                        onRetry={() => void loadStorefront()}
                    />
                );
            case 'cart':
                return (
                    <CartPage
                        cart={cart}
                        customer={customer}
                        products={products}
                        market={market}
                        locale={locale}
                        language={language}
                        loading={cartLoading || sessionLoading}
                        error={cartError}
                        addingVariantId={addingVariantId}
                        onToggleAll={() =>
                            void mutateCart(revision =>
                                api.setAllLinesSelected(cart?.selectionState !== 'ALL', revision),
                            )
                        }
                        onSelect={(lineId, selected) =>
                            void mutateCart(revision => api.setLinesSelected([lineId], selected, revision))
                        }
                        onSelectGroup={(lineIds, selected) =>
                            void mutateCart(revision => api.setLinesSelected(lineIds, selected, revision))
                        }
                        onQuantity={(lineId, quantity) =>
                            void mutateCart(revision => api.setLineQuantity(lineId, quantity, revision))
                        }
                        onRemove={lineId => void mutateCart(revision => api.removeLines([lineId], revision))}
                        onCheckout={() => void beginCheckout()}
                        onReopen={() => cart?.checkoutOrder && void reopenPendingOrder(cart.checkoutOrder)}
                        onNavigate={navigate}
                        onAdd={variant => void addToCart(variant)}
                        onRetry={() => void refreshCart()}
                        onApplyCoupon={applyCoupon}
                        onRemoveCoupon={removeCoupon}
                    />
                );
            case 'account':
                return (
                    <AccountPage
                        api={api}
                        customer={customer}
                        products={products}
                        market={market}
                        locale={locale}
                        language={language}
                        storefrontName={storefrontName}
                        favoriteProductCount={favoriteProductIds.length}
                        recentProductCount={recentProductIds.length}
                        couponCount={cart?.checkoutOrder?.couponCodes.length ?? 0}
                        addingVariantId={addingVariantId}
                        onNavigate={navigate}
                        onAdd={variant => void addToCart(variant)}
                        onLogout={() => {
                            void api.logout().then(() => {
                                clearPrivateQueryCache();
                                setCustomer(null);
                                notify(isZh ? '已退出登录' : 'Signed out');
                            });
                        }}
                    />
                );
            case 'product':
                return routeProductLoading || (route.id && !selectedProduct && !routeProductError) ? (
                    <Subpage title={isZh ? '商品详情' : 'Product'} language={language} onBack={goBack}>
                        <PageSkeleton />
                    </Subpage>
                ) : selectedProduct ? (
                    <ProductDetailPage
                        key={selectedProduct.id}
                        api={api}
                        product={selectedProduct}
                        products={products}
                        cartQuantity={cart?.totalQuantity ?? 0}
                        market={market}
                        locale={locale}
                        language={language}
                        storefrontName={storefrontName}
                        addingVariantId={addingVariantId}
                        favorite={favoriteProductIds.includes(selectedProduct.id)}
                        onBack={goBack}
                        onNavigate={navigate}
                        onAdd={(variant, buyNow) => void addToCart(variant, buyNow)}
                        onFavorite={() => toggleFavoriteProduct(selectedProduct.id)}
                        onNotify={notify}
                    />
                ) : (
                    <Subpage title={isZh ? '商品详情' : 'Product'} language={language} onBack={goBack}>
                        <EmptyState
                            icon={<ShoppingBag />}
                            title={text.noResults}
                            detail={routeProductError || text.noResultsHint}
                            action={routeProductError ? (isZh ? '重试' : 'Retry') : text.browse}
                            onAction={() =>
                                routeProductError
                                    ? void productQuery.refetch()
                                    : navigate({ name: 'category' })
                            }
                        />
                    </Subpage>
                );
            case 'search':
                return (
                    <SearchPage
                        api={api}
                        products={products}
                        market={market}
                        locale={locale}
                        language={language}
                        storefrontCode={storefrontCode}
                        initialQuery={route.term ?? ''}
                        addingVariantId={addingVariantId}
                        onBack={goBack}
                        onNavigate={navigate}
                        onAdd={variant => void addToCart(variant)}
                    />
                );
            case 'checkout':
                return (
                    <AuthPageBoundary language={language} onBack={goBack}>
                        <LazyCheckoutPage
                            api={api}
                            cart={cart}
                            order={checkoutOrder}
                            customer={customer}
                            market={market}
                            availableCountries={availableCountries}
                            locale={locale}
                            language={language}
                            onBack={goBack}
                            onSessionChange={(session: StorefrontCheckoutSession) => {
                                setCart(session.cart);
                                setCheckoutOrder(session.order);
                            }}
                            onCartChange={nextCart => {
                                setCart(nextCart);
                                setCheckoutOrder(nextCart.checkoutOrder);
                            }}
                            onNavigate={navigate}
                            onNotify={notify}
                            onApplyCoupon={applyCoupon}
                            onRemoveCoupon={removeCoupon}
                        />
                    </AuthPageBoundary>
                );
            case 'payment':
                return (
                    <AuthPageBoundary language={language} onBack={goBack}>
                        <LazyPaymentPage
                            api={api}
                            cart={cart}
                            order={checkoutOrder}
                            market={market}
                            locale={locale}
                            language={language}
                            onCancel={order => void reopenPendingOrder(order)}
                            onComplete={async (order, confirmationToken) => {
                                setCompletedOrder(order);
                                setCheckoutOrder(order);
                                await invalidateCustomerRouteQueries();
                                notify(
                                    import.meta.env.DEV
                                        ? isZh
                                            ? '测试支付已完成'
                                            : 'Test payment completed'
                                        : isZh
                                          ? '支付状态已更新'
                                          : 'Payment status updated',
                                );
                                try {
                                    setCart(await api.cart());
                                } catch {
                                    // Payment succeeded; cart refresh can recover on the next page load.
                                }
                                navigate(
                                    {
                                        name: 'order-confirmation',
                                        id: order.code,
                                        token: confirmationToken,
                                    },
                                    true,
                                );
                            }}
                            onNavigate={navigate}
                        />
                    </AuthPageBoundary>
                );
            case 'order-confirmation':
                return (
                    <AuthPageBoundary language={language} onBack={goBack}>
                        <LazyOrderConfirmationPage
                            api={api}
                            code={route.id ?? ''}
                            confirmationToken={route.token ?? ''}
                            initialOrder={completedOrder}
                            customer={customer}
                            market={market}
                            locale={locale}
                            language={language}
                            onNavigate={navigate}
                        />
                    </AuthPageBoundary>
                );
            case 'orders':
                return (
                    <AuthPageBoundary language={language} onBack={goBack}>
                        <LazyOrdersPage
                            api={api}
                            customer={customer}
                            market={market}
                            locale={locale}
                            language={language}
                            storefrontName={storefrontName}
                            initialTab={route.tab ?? 'all'}
                            onBack={goBack}
                            onNavigate={navigate}
                            onBuyAgain={addOrderToCart}
                            onNotify={notify}
                        />
                    </AuthPageBoundary>
                );
            case 'order-detail':
                return routeOrderLoading || (route.id && !selectedOrder && !routeOrderError) ? (
                    <Subpage title={isZh ? '订单详情' : 'Order details'} language={language} onBack={goBack}>
                        <PageSkeleton />
                    </Subpage>
                ) : selectedOrder ? (
                    <AuthPageBoundary language={language} onBack={goBack}>
                        <LazyOrderDetailPage
                            order={selectedOrder}
                            market={market}
                            locale={locale}
                            language={language}
                            storefrontName={storefrontName}
                            onBack={goBack}
                            onBuyAgain={addOrderToCart}
                            onReopen={reopenPendingOrder}
                            onCancelOrder={cancelAuthorizedOrder}
                            onCreateAfterSales={createAfterSalesRequest}
                            onUnavailable={() => notify(text.unavailable)}
                        />
                    </AuthPageBoundary>
                ) : (
                    <Subpage title={isZh ? '订单详情' : 'Order details'} language={language} onBack={goBack}>
                        <EmptyState
                            icon={<Package />}
                            title={isZh ? '没有找到订单' : 'Order not found'}
                            detail={routeOrderError}
                            action={routeOrderError ? (isZh ? '重试' : 'Retry') : undefined}
                            onAction={routeOrderError ? () => void orderQuery.refetch() : undefined}
                        />
                    </Subpage>
                );
            case 'addresses':
                return (
                    <AuthPageBoundary language={language} onBack={goBack}>
                        <LazyAddressesPage
                            api={api}
                            customer={customer}
                            market={market}
                            availableCountries={availableCountries}
                            language={language}
                            onBack={goBack}
                            onCustomerChange={setCustomer}
                            onNavigate={navigate}
                            onNotify={notify}
                        />
                    </AuthPageBoundary>
                );
            case 'account-security':
                return (
                    <AuthPageBoundary language={language} onBack={goBack}>
                        <LazyAccountSecurityPage
                            customer={customer}
                            language={language}
                            storefrontName={storefrontName}
                            onBack={goBack}
                            onNavigate={navigate}
                            onLogout={() => {
                                void api.logout().then(() => {
                                    clearPrivateQueryCache();
                                    setCustomer(null);
                                    notify(isZh ? '已退出登录' : 'Signed out');
                                    navigate({ name: 'account' }, true);
                                });
                            }}
                        />
                    </AuthPageBoundary>
                );
            case 'favorites':
                return (
                    <FavoriteProductsPage
                        api={api}
                        productIds={favoriteProductIds}
                        market={market}
                        locale={locale}
                        language={language}
                        addingVariantId={addingVariantId}
                        onBack={goBack}
                        onNavigate={navigate}
                        onAdd={variant => void addToCart(variant)}
                        onRemove={productId => {
                            toggleFavoriteProduct(productId);
                            notify(isZh ? '已取消收藏' : 'Removed from favorites');
                        }}
                        onClear={() => {
                            if (storefrontCode) {
                                localStorage.removeItem(
                                    scopedStorageKey(FAVORITE_PRODUCT_STORAGE_KEY, storefrontCode),
                                );
                            }
                            setFavoriteProductIds([]);
                            notify(isZh ? '收藏已清空' : 'Favorites cleared');
                        }}
                    />
                );
            case 'history':
                return (
                    <BrowsingHistoryPage
                        api={api}
                        productIds={recentProductIds}
                        market={market}
                        locale={locale}
                        language={language}
                        addingVariantId={addingVariantId}
                        onBack={goBack}
                        onNavigate={navigate}
                        onAdd={variant => void addToCart(variant)}
                        onClear={() => {
                            if (storefrontCode) {
                                localStorage.removeItem(
                                    scopedStorageKey(RECENT_PRODUCT_STORAGE_KEY, storefrontCode),
                                );
                            }
                            setRecentProductIds([]);
                            notify(isZh ? '浏览足迹已清空' : 'Browsing history cleared');
                        }}
                    />
                );
            case 'notifications':
                return (
                    <NotificationsPage
                        api={api}
                        customer={customer}
                        market={market}
                        locale={locale}
                        language={language}
                        onBack={goBack}
                        onNavigate={navigate}
                    />
                );
            case 'coupons':
                return (
                    <CouponCenterPage
                        order={cart?.checkoutOrder ?? null}
                        language={language}
                        loading={cartLoading}
                        onBack={goBack}
                        onNavigate={navigate}
                        onApply={applyCoupon}
                        onRemove={removeCoupon}
                    />
                );
            case 'reviews':
                return (
                    <ReviewCenterPage
                        api={api}
                        customer={customer}
                        market={market}
                        language={language}
                        onBack={goBack}
                        onProduct={productId => navigate({ name: 'product', id: productId })}
                        onShop={() => navigate({ name: 'category' })}
                        onSignIn={() => navigate({ name: 'login' })}
                        onNotify={notify}
                    />
                );
            case 'support':
                return (
                    <SupportPage
                        content={supportContent}
                        products={products}
                        language={language}
                        onBack={goBack}
                        onContentTarget={openContentTarget}
                    />
                );
            case 'login':
                return (
                    <AuthPageBoundary language={language} onBack={goBack}>
                        <LazyLoginPage
                            api={api}
                            language={language}
                            storefrontName={storefrontName}
                            legalContent={legalContent}
                            onBack={goBack}
                            onSuccess={completeAuthentication}
                            onNavigate={navigate}
                            onContentTarget={openContentTarget}
                        />
                    </AuthPageBoundary>
                );
            case 'register':
                return (
                    <AuthPageBoundary language={language} onBack={goBack}>
                        <LazyRegisterPage
                            api={api}
                            language={language}
                            storefrontName={storefrontName}
                            legalContent={legalContent}
                            onBack={goBack}
                            onNavigate={navigate}
                            onContentTarget={openContentTarget}
                        />
                    </AuthPageBoundary>
                );
            case 'verify-account':
                return (
                    <AuthPageBoundary language={language} onBack={goBack}>
                        <LazyVerifyAccountPage
                            api={api}
                            language={language}
                            storefrontName={storefrontName}
                            token={route.token}
                            onBack={goBack}
                            onSuccess={completeAuthentication}
                            onNavigate={navigate}
                        />
                    </AuthPageBoundary>
                );
            case 'forgot-password':
                return (
                    <AuthPageBoundary language={language} onBack={goBack}>
                        <LazyForgotPasswordPage
                            api={api}
                            language={language}
                            storefrontName={storefrontName}
                            onBack={goBack}
                            onNavigate={navigate}
                        />
                    </AuthPageBoundary>
                );
            case 'reset-password':
                return (
                    <AuthPageBoundary language={language} onBack={goBack}>
                        <LazyResetPasswordPage
                            api={api}
                            language={language}
                            storefrontName={storefrontName}
                            token={route.token}
                            onBack={goBack}
                            onSuccess={completeAuthentication}
                            onNavigate={navigate}
                        />
                    </AuthPageBoundary>
                );
            case 'legal':
                return (
                    <ManagedLegalPage
                        kind={route.id === 'terms' ? 'terms' : 'privacy'}
                        language={language}
                        storefrontName={storefrontName}
                        contentBlocks={contentBlocks}
                        onBack={goBack}
                    />
                );
            case 'not-found':
                return (
                    <NotFoundPage
                        language={language}
                        storefrontName={storefrontName}
                        onBack={goBack}
                        onNavigate={navigate}
                    />
                );
        }
    };
    const page = renderPage(route);
    const isRootRoute = rootPages.includes(route.name as MainPage);

    return (
        <div className="storefront-app">
            <a className="skip-link" href="#storefront-content">
                {isZh ? '跳到主要内容' : 'Skip to content'}
            </a>
            {!online && (
                <div className="network-banner" role="status">
                    <WifiOff aria-hidden="true" />
                    {isZh ? '当前网络不可用，部分操作可能失败' : 'You are offline. Some actions may fail.'}
                </div>
            )}
            {((isNavigationPending && !isRootRoute) || productQuery.isFetching) && (
                <div className="navigation-progress" role="progressbar" aria-label={text.loading} />
            )}
            <div id="storefront-content">
                {rootPages.map(rootPage => (
                    <Activity key={rootPage} mode={route.name === rootPage ? 'visible' : 'hidden'}>
                        {renderPage({ name: rootPage })}
                    </Activity>
                ))}
                {!isRootRoute && page}
            </div>
            {rootPages.includes(route.name as MainPage) && (
                <BottomNavigation
                    active={mainPage}
                    cartQuantity={cart?.totalQuantity ?? 0}
                    language={language}
                    onNavigate={name => navigate({ name })}
                />
            )}
            {toast && (
                <div className="toast" role="status" aria-live="polite">
                    {toast}
                </div>
            )}
        </div>
    );
}

interface HomePageProps {
    products: Product[];
    collections: CollectionSummary[];
    contentBlocks: StorefrontContentBlock[];
    contentError: string;
    loading: boolean;
    error: string | null;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    storefrontName: string;
    addingVariantId: string | null;
    onNavigate: (route: RouteState) => void;
    onCategorySelect: (collection: CollectionSummary) => void;
    onAdd: (variant: ProductVariant) => void;
    onToggleLanguage: () => void;
    onNotifications: () => void;
    onContentTarget: (targetType: StorefrontContentTargetType, targetValue: string | null) => void;
    onRetry: () => void;
}

function HomePage(props: HomePageProps) {
    const {
        products,
        collections,
        contentBlocks,
        contentError,
        loading,
        error,
        market,
        locale,
        language,
        storefrontName,
        addingVariantId,
        onNavigate,
        onCategorySelect,
        onAdd,
        onToggleLanguage,
        onNotifications,
        onContentTarget,
        onRetry,
    } = props;
    const isZh = language === 'zh';
    const noticeBlock = contentBlocks.find(block => block.type === 'NOTICE');
    const managedHeroes = contentBlocks.filter(block => block.type === 'HERO');
    const quickBlock = contentBlocks.find(block => block.type === 'QUICK_LINKS');
    const legalBlock = contentBlocks.find(block => block.type === 'LEGAL');
    const noticeHasTarget = Boolean(
        noticeBlock && noticeBlock.targetType !== 'NONE' && noticeBlock.targetValue?.trim(),
    );
    const managedSections = contentBlocks.filter(block =>
        ['CATEGORY_AD', 'FEATURED_COLLECTION', 'STORY', 'SUPPORT'].includes(block.type),
    );
    const heroProducts = products.slice(0, 2);
    const [heroIndex, setHeroIndex] = useState(0);
    const [heroInteractionPaused, setHeroInteractionPaused] = useState(false);
    const [heroUserPaused, setHeroUserPaused] = useState(false);
    const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
    const heroCount = managedHeroes.length || heroProducts.length;
    const managedHero = managedHeroes[heroIndex];
    const hero = heroProducts[heroIndex] ?? products[0];
    const heroImage = managedHero?.imageUrl ?? productImage(hero) ?? '/storefront/default-hero.jpg';
    const managedHeroProduct =
        managedHero?.targetType === 'PRODUCT'
            ? products.find(product => product.id === managedHero.targetValue)
            : undefined;
    const heroFallbackImage = productImage(managedHeroProduct ?? hero) ?? '/storefront/default-hero.jpg';
    const quickCollections = collections.slice(0, 3);

    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        const updateMotionPreference = () => setPrefersReducedMotion(mediaQuery.matches);
        updateMotionPreference();
        mediaQuery.addEventListener('change', updateMotionPreference);
        return () => mediaQuery.removeEventListener('change', updateMotionPreference);
    }, []);

    useEffect(() => {
        if (heroCount < 2 || heroInteractionPaused || heroUserPaused || prefersReducedMotion) return;
        const timer = window.setInterval(() => setHeroIndex(index => (index + 1) % heroCount), 5200);
        return () => window.clearInterval(timer);
    }, [heroCount, heroInteractionPaused, heroUserPaused, prefersReducedMotion]);

    useEffect(() => {
        if (heroIndex >= heroCount) setHeroIndex(0);
    }, [heroCount, heroIndex]);

    const quickLinks: Array<{
        id: string;
        label: string;
        icon: ReactNode;
        disabled?: boolean;
        onClick: () => void;
    }> = quickBlock?.items.length
        ? quickBlock.items.slice(0, 5).map((item, index) => ({
              id: item.id,
              label: item.label,
              icon: item.imageUrl ? (
                  <SafeImage src={item.imageUrl} alt="" imageKind="thumbnail" />
              ) : (
                  quickIcon(index)
              ),
              disabled: item.targetType === 'NONE' || !item.targetValue,
              onClick: () => onContentTarget(item.targetType, item.targetValue),
          }))
        : [
              ...quickCollections.map((collection, index) => ({
                  id: collection.id,
                  label: collection.name,
                  icon: quickIcon(index),
                  onClick: () => onCategorySelect(collection),
              })),
              {
                  id: 'all-products',
                  label: isZh ? '全部商品' : 'All products',
                  icon: <LayoutGrid />,
                  onClick: () => onNavigate({ name: 'category' }),
              },
              ...(hero
                  ? [
                        {
                            id: 'weekly-edit',
                            label: isZh ? '本周精选' : 'Weekly edit',
                            icon: <Sparkles />,
                            onClick: () => onNavigate({ name: 'product', id: hero.id }),
                        },
                    ]
                  : []),
              {
                  id: 'cart-shortcut',
                  label: isZh ? '购物车' : 'Cart',
                  icon: <ShoppingCart />,
                  onClick: () => onNavigate({ name: 'cart' }),
              },
              {
                  id: 'my-orders',
                  label: isZh ? '我的订单' : 'My orders',
                  icon: <Package />,
                  onClick: () => onNavigate({ name: 'orders', tab: 'all' }),
              },
          ].slice(0, 5);

    return (
        <main className="page home-page">
            <header className="topbar home-topbar">
                <button
                    className="brand"
                    type="button"
                    onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                >
                    <span className="brand-mark">桥</span>
                    <strong>{storefrontName}</strong>
                </button>
                <button
                    className="search-trigger"
                    type="button"
                    onClick={() => onNavigate({ name: 'search' })}
                >
                    <Search aria-hidden="true" />
                    <span>{isZh ? '搜索商品、分类' : 'Search products'}</span>
                </button>
                <div className="topbar-actions">
                    <button
                        className="language-button"
                        type="button"
                        onClick={onToggleLanguage}
                        aria-label={isZh ? '切换为英文' : 'Switch to Chinese'}
                    >
                        {isZh ? '中' : 'EN'}
                    </button>
                    <NoticeButton language={language} onClick={onNotifications} />
                </div>
            </header>

            <button
                className="notice-strip"
                type="button"
                disabled={!noticeHasTarget}
                onClick={() =>
                    noticeHasTarget &&
                    noticeBlock &&
                    onContentTarget(noticeBlock.targetType, noticeBlock.targetValue)
                }
            >
                <Bell aria-hidden="true" />
                <span>
                    {noticeBlock?.title ||
                        (isZh ? '现货商品配送时效以结算页为准' : 'Delivery timing is confirmed at checkout')}
                </span>
                {noticeHasTarget && <ChevronRight aria-hidden="true" />}
            </button>

            {contentError && (
                <div className="content-warning" role="status">
                    <span>{isZh ? '店铺内容暂时无法加载' : 'Store content is temporarily unavailable'}</span>
                    <button type="button" onClick={onRetry}>
                        <RotateCcw aria-hidden="true" />
                        {isZh ? '重试' : 'Retry'}
                    </button>
                </div>
            )}

            {loading ? (
                <PageSkeleton />
            ) : error ? (
                <EmptyState
                    icon={<WifiOff />}
                    title={isZh ? '首页加载失败' : 'Could not load the home page'}
                    detail={error}
                    action={isZh ? '重新加载' : 'Try again'}
                    onAction={onRetry}
                />
            ) : (
                <>
                    <div className="home-intro-grid">
                        <section
                            className="hero"
                            aria-label={managedHero?.title || (isZh ? '精选推荐' : 'Featured')}
                            onMouseEnter={() => setHeroInteractionPaused(true)}
                            onMouseLeave={() => setHeroInteractionPaused(false)}
                            onFocus={() => setHeroInteractionPaused(true)}
                            onBlur={event => {
                                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                                    setHeroInteractionPaused(false);
                                }
                            }}
                            style={{
                                backgroundColor: managedHero?.backgroundColor ?? undefined,
                                color: managedHero?.textColor ?? undefined,
                            }}
                        >
                            {heroImage ? (
                                <SafeImage
                                    src={heroImage}
                                    fallbackSrc={heroFallbackImage}
                                    alt={managedHero?.title ?? hero?.name ?? ''}
                                    imageKind="hero"
                                    loading="eager"
                                    fetchPriority="high"
                                />
                            ) : (
                                <div className="image-placeholder">
                                    <Sparkles aria-hidden="true" />
                                </div>
                            )}
                            <div className="hero-shade" />
                            <div className="hero-copy">
                                <small>{managedHero?.subtitle || (isZh ? '本周精选' : 'This week')}</small>
                                <h1>
                                    {managedHero?.title ??
                                        hero?.name ??
                                        (isZh ? '认真挑选每一件好物' : 'Goods chosen with care')}
                                </h1>
                                <p>
                                    {managedHero?.body ||
                                        trimText(hero?.description, 38) ||
                                        (isZh
                                            ? '从当前店铺在售商品中，为你整理值得关注的选择'
                                            : 'A considered edit of what is available now')}
                                </p>
                                {(managedHero ? managedHero.targetType !== 'NONE' : Boolean(hero)) && (
                                    <button
                                        type="button"
                                        disabled={managedHero ? !managedHero.targetValue : !hero}
                                        onClick={() =>
                                            managedHero
                                                ? onContentTarget(
                                                      managedHero.targetType,
                                                      managedHero.targetValue,
                                                  )
                                                : hero && onNavigate({ name: 'product', id: hero.id })
                                        }
                                    >
                                        {managedHero?.ctaLabel || (isZh ? '查看精选' : 'View selection')}
                                        <ChevronRight aria-hidden="true" />
                                    </button>
                                )}
                            </div>
                            {heroCount > 1 && (
                                <div
                                    className="hero-pagination"
                                    aria-label={isZh ? '轮播广告' : 'Promotion carousel'}
                                >
                                    {!prefersReducedMotion && (
                                        <button
                                            className="hero-playback"
                                            type="button"
                                            aria-label={
                                                heroUserPaused
                                                    ? isZh
                                                        ? '继续自动播放'
                                                        : 'Resume autoplay'
                                                    : isZh
                                                      ? '暂停自动播放'
                                                      : 'Pause autoplay'
                                            }
                                            title={
                                                heroUserPaused
                                                    ? isZh
                                                        ? '继续自动播放'
                                                        : 'Resume autoplay'
                                                    : isZh
                                                      ? '暂停自动播放'
                                                      : 'Pause autoplay'
                                            }
                                            onClick={() => setHeroUserPaused(paused => !paused)}
                                        >
                                            {heroUserPaused ? (
                                                <Play aria-hidden="true" />
                                            ) : (
                                                <Pause aria-hidden="true" />
                                            )}
                                        </button>
                                    )}
                                    {(managedHeroes.length ? managedHeroes : heroProducts).map(
                                        (item, index) => (
                                            <button
                                                type="button"
                                                key={item.id}
                                                className={`hero-dot ${index === heroIndex ? 'is-active' : ''}`}
                                                aria-label={
                                                    isZh ? `第${index + 1}张广告` : `Promotion ${index + 1}`
                                                }
                                                aria-current={index === heroIndex}
                                                onClick={() => setHeroIndex(index)}
                                            />
                                        ),
                                    )}
                                </div>
                            )}
                        </section>

                        <nav
                            className={`quick-grid quick-grid-${quickLinks.length}`}
                            aria-label={isZh ? '快捷分类' : 'Quick categories'}
                        >
                            {quickLinks.map(item => (
                                <button
                                    type="button"
                                    key={item.id}
                                    onClick={item.onClick}
                                    disabled={item.disabled}
                                >
                                    <span>{item.icon}</span>
                                    <b>{item.label}</b>
                                </button>
                            ))}
                        </nav>

                        <div className="benefit-row">
                            <TicketPercent aria-hidden="true" />
                            <span>
                                <small>{isZh ? '优惠自动计算' : 'Automatic savings'}</small>
                                <strong>
                                    {isZh
                                        ? '可用优惠将在结算时自动抵扣'
                                        : 'Eligible offers apply automatically at checkout'}
                                </strong>
                            </span>
                        </div>
                    </div>

                    {managedSections.map(block => (
                        <ManagedContentSection
                            key={block.id}
                            block={block}
                            products={products}
                            onContentTarget={onContentTarget}
                        />
                    ))}

                    <ProductSection
                        title={isZh ? '限时精选' : 'Selected now'}
                        subtitle={isZh ? '当前店铺值得关注的商品' : 'Worth a closer look'}
                        products={products.slice(0, 4)}
                        market={market}
                        locale={locale}
                        addingVariantId={addingVariantId}
                        onProduct={product => onNavigate({ name: 'product', id: product.id })}
                        onAdd={onAdd}
                    />

                    {products.length > 1 && (
                        <section className="content-section inspiration-section">
                            <SectionHeader
                                title={isZh ? '生活灵感' : 'Ideas for everyday life'}
                                subtitle={
                                    isZh
                                        ? '从真实商品中发现搭配方向'
                                        : 'Explore combinations from the catalogue'
                                }
                                action={isZh ? '更多' : 'More'}
                                onAction={() => onNavigate({ name: 'category' })}
                            />
                            <div className="story-grid">
                                {products.slice(0, 2).map((product, index) => (
                                    <button
                                        type="button"
                                        key={product.id}
                                        onClick={() => onNavigate({ name: 'product', id: product.id })}
                                    >
                                        <ProductImage product={product} />
                                        <span>
                                            {product.name}
                                            <small>
                                                {index === 0
                                                    ? isZh
                                                        ? '本周编辑推荐'
                                                        : 'Editor selection'
                                                    : isZh
                                                      ? '继续探索'
                                                      : 'Explore more'}
                                            </small>
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </section>
                    )}

                    <ProductSection
                        title={isZh ? '猜你喜欢' : 'You may also like'}
                        subtitle={isZh ? '继续发现合适的好物' : 'Keep discovering'}
                        products={products.slice(4, 10).length ? products.slice(4, 10) : products.slice(0, 4)}
                        market={market}
                        locale={locale}
                        addingVariantId={addingVariantId}
                        onProduct={product => onNavigate({ name: 'product', id: product.id })}
                        onAdd={onAdd}
                    />
                    <LegalFooter
                        storefrontName={storefrontName}
                        content={legalBlock}
                        onContentTarget={onContentTarget}
                    />
                </>
            )}
        </main>
    );
}

function ManagedContentSection({
    block,
    products,
    onContentTarget,
}: {
    block: StorefrontContentBlock;
    products: Product[];
    onContentTarget: (targetType: StorefrontContentTargetType, targetValue: string | null) => void;
}) {
    const blockHasTarget = block.targetType !== 'NONE' && Boolean(block.targetValue);
    const blockTargetProduct =
        block.targetType === 'PRODUCT'
            ? products.find(product => product.id === block.targetValue)
            : undefined;
    return (
        <section
            className={`content-section managed-content-section managed-content-${block.type.toLowerCase()}`}
            style={{
                backgroundColor: block.backgroundColor ?? undefined,
                color: block.textColor ?? undefined,
            }}
        >
            <SectionHeader
                title={block.title}
                subtitle={block.subtitle}
                action={blockHasTarget ? block.ctaLabel || undefined : undefined}
                onAction={
                    blockHasTarget ? () => onContentTarget(block.targetType, block.targetValue) : undefined
                }
            />
            {block.body && <p className="managed-content-body">{block.body}</p>}
            {block.imageUrl && !block.items.length && (
                <button
                    className="managed-content-banner"
                    type="button"
                    disabled={!blockHasTarget}
                    onClick={() => onContentTarget(block.targetType, block.targetValue)}
                >
                    <SafeImage
                        src={block.imageUrl}
                        fallbackSrc={productImage(blockTargetProduct) ?? undefined}
                        alt={block.title}
                        imageKind="hero"
                        loading="lazy"
                    />
                </button>
            )}
            {!!block.items.length && (
                <div className="managed-content-grid">
                    {block.items.map(item => (
                        <ManagedContentItemButton
                            key={item.id}
                            item={item}
                            products={products}
                            onContentTarget={onContentTarget}
                        />
                    ))}
                </div>
            )}
        </section>
    );
}

function ManagedContentItemButton({
    item,
    products,
    onContentTarget,
}: {
    item: StorefrontContentItem;
    products: Product[];
    onContentTarget: (targetType: StorefrontContentTargetType, targetValue: string | null) => void;
}) {
    const disabled = item.targetType === 'NONE' || !item.targetValue;
    const targetProduct =
        item.targetType === 'PRODUCT' ? products.find(product => product.id === item.targetValue) : undefined;
    return (
        <button
            className={`managed-content-card${targetProduct ? ' is-product-media' : ''}`}
            type="button"
            disabled={disabled}
            onClick={() => onContentTarget(item.targetType, item.targetValue)}
        >
            <span className="managed-content-media" aria-hidden="true">
                {item.imageUrl ? (
                    <SafeImage
                        src={item.imageUrl}
                        fallbackSrc={productImage(targetProduct) ?? undefined}
                        alt=""
                        imageKind="card"
                        loading="lazy"
                    />
                ) : (
                    <span className="managed-content-placeholder">
                        <LayoutGrid aria-hidden="true" />
                    </span>
                )}
            </span>
            <span className="managed-content-copy">
                <span>
                    <strong>{item.label}</strong>
                    {item.description && <small>{item.description}</small>}
                </span>
                {!disabled && <ChevronRight aria-hidden="true" />}
            </span>
        </button>
    );
}

interface CategoryPageProps {
    api: ShopApi;
    products: Product[];
    collections: CollectionSummary[];
    loading: boolean;
    error: string | null;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    activeCollectionId: string;
    activeChildId: string;
    sortMode: SortMode;
    fulfillmentFilter: 'all' | FulfillmentType;
    inStockOnly: boolean;
    minimumPrice: string;
    maximumPrice: string;
    addingVariantId: string | null;
    onCollectionChange: (collectionId: string, childId: string) => void;
    onChildChange: (childId: string) => void;
    onSortChange: (sort: SortMode) => void;
    onFilterChange: (
        type: 'all' | FulfillmentType,
        inStockOnly: boolean,
        minimumPrice: string,
        maximumPrice: string,
    ) => void;
    onNavigate: (route: RouteState) => void;
    onAdd: (variant: ProductVariant) => void;
    onNotify: () => void;
    onRetry: () => void;
}

function CategoryPage(props: CategoryPageProps) {
    const {
        api,
        products,
        collections,
        loading,
        error,
        market,
        locale,
        language,
        activeCollectionId,
        activeChildId,
        sortMode,
        fulfillmentFilter,
        inStockOnly,
        minimumPrice: minimumPriceInput,
        maximumPrice: maximumPriceInput,
        addingVariantId,
        onCollectionChange,
        onChildChange,
        onSortChange,
        onFilterChange,
        onNavigate,
        onAdd,
        onNotify,
        onRetry,
    } = props;
    const queryClient = useQueryClient();
    const isZh = language === 'zh';
    const [filterOpen, setFilterOpen] = useState(false);
    const [draftType, setDraftType] = useState<'all' | FulfillmentType>(fulfillmentFilter);
    const [draftStock, setDraftStock] = useState(inStockOnly);
    const [draftMinimumPrice, setDraftMinimumPrice] = useState(minimumPriceInput);
    const [draftMaximumPrice, setDraftMaximumPrice] = useState(maximumPriceInput);
    const primary = collections.find(item => item.id === activeCollectionId) ?? collections[0];
    const children = primary?.children ?? [];
    const hasChildCategories = children.length > 0;
    const selectedCollectionId = activeChildId === 'all' ? activeCollectionId : activeChildId;
    const hasFilters =
        fulfillmentFilter !== 'all' || inStockOnly || minimumPriceInput !== '' || maximumPriceInput !== '';
    const vendureLanguageCode = languageCodeFor(language);
    const catalogInput = {
        collectionId: selectedCollectionId === 'all' ? undefined : selectedCollectionId,
        sort: sortMode,
        fulfillmentType: fulfillmentFilter === 'all' ? undefined : fulfillmentFilter,
        inStockOnly,
        minPriceWithTax: priceInputToMinorUnits(minimumPriceInput),
        maxPriceWithTax: priceInputToMinorUnits(maximumPriceInput),
    };
    const catalogQuery = useInfiniteQuery({
        queryKey: storefrontQueryKeys.catalog(market.code, vendureLanguageCode, catalogInput),
        queryFn: ({ pageParam, signal }) =>
            api.catalog({ ...catalogInput, skip: pageParam, take: 12 }, signal),
        initialPageParam: 0,
        getNextPageParam: (lastPage, pages) => {
            const loaded = pages.reduce((total, page) => total + page.items.length, 0);
            return loaded < lastPage.totalItems ? loaded : undefined;
        },
        enabled: collections.length > 0 && !!selectedCollectionId && selectedCollectionId !== 'all',
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        refetchOnMount: false,
        placeholderData: keepPreviousData,
        meta: publicQueryMeta(),
    });

    const matchesFilters = useCallback(
        (
            product: Product,
            type: 'all' | FulfillmentType,
            stockOnly: boolean,
            minimum: string,
            maximum: string,
        ) => {
            const typeMatch =
                type === 'all' ||
                product.variants.some(variant => variant.customFields.fulfillmentType === type);
            const stockMatch =
                !stockOnly || product.variants.some(variant => variant.stockLevel !== 'OUT_OF_STOCK');
            const price = minimumPrice(product) / 100;
            const minimumMatch = minimum === '' || price >= Number(minimum);
            const maximumMatch = maximum === '' || price <= Number(maximum);
            return typeMatch && stockMatch && minimumMatch && maximumMatch;
        },
        [],
    );

    const fallbackProducts = sortCategoryProducts(
        products.filter(product =>
            matchesFilters(product, fulfillmentFilter, inStockOnly, minimumPriceInput, maximumPriceInput),
        ),
        sortMode,
        locale,
    );
    const categoryProducts = collections.length
        ? (catalogQuery.data?.pages.flatMap(page => page.items) ?? [])
        : fallbackProducts;
    const visibleProducts = categoryProducts;
    const totalItems = collections.length
        ? (catalogQuery.data?.pages[0]?.totalItems ?? 0)
        : fallbackProducts.length;
    const remainingItems = Math.max(totalItems - categoryProducts.length, 0);
    const categoryLoading = collections.length ? catalogQuery.isPending : loading;
    const loadingMore = catalogQuery.isFetchingNextPage;
    const categoryError = collections.length
        ? catalogQuery.error instanceof Error
            ? catalogQuery.error.message
            : ''
        : (error ?? '');

    useEffect(() => {
        for (const product of categoryProducts) {
            const queryKey = storefrontQueryKeys.product(market.code, vendureLanguageCode, product.id);
            queryClient.setQueryData(queryKey, product);
            void queryClient.prefetchQuery({
                queryKey,
                queryFn: async () => product,
                staleTime: PUBLIC_QUERY_STALE_TIME,
                meta: publicQueryMeta(),
            });
        }
    }, [categoryProducts, market.code, queryClient, vendureLanguageCode]);

    const loadMore = () => catalogQuery.fetchNextPage();
    const draftResultCount = products.filter(product => {
        const collectionMatch =
            !collections.length ||
            !selectedCollectionId ||
            selectedCollectionId === 'all' ||
            product.collections.some(collection => collection.id === selectedCollectionId);
        return (
            collectionMatch &&
            matchesFilters(product, draftType, draftStock, draftMinimumPrice, draftMaximumPrice)
        );
    }).length;

    const bannerImage =
        primary?.featuredAsset?.preview ??
        productImage(categoryProducts[0]) ??
        '/storefront/default-hero.jpg';

    return (
        <main className="page category-page">
            <header className="topbar category-topbar">
                <h1 className="topbar-title">{isZh ? '商品' : 'Shop'}</h1>
                <button
                    className="search-trigger"
                    type="button"
                    onClick={() => onNavigate({ name: 'search' })}
                >
                    <Search aria-hidden="true" />
                    <span>{isZh ? '搜索商品、分类' : 'Search products'}</span>
                </button>
                <NoticeButton language={language} onClick={onNotify} />
            </header>

            <nav className="primary-categories" aria-label={isZh ? '一级分类' : 'Main categories'}>
                {(collections.length ? collections : fallbackCollections(isZh)).map(collection => {
                    const image = collectionImage(collection);
                    return (
                        <button
                            type="button"
                            key={collection.id}
                            className={collection.id === activeCollectionId ? 'is-active' : undefined}
                            aria-pressed={collection.id === activeCollectionId}
                            onClick={event => {
                                onCollectionChange(
                                    collection.id,
                                    collection.children?.[0]?.id ?? collection.id,
                                );
                                event.currentTarget.scrollIntoView({
                                    behavior: 'smooth',
                                    block: 'nearest',
                                    inline: 'center',
                                });
                            }}
                        >
                            <span className="primary-category-image" aria-hidden="true">
                                {image ? (
                                    <SafeImage src={image} alt="" imageKind="thumbnail" loading="lazy" />
                                ) : (
                                    <span className="primary-category-placeholder">
                                        <LayoutGrid aria-hidden="true" />
                                    </span>
                                )}
                            </span>
                            <span className="primary-category-label">{collection.name}</span>
                        </button>
                    );
                })}
            </nav>

            <div className={`category-layout ${hasChildCategories ? '' : 'is-single-level'}`}>
                {hasChildCategories && (
                    <nav className="secondary-categories" aria-label={isZh ? '二级分类' : 'Subcategories'}>
                        {children.map(child => (
                            <button
                                type="button"
                                key={child.id}
                                className={child.id === activeChildId ? 'is-active' : undefined}
                                onClick={() => onChildChange(child.id)}
                            >
                                {child.name}
                            </button>
                        ))}
                    </nav>
                )}

                <section className="category-results">
                    <button
                        className="category-banner"
                        type="button"
                        disabled={!categoryProducts[0]}
                        onClick={() =>
                            categoryProducts[0] && onNavigate({ name: 'product', id: categoryProducts[0].id })
                        }
                    >
                        {bannerImage ? (
                            <SafeImage
                                src={bannerImage}
                                fallbackSrc="/storefront/default-hero.jpg"
                                alt={primary?.name ?? ''}
                                imageKind="hero"
                                loading="eager"
                                fetchPriority="high"
                            />
                        ) : (
                            <div className="image-placeholder">
                                <ShoppingBag />
                            </div>
                        )}
                        <span>
                            <small>{isZh ? '分类精选' : 'Collection focus'}</small>
                            <strong>{primary?.name ?? (isZh ? '全部商品' : 'All products')}</strong>
                        </span>
                    </button>
                    <nav
                        className="sort-bar sort-bar-five"
                        aria-label={isZh ? '排序和筛选' : 'Sort and filter'}
                    >
                        <button
                            type="button"
                            className={sortMode === 'recommended' ? 'is-active' : undefined}
                            onClick={() => onSortChange('recommended')}
                        >
                            {isZh ? '综合' : 'Default'}
                        </button>
                        <button
                            type="button"
                            className={sortMode === 'sales' ? 'is-active' : undefined}
                            onClick={() => onSortChange('sales')}
                        >
                            {isZh ? '销量' : 'Sales'}
                        </button>
                        <button
                            type="button"
                            className={sortMode === 'newest' ? 'is-active' : undefined}
                            onClick={() => onSortChange('newest')}
                        >
                            {isZh ? '最新' : 'Newest'}
                        </button>
                        <button
                            type="button"
                            className={sortMode.startsWith('price') ? 'is-active' : undefined}
                            onClick={() =>
                                onSortChange(sortMode === 'price-asc' ? 'price-desc' : 'price-asc')
                            }
                        >
                            {isZh ? '价格' : 'Price'} <ArrowUpDown aria-hidden="true" />
                        </button>
                        <button
                            type="button"
                            className={hasFilters ? 'is-active' : undefined}
                            onClick={() => {
                                setDraftType(fulfillmentFilter);
                                setDraftStock(inStockOnly);
                                setDraftMinimumPrice(minimumPriceInput);
                                setDraftMaximumPrice(maximumPriceInput);
                                setFilterOpen(true);
                            }}
                        >
                            {isZh ? '筛选' : 'Filter'} <SlidersHorizontal aria-hidden="true" />
                        </button>
                    </nav>

                    {catalogQuery.isFetching && !categoryLoading && (
                        <div
                            className="category-query-progress"
                            role="progressbar"
                            aria-label={isZh ? '正在更新商品' : 'Updating products'}
                        />
                    )}

                    {categoryLoading || (loading && !collections.length) ? (
                        <ListSkeleton />
                    ) : categoryError && !categoryProducts.length ? (
                        <EmptyState
                            icon={<WifiOff />}
                            title={isZh ? '商品加载失败' : 'Could not load products'}
                            detail={categoryError}
                            action={isZh ? '重试' : 'Retry'}
                            onAction={() => (collections.length ? void catalogQuery.refetch() : onRetry())}
                            compact
                        />
                    ) : categoryProducts.length ? (
                        <div className="product-list">
                            {visibleProducts.map(product => (
                                <ProductRow
                                    key={product.id}
                                    product={product}
                                    market={market}
                                    locale={locale}
                                    language={language}
                                    adding={product.variants.some(variant => variant.id === addingVariantId)}
                                    onOpen={() => onNavigate({ name: 'product', id: product.id })}
                                    onAdd={() => product.variants[0] && onAdd(product.variants[0])}
                                />
                            ))}
                            {categoryError && (
                                <div className="search-load-error" role="alert">
                                    <span>{categoryError}</span>
                                    <button type="button" onClick={() => void loadMore()}>
                                        {isZh ? '重试' : 'Retry'}
                                    </button>
                                </div>
                            )}
                            {remainingItems > 0 && (
                                <button
                                    className="load-more-button"
                                    type="button"
                                    disabled={loadingMore}
                                    onClick={() => void loadMore()}
                                >
                                    {loadingMore
                                        ? isZh
                                            ? '加载中'
                                            : 'Loading'
                                        : isZh
                                          ? `加载更多（剩余 ${remainingItems} 件）`
                                          : `Load more (${remainingItems} remaining)`}
                                </button>
                            )}
                        </div>
                    ) : (
                        <EmptyState
                            icon={<Search />}
                            title={isZh ? '当前分类没有商品' : 'No products in this category'}
                            detail={
                                hasFilters
                                    ? isZh
                                        ? '可以调整或清除筛选条件'
                                        : 'Adjust or clear the filters'
                                    : isZh
                                      ? '可以切换其他分类'
                                      : 'Choose another category'
                            }
                            compact
                        />
                    )}
                </section>
            </div>

            {filterOpen && (
                <Sheet
                    title={isZh ? '筛选' : 'Filter'}
                    language={language}
                    onClose={() => setFilterOpen(false)}
                >
                    <div className="filter-sheet-content">
                        <label className="switch-row filter-stock-row">
                            <span>
                                <strong>{isZh ? '仅看有货' : 'In stock only'}</strong>
                                <small>{isZh ? '隐藏当前不可售规格' : 'Hide unavailable variants'}</small>
                            </span>
                            <input
                                type="checkbox"
                                checked={draftStock}
                                onChange={event => setDraftStock(event.target.checked)}
                            />
                        </label>
                        <fieldset>
                            <legend>{isZh ? '价格区间' : 'Price range'}</legend>
                            <div className="price-range-inputs">
                                <label>
                                    <span>{market.currencyCode}</span>
                                    <input
                                        type="number"
                                        inputMode="decimal"
                                        min="0"
                                        placeholder={isZh ? '最低价' : 'Min'}
                                        value={draftMinimumPrice}
                                        onChange={event => setDraftMinimumPrice(event.target.value)}
                                    />
                                </label>
                                <i />
                                <label>
                                    <span>{market.currencyCode}</span>
                                    <input
                                        type="number"
                                        inputMode="decimal"
                                        min="0"
                                        placeholder={isZh ? '最高价' : 'Max'}
                                        value={draftMaximumPrice}
                                        onChange={event => setDraftMaximumPrice(event.target.value)}
                                    />
                                </label>
                            </div>
                            <div className="price-presets">
                                {(
                                    [
                                        [0, 100],
                                        [100, 300],
                                        [300, 800],
                                        [800, null],
                                    ] as const
                                ).map(([minimum, maximum]) => (
                                    <button
                                        type="button"
                                        key={`${minimum}-${maximum ?? 'up'}`}
                                        className={
                                            draftMinimumPrice === String(minimum) &&
                                            draftMaximumPrice === (maximum === null ? '' : String(maximum))
                                                ? 'is-active'
                                                : undefined
                                        }
                                        onClick={() => {
                                            setDraftMinimumPrice(String(minimum));
                                            setDraftMaximumPrice(maximum === null ? '' : String(maximum));
                                        }}
                                    >
                                        {maximum === null
                                            ? `${minimum}${isZh ? '以上' : '+'}`
                                            : `${minimum}-${maximum}`}
                                    </button>
                                ))}
                            </div>
                        </fieldset>
                        <fieldset>
                            <legend>{isZh ? '商品类型' : 'Product type'}</legend>
                            <div className="segmented-options">
                                {(['all', 'physical', 'digital'] as const).map(type => (
                                    <button
                                        type="button"
                                        key={type}
                                        className={draftType === type ? 'is-active' : undefined}
                                        onClick={() => setDraftType(type)}
                                    >
                                        {type === 'all'
                                            ? isZh
                                                ? '全部'
                                                : 'All'
                                            : type === 'physical'
                                              ? isZh
                                                  ? '实物'
                                                  : 'Physical'
                                              : isZh
                                                ? '数字商品'
                                                : 'Digital'}
                                    </button>
                                ))}
                            </div>
                        </fieldset>
                        <div className="sheet-actions">
                            <button type="button" onClick={() => setFilterOpen(false)}>
                                {isZh ? '取消' : 'Cancel'}
                            </button>
                            <button
                                type="button"
                                className="reset-filter-button"
                                onClick={() => {
                                    setDraftType('all');
                                    setDraftStock(false);
                                    setDraftMinimumPrice('');
                                    setDraftMaximumPrice('');
                                }}
                            >
                                {isZh ? '重置' : 'Reset'}
                            </button>
                            <button
                                type="button"
                                className="primary-action"
                                onClick={() => {
                                    onFilterChange(
                                        draftType,
                                        draftStock,
                                        draftMinimumPrice,
                                        draftMaximumPrice,
                                    );
                                    setFilterOpen(false);
                                }}
                            >
                                {isZh
                                    ? `查看 ${draftResultCount} 件商品`
                                    : `View ${draftResultCount} products`}
                            </button>
                        </div>
                    </div>
                </Sheet>
            )}
        </main>
    );
}

interface CartPageProps {
    cart: StorefrontCart | null;
    customer: ActiveCustomer | null;
    products: Product[];
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    loading: boolean;
    error: string | null;
    addingVariantId: string | null;
    onToggleAll: () => void;
    onSelect: (lineId: string, selected: boolean) => void;
    onSelectGroup: (lineIds: string[], selected: boolean) => void;
    onQuantity: (lineId: string, quantity: number) => void;
    onRemove: (lineId: string) => void;
    onCheckout: () => void;
    onReopen: () => void;
    onNavigate: (route: RouteState) => void;
    onAdd: (variant: ProductVariant) => void;
    onRetry: () => void;
    onApplyCoupon: (couponCode: string) => Promise<string | null>;
    onRemoveCoupon: (couponCode: string) => Promise<string | null>;
}

function CartPage(props: CartPageProps) {
    const {
        cart,
        customer,
        products,
        market,
        locale,
        language,
        loading,
        error,
        addingVariantId,
        onToggleAll,
        onSelect,
        onSelectGroup,
        onQuantity,
        onRemove,
        onCheckout,
        onReopen,
        onNavigate,
        onAdd,
        onRetry,
        onApplyCoupon,
        onRemoveCoupon,
    } = props;
    const isZh = language === 'zh';
    const lines = cart?.lines ?? [];
    const [invalidOpen, setInvalidOpen] = useState(false);
    const [couponOpen, setCouponOpen] = useState(false);
    const activeLines = lines.filter(line => line.available && line.productVariant);
    const invalidLines = lines.filter(line => !line.available || !line.productVariant);
    const physical = activeLines.filter(
        line => line.productVariant?.customFields.fulfillmentType === 'physical',
    );
    const digital = activeLines.filter(
        line => line.productVariant?.customFields.fulfillmentType === 'digital',
    );
    const digitalOnly = digital.length > 0 && physical.length === 0;
    const order = cart?.checkoutOrder;
    const locked = cart?.state === 'PAYMENT_PENDING';
    const discount = Math.abs(order?.discounts.reduce((sum, item) => sum + item.amountWithTax, 0) ?? 0);
    const amount = locked && order ? order.totalWithTax : (order?.subTotalWithTax ?? 0);

    return (
        <main className="page cart-page">
            <header className="topbar cart-topbar">
                <h1 className="topbar-title">{isZh ? '购物车' : 'Cart'}</h1>
                {!!lines.length && (
                    <button
                        className={`select-all ${(cart?.selectionState ?? 'NONE').toLowerCase()}`}
                        type="button"
                        onClick={onToggleAll}
                        disabled={loading || locked}
                    >
                        <span>
                            {cart?.selectionState === 'ALL' ? (
                                <Check />
                            ) : cart?.selectionState === 'PARTIAL' ? (
                                <Minus />
                            ) : null}
                        </span>
                        <b>
                            {cart?.selectionState === 'ALL'
                                ? isZh
                                    ? `已全选 ${cart.selectedQuantity}件`
                                    : `All ${cart.selectedQuantity}`
                                : cart?.selectionState === 'PARTIAL'
                                  ? isZh
                                      ? `已选 ${cart.selectedQuantity}/${cart.totalQuantity}件`
                                      : `${cart.selectedQuantity}/${cart.totalQuantity} selected`
                                  : isZh
                                    ? `全选 ${cart?.totalQuantity ?? 0}件`
                                    : `Select all ${cart?.totalQuantity ?? 0}`}
                        </b>
                    </button>
                )}
            </header>

            {!!lines.length && (
                <div className="shipping-note">
                    <span>
                        {digitalOnly ? <Download aria-hidden="true" /> : <Truck aria-hidden="true" />}
                    </span>
                    <div>
                        <strong>
                            {digitalOnly
                                ? isZh
                                    ? '数字商品交付'
                                    : 'Digital delivery'
                                : isZh
                                  ? '配送与运费'
                                  : 'Delivery and shipping'}
                        </strong>
                        <small>
                            {digitalOnly
                                ? locked
                                    ? isZh
                                        ? '交付方式已在待支付订单中确认'
                                        : 'Delivery is confirmed on the pending order'
                                    : isZh
                                      ? '支付完成后自动添加到订单'
                                      : 'Added to your order after payment'
                                : locked
                                  ? isZh
                                      ? '配送方式与运费已在待支付订单中确认'
                                      : 'Delivery method and fee are confirmed on the pending order'
                                  : isZh
                                    ? '选择地址后在结算页准确计算'
                                    : 'Calculated after you choose an address'}
                        </small>
                    </div>
                </div>
            )}

            {customer && error && (
                <InlineError message={error} action={isZh ? '刷新' : 'Refresh'} onAction={onRetry} />
            )}
            {customer && locked && (
                <div className="cart-pending-actions">
                    <InlineError
                        message={
                            isZh
                                ? '订单正在等待支付，购物车内容已锁定。可以继续支付，或返回修改商品与优惠。'
                                : 'This cart is locked while its order awaits payment. Continue payment or reopen it to make changes.'
                        }
                        action={isZh ? '继续支付' : 'Continue payment'}
                        onAction={() => onNavigate({ name: 'payment' })}
                    />
                    <button type="button" onClick={onReopen} disabled={loading}>
                        {isZh ? '返回修改订单' : 'Return to edit order'}
                    </button>
                </div>
            )}
            {loading && (!customer || !cart) ? (
                <ListSkeleton />
            ) : !customer ? (
                <section className="empty-state cart-auth-state" aria-labelledby="cart-auth-title">
                    <span>
                        <ShoppingBag />
                    </span>
                    <strong id="cart-auth-title">
                        {isZh ? '登录后使用购物车' : 'Sign in to use your cart'}
                    </strong>
                    <small>
                        {isZh
                            ? '请先登录或注册账户，再添加商品并完成结算'
                            : 'Sign in or create an account to add products and complete checkout'}
                    </small>
                    <div className="guest-profile-actions cart-auth-actions">
                        <button type="button" onClick={() => onNavigate({ name: 'login' })}>
                            {isZh ? '登录' : 'Sign in'}
                        </button>
                        <button type="button" onClick={() => onNavigate({ name: 'register' })}>
                            {isZh ? '注册账户' : 'Create account'}
                        </button>
                    </div>
                </section>
            ) : !lines.length ? (
                <EmptyState
                    icon={<ShoppingBag />}
                    title={isZh ? '购物车还是空的' : 'Your cart is empty'}
                    detail={isZh ? '去挑几件喜欢的商品吧' : 'Browse the shop to add something'}
                    action={isZh ? '去逛商品' : 'Browse products'}
                    onAction={() => onNavigate({ name: 'category' })}
                />
            ) : (
                <>
                    <div className="cart-groups">
                        {!!physical.length && (
                            <CartGroup
                                title={isZh ? '普通商品' : 'Physical products'}
                                hint={isZh ? '配送方式结算时确认' : 'Delivery confirmed at checkout'}
                                lines={physical}
                                market={market}
                                locale={locale}
                                language={language}
                                loading={loading || locked}
                                onSelect={onSelect}
                                onSelectAll={onSelectGroup}
                                onQuantity={onQuantity}
                                onRemove={onRemove}
                            />
                        )}
                        {!!digital.length && (
                            <CartGroup
                                title={isZh ? '数字商品' : 'Digital products'}
                                hint={isZh ? '付款后自动交付' : 'Delivered after payment'}
                                lines={digital}
                                market={market}
                                locale={locale}
                                language={language}
                                loading={loading || locked}
                                onSelect={onSelect}
                                onSelectAll={onSelectGroup}
                                onQuantity={onQuantity}
                                onRemove={onRemove}
                            />
                        )}
                    </div>
                    <button
                        className="coupon-row"
                        type="button"
                        onClick={() => setCouponOpen(true)}
                        disabled={!order || locked}
                    >
                        <span>
                            <TicketPercent />
                            <strong>{isZh ? '优惠信息' : 'Offers'}</strong>
                        </span>
                        <span>
                            <small>
                                {discount
                                    ? isZh
                                        ? `已优惠 ${formatMoney(discount, order?.currencyCode ?? market.currencyCode, locale)}`
                                        : `${formatMoney(discount, order?.currencyCode ?? market.currencyCode, locale)} saved`
                                    : isZh
                                      ? '输入优惠码'
                                      : 'Enter coupon code'}
                            </small>
                            <ChevronRight />
                        </span>
                    </button>
                    {!!invalidLines.length && (
                        <section className="invalid-cart-lines">
                            <button
                                type="button"
                                onClick={() => setInvalidOpen(open => !open)}
                                aria-expanded={invalidOpen}
                            >
                                <span>
                                    {isZh
                                        ? `失效商品 ${invalidLines.length} 件`
                                        : `${invalidLines.length} unavailable items`}
                                </span>
                                <span>
                                    {invalidOpen ? (isZh ? '收起' : 'Collapse') : isZh ? '展开' : 'Expand'}{' '}
                                    <ChevronRight />
                                </span>
                            </button>
                            {invalidOpen && (
                                <div>
                                    {invalidLines.map(line => (
                                        <article key={line.id}>
                                            <div className="image-placeholder">
                                                <Package />
                                            </div>
                                            <span>
                                                <strong>
                                                    {line.productVariant?.name ??
                                                        (isZh ? '商品已失效' : 'Unavailable item')}
                                                </strong>
                                                <small>
                                                    {isZh
                                                        ? '当前规格暂不可购买'
                                                        : 'This variant cannot be purchased'}
                                                </small>
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => onRemove(line.id)}
                                                disabled={loading || locked}
                                            >
                                                {isZh ? '删除' : 'Remove'}
                                            </button>
                                        </article>
                                    ))}
                                </div>
                            )}
                        </section>
                    )}
                    {!locked && (
                        <ProductSection
                            title={isZh ? '顺手带一件' : 'Complete the order'}
                            subtitle={isZh ? '从当前店铺继续挑选' : 'More from this store'}
                            products={products
                                .filter(
                                    product =>
                                        !lines.some(
                                            line => line.productVariant?.id === product.variants[0]?.id,
                                        ),
                                )
                                .slice(0, 4)}
                            market={market}
                            locale={locale}
                            addingVariantId={addingVariantId}
                            onProduct={product => onNavigate({ name: 'product', id: product.id })}
                            onAdd={onAdd}
                        />
                    )}
                </>
            )}

            {!!lines.length && (
                <div className="cart-checkout-bar">
                    <div>
                        <span>
                            {isZh ? '合计' : 'Total'}{' '}
                            <strong>
                                {formatMoney(amount, order?.currencyCode ?? market.currencyCode, locale)}
                            </strong>
                        </span>
                        <small>
                            {locked && order
                                ? digitalOnly
                                    ? isZh
                                        ? '无需配送'
                                        : 'No shipping required'
                                    : order.shippingWithTax > 0
                                      ? isZh
                                          ? `已含配送费 ${formatMoney(order.shippingWithTax, order.currencyCode, locale)}`
                                          : `Includes ${formatMoney(order.shippingWithTax, order.currencyCode, locale)} delivery`
                                      : isZh
                                        ? '配送费已确认'
                                        : 'Delivery confirmed'
                                : discount
                                  ? isZh
                                      ? `已优惠 ${formatMoney(discount, order?.currencyCode ?? market.currencyCode, locale)}`
                                      : `${formatMoney(discount, order?.currencyCode ?? market.currencyCode, locale)} saved`
                                  : digitalOnly
                                    ? isZh
                                        ? '无需配送'
                                        : 'No shipping required'
                                    : isZh
                                      ? '不含待计算运费'
                                      : 'Shipping not included'}
                        </small>
                    </div>
                    <button
                        type="button"
                        onClick={onCheckout}
                        disabled={loading || locked || !cart?.selectedQuantity}
                    >
                        {locked
                            ? isZh
                                ? '订单待支付'
                                : 'Payment pending'
                            : isZh
                              ? `结算（${cart?.selectedQuantity ?? 0}）`
                              : `Checkout (${cart?.selectedQuantity ?? 0})`}
                    </button>
                </div>
            )}
            {couponOpen && order && (
                <CouponSheet
                    couponCodes={order.couponCodes}
                    language={language}
                    loading={loading}
                    onApply={onApplyCoupon}
                    onRemove={onRemoveCoupon}
                    onClose={() => setCouponOpen(false)}
                />
            )}
        </main>
    );
}

interface AccountPageProps {
    api: ShopApi;
    customer: ActiveCustomer | null;
    products: Product[];
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    storefrontName: string;
    favoriteProductCount: number;
    recentProductCount: number;
    couponCount: number;
    addingVariantId: string | null;
    onNavigate: (route: RouteState) => void;
    onAdd: (variant: ProductVariant) => void;
    onLogout: () => void;
}

function AccountPage(props: AccountPageProps) {
    const {
        api,
        customer,
        products,
        market,
        locale,
        language,
        storefrontName,
        favoriteProductCount,
        recentProductCount,
        couponCount,
        addingVariantId,
        onNavigate,
        onAdd,
        onLogout,
    } = props;
    const isZh = language === 'zh';
    const orders = customer?.orders.items ?? [];
    const countsQuery = useQuery({
        queryKey: storefrontQueryKeys.customerOrderCounts(
            market.code,
            languageCodeFor(language),
            customer?.id ?? '',
        ),
        queryFn: ({ signal }) => api.customerOrderCounts(signal),
        enabled: !!customer,
        staleTime: ROUTE_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
    });
    const counts = countsQuery.data ?? { pending: 0, shipping: 0, receiving: 0 };
    const afterSalesQuery = useQuery({
        queryKey: storefrontQueryKeys.afterSalesRequests(
            market.code,
            languageCodeFor(language),
            customer?.id ?? '',
        ),
        queryFn: ({ signal }) => api.afterSalesRequests(signal),
        enabled: Boolean(customer),
        staleTime: ROUTE_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
    });
    const activeAfterSalesCount = (afterSalesQuery.data ?? []).filter(request =>
        ['PENDING', 'APPROVED'].includes(request.state),
    ).length;
    const latestOrder = orders[0];
    const recentVariants = Array.from(
        new Map(
            orders.flatMap(order => order.lines).map(line => [line.productVariant.id, line.productVariant]),
        ).values(),
    ).slice(0, 2);
    const customerName = customer
        ? `${customer.lastName}${customer.firstName}`.trim() || customer.emailAddress
        : '';

    return (
        <main className="page account-page">
            <section
                className={`account-identity-hero${customer ? ' is-authenticated' : ' is-guest'}`}
                aria-labelledby={customer ? undefined : 'guest-account-title'}
            >
                <div className="account-hero-brand" aria-label={storefrontName}>
                    <span className="account-hero-brand-mark">
                        <Cloud aria-hidden="true" />
                    </span>
                    <strong>{storefrontName.replace(/ai$/i, '')}</strong>
                    {/ai$/i.test(storefrontName) && <b>{storefrontName.slice(-2)}</b>}
                </div>
                {customer ? (
                    <div className="account-hero-customer">
                        <button
                            className="account-hero-customer-summary"
                            type="button"
                            onClick={() => onNavigate({ name: 'account-security' })}
                        >
                            <span className="account-hero-avatar">
                                {customerName.slice(0, 1).toUpperCase()}
                            </span>
                            <span>
                                <strong>{isZh ? `${customerName}，你好` : `Hello, ${customerName}`}</strong>
                                <small>{isZh ? '普通会员' : 'Member'}</small>
                                <em>{customer.emailAddress}</em>
                            </span>
                        </button>
                        <div className="account-hero-manage">
                            <button
                                type="button"
                                onClick={() => onNavigate({ name: 'account-security' })}
                            >
                                {isZh ? '管理账户' : 'Manage account'}
                                <ChevronRight aria-hidden="true" />
                            </button>
                            <button
                                type="button"
                                onClick={() => onNavigate({ name: 'account-security' })}
                                aria-label={isZh ? '账户设置' : 'Account settings'}
                            >
                                <Settings aria-hidden="true" />
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="account-hero-guest">
                        <div>
                            <h1 id="guest-account-title">
                                {isZh ? `登录${storefrontName}账户` : `Sign in to ${storefrontName}`}
                            </h1>
                            <p>
                                {isZh
                                    ? '连接订单、服务与智能体验'
                                    : 'Connect orders, services and intelligent experiences'}
                            </p>
                        </div>
                        <div className="account-hero-actions">
                            <button type="button" onClick={() => onNavigate({ name: 'login' })}>
                                {isZh ? '登录' : 'Sign in'}
                            </button>
                            <button type="button" onClick={() => onNavigate({ name: 'register' })}>
                                {isZh ? '注册账户' : 'Create account'}
                            </button>
                        </div>
                    </div>
                )}
            </section>

            <section className="account-section order-shortcuts">
                <nav>
                    <AccountShortcut
                        icon={<WalletCards />}
                        label={isZh ? '待付款' : 'To pay'}
                        count={counts.pending}
                        onClick={() => onNavigate({ name: 'orders', tab: 'pending' })}
                    />
                    <AccountShortcut
                        icon={<Package />}
                        label={isZh ? '待发货' : 'To ship'}
                        count={counts.shipping}
                        onClick={() => onNavigate({ name: 'orders', tab: 'shipping' })}
                    />
                    <AccountShortcut
                        icon={<Truck />}
                        label={isZh ? '待收货' : 'To receive'}
                        count={counts.receiving}
                        onClick={() => onNavigate({ name: 'orders', tab: 'receiving' })}
                    />
                    <AccountShortcut
                        icon={<RotateCcw />}
                        label={isZh ? '退款/售后' : 'After-sales'}
                        count={activeAfterSalesCount}
                        onClick={() => onNavigate({ name: 'orders', tab: 'service' })}
                    />
                    <AccountShortcut
                        icon={<ClipboardList />}
                        label={isZh ? '全部订单' : 'All orders'}
                        count={0}
                        onClick={() => onNavigate({ name: 'orders', tab: 'all' })}
                    />
                </nav>
            </section>

            {latestOrder && (
                <section className="account-section tracking-card">
                    <header>
                        <span>
                            <Navigation />
                            <strong>{isZh ? '最新物流' : 'Latest delivery'}</strong>
                        </span>
                        <small>{formatOrderDate(latestOrder.orderPlacedAt, locale)}</small>
                    </header>
                    <button
                        type="button"
                        onClick={() => onNavigate({ name: 'order-detail', id: latestOrder.id })}
                    >
                        <OrderImage order={latestOrder} />
                        <span>
                            <strong>{orderStateLabel(latestOrder.state, language)}</strong>
                            <small>{isZh ? `订单号 ${latestOrder.code}` : `Order ${latestOrder.code}`}</small>
                        </span>
                        <ChevronRight />
                    </button>
                </section>
            )}

            <section className="account-section services-section">
                <h2>{isZh ? '常用服务' : 'Services'}</h2>
                <div>
                    <ServiceButton
                        icon={<Heart />}
                        label={
                            favoriteProductCount
                                ? isZh
                                    ? `收藏 ${favoriteProductCount}`
                                    : `Favorites ${favoriteProductCount}`
                                : isZh
                                  ? '我的收藏'
                                  : 'Favorites'
                        }
                        onClick={() => onNavigate({ name: 'favorites' })}
                    />
                    <ServiceButton
                        icon={<MapPin />}
                        label={isZh ? '地址管理' : 'Addresses'}
                        onClick={() =>
                            customer ? onNavigate({ name: 'addresses' }) : onNavigate({ name: 'login' })
                        }
                    />
                    <ServiceButton
                        icon={<Clock3 />}
                        label={
                            recentProductCount
                                ? isZh
                                    ? `足迹 ${recentProductCount}`
                                    : `History ${recentProductCount}`
                                : isZh
                                  ? '浏览足迹'
                                  : 'History'
                        }
                        onClick={() => onNavigate({ name: 'history' })}
                    />
                    <ServiceButton
                        icon={<Bell />}
                        label={isZh ? '消息通知' : 'Notifications'}
                        onClick={() => onNavigate({ name: 'notifications' })}
                    />
                    <ServiceButton
                        icon={<TicketPercent />}
                        label={isZh ? '优惠券' : 'Coupons'}
                        badge={couponCount > 0 ? String(couponCount) : undefined}
                        onClick={() => onNavigate({ name: 'coupons' })}
                    />
                    <ServiceButton
                        icon={<CircleCheck />}
                        label={isZh ? '评价中心' : 'Reviews'}
                        onClick={() => onNavigate({ name: 'reviews' })}
                    />
                    <ServiceButton
                        icon={<Headphones />}
                        label={isZh ? '客服中心' : 'Support'}
                        onClick={() => onNavigate({ name: 'support' })}
                    />
                    <ServiceButton
                        icon={<Store />}
                        label={isZh ? '店铺首页' : 'Store home'}
                        onClick={() => onNavigate({ name: 'home' })}
                    />
                </div>
            </section>

            <button
                className="security-row"
                type="button"
                onClick={() =>
                    customer ? onNavigate({ name: 'account-security' }) : onNavigate({ name: 'login' })
                }
            >
                <span>
                    <Fingerprint />
                    <strong>{isZh ? '账户与安全' : 'Account and security'}</strong>
                </span>
                <span>
                    {isZh ? '手机号、密码与隐私' : 'Phone, password and privacy'} <ChevronRight />
                </span>
            </button>

            {!!recentVariants.length && (
                <section className="account-section recent-purchases">
                    <SectionHeader
                        title={isZh ? '最近买过' : 'Recently purchased'}
                        action={isZh ? '查看订单' : 'View orders'}
                        onAction={() => onNavigate({ name: 'orders', tab: 'all' })}
                    />
                    <div>
                        {recentVariants.map(variant => (
                            <article key={variant.id}>
                                <ProductVariantImage variant={variant} alt={variant.name} />
                                <span>
                                    <strong>{variant.name}</strong>
                                    <small>{variant.sku}</small>
                                </span>
                                <button
                                    type="button"
                                    onClick={() => onAdd(variant)}
                                    disabled={addingVariantId === variant.id}
                                >
                                    {isZh ? '再次购买' : 'Buy again'}
                                </button>
                            </article>
                        ))}
                    </div>
                </section>
            )}

            {customer && (
                <button className="logout-button" type="button" onClick={onLogout}>
                    {isZh ? '退出登录' : 'Sign out'}
                </button>
            )}

            <ProductSection
                title={isZh ? '为你推荐' : 'Recommended for you'}
                subtitle={isZh ? '继续发现合适的好物' : 'Keep discovering'}
                products={products.slice(0, 4)}
                market={market}
                locale={locale}
                addingVariantId={addingVariantId}
                onProduct={product => onNavigate({ name: 'product', id: product.id })}
                onAdd={onAdd}
            />
            <LegalFooter storefrontName={storefrontName} />
        </main>
    );
}

export function FavoriteProductsPage({
    api,
    productIds,
    market,
    locale,
    language,
    addingVariantId,
    onBack,
    onNavigate,
    onAdd,
    onRemove,
    onClear,
}: {
    api: ShopApi;
    productIds: string[];
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    addingVariantId: string | null;
    onBack: () => void;
    onNavigate: (route: RouteState) => void;
    onAdd: (variant: ProductVariant) => void;
    onRemove: (productId: string) => void;
    onClear: () => void;
}) {
    const isZh = language === 'zh';
    const favoritesQuery = useProductsByIdsQuery({ api, productIds, market, language });
    const favoriteProducts = productIds.length ? (favoritesQuery.data ?? []) : [];
    const loading = productIds.length > 0 && favoritesQuery.isPending;
    const favoriteError =
        !favoriteProducts.length && favoritesQuery.error instanceof Error ? favoritesQuery.error.message : '';
    const availableProducts = favoriteProducts.filter(product => productIds.includes(product.id));

    return (
        <main className="page subpage favorites-page">
            <SubHeader
                title={isZh ? '我的收藏' : 'My favorites'}
                language={language}
                onBack={onBack}
                action={
                    productIds.length ? (
                        <button
                            type="button"
                            onClick={onClear}
                            aria-label={isZh ? '清空收藏' : 'Clear favorites'}
                        >
                            <Trash2 />
                        </button>
                    ) : undefined
                }
            />
            {loading && !favoriteProducts.length ? (
                <PageSkeleton />
            ) : favoriteError ? (
                <EmptyState
                    icon={<WifiOff />}
                    title={isZh ? '收藏商品加载失败' : 'Could not load favorites'}
                    detail={favoriteError}
                    action={isZh ? '重试' : 'Retry'}
                    onAction={() => void favoritesQuery.refetch()}
                />
            ) : availableProducts.length ? (
                <ProductSection
                    title={isZh ? '已收藏商品' : 'Saved products'}
                    subtitle={
                        isZh
                            ? `共 ${availableProducts.length} 件商品`
                            : `${availableProducts.length} products`
                    }
                    products={availableProducts}
                    market={market}
                    locale={locale}
                    addingVariantId={addingVariantId}
                    favoriteProductIds={productIds}
                    onProduct={product => onNavigate({ name: 'product', id: product.id })}
                    onFavorite={product => onRemove(product.id)}
                    onAdd={onAdd}
                />
            ) : (
                <EmptyState
                    icon={<Heart />}
                    title={isZh ? '暂无收藏商品' : 'No favorites yet'}
                    detail={
                        productIds.length
                            ? isZh
                                ? '已收藏的商品已下架'
                                : 'Your saved products are no longer available'
                            : isZh
                              ? '点击商品详情页的收藏按钮，商品会保存在这里'
                              : 'Save products from their detail page and they will appear here'
                    }
                    action={isZh ? '去逛商品' : 'Browse products'}
                    onAction={() => onNavigate({ name: 'category' })}
                />
            )}
        </main>
    );
}

export function BrowsingHistoryPage({
    api,
    productIds,
    market,
    locale,
    language,
    addingVariantId,
    onBack,
    onNavigate,
    onAdd,
    onClear,
}: {
    api: ShopApi;
    productIds: string[];
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    addingVariantId: string | null;
    onBack: () => void;
    onNavigate: (route: RouteState) => void;
    onAdd: (variant: ProductVariant) => void;
    onClear: () => void;
}) {
    const isZh = language === 'zh';
    const historyQuery = useProductsByIdsQuery({ api, productIds, market, language });
    const historyProducts = productIds.length ? (historyQuery.data ?? []) : [];
    const loading = productIds.length > 0 && historyQuery.isPending;
    const historyError =
        !historyProducts.length && historyQuery.error instanceof Error ? historyQuery.error.message : '';

    return (
        <main className="page subpage history-page">
            <SubHeader
                title={isZh ? '浏览足迹' : 'Browsing history'}
                language={language}
                onBack={onBack}
                action={
                    productIds.length ? (
                        <button
                            type="button"
                            onClick={onClear}
                            aria-label={isZh ? '清空浏览足迹' : 'Clear browsing history'}
                        >
                            <Trash2 />
                        </button>
                    ) : undefined
                }
            />
            {loading && !historyProducts.length ? (
                <PageSkeleton />
            ) : historyError ? (
                <EmptyState
                    icon={<WifiOff />}
                    title={isZh ? '浏览足迹加载失败' : 'Could not load browsing history'}
                    detail={historyError}
                    action={isZh ? '重试' : 'Retry'}
                    onAction={() => void historyQuery.refetch()}
                />
            ) : historyProducts.length ? (
                <ProductSection
                    title={isZh ? '最近浏览' : 'Recently viewed'}
                    subtitle={
                        isZh ? `共 ${historyProducts.length} 件商品` : `${historyProducts.length} products`
                    }
                    products={historyProducts}
                    market={market}
                    locale={locale}
                    addingVariantId={addingVariantId}
                    onProduct={product => onNavigate({ name: 'product', id: product.id })}
                    onAdd={onAdd}
                />
            ) : (
                <EmptyState
                    icon={<Clock3 />}
                    title={isZh ? '暂无浏览足迹' : 'No browsing history'}
                    detail={
                        productIds.length
                            ? isZh
                                ? '最近浏览的商品已下架'
                                : 'Recently viewed products are no longer available'
                            : isZh
                              ? '浏览商品后会记录在这里'
                              : 'Products you view will appear here'
                    }
                    action={isZh ? '去逛商品' : 'Browse products'}
                    onAction={() => onNavigate({ name: 'category' })}
                />
            )}
        </main>
    );
}

function SupportPage({
    content,
    products,
    language,
    onBack,
    onContentTarget,
}: {
    content?: StorefrontContentBlock;
    products: Product[];
    language: StorefrontLanguage;
    onBack: () => void;
    onContentTarget: (targetType: StorefrontContentTargetType, targetValue: string | null) => void;
}) {
    const isZh = language === 'zh';
    return (
        <Subpage title={isZh ? '客服中心' : 'Customer support'} language={language} onBack={onBack}>
            {content ? (
                <ManagedContentSection
                    block={content}
                    products={products}
                    onContentTarget={onContentTarget}
                />
            ) : (
                <EmptyState
                    icon={<Headphones />}
                    title={isZh ? '客服信息暂未配置' : 'Support is not configured yet'}
                    detail={
                        isZh
                            ? '待商家配置电话、邮箱或在线客服后，将在这里显示'
                            : 'Phone, email, or online support will appear here after merchant setup'
                    }
                />
            )}
        </Subpage>
    );
}

function CouponCenterPage({
    order,
    language,
    loading,
    onBack,
    onNavigate,
    onApply,
    onRemove,
}: {
    order: Order | null;
    language: StorefrontLanguage;
    loading: boolean;
    onBack: () => void;
    onNavigate: (route: RouteState) => void;
    onApply: (couponCode: string) => Promise<string | null>;
    onRemove: (couponCode: string) => Promise<string | null>;
}) {
    const isZh = language === 'zh';
    const [couponCode, setCouponCode] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const normalizedCode = couponCode.trim();
        if (!normalizedCode || submitting) return;
        setSubmitting(true);
        setError('');
        const nextError = await onApply(normalizedCode);
        setSubmitting(false);
        if (nextError) setError(nextError);
        else setCouponCode('');
    };
    const remove = async (code: string) => {
        if (submitting) return;
        setSubmitting(true);
        setError('');
        const nextError = await onRemove(code);
        setSubmitting(false);
        if (nextError) setError(nextError);
    };
    return (
        <Subpage title={isZh ? '优惠券' : 'Coupons'} language={language} onBack={onBack}>
            {!order ? (
                <EmptyState
                    icon={<TicketPercent />}
                    title={isZh ? '还没有可使用优惠码的订单' : 'No active order for coupons'}
                    detail={
                        isZh
                            ? '将商品加入购物车后，可在这里录入商家发放的优惠码'
                            : 'Add an item to cart, then enter a coupon code issued by the store here'
                    }
                    action={isZh ? '去选购' : 'Shop now'}
                    onAction={() => onNavigate({ name: 'category' })}
                />
            ) : (
                <section className="coupon-center" aria-busy={loading || submitting}>
                    <div className="coupon-center-intro">
                        <TicketPercent aria-hidden="true" />
                        <span>
                            <strong>{isZh ? '使用商家优惠码' : 'Use a store coupon code'}</strong>
                            <small>
                                {isZh
                                    ? '优惠码由商家活动发放，应用后会自动重新计算当前订单优惠'
                                    : 'Codes are issued by store campaigns and recalculate the active order automatically'}
                            </small>
                        </span>
                    </div>
                    <form
                        className="coupon-code-form coupon-center-form"
                        onSubmit={event => void submit(event)}
                    >
                        <label>
                            <span>{isZh ? '输入优惠码' : 'Enter coupon code'}</span>
                            <input
                                value={couponCode}
                                onChange={event => setCouponCode(event.target.value)}
                                autoComplete="off"
                                placeholder={isZh ? '例如 SAVE10' : 'For example, SAVE10'}
                                disabled={loading || submitting}
                            />
                        </label>
                        <button type="submit" disabled={loading || submitting || !couponCode.trim()}>
                            {submitting ? (isZh ? '处理中' : 'Applying') : isZh ? '应用' : 'Apply'}
                        </button>
                    </form>
                    <section className="applied-coupons coupon-center-applied">
                        <strong>{isZh ? '当前订单已使用' : 'Applied to the active order'}</strong>
                        {order.couponCodes.length ? (
                            order.couponCodes.map(code => (
                                <div key={code}>
                                    <span>
                                        <TicketPercent aria-hidden="true" />
                                        {code}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => void remove(code)}
                                        disabled={loading || submitting}
                                    >
                                        {isZh ? '移除' : 'Remove'}
                                    </button>
                                </div>
                            ))
                        ) : (
                            <p>{isZh ? '暂未应用优惠码' : 'No coupon code applied yet'}</p>
                        )}
                    </section>
                    {error && (
                        <small className="form-error" role="alert">
                            {error}
                        </small>
                    )}
                    <button
                        className="coupon-center-cart-link"
                        type="button"
                        onClick={() => onNavigate({ name: 'cart' })}
                    >
                        {isZh ? '查看购物车和优惠明细' : 'View cart and discount details'}
                        <ChevronRight aria-hidden="true" />
                    </button>
                </section>
            )}
        </Subpage>
    );
}

function NotificationsPage({
    api,
    customer,
    market,
    locale,
    language,
    onBack,
    onNavigate,
}: {
    api: ShopApi;
    customer: ActiveCustomer | null;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    onBack: () => void;
    onNavigate: (route: RouteState) => void;
}) {
    const isZh = language === 'zh';
    const orders = customer?.orders.items ?? [];
    const afterSalesQuery = useQuery({
        queryKey: storefrontQueryKeys.afterSalesRequests(
            market.code,
            languageCodeFor(language),
            customer?.id ?? '',
        ),
        queryFn: ({ signal }) => api.afterSalesRequests(signal),
        enabled: Boolean(customer),
        staleTime: ROUTE_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
    });
    const afterSalesRequests = afterSalesQuery.data ?? [];
    return (
        <Subpage title={isZh ? '消息通知' : 'Notifications'} language={language} onBack={onBack}>
            {!customer ? (
                <EmptyState
                    icon={<Bell />}
                    title={isZh ? '登录后查看通知' : 'Sign in to view notifications'}
                    detail={isZh ? '订单状态更新会显示在这里' : 'Order status updates will appear here'}
                    action={isZh ? '去登录' : 'Sign in'}
                    onAction={() => onNavigate({ name: 'login' })}
                />
            ) : orders.length || afterSalesRequests.length ? (
                <section
                    className="notification-list"
                    aria-label={isZh ? '最近通知' : 'Recent notifications'}
                >
                    {afterSalesRequests.map(request => {
                        const notification = afterSalesNotification(request, language);
                        return (
                            <button
                                type="button"
                                key={`after-sales-${request.id}`}
                                onClick={() => onNavigate({ name: 'orders', tab: 'service' })}
                            >
                                <span className={`notification-icon is-${notification.tone}`}>
                                    <RotateCcw aria-hidden="true" />
                                </span>
                                <span>
                                    <strong>{notification.title}</strong>
                                    <small>{notification.detail}</small>
                                    <em>
                                        {formatBusinessDate(locale, request.updatedAt, {
                                            month: 'short',
                                            day: 'numeric',
                                            hour: '2-digit',
                                            minute: '2-digit',
                                        })}
                                    </em>
                                </span>
                                <ChevronRight aria-hidden="true" />
                            </button>
                        );
                    })}
                    {orders.map(order => {
                        const notification = orderNotification(order, language);
                        return (
                            <button
                                type="button"
                                key={order.id}
                                onClick={() => onNavigate({ name: 'order-detail', id: order.id })}
                            >
                                <span className={`notification-icon is-${notification.tone}`}>
                                    <Bell aria-hidden="true" />
                                </span>
                                <span>
                                    <strong>{notification.title}</strong>
                                    <small>{notification.detail}</small>
                                    <em>
                                        {order.orderPlacedAt
                                            ? formatBusinessDate(locale, order.orderPlacedAt, {
                                                  month: 'short',
                                                  day: 'numeric',
                                                  hour: '2-digit',
                                                  minute: '2-digit',
                                              })
                                            : '--'}
                                    </em>
                                </span>
                                <ChevronRight aria-hidden="true" />
                            </button>
                        );
                    })}
                </section>
            ) : (
                <EmptyState
                    icon={<Bell />}
                    title={isZh ? '暂无消息' : 'No notifications'}
                    detail={isZh ? '订单状态更新会显示在这里' : 'Order status updates will appear here'}
                    action={isZh ? '返回首页' : 'Back to home'}
                    onAction={() => onNavigate({ name: 'home' })}
                />
            )}
        </Subpage>
    );
}

function afterSalesNotification(
    request: AfterSalesRequest,
    language: StorefrontLanguage,
): { title: string; detail: string; tone: 'pending' | 'progress' | 'complete' | 'muted' } {
    const isZh = language === 'zh';
    const titleByState: Record<AfterSalesRequest['state'], string> = {
        PENDING: isZh ? '售后申请等待处理' : 'After-sales request awaiting review',
        APPROVED: isZh ? '售后申请已通过' : 'After-sales request approved',
        REJECTED: isZh ? '售后申请未通过' : 'After-sales request not approved',
        CANCELLED: isZh ? '售后申请已撤销' : 'After-sales request cancelled',
        COMPLETED: isZh ? '售后处理已完成' : 'After-sales request completed',
    };
    return {
        title: titleByState[request.state],
        detail: isZh
            ? `申请 ${request.code} · 订单 ${request.order.code}`
            : `${request.code} · Order ${request.order.code}`,
        tone:
            request.state === 'PENDING'
                ? 'pending'
                : request.state === 'APPROVED'
                  ? 'progress'
                  : request.state === 'COMPLETED'
                    ? 'complete'
                    : 'muted',
    };
}

function orderNotification(
    order: Order,
    language: StorefrontLanguage,
): { title: string; detail: string; tone: 'pending' | 'progress' | 'complete' | 'muted' } {
    const isZh = language === 'zh';
    if (['AddingItems', 'ArrangingPayment'].includes(order.state)) {
        return {
            title: isZh ? '订单等待支付' : 'Order awaiting payment',
            detail: isZh ? `订单 ${order.code} 已保留，可继续支付或修改` : `Order ${order.code} is saved`,
            tone: 'pending',
        };
    }
    if (['PaymentAuthorized', 'PaymentSettled'].includes(order.state)) {
        return {
            title: order.checkoutFulfillment?.containsDigitalProducts
                ? isZh
                    ? '数字商品已进入交付流程'
                    : 'Digital delivery is ready'
                : isZh
                  ? '商家正在准备订单'
                  : 'Your order is being prepared',
            detail: isZh ? `查看订单 ${order.code} 的最新状态` : `View the latest status for ${order.code}`,
            tone: 'progress',
        };
    }
    if (['Shipped', 'PartiallyShipped'].includes(order.state)) {
        return {
            title: isZh ? '订单已发货' : 'Order shipped',
            detail: isZh ? `订单 ${order.code} 已有物流更新` : `Tracking is available for ${order.code}`,
            tone: 'progress',
        };
    }
    if (order.state === 'Delivered') {
        return {
            title: isZh ? '订单已完成' : 'Order completed',
            detail: isZh ? `订单 ${order.code} 已完成交付` : `Order ${order.code} was delivered`,
            tone: 'complete',
        };
    }
    return {
        title: order.state === 'Cancelled' ? (isZh ? '订单已取消' : 'Order cancelled') : order.state,
        detail: isZh ? `查看订单 ${order.code}` : `View order ${order.code}`,
        tone: 'muted',
    };
}

function ProductDetailPage({
    api,
    product,
    products,
    cartQuantity,
    market,
    locale,
    language,
    storefrontName,
    addingVariantId,
    favorite,
    onBack,
    onNavigate,
    onAdd,
    onFavorite,
    onNotify,
}: {
    api: ShopApi;
    product: Product;
    products: Product[];
    cartQuantity: number;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    storefrontName: string;
    addingVariantId: string | null;
    favorite: boolean;
    onBack: () => void;
    onNavigate: (route: RouteState) => void;
    onAdd: (variant: ProductVariant, buyNow?: boolean) => void;
    onFavorite: () => void;
    onNotify: (message: string) => void;
}) {
    const isZh = language === 'zh';
    const [variantId, setVariantId] = useState(product.variants[0]?.id ?? '');
    const [activeImage, setActiveImage] = useState(0);
    const [headerScrolled, setHeaderScrolled] = useState(false);
    const variant = product.variants.find(item => item.id === variantId) ?? product.variants[0];
    const assets = product.assets.length
        ? product.assets
        : product.featuredAsset
          ? [product.featuredAsset]
          : [];
    const unavailable =
        !variant ||
        (variant.customFields.fulfillmentType === 'physical' && variant.stockLevel === 'OUT_OF_STOCK');
    const isDigital = variant?.customFields.fulfillmentType === 'digital';
    const similarProducts = products.filter(item => item.id !== product.id).slice(0, 4);
    const shareProduct = async () => {
        try {
            if (navigator.share) {
                await navigator.share({ title: product.name, text: product.description, url: location.href });
            } else {
                await navigator.clipboard.writeText(location.href);
                onNotify(isZh ? '商品链接已复制' : 'Product link copied');
            }
        } catch (shareError) {
            if (shareError instanceof DOMException && shareError.name === 'AbortError') return;
            onNotify(isZh ? '暂时无法分享商品' : 'Could not share this product');
        }
    };

    useEffect(() => {
        const updateHeader = () => setHeaderScrolled(window.scrollY > 16);
        updateHeader();
        window.addEventListener('scroll', updateHeader, { passive: true });
        return () => window.removeEventListener('scroll', updateHeader);
    }, []);

    const prefetchAdjacentGalleryImages = () => {
        scheduleIdleWork(() => {
            for (const index of [activeImage - 1, activeImage + 1]) {
                const asset = assets[index];
                if (asset) prefetchStorefrontImage(asset.preview, 'detail');
            }
        });
    };

    return (
        <main className="page subpage product-detail-page">
            <SubHeader
                className={`product-detail-header${headerScrolled ? ' is-scrolled' : ''}`}
                title={isZh ? '商品详情' : 'Product details'}
                language={language}
                onBack={onBack}
                action={
                    <button
                        type="button"
                        onClick={() => void shareProduct()}
                        aria-label={isZh ? '分享' : 'Share'}
                    >
                        <Share2 />
                    </button>
                }
            />
            <section className="detail-gallery">
                {assets[activeImage] ? (
                    <SafeImage
                        src={assets[activeImage].preview}
                        alt={`${product.name} ${activeImage + 1}`}
                        imageKind="detail"
                        placeholderSrc={productImage(product) ?? undefined}
                        loading="eager"
                        fetchPriority="high"
                        onLoad={prefetchAdjacentGalleryImages}
                    />
                ) : (
                    <div className="image-placeholder" aria-hidden="true">
                        <Package />
                    </div>
                )}
                {assets.length > 1 && (
                    <div className="gallery-dots">
                        {assets.map((asset, index) => (
                            <button
                                type="button"
                                key={asset.id}
                                className={index === activeImage ? 'is-active' : undefined}
                                onClick={() => setActiveImage(index)}
                                aria-label={
                                    isZh ? `查看第${index + 1}张商品图` : `View product image ${index + 1}`
                                }
                                aria-current={index === activeImage}
                            />
                        ))}
                    </div>
                )}
                {!!assets.length && (
                    <span className="gallery-count">
                        {activeImage + 1} / {assets.length}
                    </span>
                )}
            </section>
            <section className="detail-summary">
                <div className="detail-price-line">
                    <p className="detail-price">
                        {variant ? formatMoney(variant.priceWithTax, variant.currencyCode, locale) : '--'}
                    </p>
                    <span>
                        {unavailable
                            ? isZh
                                ? '暂时无法购买'
                                : 'Unavailable'
                            : isDigital
                              ? isZh
                                  ? '可在线购买'
                                  : 'Available online'
                              : isZh
                                ? '库存充足'
                                : 'In stock'}
                    </span>
                </div>
                <div className="detail-tags">
                    <span>
                        {isDigital ? (isZh ? '数字商品' : 'Digital') : isZh ? '现货商品' : 'Physical'}
                    </span>
                    <span>
                        {isDigital
                            ? isZh
                                ? '支付后交付'
                                : 'Delivered after payment'
                            : isZh
                              ? '运费结算页计算'
                              : 'Shipping at checkout'}
                    </span>
                </div>
                <h1>{product.name}</h1>
                <p>{product.description || (isZh ? '暂无更多商品说明' : 'No additional description')}</p>
            </section>
            <section className="detail-promotions">
                <div>
                    <span>{isZh ? '优惠' : 'Offers'}</span>
                    <strong>
                        <TicketPercent />
                        {isZh ? '可用优惠将在结算时自动抵扣' : 'Eligible offers apply automatically'}
                    </strong>
                </div>
                <div>
                    <span>{isZh ? '活动' : 'Activity'}</span>
                    <strong>
                        {isZh ? '店铺活动以结算页展示为准' : 'Store promotions are confirmed at checkout'}
                    </strong>
                </div>
            </section>
            <section className="detail-options">
                <header>
                    <strong>{isZh ? '选择规格' : 'Choose an option'}</strong>
                    <span>{variant?.sku}</span>
                </header>
                <div>
                    {product.variants.map(item => (
                        <button
                            type="button"
                            key={item.id}
                            className={item.id === variant?.id ? 'is-active' : undefined}
                            onClick={() => setVariantId(item.id)}
                        >
                            {item.name}
                        </button>
                    ))}
                </div>
            </section>
            <div className="detail-info-row">
                <span>{isDigital ? (isZh ? '获取方式' : 'Access') : isZh ? '送至' : 'Deliver to'}</span>
                <strong>
                    {isDigital
                        ? isZh
                            ? '付款后自动添加到订单'
                            : 'Access details are added to your order after payment'
                        : isZh
                          ? '结算页选择收货地址并确认时效'
                          : 'Choose an address and confirm timing at checkout'}
                </strong>
            </div>
            <section className="detail-service-bar">
                <span>
                    <CircleCheck />
                    {isDigital ? (isZh ? '安全购买' : 'Secure purchase') : isZh ? '正品保障' : 'Authenticity'}
                </span>
                <span>
                    <Truck />
                    {isDigital
                        ? isZh
                            ? '自动交付'
                            : 'Automatic delivery'
                        : isZh
                          ? '配送可追踪'
                          : 'Tracked delivery'}
                </span>
                <span>
                    <RotateCcw />
                    {isZh ? '售后支持' : 'After-sales support'}
                </span>
            </section>
            <ProductReviewsSection api={api} productId={product.id} market={market} language={language} />
            <section className="detail-block detail-shop-block">
                <header>
                    <strong>{isZh ? '店铺信息' : 'Store'}</strong>
                </header>
                <div>
                    <span className="shop-mark">桥</span>
                    <span>
                        <strong>{storefrontName}</strong>
                        <small>{isZh ? '品质商品 · 安心售后' : 'Quality products · Reliable support'}</small>
                    </span>
                    <button type="button" onClick={() => onNavigate({ name: 'home' })}>
                        {isZh ? '进店逛逛' : 'Visit store'}
                    </button>
                </div>
            </section>
            <section className="detail-block detail-params">
                <header>
                    <strong>{isZh ? '商品参数' : 'Product details'}</strong>
                    <span>{variant?.sku}</span>
                </header>
                <dl>
                    <div>
                        <dt>{isZh ? '类型' : 'Type'}</dt>
                        <dd>
                            {isDigital ? (isZh ? '数字商品' : 'Digital') : isZh ? '普通商品' : 'Physical'}
                        </dd>
                    </div>
                    <div>
                        <dt>{isZh ? '规格' : 'Variant'}</dt>
                        <dd>{variant?.name ?? '--'}</dd>
                    </div>
                    <div>
                        <dt>{isZh ? '库存' : 'Stock'}</dt>
                        <dd>
                            {unavailable
                                ? isZh
                                    ? '暂时缺货'
                                    : 'Unavailable'
                                : isZh
                                  ? '库存充足'
                                  : 'In stock'}
                        </dd>
                    </div>
                    <div>
                        <dt>{isZh ? '交付' : 'Delivery'}</dt>
                        <dd>
                            {isDigital ? (isZh ? '自动交付' : 'Automatic') : isZh ? '快递配送' : 'Shipping'}
                        </dd>
                    </div>
                </dl>
            </section>
            <section className="detail-block detail-description">
                <h2>{isZh ? '商品详情' : 'Description'}</h2>
                <p>
                    {product.description ||
                        (isZh
                            ? '商品详细信息由商家后台维护。'
                            : 'Product information is managed by the merchant.')}
                </p>
                {assets[0] && (
                    <SafeImage
                        src={assets[0].preview}
                        alt={isZh ? `${product.name}细节展示` : `${product.name} details`}
                        imageKind="detail"
                        loading="lazy"
                    />
                )}
            </section>
            <ProductSection
                title={isZh ? '相似商品' : 'Similar products'}
                subtitle={isZh ? '继续看看同店好物' : 'More from this store'}
                products={similarProducts}
                market={market}
                locale={locale}
                addingVariantId={addingVariantId}
                onProduct={item => onNavigate({ name: 'product', id: item.id })}
                onAdd={item => onAdd(item)}
            />
            <div className="detail-action-bar">
                <button
                    className={`detail-favorite-action${favorite ? ' is-active' : ''}`}
                    type="button"
                    aria-pressed={favorite}
                    aria-label={
                        favorite
                            ? isZh
                                ? '取消收藏'
                                : 'Remove from favorites'
                            : isZh
                              ? '收藏商品'
                              : 'Add to favorites'
                    }
                    onClick={() => {
                        onFavorite();
                        onNotify(
                            favorite
                                ? isZh
                                    ? '已取消收藏'
                                    : 'Removed from favorites'
                                : isZh
                                  ? '已收藏'
                                  : 'Added to favorites',
                        );
                    }}
                >
                    <Heart fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" />
                    <span>{favorite ? (isZh ? '已收藏' : 'Saved') : isZh ? '收藏' : 'Save'}</span>
                </button>
                <button type="button" onClick={() => onNavigate({ name: 'cart' })}>
                    <ShoppingCart />
                    <span>{isZh ? '购物车' : 'Cart'}</span>
                    {cartQuantity > 0 && <b>{cartQuantity}</b>}
                </button>
                <button
                    type="button"
                    disabled={unavailable || addingVariantId !== null}
                    onClick={() => variant && onAdd(variant)}
                >
                    {addingVariantId === variant?.id
                        ? isZh
                            ? '添加中'
                            : 'Adding'
                        : isZh
                          ? '加入购物车'
                          : 'Add to cart'}
                </button>
                <button
                    type="button"
                    disabled={unavailable || addingVariantId !== null}
                    onClick={() => variant && onAdd(variant, true)}
                >
                    {unavailable ? (isZh ? '暂时缺货' : 'Unavailable') : isZh ? '立即购买' : 'Buy now'}
                </button>
            </div>
        </main>
    );
}

function SearchPage({
    api,
    products,
    market,
    locale,
    language,
    storefrontCode,
    initialQuery,
    addingVariantId,
    onBack,
    onNavigate,
    onAdd,
}: {
    api: ShopApi;
    products: Product[];
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    storefrontCode: string;
    initialQuery: string;
    addingVariantId: string | null;
    onBack: () => void;
    onNavigate: (route: RouteState) => void;
    onAdd: (variant: ProductVariant) => void;
}) {
    const queryClient = useQueryClient();
    const isZh = language === 'zh';
    const [query, setQuery] = useState(initialQuery);
    const [submittedQuery, setSubmittedQuery] = useState(initialQuery);
    const [resultSort, setResultSort] = useState<ProductSearchSort>('recommended');
    const [history, setHistory] = useState<string[]>([]);
    const searchHistoryStorageKey = scopedStorageKey(SEARCH_HISTORY_STORAGE_KEY, storefrontCode);
    const popularSearches = products.slice(0, 6);
    const vendureLanguageCode = languageCodeFor(language);
    const term = submittedQuery.trim();
    const searchInput = { term, sort: resultSort };
    const searchQuery = useInfiniteQuery({
        queryKey: storefrontQueryKeys.catalog(market.code, vendureLanguageCode, searchInput),
        queryFn: ({ pageParam, signal }) =>
            api.catalog({ ...searchInput, skip: pageParam, take: 20 }, signal),
        initialPageParam: 0,
        getNextPageParam: (lastPage, pages) => {
            const loaded = pages.reduce((total, page) => total + page.items.length, 0);
            return loaded < lastPage.totalItems ? loaded : undefined;
        },
        enabled: !!term,
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        placeholderData: keepPreviousData,
        meta: publicQueryMeta(),
    });
    const results = searchQuery.data?.pages.flatMap(page => page.items) ?? [];
    const totalItems = searchQuery.data?.pages[0]?.totalItems ?? 0;
    const searching = searchQuery.isPending;
    const loadingMore = searchQuery.isFetchingNextPage;
    const searchError = searchQuery.error instanceof Error ? searchQuery.error.message : '';
    const relatedProducts = products
        .filter(product => !results.some(result => result.id === product.id))
        .slice(0, 2);

    useEffect(() => {
        setQuery(initialQuery);
        setSubmittedQuery(initialQuery);
    }, [initialQuery]);
    const submit = (value = query) => {
        const next = value.trim();
        if (!next) return;
        setQuery(next);
        setSubmittedQuery(next);
        onNavigate({ name: 'search', term: next });
        const nextHistory = [next, ...history.filter(item => item !== next)].slice(0, 8);
        setHistory(nextHistory);
        if (searchHistoryStorageKey) {
            localStorage.setItem(searchHistoryStorageKey, JSON.stringify(nextHistory));
        }
    };

    useEffect(() => {
        setHistory(readStoredStrings(searchHistoryStorageKey, 8));
    }, [searchHistoryStorageKey]);

    useEffect(() => {
        for (const product of results) {
            const queryKey = storefrontQueryKeys.product(market.code, vendureLanguageCode, product.id);
            queryClient.setQueryData(queryKey, product);
            void queryClient.prefetchQuery({
                queryKey,
                queryFn: async () => product,
                staleTime: PUBLIC_QUERY_STALE_TIME,
                meta: publicQueryMeta(),
            });
        }
    }, [market.code, queryClient, results, vendureLanguageCode]);

    const loadMore = () => searchQuery.fetchNextPage();

    return (
        <main className="page subpage search-page">
            <h1 className="visually-hidden">{isZh ? '搜索商品' : 'Search products'}</h1>
            <header className="search-header">
                <button type="button" onClick={onBack} aria-label={isZh ? '返回' : 'Back'}>
                    <ArrowLeft />
                </button>
                <label>
                    <Search />
                    <input
                        autoFocus
                        type="search"
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                        onKeyDown={event => event.key === 'Enter' && submit()}
                        placeholder={isZh ? '搜索商品、分类' : 'Search products'}
                    />
                </label>
                <button type="button" onClick={() => submit()}>
                    {isZh ? '搜索' : 'Search'}
                </button>
            </header>
            {!submittedQuery ? (
                <div className="search-discovery">
                    <section>
                        <header>
                            <strong>{isZh ? '最近搜索' : 'Recent searches'}</strong>
                            {history.length > 0 && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setHistory([]);
                                        if (searchHistoryStorageKey) {
                                            localStorage.removeItem(searchHistoryStorageKey);
                                        }
                                    }}
                                    aria-label={isZh ? '清空' : 'Clear'}
                                >
                                    <Trash2 />
                                </button>
                            )}
                        </header>
                        <div className="search-tags">
                            {history.length ? (
                                history.map(item => (
                                    <button type="button" key={item} onClick={() => submit(item)}>
                                        {item}
                                    </button>
                                ))
                            ) : (
                                <small>{isZh ? '暂无搜索记录' : 'No recent searches'}</small>
                            )}
                        </div>
                    </section>
                    {!!popularSearches.length && (
                        <section className="popular-searches">
                            <header>
                                <strong>{isZh ? '热门搜索' : 'Popular searches'}</strong>
                                <span>{isZh ? '店内常看商品' : 'Popular in this store'}</span>
                            </header>
                            <ol>
                                {popularSearches.map((product, index) => (
                                    <li key={product.id}>
                                        <button type="button" onClick={() => submit(product.name)}>
                                            <b>{index + 1}</b>
                                            <span>{product.name}</span>
                                            {index === 0 && <em>{isZh ? '热' : 'Hot'}</em>}
                                        </button>
                                    </li>
                                ))}
                            </ol>
                        </section>
                    )}
                    <section>
                        <header>
                            <strong>{isZh ? '按场景发现' : 'Browse by need'}</strong>
                            <span>{isZh ? '快速进入常用入口' : 'Quick store shortcuts'}</span>
                        </header>
                        <div className="discovery-grid">
                            <button type="button" onClick={() => onNavigate({ name: 'category' })}>
                                <LayoutGrid />
                                <span>{isZh ? '全部商品' : 'All products'}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() =>
                                    submit(
                                        products.find(product =>
                                            product.variants.some(
                                                variant =>
                                                    variant.customFields.fulfillmentType === 'physical',
                                            ),
                                        )?.name ??
                                            products[0]?.name ??
                                            '',
                                    )
                                }
                            >
                                <ShoppingBag />
                                <span>{isZh ? '现货商品' : 'Physical'}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() =>
                                    submit(
                                        products.find(product =>
                                            product.variants.some(
                                                variant => variant.customFields.fulfillmentType === 'digital',
                                            ),
                                        )?.name ??
                                            products.at(-1)?.name ??
                                            '',
                                    )
                                }
                            >
                                <Download />
                                <span>{isZh ? '数字内容' : 'Digital'}</span>
                            </button>
                        </div>
                    </section>
                    {!!products.length && (
                        <ProductSection
                            title={isZh ? '今日推荐' : "Today's picks"}
                            subtitle={isZh ? '从店内在售商品开始' : 'Available from this store'}
                            products={products.slice(0, 2)}
                            market={market}
                            locale={locale}
                            addingVariantId={addingVariantId}
                            onProduct={product => onNavigate({ name: 'product', id: product.id })}
                            onAdd={onAdd}
                        />
                    )}
                </div>
            ) : (
                <section className="search-results">
                    <header>
                        <strong>
                            {isZh ? `“${submittedQuery}”的结果` : `Results for “${submittedQuery}”`}
                        </strong>
                        <span>{searching ? (isZh ? '搜索中' : 'Searching') : totalItems}</span>
                    </header>
                    <nav className="search-sort" aria-label={isZh ? '搜索结果排序' : 'Search result sorting'}>
                        <button
                            type="button"
                            className={resultSort === 'recommended' ? 'is-active' : undefined}
                            onClick={() => setResultSort('recommended')}
                        >
                            {isZh ? '综合' : 'Recommended'}
                        </button>
                        <button
                            type="button"
                            className={resultSort === 'name' ? 'is-active' : undefined}
                            onClick={() => setResultSort('name')}
                        >
                            {isZh ? '名称' : 'Name'}
                        </button>
                        <button
                            type="button"
                            className={resultSort === 'price-asc' ? 'is-active' : undefined}
                            onClick={() => setResultSort('price-asc')}
                        >
                            {isZh ? '价格' : 'Price'}
                        </button>
                    </nav>
                    {searching ? (
                        <ListSkeleton />
                    ) : searchError && !results.length ? (
                        <EmptyState
                            icon={<CircleAlert />}
                            title={isZh ? '搜索加载失败' : 'Search failed'}
                            detail={searchError}
                            action={isZh ? '重试' : 'Retry'}
                            onAction={() => void searchQuery.refetch()}
                        />
                    ) : results.length ? (
                        <div className="product-list">
                            {results.map(product => (
                                <ProductRow
                                    key={product.id}
                                    product={product}
                                    market={market}
                                    locale={locale}
                                    language={language}
                                    adding={product.variants.some(variant => variant.id === addingVariantId)}
                                    onOpen={() => onNavigate({ name: 'product', id: product.id })}
                                    onAdd={() => product.variants[0] && onAdd(product.variants[0])}
                                />
                            ))}
                            {searchError && (
                                <div className="search-load-error" role="alert">
                                    <span>{searchError}</span>
                                    <button type="button" onClick={() => void loadMore()}>
                                        {isZh ? '重试' : 'Retry'}
                                    </button>
                                </div>
                            )}
                            {results.length < totalItems && (
                                <button
                                    className="load-more-button search-load-more"
                                    type="button"
                                    disabled={loadingMore}
                                    onClick={() => void loadMore()}
                                >
                                    {loadingMore
                                        ? isZh
                                            ? '加载中'
                                            : 'Loading'
                                        : isZh
                                          ? `加载更多（剩余 ${totalItems - results.length} 件）`
                                          : `Load more (${totalItems - results.length} remaining)`}
                                </button>
                            )}
                        </div>
                    ) : (
                        <EmptyState
                            icon={<Search />}
                            title={isZh ? '没有找到相关商品' : 'No matching products'}
                            detail={
                                isZh ? '换个关键词或查看全部分类' : 'Try another search or browse categories'
                            }
                            action={isZh ? '查看分类' : 'Browse categories'}
                            onAction={() => onNavigate({ name: 'category' })}
                        />
                    )}
                    {!searching && !!relatedProducts.length && (
                        <ProductSection
                            title={isZh ? '相关好物' : 'Related products'}
                            subtitle={isZh ? '换个方向继续看看' : 'Keep exploring'}
                            products={relatedProducts}
                            market={market}
                            locale={locale}
                            addingVariantId={addingVariantId}
                            onProduct={product => onNavigate({ name: 'product', id: product.id })}
                            onAdd={onAdd}
                        />
                    )}
                </section>
            )}
        </main>
    );
}

function AuthPageBoundary({
    language,
    onBack,
    children,
}: {
    language: StorefrontLanguage;
    onBack: () => void;
    children: ReactNode;
}) {
    return (
        <Suspense
            fallback={
                <Subpage title={language === 'zh' ? '账户' : 'Account'} language={language} onBack={onBack}>
                    <PageSkeleton />
                </Subpage>
            }
        >
            {children}
        </Suspense>
    );
}

function BottomNavigation({
    active,
    cartQuantity,
    language,
    onNavigate,
}: {
    active: MainPage;
    cartQuantity: number;
    language: StorefrontLanguage;
    onNavigate: (page: MainPage) => void;
}) {
    const isZh = language === 'zh';
    const items: Array<{ id: MainPage; label: string; icon: ReactNode }> = [
        { id: 'home', label: isZh ? '首页' : 'Home', icon: <House /> },
        { id: 'category', label: isZh ? '商品' : 'Shop', icon: <LayoutGrid /> },
        { id: 'cart', label: isZh ? '购物车' : 'Cart', icon: <ShoppingCart /> },
        { id: 'account', label: isZh ? '我的' : 'Account', icon: <UserRound /> },
    ];
    return (
        <nav className="bottom-navigation" aria-label={isZh ? '主导航' : 'Main navigation'}>
            {items.map(item => (
                <button
                    type="button"
                    key={item.id}
                    className={active === item.id ? 'is-active' : undefined}
                    aria-current={active === item.id ? 'page' : undefined}
                    onClick={() => onNavigate(item.id)}
                >
                    <span className="nav-icon">
                        {item.icon}
                        {item.id === 'cart' && cartQuantity > 0 && (
                            <b>{cartQuantity > 99 ? '99+' : cartQuantity}</b>
                        )}
                    </span>
                    <span>{item.label}</span>
                </button>
            ))}
        </nav>
    );
}

function ProductSection({
    title,
    subtitle,
    products,
    market,
    locale,
    addingVariantId,
    favoriteProductIds,
    onProduct,
    onFavorite,
    onAdd,
}: {
    title: string;
    subtitle: string;
    products: Product[];
    market: MarketConfig;
    locale: string;
    addingVariantId: string | null;
    favoriteProductIds?: string[];
    onProduct: (product: Product) => void;
    onFavorite?: (product: Product) => void;
    onAdd: (variant: ProductVariant) => void;
}) {
    if (!products.length) return null;
    return (
        <section className="content-section product-section">
            <SectionHeader title={title} subtitle={subtitle} />
            <div className="product-grid">
                {products.map(product => (
                    <ProductCard
                        key={product.id}
                        product={product}
                        market={market}
                        locale={locale}
                        adding={product.variants.some(variant => variant.id === addingVariantId)}
                        favorite={favoriteProductIds?.includes(product.id)}
                        onOpen={() => onProduct(product)}
                        onFavorite={onFavorite ? () => onFavorite(product) : undefined}
                        onAdd={() => product.variants[0] && onAdd(product.variants[0])}
                    />
                ))}
            </div>
        </section>
    );
}

function ProductCard({
    product,
    market,
    locale,
    adding,
    favorite,
    onOpen,
    onFavorite,
    onAdd,
}: {
    product: Product;
    market: MarketConfig;
    locale: string;
    adding: boolean;
    favorite?: boolean;
    onOpen: () => void;
    onFavorite?: () => void;
    onAdd: () => void;
}) {
    const variant = product.variants[0];
    return (
        <article
            className="product-card"
            onPointerEnter={() => prefetchProductAsset(product)}
            onPointerDown={() => prefetchProductAsset(product)}
            onFocus={() => prefetchProductAsset(product)}
        >
            {onFavorite && (
                <button
                    className={`product-card-favorite${favorite ? ' is-active' : ''}`}
                    type="button"
                    onClick={onFavorite}
                    aria-pressed={favorite}
                    aria-label={
                        favorite
                            ? locale.startsWith('zh')
                                ? `取消收藏 ${product.name}`
                                : `Remove ${product.name} from favorites`
                            : locale.startsWith('zh')
                              ? `收藏 ${product.name}`
                              : `Add ${product.name} to favorites`
                    }
                >
                    <Heart fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" />
                </button>
            )}
            <button
                className="product-card-image"
                type="button"
                onClick={onOpen}
                aria-label={`${locale.startsWith('zh') ? '查看' : 'View'} ${product.name}`}
            >
                <ProductImage product={product} />
            </button>
            <button className="product-card-name" type="button" onClick={onOpen}>
                {product.name}
            </button>
            <span>{trimText(product.description, 26) || variant?.sku}</span>
            <footer>
                <b>
                    {variant
                        ? formatMoney(variant.priceWithTax, variant.currencyCode, locale)
                        : formatMoney(0, market.currencyCode, locale)}
                </b>
                <button
                    type="button"
                    onClick={onAdd}
                    disabled={
                        !variant ||
                        adding ||
                        (variant.customFields.fulfillmentType === 'physical' &&
                            variant.stockLevel === 'OUT_OF_STOCK')
                    }
                    aria-label={`${locale.startsWith('zh') ? '加入购物车' : 'Add to cart'} ${product.name}`}
                >
                    <Plus />
                </button>
            </footer>
        </article>
    );
}

function ProductRow({
    product,
    market,
    locale,
    language,
    adding,
    onOpen,
    onAdd,
}: {
    product: Product;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    adding: boolean;
    onOpen: () => void;
    onAdd: () => void;
}) {
    const isZh = language === 'zh';
    const variant = product.variants[0];
    return (
        <article
            className="product-row"
            onPointerEnter={() => prefetchProductAsset(product)}
            onPointerDown={() => prefetchProductAsset(product)}
            onFocus={() => prefetchProductAsset(product)}
        >
            <button
                type="button"
                className="product-row-image"
                onClick={onOpen}
                aria-label={`${isZh ? '查看' : 'View'} ${product.name}`}
            >
                <ProductImage product={product} />
            </button>
            <div>
                <button type="button" className="product-row-name" onClick={onOpen}>
                    {product.name}
                </button>
                <span>{trimText(product.description, 34) || variant?.sku}</span>
                <small>
                    {variant?.customFields.fulfillmentType === 'digital'
                        ? isZh
                            ? '数字商品 · 支付后交付'
                            : 'Digital · delivered after payment'
                        : variant?.stockLevel === 'OUT_OF_STOCK'
                          ? isZh
                              ? '暂时缺货'
                              : 'Out of stock'
                          : isZh
                            ? '现货商品'
                            : 'In stock'}
                </small>
                <p>
                    {variant
                        ? formatMoney(variant.priceWithTax, variant.currencyCode, locale)
                        : formatMoney(0, market.currencyCode, locale)}
                </p>
                <button
                    className="row-add"
                    type="button"
                    onClick={onAdd}
                    disabled={
                        !variant ||
                        adding ||
                        (variant.customFields.fulfillmentType === 'physical' &&
                            variant.stockLevel === 'OUT_OF_STOCK')
                    }
                    aria-label={`${isZh ? '加入购物车' : 'Add to cart'} ${product.name}`}
                >
                    <Plus />
                </button>
            </div>
        </article>
    );
}

function CartGroup({
    title,
    hint,
    lines,
    market,
    locale,
    language,
    loading,
    onSelect,
    onSelectAll,
    onQuantity,
    onRemove,
}: {
    title: string;
    hint: string;
    lines: StorefrontCart['lines'];
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    loading: boolean;
    onSelect: (lineId: string, selected: boolean) => void;
    onSelectAll: (lineIds: string[], selected: boolean) => void;
    onQuantity: (lineId: string, quantity: number) => void;
    onRemove: (lineId: string) => void;
}) {
    const isZh = language === 'zh';
    const allSelected = lines.every(line => line.selected);
    const partiallySelected = !allSelected && lines.some(line => line.selected);
    return (
        <section className="cart-group">
            <header>
                <button
                    type="button"
                    className={`group-select ${partiallySelected ? 'is-partial' : ''}`}
                    onClick={() =>
                        onSelectAll(
                            lines.map(line => line.id),
                            !allSelected,
                        )
                    }
                    disabled={loading}
                >
                    <span>{allSelected ? <Check /> : partiallySelected ? <Minus /> : null}</span>
                    <strong>{title}</strong>
                </button>
                <span>{hint}</span>
            </header>
            {lines.map(line => {
                const variant = line.productVariant;
                return (
                    <article className={`cart-line ${line.selected ? '' : 'is-unselected'}`} key={line.id}>
                        <label className="round-check">
                            <input
                                type="checkbox"
                                aria-label={
                                    isZh
                                        ? `选择 ${variant?.name ?? '商品'}`
                                        : `Select ${variant?.name ?? 'item'}`
                                }
                                checked={line.selected}
                                disabled={!line.available || loading}
                                onChange={event => onSelect(line.id, event.target.checked)}
                            />
                            <span>
                                <Check />
                            </span>
                        </label>
                        <div className="cart-line-image">
                            {variant ? (
                                <ProductVariantImage variant={variant} alt={variant.name} />
                            ) : (
                                <div className="image-placeholder">
                                    <Package />
                                </div>
                            )}
                        </div>
                        <div className="cart-line-copy">
                            <strong>{variant?.name ?? (isZh ? '商品已失效' : 'Unavailable item')}</strong>
                            <small>{variant?.sku}</small>
                            <b>
                                {variant
                                    ? formatMoney(variant.priceWithTax, variant.currencyCode, locale)
                                    : formatMoney(0, market.currencyCode, locale)}
                            </b>
                            <div className="cart-line-actions">
                                <div>
                                    <button
                                        type="button"
                                        aria-label={
                                            isZh
                                                ? `减少 ${variant?.name ?? '商品'} 数量`
                                                : `Decrease ${variant?.name ?? 'item'} quantity`
                                        }
                                        onClick={() =>
                                            line.quantity > 1
                                                ? onQuantity(line.id, line.quantity - 1)
                                                : onRemove(line.id)
                                        }
                                        disabled={loading}
                                    >
                                        <Minus />
                                    </button>
                                    <span>{line.quantity}</span>
                                    <button
                                        type="button"
                                        aria-label={
                                            isZh
                                                ? `增加 ${variant?.name ?? '商品'} 数量`
                                                : `Increase ${variant?.name ?? 'item'} quantity`
                                        }
                                        onClick={() => onQuantity(line.id, line.quantity + 1)}
                                        disabled={loading || !line.available}
                                    >
                                        <Plus />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </article>
                );
            })}
        </section>
    );
}

function Subpage({
    title,
    language,
    onBack,
    children,
}: {
    title: string;
    language: StorefrontLanguage;
    onBack: () => void;
    children: ReactNode;
}) {
    return (
        <main className="page subpage">
            <SubHeader title={title} language={language} onBack={onBack} />
            {children}
        </main>
    );
}

function NotFoundPage({
    language,
    storefrontName,
    onBack,
    onNavigate,
}: {
    language: StorefrontLanguage;
    storefrontName: string;
    onBack: () => void;
    onNavigate: (route: RouteState, replace?: boolean) => void;
}) {
    const isZh = language === 'zh';
    return (
        <main className="page subpage not-found-page">
            <SubHeader title={isZh ? '页面未找到' : 'Page not found'} language={language} onBack={onBack} />
            <section className="not-found-content">
                <span className="not-found-code" aria-hidden="true">
                    404
                </span>
                <span className="not-found-mark" aria-hidden="true">
                    <Navigation />
                </span>
                <h1>{isZh ? '这个页面不存在' : 'This page does not exist'}</h1>
                <p>
                    {isZh
                        ? '链接可能已失效，或者页面已经调整。'
                        : 'The link may have expired, or the page may have moved.'}
                </p>
                <div className="not-found-actions">
                    <button type="button" onClick={() => onNavigate({ name: 'home' }, true)}>
                        <House aria-hidden="true" />
                        {isZh ? `返回${storefrontName}首页` : `Back to ${storefrontName}`}
                    </button>
                    <button type="button" onClick={() => onNavigate({ name: 'category' }, true)}>
                        <LayoutGrid aria-hidden="true" />
                        {isZh ? '浏览商品' : 'Browse products'}
                    </button>
                </div>
            </section>
        </main>
    );
}
function ManagedLegalPage({
    kind,
    language,
    storefrontName,
    contentBlocks,
    onBack,
}: {
    kind: 'privacy' | 'terms';
    language: StorefrontLanguage;
    storefrontName: string;
    contentBlocks: StorefrontContentBlock[];
    onBack: () => void;
}) {
    const isZh = language === 'zh';
    const isPrivacy = kind === 'privacy';
    const fallbackTitle = isPrivacy
        ? isZh
            ? '隐私说明'
            : 'Privacy notice'
        : isZh
          ? '使用条款'
          : 'Terms of use';
    const document = resolveManagedLegalDocument(contentBlocks, kind, fallbackTitle);
    const title = document?.title ?? fallbackTitle;

    return (
        <main className="page subpage legal-page">
            <SubHeader title={title} language={language} onBack={onBack} />
            <article className="legal-managed-content">
                <header className="legal-managed-intro">
                    <h1>{title}</h1>
                    {document?.subtitle && <p>{document.subtitle}</p>}
                </header>
                {document ? (
                    <div className="legal-managed-body">{document.body}</div>
                ) : (
                    <div className="legal-managed-empty" role="status">
                        <CircleAlert aria-hidden="true" />
                        <div>
                            <strong>{isZh ? '法律文件暂未发布' : 'Legal document not published'}</strong>
                            <p>
                                {isZh
                                    ? '请联系店铺客服获取最新政策内容。'
                                    : 'Contact store support for the current policy.'}
                            </p>
                        </div>
                    </div>
                )}
                <footer>
                    <strong>{storefrontName}</strong>
                    <span>{title}</span>
                </footer>
            </article>
        </main>
    );
}
function SubHeader({
    title,
    language,
    onBack,
    action,
    className,
}: {
    title: string;
    language: StorefrontLanguage;
    onBack: () => void;
    action?: ReactNode;
    className?: string;
}) {
    return (
        <header className={`topbar subpage-header${className ? ` ${className}` : ''}`}>
            <button type="button" onClick={onBack} aria-label={language === 'zh' ? '返回' : 'Back'}>
                <ArrowLeft aria-hidden="true" />
            </button>
            <strong>{title}</strong>
            <span>{action}</span>
        </header>
    );
}
function NoticeButton({ language, onClick }: { language: StorefrontLanguage; onClick: () => void }) {
    return (
        <button
            className="notice-button"
            type="button"
            onClick={onClick}
            aria-label={language === 'zh' ? '通知' : 'Notifications'}
        >
            <Bell />
        </button>
    );
}
function SectionHeader({
    title,
    subtitle,
    action,
    onAction,
}: {
    title: string;
    subtitle?: string;
    action?: string;
    onAction?: () => void;
}) {
    return (
        <header className="section-header">
            <div>
                <h2>{title}</h2>
                {subtitle && <p>{subtitle}</p>}
            </div>
            {action && (
                <button type="button" onClick={onAction}>
                    {action}
                    <ChevronRight />
                </button>
            )}
        </header>
    );
}
function AccountShortcut({
    icon,
    label,
    count,
    onClick,
}: {
    icon: ReactNode;
    label: string;
    count: number;
    onClick: () => void;
}) {
    return (
        <button type="button" onClick={onClick}>
            <span>
                {icon}
                {count > 0 && <b>{count}</b>}
            </span>
            <small>{label}</small>
        </button>
    );
}
function ServiceButton({
    icon,
    label,
    badge,
    onClick,
}: {
    icon: ReactNode;
    label: string;
    badge?: string;
    onClick: () => void;
}) {
    return (
        <button type="button" onClick={onClick}>
            <span>
                {icon}
                {badge && <em>{badge}</em>}
            </span>
            <b>{label}</b>
        </button>
    );
}
function LegalFooter({
    storefrontName,
    content,
    onContentTarget,
}: {
    storefrontName: string;
    content?: StorefrontContentBlock;
    onContentTarget?: (targetType: StorefrontContentTargetType, targetValue: string | null) => void;
}) {
    return (
        <footer className="legal-footer">
            {content?.title && <strong>{content.title}</strong>}
            {content?.body && <p>{content.body}</p>}
            {!!content?.items.length && (
                <nav aria-label={content.title}>
                    {content.items.map(item => (
                        <button
                            key={item.id}
                            type="button"
                            disabled={!onContentTarget || item.targetType === 'NONE' || !item.targetValue}
                            onClick={() => onContentTarget?.(item.targetType, item.targetValue)}
                        >
                            {item.label}
                        </button>
                    ))}
                </nav>
            )}
            <span>{storefrontName}</span>
        </footer>
    );
}

function ProductImage({ product }: { product: Product }) {
    const image = productImage(product);
    return image ? (
        <SafeImage src={image} alt={product.name} imageKind="card" loading="lazy" />
    ) : (
        <div className="image-placeholder" aria-hidden="true">
            <Package />
        </div>
    );
}

function shouldPrefetchMedia(): boolean {
    const connection = (
        navigator as Navigator & {
            connection?: { saveData?: boolean; effectiveType?: string };
        }
    ).connection;
    return !connection?.saveData && !['slow-2g', '2g'].includes(connection?.effectiveType ?? '');
}

function scheduleIdleWork(work: () => void): void {
    if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(work, { timeout: 1_500 });
    } else {
        setTimeout(work, 120);
    }
}

function prefetchStorefrontImage(src: string, imageKind: StorefrontImageKind): void {
    if (!shouldPrefetchMedia()) return;
    const responsiveSource = responsiveImageSources(src, imageKind);
    const image = new Image();
    if (responsiveSource) {
        image.srcset = responsiveSource.avifSrcSet;
        image.sizes = responsiveSource.sizes;
        image.src = responsiveSource.fallbackSrc;
    } else {
        image.src = src;
    }
    void image.decode().catch(() => undefined);
}

function prefetchProductAsset(product: Product): void {
    const image = productImage(product);
    if (image) prefetchStorefrontImage(image, 'detail');
}
function ProductVariantImage({ variant, alt }: { variant: ProductVariant; alt: string }) {
    const image = variant.featuredAsset?.preview ?? variant.product.featuredAsset?.preview;
    return image ? (
        <SafeImage src={image} alt={alt} imageKind="thumbnail" loading="lazy" />
    ) : (
        <div className="image-placeholder" aria-hidden="true">
            <Package />
        </div>
    );
}

function SafeImage({
    src,
    fallbackSrc,
    placeholderSrc,
    alt,
    imageKind,
    onLoad,
    className,
    ...imageProps
}: {
    src: string;
    fallbackSrc?: string;
    placeholderSrc?: string;
    alt: string;
    imageKind?: StorefrontImageKind;
} & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt' | 'onError'>) {
    const [currentSrc, setCurrentSrc] = useState(src);
    const [failed, setFailed] = useState(false);
    const [useResponsiveSource, setUseResponsiveSource] = useState(true);
    const [loaded, setLoaded] = useState(false);
    const imageRef = useRef<HTMLImageElement>(null);
    const sourceIdentity = [src, fallbackSrc ?? '', imageKind ?? ''].join('\u0000');
    const sourceIdentityRef = useRef(sourceIdentity);

    useEffect(() => {
        if (sourceIdentityRef.current === sourceIdentity) {
            const image = imageRef.current;
            if (image?.complete && image.naturalWidth > 0) setLoaded(true);
            return;
        }
        sourceIdentityRef.current = sourceIdentity;
        setCurrentSrc(src);
        setFailed(false);
        setUseResponsiveSource(true);
        setLoaded(false);
    }, [sourceIdentity, src]);

    const responsiveSource = useMemo(
        () => (imageKind && useResponsiveSource ? responsiveImageSources(currentSrc, imageKind) : null),
        [currentSrc, imageKind, useResponsiveSource],
    );

    if (failed) {
        return (
            <span
                className="image-placeholder"
                role={alt ? 'img' : undefined}
                aria-label={alt || undefined}
                aria-hidden={alt ? undefined : true}
            >
                <Package aria-hidden="true" />
            </span>
        );
    }

    const image = (
        <img
            {...imageProps}
            ref={imageRef}
            src={responsiveSource?.fallbackSrc ?? currentSrc}
            srcSet={responsiveSource?.fallbackSrcSet ?? imageProps.srcSet}
            sizes={responsiveSource?.sizes ?? imageProps.sizes}
            width={imageProps.width ?? responsiveSource?.width}
            height={imageProps.height ?? responsiveSource?.height}
            decoding={imageProps.decoding ?? 'async'}
            className={`safe-image${loaded ? ' is-loaded' : ''}${className ? ` ${className}` : ''}`}
            alt={alt}
            onLoad={event => {
                setLoaded(true);
                onLoad?.(event);
            }}
            onError={() => {
                if (responsiveSource) {
                    setUseResponsiveSource(false);
                    return;
                }
                if (fallbackSrc && currentSrc !== fallbackSrc) {
                    setCurrentSrc(fallbackSrc);
                    setUseResponsiveSource(true);
                } else {
                    setFailed(true);
                }
            }}
        />
    );

    return responsiveSource ? (
        <picture
            className={`responsive-picture safe-image-frame${loaded ? ' is-loaded' : ''}`}
            style={placeholderSrc ? { backgroundImage: `url("${placeholderSrc}")` } : undefined}
        >
            <source type="image/avif" srcSet={responsiveSource.avifSrcSet} sizes={responsiveSource.sizes} />
            <source type="image/webp" srcSet={responsiveSource.webpSrcSet} sizes={responsiveSource.sizes} />
            {image}
        </picture>
    ) : (
        image
    );
}
function OrderImage({ order }: { order: Order }) {
    const variant = order.lines[0]?.productVariant;
    return variant ? (
        <ProductVariantImage variant={variant} alt={variant.name} />
    ) : (
        <div className="image-placeholder" aria-hidden="true">
            <Package />
        </div>
    );
}

function EmptyState({
    icon,
    title,
    detail,
    action,
    onAction,
    compact = false,
}: {
    icon: ReactNode;
    title: string;
    detail?: string;
    action?: string;
    onAction?: () => void;
    compact?: boolean;
}) {
    return (
        <section className={`empty-state ${compact ? 'is-compact' : ''}`}>
            <span>{icon}</span>
            <strong>{title}</strong>
            {detail && <small>{detail}</small>}
            {action && onAction && (
                <button type="button" onClick={onAction}>
                    {action}
                </button>
            )}
        </section>
    );
}
function InlineError({
    message,
    action,
    onAction,
}: {
    message: string;
    action?: string;
    onAction?: () => void;
}) {
    return (
        <div className="inline-error" role="alert">
            <CircleAlert />
            <span>{message}</span>
            {action && onAction && (
                <button type="button" onClick={onAction}>
                    {action}
                </button>
            )}
        </div>
    );
}
function ListSkeleton() {
    return (
        <div className="list-skeleton" aria-label="Loading">
            {[0, 1, 2, 3].map(item => (
                <span key={item}>
                    <i />
                    <b />
                    <b />
                </span>
            ))}
        </div>
    );
}

function CouponSheet({
    couponCodes,
    language,
    loading,
    onApply,
    onRemove,
    onClose,
}: {
    couponCodes: string[];
    language: StorefrontLanguage;
    loading: boolean;
    onApply: (couponCode: string) => Promise<string | null>;
    onRemove: (couponCode: string) => Promise<string | null>;
    onClose: () => void;
}) {
    const isZh = language === 'zh';
    const [couponCode, setCouponCode] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const apply = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const normalizedCode = couponCode.trim();
        if (!normalizedCode) return;
        setSubmitting(true);
        setError('');
        const nextError = await onApply(normalizedCode);
        setSubmitting(false);
        if (nextError) setError(nextError);
        else setCouponCode('');
    };
    const remove = async (code: string) => {
        setSubmitting(true);
        setError('');
        const nextError = await onRemove(code);
        setSubmitting(false);
        if (nextError) setError(nextError);
    };
    return (
        <Sheet title={isZh ? '优惠码' : 'Coupon code'} language={language} onClose={onClose}>
            <div className="coupon-sheet-content">
                <form className="coupon-code-form" onSubmit={event => void apply(event)}>
                    <label>
                        <span>{isZh ? '输入优惠码' : 'Enter coupon code'}</span>
                        <input
                            value={couponCode}
                            onChange={event => setCouponCode(event.target.value)}
                            autoComplete="off"
                            placeholder={isZh ? '例如 SAVE10' : 'For example, SAVE10'}
                        />
                    </label>
                    <button type="submit" disabled={loading || submitting || !couponCode.trim()}>
                        {submitting ? (isZh ? '处理中' : 'Applying') : isZh ? '应用' : 'Apply'}
                    </button>
                </form>
                {!!couponCodes.length && (
                    <section className="applied-coupons">
                        <strong>{isZh ? '已使用' : 'Applied'}</strong>
                        {couponCodes.map(code => (
                            <div key={code}>
                                <span>
                                    <TicketPercent />
                                    {code}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => void remove(code)}
                                    disabled={loading || submitting}
                                >
                                    {isZh ? '移除' : 'Remove'}
                                </button>
                            </div>
                        ))}
                    </section>
                )}
                {error && <small className="form-error">{error}</small>}
            </div>
        </Sheet>
    );
}

function Sheet({
    title,
    language,
    onClose,
    children,
}: {
    title: string;
    language: StorefrontLanguage;
    onClose: () => void;
    children: ReactNode;
}) {
    const dialogRef = useRef<HTMLElement>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);
    const onCloseRef = useRef(onClose);
    const titleId = useId();

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;

        previousFocusRef.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const previousOverflow = document.body.style.overflow;
        const focusableSelector = [
            'a[href]',
            'button:not([disabled])',
            'input:not([disabled])',
            'select:not([disabled])',
            'textarea:not([disabled])',
            '[tabindex]:not([tabindex="-1"])',
        ].join(',');
        const getFocusableElements = () =>
            Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(
                element => !element.hidden && element.getAttribute('aria-hidden') !== 'true',
            );
        const focusFrame = window.requestAnimationFrame(() => {
            (getFocusableElements()[0] ?? dialog).focus();
        });
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onCloseRef.current();
                return;
            }
            if (event.key !== 'Tab') return;

            const focusableElements = getFocusableElements();
            if (!focusableElements.length) {
                event.preventDefault();
                dialog.focus();
                return;
            }
            const firstElement = focusableElements[0];
            const lastElement = focusableElements[focusableElements.length - 1];
            const activeElement = document.activeElement;
            if (event.shiftKey && (activeElement === firstElement || !dialog.contains(activeElement))) {
                event.preventDefault();
                lastElement.focus();
            } else if (
                !event.shiftKey &&
                (activeElement === lastElement || !dialog.contains(activeElement))
            ) {
                event.preventDefault();
                firstElement.focus();
            }
        };

        document.body.style.overflow = 'hidden';
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            window.cancelAnimationFrame(focusFrame);
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = previousOverflow;
            previousFocusRef.current?.focus();
        };
    }, []);

    return (
        <div className="sheet-layer" role="presentation">
            <button
                className="sheet-mask"
                type="button"
                onClick={onClose}
                aria-label={language === 'zh' ? '关闭' : 'Close'}
            />
            <section
                ref={dialogRef}
                className="sheet"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
            >
                <header>
                    <strong id={titleId}>{title}</strong>
                    <button type="button" onClick={onClose} aria-label={language === 'zh' ? '关闭' : 'Close'}>
                        <X aria-hidden="true" />
                    </button>
                </header>
                {children}
            </section>
        </div>
    );
}
function Field({
    name,
    label,
    type = 'text',
    required = false,
    wide = false,
    defaultValue,
    autoComplete,
}: {
    name: string;
    label: string;
    type?: string;
    required?: boolean;
    wide?: boolean;
    defaultValue?: string;
    autoComplete?: string;
}) {
    return (
        <label className={wide ? 'field-wide' : undefined}>
            <span>{label}</span>
            <input
                name={name}
                type={type}
                required={required}
                defaultValue={defaultValue}
                autoComplete={autoComplete}
            />
        </label>
    );
}

function CountryField({
    countries,
    defaultCountryCode,
    language,
}: {
    countries: StorefrontConfig['availableCountries'];
    defaultCountryCode: string;
    language: StorefrontLanguage;
}) {
    const options = countries.length ? countries : [{ code: defaultCountryCode, name: defaultCountryCode }];
    const selectedCode = options.some(country => country.code === defaultCountryCode)
        ? defaultCountryCode
        : options[0].code;
    return (
        <label className="field-wide">
            <span>{language === 'zh' ? '国家/地区' : 'Country/region'}</span>
            <select name="countryCode" defaultValue={selectedCode} required>
                {options.map(country => (
                    <option key={country.code} value={country.code}>
                        {country.name}
                    </option>
                ))}
            </select>
        </label>
    );
}

function productImage(product?: Product | null): string | null {
    return product?.featuredAsset?.preview ?? product?.assets?.[0]?.preview ?? null;
}
function collectionImage(collection: CollectionSummary): string | null {
    return (
        collection.featuredAsset?.preview ??
        collection.children?.find(child => child.featuredAsset?.preview)?.featuredAsset?.preview ??
        null
    );
}
function minimumPrice(product: Product): number {
    return Math.min(...product.variants.map(variant => variant.priceWithTax), Number.MAX_SAFE_INTEGER);
}
function trimText(value: string | undefined, length: number): string {
    if (!value) return '';
    const clean = value
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return clean.length > length ? `${clean.slice(0, length)}…` : clean;
}
function formatMoney(value: number, currency: string, locale: string): string {
    return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    }).format(value / 100);
}
function formatOrderDate(value: string | null | undefined, locale: string): string {
    if (!value) return '--';
    return formatBusinessDate(locale, value, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}
function addressText(address: CustomerAddress): string {
    return [address.province, address.city, address.streetLine1, address.streetLine2, address.postalCode]
        .filter(Boolean)
        .join(' ');
}
function orderStateLabel(state: string, language: StorefrontLanguage): string {
    const zh: Record<string, string> = {
        AddingItems: '待付款',
        ArrangingPayment: '待付款',
        PaymentAuthorized: '待发货',
        PaymentSettled: '待发货',
        Shipped: '待收货',
        PartiallyShipped: '部分发货',
        Delivered: '交易完成',
        Cancelled: '已取消',
    };
    const en: Record<string, string> = {
        AddingItems: 'Payment pending',
        ArrangingPayment: 'Payment pending',
        PaymentAuthorized: 'Preparing shipment',
        PaymentSettled: 'Preparing shipment',
        Shipped: 'In transit',
        PartiallyShipped: 'Partially shipped',
        Delivered: 'Completed',
        Cancelled: 'Cancelled',
    };
    return (language === 'zh' ? zh : en)[state] ?? state;
}
function fulfillmentStateLabel(state: string, language: StorefrontLanguage): string {
    const zh: Record<string, string> = {
        Created: '已创建',
        Pending: '待发货',
        Shipped: '运输中',
        Delivered: '已送达',
        Cancelled: '已取消',
    };
    const en: Record<string, string> = {
        Created: 'Created',
        Pending: 'Pending shipment',
        Shipped: 'In transit',
        Delivered: 'Delivered',
        Cancelled: 'Cancelled',
    };
    return (language === 'zh' ? zh : en)[state] ?? state;
}
function orderStatesForTab(tab: OrderTab): string[] | undefined {
    if (tab === 'pending') return ['AddingItems', 'ArrangingPayment'];
    if (tab === 'shipping') return ['PaymentAuthorized', 'PaymentSettled'];
    if (tab === 'receiving') return ['Shipped', 'PartiallyShipped'];
    return undefined;
}
function fallbackCollections(isZh: boolean): CollectionSummary[] {
    return [
        {
            id: 'all',
            name: isZh ? '全部' : 'All',
            slug: 'all',
            description: '',
            position: 0,
            parentId: '',
            featuredAsset: null,
        },
        {
            id: 'physical',
            name: isZh ? '实物' : 'Physical',
            slug: 'physical',
            description: '',
            position: 1,
            parentId: '',
            featuredAsset: null,
        },
        {
            id: 'digital',
            name: isZh ? '数字' : 'Digital',
            slug: 'digital',
            description: '',
            position: 2,
            parentId: '',
            featuredAsset: null,
        },
    ];
}
function quickIcon(index: number): ReactNode {
    return [
        <LayoutGrid key="all" />,
        <ShoppingBag key="goods" />,
        <Coffee key="life" />,
        <Sparkles key="selected" />,
        <Download key="digital" />,
    ][index % 5];
}
