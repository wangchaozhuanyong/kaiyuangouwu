import { useQuery } from '@tanstack/react-query';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { Bell, ChevronRight, RotateCcw, WifiOff } from 'lucide-react';
// eslint-disable-next-line import/order -- organize-imports keeps relative type imports after packages.
import type { RouteState } from '../storefront-router';

import { ShopApi } from '../api';
import { formatBusinessDate } from '../business-time';
import { languageCodeFor } from '../i18n';
import { offlineLoadError } from '../loading-state';
import { PUBLIC_QUERY_GC_TIME, ROUTE_QUERY_STALE_TIME, storefrontQueryKeys } from '../query-client';
import { PageSkeleton } from '../route-loading';
import { storefrontErrorMessage } from '../storefront-errors';
import { NotificationsPageContext } from '../storefront-page-contexts';
import { routeNavigateOptions } from '../storefront-router';
import { afterSalesNotification, orderNotification } from '../storefront-ui/order-ui';
import { EmptyState, Subpage } from '../storefront-ui/page-shell';
import { ActiveCustomer, AfterSalesRequest, MarketConfig, OrderSummary, StorefrontLanguage } from '../types';

// TODO: Fix internal imports later

export interface NotificationsPageProps {
    api: ShopApi;
    customer: ActiveCustomer | null;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
}

export function recentNotificationEntries(orders: OrderSummary[], requests: AfterSalesRequest[]) {
    const entries = [
        ...orders.map(order => ({ kind: 'order' as const, order, date: order.orderPlacedAt })),
        ...requests.map(request => ({ kind: 'after-sales' as const, request, date: request.updatedAt })),
    ];
    const timestamp = (date: string | null | undefined) => {
        const value = date ? Date.parse(date) : NaN;
        return Number.isFinite(value) ? value : -Infinity;
    };
    return entries.sort((a, b) => timestamp(b.date) - timestamp(a.date));
}

export function NotificationsPage() {
    const navigate = useNavigate();
    const navigateTo = (route: RouteState) => void navigate(routeNavigateOptions(route) as never);
    const router = useRouter();
    const goBack = () => router.history.back();
    const { api, customer, market, locale, language } = NotificationsPageContext.useValue();
    const isZh = language === 'zh';
    const orders = customer?.orders.items ?? [];
    const afterSalesQuery = useQuery({
        queryKey: storefrontQueryKeys.afterSalesRequests(
            storefrontQueryKeys.market(market),
            languageCodeFor(language),
            customer?.id ?? '',
        ),
        queryFn: ({ signal }) => api.afterSalesRequests(signal),
        enabled: Boolean(customer),
        staleTime: ROUTE_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
    });
    const afterSalesRequests = afterSalesQuery.data ?? [];
    const notifications = recentNotificationEntries(orders, afterSalesRequests);
    return (
        <Subpage title={isZh ? '消息通知' : 'Notifications'} language={language} onBack={goBack}>
            {!customer ? (
                <EmptyState
                    icon={<Bell />}
                    title={isZh ? '登录后查看通知' : 'Sign in to view notifications'}
                    detail={isZh ? '订单状态更新会显示在这里' : 'Order status updates will appear here'}
                    action={isZh ? '去登录' : 'Sign in'}
                    onAction={() => navigateTo({ name: 'login' })}
                />
            ) : afterSalesQuery.isLoading && !orders.length ? (
                <PageSkeleton label={isZh ? '正在加载通知' : 'Loading notifications'} />
            ) : ((afterSalesQuery.isPaused && afterSalesQuery.data === undefined) ||
                  afterSalesQuery.isError) &&
              !orders.length ? (
                <EmptyState
                    icon={<WifiOff />}
                    title={isZh ? '消息加载失败' : 'Could not load notifications'}
                    detail={
                        afterSalesQuery.isPaused
                            ? offlineLoadError(language)
                            : afterSalesQuery.error instanceof Error
                              ? storefrontErrorMessage(afterSalesQuery.error, language)
                              : ''
                    }
                    action={isZh ? '重试' : 'Retry'}
                    onAction={() => void afterSalesQuery.refetch()}
                />
            ) : orders.length || afterSalesRequests.length ? (
                <section
                    className="notification-list"
                    aria-label={isZh ? '最近通知' : 'Recent notifications'}
                >
                    {notifications.map(entry => {
                        const notification =
                            entry.kind === 'after-sales'
                                ? afterSalesNotification(entry.request, language)
                                : orderNotification(entry.order, language);
                        return (
                            <button
                                type="button"
                                key={
                                    entry.kind === 'after-sales'
                                        ? `after-sales-${entry.request.id}`
                                        : `order-${entry.order.id}`
                                }
                                onClick={() =>
                                    navigateTo(
                                        entry.kind === 'after-sales'
                                            ? { name: 'orders', tab: 'service' }
                                            : { name: 'order-detail', id: entry.order.id },
                                    )
                                }
                            >
                                <span className={`notification-icon is-${notification.tone}`}>
                                    {entry.kind === 'after-sales' ? (
                                        <RotateCcw aria-hidden="true" />
                                    ) : (
                                        <Bell aria-hidden="true" />
                                    )}
                                </span>
                                <span>
                                    <strong>{notification.title}</strong>
                                    <small>{notification.detail}</small>
                                    <em>
                                        {entry.date && Number.isFinite(Date.parse(entry.date))
                                            ? formatBusinessDate(locale, entry.date, {
                                                  month: 'short',
                                                  day: 'numeric',
                                                  hour: '2-digit',
                                                  minute: '2-digit',
                                              })
                                            : '--'}
                                    </em>
                                </span>
                                <ChevronRight aria-hidden="true" />
                            </button>
                        );
                    })}
                </section>
            ) : (
                <EmptyState
                    icon={<Bell />}
                    title={isZh ? '暂无消息' : 'No notifications'}
                    detail={isZh ? '订单状态更新会显示在这里' : 'Order status updates will appear here'}
                    action={isZh ? '返回首页' : 'Back to home'}
                    onAction={() => navigateTo({ name: 'home' })}
                />
            )}
        </Subpage>
    );
}
