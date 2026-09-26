import { useNavigate, useRouter } from '@tanstack/react-router';
import { Clock3, Trash2, WifiOff } from 'lucide-react';
import { useState } from 'react';

import { ShopApi } from '../api';
import { filterProductsByVisitDate, type ProductVisitTimes, type VisitPeriod } from '../browsing-history';
import { useDesktopLayout } from '../desktop-layout';
import { offlineLoadError } from '../loading-state';
import { PageSkeleton } from '../route-loading';
import { useProductsByIdsQuery } from '../route-queries';
import { storefrontErrorMessage } from '../storefront-errors';
import { BrowsingHistoryPageContext } from '../storefront-page-contexts';
import { routeNavigateOptions, type RouteState } from '../storefront-router';
import { EmptyState, SubHeader } from '../storefront-ui/page-shell';
import { ProductSection } from '../storefront-ui/product-section';
import { MarketConfig, StorefrontLanguage } from '../types';

// TODO: Fix internal imports later

export interface BrowsingHistoryPageProps {
    api: ShopApi;
    productIds: string[];
    activityLoading?: boolean;
    activityError?: Error | null;
    onActivityRetry?: () => void;
    visitTimes?: ProductVisitTimes;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    onClear: () => void;
}

export function BrowsingHistoryPage() {
    const desktop = useDesktopLayout();
    const [period, setPeriod] = useState<VisitPeriod>('all');
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
        visitTimes = {},
        market,
        locale,
        language,
        onClear,
    } = BrowsingHistoryPageContext.useValue();
    const isZh = language === 'zh';
    const historyQuery = useProductsByIdsQuery({ api, productIds, market, language });
    const historyProducts = productIds.length ? (historyQuery.data ?? []) : [];
    const visibleProducts = filterProductsByVisitDate(historyProducts, visitTimes, period);
    const periods: Array<[VisitPeriod, string]> = [
        ['all', isZh ? '全部' : 'All'],
        ['today', isZh ? '今天' : 'Today'],
        ['yesterday', isZh ? '昨天' : 'Yesterday'],
        ['two-days-ago', isZh ? '前天' : '2 days ago'],
        ['earlier', isZh ? '更早' : 'Earlier'],
    ];
    const loading = activityLoading || (productIds.length > 0 && historyQuery.isLoading);
    const historyError = activityError
        ? storefrontErrorMessage(activityError, language)
        : !historyProducts.length && historyQuery.isPaused
          ? offlineLoadError(language)
          : !historyProducts.length && historyQuery.error instanceof Error
            ? storefrontErrorMessage(historyQuery.error, language)
            : '';

    return (
        <main className="page subpage history-page">
            {!desktop && (
                <SubHeader
                    title={isZh ? '浏览足迹' : 'Browsing history'}
                    language={language}
                    onBack={goBack}
                    actionVisibility="mobile"
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
            )}
            {historyProducts.length > 0 && (
                <div className="desktop-account-workbench-toolbar">
                    <div>
                        <h1>{isZh ? '最近浏览' : 'Recently viewed'}</h1>
                        <p>
                            {isZh
                                ? `共 ${historyProducts.length} 件商品`
                                : `${historyProducts.length} products`}
                        </p>
                    </div>
                    <div
                        className="history-periods"
                        role="group"
                        aria-label={isZh ? '浏览日期' : 'Visit date'}
                    >
                        {periods.map(([value, label]) => (
                            <button
                                type="button"
                                key={value}
                                aria-pressed={period === value}
                                onClick={() => setPeriod(value)}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    <button
                        type="button"
                        onClick={onClear}
                        aria-label={isZh ? '清空浏览足迹' : 'Clear browsing history'}
                    >
                        <Trash2 aria-hidden="true" />
                    </button>
                </div>
            )}
            {loading && !historyProducts.length ? (
                <PageSkeleton label={isZh ? '正在加载浏览足迹' : 'Loading browsing history'} />
            ) : historyError ? (
                <EmptyState
                    icon={<WifiOff />}
                    title={isZh ? '浏览足迹加载失败' : 'Could not load browsing history'}
                    detail={historyError}
                    action={isZh ? '重试' : 'Retry'}
                    onAction={() => (activityError ? onActivityRetry?.() : void historyQuery.refetch())}
                />
            ) : historyProducts.length ? (
                visibleProducts.length || !desktop ? (
                    <ProductSection
                        className="account-history-products"
                        title={desktop ? undefined : isZh ? '最近浏览' : 'Recently viewed'}
                        products={desktop ? visibleProducts : historyProducts}
                        market={market}
                        locale={locale}
                        language={language}
                        onProduct={product => navigateTo({ name: 'product', id: product.id })}
                    />
                ) : (
                    <EmptyState
                        icon={<Clock3 />}
                        title={isZh ? '这段时间没有浏览记录' : 'No visits during this period'}
                        detail={
                            isZh
                                ? '可以切换日期，或查看全部足迹。'
                                : 'Choose another date or view all visits.'
                        }
                        action={isZh ? '查看全部' : 'View all'}
                        onAction={() => setPeriod('all')}
                    />
                )
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
