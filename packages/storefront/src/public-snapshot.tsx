import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    RouterProvider,
} from '@tanstack/react-router';
import { useEffect } from 'react';

import { ShopApi } from './api';
import { DesktopLayoutContext } from './desktop-layout';
import { localeFor, marketForStorefrontConfig } from './i18n';
import { BusinessServicesPage } from './pages/business-services-page';
import { CategoryPage } from './pages/category-page';
import { GuideContent } from './pages/guide-page';
import { HomePage } from './pages/home-page';
import { ManagedLegalPage } from './pages/legal-page';
import { ProductDetailPage } from './pages/product-detail-page';
import { SupportPage } from './pages/support-page';
import { publicRouteRewrite } from './public-route-rewrite';
import {
    BusinessServicesPageContext,
    CategoryPageContext,
    HomePageContext,
    ProductDetailPageContext,
    SupportPageContext,
} from './storefront-page-contexts';
import { seedPublicPage, type PublicPageData } from './storefront-page-data';
import { type RouteState } from './storefront-router';
import { type StorefrontContentTargetType, type StorefrontFlashSale, type StorefrontLanguage } from './types';

const idle = () => undefined;

/** The existing public page components consume the same anonymous facts on the server and browser. */
function SnapshotPage({ page, onReady }: { page: PublicPageData; onReady?: () => void }) {
    useEffect(() => {
        onReady?.();
    }, [onReady]);
    const config = page.config;
    const language: StorefrontLanguage = page.scope.languageCode === 'zh_Hans' ? 'zh' : 'en';
    const market = { ...marketForStorefrontConfig(config), currencyCode: page.scope.currencyCode };
    const locale = localeFor(language, market);
    const storefrontName =
        (language === 'zh' ? config.customFields.storefrontNameZh : config.customFields.storefrontNameEn) ??
        '';
    const contentBlocks = page.content?.blocks ?? [];
    const products = page.products ?? [];
    const logoUrl = config.logoUrl ?? null;
    // No request is issued during rendering. After hydration, the normal runtime owns all commands.
    const api = new ShopApi(market, page.scope.languageCode as 'en' | 'zh_Hans');
    const common = {
        language,
        storefrontName,
        logoUrl,
        contentBlocks,
        displayCurrencyCode: page.scope.currencyCode,
        availableCurrencyCodes: config.currencyConfiguration?.availableCurrencyCodes ?? [
            page.scope.currencyCode,
        ],
        currencyLoading: false,
        onToggleLanguage: idle,
        onCurrencyChange: idle,
        onNotifications: idle,
        onContentTarget: (_type: StorefrontContentTargetType, _value: string | null) => undefined,
    };
    const request = page.request;
    let body;
    if (request?.kind === 'article' && page.publicContent) {
        body = <GuideContent content={page.publicContent} language={language} />;
    } else if (request?.kind === 'product' && page.product) {
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
                    flashSaleItems: [],
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
    } else if (request?.kind === 'catalog') {
        const input = request.input;
        body = (
            <CategoryPageContext.Provider
                value={{
                    api,
                    products: page.catalog?.items ?? [],
                    collections: page.collections ?? [],
                    contentBlocks,
                    loading: false,
                    contextResolved: true,
                    error: null,
                    market,
                    locale,
                    language,
                    activeCollectionId: input.collectionId ?? 'all',
                    activeChildId: 'all',
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
        body = (
            <BusinessServicesPageContext.Provider
                value={{
                    ...common,
                    marketLabel: market.label,
                    onNavigate: (_route: RouteState) => undefined,
                }}
            >
                <BusinessServicesPage />
            </BusinessServicesPageContext.Provider>
        );
    } else if (request?.kind === 'page' && request.id === 'support') {
        body = (
            <SupportPageContext.Provider
                value={{ language, content: contentBlocks.find(block => block.type === 'SUPPORT') }}
            >
                <SupportPage />
            </SupportPageContext.Provider>
        );
    } else if (request?.kind === 'page') {
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
                storefrontHostname={page.scope.host}
                onBack={idle}
                onSelectDocument={idle}
            />
        );
    } else {
        body = (
            <HomePageContext.Provider
                value={{
                    ...common,
                    products,
                    collections: page.collections ?? [],
                    managedContentProducts: products,
                    managedContentLoading: false,
                    heroAutoplayIntervalSeconds: 5,
                    configuredBlockTypes:
                        page.content?.settings?.configuredBlockTypes ??
                        contentBlocks.map(block => block.type),
                    coupons: [],
                    couponCampaignsLoading: false,
                    couponCampaignsError: '',
                    flashSales: (page.flashSales as StorefrontFlashSale[]) ?? [],
                    systemAnnouncements: page.content?.systemAnnouncements ?? [],
                    bestSellerProducts: [],
                    recommendationProducts: [],
                    contentError: '',
                    loading: false,
                    error: null,
                    catalogLoading: false,
                    catalogError: null,
                    market,
                    locale,
                    storefrontDescription: config.description ?? '',
                    storefrontTagline: config.tagline ?? '',
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
    return (
        <DesktopLayoutContext.Provider value={false}>
            <div className="storefront-app" data-route={request?.kind ?? 'home'}>
                <div id="storefront-content" tabIndex={-1}>
                    {body}
                </div>
            </div>
        </DesktopLayoutContext.Provider>
    );
}

export async function createPublicSnapshotApp(page: PublicPageData, onReady?: () => void) {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    seedPublicPage(queryClient, page);
    const root = createRootRoute({ component: () => <SnapshotPage page={page} onReady={onReady} /> });
    const catchAll = createRoute({ getParentRoute: () => root, path: '$' });
    const router = createRouter({
        routeTree: root.addChildren([catchAll]),
        // Use the same Matches wrapper for server render and the short hydration phase.
        // The normal browser router takes over after mount and owns real navigation.
        isServer: true,
        history: createMemoryHistory({ initialEntries: [page.route] }),
        rewrite: publicRouteRewrite,
    });
    router.ssr = { manifest: undefined };
    await router.load();
    return (
        <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
        </QueryClientProvider>
    );
}
