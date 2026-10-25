import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    Outlet,
    RouterProvider,
} from '@tanstack/react-router';
import { ShoppingBag } from 'lucide-react';
import { StrictMode, Suspense } from 'react';

import { ShopApi } from './api';
import { storefrontNavigationCollections } from './api/catalog';
import { catalogRouteState, resolveCategoryRoute } from './catalog-route-query';
import { BottomNavigation, shouldShowBottomNavigation } from './components/common/bottom-navigation';
import { DesktopLayoutContext } from './desktop-layout';
import { normalizeHeroAutoplayIntervalSeconds } from './hero-carousel';
import { buildBestSellerProducts } from './home-merchandising';
import { localeFor, marketForStorefrontConfig } from './i18n';
import { OverlayHost } from './overlay-host';
import { PageReadinessBoundary } from './page-readiness';
import { asListProduct } from './product-summary';
import { publicRouteRewrite, storefrontRouterSearch } from './public-route-rewrite';
import { PageSkeleton, pageSkeletonVariantForPathname } from './route-loading';
import { isBrowsingStorefrontRoute } from './storefront-access';
import {
    BusinessServicesPageContext,
    CategoryPageContext,
    HomePageContext,
    ProductDetailPageContext,
    SearchPageContext,
    SupportPageContext,
} from './storefront-page-contexts';
import { seedPublicPage, type PublicPageData } from './storefront-page-data';
import { StorefrontPageFrame } from './storefront-page-frame';
import { routeFromRouterLocation, routeHref, type RouteState } from './storefront-router';
import { EmptyState, Subpage } from './storefront-ui/page-shell';
import {
    contentNumberSetting,
    contentStringArraySetting,
    DEFAULT_STOREFRONT_NAMES,
    normalizeStorefrontName,
} from './storefront-utils';
import { StorefrontErrorBoundary } from './StorefrontErrorBoundary';
import { type StorefrontContentTargetType, type StorefrontFlashSale, type StorefrontLanguage } from './types';

type SnapshotComponents = {
    BusinessServicesPage?: (typeof import('./pages/business-services-page'))['BusinessServicesPage'];
    CategoryPage?: (typeof import('./pages/category-page'))['CategoryPage'];
    GuideContent?: (typeof import('./pages/guide-page'))['GuideContent'];
    HomePage?: (typeof import('./pages/home-page'))['HomePage'];
    ManagedLegalPage?: (typeof import('./pages/legal-page'))['ManagedLegalPage'];
    ProductDetailPage?: (typeof import('./pages/product-detail-page'))['ProductDetailPage'];
    SupportPage?: (typeof import('./pages/support-page'))['SupportPage'];
    SearchPage?: (typeof import('./pages/search-page'))['SearchPage'];
};

async function loadSnapshotComponents(page: PublicPageData): Promise<SnapshotComponents> {
    const request = page.request;
    if (request?.kind === 'article') return import('./pages/guide-page');
    if (request?.kind === 'product') return import('./pages/product-detail-page');
    if (request?.kind === 'catalog')
        return request.path === '/search' ? import('./pages/search-page') : import('./pages/category-page');
    if (request?.kind === 'page' && request.id === 'services')
        return import('./pages/business-services-page');
    if (request?.kind === 'page' && request.id === 'support') return import('./pages/support-page');
    if (request?.kind === 'page') return import('./pages/legal-page');
    return import('./pages/home-page');
}

function requiredComponent<T>(component: T | undefined): T {
    if (!component) throw new Error('Missing public snapshot component');
    return component;
}

const idle = () => undefined;

