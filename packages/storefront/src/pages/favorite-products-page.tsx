import { useNavigate, useRouter } from '@tanstack/react-router';
import { Heart, Trash2, WifiOff } from 'lucide-react';
import type { RouteState } from '../storefront-router';

import { ShopApi } from '../api';
import { offlineLoadError } from '../loading-state';
import { PageSkeleton } from '../route-loading';
import { useProductsByIdsQuery } from '../route-queries';
import { FavoriteProductsPageContext } from '../storefront-page-contexts';
import { routeNavigateOptions } from '../storefront-router';
import { EmptyState, SubHeader } from '../storefront-ui/page-shell';
import { ProductSection } from '../storefront-ui/product-section';
import { MarketConfig, StorefrontLanguage } from '../types';

// TODO: Fix internal imports later

export interface FavoriteProductsPageProps {
    api: ShopApi;
    productIds: string[];
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    onRemove: (productId: string) => void;
    onClear: () => void;
}

export function FavoriteProductsPage() {
    const navigate = useNavigate();
    const navigateTo = (route: RouteState) => void navigate(routeNavigateOptions(route) as never);
    const router = useRouter();
    const goBack = () => router.history.back();
    const { api, productIds, market, locale, language, onRemove, onClear } =
        FavoriteProductsPageContext.useValue();
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
                title={isZh ? `我的收藏 (${productIds.length})` : `My favorites (${productIds.length})`}
                language={language}
                onBack={goBack}
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
                    products={availableProducts}
                    market={market}
                    locale={locale}
                    language={language}
                    favoriteProductIds={productIds}
                    onProduct={product => navigateTo({ name: 'product', id: product.id })}
                    onFavorite={product => onRemove(product.id)}
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
                    onAction={() => navigateTo({ name: 'category' })}
                />
            )}
        </main>
    );
}
