import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazyRouteComponent } from '@tanstack/react-router';
import { ShoppingBag } from 'lucide-react';
import { useState } from 'react';

import { importHomePage, importProductDetailPage } from '../catalog-page-imports';
import { catalogRouteState } from '../catalog-route-query';
import { languageCodeFor } from '../i18n';
import { offlineLoadError } from '../loading-state';
import { usePageReadiness, usePageRouteCommit } from '../page-readiness';
import { PublicCatalogMediaProvider, merchandisingMediaCatalogs } from '../public-catalog-media';
import { retryStorefrontRead, storefrontQueryKeys } from '../query-client';
import { PageSkeleton } from '../route-loading';
import { storefrontErrorMessage } from '../storefront-errors';
import { HomePageContext, ProductDetailPageContext, SearchPageContext } from '../storefront-page-contexts';
import { readInitialPublicPage } from '../storefront-page-data';
import { EmptyState, Subpage } from '../storefront-ui/page-shell';
import { CollectionSummary, Product, ProductVariant, StorefrontCouponCampaign } from '../types';

import '../commerce-styles';
import { registerRoutePreload, useRouteRuntime as useRuntime } from './shared';

const HomePage = lazyRouteComponent(importHomePage, 'HomePage');
const ProductDetailPage = lazyRouteComponent(importProductDetailPage, 'ProductDetailPage');
const SearchPage = lazyRouteComponent(() => import('../pages/search-page'), 'SearchPage');

