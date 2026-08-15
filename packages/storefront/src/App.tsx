import {
    ArrowLeft,
    ArrowUpDown,
    Bell,
    Check,
    ChevronRight,
    CircleAlert,
    CircleCheck,
    Clock3,
    Coffee,
    Download,
    Fingerprint,
    House,
    LayoutGrid,
    MapPin,
    MessageSquare,
    Minus,
    Navigation,
    Package,
    Pencil,
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
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ShopApi, ShopApiError } from './api';
import { enabledMarkets, languageCodeFor, localeFor, marketCodeForChannel, markets, uiCopy } from './i18n';
import {
    ActiveCustomer,
    CollectionSummary,
    CustomerAddress,
    CustomerAddressInput,
    FulfillmentType,
    MarketCode,
    MarketConfig,
    Order,
    Product,
    ProductSearchSort,
    ProductVariant,
    ShippingMethod,
    StorefrontCart,
    StorefrontCheckoutSession,
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
    | 'orders'
    | 'order-detail'
    | 'addresses'
    | 'account-security'
    | 'history'
    | 'notifications'
    | 'login'
    | 'register'
    | 'verify-account'
    | 'forgot-password'
    | 'reset-password';
type OrderTab = 'all' | 'pending' | 'shipping' | 'receiving' | 'service';
type SortMode = ProductSearchSort;

const STOREFRONT_NAME_MAX_DISPLAY_UNITS = 16;
const ORDER_NOTE_MAX_LENGTH = 500;
const RECENT_PRODUCT_STORAGE_KEY = 'storefront-recent-product-ids';
const SEARCH_HISTORY_STORAGE_KEY = 'storefront-search-history';
const RECENT_PRODUCT_LIMIT = 20;

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
}

const rootPages: MainPage[] = ['home', 'category', 'cart', 'account'];

function routeFromLocation(): RouteState {
    return routeFromHash(window.location.hash);
}

