import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouter } from '@tanstack/react-router';
import {
    Bell,
    ChevronRight,
    CircleCheck,
    CircleX,
    CreditCard,
    Package,
    RotateCcw,
    Store,
    Truck,
    WifiOff,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
// eslint-disable-next-line import/order -- organize-imports keeps relative type imports after packages.
import type { RouteState } from '../storefront-router';

import { ShopApi } from '../api';
import { formatBusinessDate } from '../business-time';
import { languageCodeFor } from '../i18n';
import { offlineLoadError } from '../loading-state';
import { PUBLIC_QUERY_GC_TIME, ROUTE_QUERY_STALE_TIME, storefrontQueryKeys } from '../query-client';
import { PageSkeleton } from '../route-loading';
import { storefrontErrorMessage } from '../storefront-errors';
import { goBackInStorefront } from '../storefront-navigation-history';
import { NotificationsPageContext } from '../storefront-page-contexts';
import { routeNavigateOptions } from '../storefront-router';
import { afterSalesNotification, orderNotification } from '../storefront-ui/order-ui';
import { EmptyState, Sheet, Subpage, SubpageBody } from '../storefront-ui/page-shell';
import { formatMoney } from '../storefront-ui/product-display';
import {
    ActiveCustomer,
    AfterSalesRequest,
    MarketConfig,
    OrderSummary,
    StoreNotificationReference,
    StorefrontLanguage,
} from '../types';

import '../styles/notifications.css';

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

type NotificationEntry = ReturnType<typeof recentNotificationEntries>[number];
type NotificationReadState = { keys: string[]; versions: string[] };

export function NotificationsPage() {
    const queryClient = useQueryClient();
    const [filter, setFilter] = useState<'all' | 'unread'>('all');
    const [marking, setMarking] = useState(false);
    const [readError, setReadError] = useState('');
    const [selected, setSelected] = useState<{
        entry: NotificationEntry;
        customerId: string;
        marketCode: string;
    } | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const filtersRef = useRef<HTMLDivElement | null>(null);
    const navigate = useNavigate();
    const navigateTo = (route: RouteState) => void navigate(routeNavigateOptions(route) as never);
    const router = useRouter();
    const goBack = () => goBackInStorefront(router);
    const { api, customer, market, locale, language } = NotificationsPageContext.useValue();
    useEffect(() => setSelected(null), [customer?.id, market.code]);
    const selectedEntry =
        selected?.customerId === customer?.id && selected?.marketCode === market.code ? selected.entry : null;
    const closeNotification = () => {
        setSelected(null);
        if (!triggerRef.current?.isConnected) {
            filtersRef.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus();
        }
    };
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
    // A source update changes the batch key, but unchanged versions keep their confirmed status.
    // Seed only from the exact private scope: store, currency, language and customer.
    const previousReadQuery = queryClient
        .getQueryCache()
        .findAll({ queryKey: readQueryKey.slice(0, -1) })
        .filter(query => query.state.data !== undefined)
        .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)[0];
    const readQuery = useQuery({
        queryKey: readQueryKey,
        initialData: () => previousReadQuery?.state.data as NotificationReadState | undefined,
        initialDataUpdatedAt: () => previousReadQuery?.state.dataUpdatedAt,
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
            return { keys, versions: references.map(notificationReferenceKey) };
        },
        enabled: Boolean(customer && references.length),
        staleTime: 0,
        gcTime: PUBLIC_QUERY_GC_TIME,
    });
    const readKeys = new Set(readQuery.data?.keys ?? []);
    const checkedVersions = new Set(readQuery.data?.versions ?? []);
    const allVersionsKnown = references.every(reference =>
        checkedVersions.has(notificationReferenceKey(reference)),
    );
    const readStatusKnown = allVersionsKnown && !readQuery.isError && !readQuery.isPaused;
    const unreadNotifications = notifications.filter(entry => {
        if (!entry.reference) return false;
        const key = notificationReferenceKey(entry.reference);
        return checkedVersions.has(key) && !readKeys.has(key);
    });
    const unreadCount = unreadNotifications.length;
    const visibleNotifications = filter === 'unread' ? unreadNotifications : notifications;
    const markRead = async (referencesToMark: StoreNotificationReference[]) => {
        if (!referencesToMark.length) return;
        setReadError('');
        setMarking(true);
        try {
            for (let offset = 0; offset < referencesToMark.length; offset += 100) {
                const saved = await api.contentReviewsApi.markNotificationsRead(
                    referencesToMark.slice(offset, offset + 100),
                );
                queryClient.setQueryData<NotificationReadState>(readQueryKey, previous => ({
                    keys: [...new Set([...(previous?.keys ?? []), ...saved])],
                    versions: [...new Set([...(previous?.versions ?? []), ...saved])],
                }));
            }
        } catch (error) {
            setReadError(storefrontErrorMessage(error, language));
        } finally {
            setMarking(false);
        }
    };
    return (
        <Subpage title={isZh ? '消息通知' : 'Notifications'} language={language} onBack={goBack}>
            <SubpageBody>
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
                      (afterSalesQuery.isError && afterSalesQuery.data === undefined)) &&
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
                        onAction={() => void afterSalesQuery.refetch({ cancelRefetch: false })}
                    />
                ) : orders.length || afterSalesRequests.length ? (
                    <section className="notification-workbench">
                        <div className="notification-toolbar">
                            <h2>{isZh ? '消息通知' : 'Notifications'}</h2>
                            <div
                                ref={filtersRef}
                                role="group"
                                aria-label={isZh ? '消息筛选' : 'Notification filter'}
                            >
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
                                    disabled={!readStatusKnown}
                                >
                                    {isZh ? '未读消息' : 'Unread'}{' '}
                                    <span className="notification-count">
                                        {readStatusKnown ? unreadCount : '—'}
                                    </span>
                                </button>
                            </div>
                            <button
                                type="button"
                                className="notification-mark-all"
                                onClick={() => void markRead(references)}
                                disabled={marking || !readStatusKnown || unreadCount === 0}
                            >
                                {marking
                                    ? isZh
                                        ? '保存中'
                                        : 'Saving'
                                    : isZh
                                      ? '全部标为已读'
                                      : 'Mark all read'}
                            </button>
                        </div>
                        {readQuery.isError && (
                            <p className="notification-read-error" role="alert">
                                {isZh ? '已读状态加载失败，请重试。' : 'Read status could not be loaded.'}{' '}
                                <button
                                    type="button"
                                    onClick={() => void readQuery.refetch({ cancelRefetch: false })}
                                >
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
                                const entryReadStatusKnown = Boolean(
                                    entry.reference &&
                                    checkedVersions.has(notificationReferenceKey(entry.reference)),
                                );
                                const isUnread = entryReadStatusKnown && !isRead;
                                const Icon =
                                    entry.kind === 'after-sales'
                                        ? RotateCcw
                                        : notificationOrderIcon(entry.order);
                                return (
                                    <button
                                        type="button"
                                        className={isUnread ? 'is-unread' : 'is-read'}
                                        key={
                                            entry.kind === 'after-sales'
                                                ? `after-sales-${entry.request.id}`
                                                : `order-${entry.order.id}`
                                        }
                                        aria-haspopup="dialog"
                                        onClick={event => {
                                            triggerRef.current = event.currentTarget;
                                            setReadError('');
                                            setSelected({
                                                entry,
                                                customerId: customer.id,
                                                marketCode: market.code,
                                            });
                                            if (entry.reference && readStatusKnown && !isRead)
                                                void markRead([entry.reference]);
                                        }}
                                    >
                                        <span className={`notification-icon is-${notification.tone}`}>
                                            <Icon aria-hidden="true" />
                                        </span>
                                        <span className="notification-content">
                                            <strong>{notification.title}</strong>
                                            <small>{notification.detail}</small>
                                        </span>
                                        <time
                                            className="notification-time"
                                            dateTime={
                                                entry.date && Number.isFinite(Date.parse(entry.date))
                                                    ? entry.date
                                                    : undefined
                                            }
                                        >
                                            {entry.date && Number.isFinite(Date.parse(entry.date))
                                                ? formatBusinessDate(locale, entry.date, {
                                                      month: 'short',
                                                      day: 'numeric',
                                                      hour: '2-digit',
                                                      minute: '2-digit',
                                                  })
                                                : '--'}
                                        </time>
                                        {entry.reference && entryReadStatusKnown && (
                                            <span className="notification-read-status">
                                                {isRead ? (isZh ? '已读' : 'Read') : isZh ? '未读' : 'Unread'}
                                            </span>
                                        )}
                                        <ChevronRight aria-hidden="true" />
                                    </button>
                                );
                            })}
                            {!visibleNotifications.length && (
                                <EmptyState
                                    compact
                                    icon={<Bell />}
                                    title={
                                        allVersionsKnown
                                            ? isZh
                                                ? '没有未读消息'
                                                : 'No unread notifications'
                                            : readQuery.isError || readQuery.isPaused
                                              ? isZh
                                                  ? '未读状态暂不可用'
                                                  : 'Unread status unavailable'
                                              : isZh
                                                ? '正在确认未读消息'
                                                : 'Checking unread notifications'
                                    }
                                    detail={
                                        isZh ? '新消息会显示在这里' : 'New notifications will appear here'
                                    }
                                />
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
            </SubpageBody>
            {selectedEntry && (
                <Sheet
                    title={isZh ? '消息详情' : 'Notification details'}
                    language={language}
                    side="right"
                    className="notification-detail-sheet"
                    onClose={closeNotification}
                >
                    <div className="notification-detail-body">
                        <NotificationDetailContent
                            entry={selectedEntry}
                            locale={locale}
                            language={language}
                            readLabel={
                                marking
                                    ? isZh
                                        ? '正在保存已读状态'
                                        : 'Saving read status'
                                    : !selectedEntry.reference || !readStatusKnown
                                      ? isZh
                                          ? '已读状态暂不可用'
                                          : 'Read status unavailable'
                                      : readKeys.has(notificationReferenceKey(selectedEntry.reference))
                                        ? isZh
                                            ? '已读'
                                            : 'Read'
                                        : isZh
                                          ? '未读'
                                          : 'Unread'
                            }
                        />
                        {(readError || readQuery.isError) && (
                            <p className="notification-read-error" role="alert">
                                {readError ||
                                    (isZh
                                        ? '已读状态加载失败，请重试。'
                                        : 'Read status could not be loaded.')}{' '}
                                <button
                                    type="button"
                                    disabled={marking}
                                    onClick={() => {
                                        if (readError && selectedEntry.reference)
                                            void markRead([selectedEntry.reference]);
                                        else void readQuery.refetch({ cancelRefetch: false });
                                    }}
                                >
                                    {isZh ? '重试' : 'Retry'}
                                </button>
                            </p>
                        )}
                    </div>
                    <footer className="notification-detail-footer">
                        <button type="button" onClick={closeNotification}>
                            {isZh ? '返回消息列表' : 'Back to notifications'}
                        </button>
                        <button
                            type="button"
                            className="primary-action"
                            onClick={() => {
                                closeNotification();
                                navigateTo(
                                    selectedEntry.kind === 'after-sales'
                                        ? { name: 'orders', tab: 'service' }
                                        : { name: 'order-detail', id: selectedEntry.order.id },
                                );
                            }}
                        >
                            {selectedEntry.kind === 'after-sales'
                                ? isZh
                                    ? '查看售后详情'
                                    : 'View after-sales'
                                : isZh
                                  ? '查看订单详情'
                                  : 'View order details'}
                            <ChevronRight aria-hidden="true" />
                        </button>
                    </footer>
                </Sheet>
            )}
        </Subpage>
    );
}

