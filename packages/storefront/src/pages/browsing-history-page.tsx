import { useNavigate, useRouter } from '@tanstack/react-router';
import { Clock3, Trash2, WifiOff } from 'lucide-react';
import type { RouteState } from '../storefront-router';

import { ShopApi } from '../api';
import { offlineLoadError } from '../loading-state';
import { PageSkeleton } from '../route-loading';
import { useProductsByIdsQuery } from '../route-queries';
import { BrowsingHistoryPageContext } from '../storefront-page-contexts';
import { routeNavigateOptions } from '../storefront-router';
import { EmptyState, SubHeader } from '../storefront-ui/page-shell';
import { ProductSection } from '../storefront-ui/product-section';
import { MarketConfig, StorefrontLanguage } from '../types';

// TODO: Fix internal imports later

export interface BrowsingHistoryPageProps {
    api: ShopApi;
    productIds: string[];
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    onClear: () => void;
}

export function BrowsingHistoryPage() {
    const navigate = useNavigate();
    const navigateTo = (route: RouteState) => void navigate(routeNavigateOptions(route) as never);
    const router = useRouter();
    const goBack = () => router.history.back();
    const { api, productIds, market, locale, language, onClear } = BrowsingHistoryPageContext.useValue();
    const isZh = language === 'zh';
    const historyQuery = useProductsByIdsQuery({ api, productIds, market, language });
    const historyProducts = productIds.length ? (historyQuery.data ?? []) : [];
    const loading = productIds.length > 0 && historyQuery.isLoading;
    const historyError =
        !historyProducts.length && historyQuery.isPaused
            ? offlineLoadError(language)
            : !historyProducts.length && historyQuery.error instanceof Error
              ? historyQuery.error.message
              : '';

    return (
        <main className="page subpage history-page">
            <SubHeader
                title={isZh ? '浏览足迹' : 'Browsing history'}
                language={language}
                onBack={goBack}
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
                <PageSkeleton label={isZh ? '正在加载浏览足迹' : 'Loading browsing history'} />
            ) : historyError ? (
                <EmptyState
                    icon={<WifiOff />}
                    title={isZh ? '浏览足迹加载失败' : 'Could not load browsing history'}
                    detail={historyError}
                    action={isZh ? '重试' : 'Retry'}
                    onAction={() => void historyQuery.refetch()}
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
                    language={language}
                    onProduct={product => navigateTo({ name: 'product', id: product.id })}
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
                    onAction={() => navigateTo({ name: 'category' })}
                />
            )}
        </main>
    );
}
