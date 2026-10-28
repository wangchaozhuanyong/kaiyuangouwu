import { useQueryClient } from '@tanstack/react-query';
import { lazyRouteComponent } from '@tanstack/react-router';
import { ShoppingBag } from 'lucide-react';

import { importProductDetailPage } from '../catalog-page-imports';
import { catalogRouteState } from '../catalog-route-query';
import { languageCodeFor } from '../i18n';
import { usePageReadiness, usePageRouteCommit } from '../page-readiness';
import { retryStorefrontRead, storefrontQueryKeys } from '../query-client';
import { PageSkeleton } from '../route-loading';
import { ProductDetailPageContext, SearchPageContext } from '../storefront-page-contexts';
import { EmptyState, Subpage } from '../storefront-ui/page-shell';
import { Product, ProductVariant } from '../types';

import '../commerce-styles';
import { registerRoutePreload, useRouteRuntime as useRuntime } from './shared';

const ProductDetailPage = lazyRouteComponent(importProductDetailPage, 'ProductDetailPage');
const SearchPage = lazyRouteComponent(() => import('../pages/search-page'), 'SearchPage');

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

export const preloadProductRoutePage = registerRoutePreload(ProductRoutePage, ProductDetailPage);
export const preloadSearchRoutePage = registerRoutePreload(SearchRoutePage, SearchPage);
