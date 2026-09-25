import { useNavigate, useRouter } from '@tanstack/react-router';
import { Heart, Trash2, WifiOff } from 'lucide-react';
import { useState } from 'react';

import { ShopApi } from '../api';
import { useDesktopLayout } from '../desktop-layout';
import { offlineLoadError } from '../loading-state';
import { PageSkeleton } from '../route-loading';
import { useProductsByIdsQuery } from '../route-queries';
import { storefrontErrorMessage } from '../storefront-errors';
import { FavoriteProductsPageContext } from '../storefront-page-contexts';
import { routeNavigateOptions, type RouteState } from '../storefront-router';
import { EmptyState, SubHeader } from '../storefront-ui/page-shell';
import { ProductSection } from '../storefront-ui/product-section';
import { MarketConfig, StorefrontLanguage } from '../types';

// TODO: Fix internal imports later

export interface FavoriteProductsPageProps {
    api: ShopApi;
    productIds: string[];
    activityLoading?: boolean;
    activityError?: Error | null;
    onActivityRetry?: () => void;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    onRemove: (productId: string) => void;
    onRemoveMany?: (productIds: string[]) => void;
    onClear: () => void;
}

export function FavoriteProductsPage() {
    const desktop = useDesktopLayout();
    const [managing, setManaging] = useState(false);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const navigate = useNavigate();
    const navigateTo = (route: RouteState) => void navigate(routeNavigateOptions(route) as never);
    const router = useRouter();
    const goBack = () => router.history.back();
    const {
        api,
        productIds,
        activityLoading,
        activityError,
        onActivityRetry,
        market,
        locale,
        language,
        onRemove,
        onRemoveMany,
        onClear,
    } = FavoriteProductsPageContext.useValue();
    const isZh = language === 'zh';
    const favoritesQuery = useProductsByIdsQuery({ api, productIds, market, language });
    const favoriteProducts = productIds.length ? (favoritesQuery.data ?? []) : [];
    const loading = activityLoading || (productIds.length > 0 && favoritesQuery.isLoading);
    const favoriteError = activityError
        ? storefrontErrorMessage(activityError, language)
        : !favoriteProducts.length && favoritesQuery.isPaused
          ? offlineLoadError(language)
          : !favoriteProducts.length && favoritesQuery.error instanceof Error
            ? storefrontErrorMessage(favoritesQuery.error, language)
            : '';
    const availableProducts = favoriteProducts.filter(product => productIds.includes(product.id));
    const selected = selectedIds.filter(id => availableProducts.some(product => product.id === id));
    const allSelected = availableProducts.length > 0 && selected.length === availableProducts.length;

    return (
        <main className="page subpage favorites-page">
            {!desktop && (
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
            )}
            {desktop && availableProducts.length > 0 && onRemoveMany && (
                <div className="desktop-account-workbench-toolbar favorites-toolbar">
                    <strong>
                        {isZh ? `收藏商品 ${productIds.length}` : `${productIds.length} favorites`}
                    </strong>
                    <div className="favorites-toolbar-actions">
                        <button type="button" onClick={onClear}>
                            {isZh ? '清空收藏' : 'Clear favorites'}
                        </button>
                        {managing && (
                            <>
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={allSelected}
                                        onChange={() =>
                                            setSelectedIds(
                                                allSelected
                                                    ? []
                                                    : availableProducts.map(product => product.id),
                                            )
                                        }
                                    />
                                    {isZh ? '全选' : 'Select all'}
                                </label>
                                <span role="status">
                                    {isZh ? `已选 ${selected.length} 件` : `${selected.length} selected`}
                                </span>
                                <button
                                    type="button"
                                    disabled={!selected.length}
                                    onClick={() => {
                                        onRemoveMany(selected);
                                        setSelectedIds([]);
                                    }}
                                >
                                    {isZh ? '取消所选收藏' : 'Remove selected'}
                                </button>
                            </>
                        )}
                        <button
                            type="button"
                            onClick={() => {
                                setManaging(!managing);
                                setSelectedIds([]);
                            }}
                        >
                            {managing ? (isZh ? '完成' : 'Done') : isZh ? '批量管理' : 'Manage'}
                        </button>
                    </div>
                </div>
            )}
            {loading && !favoriteProducts.length ? (
                <PageSkeleton label={isZh ? '正在加载收藏商品' : 'Loading favorites'} />
            ) : favoriteError ? (
                <EmptyState
                    icon={<WifiOff />}
                    title={isZh ? '收藏商品加载失败' : 'Could not load favorites'}
                    detail={favoriteError}
                    action={isZh ? '重试' : 'Retry'}
                    onAction={() => (activityError ? onActivityRetry?.() : void favoritesQuery.refetch())}
                />
            ) : availableProducts.length ? (
                <ProductSection
                    products={availableProducts}
                    market={market}
                    locale={locale}
                    language={language}
                    favoriteProductIds={productIds}
                    selection={
                        desktop && managing
                            ? {
                                  ids: selected,
                                  onToggle: id =>
                                      setSelectedIds(current =>
                                          current.includes(id)
                                              ? current.filter(item => item !== id)
                                              : [...current, id],
                                      ),
                              }
                            : undefined
                    }
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
