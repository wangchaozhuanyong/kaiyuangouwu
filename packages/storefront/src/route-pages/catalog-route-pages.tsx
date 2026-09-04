import { lazyRouteComponent } from '@tanstack/react-router';
import { ShoppingBag } from 'lucide-react';

import { PageSkeleton } from '../route-loading';
import { EmptyState, Subpage } from '../storefront-ui/page-shell';
import { CollectionSummary, FulfillmentType, Product, ProductVariant } from '../types';

import {
    RoutePageContext as PageContext,
    registerRoutePreload,
    useRouteRuntime as useRuntime,
} from './shared';

const HomePage = lazyRouteComponent(() => import('../pages/home-page'), 'HomePage');
const CategoryPage = lazyRouteComponent(() => import('../pages/category-page'), 'CategoryPage');
const ProductDetailPage = lazyRouteComponent(
    () => import('../pages/product-detail-page'),
    'ProductDetailPage',
);
const SearchPage = lazyRouteComponent(() => import('../pages/search-page'), 'SearchPage');

export function HomeRoutePage() {
    const runtime = useRuntime();
    return (
        <PageContext
            value={{
                products: runtime.products,
                collections: runtime.collections,
                contentBlocks: runtime.contentBlocks,
                managedContentProducts: runtime.managedContentProducts,
                heroAutoplayIntervalSeconds: runtime.heroAutoplayIntervalSeconds,
                configuredBlockTypes: runtime.configuredBlockTypes,
                coupons: runtime.activeCoupons,
                couponCampaignsLoading: runtime.couponCampaignsLoading,
                couponCampaignsError: runtime.couponCampaignsError,
                flashSales: runtime.activeFlashSales,
                systemAnnouncements: runtime.systemAnnouncements,
                bestSellerProducts: runtime.bestSellerProducts,
                recommendationProducts: runtime.recommendationProducts,
                contentError: runtime.contentError,
                loading: runtime.loading,
                error: runtime.error,
                market: runtime.market,
                locale: runtime.locale,
                language: runtime.language,
                storefrontName: runtime.storefrontName,
                storefrontDescription: runtime.storefrontDescription,
                logoUrl: runtime.logoUrl,
                addingVariantId: runtime.addingVariantId,
                couponLoading: runtime.cartLoading,
                onCategorySelect: (collection: CollectionSummary) => {
                    const childId = collection.children?.[0]?.id ?? collection.id;
                    runtime.updateCategory({ collectionId: collection.id, childId });
                },
                onAdd: (variant: ProductVariant) => void runtime.addToCart(variant),
                onToggleLanguage: runtime.toggleLanguage,
                availableCurrencyCodes: runtime.availableCurrencyCodes,
                currencySelectorEnabled: runtime.currencySelectorEnabled,
                displayCurrencyCode: runtime.displayCurrencyCode,
                currencyLoading: runtime.cartLoading,
                onCurrencyChange: runtime.switchCurrency,
                onNotifications: () => runtime.navigate({ name: 'notifications' }),
                onToast: runtime.notify,
                onClaimCoupon: runtime.claimCoupon,
                onCouponCampaignsRetry: () => void runtime.couponCampaignsQuery.refetch(),
                onContentTarget: runtime.openContentTarget,
                onContentRetry: () => void runtime.contentQuery?.refetch?.(),
                onRetry: () => void runtime.refetchStorefront(),
            }}
        >
            <HomePage />
        </PageContext>
    );
}

export function CategoryRoutePage() {
    const runtime = useRuntime();
    return (
        <PageContext
            value={{
                api: runtime.api,
                products: runtime.products,
                collections: runtime.collections,
                contentBlocks: runtime.contentBlocks,
                loading: runtime.loading,
                error: runtime.error,
                market: runtime.market,
                locale: runtime.locale,
                language: runtime.language,
                activeCollectionId: runtime.activeCollectionId,
                activeChildId: runtime.activeChildId,
                sortMode: runtime.sortMode,
                fulfillmentFilter: runtime.fulfillmentFilter,
                inStockOnly: runtime.inStockOnly,
                minimumPrice: runtime.minimumPrice,
                maximumPrice: runtime.maximumPrice,
                addingVariantId: runtime.addingVariantId,
                onCollectionChange: (collectionId: string, childId: string) =>
                    runtime.updateCategory({ collectionId, childId }),
                onChildChange: (childId: string) => runtime.updateCategory({ childId }),
                onSortChange: (sort: string) => runtime.updateCategory({ sort }),
                onFilterChange: (
                    fulfillment: 'all' | FulfillmentType,
                    inStockOnly: boolean,
                    minPrice: string,
                    maxPrice: string,
                ) =>
                    runtime.updateCategory({
                        fulfillment,
                        inStockOnly,
                        minPrice: minPrice || undefined,
                        maxPrice: maxPrice || undefined,
                    }),
                onAdd: (variant: ProductVariant) => void runtime.addToCart(variant),
                onNotify: () => runtime.navigate({ name: 'notifications' }),
                onRetry: () => void runtime.refetchStorefront(),
            }}
        >
            <CategoryPage />
        </PageContext>
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
                            ? void runtime.productQuery.refetch()
                            : runtime.navigate({ name: 'category' })
                    }
                />
            </Subpage>
        );
    }
    const product: Product = runtime.selectedProduct;
    return (
        <PageContext
            value={{
                api: runtime.api,
                product,
                products: runtime.products,
                cartQuantity: runtime.cart?.totalQuantity ?? 0,
                market: runtime.market,
                locale: runtime.locale,
                language: runtime.language,
                storefrontName: runtime.storefrontName,
                logoUrl: runtime.logoUrl,
                flashSaleItems: runtime.activeFlashSaleItems.filter(
                    (item: { productId: string }) => item.productId === product.id,
                ),
                couponCampaigns: runtime.activeCoupons,
                customerCoupons: runtime.myCoupons,
                addingVariantId: runtime.addingVariantId,
                favorite: runtime.favoriteProductIds.includes(product.id),
                onAdd: (variant: ProductVariant) => void runtime.addToCart(variant),
                onBuyNow: (variant: ProductVariant) => void runtime.startDirectPurchase(variant),
                onFavorite: () => runtime.toggleFavoriteProduct(product.id),
                onNotify: runtime.notify,
            }}
        >
            <ProductDetailPage />
        </PageContext>
    );
}

export function SearchRoutePage() {
    const runtime = useRuntime();
    return (
        <PageContext
            value={{
                api: runtime.api,
                products: runtime.products,
                market: runtime.market,
                locale: runtime.locale,
                language: runtime.language,
                storefrontCode: runtime.storefrontCode,
                initialQuery: runtime.route.term ?? '',
                addingVariantId: runtime.addingVariantId,
                onAdd: (variant: ProductVariant) => void runtime.addToCart(variant),
            }}
        >
            <SearchPage />
        </PageContext>
    );
}

export const preloadHomeRoutePage = registerRoutePreload(HomeRoutePage, HomePage);
export const preloadCategoryRoutePage = registerRoutePreload(CategoryRoutePage, CategoryPage);
export const preloadProductRoutePage = registerRoutePreload(ProductRoutePage, ProductDetailPage);
export const preloadSearchRoutePage = registerRoutePreload(SearchRoutePage, SearchPage);