/** The existing public page components consume the same anonymous facts on the server and browser. */
function SnapshotPage({ page, components }: { page: PublicPageData; components: SnapshotComponents }) {
    const config = page.config;
    const language: StorefrontLanguage = page.scope.languageCode === 'zh_Hans' ? 'zh' : 'en';
    const market = { ...marketForStorefrontConfig(config), currencyCode: page.scope.currencyCode };
    const locale = localeFor(language, market);
    const storefrontName = normalizeStorefrontName(
        language === 'zh' ? config.customFields.storefrontNameZh : config.customFields.storefrontNameEn,
        DEFAULT_STOREFRONT_NAMES[language],
    );
    const contentBlocks = page.content?.blocks ?? [];
    const products = page.products?.map(asListProduct) ?? [];
    const bestSellersBlock = contentBlocks.find(block => block.type === 'BEST_SELLERS');
    const bestSellerProducts = page.bestSellers
        ? buildBestSellerProducts({
              candidates: [...page.bestSellers.catalog.items, ...page.bestSellers.pinnedProducts].map(
                  asListProduct,
              ),
              pinnedProducts: page.bestSellers.pinnedProducts.map(asListProduct),
              salesByProductId: page.bestSellers.salesByProductId,
              count: Math.min(
                  50,
                  Math.max(1, contentNumberSetting(bestSellersBlock?.settings?.displayCount, 4)),
              ),
              seed: `${page.scope.channelCode}:${new Date(page.generatedAt).toISOString().slice(0, 10)}:best-sellers`,
          })
        : [];
    const collections = storefrontNavigationCollections(page.collections ?? []);
    const logoUrl = config.logoUrl ?? null;
    const currencies = config.currencyConfiguration;
    const settlementCurrencies = currencies?.availableCurrencyCodes.length
        ? currencies.availableCurrencyCodes
        : [config.defaultCurrencyCode];
    // No request is issued during rendering. After hydration, the normal runtime owns all commands.
    const api = new ShopApi(market, page.scope.languageCode as 'en' | 'zh_Hans');
    const common = {
        language,
        storefrontName,
        logoUrl,
        contentBlocks,
        displayCurrencyCode: page.scope.currencyCode,
        availableCurrencyCodes: [
            ...settlementCurrencies,
            ...(currencies?.usdtDisplayEnabled &&
            currencies.usdtRateAvailable &&
            currencies.usdtPaymentConfigured
                ? ['USDT']
                : []),
        ],
        currencyLoading: false,
        onToggleLanguage: idle,
        onCurrencyChange: idle,
        onNotifications: idle,
        onContentTarget: (_type: StorefrontContentTargetType, _value: string | null) => undefined,
    };
    const request = page.request;
    const route = resolveCategoryRoute(snapshotRoute(page), collections);
    let body;
    if (request?.kind === 'article' && page.publicContent) {
        const GuideContent = requiredComponent(components.GuideContent);
        body = <GuideContent content={page.publicContent} language={language} />;
    } else if (request?.kind === 'article') {
        body = (
            <Subpage
                title={language === 'zh' ? '选购与使用指南' : 'Guides'}
                language={language}
                onBack={idle}
            >
                <div className="empty-state" role="status">
                    <p>{language === 'zh' ? '没有找到已发布的指南' : 'Published guide not found'}</p>
                </div>
            </Subpage>
        );
    } else if (request?.kind === 'product' && !page.product) {
        body = (
            <Subpage title={language === 'zh' ? '商品详情' : 'Product'} language={language} onBack={idle}>
                <EmptyState
                    icon={<ShoppingBag />}
                    title={language === 'zh' ? '没有找到商品' : 'Product not found'}
                    action={language === 'zh' ? '去逛商品' : 'Browse'}
                    onAction={idle}
                />
            </Subpage>
        );
    } else if (request?.kind === 'product' && page.product) {
        const ProductDetailPage = requiredComponent(components.ProductDetailPage);
        body = (
            <ProductDetailPageContext.Provider
                value={{
                    api,
                    product: page.product,
                    products,
                    cartQuantity: 0,
                    market,
                    locale,
                    language,
                    storefrontName,
                    logoUrl,
                    reviewEnabled: false,
                    supportContent: contentBlocks.find(block => block.type === 'SUPPORT'),
                    initialVariantId: route.variantId,
                    initialQuantity: route.quantity,
                    flashSaleItems: ((page.flashSales as StorefrontFlashSale[]) ?? []).flatMap(
                        sale => sale.items,
                    ),
                    couponCampaigns: [],
                    customerCoupons: [],
                    addingVariantId: null,
                    favorite: false,
                    onAdd: idle,
                    onBuyNow: idle,
                    onFavorite: idle,
                    onNotify: idle,
                }}
            >
                <ProductDetailPage />
            </ProductDetailPageContext.Provider>
        );
    } else if (request?.kind === 'catalog' && request.path === '/search') {
        const SearchPage = requiredComponent(components.SearchPage);
        body = (
            <SearchPageContext.Provider
                value={{
                    api,
                    contextResolved: true,
                    products,
                    collections,
                    market,
                    locale,
                    language,
                    storefrontCode: config.code,
                    initialQuery: route.term ?? '',
                    initialFilters: catalogRouteState(route),
                }}
            >
                <SearchPage />
            </SearchPageContext.Provider>
        );
    } else if (request?.kind === 'catalog') {
        const CategoryPage = requiredComponent(components.CategoryPage);
        const input = request.input;
        body = (
            <CategoryPageContext.Provider
                value={{
                    api,
                    products,
                    collections,
                    contentBlocks,
                    storefrontName,
                    loading: false,
                    contextResolved: true,
                    error: null,
                    market,
                    locale,
                    language,
                    activeCollectionId: route.collectionId ?? input.collectionId ?? 'all',
                    activeChildId: route.childId ?? 'all',
                    sortMode:
                        input.sort === 'PRICE_ASC'
                            ? 'price-asc'
                            : input.sort === 'PRICE_DESC'
                              ? 'price-desc'
                              : input.sort === 'SALES'
                                ? 'sales'
                                : input.sort === 'NEWEST'
                                  ? 'newest'
                                  : input.sort === 'NAME'
                                    ? 'name'
                                    : 'recommended',
                    fulfillmentFilter:
                        (input.fulfillmentType?.toLowerCase() as 'physical' | 'digital' | undefined) ?? 'all',
                    inStockOnly: input.inStockOnly ?? false,
                    minimumPrice: input.minPriceWithTax == null ? '' : String(input.minPriceWithTax / 100),
                    maximumPrice: input.maxPriceWithTax == null ? '' : String(input.maxPriceWithTax / 100),
                    page: Math.floor((input.skip ?? 0) / (input.take ?? 12)) + 1,
                    onCollectionChange: idle,
                    onChildChange: idle,
                    onSortChange: idle,
                    onFilterChange: idle,
                    onNotify: idle,
                    onRetry: idle,
                }}
            >
                <CategoryPage />
            </CategoryPageContext.Provider>
        );
    } else if (request?.kind === 'page' && request.id === 'services') {
        const BusinessServicesPage = requiredComponent(components.BusinessServicesPage);
        body = (
            <BusinessServicesPageContext.Provider
                value={{
                    ...common,
                    availableCurrencyCodes: config.currencyConfiguration?.selectorEnabled
                        ? common.availableCurrencyCodes
                        : [],
                    marketLabel: market.label,
                    onNavigate: (_route: RouteState) => undefined,
                }}
            >
                <BusinessServicesPage />
            </BusinessServicesPageContext.Provider>
        );
    } else if (request?.kind === 'page' && request.id === 'support') {
        const SupportPage = requiredComponent(components.SupportPage);
        body = (
            <SupportPageContext.Provider
                value={{
                    api,
                    customer: null,
                    language,
                    content: contentBlocks.find(block => block.type === 'SUPPORT'),
                    orderCode: route.orderCode,
                    focus: route.focus,
                    onNotify: idle,
                    onSignIn: idle,
                }}
            >
                <SupportPage />
            </SupportPageContext.Provider>
        );
    } else if (request?.kind === 'page') {
        const ManagedLegalPage = requiredComponent(components.ManagedLegalPage);
        body = (
            <ManagedLegalPage
                kind={request.id === 'privacy' ? 'privacy' : 'terms'}
                language={language}
                storefrontName={storefrontName}
                contentBlocks={contentBlocks}
                legalIdentity={{
                    legalEntityName: config.legalEntityName ?? null,
                    legalRegistrationCountry: config.legalRegistrationCountry ?? null,
                    legalRegistrationNumber: config.legalRegistrationNumber,
                    legalContactAddress: config.legalContactAddress,
                    supportEmail: config.supportEmail ?? null,
                    privacyEmail: config.privacyEmail ?? null,
                }}
                storefrontHostname={new URL(`https://${page.scope.host}`).hostname}
                onBack={idle}
                onSelectDocument={idle}
            />
        );
    } else {
        const HomePage = requiredComponent(components.HomePage);
        const managedIds = snapshotManagedProductIds(page);
        const managedResolved =
            managedIds.length > 0 && managedIds.every(id => products.some(product => product.id === id));
        body = (
            <HomePageContext.Provider
                value={{
                    ...common,
                    products,
                    collections,
                    managedContentProducts: managedResolved
                        ? managedIds.flatMap(id => products.filter(product => product.id === id))
                        : [],
                    responsiveIntro: true,
                    managedContentResolved: managedResolved,
                    managedContentLoading: managedIds.length > 0 && !managedResolved,
                    heroAutoplayIntervalSeconds: normalizeHeroAutoplayIntervalSeconds(
                        page.content?.settings?.heroAutoplayIntervalSeconds ?? 5,
                    ),
                    configuredBlockTypes: page.content?.settings?.configuredBlockTypes ?? [],
                    coupons: [],
                    couponCampaignsLoading: contentBlocks.some(
                        block => block.type === 'COUPONS' && block.enabled,
                    ),
                    couponCampaignsError: '',
                    flashSales: (page.flashSales as StorefrontFlashSale[]) ?? [],
                    systemAnnouncements: page.content?.systemAnnouncements ?? [],
                    initialRenderTime: page.generatedAt,
                    bestSellerProducts,
                    bestSellersLoading:
                        !page.bestSellers &&
                        (contentBlocks.some(block => block.type === 'BEST_SELLERS') ||
                            !page.content?.settings?.configuredBlockTypes?.includes('BEST_SELLERS')),
                    recommendationsLoading:
                        contentBlocks.some(block => block.type === 'RECOMMENDATIONS') ||
                        !page.content?.settings?.configuredBlockTypes?.includes('RECOMMENDATIONS'),
                    recommendationProducts: [],
                    contentError: '',
                    loading: false,
                    error: null,
                    catalogLoading: false,
                    catalogError: null,
                    market,
                    locale,
                    storefrontDescription: config.description?.trim() ?? '',
                    storefrontTagline: config.tagline?.trim() ?? '',
                    storefrontNameAliases: [
                        config.customFields.storefrontNameZh ?? '',
                        config.customFields.storefrontNameEn ?? '',
                    ],
                    logoOnLightUrl: config.logoOnLightUrl ?? null,
                    couponLoading: false,
                    currencySelectorEnabled: config.currencyConfiguration?.selectorEnabled ?? false,
                    onCategorySelect: idle,
                    onClaimCoupon: () => Promise.resolve(null),
                    onCouponCampaignsRetry: idle,
                    onContentRetry: idle,
                    onRetry: idle,
                }}
            >
                <HomePage />
            </HomePageContext.Provider>
        );
    }
    return body;
}