export function HomeRoutePage() {
    const client = useQueryClient();
    usePageRouteCommit();
    const runtime = useRuntime();
    const readMarket = storefrontQueryKeys.market(runtime.market);
    const readLanguage = languageCodeFor(runtime.language);
    const [initialPage] = useState(() =>
        document.getElementById('root')?.dataset.publicAdopted !== '1' ? readInitialPublicPage() : undefined,
    );
    const initialRenderTime = initialPage?.generatedAt;
    const couponScope = `${readMarket}:${readLanguage}`;
    const matchingSnapshot =
        initialPage &&
        `${initialPage.scope.channelCode}:${initialPage.scope.currencyCode}:${initialPage.scope.languageCode}` ===
            couponScope;
    useQuery({
        queryKey: storefrontQueryKeys.couponCampaigns(readMarket, readLanguage, runtime.customer?.id ?? null),
        queryFn: ({ signal }) => runtime.api.activeCouponCampaigns(signal),
        enabled:
            runtime.customerLoadState === 'ready' &&
            runtime.contentBlocks.some(block => block.type === 'COUPONS' && block.enabled),
        initialData:
            runtime.customer || !matchingSnapshot
                ? undefined
                : (initialPage?.couponCampaigns as StorefrontCouponCampaign[] | undefined),
        initialDataUpdatedAt: initialPage?.generatedAt,
        staleTime: 30_000,
    });
    const [couponVisit] = useState(() => {
        const page = initialPage;
        if (page)
            return {
                owner: null,
                scope: couponScope,
                coupons:
                    matchingSnapshot && page.couponAudience === 'anonymous'
                        ? ((page.couponCampaigns ?? []) as StorefrontCouponCampaign[])
                        : [],
            };
        return {
            owner: runtime.customer?.id ?? null,
            scope: couponScope,
            coupons:
                runtime.customerLoadState === 'ready' &&
                runtime.couponCampaignsQuery.data !== undefined &&
                Date.now() - runtime.couponCampaignsQuery.dataUpdatedAt < 30_000
                    ? runtime.activeCoupons
                    : [],
        };
    });
    const couponOwnerChanged =
        runtime.customerLoadState !== 'loading' && (runtime.customer?.id ?? null) !== couponVisit.owner;
    const visitCoupons =
        couponVisit.coupons.length && !couponOwnerChanged && couponVisit.scope === couponScope
            ? runtime.couponCampaignsQuery.data !== undefined && runtime.customerLoadState !== 'loading'
                ? runtime.activeCoupons
                : couponVisit.coupons
            : [];
    const { language, configQuery, contentQuery, productsQuery } = runtime;
    usePageReadiness(
        contentQuery.isPending,
        'query',
        undefined,
        contentQuery.data === undefined && contentQuery.isError,
    );
    const contentError =
        contentQuery.data === undefined
            ? contentQuery.isPaused
                ? offlineLoadError(language)
                : contentQuery.error
                  ? storefrontErrorMessage(contentQuery.error, language)
                  : ''
            : '';
    const catalogError =
        productsQuery.data === undefined
            ? productsQuery.isPaused
                ? offlineLoadError(language)
                : productsQuery.error
                  ? storefrontErrorMessage(productsQuery.error, language)
                  : null
            : null;
    return (
        <HomePageContext.Provider
            value={{
                products: runtime.products,
                collections: runtime.collections,
                contentBlocks: runtime.contentBlocks,
                managedContentProducts: runtime.managedContentProducts,
                managedContentLoading:
                    runtime.managedContentLoading ||
                    (runtime.managedContentProductsQuery?.data === undefined &&
                        (runtime.managedContentProductsQuery?.isPaused ||
                            runtime.managedContentProductsQuery?.isError)),
                managedContentError:
                    runtime.managedContentProductsQuery?.data === undefined
                        ? runtime.managedContentProductsQuery?.isPaused
                            ? offlineLoadError(language)
                            : runtime.managedContentProductsQuery?.error
                              ? storefrontErrorMessage(runtime.managedContentProductsQuery.error, language)
                              : ''
                        : '',
                onManagedContentRetry: () =>
                    void runtime.managedContentProductsQuery?.refetch({ cancelRefetch: false }),
                managedContentResolved: runtime.managedContentResolved,
                responsiveIntro: true,
                initialRenderTime,
                heroAutoplayIntervalSeconds: runtime.heroAutoplayIntervalSeconds,
                configuredBlockTypes: runtime.configuredBlockTypes,
                coupons: visitCoupons,
                couponCampaignsLoading: false,
                couponCampaignsError: runtime.couponCampaignsError,
                flashSales: runtime.activeFlashSales,
                systemAnnouncements: runtime.systemAnnouncements,
                bestSellerProducts: runtime.bestSellerProducts,
                recommendationProducts: runtime.recommendationProducts,
                bestSellersLoading: runtime.bestSellersLoading,
                recommendationsLoading: runtime.recommendationsLoading,
                contentError,
                // The home hero depends on content, not the product catalog.
                loading: contentQuery.isPending && !contentQuery.isPaused,
                error:
                    configQuery.isError && configQuery.data === undefined
                        ? storefrontErrorMessage(configQuery.error, language)
                        : null,
                catalogLoading: productsQuery.isPending && !productsQuery.isPaused,
                catalogError,
                market: runtime.market,
                locale: runtime.locale,
                language: runtime.language,
                storefrontName: runtime.storefrontName,
                storefrontNameAliases: [
                    configQuery.data?.customFields.storefrontNameZh ?? '',
                    configQuery.data?.customFields.storefrontNameEn ?? '',
                ],
                storefrontDescription: runtime.storefrontDescription,
                storefrontTagline: runtime.storefrontTagline,
                logoUrl: runtime.logoUrl,
                logoOnLightUrl: runtime.logoOnLightUrl,
                couponLoading: runtime.cartLoading,
                onCategorySelect: (collection: CollectionSummary) => {
                    const childId = collection.children?.[0]?.id ?? collection.id;
                    runtime.updateCategory({ collectionId: collection.id, childId });
                },
                onToggleLanguage: runtime.toggleLanguage,
                availableCurrencyCodes: runtime.availableCurrencyCodes,
                currencySelectorEnabled: runtime.currencySelectorEnabled,
                displayCurrencyCode: runtime.displayCurrencyCode,
                currencyLoading: runtime.cartLoading,
                onCurrencyChange: runtime.switchCurrency,
                onNotifications: () => runtime.navigate({ name: 'notifications' }),
                onToast: runtime.notify,
                onClaimCoupon: runtime.claimCoupon,
                onCouponCampaignsRetry: () =>
                    void runtime.couponCampaignsQuery.refetch({ cancelRefetch: false }),
                onContentTarget: runtime.openContentTarget,
                onContentRetry: () =>
                    void retryStorefrontRead(client, [
                        ...storefrontQueryKeys.content(readMarket, readLanguage),
                        'public',
                    ]),
                onCatalogRetry: () =>
                    void retryStorefrontRead(
                        client,
                        storefrontQueryKeys.products(readMarket, readLanguage, 12),
                    ),
                onRetry: () => void runtime.refetchStorefront(),
            }}
        >
            <PublicCatalogMediaProvider
                market={runtime.market}
                language={runtime.language}
                collections={runtime.collections}
                catalogs={merchandisingMediaCatalogs(
                    runtime.catalogTakes,
                    runtime.bestSellerProducts,
                    runtime.recommendationProducts,
                    true,
                )}
            >
                <HomePage />
            </PublicCatalogMediaProvider>
        </HomePageContext.Provider>
    );
}

