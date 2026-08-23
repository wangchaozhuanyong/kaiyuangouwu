import {
    keepPreviousData,
    useInfiniteQuery,
    useIsFetching,
    useQuery,
    useQueryClient,
} from '@tanstack/react-query';
import {
    ArrowLeft,
    ArrowUpDown,
    Bell,
    Check,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    ChevronUp,
    CircleAlert,
    CircleCheck,
    ClipboardList,
    Clock3,
    Cloud,
    Coffee,
    Download,
    Fingerprint,
    Flame,
    Headphones,
    Heart,
    House,
    LayoutGrid,
    MapPin,
    Minus,
    Navigation,
    Package,
    Pin,
    Plus,
    RotateCcw,
    Search,
    Settings,
    Share2,
    ShieldCheck,
    ShoppingBag,
    ShoppingCart,
    SlidersHorizontal,
    Sparkles,
    Store,
    Tag,
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
    PointerEvent as ReactPointerEvent,
    Suspense,
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
    useTransition,
} from 'react';

import { ShopApi, ShopApiError } from './api';
import { formatBusinessDate } from './business-time';
import { centeredHorizontalScrollLeft } from './category-navigation';
import {
    heroIndexAfterManualMove,
    isCompletedHeroSwipe,
    normalizeHeroAutoplayIntervalSeconds,
} from './hero-carousel';
import {
    enabledMarkets,
    languageCodeFor,
    localeFor,
    marketForStorefrontConfig,
    resolveStorefrontLanguage,
    uiCopy,
} from './i18n';
import { resolveManagedLegalDocument } from './legal-content';
import { offlineLoadError, QueryLoadState, resolveQueryLoadState } from './loading-state';
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
import { productDescriptionText, sanitizeProductDescription } from './rich-text';
import { PageSkeleton } from './route-loading';
import { useProductsByIdsQuery } from './route-queries';
import { cacheLogoUrl } from './StorefrontErrorBoundary';
import {
    ActiveCustomer,
    AfterSalesRequest,
    CollectionSummary,
    CreateAfterSalesRequestInput,
    CustomerAddress,
    FulfillmentType,
    MarketConfig,
    Order,
    OrderSummary,
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
    | 'purchase'
    | 'checkout'
    | 'payment'
    | 'order-confirmation'
    | 'orders'
    | 'logistics'
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
const LazyLogisticsPage = lazy(() =>
    import('./order-pages').then(module => ({ default: module.LogisticsPage })),
);
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
        if (sortMode === 'price-asc') return minimumProductPrice(first) - minimumProductPrice(second);
        if (sortMode === 'price-desc') return minimumProductPrice(second) - minimumProductPrice(first);
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

/** Renders the store logo image if available, otherwise falls back to the “桥” text mark. */
function BrandLogo({ url, name, className }: { url: string | null; name: string; className: string }) {
    if (url) {
        return <img className={className} src={url} alt={name} />;
    }
    return <span className={className}>桥</span>;
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
const customerResolvedRoutes: RouteName[] = [
    'account',
    'cart',
    'purchase',
    'checkout',
    'payment',
    'coupons',
    'orders',
    'logistics',
    'order-detail',
    'addresses',
    'account-security',
    'notifications',
    'reviews',
];
const cartResolvedRoutes: RouteName[] = ['cart', 'purchase', 'checkout', 'payment', 'coupons'];

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
        'purchase',
        'checkout',
        'payment',
        'order-confirmation',
        'orders',
        'logistics',
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
    const [favoriteProductIds, setFavoriteProductIds] = useState<string[]>([]);
    const [recentProductIds, setRecentProductIds] = useState<string[]>([]);
    const [storefrontNames, setStorefrontNames] =
        useState<Record<StorefrontLanguage, string>>(DEFAULT_STOREFRONT_NAMES);
    const [storefrontCode, setStorefrontCode] = useState('');
    const [logoUrl, setLogoUrl] = useState<string | null>(null);
    const [availableCountries, setAvailableCountries] = useState<StorefrontConfig['availableCountries']>([]);
    const [checkoutOrder, setCheckoutOrder] = useState<Order | null>(null);
    const [completedOrder, setCompletedOrder] = useState<Order | null>(null);
    const [cartLoading, setCartLoading] = useState(false);
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
    const routeRef = useRef(route);
    const mainPageScrollPositions = useRef<Partial<Record<MainPage, number>>>({});
    const restoredInitialScroll = useRef(false);

    const locale = localeFor(language, market);
    const text = uiCopy[language];
    const isZh = language === 'zh';
    const storefrontName = storefrontNames[language];
    const vendureLanguageCode = languageCodeFor(language);
    const api = useMemo(() => new ShopApi(market, vendureLanguageCode), [market, vendureLanguageCode]);

    const productsQuery = useQuery({
        queryKey: storefrontQueryKeys.products(market.code, vendureLanguageCode, 16),
        queryFn: ({ signal }) => api.products(16, signal),
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        meta: publicQueryMeta(),
    });
    const collectionsQuery = useQuery({
        queryKey: storefrontQueryKeys.collections(market.code, vendureLanguageCode),
        queryFn: ({ signal }) => api.collections(signal),
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        meta: publicQueryMeta(),
    });
    const configQuery = useQuery({
        queryKey: storefrontQueryKeys.config(market.code, vendureLanguageCode),
        queryFn: ({ signal }) => api.storefrontConfig(signal),
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        meta: publicQueryMeta(),
    });
    const contentQuery = useQuery({
        queryKey: storefrontQueryKeys.content(market.code, vendureLanguageCode),
        queryFn: ({ signal }) => api.storefrontContent(signal),
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        meta: publicQueryMeta(),
    });
    const cartQueryKey = storefrontQueryKeys.cart(market.code, vendureLanguageCode);
    const customerQueryKey = storefrontQueryKeys.customer(market.code, vendureLanguageCode);
    const cartQuery = useQuery({
        queryKey: cartQueryKey,
        queryFn: ({ signal }) => api.cart(signal),
        staleTime: 0,
    });
    const customerQuery = useQuery({
        queryKey: customerQueryKey,
        queryFn: ({ signal }) => api.activeCustomer(signal),
        staleTime: 0,
    });

    const rawProducts = productsQuery.data ?? [];
    const products = rawProducts.length ? rawProducts : fallbackDemoProducts(language, market.currencyCode);
    const collections = collectionsQuery.data?.length ? collectionsQuery.data : fallbackCollections(isZh);
    const contentBlocks = contentQuery.data?.blocks ?? [];
    const heroAutoplayIntervalSeconds = normalizeHeroAutoplayIntervalSeconds(
        contentQuery.data?.settings?.heroAutoplayIntervalSeconds ?? 5,
    );
    const cart = cartQuery.data ?? null;
    const customer = customerQuery.data ?? null;
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
    const cartQueryError =
        cartLoadState === 'paused'
            ? offlineLoadError(language)
            : cartQuery.error instanceof Error
              ? cartQuery.error.message
              : cartQuery.error
                ? text.loadError
                : null;
    const activeQueryFetchCount = useIsFetching({
        queryKey: storefrontQueryKeys.scope(market.code, vendureLanguageCode),
    });
    const setCart = useCallback(
        (nextCart: StorefrontCart) => queryClient.setQueryData(cartQueryKey, nextCart),
        [market.code, queryClient, vendureLanguageCode],
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
        [market.code, queryClient, vendureLanguageCode],
    );
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
    const routeProductLoading = productQuery.isLoading;
    const routeProductError =
        productQuery.isPaused && productQuery.data === undefined
            ? offlineLoadError(language)
            : productQuery.error instanceof Error
              ? productQuery.error.message
              : '';
    const orderQuery = useQuery({
        queryKey: storefrontQueryKeys.order(
            market.code,
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
                const queryKey = storefrontQueryKeys.product(market.code, vendureLanguageCode, product.id);
                queryClient.setQueryData(queryKey, product);
                void queryClient.prefetchQuery({
                    queryKey,
                    queryFn: () => product,
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

    useEffect(() => {
        const config = configQuery.data;
        if (!config) return;
        const nextStorefrontCode = config.code;
        const nextMarket = marketForStorefrontConfig(config, market);
        setAvailableCountries(config.availableCountries);
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
            zh: normalizeStorefrontName(config.customFields.storefrontNameZh, DEFAULT_STOREFRONT_NAMES.zh),
            en: normalizeStorefrontName(config.customFields.storefrontNameEn, DEFAULT_STOREFRONT_NAMES.en),
        });
        setLogoUrl(config.logoUrl ?? null);
    }, [configQuery.data, market]);

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
        try {
            localStorage.setItem(scopedStorageKey(STOREFRONT_LANGUAGE_STORAGE_KEY, market.code), language);
        } catch {
            // A disabled localStorage must not prevent language changes.
        }
        document.documentElement.lang = locale;
    }, [language, locale, market.code]);

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
                } else {
                    setCartError(requestError instanceof Error ? requestError.message : text.loadError);
                }
                notify(
                    requestError instanceof Error
                        ? requestError.message
                        : isZh
                          ? '暂时无法发起购买'
                          : 'Could not start the purchase',
                );
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
    const selectedOrder = route.id && routeOrder?.id === route.id ? routeOrder : null;
    const legalContent = contentBlocks.find(block => block.type === 'LEGAL');
    const supportContent = contentBlocks.find(block => block.type === 'SUPPORT');

    useEffect(() => {
        const routeLabels: Partial<Record<RouteName, string>> = {
            category: isZh ? '商品' : 'Shop',
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
                ? trimText(productDescriptionText(selectedProduct.description), 150)
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

    const mainPage: MainPage = rootPages.includes(route.name as MainPage)
        ? (route.name as MainPage)
        : route.name === 'product' || route.name === 'search'
          ? 'category'
          : route.name === 'purchase' || route.name === 'checkout' || route.name === 'payment'
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

    const renderPage = (pageRoute: RouteState) => {
        if (customerResolvedRoutes.includes(pageRoute.name) && customerLoadState !== 'ready') {
            return (
                <AsyncRouteStatePage
                    routeName={pageRoute.name}
                    state={customerLoadState}
                    error={customerLoadError}
                    language={language}
                    onBack={goBack}
                    onRetry={() => void customerQuery.refetch()}
                />
            );
        }
        if (cartResolvedRoutes.includes(pageRoute.name) && cartLoadState !== 'ready') {
            return (
                <AsyncRouteStatePage
                    routeName={pageRoute.name}
                    state={cartLoadState}
                    error={cartQueryError ?? text.loadError}
                    language={language}
                    onBack={goBack}
                    onRetry={() => void cartQuery.refetch()}
                />
            );
        }
        if ((pageRoute.name === 'purchase' || pageRoute.name === 'checkout') && publicLoadState !== 'ready') {
            return (
                <AsyncRouteStatePage
                    routeName={pageRoute.name}
                    state={publicLoadState}
                    error={error ?? text.loadError}
                    language={language}
                    onBack={goBack}
                    onRetry={() => void refetchStorefront()}
                />
            );
        }
        switch (pageRoute.name) {
            case 'home':
                return (
                    <HomePage
                        products={products}
                        collections={collections}
                        contentBlocks={contentBlocks}
                        heroAutoplayIntervalSeconds={heroAutoplayIntervalSeconds}
                        contentError={contentError}
                        loading={loading}
                        error={error}
                        market={market}
                        locale={locale}
                        language={language}
                        storefrontName={storefrontName}
                        logoUrl={logoUrl}
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
                        onToast={notify}
                        onContentTarget={openContentTarget}
                        onContentRetry={() => void contentQuery.refetch()}
                        onRetry={() => void refetchStorefront()}
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
                        onRetry={() => void refetchStorefront()}
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
                        loading={cartLoading}
                        error={cartError ?? cartQueryError}
                        addingVariantId={addingVariantId}
                        favoriteProductIds={favoriteProductIds}
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
                        onFavorite={productId => toggleFavoriteProduct(productId)}
                        onCheckout={() => void beginCheckout()}
                        onReopen={() => cart?.checkoutOrder && void reopenPendingOrder(cart.checkoutOrder)}
                        onNavigate={navigate}
                        onAdd={variant => void addToCart(variant)}
                        onNotify={notify}
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
                        logoUrl={logoUrl}
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
                return !selectedProduct && (routeProductLoading || (pageRoute.id && !routeProductError)) ? (
                    <Subpage title={isZh ? '商品详情' : 'Product'} language={language} onBack={goBack}>
                        <PageSkeleton label={isZh ? '正在加载商品详情' : 'Loading product details'} />
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
                        logoUrl={logoUrl}
                        addingVariantId={addingVariantId}
                        favorite={favoriteProductIds.includes(selectedProduct.id)}
                        onBack={goBack}
                        onNavigate={navigate}
                        onAdd={variant => void addToCart(variant)}
                        onBuyNow={variant => void startDirectPurchase(variant)}
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
                        initialQuery={pageRoute.term ?? ''}
                        addingVariantId={addingVariantId}
                        onBack={goBack}
                        onNavigate={navigate}
                        onAdd={variant => void addToCart(variant)}
                    />
                );
            case 'purchase':
                return (
                    <AuthPageBoundary language={language} onBack={goBack}>
                        <LazyCheckoutPage
                            mode="purchase"
                            api={api}
                            cart={cart}
                            order={currentCheckoutOrder}
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
            case 'checkout':
                return (
                    <AuthPageBoundary language={language} onBack={goBack}>
                        <LazyCheckoutPage
                            api={api}
                            cart={cart}
                            order={currentCheckoutOrder}
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
                            order={currentCheckoutOrder}
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
                            code={pageRoute.id ?? ''}
                            confirmationToken={pageRoute.token ?? ''}
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
                            initialTab={pageRoute.tab ?? 'all'}
                            onBack={goBack}
                            onNavigate={navigate}
                            onBuyAgain={addOrderToCart}
                            onNotify={notify}
                        />
                    </AuthPageBoundary>
                );
            case 'logistics':
                return (
                    <AuthPageBoundary language={language} onBack={goBack}>
                        <LazyLogisticsPage
                            api={api}
                            customer={customer}
                            market={market}
                            locale={locale}
                            language={language}
                            onBack={goBack}
                            onNavigate={navigate}
                        />
                    </AuthPageBoundary>
                );
            case 'order-detail':
                return !customer ? (
                    <Subpage title={isZh ? '订单详情' : 'Order details'} language={language} onBack={goBack}>
                        <EmptyState
                            icon={<UserRound />}
                            title={isZh ? '登录后查看订单' : 'Sign in to view orders'}
                            detail={
                                isZh
                                    ? '订单详情仅对当前账户可见'
                                    : 'Order details are available to your account.'
                            }
                            action={isZh ? '去登录' : 'Sign in'}
                            onAction={() => navigate({ name: 'login' })}
                        />
                    </Subpage>
                ) : !selectedOrder && (routeOrderLoading || (pageRoute.id && !routeOrderError)) ? (
                    <Subpage title={isZh ? '订单详情' : 'Order details'} language={language} onBack={goBack}>
                        <PageSkeleton label={isZh ? '正在加载订单详情' : 'Loading order details'} />
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
                            logoUrl={logoUrl}
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
                            logoUrl={logoUrl}
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
                            logoUrl={logoUrl}
                            storefrontName={storefrontName}
                            token={pageRoute.token}
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
                            logoUrl={logoUrl}
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
                            logoUrl={logoUrl}
                            storefrontName={storefrontName}
                            token={pageRoute.token}
                            onBack={goBack}
                            onSuccess={completeAuthentication}
                            onNavigate={navigate}
                        />
                    </AuthPageBoundary>
                );
            case 'legal':
                return (
                    <ManagedLegalPage
                        kind={pageRoute.id === 'terms' ? 'terms' : 'privacy'}
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
        <div className={`storefront-app${online ? '' : ' is-offline'}`}>
            <a className="skip-link" href="#storefront-content">
                {isZh ? '跳到主要内容' : 'Skip to content'}
            </a>
            {!online && (
                <div className="network-banner" role="status">
                    <WifiOff aria-hidden="true" />
                    {isZh ? '当前网络不可用，部分操作可能失败' : 'You are offline. Some actions may fail.'}
                </div>
            )}
            {(isNavigationPending || activeQueryFetchCount > 0) && (
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

interface HomepageCouponItem {
    id: string;
    type: 'DISCOUNT' | 'CASH' | 'CATEGORY' | 'PRODUCT';
    value: string;
    unit: string;
    titleZh: string;
    titleEn: string;
    descZh: string;
    descEn: string;
    theme: 'gold' | 'rose' | 'blue' | 'emerald';
    tagZh: string;
    tagEn: string;
}

const HOMEPAGE_MOCK_COUPONS: HomepageCouponItem[] = [
    {
        id: 'coupon-disc-85',
        type: 'DISCOUNT',
        value: '8.5',
        unit: '折',
        titleZh: '新人全场通用券',
        titleEn: 'Storewide 15% OFF',
        descZh: '全场无门槛 · 结算立享85折',
        descEn: 'No minimum · 15% off at checkout',
        theme: 'gold',
        tagZh: '全场通用',
        tagEn: 'Storewide',
    },
    {
        id: 'coupon-cash-100',
        type: 'CASH',
        value: '100',
        unit: '¥',
        titleZh: '桌面工作站立减券',
        titleEn: 'Desk Setup Voucher',
        descZh: '满 ¥1000 即可立减 ¥100',
        descEn: '¥100 OFF on orders over ¥1000',
        theme: 'rose',
        tagZh: '硬件满减',
        tagEn: 'Hardware',
    },
    {
        id: 'coupon-cat-input',
        type: 'CATEGORY',
        value: '9',
        unit: '折',
        titleZh: '输入外设专享券',
        titleEn: 'Input Gear Exclusive',
        descZh: '适用于机械键盘与静音鼠标',
        descEn: 'Valid for keyboards and mice',
        theme: 'blue',
        tagZh: '外设专享',
        tagEn: 'Category',
    },
    {
        id: 'coupon-prod-digital',
        type: 'PRODUCT',
        value: '30',
        unit: '¥',
        titleZh: 'AI数字资产立减津贴',
        titleEn: 'AI & Digital Allowance',
        descZh: '适用于 AI 效率课与提示词库',
        descEn: 'Exclusive for AI courses & toolkits',
        theme: 'emerald',
        tagZh: '数字专享',
        tagEn: 'Digital',
    },
];

interface HomepageCouponHubProps {
    language: StorefrontLanguage;
    onNavigate: (route: RouteState) => void;
    onToast?: (message: string) => void;
}

function HomepageCouponHub({ language, onNavigate, onToast }: HomepageCouponHubProps) {
    const isZh = language === 'zh';
    const [claimedIds, setClaimedIds] = useState<string[]>([]);

    const handleClaim = (coupon: HomepageCouponItem) => {
        if (claimedIds.includes(coupon.id)) return;
        setClaimedIds(prev => [...prev, coupon.id]);
        const title = isZh ? coupon.titleZh : coupon.titleEn;
        const msg = isZh
            ? `🎉 已成功领取「${title}」！结算时将自动为您抵扣`
            : `🎉 Successfully claimed "${title}"! Applied at checkout.`;
        if (onToast) {
            onToast(msg);
        }
    };

    return (
        <section className="coupon-hub-section" aria-label={isZh ? '专享特惠与优惠券' : 'Exclusive Coupons'}>
            <div className="coupon-hub-header">
                <div className="coupon-hub-title-lockup">
                    <span className="coupon-hub-icon-pill" aria-hidden="true">
                        <TicketPercent size={15} />
                    </span>
                    <h2 className="coupon-hub-title">{isZh ? '专享特惠专区' : 'Exclusive Coupons'}</h2>
                    <span className="coupon-hub-badge">{isZh ? '限量发放 · 下单立减' : 'Limited Time'}</span>
                </div>
                <button
                    type="button"
                    className="coupon-hub-more-btn"
                    onClick={() => onNavigate({ name: 'coupons' })}
                >
                    <span>{isZh ? '全部优惠' : 'All Offers'}</span>
                    <ChevronRight size={13} aria-hidden="true" />
                </button>
            </div>

            <div className="coupon-hub-scroll" role="list">
                {HOMEPAGE_MOCK_COUPONS.map(coupon => {
                    const isClaimed = claimedIds.includes(coupon.id);
                    const tag = isZh ? coupon.tagZh : coupon.tagEn;
                    const desc = isZh ? coupon.descZh : coupon.descEn;
                    const isDiscount = coupon.type === 'DISCOUNT' || coupon.type === 'CATEGORY';

                    return (
                        <div
                            key={coupon.id}
                            className={`coupon-ticket-card coupon-ticket-${coupon.theme} ${isClaimed ? 'is-claimed' : ''}`}
                            role="listitem"
                        >
                            <div className="coupon-ticket-main">
                                <div className="coupon-ticket-top">
                                    <span className="coupon-ticket-tag">{tag}</span>
                                </div>
                                <div className="coupon-ticket-value">
                                    {isDiscount ? (
                                        <>
                                            <strong className="coupon-num">{coupon.value}</strong>
                                            <small className="coupon-unit">{coupon.unit}</small>
                                        </>
                                    ) : (
                                        <>
                                            <small className="coupon-unit">{coupon.unit}</small>
                                            <strong className="coupon-num">{coupon.value}</strong>
                                        </>
                                    )}
                                </div>
                                <p className="coupon-ticket-desc">{desc}</p>
                            </div>

                            <div className="coupon-ticket-divider" aria-hidden="true">
                                <span className="coupon-notch coupon-notch-top" />
                                <span className="coupon-notch-line" />
                                <span className="coupon-notch-bottom" />
                            </div>

                            <div className="coupon-ticket-action">
                                <button
                                    type="button"
                                    className={`coupon-claim-btn ${isClaimed ? 'is-claimed' : ''}`}
                                    onClick={() => handleClaim(coupon)}
                                    disabled={isClaimed}
                                    aria-label={
                                        isClaimed
                                            ? isZh
                                                ? `已领取 ${coupon.titleZh}`
                                                : `Claimed ${coupon.titleEn}`
                                            : isZh
                                              ? `领取 ${coupon.titleZh}`
                                              : `Claim ${coupon.titleEn}`
                                    }
                                >
                                    {isClaimed ? (
                                        <span className="coupon-btn-text-wrap">
                                            <Check size={12} strokeWidth={2.8} aria-hidden="true" />
                                            <span>{isZh ? '已领' : 'Got'}</span>
                                        </span>
                                    ) : (
                                        <span className="coupon-btn-text-wrap">
                                            {isZh ? (
                                                <>
                                                    <span>立即</span>
                                                    <span>领取</span>
                                                </>
                                            ) : (
                                                <span>Claim</span>
                                            )}
                                        </span>
                                    )}
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}

interface HomePageProps {
    products: Product[];
    collections: CollectionSummary[];
    contentBlocks: StorefrontContentBlock[];
    heroAutoplayIntervalSeconds: number;
    contentError: string;
    loading: boolean;
    error: string | null;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    storefrontName: string;
    logoUrl: string | null;
    addingVariantId: string | null;
    onNavigate: (route: RouteState) => void;
    onCategorySelect: (collection: CollectionSummary) => void;
    onAdd: (variant: ProductVariant) => void;
    onToggleLanguage: () => void;
    onNotifications: () => void;
    onToast?: (message: string) => void;
    onContentTarget: (targetType: StorefrontContentTargetType, targetValue: string | null) => void;
    onContentRetry: () => void;
    onRetry: () => void;
}

function HomePage(props: HomePageProps) {
    const {
        products,
        collections,
        contentBlocks,
        heroAutoplayIntervalSeconds,
        contentError,
        loading,
        error,
        market,
        locale,
        language,
        storefrontName,
        logoUrl,
        addingVariantId,
        onNavigate,
        onCategorySelect,
        onAdd,
        onToggleLanguage,
        onNotifications,
        onToast,
        onContentTarget,
        onContentRetry,
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
    const [heroGestureActive, setHeroGestureActive] = useState(false);
    const [heroAutoplayStopped, setHeroAutoplayStopped] = useState(false);
    const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
    const [pageVisible, setPageVisible] = useState(true);
    const heroGestureRef = useRef({
        active: false,
        horizontal: false,
        startX: 0,
        startY: 0,
    });
    const heroCount = managedHeroes.length || heroProducts.length;
    const managedHero = managedHeroes[heroIndex];
    const hero = heroProducts[heroIndex] ?? products[0];
    const heroImage = managedHero?.imageUrl ?? productImage(hero) ?? '/storefront/default-hero.jpg';
    const managedHeroProduct =
        managedHero?.targetType === 'PRODUCT'
            ? products.find(product => product.id === managedHero.targetValue)
            : undefined;
    const heroFallbackImage = productImage(managedHeroProduct ?? hero) ?? '/storefront/default-hero.jpg';
    const quickCollections = (collections.length ? collections : fallbackCollections(isZh)).slice(0, 5);

    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        const updateMotionPreference = () => setPrefersReducedMotion(mediaQuery.matches);
        updateMotionPreference();
        mediaQuery.addEventListener('change', updateMotionPreference);
        return () => mediaQuery.removeEventListener('change', updateMotionPreference);
    }, []);

    useEffect(() => {
        const updatePageVisibility = () => setPageVisible(!document.hidden);
        updatePageVisibility();
        document.addEventListener('visibilitychange', updatePageVisibility);
        return () => document.removeEventListener('visibilitychange', updatePageVisibility);
    }, []);

    useEffect(() => {
        if (
            heroCount < 2 ||
            heroInteractionPaused ||
            heroGestureActive ||
            heroAutoplayStopped ||
            prefersReducedMotion ||
            !pageVisible
        ) {
            return;
        }
        const timer = window.setTimeout(
            () => setHeroIndex(index => heroIndexAfterManualMove(index, heroCount, 1)),
            heroAutoplayIntervalSeconds * 1000,
        );
        return () => window.clearTimeout(timer);
    }, [
        heroAutoplayIntervalSeconds,
        heroAutoplayStopped,
        heroCount,
        heroGestureActive,
        heroIndex,
        heroInteractionPaused,
        pageVisible,
        prefersReducedMotion,
    ]);

    useEffect(() => {
        if (heroIndex >= heroCount) setHeroIndex(0);
    }, [heroCount, heroIndex]);

    const selectHeroManually = (index: number) => {
        setHeroAutoplayStopped(true);
        setHeroIndex(index);
    };

    const beginHeroSwipe = (event: ReactPointerEvent<HTMLElement>) => {
        if (
            heroCount < 2 ||
            event.button !== 0 ||
            (event.target instanceof Element && event.target.closest('button, a, input, label'))
        ) {
            return;
        }
        heroGestureRef.current = {
            active: true,
            horizontal: false,
            startX: event.clientX,
            startY: event.clientY,
        };
        setHeroGestureActive(true);
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.classList.add('is-dragging');
    };

    const moveHeroSwipe = (event: ReactPointerEvent<HTMLElement>) => {
        const gesture = heroGestureRef.current;
        if (!gesture.active) return;
        const deltaX = event.clientX - gesture.startX;
        const deltaY = event.clientY - gesture.startY;
        if (!gesture.horizontal) {
            if (Math.abs(deltaY) > Math.abs(deltaX) + 6) {
                gesture.active = false;
                setHeroGestureActive(false);
                event.currentTarget.classList.remove('is-dragging');
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                }
                return;
            }
            if (Math.abs(deltaX) < 6) return;
            gesture.horizontal = true;
        }
        event.preventDefault();
    };

    const finishHeroSwipe = (event: ReactPointerEvent<HTMLElement>, cancelled = false) => {
        const gesture = heroGestureRef.current;
        if (!gesture.active && !gesture.horizontal) return;
        const deltaX = event.clientX - gesture.startX;
        const deltaY = event.clientY - gesture.startY;
        const completed = !cancelled && gesture.horizontal && isCompletedHeroSwipe(deltaX, deltaY);
        gesture.active = false;
        gesture.horizontal = false;
        setHeroGestureActive(false);
        event.currentTarget.classList.remove('is-dragging');
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (completed) {
            selectHeroManually(heroIndexAfterManualMove(heroIndex, heroCount, deltaX < 0 ? 1 : -1));
        }
    };

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
              ...quickCollections.map((collection, index) => {
                  const image = collectionImage(collection);
                  return {
                      id: collection.id,
                      label: collection.name,
                      icon: image ? <SafeImage src={image} alt="" imageKind="thumbnail" /> : quickIcon(index),
                      onClick: () => onCategorySelect(collection),
                  };
              }),
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
                    <BrandLogo url={logoUrl} name={storefrontName} className="brand-mark" />
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
                    <button type="button" onClick={onContentRetry}>
                        <RotateCcw aria-hidden="true" />
                        {isZh ? '重试' : 'Retry'}
                    </button>
                </div>
            )}

            {loading ? (
                <PageSkeleton label={isZh ? '正在加载首页' : 'Loading home page'} />
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
                            className={`hero${heroCount > 1 ? ' is-swipeable' : ''}`}
                            role="region"
                            aria-label={managedHero?.title || (isZh ? '精选推荐' : 'Featured')}
                            aria-roledescription={isZh ? '轮播' : 'carousel'}
                            onMouseEnter={() => setHeroInteractionPaused(true)}
                            onMouseLeave={() => setHeroInteractionPaused(false)}
                            onFocus={() => setHeroInteractionPaused(true)}
                            onBlur={event => {
                                if (!event.currentTarget.contains(event.relatedTarget)) {
                                    setHeroInteractionPaused(false);
                                }
                            }}
                            onPointerDown={beginHeroSwipe}
                            onPointerMove={moveHeroSwipe}
                            onPointerUp={event => finishHeroSwipe(event)}
                            onPointerCancel={event => finishHeroSwipe(event, true)}
                            onDragStart={event => event.preventDefault()}
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
                                {managedHero?.subtitle && <small>{managedHero.subtitle}</small>}
                                <h1>
                                    {(() => {
                                        const raw = managedHero?.title ?? hero?.name;
                                        if (!raw)
                                            return isZh ? '认真挑选每一件好物' : 'Goods chosen with care';
                                        if (/^首页(图片)?轮播/i.test(raw)) {
                                            return isZh ? 'AI 专属会员特权' : 'Exclusive AI Membership';
                                        }
                                        return raw;
                                    })()}
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
                                                onClick={() => selectHeroManually(index)}
                                            />
                                        ),
                                    )}
                                </div>
                            )}
                            <span
                                className="visually-hidden"
                                aria-live={heroAutoplayStopped ? 'polite' : 'off'}
                            >
                                {heroAutoplayStopped
                                    ? isZh
                                        ? `自动轮播已停止，当前为第 ${heroIndex + 1} 张广告`
                                        : `Autoplay stopped. Promotion ${heroIndex + 1} is active.`
                                    : ''}
                            </span>
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
                    </div>

                    <HomepageCouponHub language={language} onNavigate={onNavigate} onToast={onToast} />

                    <HomeDualCategoryShowcase
                        language={language}
                        collections={collections}
                        onNavigate={onNavigate}
                        onCategorySelect={onCategorySelect}
                    />

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
                        action={isZh ? '更多' : 'More'}
                        onAction={() => onNavigate({ name: 'category' })}
                        products={products.slice(0, 4)}
                        market={market}
                        locale={locale}
                        addingVariantId={addingVariantId}
                        onProduct={product => onNavigate({ name: 'product', id: product.id })}
                        onAdd={onAdd}
                    />

                    {products.length > 2 && (
                        <ProductSection
                            title={isZh ? '热门商品' : 'Trending picks'}
                            action={isZh ? '更多' : 'More'}
                            onAction={() => onNavigate({ name: 'category' })}
                            products={products.slice(2, 6)}
                            market={market}
                            locale={locale}
                            addingVariantId={addingVariantId}
                            onProduct={product => onNavigate({ name: 'product', id: product.id })}
                            onAdd={onAdd}
                        />
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

                    <HomeTrustGuaranteeStrip language={language} />

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

function HomeDualCategoryShowcase({
    language,
    collections,
    onNavigate,
    onCategorySelect,
}: {
    language: StorefrontLanguage;
    collections: CollectionSummary[];
    onNavigate: (route: RouteState) => void;
    onCategorySelect: (collection: CollectionSummary) => void;
}) {
    const isZh = language === 'zh';
    return (
        <section className="home-dual-showcase" aria-label={isZh ? '核心品类精选' : 'Core Categories'}>
            <button
                type="button"
                className="showcase-card is-hardware"
                onClick={() => {
                    const hardwareCol = collections.find(
                        c =>
                            c.slug.includes('workstation') ||
                            c.slug.includes('computing') ||
                            c.slug.includes('setup') ||
                            c.slug.includes('input'),
                    );
                    if (hardwareCol) {
                        onCategorySelect(hardwareCol);
                    } else {
                        onNavigate({ name: 'category' });
                    }
                }}
            >
                <div className="showcase-content">
                    <span className="showcase-badge">{isZh ? '桌面数码' : 'Desk Gear'}</span>
                    <h3>{isZh ? '极简办公工作站' : 'Minimal Workstation'}</h3>
                    <p>{isZh ? '精选平板、4K显示器与机械键盘' : 'Tablets, 4K displays & keyboards'}</p>
                    <span className="showcase-link">
                        {isZh ? '探索硬件' : 'Explore gear'} <ChevronRight aria-hidden="true" />
                    </span>
                </div>
            </button>
            <button
                type="button"
                className="showcase-card is-digital"
                onClick={() => {
                    const digitalCol = collections.find(c => c.slug.includes('digital'));
                    if (digitalCol) {
                        onCategorySelect(digitalCol);
                    } else {
                        onNavigate({ name: 'category' });
                    }
                }}
            >
                <div className="showcase-content">
                    <span className="showcase-badge is-digital-badge">
                        {isZh ? '数字生产力' : 'AI & Digital'}
                    </span>
                    <h3>{isZh ? 'AI 效率与知识资产' : 'AI & Knowledge Tools'}</h3>
                    <p>{isZh ? '提示词库、实战课与文案工具' : 'Prompts, toolkits & templates'}</p>
                    <span className="showcase-link">
                        {isZh ? '即刻获取' : 'Instant access'} <ChevronRight aria-hidden="true" />
                    </span>
                </div>
            </button>
        </section>
    );
}

function HomeTrustGuaranteeStrip({ language }: { language: StorefrontLanguage }) {
    const isZh = language === 'zh';
    return (
        <section className="home-trust-strip" aria-label={isZh ? '服务保障' : 'Service Guarantees'}>
            <div className="trust-item">
                <div className="trust-icon-box">
                    <CircleCheck aria-hidden="true" />
                </div>
                <div className="trust-text">
                    <strong>{isZh ? '官方正品' : 'Authentic'}</strong>
                    <small>{isZh ? '严选硬件品质保证' : '100% genuine products'}</small>
                </div>
            </div>
            <div className="trust-item">
                <div className="trust-icon-box">
                    <Download aria-hidden="true" />
                </div>
                <div className="trust-text">
                    <strong>{isZh ? '即时交付' : 'Instant Access'}</strong>
                    <small>{isZh ? '数字内容付款即享' : 'Direct digital download'}</small>
                </div>
            </div>
            <div className="trust-item">
                <div className="trust-icon-box">
                    <Truck aria-hidden="true" />
                </div>
                <div className="trust-text">
                    <strong>{isZh ? '极速配送' : 'Fast Shipping'}</strong>
                    <small>{isZh ? '实物全程轨迹追踪' : 'Tracked express delivery'}</small>
                </div>
            </div>
            <div className="trust-item">
                <div className="trust-icon-box">
                    <RotateCcw aria-hidden="true" />
                </div>
                <div className="trust-text">
                    <strong>{isZh ? '安心售后' : 'Support'}</strong>
                    <small>{isZh ? '专业团队答疑解惑' : 'Dedicated assistance'}</small>
                </div>
            </div>
        </section>
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
    const [allCategoriesOpen, setAllCategoriesOpen] = useState(false);
    const [draftType, setDraftType] = useState<'all' | FulfillmentType>(fulfillmentFilter);
    const [draftStock, setDraftStock] = useState(inStockOnly);
    const [draftMinimumPrice, setDraftMinimumPrice] = useState(minimumPriceInput);
    const [draftMaximumPrice, setDraftMaximumPrice] = useState(maximumPriceInput);
    const primaryCollections = collections.length ? collections : fallbackCollections(isZh);
    const primary = primaryCollections.find(item => item.id === activeCollectionId) ?? primaryCollections[0];
    const primaryCollectionImage = (collection: CollectionSummary) =>
        collectionImage(collection) ??
        productImage(
            products.find(product =>
                product.collections.some(
                    productCollection =>
                        productCollection.id === collection.id ||
                        productCollection.parentId === collection.id,
                ),
            ),
        );
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
            const price = minimumProductPrice(product) / 100;
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
    const categoryLoading = collections.length ? catalogQuery.isLoading : loading;
    const loadingMore = catalogQuery.isFetchingNextPage;
    const categoryError = collections.length
        ? catalogQuery.isPaused && catalogQuery.data === undefined
            ? offlineLoadError(language)
            : catalogQuery.error instanceof Error
              ? catalogQuery.error.message
              : ''
        : (error ?? '');

    useEffect(() => {
        for (const product of categoryProducts) {
            const queryKey = storefrontQueryKeys.product(market.code, vendureLanguageCode, product.id);
            queryClient.setQueryData(queryKey, product);
            void queryClient.prefetchQuery({
                queryKey,
                queryFn: () => product,
                staleTime: PUBLIC_QUERY_STALE_TIME,
                meta: publicQueryMeta(),
            });
        }
    }, [categoryProducts, market.code, queryClient, vendureLanguageCode]);

    useEffect(() => {
        if (!allCategoriesOpen) return;
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setAllCategoriesOpen(false);
        };
        document.addEventListener('keydown', closeOnEscape);
        return () => document.removeEventListener('keydown', closeOnEscape);
    }, [allCategoriesOpen]);

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
            <div className="category-navigation-shell">
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

                <section
                    className={`primary-category-switcher ${allCategoriesOpen ? 'is-expanded' : ''}`}
                    aria-label={isZh ? '商品分类切换' : 'Category switcher'}
                >
                    {!allCategoriesOpen ? (
                        <div className="primary-category-strip">
                            <nav
                                className="primary-categories"
                                aria-label={isZh ? '一级分类' : 'Main categories'}
                            >
                                {primaryCollections.map(collection => {
                                    const image = primaryCollectionImage(collection);
                                    return (
                                        <button
                                            type="button"
                                            key={collection.id}
                                            className={
                                                collection.id === activeCollectionId ? 'is-active' : undefined
                                            }
                                            aria-pressed={collection.id === activeCollectionId}
                                            onClick={event => {
                                                onCollectionChange(
                                                    collection.id,
                                                    collection.children?.[0]?.id ?? collection.id,
                                                );
                                                const item = event.currentTarget;
                                                const scroller = item.parentElement;
                                                if (!scroller) return;
                                                scroller.scrollTo({
                                                    left: centeredHorizontalScrollLeft(scroller, item),
                                                    behavior: 'smooth',
                                                });
                                            }}
                                        >
                                            <span className="primary-category-image" aria-hidden="true">
                                                {image ? (
                                                    <SafeImage
                                                        src={image}
                                                        alt=""
                                                        imageKind="thumbnail"
                                                        loading="lazy"
                                                    />
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
                            <button
                                type="button"
                                className="primary-categories-all"
                                aria-expanded="false"
                                aria-label={isZh ? '展开全部分类' : 'Expand all categories'}
                                onClick={() => setAllCategoriesOpen(true)}
                            >
                                <span className="primary-categories-all-icon" aria-hidden="true">
                                    <LayoutGrid />
                                </span>
                                <span className="primary-categories-all-label">
                                    {isZh ? '全部分类' : 'All'}
                                    <ChevronDown aria-hidden="true" />
                                </span>
                            </button>
                        </div>
                    ) : (
                        <div className="all-primary-categories">
                            <h2>{isZh ? '全部分类' : 'All categories'}</h2>
                            <nav
                                className="all-primary-category-grid"
                                aria-label={isZh ? '全部分类' : 'All categories'}
                            >
                                {primaryCollections.map(collection => {
                                    const image = primaryCollectionImage(collection);
                                    return (
                                        <button
                                            type="button"
                                            key={collection.id}
                                            className={
                                                collection.id === activeCollectionId ? 'is-active' : undefined
                                            }
                                            aria-pressed={collection.id === activeCollectionId}
                                            onClick={() => {
                                                onCollectionChange(
                                                    collection.id,
                                                    collection.children?.[0]?.id ?? collection.id,
                                                );
                                                setAllCategoriesOpen(false);
                                            }}
                                        >
                                            <span className="all-primary-category-image" aria-hidden="true">
                                                {image ? (
                                                    <SafeImage
                                                        src={image}
                                                        alt=""
                                                        imageKind="thumbnail"
                                                        loading="lazy"
                                                    />
                                                ) : (
                                                    <span className="primary-category-placeholder">
                                                        <LayoutGrid aria-hidden="true" />
                                                    </span>
                                                )}
                                            </span>
                                            <span>{collection.name}</span>
                                        </button>
                                    );
                                })}
                            </nav>
                            <button
                                type="button"
                                className="all-primary-categories-collapse"
                                onClick={() => setAllCategoriesOpen(false)}
                            >
                                <span>{isZh ? '点击收起' : 'Collapse'}</span>
                                <ChevronUp aria-hidden="true" />
                            </button>
                        </div>
                    )}
                </section>
            </div>

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

                    {categoryLoading || (loading && !collections.length) ? (
                        <ListSkeleton label={isZh ? '正在加载商品' : 'Loading products'} />
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
    favoriteProductIds: string[];
    onToggleAll: () => void;
    onSelect: (lineId: string, selected: boolean) => void;
    onSelectGroup: (lineIds: string[], selected: boolean) => void;
    onQuantity: (lineId: string, quantity: number) => void;
    onRemove: (lineId: string) => void;
    onFavorite: (productId: string) => void;
    onCheckout: () => void;
    onReopen: () => void;
    onNavigate: (route: RouteState) => void;
    onAdd: (variant: ProductVariant) => void;
    onNotify: (message: string) => void;
    onRetry: () => void;
    onApplyCoupon: (couponCode: string) => Promise<string | null>;
    onRemoveCoupon: (couponCode: string) => Promise<string | null>;
}

export function CartPage(props: CartPageProps) {
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
        favoriteProductIds,
        onToggleAll,
        onSelect,
        onSelectGroup,
        onQuantity,
        onRemove,
        onFavorite,
        onCheckout,
        onReopen,
        onNavigate,
        onAdd,
        onNotify,
        onRetry,
        onApplyCoupon,
        onRemoveCoupon,
    } = props;
    const isZh = language === 'zh';
    const lines = cart?.lines ?? [];
    const [invalidOpen, setInvalidOpen] = useState(false);
    const [couponOpen, setCouponOpen] = useState(false);
    const [openActionLineId, setOpenActionLineId] = useState<string | null>(null);
    const [pinnedLineIds, setPinnedLineIds] = useState<string[]>([]);
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

    useEffect(() => {
        const currentLineIds = new Set(lines.map(line => line.id));
        setPinnedLineIds(current => {
            const next = current.filter(lineId => currentLineIds.has(lineId));
            return next.length === current.length ? current : next;
        });
        setOpenActionLineId(current => (current && currentLineIds.has(current) ? current : null));
    }, [lines]);

    const sortPinnedLines = useCallback(
        (groupLines: StorefrontCart['lines']) =>
            [...groupLines].sort((left, right) => {
                const leftIndex = pinnedLineIds.indexOf(left.id);
                const rightIndex = pinnedLineIds.indexOf(right.id);
                if (leftIndex === -1 && rightIndex === -1) return 0;
                if (leftIndex === -1) return 1;
                if (rightIndex === -1) return -1;
                return leftIndex - rightIndex;
            }),
        [pinnedLineIds],
    );

    const togglePinnedLine = (lineId: string, productName: string) => {
        const pinning = !pinnedLineIds.includes(lineId);
        setPinnedLineIds(current =>
            pinning
                ? [lineId, ...current.filter(currentId => currentId !== lineId)]
                : current.filter(currentId => currentId !== lineId),
        );
        setOpenActionLineId(null);
        onNotify(
            pinning
                ? isZh
                    ? `${productName} 已置顶`
                    : `${productName} pinned`
                : isZh
                  ? `${productName} 已取消置顶`
                  : `${productName} unpinned`,
        );
    };

    const toggleFavoriteLine = (productId: string, productName: string) => {
        const saving = !favoriteProductIds.includes(productId);
        onFavorite(productId);
        setOpenActionLineId(null);
        onNotify(
            saving
                ? isZh
                    ? `${productName} 已收藏`
                    : `${productName} saved`
                : isZh
                  ? `${productName} 已取消收藏`
                  : `${productName} removed from favorites`,
        );
    };

    const shareCartProduct = async (productId: string, productName: string) => {
        const productUrl = new URL(window.location.href);
        productUrl.hash = routeHash({ name: 'product', id: productId }).slice(1);
        try {
            if (navigator.share) {
                await navigator.share({ title: productName, url: productUrl.toString() });
            } else {
                await navigator.clipboard.writeText(productUrl.toString());
                onNotify(isZh ? '商品链接已复制' : 'Product link copied');
            }
            setOpenActionLineId(null);
        } catch (shareError) {
            if (shareError instanceof DOMException && shareError.name === 'AbortError') return;
            onNotify(isZh ? '暂时无法分享商品' : 'Could not share this product');
        }
    };

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

            {error && <InlineError message={error} action={isZh ? '刷新' : 'Refresh'} onAction={onRetry} />}
            {locked && (
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
            {!customer && !!lines.length && (
                <section className="cart-guest-notice" aria-labelledby="cart-guest-title">
                    <span className="cart-guest-icon">
                        <ShoppingBag />
                    </span>
                    <div className="cart-guest-copy">
                        <strong id="cart-guest-title">
                            {isZh ? '游客购物车已保存' : 'Your guest cart is saved'}
                        </strong>
                        <small>
                            {isZh
                                ? '可以直接结算；登录后可同步购物车、订单和收货地址'
                                : 'Check out now, or sign in to sync your cart, orders and addresses'}
                        </small>
                    </div>
                    <div className="cart-guest-actions">
                        <button type="button" onClick={() => onNavigate({ name: 'login' })}>
                            {isZh ? '登录并同步' : 'Sign in and sync'}
                        </button>
                        <button type="button" onClick={() => onNavigate({ name: 'register' })}>
                            {isZh ? '注册账户' : 'Create account'}
                        </button>
                    </div>
                </section>
            )}
            {loading && !cart ? (
                <ListSkeleton label={isZh ? '正在加载购物车' : 'Loading cart'} />
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
                                lines={sortPinnedLines(physical)}
                                market={market}
                                locale={locale}
                                language={language}
                                loading={loading || locked}
                                favoriteProductIds={favoriteProductIds}
                                pinnedLineIds={pinnedLineIds}
                                openActionLineId={openActionLineId}
                                onSelect={onSelect}
                                onSelectAll={onSelectGroup}
                                onQuantity={onQuantity}
                                onRemove={onRemove}
                                onFavorite={toggleFavoriteLine}
                                onPin={togglePinnedLine}
                                onShare={shareCartProduct}
                                onActionOpenChange={lineId => setOpenActionLineId(lineId)}
                            />
                        )}
                        {!!digital.length && (
                            <CartGroup
                                title={isZh ? '数字商品' : 'Digital products'}
                                hint={isZh ? '付款后自动交付' : 'Delivered after payment'}
                                lines={sortPinnedLines(digital)}
                                market={market}
                                locale={locale}
                                language={language}
                                loading={loading || locked}
                                favoriteProductIds={favoriteProductIds}
                                pinnedLineIds={pinnedLineIds}
                                openActionLineId={openActionLineId}
                                onSelect={onSelect}
                                onSelectAll={onSelectGroup}
                                onQuantity={onQuantity}
                                onRemove={onRemove}
                                onFavorite={toggleFavoriteLine}
                                onPin={togglePinnedLine}
                                onShare={shareCartProduct}
                                onActionOpenChange={lineId => setOpenActionLineId(lineId)}
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
    logoUrl: string | null;
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
        logoUrl,
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
    const latestLogisticsOrder = orders.find(order =>
        order.lines.some(
            line =>
                line.customFields.fulfillmentTypeSnapshot !== 'digital' &&
                line.productVariant.customFields.fulfillmentType !== 'digital',
        ),
    );
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
                {customer ? (
                    <div className="account-hero-customer-card">
                        <div className="account-hero-profile-row">
                            <button
                                className="account-hero-customer-summary"
                                type="button"
                                onClick={() => onNavigate({ name: 'account-security' })}
                            >
                                <span className="account-hero-avatar">
                                    {customerName.slice(0, 1).toUpperCase()}
                                </span>
                                <span className="account-hero-info">
                                    <strong className="account-hero-name">
                                        {isZh ? `${customerName}，你好` : `Hello, ${customerName}`}
                                    </strong>
                                    <span className="account-hero-email">{customer.emailAddress}</span>
                                </span>
                            </button>
                            <button
                                className="account-hero-settings-btn"
                                type="button"
                                title={isZh ? '账户与安全' : 'Account and security'}
                                aria-label={isZh ? '账户与安全' : 'Account and security'}
                                onClick={() => onNavigate({ name: 'account-security' })}
                            >
                                <Settings aria-hidden="true" />
                            </button>
                        </div>
                        <div
                            className="account-metrics-bar"
                            role="group"
                            aria-label={isZh ? '账户资产' : 'Account assets'}
                        >
                            <button
                                type="button"
                                className="account-metric-item"
                                onClick={() => onNavigate({ name: 'favorites' })}
                            >
                                <b>{favoriteProductCount}</b>
                                <span>{isZh ? '我的收藏' : 'Favorites'}</span>
                            </button>
                            <span className="account-metric-divider" aria-hidden="true" />
                            <button
                                type="button"
                                className="account-metric-item"
                                onClick={() => onNavigate({ name: 'coupons' })}
                            >
                                <b>
                                    {couponCount}
                                    {couponCount > 0 && <span className="account-metric-dot" />}
                                </b>
                                <span>{isZh ? '优惠券' : 'Coupons'}</span>
                            </button>
                            <span className="account-metric-divider" aria-hidden="true" />
                            <button
                                type="button"
                                className="account-metric-item"
                                onClick={() => onNavigate({ name: 'history' })}
                            >
                                <b>{recentProductCount}</b>
                                <span>{isZh ? '浏览足迹' : 'History'}</span>
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="account-hero-guest-card">
                        <div className="account-hero-brand" aria-label={storefrontName}>
                            {logoUrl ? (
                                <img className="account-hero-brand-mark" src={logoUrl} alt={storefrontName} />
                            ) : (
                                <span className="account-hero-brand-mark">
                                    <Cloud aria-hidden="true" />
                                </span>
                            )}
                            <strong>{storefrontName.replace(/ai$/i, '')}</strong>
                            {/ai$/i.test(storefrontName) && <b>{storefrontName.slice(-2)}</b>}
                        </div>
                        <div className="account-hero-guest-body">
                            <h1 id="guest-account-title">
                                {isZh ? `欢迎来到 ${storefrontName}` : `Welcome to ${storefrontName}`}
                            </h1>
                            <p>
                                {isZh
                                    ? '登录后可查看订单物流、管理收货地址与专享优惠'
                                    : 'Sign in to manage orders, addresses and benefits'}
                            </p>
                            <div className="account-hero-actions">
                                <button type="button" onClick={() => onNavigate({ name: 'login' })}>
                                    {isZh ? '立即登录' : 'Sign in'}
                                </button>
                                <button type="button" onClick={() => onNavigate({ name: 'register' })}>
                                    {isZh ? '注册账户' : 'Create account'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </section>

            <section className="account-section order-shortcuts">
                <SectionHeader
                    title={isZh ? '我的订单' : 'My orders'}
                    action={isZh ? '全部订单' : 'All orders'}
                    onAction={() => onNavigate({ name: 'orders', tab: 'all' })}
                />
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

            {customer && (
                <section className="account-section tracking-card">
                    <header>
                        <span>
                            <Navigation />
                            <strong>{isZh ? '最新物流' : 'Latest delivery'}</strong>
                        </span>
                        <button
                            className="tracking-more"
                            type="button"
                            onClick={() => onNavigate({ name: 'logistics' })}
                        >
                            {isZh ? '更多' : 'More'}
                            <ChevronRight aria-hidden="true" />
                        </button>
                    </header>
                    {latestLogisticsOrder ? (
                        <button
                            type="button"
                            onClick={() => onNavigate({ name: 'order-detail', id: latestLogisticsOrder.id })}
                        >
                            <OrderImage order={latestLogisticsOrder} />
                            <span>
                                <strong>{orderStateLabel(latestLogisticsOrder.state, language)}</strong>
                                <small>
                                    {isZh
                                        ? `订单号 ${latestLogisticsOrder.code}`
                                        : `Order ${latestLogisticsOrder.code}`}
                                </small>
                            </span>
                            <ChevronRight />
                        </button>
                    ) : (
                        <div className="tracking-empty">
                            <Package aria-hidden="true" />
                            <span>
                                <strong>{isZh ? '暂无物流动态' : 'No delivery updates'}</strong>
                                <small>
                                    {isZh
                                        ? '实物商品发货后会显示在这里'
                                        : 'Physical orders will appear here after purchase'}
                                </small>
                            </span>
                        </div>
                    )}
                </section>
            )}

            <section className="account-section services-section" aria-label={isZh ? '常用服务' : 'Services'}>
                <div className="account-services-grid">
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
                        icon={<TicketPercent />}
                        label={isZh ? '优惠券' : 'Coupons'}
                        badge={couponCount > 0 ? String(couponCount) : undefined}
                        onClick={() => onNavigate({ name: 'coupons' })}
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
                        icon={<MapPin />}
                        label={isZh ? '地址管理' : 'Addresses'}
                        onClick={() =>
                            customer ? onNavigate({ name: 'addresses' }) : onNavigate({ name: 'login' })
                        }
                    />
                    <ServiceButton
                        icon={<Bell />}
                        label={isZh ? '消息通知' : 'Notifications'}
                        onClick={() => onNavigate({ name: 'notifications' })}
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
                centerLabel={isZh ? '专属推荐' : 'Just for you'}
                className="account-recommendation-section"
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
    const loading = productIds.length > 0 && favoritesQuery.isLoading;
    const favoriteError =
        !favoriteProducts.length && favoritesQuery.isPaused
            ? offlineLoadError(language)
            : !favoriteProducts.length && favoritesQuery.error instanceof Error
              ? favoritesQuery.error.message
              : '';
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
                <PageSkeleton label={isZh ? '正在加载收藏商品' : 'Loading favorites'} />
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
    const loading = productIds.length > 0 && historyQuery.isLoading;
    const historyError =
        !historyProducts.length && historyQuery.isPaused
            ? offlineLoadError(language)
            : !historyProducts.length && historyQuery.error instanceof Error
              ? historyQuery.error.message
              : '';

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
                <PageSkeleton label={isZh ? '正在加载浏览足迹' : 'Loading browsing history'} />
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
            ) : afterSalesQuery.isLoading && !orders.length ? (
                <PageSkeleton label={isZh ? '正在加载通知' : 'Loading notifications'} />
            ) : ((afterSalesQuery.isPaused && afterSalesQuery.data === undefined) ||
                  afterSalesQuery.isError) &&
              !orders.length ? (
                <EmptyState
                    icon={<WifiOff />}
                    title={isZh ? '消息加载失败' : 'Could not load notifications'}
                    detail={
                        afterSalesQuery.isPaused
                            ? offlineLoadError(language)
                            : afterSalesQuery.error instanceof Error
                              ? afterSalesQuery.error.message
                              : ''
                    }
                    action={isZh ? '重试' : 'Retry'}
                    onAction={() => void afterSalesQuery.refetch()}
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
    order: OrderSummary,
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
    logoUrl,
    addingVariantId,
    favorite,
    onBack,
    onNavigate,
    onAdd,
    onBuyNow,
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
    logoUrl: string | null;
    addingVariantId: string | null;
    favorite: boolean;
    onBack: () => void;
    onNavigate: (route: RouteState) => void;
    onAdd: (variant: ProductVariant) => void;
    onBuyNow: (variant: ProductVariant) => void;
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
    const descriptionText = productDescriptionText(product.description);
    const descriptionHtml = sanitizeProductDescription(product.description);
    const shareProduct = async () => {
        try {
            if (navigator.share) {
                await navigator.share({ title: product.name, text: descriptionText, url: location.href });
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
                <p>{descriptionText || (isZh ? '暂无更多商品说明' : 'No additional description')}</p>
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
                    <BrandLogo url={logoUrl} name={storefrontName} className="shop-mark" />
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
                {descriptionHtml ? (
                    <div className="detail-rich-text" dangerouslySetInnerHTML={{ __html: descriptionHtml }} />
                ) : (
                    <p>
                        {isZh
                            ? '商品详细信息由商家后台维护。'
                            : 'Product information is managed by the merchant.'}
                    </p>
                )}
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
                    onClick={() => variant && onBuyNow(variant)}
                >
                    {unavailable
                        ? isZh
                            ? '暂时缺货'
                            : 'Unavailable'
                        : addingVariantId === variant?.id
                          ? isZh
                              ? '准备中'
                              : 'Preparing'
                          : isZh
                            ? '立即购买'
                            : 'Buy now'}
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
    const searching = searchQuery.isLoading;
    const loadingMore = searchQuery.isFetchingNextPage;
    const searchError =
        searchQuery.isPaused && searchQuery.data === undefined
            ? offlineLoadError(language)
            : searchQuery.error instanceof Error
              ? searchQuery.error.message
              : '';
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
                queryFn: () => product,
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
                        <ListSkeleton label={isZh ? '正在搜索商品' : 'Searching products'} />
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

function asyncRouteTitle(routeName: RouteName, language: StorefrontLanguage): string {
    const isZh = language === 'zh';
    const routeTitles: Partial<Record<RouteName, string>> = {
        account: isZh ? '我的账户' : 'Account',
        cart: isZh ? '购物车' : 'Cart',
        purchase: isZh ? '确认购买' : 'Confirm purchase',
        checkout: isZh ? '确认订单' : 'Review order',
        payment: isZh ? '选择支付方式' : 'Choose payment',
        'order-confirmation': isZh ? '订单已提交' : 'Order confirmed',
        orders: isZh ? '我的订单' : 'My orders',
        logistics: isZh ? '物流动态' : 'Delivery updates',
        'order-detail': isZh ? '订单详情' : 'Order details',
        addresses: isZh ? '地址管理' : 'Addresses',
        'account-security': isZh ? '账户与安全' : 'Account and security',
        notifications: isZh ? '消息通知' : 'Notifications',
        coupons: isZh ? '优惠券' : 'Coupons',
        reviews: isZh ? '评价中心' : 'Reviews',
        login: isZh ? '登录' : 'Sign in',
        register: isZh ? '注册账户' : 'Create account',
        'verify-account': isZh ? '验证邮箱' : 'Verify email',
        'forgot-password': isZh ? '忘记密码' : 'Forgot password',
        'reset-password': isZh ? '重置密码' : 'Reset password',
    };
    return routeTitles[routeName] ?? (isZh ? '正在加载' : 'Loading');
}

function AsyncRouteStatePage({
    routeName,
    state,
    error,
    language,
    onBack,
    onRetry,
}: {
    routeName: RouteName;
    state: Exclude<QueryLoadState, 'ready'>;
    error: string;
    language: StorefrontLanguage;
    onBack: () => void;
    onRetry: () => void;
}) {
    const isZh = language === 'zh';
    const title = asyncRouteTitle(routeName, language);
    return (
        <Subpage title={title} language={language} onBack={onBack}>
            {state === 'loading' ? (
                <PageSkeleton label={isZh ? '正在加载' : 'Loading'} />
            ) : (
                <EmptyState
                    icon={state === 'paused' ? <WifiOff /> : <CircleAlert />}
                    title={
                        state === 'paused'
                            ? isZh
                                ? '网络连接已暂停'
                                : 'Connection paused'
                            : isZh
                              ? '页面数据加载失败'
                              : 'Could not load this page'
                    }
                    detail={error}
                    action={isZh ? '重试' : 'Retry'}
                    onAction={onRetry}
                />
            )}
        </Subpage>
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
    const title = asyncRouteTitle(routeFromLocation().name, language);
    return (
        <Suspense
            fallback={
                <Subpage title={title} language={language} onBack={onBack}>
                    <PageSkeleton label={language === 'zh' ? '正在加载页面' : 'Loading page'} />
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
    centerLabel,
    action,
    onAction,
    className,
    products,
    market,
    locale,
    addingVariantId,
    favoriteProductIds,
    onProduct,
    onFavorite,
    onAdd,
}: {
    title?: string;
    subtitle?: string;
    centerLabel?: string;
    action?: string;
    onAction?: () => void;
    className?: string;
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
        <section className={`content-section product-section${className ? ` ${className}` : ''}`}>
            <SectionHeader
                title={title}
                subtitle={subtitle}
                centerLabel={centerLabel}
                action={action}
                onAction={onAction}
            />
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
    const isZh = locale.startsWith('zh');
    const variant = product.variants[0];
    const isDigital = variant?.customFields?.fulfillmentType === 'digital';
    const isOutOfStock =
        variant?.customFields?.fulfillmentType === 'physical' && variant.stockLevel === 'OUT_OF_STOCK';

    return (
        <article
            className={`product-card${isDigital ? ' is-digital-card' : ''}`}
            onPointerEnter={() => prefetchProductAsset(product)}
            onPointerDown={() => prefetchProductAsset(product)}
            onFocus={() => prefetchProductAsset(product)}
        >
            <button
                className="product-card-detail-link"
                type="button"
                onClick={onOpen}
                aria-label={`${isZh ? '查看' : 'View'} ${product.name}`}
            />
            <div className="product-card-badge-wrap">
                {isDigital ? (
                    <span className="product-card-badge is-digital-badge">
                        <Download aria-hidden="true" />
                        {isZh ? '数字即时交付' : 'Digital'}
                    </span>
                ) : isOutOfStock ? (
                    <span className="product-card-badge is-out-badge">
                        {isZh ? '暂时缺货' : 'Out of stock'}
                    </span>
                ) : (
                    <span className="product-card-badge is-physical-badge">
                        {isZh ? '现货速发' : 'In Stock'}
                    </span>
                )}
            </div>
            {onFavorite && (
                <button
                    className={`product-card-favorite${favorite ? ' is-active' : ''}`}
                    type="button"
                    onClick={onFavorite}
                    aria-pressed={favorite}
                    aria-label={
                        favorite
                            ? isZh
                                ? `取消收藏 ${product.name}`
                                : `Remove ${product.name} from favorites`
                            : isZh
                              ? `收藏 ${product.name}`
                              : `Add ${product.name} to favorites`
                    }
                >
                    <Heart fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" />
                </button>
            )}
            <div className="product-card-image">
                <ProductImage product={product} />
            </div>
            <strong className="product-card-name">{product.name}</strong>
            <span className="product-card-desc">{trimText(product.description, 26) || variant?.sku}</span>
            <footer>
                <div className="product-card-price-block">
                    <b>
                        {variant
                            ? formatMoney(variant.priceWithTax, variant.currencyCode, locale)
                            : formatMoney(0, market.currencyCode, locale)}
                    </b>
                    <small className="product-card-tax-label">{isZh ? '含税' : 'incl. tax'}</small>
                </div>
                <button
                    type="button"
                    className={`product-card-add-btn${adding ? ' is-adding' : ''}`}
                    onClick={onAdd}
                    disabled={!variant || adding || isOutOfStock}
                    aria-label={`${isZh ? '加入购物车' : 'Add to cart'} ${product.name}`}
                >
                    {adding ? <Check aria-hidden="true" /> : <Plus aria-hidden="true" />}
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
                className="product-row-detail-link"
                onClick={onOpen}
                aria-label={`${isZh ? '查看' : 'View'} ${product.name}`}
            />
            <div className="product-row-image">
                <ProductImage product={product} />
            </div>
            <div>
                <strong className="product-row-name">{product.name}</strong>
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
    favoriteProductIds,
    pinnedLineIds,
    openActionLineId,
    onSelect,
    onSelectAll,
    onQuantity,
    onRemove,
    onFavorite,
    onPin,
    onShare,
    onActionOpenChange,
}: {
    title: string;
    hint: string;
    lines: StorefrontCart['lines'];
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    loading: boolean;
    favoriteProductIds: string[];
    pinnedLineIds: string[];
    openActionLineId: string | null;
    onSelect: (lineId: string, selected: boolean) => void;
    onSelectAll: (lineIds: string[], selected: boolean) => void;
    onQuantity: (lineId: string, quantity: number) => void;
    onRemove: (lineId: string) => void;
    onFavorite: (productId: string, productName: string) => void;
    onPin: (lineId: string, productName: string) => void;
    onShare: (productId: string, productName: string) => Promise<void>;
    onActionOpenChange: (lineId: string | null) => void;
}) {
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
            {lines.map(line => (
                <SwipeableCartLine
                    key={line.id}
                    line={line}
                    market={market}
                    locale={locale}
                    language={language}
                    loading={loading}
                    open={openActionLineId === line.id}
                    favorite={
                        !!line.productVariant?.product.id &&
                        favoriteProductIds.includes(line.productVariant.product.id)
                    }
                    pinned={pinnedLineIds.includes(line.id)}
                    onSelect={onSelect}
                    onQuantity={onQuantity}
                    onRemove={onRemove}
                    onFavorite={onFavorite}
                    onPin={onPin}
                    onShare={onShare}
                    onActionOpenChange={onActionOpenChange}
                />
            ))}
        </section>
    );
}

const CART_SWIPE_FALLBACK_WIDTH = 240;
const CART_SWIPE_THRESHOLD = 48;

function SwipeableCartLine({
    line,
    market,
    locale,
    language,
    loading,
    open,
    favorite,
    pinned,
    onSelect,
    onQuantity,
    onRemove,
    onFavorite,
    onPin,
    onShare,
    onActionOpenChange,
}: {
    line: StorefrontCart['lines'][number];
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    loading: boolean;
    open: boolean;
    favorite: boolean;
    pinned: boolean;
    onSelect: (lineId: string, selected: boolean) => void;
    onQuantity: (lineId: string, quantity: number) => void;
    onRemove: (lineId: string) => void;
    onFavorite: (productId: string, productName: string) => void;
    onPin: (lineId: string, productName: string) => void;
    onShare: (productId: string, productName: string) => Promise<void>;
    onActionOpenChange: (lineId: string | null) => void;
}) {
    const isZh = language === 'zh';
    const variant = line.productVariant;
    const productId = variant?.product.id;
    const productName = variant?.name ?? (isZh ? '商品' : 'item');
    const frontRef = useRef<HTMLDivElement>(null);
    const actionsRef = useRef<HTMLDivElement>(null);
    const gestureRef = useRef({
        active: false,
        horizontal: false,
        startX: 0,
        startY: 0,
        startOffset: 0,
        suppressClick: false,
    });

    useEffect(() => {
        const front = frontRef.current;
        if (!front) return;
        front.classList.remove('is-dragging');
        front.style.transform = '';
    }, [open]);

    const actionWidth = () => actionsRef.current?.offsetWidth ?? CART_SWIPE_FALLBACK_WIDTH;

    const beginSwipe = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (
            loading ||
            event.button !== 0 ||
            (event.target instanceof Element && event.target.closest('button, input, label'))
        ) {
            return;
        }
        const front = event.currentTarget;
        const width = actionWidth();
        gestureRef.current = {
            active: true,
            horizontal: false,
            startX: event.clientX,
            startY: event.clientY,
            startOffset: open ? -width : 0,
            suppressClick: false,
        };
        front.setPointerCapture(event.pointerId);
        front.classList.add('is-dragging');
    };

    const moveSwipe = (event: ReactPointerEvent<HTMLDivElement>) => {
        const gesture = gestureRef.current;
        if (!gesture.active) return;
        const deltaX = event.clientX - gesture.startX;
        const deltaY = event.clientY - gesture.startY;
        if (!gesture.horizontal) {
            if (Math.abs(deltaY) > Math.abs(deltaX) + 6) {
                gesture.active = false;
                event.currentTarget.classList.remove('is-dragging');
                event.currentTarget.style.transform = '';
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                }
                return;
            }
            if (Math.abs(deltaX) < 6) return;
            gesture.horizontal = true;
        }
        event.preventDefault();
        const nextOffset = Math.max(-actionWidth(), Math.min(0, gesture.startOffset + deltaX));
        event.currentTarget.style.transform = `translate3d(${nextOffset}px, 0, 0)`;
    };

    const finishSwipe = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
        const gesture = gestureRef.current;
        if (!gesture.active && !gesture.horizontal) return;
        const deltaX = event.clientX - gesture.startX;
        let shouldOpen = open;
        if (!cancelled && gesture.horizontal) {
            if (deltaX <= -CART_SWIPE_THRESHOLD) shouldOpen = true;
            if (deltaX >= CART_SWIPE_THRESHOLD) shouldOpen = false;
            gesture.suppressClick = true;
        }
        gesture.active = false;
        gesture.horizontal = false;
        const front = event.currentTarget;
        front.classList.remove('is-dragging');
        front.style.transform = `translate3d(${shouldOpen ? -actionWidth() : 0}px, 0, 0)`;
        if (front.hasPointerCapture(event.pointerId)) front.releasePointerCapture(event.pointerId);
        onActionOpenChange(shouldOpen ? line.id : null);
        requestAnimationFrame(() => {
            front.style.transform = '';
        });
    };

    const closeAfterAction = () => onActionOpenChange(null);

    return (
        <article
            className={`cart-line-swipe${open ? ' is-open' : ''}`}
            data-swipe-open={open ? 'true' : 'false'}
            onKeyDown={event => {
                if (event.key === 'Escape') closeAfterAction();
            }}
        >
            <div
                className="cart-line-swipe-actions"
                ref={actionsRef}
                aria-label={isZh ? `${productName} 商品操作` : `${productName} actions`}
            >
                <button
                    className={favorite ? 'is-active' : ''}
                    type="button"
                    data-cart-action="favorite"
                    aria-pressed={favorite}
                    aria-label={
                        favorite
                            ? isZh
                                ? `取消收藏 ${productName}`
                                : `Remove ${productName} from favorites`
                            : isZh
                              ? `收藏 ${productName}`
                              : `Save ${productName}`
                    }
                    disabled={loading || !productId}
                    onFocus={() => onActionOpenChange(line.id)}
                    onClick={() => productId && onFavorite(productId, productName)}
                >
                    <Heart fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" />
                    <span>{favorite ? (isZh ? '已收藏' : 'Saved') : isZh ? '收藏' : 'Save'}</span>
                </button>
                <button
                    type="button"
                    data-cart-action="share"
                    aria-label={isZh ? `分享 ${productName}` : `Share ${productName}`}
                    disabled={loading || !productId}
                    onFocus={() => onActionOpenChange(line.id)}
                    onClick={() => {
                        if (!productId) return;
                        closeAfterAction();
                        void onShare(productId, productName);
                    }}
                >
                    <Share2 aria-hidden="true" />
                    <span>{isZh ? '分享' : 'Share'}</span>
                </button>
                <button
                    className={pinned ? 'is-active' : ''}
                    type="button"
                    data-cart-action="pin"
                    aria-pressed={pinned}
                    aria-label={
                        pinned
                            ? isZh
                                ? `取消置顶 ${productName}`
                                : `Unpin ${productName}`
                            : isZh
                              ? `置顶 ${productName}`
                              : `Pin ${productName}`
                    }
                    disabled={loading}
                    onFocus={() => onActionOpenChange(line.id)}
                    onClick={() => onPin(line.id, productName)}
                >
                    <Pin fill={pinned ? 'currentColor' : 'none'} aria-hidden="true" />
                    <span>{pinned ? (isZh ? '已置顶' : 'Pinned') : isZh ? '置顶' : 'Pin'}</span>
                </button>
                <button
                    className="cart-line-delete-action"
                    type="button"
                    data-cart-action="remove"
                    aria-label={isZh ? `删除 ${productName}` : `Remove ${productName}`}
                    disabled={loading}
                    onFocus={() => onActionOpenChange(line.id)}
                    onClick={() => onRemove(line.id)}
                >
                    <Trash2 aria-hidden="true" />
                    <span>{isZh ? '删除' : 'Remove'}</span>
                </button>
            </div>

            <div
                ref={frontRef}
                className={`cart-line ${line.selected ? '' : 'is-unselected'}`}
                onPointerDown={beginSwipe}
                onPointerMove={moveSwipe}
                onPointerUp={event => finishSwipe(event)}
                onPointerCancel={event => finishSwipe(event, true)}
                onClick={event => {
                    if (gestureRef.current.suppressClick) {
                        gestureRef.current.suppressClick = false;
                        return;
                    }
                    if (
                        open &&
                        !(event.target instanceof Element && event.target.closest('button, input, label'))
                    ) {
                        closeAfterAction();
                    }
                }}
            >
                <label className="round-check">
                    <input
                        type="checkbox"
                        aria-label={isZh ? `选择 ${productName}` : `Select ${productName}`}
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
                    <button
                        className="cart-line-swipe-toggle"
                        type="button"
                        aria-expanded={open}
                        aria-label={
                            open
                                ? isZh
                                    ? `收起 ${productName} 的商品操作`
                                    : `Close ${productName} actions`
                                : isZh
                                  ? `展开 ${productName} 的商品操作`
                                  : `Open ${productName} actions`
                        }
                        onClick={() => onActionOpenChange(open ? null : line.id)}
                    >
                        <ChevronLeft aria-hidden="true" />
                    </button>
                    <strong>{variant?.name ?? (isZh ? '商品已失效' : 'Unavailable item')}</strong>
                    <small>{variant?.sku}</small>
                    <div className="cart-line-purchase-row">
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
                                        isZh ? `减少 ${productName} 数量` : `Decrease ${productName} quantity`
                                    }
                                    onClick={() => onQuantity(line.id, line.quantity - 1)}
                                    disabled={loading || line.quantity <= 1}
                                >
                                    <Minus />
                                </button>
                                <span>{line.quantity}</span>
                                <button
                                    type="button"
                                    aria-label={
                                        isZh ? `增加 ${productName} 数量` : `Increase ${productName} quantity`
                                    }
                                    onClick={() => onQuantity(line.id, line.quantity + 1)}
                                    disabled={loading || !line.available}
                                >
                                    <Plus />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </article>
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
function getSectionIcon(title?: string): ReactNode {
    if (!title) return null;
    if (/特惠|优惠|折扣|券|省钱/i.test(title)) return <Tag size={13} />;
    if (/热门|爆款|热销|推荐|人气/i.test(title)) return <Flame size={13} />;
    if (/精选|本周|新品|首发|挑选/i.test(title)) return <Sparkles size={13} />;
    if (/分类|全部|品类|探索/i.test(title)) return <LayoutGrid size={13} />;
    if (/服务|保障|售后|安全/i.test(title)) return <ShieldCheck size={13} />;
    if (/订单|历史|购买/i.test(title)) return <Package size={13} />;
    return <ShoppingBag size={13} />;
}

function SectionHeader({
    title,
    subtitle,
    centerLabel,
    action,
    onAction,
    icon,
}: {
    title?: string;
    subtitle?: string;
    centerLabel?: string;
    action?: string;
    onAction?: () => void;
    icon?: ReactNode;
}) {
    const resolvedIcon = icon ?? getSectionIcon(title);
    return (
        <header className="section-header">
            {(title || subtitle) && (
                <div className="section-header-title-lockup">
                    <div className="section-header-title-row">
                        {resolvedIcon && (
                            <span className="section-header-icon-pill" aria-hidden="true">
                                {resolvedIcon}
                            </span>
                        )}
                        {title && <h2>{title}</h2>}
                    </div>
                    {subtitle && <p>{subtitle}</p>}
                </div>
            )}
            {centerLabel &&
                (title ? (
                    <span className="section-header-center-label">{centerLabel}</span>
                ) : (
                    <h2 className="section-header-center-label">{centerLabel}</h2>
                ))}
            {action && (
                <button type="button" className="section-header-action-btn" onClick={onAction}>
                    <span>{action}</span>
                    <ChevronRight size={13} aria-hidden="true" />
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
            const imageElement = imageRef.current;
            if (imageElement?.complete && imageElement.naturalWidth > 0) setLoaded(true);
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
function OrderImage({ order }: { order: OrderSummary }) {
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
function ListSkeleton({ label = 'Loading' }: { label?: string }) {
    return (
        <div className="list-skeleton" role="status" aria-label={label}>
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
function minimumProductPrice(product: Product): number {
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
            id: '3',
            name: isZh ? '桌面工作站' : 'Workstations',
            slug: 'cn-workstations',
            description: isZh ? '办公平板、4K显示器与极简主机' : 'Tablets, 4K displays & mini desktops',
            position: 0,
            parentId: '',
            featuredAsset: { id: '8', preview: '/storefront/categories/category-workstations.jpg' },
            children: [
                {
                    id: '30',
                    name: isZh ? '全部工作站' : 'All',
                    slug: 'all-workstations',
                    description: '',
                    position: 0,
                    parentId: '3',
                    featuredAsset: null,
                },
                {
                    id: '31',
                    name: isZh ? '便携平板' : 'Tablets',
                    slug: 'tablets',
                    description: '',
                    position: 1,
                    parentId: '3',
                    featuredAsset: null,
                },
                {
                    id: '32',
                    name: isZh ? '4K显示器' : '4K Displays',
                    slug: 'displays',
                    description: '',
                    position: 2,
                    parentId: '3',
                    featuredAsset: null,
                },
                {
                    id: '33',
                    name: isZh ? '迷你主机' : 'Mini PCs',
                    slug: 'mini-pcs',
                    description: '',
                    position: 3,
                    parentId: '3',
                    featuredAsset: null,
                },
                {
                    id: '34',
                    name: isZh ? '升降桌搭配' : 'Desk Units',
                    slug: 'desk-units',
                    description: '',
                    position: 4,
                    parentId: '3',
                    featuredAsset: null,
                },
            ],
        },
        {
            id: '4',
            name: isZh ? '办公外设' : 'Office Input',
            slug: 'cn-office-input',
            description: isZh ? '机械键盘、静音鼠标与手托' : 'Mechanical keyboards & quiet mice',
            position: 1,
            parentId: '',
            featuredAsset: { id: '9', preview: '/storefront/categories/category-office-input.jpg' },
            children: [
                {
                    id: '40',
                    name: isZh ? '全部外设' : 'All Input',
                    slug: 'all-input',
                    description: '',
                    position: 0,
                    parentId: '4',
                    featuredAsset: null,
                },
                {
                    id: '41',
                    name: isZh ? '机械键盘' : 'Keyboards',
                    slug: 'keyboards',
                    description: '',
                    position: 1,
                    parentId: '4',
                    featuredAsset: null,
                },
                {
                    id: '42',
                    name: isZh ? '静音鼠标' : 'Quiet Mice',
                    slug: 'mice',
                    description: '',
                    position: 2,
                    parentId: '4',
                    featuredAsset: null,
                },
                {
                    id: '43',
                    name: isZh ? '工学手托' : 'Wrist Rests',
                    slug: 'wrist-rests',
                    description: '',
                    position: 3,
                    parentId: '4',
                    featuredAsset: null,
                },
                {
                    id: '44',
                    name: isZh ? '数位绘图板' : 'Draw Pads',
                    slug: 'draw-pads',
                    description: '',
                    position: 4,
                    parentId: '4',
                    featuredAsset: null,
                },
            ],
        },
        {
            id: '5',
            name: isZh ? '人体工学' : 'Ergonomics',
            slug: 'cn-ergonomics',
            description: isZh ? '人体工学椅与显示器支架' : 'Chairs & monitor arms',
            position: 2,
            parentId: '',
            featuredAsset: { id: '10', preview: '/storefront/categories/category-mobile-computing.jpg' },
            children: [
                {
                    id: '50',
                    name: isZh ? '全部工学' : 'All Ergo',
                    slug: 'all-ergo',
                    description: '',
                    position: 0,
                    parentId: '5',
                    featuredAsset: null,
                },
                {
                    id: '51',
                    name: isZh ? '人体工学椅' : 'Chairs',
                    slug: 'chairs',
                    description: '',
                    position: 1,
                    parentId: '5',
                    featuredAsset: null,
                },
                {
                    id: '52',
                    name: isZh ? '显示器支架' : 'Monitor Arms',
                    slug: 'monitor-arms',
                    description: '',
                    position: 2,
                    parentId: '5',
                    featuredAsset: null,
                },
                {
                    id: '53',
                    name: isZh ? '桌下脚踏板' : 'Footrests',
                    slug: 'footrests',
                    description: '',
                    position: 3,
                    parentId: '5',
                    featuredAsset: null,
                },
                {
                    id: '54',
                    name: isZh ? '桌面理线' : 'Cable Racks',
                    slug: 'cable-racks',
                    description: '',
                    position: 4,
                    parentId: '5',
                    featuredAsset: null,
                },
            ],
        },
        {
            id: '6',
            name: isZh ? '数字资产' : 'Digital Assets',
            slug: 'cn-digital-assets',
            description: isZh ? 'AI 效率课、提示词库与文案素材' : 'AI courses, prompts & toolkits',
            position: 3,
            parentId: '',
            featuredAsset: { id: '12', preview: '/storefront/categories/category-digital-library.jpg' },
            children: [
                {
                    id: '60',
                    name: isZh ? '全部数字库' : 'All Digital',
                    slug: 'all-digital',
                    description: '',
                    position: 0,
                    parentId: '6',
                    featuredAsset: null,
                },
                {
                    id: '61',
                    name: isZh ? 'AI实战课' : 'AI Courses',
                    slug: 'ai-courses',
                    description: '',
                    position: 1,
                    parentId: '6',
                    featuredAsset: null,
                },
                {
                    id: '62',
                    name: isZh ? '提示词库' : 'Prompts',
                    slug: 'prompts',
                    description: '',
                    position: 2,
                    parentId: '6',
                    featuredAsset: null,
                },
                {
                    id: '63',
                    name: isZh ? '电商文案包' : 'Copy Packs',
                    slug: 'copy-packs',
                    description: '',
                    position: 3,
                    parentId: '6',
                    featuredAsset: null,
                },
                {
                    id: '64',
                    name: isZh ? '短视频脚本' : 'Video Scripts',
                    slug: 'video-scripts',
                    description: '',
                    position: 4,
                    parentId: '6',
                    featuredAsset: null,
                },
            ],
        },
        {
            id: '7',
            name: isZh ? '影音数码' : 'Audio & Media',
            slug: 'cn-audio-media',
            description: isZh ? '降噪耳机、桌面音箱与麦克风' : 'Headphones, speakers & mics',
            position: 4,
            parentId: '',
            featuredAsset: { id: '11', preview: '/storefront/categories/category-desk-setup.jpg' },
            children: [
                {
                    id: '70',
                    name: isZh ? '全部影音' : 'All Audio',
                    slug: 'all-audio',
                    description: '',
                    position: 0,
                    parentId: '7',
                    featuredAsset: null,
                },
                {
                    id: '71',
                    name: isZh ? '降噪耳机' : 'Headphones',
                    slug: 'headphones',
                    description: '',
                    position: 1,
                    parentId: '7',
                    featuredAsset: null,
                },
                {
                    id: '72',
                    name: isZh ? '桌面音箱' : 'Speakers',
                    slug: 'speakers',
                    description: '',
                    position: 2,
                    parentId: '7',
                    featuredAsset: null,
                },
                {
                    id: '73',
                    name: isZh ? '4K摄像头' : 'Webcams',
                    slug: 'webcams',
                    description: '',
                    position: 3,
                    parentId: '7',
                    featuredAsset: null,
                },
                {
                    id: '74',
                    name: isZh ? '专业麦克风' : 'Microphones',
                    slug: 'microphones',
                    description: '',
                    position: 4,
                    parentId: '7',
                    featuredAsset: null,
                },
            ],
        },
        {
            id: '8',
            name: isZh ? '扩展与电源' : 'Hubs & Power',
            slug: 'cn-hubs-power',
            description: isZh ? 'Type-C 拓展坞、快充头与雷电线' : 'USB-C hubs, GaN chargers & cables',
            position: 5,
            parentId: '',
            featuredAsset: { id: '10', preview: '/storefront/categories/category-mobile-computing.jpg' },
            children: [
                {
                    id: '80',
                    name: isZh ? '全部配件' : 'All Power',
                    slug: 'all-power',
                    description: '',
                    position: 0,
                    parentId: '8',
                    featuredAsset: null,
                },
                {
                    id: '81',
                    name: isZh ? 'Type-C拓展坞' : 'USB-C Hubs',
                    slug: 'usbc-hubs',
                    description: '',
                    position: 1,
                    parentId: '8',
                    featuredAsset: null,
                },
                {
                    id: '82',
                    name: isZh ? '氮化镓快充' : 'GaN Power',
                    slug: 'gan-power',
                    description: '',
                    position: 2,
                    parentId: '8',
                    featuredAsset: null,
                },
                {
                    id: '83',
                    name: isZh ? '雷电4数据线' : 'Thunderbolt',
                    slug: 'thunderbolt',
                    description: '',
                    position: 3,
                    parentId: '8',
                    featuredAsset: null,
                },
                {
                    id: '84',
                    name: isZh ? '桌面排插' : 'Power Strips',
                    slug: 'power-strips',
                    description: '',
                    position: 4,
                    parentId: '8',
                    featuredAsset: null,
                },
            ],
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

function fallbackDemoProducts(language: StorefrontLanguage, currencyCode: string): Product[] {
    const isZh = language === 'zh';
    return [
        {
            id: '1',
            createdAt: '2026-08-20T00:00:00.000Z',
            name: isZh ? 'Slate 11 便携工作平板' : 'Slate 11 Portable Tablet',
            slug: 'slate-11-portable-tablet',
            description: isZh
                ? '11 英寸便携平板，配备 2.8K 原色全面屏，适合阅读、记录与日常桌面工作。'
                : 'An 11-inch tablet for reading, note-taking and focused desk work.',
            featuredAsset: { id: 'a1', preview: '/assets/preview/kelly-sikkema-685291-unsplash.jpg' },
            assets: [{ id: 'a1', preview: '/assets/preview/kelly-sikkema-685291-unsplash.jpg' }],
            collections: [
                {
                    id: '3',
                    name: isZh ? '桌面工作站' : 'Workstations',
                    slug: 'cn-workstations',
                    parentId: '',
                },
            ],
            variants: [
                {
                    id: 'v1',
                    name: isZh ? '128 GB · Wi-Fi · 石墨灰' : '128 GB · Wi-Fi · Graphite',
                    sku: 'DEMO-TABLET-128',
                    priceWithTax: currencyCode === 'MYR' ? 209900 : 329900,
                    currencyCode,
                    stockLevel: 'IN_STOCK',
                    featuredAsset: null,
                    product: {
                        id: '1',
                        name: isZh ? 'Slate 11 便携工作平板' : 'Slate 11 Portable Tablet',
                        featuredAsset: null,
                    },
                    customFields: { fulfillmentType: 'physical' },
                },
            ],
        },
        {
            id: '2',
            createdAt: '2026-08-20T00:00:00.000Z',
            name: isZh ? 'ViewLine 27 英寸 4K 显示器' : 'ViewLine 27 4K Monitor',
            slug: 'viewline-27-4k-monitor',
            description: isZh
                ? '27 英寸 4K 专业级超清显示器，配备多功能升降旋转支架与 Type-C 90W 供电。'
                : 'A 27-inch 4K display with an adjustable stand for detailed everyday work.',
            featuredAsset: { id: 'a2', preview: '/assets/preview/daniel-korpai-1302051-unsplash.jpg' },
            assets: [{ id: 'a2', preview: '/assets/preview/daniel-korpai-1302051-unsplash.jpg' }],
            collections: [
                {
                    id: '3',
                    name: isZh ? '桌面工作站' : 'Workstations',
                    slug: 'cn-workstations',
                    parentId: '',
                },
            ],
            variants: [
                {
                    id: 'v2',
                    name: isZh ? '27 英寸 · 4K · 可调节支架' : '27 inch · 4K · Adjustable stand',
                    sku: 'DEMO-MONITOR-27-4K',
                    priceWithTax: currencyCode === 'MYR' ? 129900 : 209900,
                    currencyCode,
                    stockLevel: 'IN_STOCK',
                    featuredAsset: null,
                    product: {
                        id: '2',
                        name: isZh ? 'ViewLine 27 英寸 4K 显示器' : 'ViewLine 27 4K Monitor',
                        featuredAsset: null,
                    },
                    customFields: { fulfillmentType: 'physical' },
                },
            ],
        },
        {
            id: '3',
            createdAt: '2026-08-20T00:00:00.000Z',
            name: isZh ? 'Keyline 75 机械键盘' : 'Keyline 75 Mechanical Keyboard',
            slug: 'keyline-75-mechanical-keyboard',
            description: isZh
                ? '紧凑 75% 配列机械键盘，客制化段落轴体，全键热插拔与三模无线连接。'
                : 'A compact mechanical keyboard with a tactile layout for daily writing.',
            featuredAsset: { id: 'a3', preview: '/assets/preview/juan-gomez-674574-unsplash.jpg' },
            assets: [{ id: 'a3', preview: '/assets/preview/juan-gomez-674574-unsplash.jpg' }],
            collections: [
                {
                    id: '4',
                    name: isZh ? '办公输入设备' : 'Office Input',
                    slug: 'cn-office-input',
                    parentId: '',
                },
            ],
            variants: [
                {
                    id: 'v3',
                    name: isZh ? '75% 配列 · 段落轴 · 曜石黑' : '75% layout · Tactile switch',
                    sku: 'DEMO-KEYBOARD-75',
                    priceWithTax: currencyCode === 'MYR' ? 35900 : 54900,
                    currencyCode,
                    stockLevel: 'IN_STOCK',
                    featuredAsset: null,
                    product: {
                        id: '3',
                        name: isZh ? 'Keyline 75 机械键盘' : 'Keyline 75 Mechanical Keyboard',
                        featuredAsset: null,
                    },
                    customFields: { fulfillmentType: 'physical' },
                },
            ],
        },
        {
            id: '4',
            createdAt: '2026-08-20T00:00:00.000Z',
            name: isZh ? 'Arc Mini 静音无线鼠标' : 'Arc Mini Wireless Mouse',
            slug: 'arc-mini-wireless-mouse',
            description: isZh
                ? '轻巧便携的静音微动无线鼠标，人体工学贴合手型，长续航双模蓝牙连接。'
                : 'A compact wireless mouse with quiet clicks for shared workspaces.',
            featuredAsset: {
                id: 'a4',
                preview: '/assets/preview/oscar-ivan-esquivel-arteaga-687447-unsplash.jpg',
            },
            assets: [
                { id: 'a4', preview: '/assets/preview/oscar-ivan-esquivel-arteaga-687447-unsplash.jpg' },
            ],
            collections: [
                {
                    id: '4',
                    name: isZh ? '办公输入设备' : 'Office Input',
                    slug: 'cn-office-input',
                    parentId: '',
                },
            ],
            variants: [
                {
                    id: 'v4',
                    name: isZh ? '石墨灰 · 静音按键' : 'Graphite · Quiet click',
                    sku: 'DEMO-MOUSE-SILENT',
                    priceWithTax: currencyCode === 'MYR' ? 12900 : 19900,
                    currencyCode,
                    stockLevel: 'IN_STOCK',
                    featuredAsset: null,
                    product: {
                        id: '4',
                        name: isZh ? 'Arc Mini 静音无线鼠标' : 'Arc Mini Wireless Mouse',
                        featuredAsset: null,
                    },
                    customFields: { fulfillmentType: 'physical' },
                },
            ],
        },
        {
            id: '5',
            createdAt: '2026-08-20T00:00:00.000Z',
            name: isZh ? 'AI 工作效率入门课' : 'AI Workflow Starter Course',
            slug: 'ai-workflow-starter-course',
            description: isZh
                ? '覆盖大模型调研、写作、代码辅助与自动化复盘的实战 AI 工作流体系课。'
                : 'A concise starter course covering practical research, writing, planning and review workflows.',
            featuredAsset: { id: 'a5', preview: '/assets/preview/florian-olivo-1166419-unsplash.jpg' },
            assets: [{ id: 'a5', preview: '/assets/preview/florian-olivo-1166419-unsplash.jpg' }],
            collections: [
                {
                    id: '7',
                    name: isZh ? '数字内容库' : 'Digital Library',
                    slug: 'cn-digital-library',
                    parentId: '',
                },
            ],
            variants: [
                {
                    id: 'v5',
                    name: isZh ? '数字下载 · 完整体系版' : 'Digital download · Starter edition',
                    sku: 'DEMO-DIGITAL-AI-STARTER',
                    priceWithTax: currencyCode === 'MYR' ? 5900 : 9900,
                    currencyCode,
                    stockLevel: 'IN_STOCK',
                    featuredAsset: null,
                    product: {
                        id: '5',
                        name: isZh ? 'AI 工作效率入门课' : 'AI Workflow Starter Course',
                        featuredAsset: null,
                    },
                    customFields: { fulfillmentType: 'digital' },
                },
            ],
        },
        {
            id: '6',
            createdAt: '2026-08-20T00:00:00.000Z',
            name: isZh ? '商务提示词模板库' : 'Business Prompt Template Library',
            slug: 'business-prompt-template-library',
            description: isZh
                ? '精选 500+ 高频商务场景提示词模板，包含方案写作、竞品分析与报告生成。'
                : 'Structured prompt templates for common business writing and analysis tasks.',
            featuredAsset: { id: 'a6', preview: '/assets/preview/brandi-redd-104140-unsplash.jpg' },
            assets: [{ id: 'a6', preview: '/assets/preview/brandi-redd-104140-unsplash.jpg' }],
            collections: [
                {
                    id: '7',
                    name: isZh ? '数字内容库' : 'Digital Library',
                    slug: 'cn-digital-library',
                    parentId: '',
                },
            ],
            variants: [
                {
                    id: 'v6',
                    name: isZh ? '数字下载 · 500+ 提示词包' : 'Digital download · Template pack',
                    sku: 'DEMO-DIGITAL-PROMPTS',
                    priceWithTax: currencyCode === 'MYR' ? 2900 : 4900,
                    currencyCode,
                    stockLevel: 'IN_STOCK',
                    featuredAsset: null,
                    product: {
                        id: '6',
                        name: isZh ? '商务提示词模板库' : 'Business Prompt Template Library',
                        featuredAsset: null,
                    },
                    customFields: { fulfillmentType: 'digital' },
                },
            ],
        },
        {
            id: '7',
            createdAt: '2026-08-20T00:00:00.000Z',
            name: isZh ? '电商文案工具包' : 'E-commerce Copywriting Toolkit',
            slug: 'ecommerce-copywriting-toolkit',
            description: isZh
                ? '可直接复用的爆款详情页排版、卖点提炼与高转化文案框架结构库。'
                : 'A reusable product-page structure and evidence checklist for e-commerce operations.',
            featuredAsset: { id: 'a7', preview: '/assets/preview/kari-shea-398668-unsplash.jpg' },
            assets: [{ id: 'a7', preview: '/assets/preview/kari-shea-398668-unsplash.jpg' }],
            collections: [
                {
                    id: '7',
                    name: isZh ? '数字内容库' : 'Digital Library',
                    slug: 'cn-digital-library',
                    parentId: '',
                },
            ],
            variants: [
                {
                    id: 'v7',
                    name: isZh ? '数字下载 · 全套工具包' : 'Digital download · Toolkit',
                    sku: 'DEMO-DIGITAL-ECOMMERCE',
                    priceWithTax: currencyCode === 'MYR' ? 9900 : 15900,
                    currencyCode,
                    stockLevel: 'IN_STOCK',
                    featuredAsset: null,
                    product: {
                        id: '7',
                        name: isZh ? '电商文案工具包' : 'E-commerce Copywriting Toolkit',
                        featuredAsset: null,
                    },
                    customFields: { fulfillmentType: 'digital' },
                },
            ],
        },
        {
            id: '8',
            createdAt: '2026-08-20T00:00:00.000Z',
            name: isZh ? '短视频脚本素材包' : 'Short Video Script Pack',
            slug: 'short-video-script-pack',
            description: isZh
                ? '包含 100+ 短视频开头黄金前三秒话术、分镜结构与实操拍摄检查清单。'
                : 'A concise script framework and production checklist for short-form video.',
            featuredAsset: { id: 'a8', preview: '/assets/preview/jakob-owens-274337-unsplash.jpg' },
            assets: [{ id: 'a8', preview: '/assets/preview/jakob-owens-274337-unsplash.jpg' }],
            collections: [
                {
                    id: '7',
                    name: isZh ? '数字内容库' : 'Digital Library',
                    slug: 'cn-digital-library',
                    parentId: '',
                },
            ],
            variants: [
                {
                    id: 'v8',
                    name: isZh ? '数字下载 · 脚本包' : 'Digital download · Script pack',
                    sku: 'DEMO-DIGITAL-VIDEO',
                    priceWithTax: currencyCode === 'MYR' ? 4900 : 7900,
                    currencyCode,
                    stockLevel: 'IN_STOCK',
                    featuredAsset: null,
                    product: {
                        id: '8',
                        name: isZh ? '短视频脚本素材包' : 'Short Video Script Pack',
                        featuredAsset: null,
                    },
                    customFields: { fulfillmentType: 'digital' },
                },
            ],
        },
    ];
}