function snapshotRoute(page: PublicPageData): RouteState {
    const url = publicRouteRewrite.input({ url: new URL(page.route, `https://${page.scope.host}`) });
    return routeFromRouterLocation(url.pathname, Object.fromEntries(url.searchParams));
}

function snapshotManagedProductIds(page: PublicPageData): string[] {
    return Array.from(
        new Set(
            (page.content?.blocks ?? []).flatMap(block => [
                ...contentStringArraySetting(block.settings?.selectedProductIds),
                ...contentStringArraySetting(block.settings?.pinnedProductIds),
                ...(block.targetType === 'PRODUCT' && block.targetValue ? [block.targetValue] : []),
                ...block.items.flatMap(item =>
                    item.targetType === 'PRODUCT' && item.targetValue ? [item.targetValue] : [],
                ),
            ]),
        ),
    );
}

/** Anonymous facts render the same persistent shell; browser hooks run only in the real App. */
function SnapshotShell({ page }: { page: PublicPageData }) {
    const route = snapshotRoute(page);
    const language: StorefrontLanguage = page.scope.languageCode === 'zh_Hans' ? 'zh' : 'en';
    const storefrontName = normalizeStorefrontName(
        language === 'zh'
            ? page.config.customFields.storefrontNameZh
            : page.config.customFields.storefrontNameEn,
        DEFAULT_STOREFRONT_NAMES[language],
    );
    const navigation = page.content?.blocks.find(block => block.type === 'NAVIGATION');
    // Review settings are resolved after startup in the interactive runtime.
    const navigationBlock = navigation
        ? {
              ...navigation,
              items: navigation.items.filter(item => item.targetValue !== '/reviews'),
          }
        : undefined;
    const identity = JSON.stringify([
        page.config.code,
        page.scope.channelCode,
        page.scope.currencyCode,
        null,
        language,
        routeHref(route),
    ]);
    return (
        <>
            <DesktopLayoutContext.Provider value={false}>
                <OverlayHost ownerKey={identity}>
                    <PageReadinessBoundary
                        initialScopeKey={page.scope.channelCode}
                        requireInitialRouteCommit
                        requestKey={identity}
                        navigationKey={identity}
                        pending={false}
                        online
                        language={language}
                        onRetry={idle}
                        onBack={idle}
                    >
                        <StorefrontPageFrame
                            routeName={route.name}
                            language={language}
                            desktop={false}
                            accessMode={page.config.accessMode}
                            storefrontName={storefrontName}
                            logoUrl={page.config.logoUrl ?? null}
                            displayCurrencyCode={page.scope.currencyCode}
                            navigationBlock={navigationBlock}
                            publicMedia={page.media}
                            publicMediaScope={JSON.stringify([
                                page.scope.channelCode,
                                page.scope.currencyCode,
                                language,
                            ])}
                        >
                            <Suspense
                                fallback={
                                    <PageSkeleton
                                        variant={pageSkeletonVariantForPathname(routeHref(route))}
                                        language={language}
                                        root
                                    />
                                }
                            >
                                <Outlet />
                            </Suspense>
                            {null /* The client reserves this sibling for an embedded preview. */}
                        </StorefrontPageFrame>
                        {isBrowsingStorefrontRoute(route.name) &&
                            shouldShowBottomNavigation(route.name, navigationBlock) && (
                                <BottomNavigation
                                    activeRoute={route.name}
                                    cartQuantity={undefined}
                                    language={language}
                                    navigationBlock={navigationBlock}
                                    onNavigate={idle}
                                />
                            )}
                        {null /* The client owns toast feedback in this sibling. */}
                        <OverlayHost
                            ownerKey={JSON.stringify([
                                'authentication',
                                page.config.code,
                                page.scope.channelCode,
                                page.scope.currencyCode,
                                routeHref(route),
                            ])}
                        >
                            {null}
                        </OverlayHost>
                        {null /* Deferred traffic preferences are absent during both first renders. */}
                    </PageReadinessBoundary>
                </OverlayHost>
            </DesktopLayoutContext.Provider>
            <Suspense fallback={null}>{null}</Suspense>
        </>
    );
}