function NotificationDetailContent({
    entry,
    locale,
    language,
    readLabel,
}: {
    entry: NotificationEntry;
    locale: string;
    language: StorefrontLanguage;
    readLabel: string;
}) {
    const zh = language === 'zh';
    const notification =
        entry.kind === 'after-sales'
            ? afterSalesNotification(entry.request, language)
            : orderNotification(entry.order, language);
    const Icon = entry.kind === 'after-sales' ? RotateCcw : notificationOrderIcon(entry.order);
    const source = entry.kind === 'after-sales' ? entry.request : entry.order;
    const amount = entry.kind === 'after-sales' ? entry.request.requestedAmount : entry.order.totalWithTax;
    const products =
        entry.kind === 'after-sales'
            ? (entry.request.items ?? []).map(item => ({
                  id: item.id,
                  name: item.productName,
                  quantity: item.quantity,
              }))
            : (entry.order.lines ?? []).map(line => ({
                  id: line.id,
                  name: line.productVariant.name,
                  quantity: line.quantity,
              }));
    const date = entry.date && Number.isFinite(Date.parse(entry.date)) ? entry.date : undefined;
    return (
        <>
            <div className="notification-detail-heading">
                <span className={`notification-icon is-${notification.tone}`}>
                    <Icon aria-hidden="true" />
                </span>
                <div>
                    <span className="notification-detail-kind">
                        {entry.kind === 'after-sales'
                            ? zh
                                ? '售后通知'
                                : 'After-sales update'
                            : zh
                              ? '订单通知'
                              : 'Order update'}
                    </span>
                    <h2>{notification.title}</h2>
                    <div className="notification-detail-meta">
                        <time dateTime={date}>
                            {date
                                ? formatBusinessDate(locale, date, {
                                      year: 'numeric',
                                      month: 'short',
                                      day: 'numeric',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                  })
                                : '--'}
                        </time>
                        <span role="status">{readLabel}</span>
                    </div>
                </div>
            </div>
            <p className="notification-detail-copy">{notification.detail}</p>
            <section className="notification-detail-related">
                <h3>{zh ? '关联信息' : 'Related information'}</h3>
                <dl>
                    <div>
                        <dt>{zh ? '订单号' : 'Order number'}</dt>
                        <dd>{entry.kind === 'after-sales' ? entry.request.order.code : entry.order.code}</dd>
                    </div>
                    {entry.kind === 'after-sales' && (
                        <div>
                            <dt>{zh ? '售后单号' : 'Request number'}</dt>
                            <dd>{entry.request.code}</dd>
                        </div>
                    )}
                    {Number.isFinite(amount) && source.currencyCode && (
                        <div>
                            <dt>
                                {entry.kind === 'after-sales'
                                    ? zh
                                        ? '申请金额'
                                        : 'Requested amount'
                                    : zh
                                      ? '订单金额'
                                      : 'Order total'}
                            </dt>
                            <dd>{formatMoney(amount, source.currencyCode, locale)}</dd>
                        </div>
                    )}
                    {entry.kind === 'after-sales' && entry.request.approvedAmount != null && (
                        <div>
                            <dt>{zh ? '通过金额' : 'Approved amount'}</dt>
                            <dd>
                                {formatMoney(
                                    entry.request.approvedAmount,
                                    entry.request.currencyCode,
                                    locale,
                                )}
                            </dd>
                        </div>
                    )}
                </dl>
                {!!products.length && (
                    <ul>
                        {products.map(product => (
                            <li key={product.id}>
                                <span>{product.name}</span>
                                <small>×{product.quantity}</small>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
            {entry.kind === 'after-sales' && entry.request.resolution && (
                <section className="notification-detail-note">
                    <h3>{zh ? '处理说明' : 'Resolution'}</h3>
                    <p>{entry.request.resolution}</p>
                </section>
            )}
        </>
    );
}

function notificationOrderIcon(order: OrderSummary) {
    if (['AddingItems', 'ArrangingPayment'].includes(order.state)) return CreditCard;
    if (['PaymentAuthorized', 'PaymentSettled'].includes(order.state)) {
        return order.checkoutFulfillment?.containsDigitalProducts ? Package : Store;
    }
    if (['Shipped', 'PartiallyShipped'].includes(order.state)) return Truck;
    if (order.state === 'Delivered') return CircleCheck;
    if (order.state === 'Cancelled') return CircleX;
    return Bell;
}
