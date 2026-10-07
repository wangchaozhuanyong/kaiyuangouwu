import { lazyRouteComponent } from '@tanstack/react-router';
import { ShoppingBag } from 'lucide-react';

import { catalogRouteState } from '../catalog-route-query';
import { useDesktopLayout } from '../desktop-layout';
import { offlineLoadError } from '../loading-state';
import { PageSkeleton } from '../route-loading';
import { storefrontErrorMessage } from '../storefront-errors';
import { HomePageContext, ProductDetailPageContext, SearchPageContext } from '../storefront-page-contexts';
import { EmptyState, Subpage } from '../storefront-ui/page-shell';
import { CollectionSummary, Product, ProductVariant } from '../types';

import '../commerce-styles';
import { registerRoutePreload, useRouteRuntime as useRuntime } from './shared';

const HomePage = lazyRouteComponent(() => import('../pages/home-page'), 'HomePage');
const ProductDetailPage = lazyRouteComponent(
    () => import('../pages/product-detail-page'),
    'ProductDetailPage',
);
const SearchPage = lazyRouteComponent(() => import('../pages/search-page'), 'SearchPage');

export function HomeRoutePage() {
    const runtime = useRuntime();
    const { language, configQuery, contentQuery, productsQuery } = runtime;
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
                managedContentLoading: runtime.managedContentLoading,
                heroAutoplayIntervalSeconds: runtime.heroAutoplayIntervalSeconds,
                configuredBlockTypes: runtime.configuredBlockTypes,
                coupons: runtime.activeCoupons,
                couponCampaignsLoading: runtime.couponCampaignsLoading,
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
                onCurrencyChange: code => void runtime.switchCurrency(code),
                onNotifications: () => runtime.navigate({ name: 'notifications' }),
                onToast: runtime.notify,
                onClaimCoupon: runtime.claimCoupon,
                onCouponCampaignsRetry: () => {
                    if (runtime.customerLoadState !== 'ready') {
                        // Recover the account first; its resolved customer key enables the coupon read.
                        void runtime.retryAccount();
                    } else {
                        void runtime.couponCampaignsQuery.refetch({ cancelRefetch: false });
                    }
                },
                onContentTarget: runtime.openContentTarget,
                onContentRetry: () => void runtime.contentQuery?.refetch?.({ cancelRefetch: false }),
                onRetry: () => void runtime.refetchStorefront(),
            }}
        >
            <HomePage />
        </HomePageContext.Provider>
    );
}

export function ProductRoutePage() {
    const runtime = useRuntime();
    const isZh = runtime.language === 'zh';
    if (
        !runtime.selectedProduct &&
        (runtime.routeProductLoading || (runtime.route.id && !runtime.routeProductError))
    ) {
        return (
            <Subpage
                title={isZh ? '商品详情' : 'Product'}
                language={runtime.language}
                onBack={runtime.goBack}
            >
                <PageSkeleton label={isZh ? '正在加载商品详情' : 'Loading product details'} />
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
                    title={isZh ? '没有找到商品' : 'Product not found'}
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
                flashSaleItems: runtime.activeFlashSaleItems.filter(
                    (item: { productId: string }) => item.productId === product.id,
                ),
                couponCampaigns: runtime.activeCoupons,
                customerCoupons: runtime.myCoupons,
                addingVariantId: runtime.addingVariantId,
                cartCommandUnknown: runtime.cartCommandUnknown,
                favorite: runtime.favoriteProductIds.includes(product.id),
                onAdd: (variant: ProductVariant, quantity: number) =>
                    void runtime.addToCart(variant, quantity),
                onBuyNow: (variant: ProductVariant, quantity: number) =>
                    void runtime.startDirectPurchase(variant, quantity),
                onFavorite: () => runtime.toggleFavoriteProduct(product.id),
                onNotify: runtime.notify,
            }}
        >
            <ProductDetailPage />
        </ProductDetailPageContext.Provider>
    );
}

export function SearchRoutePage() {
    const runtime = useRuntime();
    const desktop = useDesktopLayout();
    if (desktop) return <HomeRoutePage />;
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
