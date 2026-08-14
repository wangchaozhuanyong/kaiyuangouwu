import {
    ArrowLeft,
    ArrowUpDown,
    Bell,
    Check,
    ChevronRight,
    CircleAlert,
    CircleCheck,
    Coffee,
    Download,
    Fingerprint,
    Headphones,
    Heart,
    House,
    LayoutGrid,
    MapPin,
    MessageSquare,
    Minus,
    Navigation,
    Package,
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
import { enabledMarkets, languageCodeFor, localeFor, markets, uiCopy } from './i18n';
import {
    ActiveCustomer,
    CollectionSummary,
    CustomerAddress,
    FulfillmentType,
    MarketCode,
    MarketConfig,
    Order,
    Product,
    ProductVariant,
    ShippingMethod,
    StorefrontCart,
    StorefrontCheckoutSession,
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
    | 'login';
type OrderTab = 'all' | 'pending' | 'shipping' | 'receiving' | 'service';
type SortMode = 'recommended' | 'newest' | 'price-asc' | 'price-desc';

interface RouteState {
    name: RouteName;
    id?: string;
    tab?: OrderTab;
}

const rootPages: MainPage[] = ['home', 'category', 'cart', 'account'];

function routeFromLocation(): RouteState {
    const raw = window.location.hash.replace(/^#\/?/, '');
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
        'login',
    ];
    return {
        name: validNames.includes(name) ? name : 'home',
        id: params.get('id') ?? undefined,
        tab: (params.get('tab') as OrderTab | null) ?? undefined,
    };
}

function routeHash(route: RouteState): string {
    const params = new URLSearchParams();
    if (route.id) params.set('id', route.id);
    if (route.tab) params.set('tab', route.tab);
    return `#/${route.name}${params.size ? `?${params.toString()}` : ''}`;
}

export function App() {
    const [marketCode] = useState<MarketCode>(() => {
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
    const [collections, setCollections] = useState<CollectionSummary[]>([]);
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

    const market = markets[marketCode];
    const locale = localeFor(language, market);
    const text = uiCopy[language];
    const isZh = language === 'zh';
    const api = useMemo(() => new ShopApi(market, languageCodeFor(language)), [language, market]);

    const notify = useCallback((message: string) => {
        setToast(message);
        if (toastTimer.current) window.clearTimeout(toastTimer.current);
        toastTimer.current = window.setTimeout(() => setToast(null), 2400);
    }, []);

    const navigate = useCallback((next: RouteState, replace = false) => {
        const hash = routeHash(next);
        if (replace) window.history.replaceState(next, '', hash);
        else window.history.pushState(next, '', hash);
        setRoute(next);
        window.scrollTo({ top: 0, behavior: 'instant' });
    }, []);

    const goBack = useCallback(() => {
        if (window.history.length > 1) window.history.back();
        else navigate({ name: 'home' }, true);
    }, [navigate]);

    useEffect(() => {
        if (!window.location.hash) navigate({ name: 'home' }, true);
        const onPopState = () => setRoute(routeFromLocation());
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
        const [productResult, collectionResult, cartResult, customerResult] = await Promise.allSettled([
            api.products(),
            api.collections(),
            api.cart(),
            api.activeCustomer(),
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
        setLoading(false);
    }, [api, text.loadError]);

    useEffect(() => {
        localStorage.setItem('storefront-language', language);
        document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
        document.title = isZh ? '云桥Ai · 移动商城' : 'Yunqiao Ai · Store';
        void loadStorefront();
    }, [isZh, language, loadStorefront]);

    useEffect(() => {
        if (activeCollectionId === 'all' && collections.length) {
            setActiveCollectionId(collections[0].id);
            setActiveChildId(collections[0].children?.[0]?.id ?? collections[0].id);
        }
    }, [activeCollectionId, collections]);

    const refreshCart = useCallback(async () => {
        const latest = await api.cart();
        setCart(latest);
        setCheckoutOrder(latest.checkoutOrder);
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
            setCartError(requestError instanceof Error ? requestError.message : text.loadError);
        } finally {
            setCartLoading(false);
        }
    }, [api, cart, navigate, text.loadError]);

    const selectedProduct = route.id ? (products.find(product => product.id === route.id) ?? null) : null;
    const selectedOrder = route.id
        ? (customer?.orders.items.find(order => order.id === route.id) ?? null)
        : null;

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
                        loading={loading}
                        error={error}
                        market={market}
                        locale={locale}
                        language={language}
                        addingVariantId={addingVariantId}
                        onNavigate={navigate}
                        onCategorySelect={collection => {
                            setActiveCollectionId(collection.id);
                            setActiveChildId(collection.children?.[0]?.id ?? collection.id);
                            navigate({ name: 'category' });
                        }}
                        onAdd={variant => void addToCart(variant)}
                        onToggleLanguage={() => setLanguage(value => (value === 'zh' ? 'en' : 'zh'))}
                        onNotify={() => notify(text.unavailable)}
                        onRetry={() => void loadStorefront()}
                    />
                );
            case 'category':
                return (
                    <CategoryPage
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
                        onNotify={() => notify(text.unavailable)}
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
                        onNavigate={navigate}
                        onAdd={variant => void addToCart(variant)}
                        onRetry={() => void refreshCart()}
                        onUnavailable={() => notify(text.unavailable)}
                    />
                );
            case 'account':
                return (
                    <AccountPage
                        customer={customer}
                        products={products}
                        market={market}
                        locale={locale}
                        language={language}
                        addingVariantId={addingVariantId}
                        onNavigate={navigate}
                        onAdd={variant => void addToCart(variant)}
                        onUnavailable={() => notify(text.unavailable)}
                        onLogout={() => {
                            void api.logout().then(() => {
                                setCustomer(null);
                                notify(isZh ? '已退出登录' : 'Signed out');
                            });
                        }}
                    />
                );
            case 'product':
                return selectedProduct ? (
                    <ProductDetailPage
                        key={selectedProduct.id}
                        product={selectedProduct}
                        products={products}
                        cartQuantity={cart?.totalQuantity ?? 0}
                        market={market}
                        locale={locale}
                        language={language}
                        addingVariantId={addingVariantId}
                        onBack={goBack}
                        onNavigate={navigate}
                        onAdd={(variant, buyNow) => void addToCart(variant, buyNow)}
                        onUnavailable={() => notify(text.unavailable)}
                    />
                ) : (
                    <Subpage title={isZh ? '商品详情' : 'Product'} onBack={goBack}>
                        <EmptyState
                            icon={<ShoppingBag />}
                            title={text.noResults}
                            detail={text.noResultsHint}
                            action={text.browse}
                            onAction={() => navigate({ name: 'category' })}
                        />
                    </Subpage>
                );
            case 'search':
                return (
                    <SearchPage
                        products={products}
                        market={market}
                        locale={locale}
                        language={language}
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
                        onCartChange={setCart}
                        onNavigate={navigate}
                        onNotify={notify}
                    />
                );
            case 'orders':
                return (
                    <OrdersPage
                        customer={customer}
                        market={market}
                        locale={locale}
                        language={language}
                        initialTab={route.tab ?? 'all'}
                        onBack={goBack}
                        onNavigate={navigate}
                        onBuyAgain={async order => {
                            for (const line of order.lines) await addToCart(line.productVariant);
                            navigate({ name: 'cart' });
                        }}
                        onUnavailable={() => notify(text.unavailable)}
                    />
                );
            case 'order-detail':
                return (
                    <OrderDetailPage
                        order={selectedOrder}
                        market={market}
                        locale={locale}
                        language={language}
                        onBack={goBack}
                        onBuyAgain={async order => {
                            for (const line of order.lines) {
                                await addToCart(line.productVariant);
                            }
                            navigate({ name: 'cart' });
                        }}
                        onUnavailable={() => notify(text.unavailable)}
                    />
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
            case 'login':
                return (
                    <LoginPage
                        api={api}
                        language={language}
                        onBack={goBack}
                        onSuccess={async () => {
                            const [nextCustomer, nextCart] = await Promise.all([
                                api.activeCustomer(),
                                api.cart(),
                            ]);
                            setCustomer(nextCustomer);
                            setCart(nextCart);
                            setCheckoutOrder(nextCart.checkoutOrder);
                            notify(isZh ? '登录成功' : 'Signed in');
                            navigate({ name: 'account' }, true);
                        }}
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
    loading: boolean;
    error: string | null;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    addingVariantId: string | null;
    onNavigate: (route: RouteState) => void;
    onCategorySelect: (collection: CollectionSummary) => void;
    onAdd: (variant: ProductVariant) => void;
    onToggleLanguage: () => void;
    onNotify: () => void;
    onRetry: () => void;
}

function HomePage(props: HomePageProps) {
    const {
        products,
        collections,
        loading,
        error,
        market,
        locale,
        language,
        addingVariantId,
        onNavigate,
        onCategorySelect,
        onAdd,
        onToggleLanguage,
        onNotify,
        onRetry,
    } = props;
    const isZh = language === 'zh';
    const heroProducts = products.slice(0, 2);
    const [heroIndex, setHeroIndex] = useState(0);
    const hero = heroProducts[heroIndex] ?? products[0];
    const heroImage = productImage(hero) ?? '/storefront/default-hero.jpg';
    const quickCollections = collections.slice(0, 3);

    useEffect(() => {
        if (heroProducts.length < 2) return;
        const timer = window.setInterval(
            () => setHeroIndex(index => (index + 1) % heroProducts.length),
            5200,
        );
        return () => window.clearInterval(timer);
    }, [heroProducts.length]);

    useEffect(() => {
        if (heroIndex >= heroProducts.length) setHeroIndex(0);
    }, [heroIndex, heroProducts.length]);

    const quickLinks: Array<{ id: string; label: string; icon: ReactNode; onClick: () => void }> = [
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
        {
            id: 'weekly-edit',
            label: isZh ? '本周精选' : 'Weekly edit',
            icon: <Sparkles />,
            onClick: () => hero && onNavigate({ name: 'product', id: hero.id }),
        },
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
                    <strong>云桥Ai</strong>
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
                    <NoticeButton language={language} onClick={onNotify} />
                </div>
            </header>

            <button className="notice-strip" type="button" onClick={onNotify}>
                <Bell aria-hidden="true" />
                <span>
                    {isZh ? '现货商品配送时效以结算页为准' : 'Delivery timing is confirmed at checkout'}
                </span>
                <ChevronRight aria-hidden="true" />
            </button>

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
                    <section className="hero" aria-label={isZh ? '精选推荐' : 'Featured'}>
                        {heroImage ? (
                            <img src={heroImage} alt={hero?.name ?? ''} />
                        ) : (
                            <div className="image-placeholder">
                                <Sparkles aria-hidden="true" />
                            </div>
                        )}
                        <div className="hero-shade" />
                        <div className="hero-copy">
                            <small>{isZh ? '本周精选' : 'This week'}</small>
                            <h1>{hero?.name ?? (isZh ? '认真挑选每一件好物' : 'Goods chosen with care')}</h1>
                            <p>
                                {trimText(hero?.description, 38) ||
                                    (isZh
                                        ? '从当前店铺在售商品中，为你整理值得关注的选择'
                                        : 'A considered edit of what is available now')}
                            </p>
                            <button
                                type="button"
                                onClick={() => hero && onNavigate({ name: 'product', id: hero.id })}
                            >
                                {isZh ? '查看精选' : 'View selection'}
                                <ChevronRight aria-hidden="true" />
                            </button>
                        </div>
                        {heroProducts.length > 1 && (
                            <div
                                className="hero-pagination"
                                aria-label={isZh ? '轮播广告' : 'Promotion carousel'}
                            >
                                {heroProducts.map((product, index) => (
                                    <button
                                        type="button"
                                        key={product.id}
                                        className={index === heroIndex ? 'is-active' : undefined}
                                        aria-label={isZh ? `第${index + 1}张广告` : `Promotion ${index + 1}`}
                                        aria-current={index === heroIndex}
                                        onClick={() => setHeroIndex(index)}
                                    />
                                ))}
                            </div>
                        )}
                    </section>

                    <nav className="quick-grid" aria-label={isZh ? '快捷分类' : 'Quick categories'}>
                        {quickLinks.map((item, index) => (
                            <button type="button" key={item.id} onClick={item.onClick}>
                                <span data-tone={index % 5}>{item.icon}</span>
                                <b>{item.label}</b>
                            </button>
                        ))}
                    </nav>

                    <button className="benefit-row" type="button" onClick={onNotify}>
                        <TicketPercent aria-hidden="true" />
                        <span>
                            <small>{isZh ? '优惠自动计算' : 'Automatic savings'}</small>
                            <strong>
                                {isZh
                                    ? '可用优惠将在结算时自动抵扣'
                                    : 'Eligible offers apply automatically at checkout'}
                            </strong>
                        </span>
                        <ChevronRight aria-hidden="true" />
                    </button>

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
                    <LegalFooter language={language} onUnavailable={onNotify} />
                </>
            )}
        </main>
    );
}

interface CategoryPageProps {
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
    onFilterChange: (type: 'all' | FulfillmentType, inStock: boolean) => void;
    onNavigate: (route: RouteState) => void;
    onAdd: (variant: ProductVariant) => void;
    onNotify: () => void;
    onRetry: () => void;
}

function CategoryPage(props: CategoryPageProps) {
    const {
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
    const [draftType, setDraftType] = useState(fulfillmentFilter);
    const [draftStock, setDraftStock] = useState(inStockOnly);
    const [minimumPriceInput, setMinimumPriceInput] = useState('');
    const [maximumPriceInput, setMaximumPriceInput] = useState('');
    const [draftMinimumPrice, setDraftMinimumPrice] = useState('');
    const [draftMaximumPrice, setDraftMaximumPrice] = useState('');
    const [visibleLimit, setVisibleLimit] = useState(6);
    const primary = collections.find(item => item.id === activeCollectionId) ?? collections[0];
    const children = primary?.children?.length ? primary.children : primary ? [primary] : [];
    const selectedCollectionId = activeChildId === 'all' ? activeCollectionId : activeChildId;

    const visibleProducts = useMemo(() => {
        const fallbackType =
            !collections.length && (activeCollectionId === 'physical' || activeCollectionId === 'digital')
                ? activeCollectionId
                : 'all';
        const effectiveType = fallbackType === 'all' ? fulfillmentFilter : fallbackType;
        const filtered = products.filter(product => {
            const collectionMatch =
                !collections.length ||
                selectedCollectionId === 'all' ||
                product.collections.some(collection => collection.id === selectedCollectionId);
            const typeMatch =
                effectiveType === 'all' ||
                product.variants.some(variant => variant.customFields.fulfillmentType === effectiveType);
            const stockMatch =
                !inStockOnly || product.variants.some(variant => variant.stockLevel === 'IN_STOCK');
            const price = minimumPrice(product) / 100;
            const minimumMatch = minimumPriceInput === '' || price >= Number(minimumPriceInput);
            const maximumMatch = maximumPriceInput === '' || price <= Number(maximumPriceInput);
            return collectionMatch && typeMatch && stockMatch && minimumMatch && maximumMatch;
        });
        if (sortMode === 'recommended') return filtered;
        if (sortMode === 'newest') {
            return [...filtered].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
        }
        return [...filtered].sort((a, b) => {
            const aPrice = minimumPrice(a);
            const bPrice = minimumPrice(b);
            return sortMode === 'price-asc' ? aPrice - bPrice : bPrice - aPrice;
        });
    }, [
        activeCollectionId,
        collections.length,
        fulfillmentFilter,
        inStockOnly,
        maximumPriceInput,
        minimumPriceInput,
        products,
        selectedCollectionId,
        sortMode,
    ]);

    useEffect(() => {
        setVisibleLimit(6);
    }, [
        activeChildId,
        activeCollectionId,
        fulfillmentFilter,
        inStockOnly,
        maximumPriceInput,
        minimumPriceInput,
        sortMode,
    ]);

    const draftResultCount = products.filter(product => {
        const collectionMatch =
            !collections.length ||
            selectedCollectionId === 'all' ||
            product.collections.some(collection => collection.id === selectedCollectionId);
        const typeMatch =
            draftType === 'all' ||
            product.variants.some(variant => variant.customFields.fulfillmentType === draftType);
        const stockMatch = !draftStock || product.variants.some(variant => variant.stockLevel === 'IN_STOCK');
        const price = minimumPrice(product) / 100;
        const minimumMatch = draftMinimumPrice === '' || price >= Number(draftMinimumPrice);
        const maximumMatch = draftMaximumPrice === '' || price <= Number(draftMaximumPrice);
        return collectionMatch && typeMatch && stockMatch && minimumMatch && maximumMatch;
    }).length;

    const hasFilters =
        fulfillmentFilter !== 'all' || inStockOnly || minimumPriceInput !== '' || maximumPriceInput !== '';

    const bannerImage =
        primary?.featuredAsset?.preview ?? productImage(visibleProducts[0]) ?? '/storefront/default-hero.jpg';

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
                        onClick={() =>
                            visibleProducts[0] && onNavigate({ name: 'product', id: visibleProducts[0].id })
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
                        <span>
                            {isZh ? `共 ${visibleProducts.length} 件` : `${visibleProducts.length} products`}
                        </span>
                        {hasFilters && <b>{isZh ? '已筛选' : 'Filtered'}</b>}
                    </div>
                    <nav className="sort-bar" aria-label={isZh ? '排序和筛选' : 'Sort and filter'}>
                        <button
                            type="button"
                            className={sortMode === 'recommended' ? 'is-active' : undefined}
                            onClick={() => onSortChange('recommended')}
                        >
                            {isZh ? '综合' : 'Default'}
                        </button>
                        <button
                            type="button"
                            disabled
                            title={isZh ? '销量排序需要后台索引支持' : 'Sales ranking needs backend support'}
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

                    {loading ? (
                        <ListSkeleton />
                    ) : error ? (
                        <EmptyState
                            icon={<WifiOff />}
                            title={isZh ? '商品加载失败' : 'Could not load products'}
                            detail={error}
                            action={isZh ? '重试' : 'Retry'}
                            onAction={onRetry}
                            compact
                        />
                    ) : visibleProducts.length ? (
                        <div className="product-list">
                            {visibleProducts.slice(0, visibleLimit).map(product => (
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
                            {visibleProducts.length > visibleLimit && (
                                <button
                                    className="load-more-button"
                                    type="button"
                                    onClick={() => setVisibleLimit(limit => limit + 6)}
                                >
                                    {isZh
                                        ? `加载更多（剩余 ${visibleProducts.length - visibleLimit} 件）`
                                        : `Load more (${visibleProducts.length - visibleLimit} remaining)`}
                                </button>
                            )}
                        </div>
                    ) : (
                        <EmptyState
                            icon={<Search />}
                            title={isZh ? '当前分类没有商品' : 'No products in this category'}
                            detail={
                                isZh
                                    ? '可以切换分类或清除筛选条件'
                                    : 'Choose another category or clear filters'
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
                                    <span>{market.currencyCode === 'CNY' ? '¥' : market.currencyCode}</span>
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
                                    <span>{market.currencyCode === 'CNY' ? '¥' : market.currencyCode}</span>
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
                                            ? `${market.currencyCode === 'CNY' ? '¥' : ''}${minimum}${isZh ? '以上' : '+'}`
                                            : `${market.currencyCode === 'CNY' ? '¥' : ''}${minimum}-${maximum}`}
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
    onNavigate: (route: RouteState) => void;
    onAdd: (variant: ProductVariant) => void;
    onRetry: () => void;
    onUnavailable: () => void;
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
        onNavigate,
        onAdd,
        onRetry,
        onUnavailable,
    } = props;
    const isZh = language === 'zh';
    const lines = cart?.lines ?? [];
    const [invalidOpen, setInvalidOpen] = useState(false);
    const activeLines = lines.filter(line => line.available && line.productVariant);
    const invalidLines = lines.filter(line => !line.available || !line.productVariant);
    const physical = activeLines.filter(
        line => line.productVariant?.customFields.fulfillmentType === 'physical',
    );
    const digital = activeLines.filter(
        line => line.productVariant?.customFields.fulfillmentType === 'digital',
    );
    const order = cart?.checkoutOrder;
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
                        disabled={loading}
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
                                loading={loading}
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
                                loading={loading}
                                onSelect={onSelect}
                                onSelectAll={onSelectGroup}
                                onQuantity={onQuantity}
                                onRemove={onRemove}
                            />
                        )}
                    </div>
                    <button className="coupon-row" type="button" onClick={onUnavailable}>
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
                                      ? '结算时自动计算'
                                      : 'Calculated at checkout'}
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
                                                disabled={loading}
                                            >
                                                {isZh ? '删除' : 'Remove'}
                                            </button>
                                        </article>
                                    ))}
                                </div>
                            )}
                        </section>
                    )}
                    <ProductSection
                        title={isZh ? '顺手带一件' : 'Complete the order'}
                        subtitle={isZh ? '从当前店铺继续挑选' : 'More from this store'}
                        products={products
                            .filter(
                                product =>
                                    !lines.some(line => line.productVariant?.id === product.variants[0]?.id),
                            )
                            .slice(0, 4)}
                        market={market}
                        locale={locale}
                        addingVariantId={addingVariantId}
                        onProduct={product => onNavigate({ name: 'product', id: product.id })}
                        onAdd={onAdd}
                    />
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
                    <button type="button" onClick={onCheckout} disabled={loading || !cart?.selectedQuantity}>
                        {isZh
                            ? `结算（${cart?.selectedQuantity ?? 0}）`
                            : `Checkout (${cart?.selectedQuantity ?? 0})`}
                    </button>
                </div>
            )}
        </main>
    );
}