function routeFromHash(hash: string): RouteState {
    const raw = hash.replace(/^#\/?/, '');
    const [path = 'home', query = ''] = raw.split('?');
    const name = (path || 'home') as RouteName;
    const params = new URLSearchParams(query);
    const validNames: RouteName[] = [
        'home',
        'category',
        'cart',
        'account',
        'product',
        'search',
        'checkout',
        'orders',
        'order-detail',
        'addresses',
        'account-security',
        'history',
        'notifications',
        'login',
        'register',
        'verify-account',
        'forgot-password',
        'reset-password',
    ];
    return {
        name: validNames.includes(name) ? name : 'home',
        id: params.get('id') ?? undefined,
        tab: (params.get('tab') as OrderTab | null) ?? undefined,
        token: params.get('token') ?? undefined,
        term: params.get('term') ?? undefined,
    };
}

function routeHash(route: RouteState): string {
    const params = new URLSearchParams();
    if (route.id) params.set('id', route.id);
    if (route.tab) params.set('tab', route.tab);
    if (route.token) params.set('token', route.token);
    if (route.term) params.set('term', route.term);
    return `#/${route.name}${params.size ? `?${params.toString()}` : ''}`;
}

export function App() {
    const [marketCode, setMarketCode] = useState<MarketCode>(() => {
        const stored = localStorage.getItem('storefront-market');
        return enabledMarkets.some(candidateMarket => candidateMarket.code === stored)
            ? (stored as MarketCode)
            : enabledMarkets[0].code;
    });
    const [language, setLanguage] = useState<StorefrontLanguage>(() =>
        localStorage.getItem('storefront-language') === 'en' ? 'en' : 'zh',
    );
    const [route, setRoute] = useState<RouteState>(routeFromLocation);
    const [products, setProducts] = useState<Product[]>([]);
    const [routeProduct, setRouteProduct] = useState<Product | null>(null);
    const [routeProductLoading, setRouteProductLoading] = useState(false);
    const [routeProductError, setRouteProductError] = useState('');
    const [productReloadKey, setProductReloadKey] = useState(0);
    const [routeOrder, setRouteOrder] = useState<Order | null>(null);
    const [routeOrderLoading, setRouteOrderLoading] = useState(false);
    const [routeOrderError, setRouteOrderError] = useState('');
    const [orderReloadKey, setOrderReloadKey] = useState(0);
    const [recentProductIds, setRecentProductIds] = useState<string[]>([]);
    const [collections, setCollections] = useState<CollectionSummary[]>([]);
    const [contentBlocks, setContentBlocks] = useState<StorefrontContentBlock[]>([]);
    const [contentError, setContentError] = useState('');
    const [storefrontNames, setStorefrontNames] =
        useState<Record<StorefrontLanguage, string>>(DEFAULT_STOREFRONT_NAMES);
    const [storefrontCode, setStorefrontCode] = useState('');
    const [cart, setCart] = useState<StorefrontCart | null>(null);
    const [customer, setCustomer] = useState<ActiveCustomer | null>(null);
    const [checkoutOrder, setCheckoutOrder] = useState<Order | null>(null);
    const [loading, setLoading] = useState(true);
    const [cartLoading, setCartLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [cartError, setCartError] = useState<string | null>(null);
    const [addingVariantId, setAddingVariantId] = useState<string | null>(null);
    const [toast, setToast] = useState<string | null>(null);
    const [online, setOnline] = useState(navigator.onLine);
    const [activeCollectionId, setActiveCollectionId] = useState('all');
    const [activeChildId, setActiveChildId] = useState('all');
    const [sortMode, setSortMode] = useState<SortMode>('recommended');
    const [fulfillmentFilter, setFulfillmentFilter] = useState<'all' | FulfillmentType>('all');
    const [inStockOnly, setInStockOnly] = useState(false);
    const toastTimer = useRef<number | null>(null);
    const routeRef = useRef(route);
    const mainPageScrollPositions = useRef<Partial<Record<MainPage, number>>>({});

    const market = markets[marketCode];
    const locale = localeFor(language, market);
    const text = uiCopy[language];
    const isZh = language === 'zh';
    const storefrontName = storefrontNames[language];
    const api = useMemo(() => new ShopApi(market, languageCodeFor(language)), [language, market]);

    const notify = useCallback((message: string) => {
        setToast(message);
        if (toastTimer.current) window.clearTimeout(toastTimer.current);
        toastTimer.current = window.setTimeout(() => setToast(null), 2400);
    }, []);

    const navigate = useCallback((next: RouteState, replace = false) => {
        const currentRoute = routeRef.current;
        if (rootPages.includes(currentRoute.name as MainPage)) {
            mainPageScrollPositions.current[currentRoute.name as MainPage] = window.scrollY;
        }
        const hash = routeHash(next);
        if (replace) window.history.replaceState(next, '', hash);
        else window.history.pushState(next, '', hash);
        routeRef.current = next;
        setRoute(next);
        const nextScrollTop = rootPages.includes(next.name as MainPage)
            ? (mainPageScrollPositions.current[next.name as MainPage] ?? 0)
            : 0;
        window.requestAnimationFrame(() => window.scrollTo({ top: nextScrollTop, behavior: 'instant' }));
    }, []);

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
            const nextRoute = routeFromLocation();
            routeRef.current = nextRoute;
            setRoute(nextRoute);
            const nextScrollTop = rootPages.includes(nextRoute.name as MainPage)
                ? (mainPageScrollPositions.current[nextRoute.name as MainPage] ?? 0)
                : 0;
            window.requestAnimationFrame(() => window.scrollTo({ top: nextScrollTop, behavior: 'instant' }));
        };
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, [navigate]);

    useEffect(() => {
        const setConnected = () => setOnline(navigator.onLine);
        window.addEventListener('online', setConnected);
        window.addEventListener('offline', setConnected);
        return () => {
            window.removeEventListener('online', setConnected);
            window.removeEventListener('offline', setConnected);
        };
    }, []);

    const loadStorefront = useCallback(async () => {
        setLoading(true);
        setError(null);
        setContentError('');
        const [productResult, collectionResult, cartResult, customerResult, configResult, contentResult] =
            await Promise.allSettled([
                api.products(),
                api.collections(),
                api.cart(),
                api.activeCustomer(),
                api.storefrontConfig(),
                api.storefrontContent(),
            ]);
        if (productResult.status === 'fulfilled') setProducts(productResult.value);
        else setError(productResult.reason instanceof Error ? productResult.reason.message : text.loadError);
        if (collectionResult.status === 'fulfilled') setCollections(collectionResult.value);
        if (cartResult.status === 'fulfilled') {
            setCart(cartResult.value);
            setCheckoutOrder(cartResult.value.checkoutOrder);
        } else {
            setCartError(cartResult.reason instanceof Error ? cartResult.reason.message : text.loadError);
        }
        if (customerResult.status === 'fulfilled') setCustomer(customerResult.value);
        if (contentResult.status === 'fulfilled') setContentBlocks(contentResult.value);
        else {
            setContentBlocks([]);
            setContentError(
                contentResult.reason instanceof Error ? contentResult.reason.message : text.loadError,
            );
        }
        if (configResult.status === 'fulfilled') {
            const nextStorefrontCode = configResult.value.code;
            const nextMarketCode = marketCodeForChannel(nextStorefrontCode);
            if (nextMarketCode) {
                localStorage.setItem('storefront-market', nextMarketCode);
                setMarketCode(currentMarketCode =>
                    currentMarketCode === nextMarketCode ? currentMarketCode : nextMarketCode,
                );
            }
            setStorefrontCode(nextStorefrontCode);
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
        setLoading(false);
    }, [api, text.loadError]);

    useEffect(() => {
        localStorage.setItem('storefront-language', language);
        document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
        void loadStorefront();
    }, [language, loadStorefront]);

    useEffect(() => {
        document.title = isZh ? `${storefrontName} · 在线商城` : `${storefrontName} · Online store`;
    }, [isZh, storefrontName]);

    useEffect(() => {
        if (activeCollectionId === 'all' && collections.length) {
            setActiveCollectionId(collections[0].id);
            setActiveChildId(collections[0].children?.[0]?.id ?? collections[0].id);
        }
    }, [activeCollectionId, collections]);

    useEffect(() => {
        if (route.name !== 'product' || !route.id) {
            setRouteProduct(null);
            setRouteProductLoading(false);
            setRouteProductError('');
            return;
        }
        const cachedProduct = products.find(product => product.id === route.id);
        if (cachedProduct) {
            setRouteProduct(cachedProduct);
            setRouteProductLoading(false);
            setRouteProductError('');
            return;
        }
        let cancelled = false;
        setRouteProduct(null);
        setRouteProductLoading(true);
        setRouteProductError('');
        void api
            .product(route.id)
            .then(product => {
                if (cancelled) return;
                if (!product) {
                    throw new Error(isZh ? '商品不存在或已下架' : 'Product not found');
                }
                setRouteProduct(product);
            })
            .catch(requestError => {
                if (!cancelled) {
                    setRouteProductError(
                        requestError instanceof Error ? requestError.message : text.loadError,
                    );
                }
            })
            .finally(() => {
                if (!cancelled) setRouteProductLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [api, isZh, productReloadKey, products, route.id, route.name, text.loadError]);

    useEffect(() => {
        if (route.name !== 'order-detail' || !route.id) {
            setRouteOrder(null);
            setRouteOrderLoading(false);
            setRouteOrderError('');
            return;
        }
        const cachedOrder = customer?.orders.items.find(order => order.id === route.id);
        if (cachedOrder) {
            setRouteOrder(cachedOrder);
            setRouteOrderLoading(false);
            setRouteOrderError('');
            return;
        }
        let cancelled = false;
        setRouteOrder(null);
        setRouteOrderLoading(true);
        setRouteOrderError('');
        void api
            .order(route.id)
            .then(order => {
                if (cancelled) return;
                if (!order) throw new Error(isZh ? '订单不存在或无权查看' : 'Order not found');
                setRouteOrder(order);
            })
            .catch(requestError => {
                if (!cancelled) {
                    setRouteOrderError(requestError instanceof Error ? requestError.message : text.loadError);
                }
            })
            .finally(() => {
                if (!cancelled) setRouteOrderLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [api, customer, isZh, orderReloadKey, route.id, route.name, text.loadError]);

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
                navigate({ name: 'category' });
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
                notify(isZh ? '订单已恢复，可以继续修改' : 'Order restored for editing');
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
        const [nextCustomer, nextCart] = await Promise.all([api.activeCustomer(), api.cart()]);
        setCustomer(nextCustomer);
        setCart(nextCart);
        setCheckoutOrder(nextCart.checkoutOrder);
        notify(isZh ? '登录成功' : 'Signed in');
        navigate({ name: 'account' }, true);
    }, [api, isZh, navigate, notify]);

    const selectedProduct = route.id
        ? (products.find(product => product.id === route.id) ??
          (routeProduct?.id === route.id ? routeProduct : null))
        : null;
    const selectedOrder = route.id
        ? (customer?.orders.items.find(order => order.id === route.id) ??
          (routeOrder?.id === route.id ? routeOrder : null))
        : null;

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

    const mainPage: MainPage = rootPages.includes(route.name as MainPage)
        ? (route.name as MainPage)
        : route.name === 'product' || route.name === 'search'
          ? 'category'
          : route.name === 'checkout'
            ? 'cart'
            : 'account';

    const page = (() => {
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
                            navigate({ name: 'category' });
                        }}
                        onAdd={variant => void addToCart(variant)}
                        onToggleLanguage={() => setLanguage(value => (value === 'zh' ? 'en' : 'zh'))}
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
                        addingVariantId={addingVariantId}
                        onCollectionChange={(collectionId, childId) => {
                            setActiveCollectionId(collectionId);
                            setActiveChildId(childId);
                        }}
                        onChildChange={setActiveChildId}
                        onSortChange={setSortMode}
                        onFilterChange={(type, inStock) => {
                            setFulfillmentFilter(type);
                            setInStockOnly(inStock);
                        }}
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
                        products={products}
                        market={market}
                        locale={locale}
                        language={language}
                        loading={cartLoading}
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
                        recentProductCount={recentProductIds.length}
                        addingVariantId={addingVariantId}
                        onNavigate={navigate}
                        onAdd={variant => void addToCart(variant)}
                        onLogout={() => {
                            void api.logout().then(() => {
                                setCustomer(null);
                                notify(isZh ? '已退出登录' : 'Signed out');
                            });
                        }}
                    />
                );
            case 'product':
                return routeProductLoading || (route.id && !selectedProduct && !routeProductError) ? (
                    <Subpage title={isZh ? '商品详情' : 'Product'} onBack={goBack}>
                        <PageSkeleton />
                    </Subpage>
                ) : selectedProduct ? (
                    <ProductDetailPage
                        key={selectedProduct.id}
                        product={selectedProduct}
                        products={products}
                        cartQuantity={cart?.totalQuantity ?? 0}
                        market={market}
                        locale={locale}
                        language={language}
                        storefrontName={storefrontName}
                        addingVariantId={addingVariantId}
                        onBack={goBack}
                        onNavigate={navigate}
                        onAdd={(variant, buyNow) => void addToCart(variant, buyNow)}
                        onNotify={notify}
                    />
                ) : (
                    <Subpage title={isZh ? '商品详情' : 'Product'} onBack={goBack}>
                        <EmptyState
                            icon={<ShoppingBag />}
                            title={text.noResults}
                            detail={routeProductError || text.noResultsHint}
                            action={routeProductError ? (isZh ? '重试' : 'Retry') : text.browse}
                            onAction={() =>
                                routeProductError
                                    ? setProductReloadKey(value => value + 1)
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
                    <CheckoutPage
                        api={api}
                        cart={cart}
                        order={checkoutOrder}
                        customer={customer}
                        market={market}
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
                );
            case 'orders':
                return (
                    <OrdersPage
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
                    />
                );
            case 'order-detail':
                return routeOrderLoading || (route.id && !selectedOrder && !routeOrderError) ? (
                    <Subpage title={isZh ? '订单详情' : 'Order details'} onBack={goBack}>
                        <PageSkeleton />
                    </Subpage>
                ) : selectedOrder ? (
                    <OrderDetailPage
                        order={selectedOrder}
                        market={market}
                        locale={locale}
                        language={language}
                        storefrontName={storefrontName}
                        onBack={goBack}
                        onBuyAgain={addOrderToCart}
                        onReopen={reopenPendingOrder}
                        onUnavailable={() => notify(text.unavailable)}
                    />
                ) : (
                    <Subpage title={isZh ? '订单详情' : 'Order details'} onBack={goBack}>
                        <EmptyState
                            icon={<Package />}
                            title={isZh ? '没有找到订单' : 'Order not found'}
                            detail={routeOrderError}
                            action={routeOrderError ? (isZh ? '重试' : 'Retry') : undefined}
                            onAction={
                                routeOrderError ? () => setOrderReloadKey(value => value + 1) : undefined
                            }
                        />
                    </Subpage>
                );
            case 'addresses':
                return (
                    <AddressesPage
                        api={api}
                        customer={customer}
                        market={market}
                        language={language}
                        onBack={goBack}
                        onCustomerChange={setCustomer}
                        onNavigate={navigate}
                        onNotify={notify}
                    />
                );
            case 'account-security':
                return (
                    <AccountSecurityPage
                        customer={customer}
                        language={language}
                        storefrontName={storefrontName}
                        onBack={goBack}
                        onNavigate={navigate}
                        onLogout={() => {
                            void api.logout().then(() => {
                                setCustomer(null);
                                notify(isZh ? '已退出登录' : 'Signed out');
                                navigate({ name: 'account' }, true);
                            });
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
                return <NotificationsPage language={language} onBack={goBack} onNavigate={navigate} />;
            case 'login':
                return (
                    <LoginPage
                        api={api}
                        language={language}
                        storefrontName={storefrontName}
                        onBack={goBack}
                        onSuccess={completeAuthentication}
                        onNavigate={navigate}
                    />
                );
            case 'register':
                return (
                    <RegisterPage
                        api={api}
                        language={language}
                        storefrontName={storefrontName}
                        onBack={goBack}
                        onNavigate={navigate}
                    />
                );
            case 'verify-account':
                return (
                    <VerifyAccountPage
                        api={api}
                        language={language}
                        storefrontName={storefrontName}
                        token={route.token}
                        onBack={goBack}
                        onSuccess={completeAuthentication}
                        onNavigate={navigate}
                    />
                );
            case 'forgot-password':
                return (
                    <ForgotPasswordPage
                        api={api}
                        language={language}
                        storefrontName={storefrontName}
                        onBack={goBack}
                        onNavigate={navigate}
                    />
                );
            case 'reset-password':
                return (
                    <ResetPasswordPage
                        api={api}
                        language={language}
                        storefrontName={storefrontName}
                        token={route.token}
                        onBack={goBack}
                        onSuccess={completeAuthentication}
                        onNavigate={navigate}
                    />
                );
        }
    })();

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
            <div id="storefront-content">{page}</div>
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
    const managedSections = contentBlocks.filter(block =>
        ['CATEGORY_AD', 'FEATURED_COLLECTION', 'STORY', 'SUPPORT'].includes(block.type),
    );
    const heroProducts = products.slice(0, 2);
    const [heroIndex, setHeroIndex] = useState(0);
    const heroCount = managedHeroes.length || heroProducts.length;
    const managedHero = managedHeroes[heroIndex];
    const hero = heroProducts[heroIndex] ?? products[0];
    const heroImage = managedHero?.imageUrl ?? productImage(hero) ?? '/storefront/default-hero.jpg';
    const quickCollections = collections.slice(0, 3);

    useEffect(() => {
        if (heroCount < 2) return;
        const timer = window.setInterval(() => setHeroIndex(index => (index + 1) % heroCount), 5200);
        return () => window.clearInterval(timer);
    }, [heroCount]);

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
              icon: item.imageUrl ? <img src={item.imageUrl} alt="" /> : quickIcon(index),
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
                disabled={!noticeBlock || noticeBlock.targetType === 'NONE' || !noticeBlock.targetValue}
                onClick={() =>
                    noticeBlock && onContentTarget(noticeBlock.targetType, noticeBlock.targetValue)
                }
            >
                <Bell aria-hidden="true" />
                <span>
                    {noticeBlock?.title ||
                        (isZh ? '现货商品配送时效以结算页为准' : 'Delivery timing is confirmed at checkout')}
                </span>
                {noticeBlock?.targetType !== 'NONE' && <ChevronRight aria-hidden="true" />}
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
                            style={{
                                backgroundColor: managedHero?.backgroundColor ?? undefined,
                                color: managedHero?.textColor ?? undefined,
                            }}
                        >
                            {heroImage ? (
                                <img src={heroImage} alt={managedHero?.title ?? hero?.name ?? ''} />
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
                                    {(managedHeroes.length ? managedHeroes : heroProducts).map(
                                        (item, index) => (
                                            <button
                                                type="button"
                                                key={item.id}
                                                className={index === heroIndex ? 'is-active' : undefined}
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

                        <nav className="quick-grid" aria-label={isZh ? '快捷分类' : 'Quick categories'}>
                            {quickLinks.map((item, index) => (
                                <button
                                    type="button"
                                    key={item.id}
                                    onClick={item.onClick}
                                    disabled={item.disabled}
                                >
                                    <span data-tone={index % 5}>{item.icon}</span>
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
    onContentTarget,
}: {
    block: StorefrontContentBlock;
    onContentTarget: (targetType: StorefrontContentTargetType, targetValue: string | null) => void;
}) {
    const blockHasTarget = block.targetType !== 'NONE' && Boolean(block.targetValue);
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
                    <img src={block.imageUrl} alt={block.title} loading="lazy" />
                </button>
            )}
            {!!block.items.length && (
                <div className="managed-content-grid">
                    {block.items.map(item => (
                        <ManagedContentItemButton
                            key={item.id}
                            item={item}
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
    onContentTarget,
}: {
    item: StorefrontContentItem;
    onContentTarget: (targetType: StorefrontContentTargetType, targetValue: string | null) => void;
}) {
    const disabled = item.targetType === 'NONE' || !item.targetValue;
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={() => onContentTarget(item.targetType, item.targetValue)}
        >
            {item.imageUrl ? (
                <img src={item.imageUrl} alt="" loading="lazy" />
            ) : (
                <span className="managed-content-placeholder">
                    <LayoutGrid aria-hidden="true" />
                </span>
            )}
            <span className="managed-content-copy">
                <strong>{item.label}</strong>
                {item.description && <small>{item.description}</small>}
            </span>
            {!disabled && <ChevronRight aria-hidden="true" />}
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
    addingVariantId: string | null;
    onCollectionChange: (collectionId: string, childId: string) => void;
    onChildChange: (childId: string) => void;
    onSortChange: (sort: SortMode) => void;
    onFilterChange: (type: 'all' | FulfillmentType, inStockOnly: boolean) => void;
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
    const isZh = language === 'zh';
    const [filterOpen, setFilterOpen] = useState(false);
    const [minimumPriceInput, setMinimumPriceInput] = useState('');
    const [maximumPriceInput, setMaximumPriceInput] = useState('');
    const [draftType, setDraftType] = useState<'all' | FulfillmentType>(fulfillmentFilter);
    const [draftStock, setDraftStock] = useState(inStockOnly);
    const [draftMinimumPrice, setDraftMinimumPrice] = useState('');
    const [draftMaximumPrice, setDraftMaximumPrice] = useState('');
    const [categoryProducts, setCategoryProducts] = useState<Product[]>([]);
    const [totalItems, setTotalItems] = useState(0);
    const [categoryLoading, setCategoryLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [categoryError, setCategoryError] = useState('');
    const [categoryReloadKey, setCategoryReloadKey] = useState(0);
    const [visibleLimit, setVisibleLimit] = useState(12);
    const activeCategoryKey = useRef('');
    const primary = collections.find(item => item.id === activeCollectionId) ?? collections[0];
    const children = primary?.children?.length ? primary.children : primary ? [primary] : [];
    const selectedCollectionId = activeChildId === 'all' ? activeCollectionId : activeChildId;
    const hasFilters =
        fulfillmentFilter !== 'all' ||
        inStockOnly ||
        minimumPriceInput !== '' ||
        maximumPriceInput !== '';

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

    useEffect(() => {
        if (!collections.length) {
            const fallbackType =
                activeCollectionId === 'physical' || activeCollectionId === 'digital'
                    ? activeCollectionId
                    : 'all';
            const fallbackProducts = products.filter(
                product =>
                    fallbackType === 'all' ||
                    product.variants.some(variant => variant.customFields.fulfillmentType === fallbackType),
            );
            const filteredFallbackProducts = fallbackProducts.filter(product =>
                matchesFilters(
                    product,
                    fulfillmentFilter,
                    inStockOnly,
                    minimumPriceInput,
                    maximumPriceInput,
                ),
            );
            const sortedFallbackProducts = [...filteredFallbackProducts].sort((first, second) => {
                if (sortMode === 'name') return first.name.localeCompare(second.name, locale);
                if (sortMode === 'price-asc') return minimumPrice(first) - minimumPrice(second);
                if (sortMode === 'price-desc') return minimumPrice(second) - minimumPrice(first);
                return 0;
            });
            setCategoryProducts(sortedFallbackProducts);
            setTotalItems(filteredFallbackProducts.length);
            setVisibleLimit(12);
            setCategoryLoading(false);
            setCategoryError(error ?? '');
            return;
        }
        if (!selectedCollectionId || selectedCollectionId === 'all') return;
        const categoryKey = [
            selectedCollectionId,
            sortMode,
            fulfillmentFilter,
            inStockOnly ? 'stock' : 'all-stock',
            minimumPriceInput,
            maximumPriceInput,
            categoryReloadKey,
        ].join('\u0000');
        activeCategoryKey.current = categoryKey;
        let cancelled = false;
        setCategoryProducts([]);
        setTotalItems(0);
        setCategoryError('');
        setCategoryLoading(true);
        setVisibleLimit(12);
        const request = hasFilters
            ? api.searchAllProducts('', sortMode, selectedCollectionId).then(items => {
                  const filteredItems = items.filter(product =>
                      matchesFilters(
                          product,
                          fulfillmentFilter,
                          inStockOnly,
                          minimumPriceInput,
                          maximumPriceInput,
                      ),
                  );
                  return { items: filteredItems, totalItems: filteredItems.length };
              })
            : api.searchProducts('', sortMode, 0, 12, selectedCollectionId);
        void request
            .then(page => {
                if (cancelled || activeCategoryKey.current !== categoryKey) return;
                setCategoryProducts(page.items);
                setTotalItems(page.totalItems);
            })
            .catch(requestError => {
                if (!cancelled && activeCategoryKey.current === categoryKey) {
                    setCategoryError(
                        requestError instanceof Error
                            ? requestError.message
                            : isZh
                              ? '商品加载失败'
                              : 'Could not load products',
                    );
                }
            })
            .finally(() => {
                if (!cancelled && activeCategoryKey.current === categoryKey) {
                    setCategoryLoading(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [
        activeCollectionId,
        api,
        categoryReloadKey,
        collections.length,
        error,
        fulfillmentFilter,
        hasFilters,
        inStockOnly,
        isZh,
        locale,
        matchesFilters,
        maximumPriceInput,
        minimumPriceInput,
        products,
        selectedCollectionId,
        sortMode,
    ]);

    const loadMore = async () => {
        if (hasFilters) {
            setVisibleLimit(limit => Math.min(limit + 12, categoryProducts.length));
            return;
        }
        if (
            !selectedCollectionId ||
            selectedCollectionId === 'all' ||
            loadingMore ||
            categoryProducts.length >= totalItems
        ) {
            return;
        }
        const categoryKey = activeCategoryKey.current;
        setLoadingMore(true);
        setCategoryError('');
        try {
            const page = await api.searchProducts(
                '',
                sortMode,
                categoryProducts.length,
                12,
                selectedCollectionId,
            );
            if (activeCategoryKey.current !== categoryKey) return;
            setCategoryProducts(current => {
                const existingIds = new Set(current.map(product => product.id));
                return [...current, ...page.items.filter(product => !existingIds.has(product.id))];
            });
            setTotalItems(page.totalItems);
        } catch (requestError) {
            if (activeCategoryKey.current === categoryKey) {
                setCategoryError(
                    requestError instanceof Error
                        ? requestError.message
                        : isZh
                          ? '加载更多失败'
                          : 'Could not load more products',
                );
            }
        } finally {
            if (activeCategoryKey.current === categoryKey) setLoadingMore(false);
        }
    };

    const visibleProducts = hasFilters ? categoryProducts.slice(0, visibleLimit) : categoryProducts;
    const remainingItems = hasFilters
        ? Math.max(categoryProducts.length - visibleProducts.length, 0)
        : Math.max(totalItems - categoryProducts.length, 0);
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
                <strong>{isZh ? '商品' : 'Shop'}</strong>
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
                {(collections.length ? collections : fallbackCollections(isZh)).map(collection => (
                    <button
                        type="button"
                        key={collection.id}
                        className={collection.id === activeCollectionId ? 'is-active' : undefined}
                        aria-pressed={collection.id === activeCollectionId}
                        onClick={event => {
                            onCollectionChange(collection.id, collection.children?.[0]?.id ?? collection.id);
                            event.currentTarget.scrollIntoView({
                                behavior: 'smooth',
                                block: 'nearest',
                                inline: 'center',
                            });
                        }}
                    >
                        {collection.name}
                    </button>
                ))}
            </nav>

            <div className="category-layout">
                <nav className="secondary-categories" aria-label={isZh ? '二级分类' : 'Subcategories'}>
                    {children.length ? (
                        children.map(child => (
                            <button
                                type="button"
                                key={child.id}
                                className={child.id === activeChildId ? 'is-active' : undefined}
                                onClick={() => onChildChange(child.id)}
                            >
                                {child.name}
                            </button>
                        ))
                    ) : (
                        <button type="button" className="is-active">
                            {isZh ? '全部' : 'All'}
                        </button>
                    )}
                </nav>

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
                            <img src={bannerImage} alt={primary?.name ?? ''} />
                        ) : (
                            <div className="image-placeholder">
                                <ShoppingBag />
                            </div>
                        )}
                        <span>
                            <small>{isZh ? '分类精选' : 'Category edit'}</small>
                            <strong>{primary?.name ?? (isZh ? '全部商品' : 'All products')}</strong>
                        </span>
                    </button>
                    <div className="result-count">
                        <span>{isZh ? `共 ${totalItems} 件` : `${totalItems} products`}</span>
                        {hasFilters && <b>{isZh ? '已筛选' : 'Filtered'}</b>}
                    </div>
                    <nav
                        className="sort-bar"
                        aria-label={isZh ? '排序和筛选' : 'Sort and filter'}
                        style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}
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
                            className={sortMode === 'name' ? 'is-active' : undefined}
                            onClick={() => onSortChange('name')}
                        >
                            {isZh ? '名称' : 'Name'}
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
                        <ListSkeleton />
                    ) : categoryError && !categoryProducts.length ? (
                        <EmptyState
                            icon={<WifiOff />}
                            title={isZh ? '商品加载失败' : 'Could not load products'}
                            detail={categoryError}
                            action={isZh ? '重试' : 'Retry'}
                            onAction={() =>
                                collections.length ? setCategoryReloadKey(value => value + 1) : onRetry()
                            }
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
                <Sheet title={isZh ? '筛选' : 'Filter'} onClose={() => setFilterOpen(false)}>
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
                                    onFilterChange(draftType, draftStock);
                                    setMinimumPriceInput(draftMinimumPrice);
                                    setMaximumPriceInput(draftMaximumPrice);
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
    const order = cart?.checkoutOrder;
    const locked = cart?.state === 'PAYMENT_PENDING';
    const discount = Math.abs(order?.discounts.reduce((sum, item) => sum + item.amountWithTax, 0) ?? 0);
    const amount = order?.subTotalWithTax ?? 0;

    return (
        <main className="page cart-page">
            <header className="topbar cart-topbar">
                <strong>{isZh ? '购物车' : 'Cart'}</strong>
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
                        <Truck aria-hidden="true" />
                    </span>
                    <div>
                        <strong>{isZh ? '配送与运费' : 'Delivery and shipping'}</strong>
                        <small>
                            {isZh ? '选择地址后在结算页准确计算' : 'Calculated after you choose an address'}
                        </small>
                    </div>
                    <ChevronRight aria-hidden="true" />
                </div>
            )}

            {error && <InlineError message={error} action={isZh ? '刷新' : 'Refresh'} onAction={onRetry} />}
            {locked && (
                <InlineError
                    message={
                        isZh
                            ? '订单正在等待支付，购物车内容已锁定。返回修改后才能调整商品或优惠。'
                            : 'This cart is locked while its order awaits payment. Reopen it to make changes.'
                    }
                    action={isZh ? '返回修改' : 'Reopen'}
                    onAction={onReopen}
                />
            )}
            {!cart && loading ? (
                <ListSkeleton />
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
                            {discount
                                ? isZh
                                    ? `已优惠 ${formatMoney(discount, order?.currencyCode ?? market.currencyCode, locale)}`
                                    : `${formatMoney(discount, order?.currencyCode ?? market.currencyCode, locale)} saved`
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
    recentProductCount: number;
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
        recentProductCount,
        addingVariantId,
        onNavigate,
        onAdd,
        onLogout,
    } = props;
    const isZh = language === 'zh';
    const orders = customer?.orders.items ?? [];
    const [counts, setCounts] = useState({ pending: 0, shipping: 0, receiving: 0 });
    const latestOrder = orders[0];
    const recentVariants = Array.from(
        new Map(
            orders.flatMap(order => order.lines).map(line => [line.productVariant.id, line.productVariant]),
        ).values(),
    ).slice(0, 2);
    const customerName = customer
        ? `${customer.lastName}${customer.firstName}`.trim() || customer.emailAddress
        : '';

    useEffect(() => {
        if (!customer) {
            setCounts({ pending: 0, shipping: 0, receiving: 0 });
            return;
        }
        let cancelled = false;
        void api
            .customerOrderCounts()
            .then(nextCounts => {
                if (!cancelled) setCounts(nextCounts);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [api, customer]);

    return (
        <main className="page account-page">
            <header className="topbar account-topbar">
                <strong>{isZh ? '我的' : 'Account'}</strong>
                <div>
                    <button
                        type="button"
                        onClick={() =>
                            customer
                                ? onNavigate({ name: 'account-security' })
                                : onNavigate({ name: 'login' })
                        }
                        aria-label={isZh ? '设置' : 'Settings'}
                    >
                        <Settings />
                    </button>
                </div>
            </header>
            <section className="profile-band">
                <span className="avatar">
                    {customerName ? customerName.slice(0, 1).toUpperCase() : <UserRound />}
                </span>
                <button
                    type="button"
                    onClick={() =>
                        customer ? onNavigate({ name: 'account-security' }) : onNavigate({ name: 'login' })
                    }
                >
                    <strong>
                        {customer
                            ? isZh
                                ? `${customerName}，你好`
                                : `Hello, ${customerName}`
                            : isZh
                              ? `登录${storefrontName}账户`
                              : `Sign in to ${storefrontName}`}
                    </strong>
                    <small>
                        {customer
                            ? customer.emailAddress
                            : isZh
                              ? '查看订单、地址和售后进度'
                              : 'View orders, addresses and support'}
                    </small>
                </button>
                <ChevronRight />
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
                        count={0}
                        onClick={() => onNavigate({ name: 'orders', tab: 'service' })}
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

function AccountSecurityPage({
    customer,
    language,
    storefrontName,
    onBack,
    onNavigate,
    onLogout,
}: {
    customer: ActiveCustomer | null;
    language: StorefrontLanguage;
    storefrontName: string;
    onBack: () => void;
    onNavigate: (route: RouteState) => void;
    onLogout: () => void;
}) {
    const isZh = language === 'zh';
    if (!customer) {
        return (
            <Subpage title={isZh ? '账户与安全' : 'Account and security'} onBack={onBack}>
                <EmptyState
                    icon={<UserRound />}
                    title={isZh ? '请先登录' : 'Sign in required'}
                    action={isZh ? '去登录' : 'Sign in'}
                    onAction={() => onNavigate({ name: 'login' })}
                />
            </Subpage>
        );
    }
    const fullName = `${customer.lastName}${customer.firstName}`.trim();
    return (
        <main className="page subpage account-security-page">
            <SubHeader title={isZh ? '账户与安全' : 'Account and security'} onBack={onBack} />
            <section className="account-security-profile">
                <span className="avatar">
                    {(fullName || customer.emailAddress).slice(0, 1).toUpperCase()}
                </span>
                <div>
                    <strong>{fullName || storefrontName}</strong>
                    <small>{customer.emailAddress}</small>
                </div>
            </section>
            <section className="account-security-list">
                <button type="button" onClick={() => onNavigate({ name: 'forgot-password' })}>
                    <span>
                        <Fingerprint />
                        <b>{isZh ? '修改登录密码' : 'Change password'}</b>
                    </span>
                    <small>{isZh ? '通过邮箱验证后重置' : 'Reset after email verification'}</small>
                    <ChevronRight />
                </button>
                <button type="button" onClick={() => onNavigate({ name: 'addresses' })}>
                    <span>
                        <MapPin />
                        <b>{isZh ? '收货地址' : 'Delivery addresses'}</b>
                    </span>
                    <small>
                        {isZh
                            ? `${customer.addresses?.length ?? 0} 个地址`
                            : `${customer.addresses?.length ?? 0} addresses`}
                    </small>
                    <ChevronRight />
                </button>
            </section>
            <button className="logout-button" type="button" onClick={onLogout}>
                {isZh ? '退出登录' : 'Sign out'}
            </button>
        </main>
    );
}

function BrowsingHistoryPage({
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
    const [historyProducts, setHistoryProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(false);
    const [historyError, setHistoryError] = useState('');
    const [retryKey, setRetryKey] = useState(0);
    const productIdsKey = productIds.join(',');

    useEffect(() => {
        if (!productIds.length) {
            setHistoryProducts([]);
            setLoading(false);
            setHistoryError('');
            return;
        }
        let cancelled = false;
        setLoading(true);
        setHistoryError('');
        void api
            .productsByIds(productIds)
            .then(nextProducts => {
                if (!cancelled) setHistoryProducts(nextProducts);
            })
            .catch(requestError => {
                if (!cancelled) {
                    setHistoryError(
                        requestError instanceof Error
                            ? requestError.message
                            : isZh
                              ? '浏览足迹加载失败'
                              : 'Could not load browsing history',
                    );
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [api, isZh, productIdsKey, retryKey]);

    return (
        <main className="page subpage history-page">
            <SubHeader
                title={isZh ? '浏览足迹' : 'Browsing history'}
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
                    onAction={() => setRetryKey(value => value + 1)}
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

function NotificationsPage({
    language,
    onBack,
    onNavigate,
}: {
    language: StorefrontLanguage;
    onBack: () => void;
    onNavigate: (route: RouteState) => void;
}) {
    const isZh = language === 'zh';
    return (
        <Subpage title={isZh ? '消息通知' : 'Notifications'} onBack={onBack}>
            <EmptyState
                icon={<Bell />}
                title={isZh ? '暂无消息' : 'No notifications'}
                detail={
                    isZh ? '订单和店铺通知会显示在这里' : 'Order and store notifications will appear here'
                }
                action={isZh ? '返回首页' : 'Back to home'}
                onAction={() => onNavigate({ name: 'home' })}
            />
        </Subpage>
    );
}

function ProductDetailPage({
    product,
    products,
    cartQuantity,
    market,
    locale,
    language,
    storefrontName,
    addingVariantId,
    onBack,
    onNavigate,
    onAdd,
    onNotify,
}: {
    product: Product;
    products: Product[];
    cartQuantity: number;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    storefrontName: string;
    addingVariantId: string | null;
    onBack: () => void;
    onNavigate: (route: RouteState) => void;
    onAdd: (variant: ProductVariant, buyNow?: boolean) => void;
    onNotify: (message: string) => void;
}) {
    const isZh = language === 'zh';
    const [variantId, setVariantId] = useState(product.variants[0]?.id ?? '');
    const [activeImage, setActiveImage] = useState(0);
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

    return (
        <main className="page subpage product-detail-page">
            <SubHeader
                title={isZh ? '商品详情' : 'Product details'}
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
                    <img src={assets[activeImage].preview} alt={`${product.name} ${activeImage + 1}`} />
                ) : (
                    <div className="image-placeholder">
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
                                aria-label={`${index + 1}`}
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
                        {unavailable ? (isZh ? '暂时缺货' : 'Unavailable') : isZh ? '库存充足' : 'In stock'}
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
                <span>{isZh ? '送至' : 'Deliver to'}</span>
                <strong>
                    {isDigital
                        ? isZh
                            ? '付款后自动发送至订单'
                            : 'Delivered to your order after payment'
                        : isZh
                          ? '结算页选择收货地址并确认时效'
                          : 'Choose an address and confirm timing at checkout'}
                </strong>
            </div>
            <section className="detail-service-bar">
                <span>
                    <CircleCheck />
                    {isZh ? '正品保障' : 'Authenticity'}
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
            <section className="detail-block detail-review-block">
                <header>
                    <strong>{isZh ? '用户评价' : 'Reviews'}</strong>
                    <span>{isZh ? '暂无评价' : 'No reviews yet'}</span>
                </header>
                <div className="detail-empty-review">
                    <MessageSquare />
                    <span>
                        <strong>
                            {isZh ? '等待第一条真实评价' : 'Waiting for the first verified review'}
                        </strong>
                        <small>
                            {isZh ? '评价将在用户完成订单后显示' : 'Reviews appear after completed orders'}
                        </small>
                    </span>
                </div>
            </section>
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
                    <img
                        src={assets[0].preview}
                        alt={isZh ? `${product.name}细节展示` : `${product.name} details`}
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
    const isZh = language === 'zh';
    const [query, setQuery] = useState(initialQuery);
    const [submittedQuery, setSubmittedQuery] = useState(initialQuery);
    const [resultSort, setResultSort] = useState<ProductSearchSort>('recommended');
    const [results, setResults] = useState<Product[]>([]);
    const [totalItems, setTotalItems] = useState(0);
    const [searching, setSearching] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [searchError, setSearchError] = useState('');
    const [searchReloadKey, setSearchReloadKey] = useState(0);
    const activeSearchKey = useRef('');
    const [history, setHistory] = useState<string[]>([]);
    const searchHistoryStorageKey = scopedStorageKey(SEARCH_HISTORY_STORAGE_KEY, storefrontCode);
    const popularSearches = products.slice(0, 6);
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
        const term = submittedQuery.trim();
        const searchKey = `${term}\u0000${resultSort}\u0000${searchReloadKey}`;
        activeSearchKey.current = searchKey;
        if (!term) {
            setResults([]);
            setTotalItems(0);
            setSearchError('');
            setSearching(false);
            return;
        }
        let cancelled = false;
        setResults([]);
        setTotalItems(0);
        setSearchError('');
        setSearching(true);
        void api
            .searchProducts(term, resultSort)
            .then(page => {
                if (cancelled || activeSearchKey.current !== searchKey) return;
                setResults(page.items);
                setTotalItems(page.totalItems);
            })
            .catch(requestError => {
                if (!cancelled && activeSearchKey.current === searchKey) {
                    setSearchError(
                        requestError instanceof Error
                            ? requestError.message
                            : isZh
                              ? '搜索失败'
                              : 'Search failed',
                    );
                }
            })
            .finally(() => {
                if (!cancelled && activeSearchKey.current === searchKey) setSearching(false);
            });
        return () => {
            cancelled = true;
        };
    }, [api, isZh, resultSort, searchReloadKey, submittedQuery]);

    const loadMore = async () => {
        const term = submittedQuery.trim();
        if (!term || loadingMore || results.length >= totalItems) return;
        const searchKey = activeSearchKey.current;
        setLoadingMore(true);
        setSearchError('');
        try {
            const page = await api.searchProducts(term, resultSort, results.length);
            if (activeSearchKey.current !== searchKey) return;
            setResults(current => {
                const existingIds = new Set(current.map(product => product.id));
                return [...current, ...page.items.filter(product => !existingIds.has(product.id))];
            });
            setTotalItems(page.totalItems);
        } catch (requestError) {
            if (activeSearchKey.current === searchKey) {
                setSearchError(
                    requestError instanceof Error
                        ? requestError.message
                        : isZh
                          ? '加载更多失败'
                          : 'Could not load more results',
                );
            }
        } finally {
            if (activeSearchKey.current === searchKey) setLoadingMore(false);
        }
    };

    return (
        <main className="page subpage search-page">
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
                            onAction={() => setSearchReloadKey(value => value + 1)}
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

function CheckoutPage({
    api,
    cart,
    order,
    customer,
    market,
    locale,
    language,
    onBack,
    onSessionChange,
    onCartChange,
    onNavigate,
    onNotify,
    onApplyCoupon,
    onRemoveCoupon,
}: {
    api: ShopApi;
    cart: StorefrontCart | null;
    order: Order | null;
    customer: ActiveCustomer | null;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    onBack: () => void;
    onSessionChange: (session: StorefrontCheckoutSession) => void;
    onCartChange: (cart: StorefrontCart) => void;
    onNavigate: (route: RouteState, replace?: boolean) => void;
    onNotify: (message: string) => void;
    onApplyCoupon: (couponCode: string) => Promise<string | null>;
    onRemoveCoupon: (couponCode: string) => Promise<string | null>;
}) {
    const isZh = language === 'zh';
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [shippingMethods, setShippingMethods] = useState<ShippingMethod[]>([]);
    const [selectedShippingId, setSelectedShippingId] = useState('');
    const [preparedAddressKey, setPreparedAddressKey] = useState('');
    const [customerPrepared, setCustomerPrepared] = useState(Boolean(customer));
    const [shippingUpdating, setShippingUpdating] = useState(false);
    const [couponOpen, setCouponOpen] = useState(false);
    const [noteOpen, setNoteOpen] = useState(false);
    const [noteDraft, setNoteDraft] = useState('');
    const [noteSaving, setNoteSaving] = useState(false);
    const [noteError, setNoteError] = useState<string | null>(null);
    const formRef = useRef<HTMLFormElement>(null);
    const defaultAddress =
        customer?.addresses?.find(address => address.defaultShippingAddress) ?? customer?.addresses?.[0];
    const requiresShipping =
        order?.checkoutFulfillment?.requiresShippingAddress ??
        order?.lines.some(line => line.productVariant.customFields.fulfillmentType === 'physical');
    const physicalLines =
        order?.lines.filter(line => line.productVariant.customFields.fulfillmentType === 'physical') ?? [];
    const digitalLines =
        order?.lines.filter(line => line.productVariant.customFields.fulfillmentType === 'digital') ?? [];

    const openOrderNote = () => {
        setNoteDraft(order?.customFields.customerNote ?? '');
        setNoteError(null);
        setNoteOpen(true);
    };

    const saveOrderNote = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const customerNote = noteDraft.trim();
        setNoteSaving(true);
        setNoteError(null);
        try {
            await api.setOrderNote(customerNote);
            onCartChange(await api.cart());
            setNoteOpen(false);
            onNotify(
                customerNote
                    ? isZh
                        ? '订单备注已保存'
                        : 'Order note saved'
                    : isZh
                      ? '订单备注已清空'
                      : 'Order note cleared',
            );
        } catch (requestError) {
            setNoteError(
                requestError instanceof Error
                    ? requestError.message
                    : isZh
                      ? '订单备注保存失败'
                      : 'Could not save the order note',
            );
        } finally {
            setNoteSaving(false);
        }
    };

    const selectShippingMethod = async (shippingMethodId: string) => {
        const previousId = selectedShippingId;
        setSelectedShippingId(shippingMethodId);
        setShippingUpdating(true);
        setFormError(null);
        try {
            await api.setShippingMethod(shippingMethodId);
            onCartChange(await api.cart());
        } catch (requestError) {
            setSelectedShippingId(previousId);
            setFormError(
                requestError instanceof Error
                    ? requestError.message
                    : isZh
                      ? '配送方式更新失败'
                      : 'Could not update the shipping method',
            );
        } finally {
            setShippingUpdating(false);
        }
    };

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!cart || !order) return;
        const data = new FormData(event.currentTarget);
        setSubmitting(true);
        setFormError(null);
        try {
            if (!customerPrepared) {
                await api.setCustomer({
                    firstName: String(data.get('firstName') ?? ''),
                    lastName: String(data.get('lastName') ?? ''),
                    emailAddress: String(data.get('emailAddress') ?? ''),
                });
                setCustomerPrepared(true);
            }
            if (requiresShipping) {
                const shippingAddress: CustomerAddressInput = {
                    fullName: String(data.get('fullName') ?? ''),
                    phoneNumber: String(data.get('phoneNumber') ?? ''),
                    streetLine1: String(data.get('streetLine1') ?? ''),
                    city: String(data.get('city') ?? ''),
                    province: String(data.get('province') ?? ''),
                    postalCode: String(data.get('postalCode') ?? ''),
                    countryCode: market.countryCode,
                };
                const addressKey = JSON.stringify(shippingAddress);
                if (addressKey !== preparedAddressKey || !shippingMethods.length) {
                    await api.setShippingAddress(shippingAddress);
                    const methods = await api.eligibleShippingMethods();
                    if (!methods.length) {
                        throw new Error(
                            isZh ? '当前地址没有可用配送方式' : 'No shipping method is available',
                        );
                    }
                    const shippingId = methods.some(method => method.id === selectedShippingId)
                        ? selectedShippingId
                        : methods[0].id;
                    await api.setShippingMethod(shippingId);
                    setShippingMethods(methods);
                    setSelectedShippingId(shippingId);
                    setPreparedAddressKey(addressKey);
                    onCartChange(await api.cart());
                    onNotify(
                        isZh
                            ? '地址和运费已更新，请确认配送方式后提交订单'
                            : 'Address and shipping updated. Confirm the method, then submit.',
                    );
                    return;
                }
                if (!selectedShippingId) {
                    throw new Error(isZh ? '当前地址没有可用配送方式' : 'No shipping method is available');
                }
                await api.setShippingMethod(selectedShippingId);
            }
            const latestCart = await api.cart();
            onCartChange(latestCart);
            const session = await api.preparePayment(latestCart.revision);
            onSessionChange(session);
            onNotify(
                isZh ? '订单已准备，请继续选择支付方式' : 'Order prepared. Continue with a payment method.',
            );
            onNavigate({ name: 'orders', tab: 'pending' }, true);
        } catch (requestError) {
            setFormError(
                requestError instanceof Error
                    ? requestError.message
                    : isZh
                      ? '提交订单失败'
                      : 'Could not submit order',
            );
            try {
                onCartChange(await api.cart());
            } catch {
                /* Keep the current form visible. */
            }
        } finally {
            setSubmitting(false);
        }
    };

    if (!order || !cart) {
        return (
            <Subpage title={isZh ? '确认订单' : 'Review order'} onBack={onBack}>
                <EmptyState
                    icon={<ShoppingBag />}
                    title={isZh ? '没有可结算商品' : 'Nothing to check out'}
                    action={isZh ? '返回购物车' : 'Back to cart'}
                    onAction={() => onNavigate({ name: 'cart' })}
                />
            </Subpage>
        );
    }

    return (
        <main className="page subpage checkout-page">
            <SubHeader title={isZh ? '确认订单' : 'Review order'} onBack={onBack} />
            <form ref={formRef} className="checkout-form" onSubmit={event => void submit(event)}>
                {!customer && (
                    <section className="checkout-section">
                        <h2>{isZh ? '联系信息' : 'Contact'}</h2>
                        <div className="form-grid">
                            <Field name="firstName" label={isZh ? '名字' : 'First name'} required />
                            <Field name="lastName" label={isZh ? '姓氏' : 'Last name'} required />
                            <Field
                                name="emailAddress"
                                label={isZh ? '电子邮箱' : 'Email'}
                                type="email"
                                required
                                wide
                            />
                        </div>
                    </section>
                )}
                {requiresShipping && (
                    <section className="checkout-section">
                        <h2>{isZh ? '收货地址' : 'Shipping address'}</h2>
                        {defaultAddress ? (
                            <>
                                <button
                                    className="saved-address"
                                    type="button"
                                    onClick={() => onNavigate({ name: 'addresses' })}
                                >
                                    <MapPin />
                                    <span>
                                        <strong>
                                            {defaultAddress.fullName} {defaultAddress.phoneNumber}
                                        </strong>
                                        <small>{addressText(defaultAddress)}</small>
                                    </span>
                                    <ChevronRight />
                                </button>
                                <input type="hidden" name="fullName" value={defaultAddress.fullName ?? ''} />
                                <input
                                    type="hidden"
                                    name="phoneNumber"
                                    value={defaultAddress.phoneNumber ?? ''}
                                />
                                <input type="hidden" name="province" value={defaultAddress.province ?? ''} />
                                <input type="hidden" name="city" value={defaultAddress.city ?? ''} />
                                <input type="hidden" name="streetLine1" value={defaultAddress.streetLine1} />
                                <input
                                    type="hidden"
                                    name="postalCode"
                                    value={defaultAddress.postalCode ?? ''}
                                />
                            </>
                        ) : (
                            <div className="form-grid">
                                <Field name="fullName" label={isZh ? '收货人' : 'Full name'} required />
                                <Field name="phoneNumber" label={isZh ? '手机号' : 'Phone'} required />
                                <Field name="province" label={isZh ? '省/州' : 'Province'} required />
                                <Field name="city" label={isZh ? '城市' : 'City'} required />
                                <Field
                                    name="streetLine1"
                                    label={isZh ? '详细地址' : 'Street address'}
                                    required
                                    wide
                                />
                                <Field
                                    name="postalCode"
                                    label={isZh ? '邮政编码' : 'Postal code'}
                                    required
                                    wide
                                />
                            </div>
                        )}
                    </section>
                )}
                {!!physicalLines.length && (
                    <CheckoutItemsGroup
                        title={isZh ? '快递配送' : 'Delivery'}
                        hint={
                            isZh
                                ? `${physicalLines.length} 种 · 共 ${physicalLines.reduce((sum, line) => sum + line.quantity, 0)} 件`
                                : `${physicalLines.length} products`
                        }
                        lines={physicalLines}
                        locale={locale}
                        language={language}
                    />
                )}
                {!!digitalLines.length && (
                    <CheckoutItemsGroup
                        title={isZh ? '数字交付' : 'Digital delivery'}
                        hint={
                            isZh
                                ? `${digitalLines.length} 种 · 共 ${digitalLines.reduce((sum, line) => sum + line.quantity, 0)} 件`
                                : `${digitalLines.length} products`
                        }
                        lines={digitalLines}
                        locale={locale}
                        language={language}
                    />
                )}
                <section className="checkout-section checkout-options">
                    {requiresShipping && !shippingMethods.length && (
                        <button type="button" onClick={() => formRef.current?.requestSubmit()}>
                            <span>{isZh ? '配送方式' : 'Delivery'}</span>
                            <small>
                                {isZh ? '填写地址后计算' : 'Calculate after address'}
                                <ChevronRight />
                            </small>
                        </button>
                    )}
                    {requiresShipping && !!shippingMethods.length && (
                        <fieldset className="shipping-method-list" disabled={shippingUpdating || submitting}>
                            <legend>{isZh ? '配送方式' : 'Delivery'}</legend>
                            {shippingMethods.map(method => (
                                <label key={method.id}>
                                    <input
                                        type="radio"
                                        name="shippingMethod"
                                        value={method.id}
                                        checked={selectedShippingId === method.id}
                                        onChange={() => void selectShippingMethod(method.id)}
                                    />
                                    <span>
                                        <strong>{method.name}</strong>
                                        {method.description && <small>{method.description}</small>}
                                    </span>
                                    <b>{formatMoney(method.priceWithTax, order.currencyCode, locale)}</b>
                                </label>
                            ))}
                        </fieldset>
                    )}
                    <button
                        type="button"
                        onClick={() =>
                            onNotify(
                                isZh
                                    ? '订单提交后继续选择支付方式'
                                    : 'Choose a payment method after placing the order',
                            )
                        }
                    >
                        <span>{isZh ? '支付方式' : 'Payment method'}</span>
                        <small>
                            {isZh ? '提交后选择' : 'Choose after submission'}
                            <ChevronRight />
                        </small>
                    </button>
                    <button type="button" onClick={openOrderNote}>
                        <span>{isZh ? '订单备注' : 'Order note'}</span>
                        <small>
                            {order.customFields.customerNote
                                ? trimText(order.customFields.customerNote, 20)
                                : isZh
                                  ? '添加备注'
                                  : 'Add a note'}
                            <ChevronRight />
                        </small>
                    </button>
                    <button type="button" onClick={() => setCouponOpen(true)}>
                        <span>{isZh ? '优惠券' : 'Coupon'}</span>
                        <small>
                            {order.couponCodes.length
                                ? isZh
                                    ? `已使用 ${order.couponCodes.length} 个优惠码`
                                    : `${order.couponCodes.length} applied`
                                : isZh
                                  ? '输入优惠码'
                                  : 'Enter coupon code'}
                            <ChevronRight />
                        </small>
                    </button>
                </section>
                <section className="checkout-section">
                    <PriceSummary order={order} locale={locale} language={language} />
                </section>
                <section
                    className="checkout-assurance"
                    aria-label={isZh ? '购物保障' : 'Purchase protection'}
                >
                    <span>
                        <CircleCheck />
                        {isZh ? '正品保障' : 'Authenticity'}
                    </span>
                    <span>
                        <Truck />
                        {physicalLines.length
                            ? isZh
                                ? '配送可追踪'
                                : 'Tracked delivery'
                            : isZh
                              ? '自动交付'
                              : 'Automatic delivery'}
                    </span>
                    <span>
                        <RotateCcw />
                        {isZh ? '售后支持' : 'After-sales'}
                    </span>
                </section>
                {formError && <InlineError message={formError} />}
                <div className="submit-order-bar">
                    <div>
                        <small>
                            {isZh ? `共 ${order.totalQuantity} 件` : `${order.totalQuantity} items`}
                        </small>
                        <span>
                            {isZh ? '合计' : 'Total'}{' '}
                            <strong>{formatMoney(order.totalWithTax, order.currencyCode, locale)}</strong>
                        </span>
                    </div>
                    <button type="submit" disabled={submitting}>
                        {submitting
                            ? isZh
                                ? '处理中'
                                : 'Processing'
                            : requiresShipping && !shippingMethods.length
                              ? isZh
                                  ? '下一步，选择配送'
                                  : 'Continue to delivery'
                              : isZh
                                ? '提交订单'
                                : 'Submit order'}
                    </button>
                </div>
            </form>
            {couponOpen && (
                <CouponSheet
                    couponCodes={order.couponCodes}
                    language={language}
                    loading={submitting}
                    onApply={onApplyCoupon}
                    onRemove={onRemoveCoupon}
                    onClose={() => setCouponOpen(false)}
                />
            )}
            {noteOpen && (
                <Sheet
                    title={isZh ? '订单备注' : 'Order note'}
                    onClose={() => !noteSaving && setNoteOpen(false)}
                >
                    <form className="order-note-sheet" onSubmit={event => void saveOrderNote(event)}>
                        <label>
                            <span>{isZh ? '给商家留言' : 'Message for the store'}</span>
                            <textarea
                                value={noteDraft}
                                maxLength={ORDER_NOTE_MAX_LENGTH}
                                rows={6}
                                autoFocus
                                placeholder={
                                    isZh
                                        ? '例如配送时间、包装要求；不要填写支付密码等敏感信息'
                                        : 'For example, delivery or packaging instructions. Do not enter passwords.'
                                }
                                onChange={event => setNoteDraft(event.currentTarget.value)}
                            />
                        </label>
                        <div className="order-note-meta">
                            <small>{isZh ? '最多 500 个字符' : 'Up to 500 characters'}</small>
                            <span>
                                {noteDraft.length}/{ORDER_NOTE_MAX_LENGTH}
                            </span>
                        </div>
                        {noteError && <InlineError message={noteError} />}
                        <div className="order-note-actions">
                            <button
                                type="button"
                                disabled={noteSaving || !noteDraft}
                                onClick={() => setNoteDraft('')}
                            >
                                {isZh ? '清空' : 'Clear'}
                            </button>
                            <button className="primary-action" type="submit" disabled={noteSaving}>
                                {noteSaving ? (isZh ? '保存中' : 'Saving') : isZh ? '保存备注' : 'Save note'}
                            </button>
                        </div>
                    </form>
                </Sheet>
            )}
        </main>
    );
}

function OrdersPage({
    api,
    customer,
    market,
    locale,
    language,
    storefrontName,
    initialTab,
    onBack,
    onNavigate,
    onBuyAgain,
}: {
    api: ShopApi;
    customer: ActiveCustomer | null;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    storefrontName: string;
    initialTab: OrderTab;
    onBack: () => void;
    onNavigate: (route: RouteState) => void;
    onBuyAgain: (order: Order) => Promise<void>;
}) {
    const isZh = language === 'zh';
    const [tab, setTab] = useState<OrderTab>(initialTab);
    const [orders, setOrders] = useState<Order[]>([]);
    const [totalItems, setTotalItems] = useState(0);
    const [loading, setLoading] = useState(false);
    const [listError, setListError] = useState('');
    const [retryKey, setRetryKey] = useState(0);
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchInput, setSearchInput] = useState('');
    const [orderCode, setOrderCode] = useState('');
    const pageSize = 10;
    const tabs: Array<{ id: OrderTab; label: string }> = [
        { id: 'all', label: isZh ? '全部' : 'All' },
        { id: 'pending', label: isZh ? '待付款' : 'To pay' },
        { id: 'shipping', label: isZh ? '待发货' : 'To ship' },
        { id: 'receiving', label: isZh ? '待收货' : 'To receive' },
        { id: 'service', label: isZh ? '售后' : 'After-sales' },
    ];

    useEffect(() => setTab(initialTab), [initialTab]);

    useEffect(() => {
        if (!customer || tab === 'service') {
            setOrders([]);
            setTotalItems(0);
            setLoading(false);
            setListError('');
            return;
        }
        let cancelled = false;
        setOrders([]);
        setTotalItems(0);
        setLoading(true);
        setListError('');
        void api
            .customerOrders(0, pageSize, orderStatesForTab(tab), orderCode)
            .then(page => {
                if (cancelled) return;
                setOrders(page.items);
                setTotalItems(page.totalItems);
            })
            .catch(requestError => {
                if (!cancelled) {
                    setListError(
                        requestError instanceof Error
                            ? requestError.message
                            : isZh
                              ? '订单加载失败'
                              : 'Could not load orders',
                    );
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [api, customer, isZh, orderCode, retryKey, tab]);

    const loadMore = async () => {
        if (loading || orders.length >= totalItems) return;
        setLoading(true);
        setListError('');
        try {
            const page = await api.customerOrders(orders.length, pageSize, orderStatesForTab(tab), orderCode);
            setOrders(current => [
                ...current,
                ...page.items.filter(order => !current.some(item => item.id === order.id)),
            ]);
            setTotalItems(page.totalItems);
        } catch (requestError) {
            setListError(
                requestError instanceof Error
                    ? requestError.message
                    : isZh
                      ? '更多订单加载失败'
                      : 'Could not load more orders',
            );
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="page subpage orders-page">
            <SubHeader
                title={isZh ? '我的订单' : 'My orders'}
                onBack={onBack}
                action={
                    <button
                        type="button"
                        onClick={() => setSearchOpen(value => !value)}
                        aria-label={isZh ? '搜索订单' : 'Search orders'}
                        aria-expanded={searchOpen}
                    >
                        {searchOpen ? <X /> : <Search />}
                    </button>
                }
            />
            <nav className="order-tabs">
                {tabs.map(item => (
                    <button
                        type="button"
                        key={item.id}
                        className={tab === item.id ? 'is-active' : undefined}
                        onClick={() => setTab(item.id)}
                    >
                        {item.label}
                    </button>
                ))}
            </nav>
            {searchOpen && (
                <form
                    className="order-search"
                    onSubmit={event => {
                        event.preventDefault();
                        setOrderCode(searchInput.trim());
                    }}
                >
                    <Search aria-hidden="true" />
                    <input
                        value={searchInput}
                        onChange={event => setSearchInput(event.target.value)}
                        placeholder={isZh ? '输入订单号' : 'Enter order code'}
                        aria-label={isZh ? '订单号' : 'Order code'}
                    />
                    {!!searchInput && (
                        <button
                            type="button"
                            onClick={() => {
                                setSearchInput('');
                                setOrderCode('');
                            }}
                            aria-label={isZh ? '清空' : 'Clear'}
                        >
                            <X />
                        </button>
                    )}
                    <button type="submit">{isZh ? '搜索' : 'Search'}</button>
                </form>
            )}
            {!customer ? (
                <EmptyState
                    icon={<UserRound />}
                    title={isZh ? '登录后查看订单' : 'Sign in to view orders'}
                    detail={
                        isZh
                            ? '订单和物流信息将安全保存在账户中'
                            : 'Orders and delivery details are saved to your account'
                    }
                    action={isZh ? '去登录' : 'Sign in'}
                    onAction={() => onNavigate({ name: 'login' })}
                />
            ) : tab === 'service' ? (
                <EmptyState
                    icon={<RotateCcw />}
                    title={isZh ? '暂无售后记录' : 'No after-sales records'}
                    detail={
                        isZh
                            ? '售后能力需要商家后台服务流程支持'
                            : 'After-sales requires merchant service workflow support'
                    }
                />
            ) : loading && !orders.length ? (
                <PageSkeleton />
            ) : listError && !orders.length ? (
                <EmptyState
                    icon={<WifiOff />}
                    title={isZh ? '订单加载失败' : 'Could not load orders'}
                    detail={listError}
                    action={isZh ? '重试' : 'Retry'}
                    onAction={() => setRetryKey(value => value + 1)}
                />
            ) : orders.length ? (
                <div className="order-list">
                    {orders.map(order => (
                        <OrderCard
                            key={order.id}
                            order={order}
                            market={market}
                            locale={locale}
                            language={language}
                            storefrontName={storefrontName}
                            onOpen={() => onNavigate({ name: 'order-detail', id: order.id })}
                            onBuyAgain={() => void onBuyAgain(order)}
                        />
                    ))}
                    {listError && (
                        <InlineError
                            message={listError}
                            action={isZh ? '重试' : 'Retry'}
                            onAction={() => void loadMore()}
                        />
                    )}
                    {orders.length < totalItems && (
                        <button
                            type="button"
                            className="load-more-button order-load-more"
                            disabled={loading}
                            onClick={() => void loadMore()}
                        >
                            {loading
                                ? isZh
                                    ? '加载中…'
                                    : 'Loading…'
                                : isZh
                                  ? `加载更多（${orders.length}/${totalItems}）`
                                  : `Load more (${orders.length}/${totalItems})`}
                        </button>
                    )}
                </div>
            ) : (
                <EmptyState
                    icon={<Package />}
                    title={isZh ? '暂无相关订单' : 'No orders here'}
                    detail={isZh ? '完成购买后，订单会显示在这里' : 'Completed purchases will appear here'}
                />
            )}
        </main>
    );
}

function OrderDetailPage({
    order,
    market,
    locale,
    language,
    storefrontName,
    onBack,
    onBuyAgain,
    onReopen,
    onUnavailable,
}: {
    order: Order | null;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    storefrontName: string;
    onBack: () => void;
    onBuyAgain: (order: Order) => Promise<void>;
    onReopen: (order: Order) => Promise<void>;
    onUnavailable: () => void;
}) {
    const isZh = language === 'zh';
    if (!order)
        return (
            <Subpage title={isZh ? '订单详情' : 'Order details'} onBack={onBack}>
                <EmptyState icon={<Package />} title={isZh ? '没有找到订单' : 'Order not found'} />
            </Subpage>
        );
    const inTransit = ['Shipped', 'PartiallyShipped'].includes(order.state);
    const pending = ['AddingItems', 'ArrangingPayment'].includes(order.state);
    const fulfillments = order.fulfillments ?? [];
    const statusHint = pending
        ? isZh
            ? '订单等待支付，请在支付页完成付款'
            : 'Complete payment to continue'
        : inTransit
          ? isZh
              ? '商品正在运输中，请留意物流更新'
              : 'Your order is in transit'
          : ['PaymentAuthorized', 'PaymentSettled'].includes(order.state)
            ? isZh
                ? '商家正在准备你的商品'
                : 'The merchant is preparing your order'
            : isZh
              ? '订单状态已更新'
              : 'Order status updated';
    return (
        <main className="page subpage order-detail-page">
            <SubHeader title={isZh ? '订单详情' : 'Order details'} onBack={onBack} />
            <section className="order-status">
                <strong>{orderStateLabel(order.state, language)}</strong>
                <span>{statusHint}</span>
                <small>{isZh ? `订单号 ${order.code}` : `Order ${order.code}`}</small>
            </section>
            {(inTransit || fulfillments.length > 0) && (
                <section className="order-logistics" id="order-logistics">
                    <Navigation />
                    <div className="order-logistics-content">
                        <strong>{isZh ? '物流信息' : 'Delivery details'}</strong>
                        {fulfillments.length ? (
                            fulfillments.map((fulfillment, index) => (
                                <div className="order-logistics-item" key={fulfillment.id}>
                                    <span>
                                        {fulfillments.length > 1
                                            ? isZh
                                                ? `包裹 ${index + 1}`
                                                : `Shipment ${index + 1}`
                                            : isZh
                                              ? '配送包裹'
                                              : 'Shipment'}
                                    </span>
                                    <small>{fulfillment.method}</small>
                                    <b>
                                        {fulfillment.trackingCode
                                            ? isZh
                                                ? `运单号 ${fulfillment.trackingCode}`
                                                : `Tracking ${fulfillment.trackingCode}`
                                            : isZh
                                              ? '承运商尚未提供运单号'
                                              : 'Tracking number is not available yet'}
                                    </b>
                                    <em>
                                        {fulfillmentStateLabel(fulfillment.state, language)} ·{' '}
                                        {formatOrderDate(fulfillment.updatedAt, locale)}
                                    </em>
                                </div>
                            ))
                        ) : (
                            <small>
                                {isZh
                                    ? '物流详情将在承运商更新后显示'
                                    : 'Updates appear when provided by the carrier'}
                            </small>
                        )}
                    </div>
                </section>
            )}
            <section className="order-detail-products">
                <header>
                    <strong>{storefrontName}</strong>
                    <span>{isZh ? `${order.lines.length} 种商品` : `${order.lines.length} products`}</span>
                </header>
                {order.lines.map(line => (
                    <article key={line.id}>
                        <ProductVariantImage variant={line.productVariant} alt={line.productVariant.name} />
                        <div>
                            <strong>{line.productVariant.name}</strong>
                            <small>{line.productVariant.sku}</small>
                            <em>
                                {line.productVariant.customFields.fulfillmentType === 'digital'
                                    ? isZh
                                        ? '数字商品 · 自动交付'
                                        : 'Digital · automatic delivery'
                                    : isZh
                                      ? '普通商品 · 售后支持'
                                      : 'Physical · after-sales'}
                            </em>
                        </div>
                        <span>
                            <b>
                                {formatMoney(line.linePriceWithTax, line.productVariant.currencyCode, locale)}
                            </b>
                            <small>×{line.quantity}</small>
                        </span>
                    </article>
                ))}
            </section>
            <section className="order-information">
                <div>
                    <span>{isZh ? '下单时间' : 'Placed at'}</span>
                    <b>{formatOrderDate(order.orderPlacedAt, locale)}</b>
                </div>
                <div>
                    <span>{isZh ? '订单编号' : 'Order code'}</span>
                    <b>{order.code}</b>
                </div>
            </section>
            <section className="order-detail-summary">
                <PriceSummary order={order} locale={locale} language={language} />
            </section>
            <div className="order-detail-actions">
                <button
                    type="button"
                    className="primary-action"
                    onClick={
                        pending
                            ? () => void onReopen(order)
                            : inTransit
                              ? () => {
                                    if (fulfillments.length) {
                                        document
                                            .getElementById('order-logistics')
                                            ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                    } else {
                                        onUnavailable();
                                    }
                                }
                              : () => void onBuyAgain(order)
                    }
                >
                    {pending
                        ? isZh
                            ? '返回修改订单'
                            : 'Reopen order'
                        : inTransit
                          ? isZh
                              ? '查看物流'
                              : 'Track'
                          : isZh
                            ? '再买一单'
                            : 'Buy again'}
                </button>
            </div>
        </main>
    );
}

function AddressesPage({
    api,
    customer,
    market,
    language,
    onBack,
    onCustomerChange,
    onNavigate,
    onNotify,
}: {
    api: ShopApi;
    customer: ActiveCustomer | null;
    market: MarketConfig;
    language: StorefrontLanguage;
    onBack: () => void;
    onCustomerChange: (customer: ActiveCustomer | null) => void;
    onNavigate: (route: RouteState) => void;
    onNotify: (message: string) => void;
}) {
    const isZh = language === 'zh';
    const [open, setOpen] = useState(false);
    const [editingAddress, setEditingAddress] = useState<CustomerAddress | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState('');
    if (!customer)
        return (
            <Subpage title={isZh ? '地址管理' : 'Addresses'} onBack={onBack}>
                <EmptyState
                    icon={<MapPin />}
                    title={isZh ? '登录后管理地址' : 'Sign in to manage addresses'}
                    action={isZh ? '去登录' : 'Sign in'}
                    onAction={() => onNavigate({ name: 'login' })}
                />
            </Subpage>
        );
    const save = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setSubmitting(true);
        setFormError('');
        try {
            const input: CustomerAddressInput = {
                fullName: String(data.get('fullName')),
                phoneNumber: String(data.get('phoneNumber')),
                province: String(data.get('province')),
                city: String(data.get('city')),
                streetLine1: String(data.get('streetLine1')),
                streetLine2: String(data.get('streetLine2') ?? ''),
                postalCode: String(data.get('postalCode')),
                countryCode: editingAddress?.country.code ?? market.countryCode,
                defaultShippingAddress:
                    customer.addresses?.length === 0 || data.get('defaultShippingAddress') === 'on',
            };
            if (editingAddress) await api.updateAddress({ ...input, id: editingAddress.id });
            else await api.createAddress(input);
            onCustomerChange(await api.activeCustomer());
            setOpen(false);
            setEditingAddress(null);
            onNotify(isZh ? '地址已保存' : 'Address saved');
        } catch (requestError) {
            setFormError(
                requestError instanceof Error
                    ? requestError.message
                    : isZh
                      ? '保存失败'
                      : 'Could not save address',
            );
        } finally {
            setSubmitting(false);
        }
    };
    const remove = async (id: string) => {
        if (!window.confirm(isZh ? '确定删除这个地址吗？' : 'Delete this address?')) return;
        try {
            await api.deleteAddress(id);
            onCustomerChange(await api.activeCustomer());
            onNotify(isZh ? '地址已删除' : 'Address deleted');
        } catch (requestError) {
            onNotify(
                requestError instanceof Error
                    ? requestError.message
                    : isZh
                      ? '删除失败'
                      : 'Could not delete address',
            );
        }
    };
    const makeDefault = async (address: CustomerAddress) => {
        try {
            await api.updateAddress({
                id: address.id,
                fullName: address.fullName ?? '',
                phoneNumber: address.phoneNumber ?? '',
                streetLine1: address.streetLine1,
                streetLine2: address.streetLine2 ?? '',
                city: address.city ?? '',
                province: address.province ?? '',
                postalCode: address.postalCode ?? '',
                countryCode: address.country.code,
                defaultShippingAddress: true,
            });
            onCustomerChange(await api.activeCustomer());
            onNotify(isZh ? '默认地址已更新' : 'Default address updated');
        } catch (requestError) {
            onNotify(
                requestError instanceof Error
                    ? requestError.message
                    : isZh
                      ? '设置默认地址失败'
                      : 'Could not set the default address',
            );
        }
    };
    return (
        <main className="page subpage addresses-page">
            <SubHeader
                title={isZh ? '地址管理' : 'Addresses'}
                onBack={onBack}
                action={
                    <button
                        type="button"
                        onClick={() => {
                            setEditingAddress(null);
                            setFormError('');
                            setOpen(true);
                        }}
                        aria-label={isZh ? '新增地址' : 'Add address'}
                    >
                        <Plus />
                    </button>
                }
            />
            {customer.addresses?.length ? (
                <div className="address-list">
                    {customer.addresses.map(address => (
                        <article className="address-card" key={address.id}>
                            <header>
                                <strong>{address.fullName}</strong>
                                <span>{address.phoneNumber}</span>
                                {address.defaultShippingAddress && <em>{isZh ? '默认' : 'Default'}</em>}
                            </header>
                            <p>{addressText(address)}</p>
                            <footer>
                                <span>{address.country.name}</span>
                                <div className="address-actions">
                                    {!address.defaultShippingAddress && (
                                        <button type="button" onClick={() => void makeDefault(address)}>
                                            <CircleCheck />
                                            {isZh ? '设为默认' : 'Make default'}
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setEditingAddress(address);
                                            setFormError('');
                                            setOpen(true);
                                        }}
                                    >
                                        <Pencil />
                                        {isZh ? '编辑' : 'Edit'}
                                    </button>
                                    <button type="button" onClick={() => void remove(address.id)}>
                                        <Trash2 />
                                        {isZh ? '删除' : 'Delete'}
                                    </button>
                                </div>
                            </footer>
                        </article>
                    ))}
                </div>
            ) : (
                <EmptyState
                    icon={<MapPin />}
                    title={isZh ? '还没有收货地址' : 'No saved addresses'}
                    detail={isZh ? '新增地址后，结算会更方便' : 'Save an address for faster checkout'}
                    action={isZh ? '新增地址' : 'Add address'}
                    onAction={() => {
                        setEditingAddress(null);
                        setFormError('');
                        setOpen(true);
                    }}
                />
            )}
            {open && (
                <Sheet
                    title={
                        editingAddress
                            ? isZh
                                ? '编辑收货地址'
                                : 'Edit address'
                            : isZh
                              ? '新增收货地址'
                              : 'Add address'
                    }
                    onClose={() => {
                        setOpen(false);
                        setEditingAddress(null);
                    }}
                >
                    <form className="address-form" onSubmit={event => void save(event)}>
                        <Field
                            name="fullName"
                            label={isZh ? '收货人' : 'Full name'}
                            defaultValue={editingAddress?.fullName ?? ''}
                            required
                            wide
                        />
                        <Field
                            name="phoneNumber"
                            label={isZh ? '手机号' : 'Phone'}
                            defaultValue={editingAddress?.phoneNumber ?? ''}
                            required
                            wide
                        />
                        <Field
                            name="province"
                            label={isZh ? '省/州' : 'Province'}
                            defaultValue={editingAddress?.province ?? ''}
                            required
                        />
                        <Field
                            name="city"
                            label={isZh ? '城市' : 'City'}
                            defaultValue={editingAddress?.city ?? ''}
                            required
                        />
                        <Field
                            name="streetLine1"
                            label={isZh ? '详细地址' : 'Street address'}
                            defaultValue={editingAddress?.streetLine1 ?? ''}
                            required
                            wide
                        />
                        <Field
                            name="streetLine2"
                            label={isZh ? '楼栋、单元等（选填）' : 'Apartment, suite, etc. (optional)'}
                            defaultValue={editingAddress?.streetLine2 ?? ''}
                            wide
                        />
                        <Field
                            name="postalCode"
                            label={isZh ? '邮政编码' : 'Postal code'}
                            defaultValue={editingAddress?.postalCode ?? ''}
                            required
                            wide
                        />
                        <label className="address-default-toggle field-wide">
                            <input
                                type="checkbox"
                                name="defaultShippingAddress"
                                defaultChecked={Boolean(editingAddress?.defaultShippingAddress)}
                            />
                            <span>{isZh ? '设为默认收货地址' : 'Set as default shipping address'}</span>
                        </label>
                        {formError && <small className="form-error">{formError}</small>}
                        <button className="primary-action wide-action" type="submit" disabled={submitting}>
                            {submitting ? (isZh ? '保存中' : 'Saving') : isZh ? '保存地址' : 'Save address'}
                        </button>
                    </form>
                </Sheet>
            )}
        </main>
    );
}

function LoginPage({
    api,
    language,
    storefrontName,
    onBack,
    onSuccess,
    onNavigate,
}: {
    api: ShopApi;
    language: StorefrontLanguage;
    storefrontName: string;
    onBack: () => void;
    onSuccess: () => Promise<void>;
    onNavigate: (route: RouteState) => void;
}) {
    const isZh = language === 'zh';
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setSubmitting(true);
        setError('');
        try {
            await api.login(String(data.get('emailAddress')), String(data.get('password')));
            await onSuccess();
        } catch (requestError) {
            setError(
                requestError instanceof Error ? requestError.message : isZh ? '登录失败' : 'Sign-in failed',
            );
        } finally {
            setSubmitting(false);
        }
    };
    return (
        <main className="page subpage login-page">
            <SubHeader title={isZh ? '登录' : 'Sign in'} onBack={onBack} />
            <section className="login-content">
                <span className="login-brand">{storefrontName}</span>
                <h1>{isZh ? '欢迎回来' : 'Welcome back'}</h1>
                <p>
                    {isZh
                        ? '登录后查看订单、地址与售后进度'
                        : 'Sign in to view orders, addresses and support'}
                </p>
                <form onSubmit={event => void submit(event)}>
                    <Field
                        name="emailAddress"
                        label={isZh ? '电子邮箱' : 'Email address'}
                        type="email"
                        autoComplete="email"
                        required
                        wide
                    />
                    <Field
                        name="password"
                        label={isZh ? '密码' : 'Password'}
                        type="password"
                        autoComplete="current-password"
                        required
                        wide
                    />
                    <button
                        className="auth-inline-link"
                        type="button"
                        onClick={() => onNavigate({ name: 'forgot-password' })}
                    >
                        {isZh ? '忘记密码？' : 'Forgot password?'}
                    </button>
                    {error && <small className="form-error">{error}</small>}
                    <button className="primary-action wide-action" type="submit" disabled={submitting}>
                        {submitting ? (isZh ? '登录中' : 'Signing in') : isZh ? '登录' : 'Sign in'}
                    </button>
                </form>
                <div className="auth-switch">
                    <span>{isZh ? '还没有账户？' : 'New here?'}</span>
                    <button type="button" onClick={() => onNavigate({ name: 'register' })}>
                        {isZh ? '注册账户' : 'Create account'}
                    </button>
                </div>
                <small>
                    {isZh
                        ? '登录即代表你同意服务条款和隐私政策'
                        : 'By signing in, you agree to the terms and privacy policy'}
                </small>
            </section>
        </main>
    );
}

function RegisterPage({
    api,
    language,
    storefrontName,
    onBack,
    onNavigate,
}: {
    api: ShopApi;
    language: StorefrontLanguage;
    storefrontName: string;
    onBack: () => void;
    onNavigate: (route: RouteState) => void;
}) {
    const isZh = language === 'zh';
    const [submitting, setSubmitting] = useState(false);
    const [registeredEmail, setRegisteredEmail] = useState('');
    const [error, setError] = useState('');
    const [resendMessage, setResendMessage] = useState('');

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const password = String(data.get('password'));
        if (password !== String(data.get('confirmPassword'))) {
            setError(isZh ? '两次输入的密码不一致' : 'The passwords do not match');
            return;
        }
        setSubmitting(true);
        setError('');
        try {
            const emailAddress = String(data.get('emailAddress')).trim();
            await api.registerCustomerAccount({
                emailAddress,
                firstName: String(data.get('firstName')).trim(),
                lastName: String(data.get('lastName')).trim(),
                password,
            });
            setRegisteredEmail(emailAddress);
        } catch (requestError) {
            setError(
                requestError instanceof Error
                    ? requestError.message
                    : isZh
                      ? '注册失败'
                      : 'Registration failed',
            );
        } finally {
            setSubmitting(false);
        }
    };

    const resend = async () => {
        setSubmitting(true);
        setError('');
        setResendMessage('');
        try {
            await api.refreshCustomerVerification(registeredEmail);
            setResendMessage(isZh ? '验证邮件已重新发送' : 'Verification email sent again');
        } catch (requestError) {
            setError(
                requestError instanceof Error
                    ? requestError.message
                    : isZh
                      ? '发送失败'
                      : 'Could not resend email',
            );
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <main className="page subpage login-page">
            <SubHeader title={isZh ? '注册' : 'Create account'} onBack={onBack} />
            <section className="login-content">
                <span className="login-brand">{storefrontName}</span>
                {registeredEmail ? (
                    <AuthResult
                        icon={<CircleCheck />}
                        title={isZh ? '请查收验证邮件' : 'Check your email'}
                        detail={
                            isZh
                                ? `验证链接已发送至 ${registeredEmail}`
                                : `We sent a verification link to ${registeredEmail}`
                        }
                    >
                        {resendMessage && (
                            <small className="auth-success-message" role="status">
                                {resendMessage}
                            </small>
                        )}
                        {error && <small className="form-error">{error}</small>}
                        <button
                            className="primary-action wide-action"
                            type="button"
                            onClick={() => void resend()}
                            disabled={submitting}
                        >
                            {submitting
                                ? isZh
                                    ? '发送中'
                                    : 'Sending'
                                : isZh
                                  ? '重新发送验证邮件'
                                  : 'Resend verification email'}
                        </button>
                        <button
                            className="auth-secondary-action"
                            type="button"
                            onClick={() => onNavigate({ name: 'login' })}
                        >
                            {isZh ? '返回登录' : 'Back to sign in'}
                        </button>
                    </AuthResult>
                ) : (
                    <>
                        <h1>{isZh ? '创建账户' : 'Create your account'}</h1>
                        <p>{isZh ? '注册后需通过邮件验证' : 'Email verification is required'}</p>
                        <form onSubmit={event => void submit(event)}>
                            <div className="auth-name-fields">
                                <Field
                                    name="firstName"
                                    label={isZh ? '名' : 'First name'}
                                    autoComplete="given-name"
                                    required
                                />
                                <Field
                                    name="lastName"
                                    label={isZh ? '姓' : 'Last name'}
                                    autoComplete="family-name"
                                    required
                                />
                            </div>
                            <Field
                                name="emailAddress"
                                label={isZh ? '电子邮箱' : 'Email address'}
                                type="email"
                                autoComplete="email"
                                required
                                wide
                            />
                            <Field
                                name="password"
                                label={isZh ? '密码' : 'Password'}
                                type="password"
                                autoComplete="new-password"
                                required
                                wide
                            />
                            <Field
                                name="confirmPassword"
                                label={isZh ? '确认密码' : 'Confirm password'}
                                type="password"
                                autoComplete="new-password"
                                required
                                wide
                            />
                            {error && <small className="form-error">{error}</small>}
                            <button
                                className="primary-action wide-action"
                                type="submit"
                                disabled={submitting}
                            >
                                {submitting
                                    ? isZh
                                        ? '注册中'
                                        : 'Creating account'
                                    : isZh
                                      ? '注册账户'
                                      : 'Create account'}
                            </button>
                        </form>
                        <div className="auth-switch">
                            <span>{isZh ? '已有账户？' : 'Already have an account?'}</span>
                            <button type="button" onClick={() => onNavigate({ name: 'login' })}>
                                {isZh ? '去登录' : 'Sign in'}
                            </button>
                        </div>
                    </>
                )}
            </section>
        </main>
    );
}

function VerifyAccountPage({
    api,
    language,
    storefrontName,
    token,
    onBack,
    onSuccess,
    onNavigate,
}: {
    api: ShopApi;
    language: StorefrontLanguage;
    storefrontName: string;
    token?: string;
    onBack: () => void;
    onSuccess: () => Promise<void>;
    onNavigate: (route: RouteState) => void;
}) {
    const isZh = language === 'zh';
    const [error, setError] = useState('');
    const attempted = useRef(false);

    useEffect(() => {
        if (attempted.current) return;
        attempted.current = true;
        if (!token) {
            setError(isZh ? '验证链接缺少令牌' : 'The verification link is missing its token');
            return;
        }
        void api
            .verifyCustomerAccount(token)
            .then(onSuccess)
            .catch(requestError => {
                setError(
                    requestError instanceof Error
                        ? requestError.message
                        : isZh
                          ? '邮箱验证失败'
                          : 'Email verification failed',
                );
            });
    }, [api, isZh, onSuccess, token]);

    return (
        <main className="page subpage login-page">
            <SubHeader title={isZh ? '验证邮箱' : 'Verify email'} onBack={onBack} />
            <section className="login-content">
                <span className="login-brand">{storefrontName}</span>
                <AuthResult
                    icon={error ? <CircleAlert /> : <Fingerprint />}
                    title={
                        error
                            ? isZh
                                ? '无法完成验证'
                                : 'Verification failed'
                            : isZh
                              ? '正在验证'
                              : 'Verifying your email'
                    }
                    detail={
                        error ||
                        (isZh
                            ? '请稍候，完成后将自动登录'
                            : 'Please wait. You will be signed in automatically.')
                    }
                >
                    {error && (
                        <button
                            className="primary-action wide-action"
                            type="button"
                            onClick={() => onNavigate({ name: 'login' })}
                        >
                            {isZh ? '返回登录' : 'Back to sign in'}
                        </button>
                    )}
                </AuthResult>
            </section>
        </main>
    );
}

function ForgotPasswordPage({
    api,
    language,
    storefrontName,
    onBack,
    onNavigate,
}: {
    api: ShopApi;
    language: StorefrontLanguage;
    storefrontName: string;
    onBack: () => void;
    onNavigate: (route: RouteState) => void;
}) {
    const isZh = language === 'zh';
    const [submitting, setSubmitting] = useState(false);
    const [requested, setRequested] = useState(false);
    const [error, setError] = useState('');

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setSubmitting(true);
        setError('');
        try {
            await api.requestPasswordReset(String(data.get('emailAddress')).trim());
            setRequested(true);
        } catch (requestError) {
            setError(
                requestError instanceof Error
                    ? requestError.message
                    : isZh
                      ? '发送重置邮件失败'
                      : 'Could not send the reset email',
            );
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <main className="page subpage login-page">
            <SubHeader title={isZh ? '忘记密码' : 'Forgot password'} onBack={onBack} />
            <section className="login-content">
                <span className="login-brand">{storefrontName}</span>
                {requested ? (
                    <AuthResult
                        icon={<CircleCheck />}
                        title={isZh ? '请查收邮件' : 'Check your email'}
                        detail={
                            isZh
                                ? '如果该邮箱已注册，你将收到密码重置链接'
                                : 'If the address is registered, a password reset link will arrive shortly.'
                        }
                    >
                        <button
                            className="primary-action wide-action"
                            type="button"
                            onClick={() => onNavigate({ name: 'login' })}
                        >
                            {isZh ? '返回登录' : 'Back to sign in'}
                        </button>
                    </AuthResult>
                ) : (
                    <>
                        <h1>{isZh ? '重置登录密码' : 'Reset your password'}</h1>
                        <p>
                            {isZh
                                ? '输入注册邮箱，我们将发送重置链接'
                                : 'Enter your email to receive a reset link'}
                        </p>
                        <form onSubmit={event => void submit(event)}>
                            <Field
                                name="emailAddress"
                                label={isZh ? '电子邮箱' : 'Email address'}
                                type="email"
                                autoComplete="email"
                                required
                                wide
                            />
                            {error && <small className="form-error">{error}</small>}
                            <button
                                className="primary-action wide-action"
                                type="submit"
                                disabled={submitting}
                            >
                                {submitting
                                    ? isZh
                                        ? '发送中'
                                        : 'Sending'
                                    : isZh
                                      ? '发送重置邮件'
                                      : 'Send reset email'}
                            </button>
                        </form>
                    </>
                )}
            </section>
        </main>
    );
}

function ResetPasswordPage({
    api,
    language,
    storefrontName,
    token,
    onBack,
    onSuccess,
    onNavigate,
}: {
    api: ShopApi;
    language: StorefrontLanguage;
    storefrontName: string;
    token?: string;
    onBack: () => void;
    onSuccess: () => Promise<void>;
    onNavigate: (route: RouteState) => void;
}) {
    const isZh = language === 'zh';
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(
        token ? '' : isZh ? '重置链接缺少令牌' : 'The reset link is missing its token',
    );

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!token) return;
        const data = new FormData(event.currentTarget);
        const password = String(data.get('password'));
        if (password !== String(data.get('confirmPassword'))) {
            setError(isZh ? '两次输入的密码不一致' : 'The passwords do not match');
            return;
        }
        setSubmitting(true);
        setError('');
        try {
            await api.resetPassword(token, password);
            await onSuccess();
        } catch (requestError) {
            setError(
                requestError instanceof Error
                    ? requestError.message
                    : isZh
                      ? '重置密码失败'
                      : 'Password reset failed',
            );
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <main className="page subpage login-page">
            <SubHeader title={isZh ? '重置密码' : 'Reset password'} onBack={onBack} />
            <section className="login-content">
                <span className="login-brand">{storefrontName}</span>
                <h1>{isZh ? '设置新密码' : 'Choose a new password'}</h1>
                <p>{isZh ? '新密码将立即用于登录' : 'Your new password will be active immediately'}</p>
                {token ? (
                    <form onSubmit={event => void submit(event)}>
                        <Field
                            name="password"
                            label={isZh ? '新密码' : 'New password'}
                            type="password"
                            autoComplete="new-password"
                            required
                            wide
                        />
                        <Field
                            name="confirmPassword"
                            label={isZh ? '确认新密码' : 'Confirm new password'}
                            type="password"
                            autoComplete="new-password"
                            required
                            wide
                        />
                        {error && <small className="form-error">{error}</small>}
                        <button className="primary-action wide-action" type="submit" disabled={submitting}>
                            {submitting
                                ? isZh
                                    ? '提交中'
                                    : 'Updating'
                                : isZh
                                  ? '更新密码'
                                  : 'Update password'}
                        </button>
                    </form>
                ) : (
                    <AuthResult
                        icon={<CircleAlert />}
                        title={isZh ? '重置链接无效' : 'Invalid reset link'}
                        detail={error}
                    >
                        <button
                            className="primary-action wide-action"
                            type="button"
                            onClick={() => onNavigate({ name: 'forgot-password' })}
                        >
                            {isZh ? '重新获取链接' : 'Request another link'}
                        </button>
                    </AuthResult>
                )}
            </section>
        </main>
    );
}

function AuthResult({
    icon,
    title,
    detail,
    children,
}: {
    icon: ReactNode;
    title: string;
    detail: string;
    children: ReactNode;
}) {
    return (
        <div className="auth-result">
            <span>{icon}</span>
            <h1>{title}</h1>
            <p>{detail}</p>
            <div>{children}</div>
        </div>
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
    onProduct,
    onAdd,
}: {
    title: string;
    subtitle: string;
    products: Product[];
    market: MarketConfig;
    locale: string;
    addingVariantId: string | null;
    onProduct: (product: Product) => void;
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
                        onOpen={() => onProduct(product)}
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
    onOpen,
    onAdd,
}: {
    product: Product;
    market: MarketConfig;
    locale: string;
    adding: boolean;
    onOpen: () => void;
    onAdd: () => void;
}) {
    const variant = product.variants[0];
    return (
        <article className="product-card">
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
        <article className="product-row">
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

function OrderCard({
    order,
    locale,
    language,
    storefrontName,
    onOpen,
    onBuyAgain,
}: {
    order: Order;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    storefrontName: string;
    onOpen: () => void;
    onBuyAgain: () => void;
}) {
    const isZh = language === 'zh';
    const completed = ['Delivered', 'Cancelled'].includes(order.state);
    const primaryLabel = completed
        ? isZh
            ? '再买一单'
            : 'Buy again'
        : ['Shipped', 'PartiallyShipped'].includes(order.state)
          ? isZh
              ? '查看物流'
              : 'Track'
          : isZh
            ? '查看详情'
            : 'View details';
    return (
        <article className="order-card">
            <header>
                <button type="button" onClick={onOpen}>
                    <strong>{storefrontName}</strong>
                    <ChevronRight />
                </button>
                <span>{orderStateLabel(order.state, language)}</span>
            </header>
            <button className="order-card-product" type="button" onClick={onOpen}>
                <OrderImage order={order} />
                <span>
                    <strong>
                        {order.lines[0]?.productVariant.name ?? (isZh ? '订单商品' : 'Order item')}
                    </strong>
                    <small>
                        {order.lines.length > 1
                            ? isZh
                                ? `另有 ${order.lines.length - 1} 种商品`
                                : `${order.lines.length - 1} more products`
                            : order.lines[0]?.productVariant.name}
                    </small>
                    <em>{isZh ? '售后支持 · 正品保障' : 'After-sales support'}</em>
                </span>
                <span>
                    <b>{formatMoney(order.lines[0]?.linePriceWithTax ?? 0, order.currencyCode, locale)}</b>
                    <small>×{order.totalQuantity}</small>
                </span>
            </button>
            <footer>
                <div className="order-total">
                    {isZh ? `共 ${order.totalQuantity} 件，实付款` : `${order.totalQuantity} items · Paid`}{' '}
                    <b>{formatMoney(order.totalWithTax, order.currencyCode, locale)}</b>
                </div>
                <div className="order-operations">
                    <button
                        type="button"
                        className="primary-action"
                        onClick={completed ? onBuyAgain : onOpen}
                    >
                        {primaryLabel}
                    </button>
                </div>
            </footer>
        </article>
    );
}

function PriceSummary({
    order,
    locale,
    language,
}: {
    order: Order;
    locale: string;
    language: StorefrontLanguage;
}) {
    const isZh = language === 'zh';
    const discount = Math.abs(order.discounts.reduce((sum, item) => sum + item.amountWithTax, 0));
    return (
        <dl className="price-summary">
            <div>
                <dt>{isZh ? '商品金额' : 'Items'}</dt>
                <dd>{formatMoney(order.subTotalWithTax + discount, order.currencyCode, locale)}</dd>
            </div>
            <div>
                <dt>{isZh ? '运费' : 'Shipping'}</dt>
                <dd>{formatMoney(order.shippingWithTax, order.currencyCode, locale)}</dd>
            </div>
            {discount > 0 && (
                <div className="discount">
                    <dt>{isZh ? '优惠' : 'Discount'}</dt>
                    <dd>-{formatMoney(discount, order.currencyCode, locale)}</dd>
                </div>
            )}
            <div className="summary-total">
                <dt>{isZh ? '合计' : 'Total'}</dt>
                <dd>{formatMoney(order.totalWithTax, order.currencyCode, locale)}</dd>
            </div>
        </dl>
    );
}

function CheckoutItemsGroup({
    title,
    hint,
    lines,
    locale,
    language,
}: {
    title: string;
    hint: string;
    lines: Order['lines'];
    locale: string;
    language: StorefrontLanguage;
}) {
    const isZh = language === 'zh';
    return (
        <section className="checkout-section checkout-product-group">
            <header className="checkout-section-title">
                <h2>{title}</h2>
                <span>{hint}</span>
            </header>
            <div className="checkout-items">
                {lines.map(line => (
                    <article key={line.id}>
                        <ProductVariantImage variant={line.productVariant} alt={line.productVariant.name} />
                        <div>
                            <strong>{line.productVariant.name}</strong>
                            <small>{line.productVariant.sku}</small>
                            <em>
                                {line.productVariant.customFields.fulfillmentType === 'digital'
                                    ? isZh
                                        ? '付款后自动交付'
                                        : 'Delivered after payment'
                                    : isZh
                                      ? '售后支持 · 正品保障'
                                      : 'After-sales support'}
                            </em>
                        </div>
                        <span>
                            <b>
                                {formatMoney(line.linePriceWithTax, line.productVariant.currencyCode, locale)}
                            </b>
                            <small>×{line.quantity}</small>
                        </span>
                    </article>
                ))}
            </div>
        </section>
    );
}

function Subpage({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
    return (
        <main className="page subpage">
            <SubHeader title={title} onBack={onBack} />
            {children}
        </main>
    );
}
function SubHeader({ title, onBack, action }: { title: string; onBack: () => void; action?: ReactNode }) {
    return (
        <header className="topbar subpage-header">
            <button type="button" onClick={onBack} aria-label="Back">
                <ArrowLeft />
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
function ServiceButton({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
    return (
        <button type="button" onClick={onClick}>
            <span>{icon}</span>
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
        <img src={image} alt={product.name} loading="lazy" />
    ) : (
        <div className="image-placeholder">
            <Package />
        </div>
    );
}
function ProductVariantImage({ variant, alt }: { variant: ProductVariant; alt: string }) {
    const image = variant.featuredAsset?.preview ?? variant.product.featuredAsset?.preview;
    return image ? (
        <img src={image} alt={alt} loading="lazy" />
    ) : (
        <div className="image-placeholder">
            <Package />
        </div>
    );
}
function OrderImage({ order }: { order: Order }) {
    const variant = order.lines[0]?.productVariant;
    return variant ? (
        <ProductVariantImage variant={variant} alt={variant.name} />
    ) : (
        <div className="image-placeholder">
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
function PageSkeleton() {
    return (
        <div className="page-skeleton" aria-label="Loading">
            <span className="skeleton-hero" />
            <span className="skeleton-line" />
            <div>
                <span />
                <span />
                <span />
                <span />
            </div>
            <span className="skeleton-block" />
            <span className="skeleton-block" />
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
        <Sheet title={isZh ? '优惠码' : 'Coupon code'} onClose={onClose}>
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

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
    return (
        <div className="sheet-layer" role="presentation">
            <button className="sheet-mask" type="button" onClick={onClose} aria-label="Close" />
            <section className="sheet" role="dialog" aria-modal="true" aria-label={title}>
                <header>
                    <strong>{title}</strong>
                    <button type="button" onClick={onClose} aria-label="Close">
                        <X />
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

function productImage(product?: Product | null): string | null {
    return product?.featuredAsset?.preview ?? product?.assets?.[0]?.preview ?? null;
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
    return new Intl.DateTimeFormat(locale, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(new Date(value));
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