export function ProductRoutePage() {
    const client = useQueryClient();
    usePageRouteCommit();
    const runtime = useRuntime();
    const readMarket = storefrontQueryKeys.market(runtime.market);
    const readLanguage = languageCodeFor(runtime.language);
    const isZh = runtime.language === 'zh';
    usePageReadiness(
        !runtime.selectedProduct && runtime.routeProductLoading,
        'query',
        runtime.route.id,
        !runtime.selectedProduct && Boolean(runtime.routeProductError),
    );
    if (!runtime.selectedProduct && runtime.routeProductLoading) {
        return (
            <Subpage
                title={isZh ? '商品详情' : 'Product'}
                language={runtime.language}
                onBack={runtime.goBack}
            >
                <PageSkeleton
                    variant="detail"
                    onRetry={() =>
                        void retryStorefrontRead(
                            client,
                            storefrontQueryKeys.product(readMarket, readLanguage, runtime.route.id ?? ''),
                        )
                    }
                    label={isZh ? '正在加载商品详情' : 'Loading product details'}
                />
            </Subpage>
        );
    }
    if (!runtime.selectedProduct) {
        return (
            <Subpage
                title={isZh ? '商品详情' : 'Product'}
                language={runtime.language}
                onBack={runtime.goBack}
            >
                <EmptyState
                    icon={<ShoppingBag />}
                    title={
                        runtime.routeProductError
                            ? isZh
                                ? '商品暂时无法加载'
                                : 'Product could not be loaded'
                            : isZh
                              ? '没有找到商品'
                              : 'Product not found'
                    }
                    detail={runtime.routeProductError}
                    action={
                        runtime.routeProductError ? (isZh ? '重试' : 'Retry') : isZh ? '去逛商品' : 'Browse'
                    }
                    onAction={() =>
                        runtime.routeProductError
                            ? void runtime.productQuery.refetch({ cancelRefetch: false })
                            : runtime.navigate({ name: 'category' })
                    }
                />
            </Subpage>
        );
    }
    const product: Product = runtime.selectedProduct;
    return (
        <ProductDetailPageContext.Provider
            value={{
                api: runtime.api,
                product,
                products: runtime.products,
                cartQuantity: runtime.cart?.totalQuantity ?? 0,
                market: runtime.market,
                locale: runtime.locale,
                language: runtime.language,
                reviewEnabled: runtime.reviewSettingsStatus === 'enabled',
                storefrontName: runtime.storefrontName,
                logoUrl: runtime.logoUrl,
                supportContent: runtime.supportContent,
                initialVariantId: runtime.route.variantId,
                initialQuantity: runtime.route.quantity,
                flashSaleItems: runtime.activeFlashSaleItems.filter(
                    (item: { productId: string }) => item.productId === product.id,
                ),
                couponCampaigns: runtime.activeCoupons,
                customerCoupons: runtime.myCoupons,
                addingVariantId: runtime.addingVariantId,
                cartCommandUnknown: runtime.cartCommandUnknown,
                purchaseResultUnknown:
                    runtime.cartCommandUnknown && runtime.cartPendingCheckoutIntent === 'buyNow',
                purchaseRecoveryPending:
                    runtime.cartRecoveryPending && runtime.cartPendingCheckoutIntent === 'buyNow',
                purchaseError: runtime.cartError,
                favorite: runtime.favoriteProductIds.includes(product.id),
                onAdd: (variant: ProductVariant, quantity: number) =>
                    void runtime.addToCart(variant, quantity),
                onBuyNow: (variant: ProductVariant, quantity: number) =>
                    void runtime.startDirectPurchase(variant, quantity),
                onContinuePurchase: () => void runtime.refreshCart().catch(() => undefined),
                onFavorite: () => runtime.toggleFavoriteProduct(product.id),
                onNotify: runtime.notify,
            }}
        >
            <ProductDetailPage />
        </ProductDetailPageContext.Provider>
    );
}

export function SearchRoutePage() {
    usePageRouteCommit();
    const runtime = useRuntime();
    return (
        <SearchPageContext.Provider
            value={{
                api: runtime.api,
                contextResolved: runtime.storefrontContextResolved,
                products: runtime.products,
                collections: runtime.collections,
                market: runtime.market,
                locale: runtime.locale,
                language: runtime.language,
                storefrontCode: runtime.storefrontCode,
                customerId: runtime.customer?.id,
                initialQuery: runtime.route.term ?? '',
                initialFilters: catalogRouteState(runtime.route),
            }}
        >
            <SearchPage key={JSON.stringify([runtime.storefrontCode, runtime.customer?.id ?? null])} />
        </SearchPageContext.Provider>
    );
}

export const preloadHomeRoutePage = registerRoutePreload(HomeRoutePage, HomePage);
export const preloadProductRoutePage = registerRoutePreload(ProductRoutePage, ProductDetailPage);
export const preloadSearchRoutePage = registerRoutePreload(SearchRoutePage, SearchPage);