/** Server-only entry: the client never mounts this router or creates its cache. */
export async function createPublicSnapshotApp(page: PublicPageData) {
    const components = await loadSnapshotComponents(page);
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    seedPublicPage(queryClient, page);
    const root = createRootRoute({
        component: () => <SnapshotShell page={page} />,
    });
    const pathname = publicRouteRewrite.input({
        url: new URL(page.route, `https://${page.scope.host}`),
    }).pathname;
    const child = createRoute({
        getParentRoute: () => root,
        path: pathname.startsWith('/guides/') ? '/guides/$slug' : pathname,
        component: () => <SnapshotPage page={page} components={components} />,
    });
    const router = createRouter({
        routeTree: root.addChildren([child]),
        isServer: true,
        history: createMemoryHistory({ initialEntries: [page.route] }),
        rewrite: publicRouteRewrite,
        ...storefrontRouterSearch,
        defaultPendingComponent: () => (
            <PageSkeleton variant={pageSkeletonVariantForPathname(routeHref(snapshotRoute(page)))} root />
        ),
    });
    router.ssr = { manifest: undefined };
    await router.load();
    const element = (
        <StrictMode>
            <QueryClientProvider client={queryClient}>
                <StorefrontErrorBoundary>
                    <RouterProvider router={router} />
                </StorefrontErrorBoundary>
            </QueryClientProvider>
        </StrictMode>
    );
    return { element, router, dispose: () => queryClient.clear() };
}
