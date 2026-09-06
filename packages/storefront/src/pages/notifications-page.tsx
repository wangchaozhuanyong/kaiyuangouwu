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
import { NotificationsPageContext } from '../storefront-page-contexts';
import { routeNavigateOptions } from '../storefront-router';
import { afterSalesNotification, orderNotification } from '../storefront-ui/order-ui';
import { EmptyState, Subpage } from '../storefront-ui/page-shell';
import { ActiveCustomer, MarketConfig, StorefrontLanguage } from '../types';

// TODO: Fix internal imports later

export interface NotificationsPageProps {
    api: ShopApi;
    customer: ActiveCustomer | null;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
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
                              ? afterSalesQuery.error.message
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
                    {afterSalesRequests.map(request => {
                        const notification = afterSalesNotification(request, language);
                        return (
                            <button
                                type="button"
                                key={`after-sales-${request.id}`}
                                onClick={() => navigateTo({ name: 'orders', tab: 'service' })}
                            >
                                <span className={`notification-icon is-${notification.tone}`}>
                                    <RotateCcw aria-hidden="true" />
                                </span>
                                <span>
                                    <strong>{notification.title}</strong>
                                    <small>{notification.detail}</small>
                                    <em>
                                        {formatBusinessDate(locale, request.updatedAt, {
                                            month: 'short',
                                            day: 'numeric',
                                            hour: '2-digit',
                                            minute: '2-digit',
                                        })}
                                    </em>
                                </span>
                                <ChevronRight aria-hidden="true" />
                            </button>
                        );
                    })}
                    {orders.map(order => {
                        const notification = orderNotification(order, language);
                        return (
                            <button
                                type="button"
                                key={order.id}
                                onClick={() => navigateTo({ name: 'order-detail', id: order.id })}
                            >
                                <span className={`notification-icon is-${notification.tone}`}>
                                    <Bell aria-hidden="true" />
                                </span>
                                <span>
                                    <strong>{notification.title}</strong>
                                    <small>{notification.detail}</small>
                                    <em>
                                        {order.orderPlacedAt
                                            ? formatBusinessDate(locale, order.orderPlacedAt, {
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