interface AccountPageProps {
    customer: ActiveCustomer | null;
    products: Product[];
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    addingVariantId: string | null;
    onNavigate: (route: RouteState) => void;
    onAdd: (variant: ProductVariant) => void;
    onUnavailable: () => void;
    onLogout: () => void;
}

function AccountPage(props: AccountPageProps) {
    const {
        customer,
        products,
        market,
        locale,
        language,
        addingVariantId,
        onNavigate,
        onAdd,
        onUnavailable,
        onLogout,
    } = props;
    const isZh = language === 'zh';
    const orders = customer?.orders.items ?? [];
    const counts = {
        pending: orders.filter(order => ['AddingItems', 'ArrangingPayment'].includes(order.state)).length,
        shipping: orders.filter(order => ['PaymentAuthorized', 'PaymentSettled'].includes(order.state))
            .length,
        receiving: orders.filter(order => ['Shipped', 'PartiallyShipped'].includes(order.state)).length,
    };
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
            <header className="topbar account-topbar">
                <strong>{isZh ? '我的' : 'Account'}</strong>
                <div>
                    <button type="button" onClick={onUnavailable} aria-label={isZh ? '联系客服' : 'Support'}>
                        <Headphones />
                    </button>
                    <button type="button" onClick={onUnavailable} aria-label={isZh ? '设置' : 'Settings'}>
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
                    onClick={() => (customer ? onUnavailable() : onNavigate({ name: 'login' }))}
                >
                    <strong>
                        {customer
                            ? isZh
                                ? `${customerName}，你好`
                                : `Hello, ${customerName}`
                            : isZh
                              ? '登录云桥Ai账户'
                              : 'Sign in to Yunqiao Ai'}
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
                        onClick={onUnavailable}
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
                        icon={<RotateCcw />}
                        label={isZh ? '售后记录' : 'After-sales'}
                        onClick={onUnavailable}
                    />
                    <ServiceButton
                        icon={<MessageSquare />}
                        label={isZh ? '联系客服' : 'Support'}
                        onClick={onUnavailable}
                    />
                    <ServiceButton
                        icon={<Store />}
                        label={isZh ? '关于店铺' : 'About store'}
                        onClick={onUnavailable}
                    />
                </div>
            </section>

            <button className="security-row" type="button" onClick={onUnavailable}>
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
            <LegalFooter language={language} onUnavailable={onUnavailable} />
        </main>
    );
}

