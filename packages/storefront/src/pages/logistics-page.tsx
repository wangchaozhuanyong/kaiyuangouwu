import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ChevronRight, Package, RefreshCw, Search, UserRound, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';

import { ShopApi } from '../api';
import { languageCodeFor } from '../i18n';
import { offlineLoadError } from '../loading-state';
import { ORDER_STATUS_REFRESH_INTERVAL, orderStatusRefreshInterval } from '../order-refresh';
import { PUBLIC_QUERY_GC_TIME, storefrontQueryKeys } from '../query-client';
import { PageSkeleton } from '../route-loading';
import { storefrontErrorMessage } from '../storefront-errors';
import { routeNavigateOptions, type RouteState } from '../storefront-router';
import {
    DeliveryBadge,
    DeliveryDetails,
    DeliveryProducts,
    deliveryDate,
    deliveryLabel,
    deliveryStatus,
    deliveryUpdatedAt,
    physicalDeliveryLines,
    physicalFulfillments,
    type DeliveryFilter,
} from '../storefront-ui/delivery-details';
import { EmptyState, InlineError, Sheet, SubHeader, SubpageBody } from '../storefront-ui/page-shell';
import { ActiveCustomer, MarketConfig, StorefrontLanguage } from '../types';

export function LogisticsPage({
    api,
    customer,
    market,
    locale,
    language,
    onBack,
    onOpenOrder,
    route = { name: 'logistics' },
}: {
    api: ShopApi;
    customer: ActiveCustomer | null;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    onBack: () => void;
    onOpenOrder?: (orderId: string) => void;
    route?: RouteState;
}) {
    const navigate = useNavigate();
    const zh = language === 'zh';
    const filter = route.deliveryStatus ?? 'all';
    const [search, setSearch] = useState(route.term ?? '');
    const [deliveryOrderId, setDeliveryOrderId] = useState<string | null>(null);
    useEffect(() => setSearch(route.term ?? ''), [route.term]);
    useEffect(() => setDeliveryOrderId(null), [customer?.id, market.code, route.id]);
    const go = (next: RouteState, replace = false) =>
        void navigate({ ...routeNavigateOptions(next), replace } as never);
    const listRoute: RouteState = { name: 'logistics', deliveryStatus: filter, term: route.term };
    const marketKey = storefrontQueryKeys.market(market);
    const languageCode = languageCodeFor(language);
    const list = useInfiniteQuery({
        queryKey: storefrontQueryKeys.customerOrders(marketKey, languageCode, customer?.id ?? '', {
            view: 'logistics',
        }),
        queryFn: ({ pageParam, signal }) => api.customerOrders(pageParam, 10, undefined, undefined, signal),
        initialPageParam: 0,
        getNextPageParam: (lastPage, pages) => {
            const loaded = pages.reduce((count, page) => count + page.items.length, 0);
            return loaded < lastPage.totalItems ? loaded : undefined;
        },
        enabled: Boolean(customer) && !route.id,
        staleTime: 0,
        refetchOnMount: 'always',
        refetchInterval: query =>
            query.state.data?.pages.some(page =>
                page.items.some(order => orderStatusRefreshInterval(order.state)),
            )
                ? ORDER_STATUS_REFRESH_INTERVAL
                : false,
        gcTime: PUBLIC_QUERY_GC_TIME,
    });
    const detailId = route.id ?? deliveryOrderId ?? '';
    const detail = useQuery({
        queryKey: storefrontQueryKeys.order(marketKey, languageCode, customer?.id ?? '', detailId),
        queryFn: ({ signal }) => api.order(detailId, signal),
        enabled: Boolean(customer && detailId),
        staleTime: 0,
        refetchOnMount: 'always',
        refetchInterval: query => orderStatusRefreshInterval(query.state.data?.state),
        gcTime: PUBLIC_QUERY_GC_TIME,
    });
    const activeQuery = route.id ? detail : list;
    const error = activeQuery.isPaused
        ? offlineLoadError(language)
        : activeQuery.error
          ? storefrontErrorMessage(activeQuery.error, language)
          : '';
    const orders = [
        ...new Map(
            (list.data?.pages.flatMap(page => page.items) ?? []).map(order => [order.id, order]),
        ).values(),
    ]
        .filter(
            order =>
                physicalDeliveryLines(order).length &&
                (!['AddingItems', 'ArrangingPayment'].includes(order.state) ||
                    physicalFulfillments(order.fulfillments ?? []).length),
        )
        .sort((a, b) => Date.parse(deliveryUpdatedAt(b) ?? '') - Date.parse(deliveryUpdatedAt(a) ?? ''));
    const term = route.term?.trim().toLocaleLowerCase() ?? '';
    const visible = orders.filter(
        order =>
            (filter === 'all' || deliveryStatus(order) === filter) &&
            (!term ||
                [
                    order.code,
                    order.checkoutShipping?.methodName,
                    ...physicalDeliveryLines(order).map(line => line.productVariant.name),
                    ...physicalFulfillments(order.fulfillments ?? []).flatMap(item => [
                        item.method,
                        item.trackingCode,
                    ]),
                ].some(value => value?.toLocaleLowerCase().includes(term))),
    );
    const selectedOrder = detail.data;
    const detailError = detail.isPaused
        ? offlineLoadError(language)
        : detail.error
          ? storefrontErrorMessage(detail.error, language)
          : '';
    const filters: DeliveryFilter[] = ['all', 'preparing', 'transit', 'delivered', 'cancelled'];
    const toOrder = (id: string) => {
        setDeliveryOrderId(null);
        if (onOpenOrder) {
            onOpenOrder(id);
            return;
        }
        go({
            name: 'order-detail',
            id,
            source: route.id ? 'logistics-detail' : 'logistics',
            deliveryStatus: filter,
            term: route.term,
        });
    };

    return (
        <main className="page subpage logistics-page delivery-workspace">
            <SubHeader
                title={
                    route.id ? (zh ? '物流详情' : 'Delivery details') : zh ? '物流动态' : 'Delivery updates'
                }
                language={language}
                onBack={route.id ? () => go(listRoute) : onBack}
            />
            <SubpageBody>
                {!customer ? (
                    <EmptyState
                        icon={<UserRound />}
                        title={zh ? '登录后查看物流' : 'Sign in to view deliveries'}
                        detail={zh ? '实物订单的配送进度集中显示在这里' : 'Track your physical orders here'}
                        action={zh ? '去登录' : 'Sign in'}
                        onAction={() => go({ name: 'login' })}
                    />
                ) : route.id ? (
                    <div className="delivery-detail-page">
                        <h1 className="delivery-desktop-title">{zh ? '物流详情' : 'Delivery details'}</h1>
                        <button className="delivery-back-link" type="button" onClick={() => go(listRoute)}>
                            <ArrowLeft aria-hidden="true" />
                            {zh ? '返回物流列表' : 'Back to deliveries'}
                        </button>
                        {detail.isLoading ? (
                            <PageSkeleton label={zh ? '正在加载物流详情' : 'Loading delivery details'} />
                        ) : error && !selectedOrder ? (
                            <EmptyState
                                icon={<WifiOff />}
                                title={zh ? '物流详情加载失败' : 'Could not load delivery'}
                                detail={error}
                                action={zh ? '重试' : 'Retry'}
                                onAction={() => void detail.refetch({ cancelRefetch: false })}
                            />
                        ) : !selectedOrder || !physicalDeliveryLines(selectedOrder).length ? (
                            <EmptyState
                                icon={<Package />}
                                title={zh ? '暂无可查看的配送信息' : 'No delivery information'}
                                detail={
                                    zh
                                        ? '该订单不存在或不包含实物商品'
                                        : 'This order is unavailable or has no physical products'
                                }
                            />
                        ) : (
                            <>
                                <div className="delivery-detail-layout">
                                    <section className="delivery-detail-main">
                                        <DeliveryDetails
                                            order={selectedOrder}
                                            locale={locale}
                                            language={language}
                                        />
                                    </section>
                                    <aside className="delivery-order-aside">
                                        <span className="delivery-eyebrow">
                                            {zh ? '关联订单' : 'Related order'}
                                        </span>
                                        <h2>{selectedOrder.code}</h2>
                                        <p>{deliveryDate(selectedOrder.orderPlacedAt, locale)}</p>
                                        <DeliveryProducts order={selectedOrder} language={language} />
                                        <button
                                            className="delivery-primary-link"
                                            type="button"
                                            onClick={() => toOrder(selectedOrder.id)}
                                        >
                                            {zh ? '查看订单详情' : 'View order details'}
                                            <ChevronRight aria-hidden="true" />
                                        </button>
                                        <button
                                            className="delivery-text-button"
                                            type="button"
                                            onClick={() =>
                                                go({ name: 'support', orderCode: selectedOrder.code })
                                            }
                                        >
                                            {zh ? '联系商家' : 'Contact merchant'}
                                        </button>
                                    </aside>
                                </div>
                                {error && (
                                    <InlineError
                                        message={error}
                                        action={zh ? '重试' : 'Retry'}
                                        onAction={() => void detail.refetch({ cancelRefetch: false })}
                                    />
                                )}
                            </>
                        )}
                    </div>
                ) : (
                    <div className="delivery-overview">
                        <h1 className="sr-only">{zh ? '物流动态' : 'Delivery updates'}</h1>
                        <div className="delivery-list-surface">
                            <div className="delivery-toolbar">
                                <nav
                                    className="delivery-filters"
                                    aria-label={zh ? '物流状态筛选' : 'Delivery status'}
                                >
                                    {filters.map(value => (
                                        <button
                                            type="button"
                                            key={value}
                                            aria-pressed={filter === value}
                                            onClick={() => go({ ...listRoute, deliveryStatus: value }, true)}
                                        >
                                            {value === 'all'
                                                ? zh
                                                    ? '全部'
                                                    : 'All'
                                                : deliveryLabel(value, language)}
                                            <span>
                                                {list.data
                                                    ? orders.filter(
                                                          item =>
                                                              value === 'all' ||
                                                              deliveryStatus(item) === value,
                                                      ).length
                                                    : '—'}
                                            </span>
                                        </button>
                                    ))}
                                </nav>
                                <div className="delivery-toolbar-actions">
                                    <form
                                        className="delivery-search"
                                        onSubmit={event => {
                                            event.preventDefault();
                                            go({ ...listRoute, term: search.trim() || undefined }, true);
                                        }}
                                    >
                                        <Search aria-hidden="true" />
                                        <input
                                            aria-label={
                                                zh
                                                    ? '搜索已加载的订单、商品或运单号'
                                                    : 'Search loaded orders, products or tracking numbers'
                                            }
                                            placeholder={
                                                zh ? '订单、商品、运单号' : 'Order, item or tracking no.'
                                            }
                                            value={search}
                                            onChange={event => setSearch(event.target.value)}
                                        />
                                        <button type="submit">{zh ? '搜索' : 'Search'}</button>
                                    </form>
                                    <button
                                        type="button"
                                        className="delivery-refresh-button"
                                        disabled={list.isFetching}
                                        aria-busy={list.isFetching}
                                        onClick={() => void list.refetch({ cancelRefetch: false })}
                                    >
                                        <RefreshCw aria-hidden="true" />
                                        {list.isFetching
                                            ? zh
                                                ? '更新中'
                                                : 'Updating'
                                            : zh
                                              ? '刷新'
                                              : 'Refresh'}
                                    </button>
                                </div>
                            </div>
                            <div className="delivery-list-caption">
                                <span>
                                    {list.data
                                        ? zh
                                            ? `已加载 ${orders.length} 个配送订单 · 当前显示 ${visible.length} 个`
                                            : `${orders.length} delivery orders loaded · ${visible.length} shown`
                                        : zh
                                          ? '正在读取配送订单'
                                          : 'Loading delivery orders'}
                                </span>
                                <span>{zh ? '按最近更新排序' : 'Latest update first'}</span>
                            </div>
                            {list.isLoading ? (
                                <PageSkeleton label={zh ? '正在加载物流信息' : 'Loading deliveries'} />
                            ) : error && !list.data ? (
                                <EmptyState
                                    icon={<WifiOff />}
                                    title={zh ? '物流信息加载失败' : 'Could not load deliveries'}
                                    detail={error}
                                    action={zh ? '重试' : 'Retry'}
                                    onAction={() => void list.refetch({ cancelRefetch: false })}
                                />
                            ) : visible.length ? (
                                <div className="delivery-table-scroll">
                                    <table className="delivery-table">
                                        <caption className="sr-only">
                                            {zh ? '配送订单' : 'Delivery orders'}
                                        </caption>
                                        <thead>
                                            <tr>
                                                {[
                                                    zh ? '订单 / 商品' : 'Order / products',
                                                    zh ? '配送状态' : 'Status',
                                                    zh ? '配送方式 / 运单' : 'Method / tracking',
                                                    zh ? '最近更新' : 'Updated',
                                                    zh ? '操作' : 'Actions',
                                                ].map(label => (
                                                    <th key={label} scope="col">
                                                        {label}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {visible.map(item => {
                                                const packages = physicalFulfillments(
                                                    item.fulfillments ?? [],
                                                );
                                                const latest = [...packages].sort(
                                                    (a, b) =>
                                                        Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
                                                )[0];
                                                return (
                                                    <tr key={item.id}>
                                                        <td className="delivery-order-cell">
                                                            <button
                                                                type="button"
                                                                className="delivery-order-number"
                                                                title={item.code}
                                                                onClick={() => toOrder(item.id)}
                                                            >
                                                                {item.code}
                                                            </button>
                                                            <DeliveryProducts
                                                                order={item}
                                                                language={language}
                                                            />
                                                        </td>
                                                        <td data-label={zh ? '配送状态' : 'Status'}>
                                                            <DeliveryBadge
                                                                status={deliveryStatus(item)}
                                                                partial={item.state === 'PartiallyShipped'}
                                                                language={language}
                                                            />
                                                            {packages.length > 1 && (
                                                                <small className="delivery-cell-note">
                                                                    {zh
                                                                        ? `${packages.length} 个包裹`
                                                                        : `${packages.length} packages`}
                                                                </small>
                                                            )}
                                                        </td>
                                                        <td
                                                            data-label={
                                                                zh ? '配送方式 / 运单' : 'Method / tracking'
                                                            }
                                                        >
                                                            <span className="delivery-method">
                                                                {latest?.method ||
                                                                    item.checkoutShipping?.methodName ||
                                                                    (zh ? '待安排配送' : 'Delivery pending')}
                                                            </span>
                                                            <code>
                                                                {latest?.trackingCode ||
                                                                    (zh
                                                                        ? '暂无运单号'
                                                                        : 'No tracking number')}
                                                            </code>
                                                        </td>
                                                        <td data-label={zh ? '最近更新' : 'Updated'}>
                                                            <time
                                                                dateTime={
                                                                    deliveryUpdatedAt(item) ?? undefined
                                                                }
                                                            >
                                                                {deliveryDate(
                                                                    deliveryUpdatedAt(item),
                                                                    locale,
                                                                )}
                                                            </time>
                                                        </td>
                                                        <td className="delivery-row-actions">
                                                            <button
                                                                type="button"
                                                                onClick={() => setDeliveryOrderId(item.id)}
                                                                aria-haspopup="dialog"
                                                            >
                                                                {zh ? '查看物流' : 'Track delivery'}
                                                                <ChevronRight aria-hidden="true" />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => toOrder(item.id)}
                                                                aria-haspopup={
                                                                    onOpenOrder ? 'dialog' : undefined
                                                                }
                                                            >
                                                                {zh ? '订单详情' : 'Order details'}
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <EmptyState
                                    icon={<Package />}
                                    title={
                                        term || filter !== 'all'
                                            ? zh
                                                ? '未找到匹配的配送订单'
                                                : 'No matching deliveries'
                                            : zh
                                              ? '暂无物流动态'
                                              : 'No deliveries yet'
                                    }
                                    detail={
                                        list.hasNextPage
                                            ? zh
                                                ? '当前已加载的记录中没有匹配项，可继续加载更多订单。'
                                                : 'No match in loaded records. Load more orders below.'
                                            : zh
                                              ? '可以清除筛选，或在完成实物商品购买后查看配送进度。'
                                              : 'Clear filters or check back after purchasing physical products.'
                                    }
                                    action={
                                        term || filter !== 'all'
                                            ? zh
                                                ? '清除筛选'
                                                : 'Clear filters'
                                            : undefined
                                    }
                                    onAction={() => go({ name: 'logistics' }, true)}
                                />
                            )}
                            {error && list.data && (
                                <InlineError
                                    message={error}
                                    action={zh ? '重试' : 'Retry'}
                                    onAction={() => void list.refetch({ cancelRefetch: false })}
                                />
                            )}
                            <footer className="delivery-list-footer">
                                <small>
                                    {zh
                                        ? '筛选和搜索作用于已加载订单'
                                        : 'Filters and search apply to loaded orders'}
                                </small>
                                {list.hasNextPage ? (
                                    <button
                                        className="delivery-text-button"
                                        type="button"
                                        disabled={list.isFetchingNextPage}
                                        onClick={() => void list.fetchNextPage({ cancelRefetch: false })}
                                    >
                                        {list.isFetchingNextPage
                                            ? zh
                                                ? '加载中…'
                                                : 'Loading…'
                                            : zh
                                              ? '加载更多订单'
                                              : 'Load more orders'}
                                    </button>
                                ) : (
                                    list.data && (
                                        <small>
                                            {zh ? '已显示全部配送订单' : 'All delivery orders loaded'}
                                        </small>
                                    )
                                )}
                            </footer>
                        </div>
                    </div>
                )}
            </SubpageBody>
            {deliveryOrderId && customer && (
                <Sheet
                    title={zh ? '物流详情' : 'Delivery details'}
                    language={language}
                    side="right"
                    className="delivery-detail-sheet"
                    onClose={() => setDeliveryOrderId(null)}
                >
                    <div className="delivery-detail-sheet-body">
                        {detailError && !selectedOrder ? (
                            <EmptyState
                                icon={<WifiOff />}
                                title={zh ? '物流详情加载失败' : 'Could not load delivery'}
                                detail={detailError}
                                action={zh ? '重试' : 'Retry'}
                                onAction={() => void detail.refetch({ cancelRefetch: false })}
                            />
                        ) : detail.isLoading ? (
                            <PageSkeleton label={zh ? '正在加载物流详情' : 'Loading delivery details'} />
                        ) : !selectedOrder || !physicalDeliveryLines(selectedOrder).length ? (
                            <EmptyState
                                icon={<Package />}
                                title={zh ? '暂无可查看的配送信息' : 'No delivery information'}
                                detail={
                                    zh
                                        ? '该订单不存在或不包含实物商品'
                                        : 'This order is unavailable or has no physical products'
                                }
                            />
                        ) : (
                            <>
                                {detailError && (
                                    <InlineError
                                        message={detailError}
                                        action={zh ? '重试' : 'Retry'}
                                        onAction={() => void detail.refetch({ cancelRefetch: false })}
                                    />
                                )}
                                <DeliveryDetails
                                    key={selectedOrder.id}
                                    order={selectedOrder}
                                    locale={locale}
                                    language={language}
                                />
                                <section className="delivery-drawer-order">
                                    <header>
                                        <h3>{zh ? '关联订单' : 'Related order'}</h3>
                                        <span>{selectedOrder.code}</span>
                                    </header>
                                    <DeliveryProducts order={selectedOrder} language={language} />
                                </section>
                            </>
                        )}
                    </div>
                    {selectedOrder && physicalDeliveryLines(selectedOrder).length > 0 && (
                        <footer className="order-detail-sheet-footer">
                            <div className="order-detail-actions">
                                <button
                                    type="button"
                                    onClick={() => go({ name: 'support', orderCode: selectedOrder.code })}
                                >
                                    {zh ? '联系商家' : 'Contact merchant'}
                                </button>
                                <button
                                    type="button"
                                    className="primary-action"
                                    onClick={() => toOrder(selectedOrder.id)}
                                >
                                    {zh ? '查看订单详情' : 'View order details'}
                                    <ChevronRight aria-hidden="true" />
                                </button>
                            </div>
                        </footer>
                    )}
                </Sheet>
            )}
        </main>
    );
}
