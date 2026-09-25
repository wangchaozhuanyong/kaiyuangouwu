import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { Bell, ChevronRight, RotateCcw, WifiOff } from 'lucide-react';
import { useState } from 'react';
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
import {
    ActiveCustomer,
    AfterSalesRequest,
    MarketConfig,
    OrderSummary,
    StoreNotificationReference,
    StorefrontLanguage,
} from '../types';

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
        ...orders.map(order => ({
            kind: 'order' as const,
            order,
            date: order.updatedAt ?? order.orderPlacedAt,
            reference: order.updatedAt
                ? {
                      kind: 'ORDER' as const,
                      sourceId: order.id,
                      version: order.updatedAt,
                  }
                : null,
        })),
        ...requests.map(request => ({
            kind: 'after-sales' as const,
            request,
            date: request.updatedAt,
            reference: {
                kind: 'AFTER_SALES' as const,
                sourceId: request.id,
                version: request.updatedAt,
            },
        })),
    ];
    const timestamp = (date: string | null | undefined) => {
        const value = date ? Date.parse(date) : NaN;
        return Number.isFinite(value) ? value : -Infinity;
    };
    return entries.sort((a, b) => timestamp(b.date) - timestamp(a.date));
}

export function notificationReferenceKey(reference: StoreNotificationReference): string {
    return `${reference.kind}:${reference.sourceId}:${new Date(reference.version).toISOString()}`;
}

export function NotificationsPage() {
    const queryClient = useQueryClient();
    const [filter, setFilter] = useState<'all' | 'unread'>('all');
    const [marking, setMarking] = useState(false);
    const [readError, setReadError] = useState('');
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
    const references = notifications.flatMap(entry => (entry.reference ? [entry.reference] : []));
    const referenceVersions = references.map(notificationReferenceKey).join('|');
    const readQueryKey = storefrontQueryKeys.notificationReads(
        storefrontQueryKeys.market(market),
        languageCodeFor(language),
        customer?.id ?? '',
        referenceVersions,
    );
    const readQuery = useQuery({
        queryKey: readQueryKey,
        queryFn: async ({ signal }) => {
            const keys: string[] = [];
            for (let offset = 0; offset < references.length; offset += 100) {
                keys.push(
                    ...(await api.contentReviewsApi.notificationReadKeys(
                        references.slice(offset, offset + 100),
                        signal,
                    )),
                );
            }
            return keys;
        },
        enabled: Boolean(customer && references.length),
        staleTime: 0,
        gcTime: PUBLIC_QUERY_GC_TIME,
    });
    const readKeys = new Set(readQuery.data ?? []);
    const unreadCount = notifications.filter(
        entry => entry.reference && !readKeys.has(notificationReferenceKey(entry.reference)),
    ).length;
    const visibleNotifications =
        filter === 'unread' && !readQuery.isError
            ? notifications.filter(
                  entry => !entry.reference || !readKeys.has(notificationReferenceKey(entry.reference)),
              )
            : notifications;
    const markRead = async (selected: StoreNotificationReference[]) => {
        if (!selected.length) return;
        setReadError('');
        setMarking(true);
        try {
            for (let offset = 0; offset < selected.length; offset += 100) {
                const saved = await api.contentReviewsApi.markNotificationsRead(
                    selected.slice(offset, offset + 100),
                );
                queryClient.setQueryData<string[]>(readQueryKey, previous => [
                    ...new Set([...(previous ?? []), ...saved]),
                ]);
            }
        } catch (error) {
            setReadError(storefrontErrorMessage(error, language));
        } finally {
            setMarking(false);
        }
    };
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
                <section className="notification-workbench">
                    <div className="notification-toolbar">
                        <h2>{isZh ? '消息通知' : 'Notifications'}</h2>
                        <div role="group" aria-label={isZh ? '消息筛选' : 'Notification filter'}>
                            <button
                                type="button"
                                className={filter === 'all' ? 'is-active' : ''}
                                onClick={() => setFilter('all')}
                                aria-pressed={filter === 'all'}
                            >
                                {isZh ? '全部消息' : 'All'}
                            </button>
                            <button
                                type="button"
                                className={filter === 'unread' ? 'is-active' : ''}
                                onClick={() => setFilter('unread')}
                                aria-pressed={filter === 'unread'}
                                disabled={readQuery.isLoading || readQuery.isError}
                            >
                                {isZh ? '未读消息' : 'Unread'}{' '}
                                {readQuery.isLoading ? '…' : readQuery.isError ? '—' : unreadCount}
                            </button>
                        </div>
                        <button
                            type="button"
                            className="notification-mark-all"
                            onClick={() => void markRead(references)}
                            disabled={
                                marking || readQuery.isLoading || readQuery.isError || unreadCount === 0
                            }
                        >
                            {marking ? (isZh ? '保存中' : 'Saving') : isZh ? '全部标为已读' : 'Mark all read'}
                        </button>
                    </div>
                    {readQuery.isError && (
                        <p className="notification-read-error" role="alert">
                            {isZh ? '已读状态加载失败，请重试。' : 'Read status could not be loaded.'}{' '}
                            <button type="button" onClick={() => void readQuery.refetch()}>
                                {isZh ? '重试' : 'Retry'}
                            </button>
                        </p>
                    )}
                    {readError && (
                        <p className="notification-read-error" role="alert">
                            {readError}
                        </p>
                    )}
                    <div
                        className="notification-list"
                        aria-label={isZh ? '最近通知' : 'Recent notifications'}
                    >
                        {visibleNotifications.map(entry => {
                            const notification =
                                entry.kind === 'after-sales'
                                    ? afterSalesNotification(entry.request, language)
                                    : orderNotification(entry.order, language);
                            const isRead = entry.reference
                                ? readKeys.has(notificationReferenceKey(entry.reference))
                                : false;
                            return (
                                <button
                                    type="button"
                                    className={isRead ? 'is-read' : 'is-unread'}
                                    key={
                                        entry.kind === 'after-sales'
                                            ? `after-sales-${entry.request.id}`
                                            : `order-${entry.order.id}`
                                    }
                                    onClick={() => {
                                        if (entry.reference && !isRead) void markRead([entry.reference]);
                                        navigateTo(
                                            entry.kind === 'after-sales'
                                                ? { name: 'orders', tab: 'service' }
                                                : { name: 'order-detail', id: entry.order.id },
                                        );
                                    }}
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
                                        {entry.reference && (
                                            <span className="notification-read-status">
                                                {isRead ? (isZh ? '已读' : 'Read') : isZh ? '未读' : 'Unread'}
                                            </span>
                                        )}
                                    </span>
                                    <ChevronRight aria-hidden="true" />
                                </button>
                            );
                        })}
                        {!visibleNotifications.length && (
                            <p className="notification-empty-filter">
                                {isZh ? '没有未读消息' : 'No unread notifications'}
                            </p>
                        )}
                    </div>
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