function ProductDetailPage({
    product,
    products,
    cartQuantity,
    market,
    locale,
    language,
    addingVariantId,
    onBack,
    onNavigate,
    onAdd,
    onUnavailable,
}: {
    product: Product;
    products: Product[];
    cartQuantity: number;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    addingVariantId: string | null;
    onBack: () => void;
    onNavigate: (route: RouteState) => void;
    onAdd: (variant: ProductVariant, buyNow?: boolean) => void;
    onUnavailable: () => void;
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

    return (
        <main className="page subpage product-detail-page">
            <SubHeader
                title={isZh ? '商品详情' : 'Product details'}
                onBack={onBack}
                action={
                    <button type="button" onClick={onUnavailable} aria-label={isZh ? '分享' : 'Share'}>
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
                <button type="button" onClick={onUnavailable}>
                    <span>{isZh ? '优惠' : 'Offers'}</span>
                    <strong>
                        <TicketPercent />
                        {isZh ? '可用优惠将在结算时自动抵扣' : 'Eligible offers apply automatically'}
                    </strong>
                    <ChevronRight />
                </button>
                <button type="button" onClick={onUnavailable}>
                    <span>{isZh ? '活动' : 'Activity'}</span>
                    <strong>
                        {isZh ? '店铺活动以结算页展示为准' : 'Store promotions are confirmed at checkout'}
                    </strong>
                    <ChevronRight />
                </button>
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
            <button className="detail-info-row" type="button" onClick={onUnavailable}>
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
                <ChevronRight />
            </button>
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
                        <strong>云桥Ai</strong>
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
                <button type="button" onClick={onUnavailable}>
                    <Headphones />
                    <span>{isZh ? '客服' : 'Support'}</span>
                </button>
                <button type="button" onClick={onUnavailable}>
                    <Heart />
                    <span>{isZh ? '收藏' : 'Save'}</span>
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
    products,
    market,
    locale,
    language,
    addingVariantId,
    onBack,
    onNavigate,
    onAdd,
}: {
    products: Product[];
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    addingVariantId: string | null;
    onBack: () => void;
    onNavigate: (route: RouteState) => void;
    onAdd: (variant: ProductVariant) => void;
}) {
    const isZh = language === 'zh';
    const [query, setQuery] = useState('');
    const [submittedQuery, setSubmittedQuery] = useState('');
    const [resultSort, setResultSort] = useState<'recommended' | 'newest' | 'price'>('recommended');
    const [history, setHistory] = useState<string[]>(() => {
        try {
            return JSON.parse(localStorage.getItem('storefront-search-history') ?? '[]') as string[];
        } catch {
            return [];
        }
    });
    const results = useMemo(() => {
        const value = submittedQuery.trim().toLocaleLowerCase(locale);
        if (!value) return [];
        const matches = products.filter(product =>
            [
                product.name,
                product.description,
                ...product.variants.flatMap(variant => [variant.name, variant.sku]),
            ]
                .join(' ')
                .toLocaleLowerCase(locale)
                .includes(value),
        );
        if (resultSort === 'newest')
            return [...matches].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
        if (resultSort === 'price') return [...matches].sort((a, b) => minimumPrice(a) - minimumPrice(b));
        return matches;
    }, [locale, products, resultSort, submittedQuery]);
    const popularSearches = products.slice(0, 6);
    const relatedProducts = products
        .filter(product => !results.some(result => result.id === product.id))
        .slice(0, 2);
    const submit = (value = query) => {
        const next = value.trim();
        if (!next) return;
        setQuery(next);
        setSubmittedQuery(next);
        const nextHistory = [next, ...history.filter(item => item !== next)].slice(0, 8);
        setHistory(nextHistory);
        localStorage.setItem('storefront-search-history', JSON.stringify(nextHistory));
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
                                        localStorage.removeItem('storefront-search-history');
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
                        <span>{results.length}</span>
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
                            className={resultSort === 'newest' ? 'is-active' : undefined}
                            onClick={() => setResultSort('newest')}
                        >
                            {isZh ? '最新' : 'Newest'}
                        </button>
                        <button
                            type="button"
                            className={resultSort === 'price' ? 'is-active' : undefined}
                            onClick={() => setResultSort('price')}
                        >
                            {isZh ? '价格' : 'Price'}
                        </button>
                    </nav>
                    {results.length ? (
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
                    {!!relatedProducts.length && (
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
}) {
    const isZh = language === 'zh';
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [shippingMethods, setShippingMethods] = useState<ShippingMethod[]>([]);
    const [selectedShippingId, setSelectedShippingId] = useState('');
    const defaultAddress =
        customer?.addresses?.find(address => address.defaultShippingAddress) ?? customer?.addresses?.[0];
    const requiresShipping =
        order?.checkoutFulfillment?.requiresShippingAddress ??
        order?.lines.some(line => line.productVariant.customFields.fulfillmentType === 'physical');
    const physicalLines =
        order?.lines.filter(line => line.productVariant.customFields.fulfillmentType === 'physical') ?? [];
    const digitalLines =
        order?.lines.filter(line => line.productVariant.customFields.fulfillmentType === 'digital') ?? [];

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!cart || !order) return;
        const data = new FormData(event.currentTarget);
        setSubmitting(true);
        setFormError(null);
        try {
            if (!customer) {
                await api.setCustomer({
                    firstName: String(data.get('firstName') ?? ''),
                    lastName: String(data.get('lastName') ?? ''),
                    emailAddress: String(data.get('emailAddress') ?? ''),
                });
            }
            if (requiresShipping) {
                await api.setShippingAddress({
                    fullName: String(data.get('fullName') ?? ''),
                    phoneNumber: String(data.get('phoneNumber') ?? ''),
                    streetLine1: String(data.get('streetLine1') ?? ''),
                    city: String(data.get('city') ?? ''),
                    province: String(data.get('province') ?? ''),
                    postalCode: String(data.get('postalCode') ?? ''),
                    countryCode: market.countryCode,
                });
                let methods = shippingMethods;
                if (!methods.length) {
                    methods = await api.eligibleShippingMethods();
                    setShippingMethods(methods);
                }
                const shippingId = selectedShippingId || methods[0]?.id;
                if (!shippingId)
                    throw new Error(isZh ? '当前地址没有可用配送方式' : 'No shipping method is available');
                await api.setShippingMethod(shippingId);
            }
            const session = await api.preparePayment(cart.revision);
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
            <form className="checkout-form" onSubmit={event => void submit(event)}>
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
                    {requiresShipping && (
                        <button
                            type="button"
                            onClick={() =>
                                onNotify(
                                    isZh
                                        ? '提交订单时将匹配当前地址可用的配送方案'
                                        : 'A delivery option is matched when placing the order',
                                )
                            }
                        >
                            <span>{isZh ? '配送方式' : 'Delivery'}</span>
                            <small>
                                {shippingMethods.find(method => method.id === selectedShippingId)?.name ??
                                    (isZh ? '自动匹配可用方案' : 'Matched automatically')}
                                <ChevronRight />
                            </small>
                        </button>
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
                    <button
                        type="button"
                        onClick={() =>
                            onNotify(isZh ? '订单备注需要后台字段支持' : 'Order notes need backend support')
                        }
                    >
                        <span>{isZh ? '订单备注' : 'Order note'}</span>
                        <small>
                            {isZh ? '暂未开通' : 'Not available'}
                            <ChevronRight />
                        </small>
                    </button>
                    <button
                        type="button"
                        onClick={() =>
                            onNotify(
                                isZh ? '可用优惠已自动计算' : 'Eligible offers are calculated automatically',
                            )
                        }
                    >
                        <span>{isZh ? '优惠券' : 'Coupon'}</span>
                        <small>
                            {isZh ? '自动计算可用优惠' : 'Available offers are automatic'}
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
                        {submitting ? (isZh ? '提交中' : 'Submitting') : isZh ? '提交订单' : 'Submit order'}
                    </button>
                </div>
            </form>
        </main>
    );
}

function OrdersPage({
    customer,
    market,
    locale,
    language,
    initialTab,
    onBack,
    onNavigate,
    onBuyAgain,
    onUnavailable,
}: {
    customer: ActiveCustomer | null;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    initialTab: OrderTab;
    onBack: () => void;
    onNavigate: (route: RouteState) => void;
    onBuyAgain: (order: Order) => Promise<void>;
    onUnavailable: () => void;
}) {
    const isZh = language === 'zh';
    const [tab, setTab] = useState<OrderTab>(initialTab);
    const orders = (customer?.orders.items ?? []).filter(order => orderMatchesTab(order, tab));
    const tabs: Array<{ id: OrderTab; label: string }> = [
        { id: 'all', label: isZh ? '全部' : 'All' },
        { id: 'pending', label: isZh ? '待付款' : 'To pay' },
        { id: 'shipping', label: isZh ? '待发货' : 'To ship' },
        { id: 'receiving', label: isZh ? '待收货' : 'To receive' },
        { id: 'service', label: isZh ? '售后' : 'After-sales' },
    ];
    return (
        <main className="page subpage orders-page">
            <SubHeader
                title={isZh ? '我的订单' : 'My orders'}
                onBack={onBack}
                action={
                    <button
                        type="button"
                        onClick={onUnavailable}
                        aria-label={isZh ? '搜索订单' : 'Search orders'}
                    >
                        <Search />
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
            ) : orders.length ? (
                <div className="order-list">
                    {orders.map(order => (
                        <OrderCard
                            key={order.id}
                            order={order}
                            market={market}
                            locale={locale}
                            language={language}
                            onOpen={() => onNavigate({ name: 'order-detail', id: order.id })}
                            onBuyAgain={() => void onBuyAgain(order)}
                            onMore={onUnavailable}
                        />
                    ))}
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
    onBack,
    onBuyAgain,
    onUnavailable,
}: {
    order: Order | null;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    onBack: () => void;
    onBuyAgain: (order: Order) => Promise<void>;
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
            <SubHeader
                title={isZh ? '订单详情' : 'Order details'}
                onBack={onBack}
                action={
                    <button type="button" onClick={onUnavailable} aria-label={isZh ? '联系客服' : 'Support'}>
                        <Headphones />
                    </button>
                }
            />
            <section className="order-status">
                <strong>{orderStateLabel(order.state, language)}</strong>
                <span>{statusHint}</span>
                <small>{isZh ? `订单号 ${order.code}` : `Order ${order.code}`}</small>
            </section>
            {inTransit && (
                <section className="order-logistics">
                    <Navigation />
                    <span>
                        <strong>{isZh ? '物流运输中' : 'In transit'}</strong>
                        <small>
                            {isZh
                                ? '物流详情将在承运商更新后显示'
                                : 'Updates appear when provided by the carrier'}
                        </small>
                    </span>
                    <ChevronRight />
                </section>
            )}
            <section className="order-detail-products">
                <header>
                    <strong>云桥Ai</strong>
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
                <button type="button" onClick={onUnavailable}>
                    {isZh ? '更多' : 'More'}
                </button>
                <button
                    type="button"
                    className="primary-action"
                    onClick={pending || inTransit ? onUnavailable : () => void onBuyAgain(order)}
                >
                    {pending
                        ? isZh
                            ? '继续支付'
                            : 'Continue payment'
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
    const create = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setSubmitting(true);
        setFormError('');
        try {
            await api.createAddress({
                fullName: String(data.get('fullName')),
                phoneNumber: String(data.get('phoneNumber')),
                province: String(data.get('province')),
                city: String(data.get('city')),
                streetLine1: String(data.get('streetLine1')),
                postalCode: String(data.get('postalCode')),
                countryCode: market.countryCode,
                defaultShippingAddress: customer.addresses?.length === 0,
            });
            onCustomerChange(await api.activeCustomer());
            setOpen(false);
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
    return (
        <main className="page subpage addresses-page">
            <SubHeader
                title={isZh ? '地址管理' : 'Addresses'}
                onBack={onBack}
                action={
                    <button
                        type="button"
                        onClick={() => setOpen(true)}
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
                                <button type="button" onClick={() => void remove(address.id)}>
                                    <Trash2 />
                                    {isZh ? '删除' : 'Delete'}
                                </button>
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
                    onAction={() => setOpen(true)}
                />
            )}
            {open && (
                <Sheet title={isZh ? '新增收货地址' : 'Add address'} onClose={() => setOpen(false)}>
                    <form className="address-form" onSubmit={event => void create(event)}>
                        <Field name="fullName" label={isZh ? '收货人' : 'Full name'} required wide />
                        <Field name="phoneNumber" label={isZh ? '手机号' : 'Phone'} required wide />
                        <Field name="province" label={isZh ? '省/州' : 'Province'} required />
                        <Field name="city" label={isZh ? '城市' : 'City'} required />
                        <Field
                            name="streetLine1"
                            label={isZh ? '详细地址' : 'Street address'}
                            required
                            wide
                        />
                        <Field name="postalCode" label={isZh ? '邮政编码' : 'Postal code'} required wide />
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
    onBack,
    onSuccess,
}: {
    api: ShopApi;
    language: StorefrontLanguage;
    onBack: () => void;
    onSuccess: () => Promise<void>;
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
                <span className="login-brand">云桥Ai</span>
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
                    {error && <small className="form-error">{error}</small>}
                    <button className="primary-action wide-action" type="submit" disabled={submitting}>
                        {submitting ? (isZh ? '登录中' : 'Signing in') : isZh ? '登录' : 'Sign in'}
                    </button>
                </form>
                <small>
                    {isZh
                        ? '登录即代表你同意服务条款和隐私政策'
                        : 'By signing in, you agree to the terms and privacy policy'}
                </small>
            </section>
        </main>
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
            <button className="product-card-image" type="button" onClick={onOpen}>
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
                    aria-label={`Add ${product.name}`}
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
            <button type="button" className="product-row-image" onClick={onOpen}>
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
    onOpen,
    onBuyAgain,
    onMore,
}: {
    order: Order;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    onOpen: () => void;
    onBuyAgain: () => void;
    onMore: () => void;
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
                    <strong>云桥Ai</strong>
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
                    <button type="button" onClick={onMore}>
                        {isZh ? '更多' : 'More'}
                    </button>
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
            <b />
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
    language,
    onUnavailable,
}: {
    language: StorefrontLanguage;
    onUnavailable: () => void;
}) {
    const isZh = language === 'zh';
    return (
        <footer className="legal-footer">
            <span>云桥Ai</span>
            <nav>
                <button type="button" onClick={onUnavailable}>
                    {isZh ? '隐私政策' : 'Privacy'}
                </button>
                <button type="button" onClick={onUnavailable}>
                    {isZh ? '服务条款' : 'Terms'}
                </button>
            </nav>
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
function orderMatchesTab(order: Order, tab: OrderTab): boolean {
    if (tab === 'all') return true;
    if (tab === 'pending') return ['AddingItems', 'ArrangingPayment'].includes(order.state);
    if (tab === 'shipping') return ['PaymentAuthorized', 'PaymentSettled'].includes(order.state);
    if (tab === 'receiving') return ['Shipped', 'PartiallyShipped'].includes(order.state);
    return false;
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
