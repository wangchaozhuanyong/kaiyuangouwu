import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    ArrowLeft,
    ChevronRight,
    CircleAlert,
    CircleCheck,
    Clock3,
    Download,
    Navigation,
    Package,
    PackageCheck,
    RotateCcw,
    Search,
    Truck,
    UserRound,
    WifiOff,
    X,
} from 'lucide-react';
import { FormEvent, ReactNode, useEffect, useId, useRef, useState } from 'react';

import { ShopApi } from './api';
import { formatBusinessDate } from './business-time';
import { languageCodeFor } from './i18n';
import { offlineLoadError } from './loading-state';
import { ORDER_STATUS_REFRESH_INTERVAL, orderNeedsStatusRefresh } from './order-refresh';
import { PUBLIC_QUERY_GC_TIME, ROUTE_QUERY_STALE_TIME, storefrontQueryKeys } from './query-client';
import { responsiveImageSources } from './responsive-image';
import { PageSkeleton } from './route-loading';
import { TaxSummaryRows } from './tax-summary';
import {
    ActiveCustomer,
    AfterSalesReason,
    AfterSalesRequest,
    AfterSalesState,
    AfterSalesType,
    CreateAfterSalesRequestInput,
    MarketConfig,
    Order,
    OrderSummary,
    ProductVariant,
    StorefrontLanguage,
} from './types';

export type OrderTab = 'all' | 'pending' | 'shipping' | 'receiving' | 'service';
type OrderRoute = { name: 'login' | 'order-detail'; id?: string };
type LogisticsFilter = 'all' | 'transit' | 'preparing' | 'delivered';
type LogisticsStatus = Exclude<LogisticsFilter, 'all'> | 'cancelled';

export function OrdersPage({
    api,
    customer,
    market,
    locale,
    language,
    storefrontName,
    initialTab,
    onBack,
    onNavigate,
    onBuyAgain,
    onNotify,
}: {
    api: ShopApi;
    customer: ActiveCustomer | null;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    storefrontName: string;
    initialTab: OrderTab;
    onBack: () => void;
    onNavigate: (route: OrderRoute) => void;
    onBuyAgain: (order: OrderSummary) => Promise<void>;
    onNotify: (message: string) => void;
}) {
    const isZh = language === 'zh';
    const [tab, setTab] = useState<OrderTab>(initialTab);
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchInput, setSearchInput] = useState('');
    const [orderCode, setOrderCode] = useState('');
    const pageSize = 10;
    const queryClient = useQueryClient();
    const ordersQuery = useInfiniteQuery({
        queryKey: storefrontQueryKeys.customerOrders(
            market.code,
            languageCodeFor(language),
            customer?.id ?? '',
            { tab, orderCode },
        ),
        queryFn: ({ pageParam, signal }) =>
            api.customerOrders(pageParam, pageSize, orderStatesForTab(tab), orderCode, signal),
        initialPageParam: 0,
        getNextPageParam: (lastPage, pages) => {
            const loaded = pages.reduce((total, page) => total + page.items.length, 0);
            return loaded < lastPage.totalItems ? loaded : undefined;
        },
        enabled: !!customer && tab !== 'service',
        staleTime: 0,
        refetchOnMount: 'always',
        refetchInterval: query =>
            query.state.data?.pages.some(page =>
                page.items.some(order => orderNeedsStatusRefresh(order.state)),
            )
                ? ORDER_STATUS_REFRESH_INTERVAL
                : false,
        gcTime: PUBLIC_QUERY_GC_TIME,
    });
    const orders = Array.from(
        new Map(
            (ordersQuery.data?.pages.flatMap(page => page.items) ?? []).map(order => [order.id, order]),
        ).values(),
    );
    const afterSalesQuery = useQuery({
        queryKey: storefrontQueryKeys.afterSalesRequests(
            market.code,
            languageCodeFor(language),
            customer?.id ?? '',
        ),
        queryFn: ({ signal }) => api.afterSalesRequests(signal),
        enabled: Boolean(customer) && tab === 'service',
        staleTime: ROUTE_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
    });
    const [cancellingAfterSalesId, setCancellingAfterSalesId] = useState('');
    const cancelAfterSales = async (id: string) => {
        if (cancellingAfterSalesId) return;
        setCancellingAfterSalesId(id);
        try {
            const cancelled = await api.cancelAfterSalesRequest(id);
            queryClient.setQueryData<AfterSalesRequest[]>(
                storefrontQueryKeys.afterSalesRequests(
                    market.code,
                    languageCodeFor(language),
                    customer?.id ?? '',
                ),
                current => current?.map(item => (item.id === cancelled.id ? cancelled : item)) ?? [cancelled],
            );
            onNotify(isZh ? '售后申请已撤销' : 'After-sales request cancelled');
        } catch (requestError) {
            onNotify(
                requestError instanceof Error
                    ? requestError.message
                    : isZh
                      ? '撤销售后申请失败'
                      : 'Could not cancel the request',
            );
        } finally {
            setCancellingAfterSalesId('');
        }
    };
    const totalItems = ordersQuery.data?.pages[0]?.totalItems ?? 0;
    const loading = ordersQuery.isLoading;
    const loadingMore = ordersQuery.isFetchingNextPage;
    const listError =
        ordersQuery.isPaused && ordersQuery.data === undefined
            ? offlineLoadError(language)
            : ordersQuery.error instanceof Error
              ? ordersQuery.error.message
              : ordersQuery.error
                ? isZh
                    ? '订单加载失败'
                    : 'Could not load orders'
                : '';
    const tabs: Array<{ id: OrderTab; label: string }> = [
        { id: 'all', label: isZh ? '全部' : 'All' },
        { id: 'pending', label: isZh ? '待付款' : 'To pay' },
        { id: 'shipping', label: isZh ? '待发货' : 'To ship' },
        { id: 'receiving', label: isZh ? '待收货' : 'To receive' },
        { id: 'service', label: isZh ? '售后' : 'After-sales' },
    ];

    useEffect(() => setTab(initialTab), [initialTab]);

    return (
        <main className="page subpage orders-page">
            <SubHeader
                title={isZh ? '我的订单' : 'My orders'}
                language={language}
                onBack={onBack}
                action={
                    <button
                        type="button"
                        onClick={() => setSearchOpen(value => !value)}
                        aria-label={isZh ? '搜索订单' : 'Search orders'}
                        aria-expanded={searchOpen}
                    >
                        {searchOpen ? <X /> : <Search />}
                    </button>
                }
            />
            <nav className="order-tabs">
                {tabs.map(item => (
                    <button
                        type="button"
                        key={item.id}
                        className={tab === item.id ? 'is-active' : undefined}
                        onClick={() => setTab(item.id)}
                    >
                        {item.label}
                    </button>
                ))}
            </nav>
            {searchOpen && (
                <form
                    className="order-search"
                    onSubmit={event => {
                        event.preventDefault();
                        setOrderCode(searchInput.trim());
                    }}
                >
                    <Search aria-hidden="true" />
                    <input
                        value={searchInput}
                        onChange={event => setSearchInput(event.target.value)}
                        placeholder={isZh ? '输入订单号' : 'Enter order code'}
                        aria-label={isZh ? '订单号' : 'Order code'}
                    />
                    {!!searchInput && (
                        <button
                            type="button"
                            onClick={() => {
                                setSearchInput('');
                                setOrderCode('');
                            }}
                            aria-label={isZh ? '清空' : 'Clear'}
                        >
                            <X />
                        </button>
                    )}
                    <button type="submit">{isZh ? '搜索' : 'Search'}</button>
                </form>
            )}
            {!customer ? (
                <EmptyState
                    icon={<UserRound />}
                    title={isZh ? '登录后查看订单' : 'Sign in to view orders'}
                    detail={
                        isZh
                            ? '订单和物流信息将安全保存在账户中'
                            : 'Orders and delivery details are saved to your account'
                    }
                    action={isZh ? '去登录' : 'Sign in'}
                    onAction={() => onNavigate({ name: 'login' })}
                />
            ) : tab === 'service' ? (
                <AfterSalesList
                    requests={afterSalesQuery.data ?? []}
                    loading={afterSalesQuery.isLoading}
                    error={
                        afterSalesQuery.isPaused && afterSalesQuery.data === undefined
                            ? offlineLoadError(language)
                            : afterSalesQuery.error instanceof Error
                              ? afterSalesQuery.error.message
                              : ''
                    }
                    cancellingId={cancellingAfterSalesId}
                    locale={locale}
                    language={language}
                    onRetry={() => void afterSalesQuery.refetch()}
                    onOpenOrder={orderId => onNavigate({ name: 'order-detail', id: orderId })}
                    onCancel={id => void cancelAfterSales(id)}
                />
            ) : loading && !orders.length ? (
                <PageSkeleton label={isZh ? '正在加载订单' : 'Loading orders'} />
            ) : listError && !orders.length ? (
                <EmptyState
                    icon={<WifiOff />}
                    title={isZh ? '订单加载失败' : 'Could not load orders'}
                    detail={listError}
                    action={isZh ? '重试' : 'Retry'}
                    onAction={() => void ordersQuery.refetch()}
                />
            ) : orders.length ? (
                <div className="order-list">
                    {orders.map(order => (
                        <OrderCard
                            key={order.id}
                            order={order}
                            locale={locale}
                            language={language}
                            storefrontName={storefrontName}
                            onOpen={() => onNavigate({ name: 'order-detail', id: order.id })}
                            onBuyAgain={() => void onBuyAgain(order)}
                        />
                    ))}
                    {listError && (
                        <InlineError
                            message={listError}
                            action={isZh ? '重试' : 'Retry'}
                            onAction={() => void ordersQuery.fetchNextPage()}
                        />
                    )}
                    {orders.length < totalItems && (
                        <button
                            type="button"
                            className="load-more-button order-load-more"
                            disabled={loadingMore}
                            onClick={() => void ordersQuery.fetchNextPage()}
                        >
                            {loadingMore
                                ? isZh
                                    ? '加载中…'
                                    : 'Loading…'
                                : isZh
                                  ? `加载更多（${orders.length}/${totalItems}）`
                                  : `Load more (${orders.length}/${totalItems})`}
                        </button>
                    )}
                </div>
            ) : (
                <EmptyState
                    icon={<Package />}
                    title={isZh ? '暂无相关订单' : 'No orders here'}
                    detail={isZh ? '完成购买后，订单会显示在这里' : 'Completed purchases will appear here'}
                />
            )}
        </main>
    );
}

export function LogisticsPage({
    api,
    customer,
    market,
    locale,
    language,
    onBack,
    onNavigate,
}: {
    api: ShopApi;
    customer: ActiveCustomer | null;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    onBack: () => void;
    onNavigate: (route: OrderRoute) => void;
}) {
    const isZh = language === 'zh';
    const [filter, setFilter] = useState<LogisticsFilter>('all');
    const pageSize = 10;
    const logisticsQuery = useInfiniteQuery({
        queryKey: storefrontQueryKeys.customerOrders(
            market.code,
            languageCodeFor(language),
            customer?.id ?? '',
            { view: 'logistics' },
        ),
        queryFn: ({ pageParam, signal }) =>
            api.customerOrders(pageParam, pageSize, undefined, undefined, signal),
        initialPageParam: 0,
        getNextPageParam: (lastPage, pages) => {
            const loaded = pages.reduce((total, page) => total + page.items.length, 0);
            return loaded < lastPage.totalItems ? loaded : undefined;
        },
        enabled: Boolean(customer),
        staleTime: 0,
        refetchOnMount: 'always',
        refetchInterval: query =>
            query.state.data?.pages.some(page =>
                page.items.some(order => orderNeedsStatusRefresh(order.state)),
            )
                ? ORDER_STATUS_REFRESH_INTERVAL
                : false,
        gcTime: PUBLIC_QUERY_GC_TIME,
    });
    const orders = Array.from(
        new Map(
            (logisticsQuery.data?.pages.flatMap(page => page.items) ?? []).map(order => [order.id, order]),
        ).values(),
    );
    const logisticsOrders = orders.filter(order => {
        const physical = order.lines.some(
            line =>
                line.customFields.fulfillmentTypeSnapshot !== 'digital' &&
                line.productVariant.customFields.fulfillmentType !== 'digital',
        );
        const paidOrShipped = !['AddingItems', 'ArrangingPayment'].includes(order.state);
        return physical && (paidOrShipped || Boolean(order.fulfillments?.length));
    });
    const visibleOrders = logisticsOrders.filter(
        order => filter === 'all' || logisticsStatusForOrder(order) === filter,
    );
    const loading = logisticsQuery.isLoading;
    const loadingMore = logisticsQuery.isFetchingNextPage;
    const listError =
        logisticsQuery.isPaused && logisticsQuery.data === undefined
            ? offlineLoadError(language)
            : logisticsQuery.error instanceof Error
              ? logisticsQuery.error.message
              : logisticsQuery.error
                ? isZh
                    ? '物流信息加载失败'
                    : 'Could not load delivery updates'
                : '';
    const filters: Array<{ id: LogisticsFilter; label: string }> = [
        { id: 'all', label: isZh ? '全部' : 'All' },
        { id: 'transit', label: isZh ? '运输中' : 'In transit' },
        { id: 'preparing', label: isZh ? '待发货' : 'Preparing' },
        { id: 'delivered', label: isZh ? '已签收' : 'Delivered' },
    ];

    return (
        <main className="page subpage logistics-page">
            <SubHeader title={isZh ? '物流动态' : 'Delivery updates'} language={language} onBack={onBack} />
            <nav className="logistics-tabs" aria-label={isZh ? '物流状态筛选' : 'Filter delivery status'}>
                {filters.map(item => (
                    <button
                        type="button"
                        key={item.id}
                        className={filter === item.id ? 'is-active' : undefined}
                        aria-pressed={filter === item.id}
                        onClick={() => setFilter(item.id)}
                    >
                        {item.label}
                    </button>
                ))}
            </nav>
            {!customer ? (
                <EmptyState
                    icon={<UserRound />}
                    title={isZh ? '登录后查看物流' : 'Sign in to view deliveries'}
                    detail={
                        isZh
                            ? '全部实物订单的配送进度会集中显示在这里'
                            : 'Delivery progress for physical orders appears here'
                    }
                    action={isZh ? '去登录' : 'Sign in'}
                    onAction={() => onNavigate({ name: 'login' })}
                />
            ) : loading && !orders.length ? (
                <PageSkeleton label={isZh ? '正在加载物流信息' : 'Loading delivery updates'} />
            ) : listError && !orders.length ? (
                <EmptyState
                    icon={<WifiOff />}
                    title={isZh ? '物流信息加载失败' : 'Could not load delivery updates'}
                    detail={listError}
                    action={isZh ? '重试' : 'Retry'}
                    onAction={() => void logisticsQuery.refetch()}
                />
            ) : logisticsOrders.length ? (
                <div className="logistics-list">
                    {visibleOrders.length ? (
                        visibleOrders.map(order => (
                            <LogisticsCard
                                key={order.id}
                                order={order}
                                locale={locale}
                                language={language}
                                onOpen={() => onNavigate({ name: 'order-detail', id: order.id })}
                            />
                        ))
                    ) : (
                        <EmptyState
                            icon={<Navigation />}
                            title={isZh ? '当前状态暂无物流' : 'No deliveries in this status'}
                            detail={
                                isZh ? '切换到其他状态继续查看' : 'Choose another status to keep browsing'
                            }
                        />
                    )}
                    {listError && (
                        <InlineError
                            message={listError}
                            action={isZh ? '重试' : 'Retry'}
                            onAction={() => void logisticsQuery.fetchNextPage()}
                        />
                    )}
                    {logisticsQuery.hasNextPage && (
                        <button
                            type="button"
                            className="load-more-button logistics-load-more"
                            disabled={loadingMore}
                            onClick={() => void logisticsQuery.fetchNextPage()}
                        >
                            {loadingMore ? (isZh ? '加载中' : 'Loading') : isZh ? '加载更多' : 'Load more'}
                        </button>
                    )}
                </div>
            ) : (
                <EmptyState
                    icon={<Package />}
                    title={isZh ? '暂无物流动态' : 'No delivery updates'}
                    detail={
                        isZh
                            ? '购买实物商品并完成付款后，配送进度会显示在这里'
                            : 'Delivery progress appears after a physical order is paid'
                    }
                />
            )}
        </main>
    );
}

function LogisticsCard({
    order,
    locale,
    language,
    onOpen,
}: {
    order: OrderSummary;
    locale: string;
    language: StorefrontLanguage;
    onOpen: () => void;
}) {
    const isZh = language === 'zh';
    const fulfillment = latestOrderFulfillment(order);
    const status = logisticsStatusForOrder(order);
    const physicalLines = order.lines.filter(
        line =>
            line.customFields.fulfillmentTypeSnapshot !== 'digital' &&
            line.productVariant.customFields.fulfillmentType !== 'digital',
    );
    const updatedAt = fulfillment?.updatedAt ?? order.orderPlacedAt;
    const method = fulfillment?.method ?? order.checkoutShipping?.methodName;
    const trackingCode = fulfillment?.trackingCode;

    return (
        <article className={`logistics-card is-${status}`}>
            <header>
                <span className="logistics-status-icon">{logisticsStatusIcon(status)}</span>
                <span>
                    <strong>{logisticsStatusLabel(status, language)}</strong>
                    <small>{logisticsStatusHint(status, language)}</small>
                </span>
                <time dateTime={updatedAt ?? undefined}>
                    {updatedAt ? formatOrderDate(updatedAt, locale) : isZh ? '时间待更新' : 'Time pending'}
                </time>
            </header>
            <div className="logistics-products">
                {physicalLines.map(line => (
                    <div className="logistics-product" key={line.id}>
                        <ProductVariantImage variant={line.productVariant} alt={line.productVariant.name} />
                        <span>
                            <strong>{line.productVariant.name}</strong>
                            <small>{line.productVariant.sku}</small>
                        </span>
                        <b>×{line.quantity}</b>
                    </div>
                ))}
            </div>
            <details className="logistics-detail" open={status === 'transit'}>
                <summary>
                    <span>{isZh ? '查看物流详情' : 'View delivery details'}</span>
                    <ChevronRight aria-hidden="true" />
                </summary>
                <div className="logistics-detail-body">
                    <dl>
                        <div>
                            <dt>{isZh ? '配送方式' : 'Delivery method'}</dt>
                            <dd>{method ?? (isZh ? '承运商待分配' : 'Carrier pending')}</dd>
                        </div>
                        <div>
                            <dt>{isZh ? '运单号' : 'Tracking number'}</dt>
                            <dd>
                                {trackingCode ??
                                    (isZh ? '承运商尚未提供运单号' : 'Tracking number is not available yet')}
                            </dd>
                        </div>
                    </dl>
                    <ol className="logistics-timeline">
                        <li className="is-current">
                            <span />
                            <div>
                                <strong>{logisticsStatusLabel(status, language)}</strong>
                                <small>
                                    {updatedAt
                                        ? formatOrderDate(updatedAt, locale)
                                        : isZh
                                          ? '时间待更新'
                                          : 'Time pending'}
                                </small>
                            </div>
                        </li>
                        <li>
                            <span />
                            <div>
                                <strong>{isZh ? '订单已创建' : 'Order created'}</strong>
                                <small>
                                    {order.orderPlacedAt
                                        ? formatOrderDate(order.orderPlacedAt, locale)
                                        : isZh
                                          ? '时间待更新'
                                          : 'Time pending'}
                                </small>
                            </div>
                        </li>
                    </ol>
                    <button type="button" className="logistics-order-link" onClick={onOpen}>
                        <span>{isZh ? `订单 ${order.code}` : `Order ${order.code}`}</span>
                        <span>
                            {isZh ? '查看订单详情' : 'View order'}
                            <ChevronRight aria-hidden="true" />
                        </span>
                    </button>
                </div>
            </details>
        </article>
    );
}

function AfterSalesList({
    requests,
    loading,
    error,
    cancellingId,
    locale,
    language,
    onRetry,
    onOpenOrder,
    onCancel,
}: {
    requests: AfterSalesRequest[];
    loading: boolean;
    error: string;
    cancellingId: string;
    locale: string;
    language: StorefrontLanguage;
    onRetry: () => void;
    onOpenOrder: (orderId: string) => void;
    onCancel: (id: string) => void;
}) {
    const isZh = language === 'zh';
    if (loading && !requests.length) {
        return <PageSkeleton label={isZh ? '正在加载售后记录' : 'Loading after-sales requests'} />;
    }
    if (error && !requests.length) {
        return (
            <EmptyState
                icon={<WifiOff />}
                title={isZh ? '售后记录加载失败' : 'Could not load after-sales requests'}
                detail={error}
                action={isZh ? '重试' : 'Retry'}
                onAction={onRetry}
            />
        );
    }
    if (!requests.length) {
        return (
            <EmptyState
                icon={<RotateCcw />}
                title={isZh ? '暂无售后记录' : 'No after-sales requests'}
                detail={
                    isZh
                        ? '可在已付款订单详情中选择“申请售后”'
                        : 'Open a paid order and choose “Request after-sales”'
                }
            />
        );
    }
    return (
        <section className="after-sales-list" aria-label={isZh ? '售后申请' : 'After-sales requests'}>
            {requests.map(request => (
                <article key={request.id} className={`after-sales-card is-${request.state.toLowerCase()}`}>
                    <header>
                        <span>
                            {afterSalesStateIcon(request.state)}
                            <strong>{afterSalesStateLabel(request.state, language)}</strong>
                        </span>
                        <small>{request.code}</small>
                    </header>
                    <button
                        type="button"
                        className="after-sales-order-link"
                        onClick={() => onOpenOrder(request.order.id)}
                    >
                        <span>{isZh ? `订单 ${request.order.code}` : `Order ${request.order.code}`}</span>
                        <ChevronRight aria-hidden="true" />
                    </button>
                    <div className="after-sales-items">
                        {request.items.map(item => (
                            <span key={item.id}>
                                <strong>{item.productName}</strong>
                                <small>
                                    {item.sku} ×{item.quantity}
                                </small>
                            </span>
                        ))}
                    </div>
                    <dl>
                        <div>
                            <dt>{isZh ? '类型' : 'Type'}</dt>
                            <dd>{afterSalesTypeLabel(request.type, language)}</dd>
                        </div>
                        <div>
                            <dt>{isZh ? '申请金额' : 'Requested'}</dt>
                            <dd>{formatMoney(request.requestedAmount, request.currencyCode, locale)}</dd>
                        </div>
                        <div>
                            <dt>{isZh ? '更新时间' : 'Updated'}</dt>
                            <dd>{formatOrderDate(request.updatedAt, locale)}</dd>
                        </div>
                    </dl>
                    <details>
                        <summary>{isZh ? '查看处理时间线' : 'View timeline'}</summary>
                        <ol>
                            {request.events.map(event => (
                                <li key={event.id}>
                                    <span />
                                    <div>
                                        <strong>{afterSalesStateLabel(event.state, language)}</strong>
                                        <p>{event.note}</p>
                                        <small>{formatOrderDate(event.createdAt, locale)}</small>
                                    </div>
                                </li>
                            ))}
                        </ol>
                    </details>
                    {request.state === 'PENDING' && (
                        <button
                            type="button"
                            className="after-sales-cancel"
                            disabled={Boolean(cancellingId)}
                            onClick={() => onCancel(request.id)}
                        >
                            {cancellingId === request.id
                                ? isZh
                                    ? '正在撤销'
                                    : 'Cancelling'
                                : isZh
                                  ? '撤销申请'
                                  : 'Cancel request'}
                        </button>
                    )}
                </article>
            ))}
        </section>
    );
}

export function OrderDetailPage({
    order,
    locale,
    language,
    storefrontName,
    onBack,
    onBuyAgain,
    onReopen,
    onCancelOrder,
    onCreateAfterSales,
    onUnavailable,
}: {
    order: Order | null;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    storefrontName: string;
    onBack: () => void;
    onBuyAgain: (order: Order) => Promise<void>;
    onReopen: (order: Order) => Promise<void>;
    onCancelOrder: (order: Order, reason: string) => Promise<void>;
    onCreateAfterSales: (input: CreateAfterSalesRequestInput) => Promise<void>;
    onUnavailable: () => void;
}) {
    const isZh = language === 'zh';
    const [cancelOpen, setCancelOpen] = useState(false);
    const [afterSalesOpen, setAfterSalesOpen] = useState(false);
    if (!order) {
        return (
            <Subpage title={isZh ? '订单详情' : 'Order details'} language={language} onBack={onBack}>
                <EmptyState icon={<Package />} title={isZh ? '没有找到订单' : 'Order not found'} />
            </Subpage>
        );
    }
    const inTransit = ['Shipped', 'PartiallyShipped'].includes(order.state);
    const pending = ['AddingItems', 'ArrangingPayment'].includes(order.state);
    const fulfillments = order.fulfillments ?? [];
    const digitalDeliveries = order.digitalDeliveries ?? [];
    const readyDownloads = digitalDeliveries.filter(
        delivery => delivery.status === 'READY' && delivery.downloadUrl,
    );
    const canCancel =
        order.state === 'PaymentAuthorized' &&
        fulfillments.length === 0 &&
        order.lines.every(
            line =>
                line.customFields.fulfillmentTypeSnapshot !== 'digital' &&
                line.productVariant.customFields.fulfillmentType !== 'digital',
        );
    const canRequestAfterSales = ['PaymentSettled', 'PartiallyShipped', 'Shipped', 'Delivered'].includes(
        order.state,
    );
    const statusHint = readyDownloads.length
        ? isZh
            ? '数字商品已可下载，链接为短效安全链接'
            : 'Your digital products are ready. Download links are short-lived.'
        : pending
          ? isZh
              ? '订单等待支付，请在支付页完成付款'
              : 'Complete payment to continue'
          : inTransit
            ? isZh
                ? '商品正在运输中，请留意物流更新'
                : 'Your order is in transit'
            : ['PaymentAuthorized', 'PaymentSettled'].includes(order.state)
              ? isZh
                  ? '商家正在准备你的商品'
                  : 'The merchant is preparing your order'
              : isZh
                ? '订单状态已更新'
                : 'Order status updated';
    return (
        <main className="page subpage order-detail-page">
            <SubHeader title={isZh ? '订单详情' : 'Order details'} language={language} onBack={onBack} />
            <section className="order-status">
                <strong>{orderStateLabel(order.state, language)}</strong>
                <span>{statusHint}</span>
                <small>{isZh ? `订单号 ${order.code}` : `Order ${order.code}`}</small>
            </section>
            {(inTransit || fulfillments.length > 0) && (
                <section className="order-logistics" id="order-logistics">
                    <Navigation />
                    <div className="order-logistics-content">
                        <strong>{isZh ? '物流信息' : 'Delivery details'}</strong>
                        {fulfillments.length ? (
                            fulfillments.map((fulfillment, index) => (
                                <div className="order-logistics-item" key={fulfillment.id}>
                                    <span>
                                        {fulfillments.length > 1
                                            ? isZh
                                                ? `包裹 ${index + 1}`
                                                : `Shipment ${index + 1}`
                                            : isZh
                                              ? '配送包裹'
                                              : 'Shipment'}
                                    </span>
                                    <small>{fulfillment.method}</small>
                                    <b>
                                        {fulfillment.trackingCode
                                            ? isZh
                                                ? `运单号 ${fulfillment.trackingCode}`
                                                : `Tracking ${fulfillment.trackingCode}`
                                            : isZh
                                              ? '承运商尚未提供运单号'
                                              : 'Tracking number is not available yet'}
                                    </b>
                                    <em>
                                        {fulfillmentStateLabel(fulfillment.state, language)} ·{' '}
                                        {formatOrderDate(fulfillment.updatedAt, locale)}
                                    </em>
                                </div>
                            ))
                        ) : (
                            <small>
                                {isZh
                                    ? '物流详情将在承运商更新后显示'
                                    : 'Updates appear when provided by the carrier'}
                            </small>
                        )}
                    </div>
                </section>
            )}
            <section className="order-detail-products">
                <header>
                    <strong>{storefrontName}</strong>
                    <span>{isZh ? `${order.lines.length} 种商品` : `${order.lines.length} products`}</span>
                </header>
                {order.lines.map(line => (
                    <article key={line.id}>
                        <ProductVariantImage variant={line.productVariant} alt={line.productVariant.name} />
                        <div>
                            <strong>{line.productVariant.name}</strong>
                            <small>{line.productVariant.sku}</small>
                            <em>
                                {line.productVariant.customFields.fulfillmentType === 'digital'
                                    ? isZh
                                        ? '数字商品 · 自动交付'
                                        : 'Digital · automatic delivery'
                                    : isZh
                                      ? '普通商品 · 售后支持'
                                      : 'Physical · after-sales'}
                            </em>
                        </div>
                        <span>
                            <b>
                                {formatMoney(line.linePriceWithTax, line.productVariant.currencyCode, locale)}
                            </b>
                            <small>×{line.quantity}</small>
                        </span>
                    </article>
                ))}
            </section>
            {!!digitalDeliveries.length && (
                <section className="digital-delivery-panel" aria-labelledby="digital-delivery-title">
                    <header>
                        <div>
                            <Download aria-hidden="true" />
                            <strong id="digital-delivery-title">
                                {isZh ? '我的数字商品' : 'My digital products'}
                            </strong>
                        </div>
                        <small>
                            {isZh
                                ? '每次打开订单都会生成新的安全链接'
                                : 'Fresh secure links are generated per order view'}
                        </small>
                    </header>
                    <div>
                        {digitalDeliveries.map(delivery => (
                            <article key={delivery.orderLineId}>
                                <span>
                                    <strong>{delivery.name}</strong>
                                    <small>{delivery.sku}</small>
                                </span>
                                {delivery.status === 'READY' && delivery.downloadUrl ? (
                                    <a href={delivery.downloadUrl} rel="noreferrer">
                                        <Download aria-hidden="true" />
                                        {isZh ? '安全下载' : 'Secure download'}
                                    </a>
                                ) : (
                                    <em>{digitalDeliveryStatus(delivery.status, language)}</em>
                                )}
                            </article>
                        ))}
                    </div>
                </section>
            )}
            <section className="order-information">
                <div>
                    <span>{isZh ? '下单时间' : 'Placed at'}</span>
                    <b>{formatOrderDate(order.orderPlacedAt, locale)}</b>
                </div>
                <div>
                    <span>{isZh ? '订单编号' : 'Order code'}</span>
                    <b>{order.code}</b>
                </div>
                {order.checkoutShipping && (
                    <div>
                        <span>{isZh ? '配送时效' : 'Delivery estimate'}</span>
                        <b>{shippingEstimate(order, language)}</b>
                    </div>
                )}
            </section>
            <section className="order-detail-summary">
                <PriceSummary order={order} locale={locale} language={language} />
            </section>
            <div className="order-detail-actions">
                {canCancel && (
                    <button type="button" className="danger-action" onClick={() => setCancelOpen(true)}>
                        {isZh ? '取消订单' : 'Cancel order'}
                    </button>
                )}
                {canRequestAfterSales && (
                    <button type="button" onClick={() => setAfterSalesOpen(true)}>
                        {isZh ? '申请售后' : 'Request after-sales'}
                    </button>
                )}
                <button
                    type="button"
                    className="primary-action"
                    onClick={
                        pending
                            ? () => void onReopen(order)
                            : inTransit
                              ? () => {
                                    if (fulfillments.length)
                                        document
                                            .getElementById('order-logistics')
                                            ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                    else onUnavailable();
                                }
                              : () => void onBuyAgain(order)
                    }
                >
                    {pending
                        ? isZh
                            ? '返回修改订单'
                            : 'Reopen order'
                        : inTransit
                          ? isZh
                              ? '查看物流'
                              : 'Track'
                          : isZh
                            ? '再买一单'
                            : 'Buy again'}
                </button>
            </div>
            {cancelOpen && (
                <CancelOrderSheet
                    order={order}
                    language={language}
                    onClose={() => setCancelOpen(false)}
                    onConfirm={async reason => {
                        await onCancelOrder(order, reason);
                        setCancelOpen(false);
                    }}
                />
            )}
            {afterSalesOpen && (
                <AfterSalesRequestSheet
                    order={order}
                    locale={locale}
                    language={language}
                    onClose={() => setAfterSalesOpen(false)}
                    onConfirm={async input => {
                        await onCreateAfterSales(input);
                        setAfterSalesOpen(false);
                    }}
                />
            )}
        </main>
    );
}

function AfterSalesRequestSheet({
    order,
    locale,
    language,
    onClose,
    onConfirm,
}: {
    order: Order;
    locale: string;
    language: StorefrontLanguage;
    onClose: () => void;
    onConfirm: (input: CreateAfterSalesRequestInput) => Promise<void>;
}) {
    const isZh = language === 'zh';
    const [quantities, setQuantities] = useState<Record<string, number>>({});
    const [type, setType] = useState<AfterSalesType>('REFUND_ONLY');
    const [reason, setReason] = useState<AfterSalesReason>('OTHER');
    const [description, setDescription] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const dialogRef = useRef<HTMLElement>(null);
    const closeRef = useRef(onClose);
    const submittingRef = useRef(submitting);
    const previousFocus = useRef<HTMLElement | null>(null);
    const titleId = useId();
    const selectedLines = order.lines.filter(line => (quantities[line.id] ?? 0) > 0);
    const containsDigital = selectedLines.some(
        line => line.customFields.fulfillmentTypeSnapshot === 'digital',
    );
    const requestedPreview = selectedLines.reduce(
        (total, line) => total + line.proratedUnitPriceWithTax * (quantities[line.id] ?? 0),
        0,
    );

    useEffect(() => {
        closeRef.current = onClose;
    }, [onClose]);
    useEffect(() => {
        submittingRef.current = submitting;
    }, [submitting]);
    useEffect(() => {
        if (containsDigital && type !== 'REFUND_ONLY') setType('REFUND_ONLY');
    }, [containsDigital, type]);
    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const previousOverflow = document.body.style.overflow;
        const selector =
            'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
        const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(selector));
        const frame = requestAnimationFrame(() => (focusable()[0] ?? dialog).focus());
        const keydown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !submittingRef.current) {
                event.preventDefault();
                closeRef.current();
                return;
            }
            if (event.key !== 'Tab') return;
            const items = focusable();
            if (!items.length) {
                event.preventDefault();
                dialog.focus();
                return;
            }
            const first = items[0];
            const last = items[items.length - 1];
            const active = document.activeElement;
            if (event.shiftKey && (active === first || !dialog.contains(active))) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
                event.preventDefault();
                first.focus();
            }
        };
        document.body.style.overflow = 'hidden';
        document.addEventListener('keydown', keydown);
        return () => {
            cancelAnimationFrame(frame);
            document.removeEventListener('keydown', keydown);
            document.body.style.overflow = previousOverflow;
            previousFocus.current?.focus();
        };
    }, []);

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!selectedLines.length || description.trim().length < 3 || submitting) return;
        setSubmitting(true);
        setError('');
        try {
            await onConfirm({
                orderId: order.id,
                type,
                reason,
                description: description.trim(),
                items: selectedLines.map(line => ({
                    orderLineId: line.id,
                    quantity: quantities[line.id] ?? 1,
                })),
            });
        } catch (requestError) {
            setError(
                requestError instanceof Error
                    ? requestError.message
                    : isZh
                      ? '提交售后申请失败'
                      : 'Could not submit the request',
            );
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="sheet-layer" role="presentation">
            <button
                className="sheet-mask"
                type="button"
                disabled={submitting}
                onClick={onClose}
                aria-label={isZh ? '关闭' : 'Close'}
            />
            <section
                ref={dialogRef}
                className="sheet after-sales-sheet"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
            >
                <header>
                    <strong id={titleId}>{isZh ? '申请售后' : 'Request after-sales'}</strong>
                    <button
                        type="button"
                        disabled={submitting}
                        onClick={onClose}
                        aria-label={isZh ? '关闭' : 'Close'}
                    >
                        <X aria-hidden="true" />
                    </button>
                </header>
                <form onSubmit={event => void submit(event)}>
                    <fieldset className="after-sales-line-selection">
                        <legend>{isZh ? '选择商品和数量' : 'Select products and quantities'}</legend>
                        {order.lines.map(line => {
                            const selected = (quantities[line.id] ?? 0) > 0;
                            return (
                                <div key={line.id}>
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={selected}
                                            disabled={submitting}
                                            onChange={event =>
                                                setQuantities(current => ({
                                                    ...current,
                                                    [line.id]: event.currentTarget.checked ? 1 : 0,
                                                }))
                                            }
                                        />
                                        <span>
                                            <strong>{line.productVariant.name}</strong>
                                            <small>{line.productVariant.sku}</small>
                                        </span>
                                    </label>
                                    {selected && (
                                        <label className="after-sales-quantity">
                                            <span>{isZh ? '数量' : 'Qty'}</span>
                                            <input
                                                type="number"
                                                min={1}
                                                max={line.quantity}
                                                value={quantities[line.id] ?? 1}
                                                disabled={submitting}
                                                onChange={event => {
                                                    const value = Number(event.currentTarget.value);
                                                    setQuantities(current => ({
                                                        ...current,
                                                        [line.id]: Math.max(
                                                            1,
                                                            Math.min(line.quantity, value || 1),
                                                        ),
                                                    }));
                                                }}
                                            />
                                        </label>
                                    )}
                                </div>
                            );
                        })}
                    </fieldset>
                    <label className="after-sales-field">
                        <span>{isZh ? '售后类型' : 'Request type'}</span>
                        <select
                            value={type}
                            disabled={submitting}
                            onChange={event => setType(event.currentTarget.value as AfterSalesType)}
                        >
                            <option value="REFUND_ONLY">
                                {afterSalesTypeLabel('REFUND_ONLY', language)}
                            </option>
                            <option value="RETURN_AND_REFUND" disabled={containsDigital}>
                                {afterSalesTypeLabel('RETURN_AND_REFUND', language)}
                            </option>
                        </select>
                        {containsDigital && (
                            <small>
                                {isZh
                                    ? '数字商品只能申请仅退款'
                                    : 'Digital products support refund-only requests'}
                            </small>
                        )}
                    </label>
                    <label className="after-sales-field">
                        <span>{isZh ? '申请原因' : 'Reason'}</span>
                        <select
                            value={reason}
                            disabled={submitting}
                            onChange={event => setReason(event.currentTarget.value as AfterSalesReason)}
                        >
                            {afterSalesReasonOptions.map(option => (
                                <option key={option} value={option}>
                                    {afterSalesReasonLabel(option, language)}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="after-sales-field">
                        <span>{isZh ? '问题描述' : 'Description'}</span>
                        <textarea
                            value={description}
                            rows={5}
                            minLength={3}
                            maxLength={2000}
                            required
                            disabled={submitting}
                            placeholder={
                                isZh
                                    ? '请说明问题、期望处理方式；不要填写密码等敏感信息'
                                    : 'Describe the issue and expected resolution. Do not include passwords.'
                            }
                            onChange={event => setDescription(event.currentTarget.value)}
                        />
                    </label>
                    <div className="after-sales-request-total">
                        <span>{isZh ? '预计申请金额' : 'Estimated request amount'}</span>
                        <strong>{formatMoney(requestedPreview, order.currencyCode, locale)}</strong>
                        <small>
                            {isZh
                                ? '最终金额由商家审核，当前不会发起真实退款'
                                : 'The store will review the final amount. No payment refund is initiated now.'}
                        </small>
                    </div>
                    {error && (
                        <div className="inline-error" role="alert">
                            {error}
                        </div>
                    )}
                    <div className="after-sales-submit-actions">
                        <button type="button" disabled={submitting} onClick={onClose}>
                            {isZh ? '取消' : 'Cancel'}
                        </button>
                        <button
                            className="primary-action"
                            type="submit"
                            disabled={submitting || !selectedLines.length || description.trim().length < 3}
                        >
                            {submitting
                                ? isZh
                                    ? '提交中'
                                    : 'Submitting'
                                : isZh
                                  ? '提交申请'
                                  : 'Submit request'}
                        </button>
                    </div>
                </form>
            </section>
        </div>
    );
}

function OrderCard({
    order,
    locale,
    language,
    storefrontName,
    onOpen,
    onBuyAgain,
}: {
    order: OrderSummary;
    locale: string;
    language: StorefrontLanguage;
    storefrontName: string;
    onOpen: () => void;
    onBuyAgain: () => void;
}) {
    const isZh = language === 'zh';
    const completed = ['Delivered', 'Cancelled'].includes(order.state);
    const primaryLabel = completed
        ? isZh
            ? '再买一单'
            : 'Buy again'
        : ['Shipped', 'PartiallyShipped'].includes(order.state)
          ? isZh
              ? '查看物流'
              : 'Track'
          : isZh
            ? '查看详情'
            : 'View details';
    return (
        <article className="order-card">
            <header>
                <button type="button" onClick={onOpen}>
                    <strong>{storefrontName}</strong>
                    <ChevronRight />
                </button>
                <span>{orderStateLabel(order.state, language)}</span>
            </header>
            <button className="order-card-product" type="button" onClick={onOpen}>
                <OrderImage order={order} />
                <span>
                    <strong>
                        {order.lines[0]?.productVariant.name ?? (isZh ? '订单商品' : 'Order item')}
                    </strong>
                    <small>
                        {order.lines.length > 1
                            ? isZh
                                ? `另有 ${order.lines.length - 1} 种商品`
                                : `${order.lines.length - 1} more products`
                            : order.lines[0]?.productVariant.name}
                    </small>
                    <em>{isZh ? '售后支持 · 正品保障' : 'After-sales support'}</em>
                </span>
                <span>
                    <b>{formatMoney(order.lines[0]?.linePriceWithTax ?? 0, order.currencyCode, locale)}</b>
                    <small>×{order.totalQuantity}</small>
                </span>
            </button>
            <footer>
                <div className="order-total">
                    {isZh ? `共 ${order.totalQuantity} 件，实付款` : `${order.totalQuantity} items · Paid`}{' '}
                    <b>{formatMoney(order.totalWithTax, order.currencyCode, locale)}</b>
                </div>
                <div className="order-operations">
                    <button
                        type="button"
                        className="primary-action"
                        onClick={completed ? onBuyAgain : onOpen}
                    >
                        {primaryLabel}
                    </button>
                </div>
            </footer>
        </article>
    );
}

function SubHeader({
    title,
    language,
    onBack,
    action,
}: {
    title: string;
    language: StorefrontLanguage;
    onBack: () => void;
    action?: ReactNode;
}) {
    return (
        <header className="topbar subpage-header">
            <button type="button" onClick={onBack} aria-label={language === 'zh' ? '返回' : 'Back'}>
                <ArrowLeft aria-hidden="true" />
            </button>
            <strong>{title}</strong>
            <span>{action}</span>
        </header>
    );
}

function Subpage({
    title,
    language,
    onBack,
    children,
}: {
    title: string;
    language: StorefrontLanguage;
    onBack: () => void;
    children: ReactNode;
}) {
    return (
        <main className="page subpage">
            <SubHeader title={title} language={language} onBack={onBack} />
            {children}
        </main>
    );
}

function EmptyState({
    icon,
    title,
    detail,
    action,
    onAction,
}: {
    icon: ReactNode;
    title: string;
    detail?: string;
    action?: string;
    onAction?: () => void;
}) {
    return (
        <section className="empty-state">
            <span>{icon}</span>
            <h2>{title}</h2>
            {detail && <p>{detail}</p>}
            {action && (
                <button type="button" onClick={onAction}>
                    {action}
                </button>
            )}
        </section>
    );
}

function InlineError({
    message,
    action,
    onAction,
}: {
    message: string;
    action: string;
    onAction: () => void;
}) {
    return (
        <div className="inline-error" role="alert">
            <span>{message}</span>
            <button type="button" onClick={onAction}>
                {action}
            </button>
        </div>
    );
}

function ProductVariantImage({ variant, alt }: { variant: ProductVariant; alt: string }) {
    const source = variant.featuredAsset?.preview ?? variant.product.featuredAsset?.preview;
    if (!source)
        return (
            <div className="image-placeholder" aria-hidden="true">
                <Package />
            </div>
        );
    const responsive = responsiveImageSources(source, 'thumbnail');
    if (!responsive) return <img src={source} alt={alt} loading="lazy" decoding="async" />;
    return (
        <picture className="responsive-picture safe-image-frame">
            <source type="image/avif" srcSet={responsive.avifSrcSet} sizes={responsive.sizes} />
            <source type="image/webp" srcSet={responsive.webpSrcSet} sizes={responsive.sizes} />
            <img
                className="safe-image is-loaded"
                src={responsive.fallbackSrc}
                srcSet={responsive.fallbackSrcSet}
                sizes={responsive.sizes}
                width={responsive.width}
                height={responsive.height}
                alt={alt}
                loading="lazy"
                decoding="async"
            />
        </picture>
    );
}

function OrderImage({ order }: { order: OrderSummary }) {
    const variant = order.lines[0]?.productVariant;
    return variant ? (
        <ProductVariantImage variant={variant} alt={variant.name} />
    ) : (
        <div className="image-placeholder" aria-hidden="true">
            <Package />
        </div>
    );
}

function PriceSummary({
    order,
    locale,
    language,
}: {
    order: Order;
    locale: string;
    language: StorefrontLanguage;
}) {
    const isZh = language === 'zh';
    const discount = Math.abs(order.discounts.reduce((sum, item) => sum + item.amountWithTax, 0));
    return (
        <dl className="price-summary">
            <div>
                <dt>{isZh ? '商品金额' : 'Items'}</dt>
                <dd>{formatMoney(order.subTotalWithTax + discount, order.currencyCode, locale)}</dd>
            </div>
            <div>
                <dt>{isZh ? '运费' : 'Shipping'}</dt>
                <dd>{formatMoney(order.shippingWithTax, order.currencyCode, locale)}</dd>
            </div>
            {discount > 0 && (
                <div className="discount">
                    <dt>{isZh ? '优惠' : 'Discount'}</dt>
                    <dd>-{formatMoney(discount, order.currencyCode, locale)}</dd>
                </div>
            )}
            <TaxSummaryRows order={order} locale={locale} language={language} />
            <div className="summary-total">
                <dt>{isZh ? '合计' : 'Total'}</dt>
                <dd>{formatMoney(order.totalWithTax, order.currencyCode, locale)}</dd>
            </div>
        </dl>
    );
}

function CancelOrderSheet({
    order,
    language,
    onClose,
    onConfirm,
}: {
    order: Order;
    language: StorefrontLanguage;
    onClose: () => void;
    onConfirm: (reason: string) => Promise<void>;
}) {
    const isZh = language === 'zh';
    const [reason, setReason] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const dialogRef = useRef<HTMLElement>(null);
    const closeRef = useRef(onClose);
    const submittingRef = useRef(submitting);
    const previousFocus = useRef<HTMLElement | null>(null);
    const titleId = useId();

    useEffect(() => {
        closeRef.current = onClose;
    }, [onClose]);
    useEffect(() => {
        submittingRef.current = submitting;
    }, [submitting]);
    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const previousOverflow = document.body.style.overflow;
        const selector = 'button:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
        const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(selector));
        const frame = requestAnimationFrame(() => (focusable()[0] ?? dialog).focus());
        const keydown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !submittingRef.current) {
                event.preventDefault();
                closeRef.current();
                return;
            }
            if (event.key !== 'Tab') return;
            const items = focusable();
            if (!items.length) {
                event.preventDefault();
                dialog.focus();
                return;
            }
            const first = items[0];
            const last = items[items.length - 1];
            const active = document.activeElement;
            if (event.shiftKey && (active === first || !dialog.contains(active))) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
                event.preventDefault();
                first.focus();
            }
        };
        document.body.style.overflow = 'hidden';
        document.addEventListener('keydown', keydown);
        return () => {
            cancelAnimationFrame(frame);
            document.removeEventListener('keydown', keydown);
            document.body.style.overflow = previousOverflow;
            previousFocus.current?.focus();
        };
    }, []);

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const normalizedReason = reason.trim();
        if (!normalizedReason || submitting) return;
        setSubmitting(true);
        setError('');
        try {
            await onConfirm(normalizedReason);
        } catch (requestError) {
            setError(
                requestError instanceof Error
                    ? requestError.message
                    : isZh
                      ? '订单取消失败，请稍后重试'
                      : 'Could not cancel the order. Try again later.',
            );
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="sheet-layer" role="presentation">
            <button
                className="sheet-mask"
                type="button"
                disabled={submitting}
                onClick={onClose}
                aria-label={isZh ? '关闭' : 'Close'}
            />
            <section
                ref={dialogRef}
                className="sheet order-cancel-sheet"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
            >
                <header>
                    <strong id={titleId}>{isZh ? '取消订单' : 'Cancel order'}</strong>
                    <button
                        type="button"
                        disabled={submitting}
                        onClick={onClose}
                        aria-label={isZh ? '关闭' : 'Close'}
                    >
                        <X aria-hidden="true" />
                    </button>
                </header>
                <form onSubmit={event => void submit(event)}>
                    <p>
                        {isZh
                            ? `订单 ${order.code} 尚未扣款和发货。确认后将撤销支付授权并释放库存。`
                            : `Order ${order.code} has not been charged or shipped. Confirming will void the payment authorization and release stock.`}
                    </p>
                    <label>
                        <span>{isZh ? '取消原因' : 'Reason for cancellation'}</span>
                        <textarea
                            value={reason}
                            rows={4}
                            maxLength={500}
                            required
                            autoFocus
                            placeholder={isZh ? '请简要说明原因' : 'Briefly tell us why'}
                            onChange={event => setReason(event.currentTarget.value)}
                        />
                    </label>
                    <small>{reason.length}/500</small>
                    {error && (
                        <div className="inline-error" role="alert">
                            {error}
                        </div>
                    )}
                    <div className="order-cancel-actions">
                        <button type="button" disabled={submitting} onClick={onClose}>
                            {isZh ? '暂不取消' : 'Keep order'}
                        </button>
                        <button
                            className="danger-action"
                            type="submit"
                            disabled={submitting || !reason.trim()}
                        >
                            {submitting
                                ? isZh
                                    ? '正在取消'
                                    : 'Cancelling'
                                : isZh
                                  ? '确认取消'
                                  : 'Confirm cancellation'}
                        </button>
                    </div>
                </form>
            </section>
        </div>
    );
}

function shippingEstimate(order: Order, language: StorefrontLanguage): string {
    const shipping = order.checkoutShipping;
    if (!shipping) return language === 'zh' ? '无需配送' : 'No delivery required';
    const minimum = shipping.estimateMinDays;
    const maximum = shipping.estimateMaxDays;
    const firstAvailableDay = minimum ?? maximum;
    const estimate =
        firstAvailableDay == null
            ? ''
            : minimum === maximum || maximum == null
              ? language === 'zh'
                  ? `预计 ${firstAvailableDay} 天`
                  : `Estimated ${firstAvailableDay} days`
              : language === 'zh'
                ? `预计 ${firstAvailableDay}–${maximum} 天`
                : `Estimated ${firstAvailableDay}–${maximum} days`;
    return [
        shipping.methodName,
        estimate,
        shipping.freeShippingApplied ? (language === 'zh' ? '免邮' : 'Free') : '',
    ]
        .filter(Boolean)
        .join(' · ');
}

function formatMoney(value: number, currency: string, locale: string): string {
    return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    }).format(value / 100);
}

function formatOrderDate(value: string | null | undefined, locale: string): string {
    if (!value) return '--';
    return formatBusinessDate(locale, value, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

const afterSalesReasonOptions: AfterSalesReason[] = [
    'CHANGED_MIND',
    'NOT_AS_DESCRIBED',
    'DAMAGED',
    'WRONG_ITEM',
    'DELIVERY_ISSUE',
    'DIGITAL_CONTENT_ISSUE',
    'OTHER',
];

function afterSalesStateLabel(state: AfterSalesState, language: StorefrontLanguage): string {
    const labels: Record<AfterSalesState, { zh: string; en: string }> = {
        PENDING: { zh: '待商家处理', en: 'Awaiting review' },
        APPROVED: { zh: '商家已同意', en: 'Approved' },
        REJECTED: { zh: '申请未通过', en: 'Not approved' },
        CANCELLED: { zh: '申请已撤销', en: 'Cancelled' },
        COMPLETED: { zh: '售后已完成', en: 'Completed' },
    };
    return labels[state][language];
}

function afterSalesStateIcon(state: AfterSalesState): ReactNode {
    if (state === 'PENDING') return <Clock3 aria-hidden="true" />;
    if (state === 'APPROVED' || state === 'COMPLETED') return <CircleCheck aria-hidden="true" />;
    return <CircleAlert aria-hidden="true" />;
}

function afterSalesTypeLabel(type: AfterSalesType, language: StorefrontLanguage): string {
    if (type === 'RETURN_AND_REFUND') return language === 'zh' ? '退货退款' : 'Return and refund';
    return language === 'zh' ? '仅退款' : 'Refund only';
}

function afterSalesReasonLabel(reason: AfterSalesReason, language: StorefrontLanguage): string {
    const labels: Record<AfterSalesReason, { zh: string; en: string }> = {
        CHANGED_MIND: { zh: '不想要了', en: 'Changed my mind' },
        NOT_AS_DESCRIBED: { zh: '与描述不符', en: 'Not as described' },
        DAMAGED: { zh: '商品损坏', en: 'Damaged' },
        WRONG_ITEM: { zh: '发错商品', en: 'Wrong item' },
        DELIVERY_ISSUE: { zh: '配送问题', en: 'Delivery issue' },
        DIGITAL_CONTENT_ISSUE: { zh: '数字内容问题', en: 'Digital content issue' },
        OTHER: { zh: '其他原因', en: 'Other' },
    };
    return labels[reason][language];
}

function orderStateLabel(state: string, language: StorefrontLanguage): string {
    const zh: Record<string, string> = {
        AddingItems: '待付款',
        ArrangingPayment: '待付款',
        PaymentAuthorized: '待发货',
        PaymentSettled: '待发货',
        Shipped: '待收货',
        PartiallyShipped: '部分发货',
        Delivered: '交易完成',
        Cancelled: '已取消',
    };
    const en: Record<string, string> = {
        AddingItems: 'Payment pending',
        ArrangingPayment: 'Payment pending',
        PaymentAuthorized: 'Preparing shipment',
        PaymentSettled: 'Preparing shipment',
        Shipped: 'In transit',
        PartiallyShipped: 'Partially shipped',
        Delivered: 'Completed',
        Cancelled: 'Cancelled',
    };
    return (language === 'zh' ? zh : en)[state] ?? state;
}

function fulfillmentStateLabel(state: string, language: StorefrontLanguage): string {
    const zh: Record<string, string> = {
        Created: '已创建',
        Pending: '待发货',
        Shipped: '运输中',
        Delivered: '已送达',
        Cancelled: '已取消',
    };
    const en: Record<string, string> = {
        Created: 'Created',
        Pending: 'Pending shipment',
        Shipped: 'In transit',
        Delivered: 'Delivered',
        Cancelled: 'Cancelled',
    };
    return (language === 'zh' ? zh : en)[state] ?? state;
}

function latestOrderFulfillment(
    order: OrderSummary,
): NonNullable<OrderSummary['fulfillments']>[number] | null {
    return (
        [...(order.fulfillments ?? [])].sort(
            (first, second) => Date.parse(second.updatedAt) - Date.parse(first.updatedAt),
        )[0] ?? null
    );
}

function logisticsStatusForOrder(order: OrderSummary): LogisticsStatus {
    const fulfillmentState = latestOrderFulfillment(order)?.state;
    if (fulfillmentState === 'Delivered' || order.state === 'Delivered') return 'delivered';
    if (fulfillmentState === 'Shipped' || order.state === 'Shipped' || order.state === 'PartiallyShipped') {
        return 'transit';
    }
    if (fulfillmentState === 'Cancelled' || order.state === 'Cancelled') return 'cancelled';
    return 'preparing';
}

function logisticsStatusLabel(status: LogisticsStatus, language: StorefrontLanguage): string {
    const labels: Record<LogisticsStatus, { zh: string; en: string }> = {
        preparing: { zh: '待发货', en: 'Preparing' },
        transit: { zh: '运输中', en: 'In transit' },
        delivered: { zh: '已签收', en: 'Delivered' },
        cancelled: { zh: '配送已取消', en: 'Delivery cancelled' },
    };
    return labels[status][language];
}

function logisticsStatusHint(status: LogisticsStatus, language: StorefrontLanguage): string {
    const labels: Record<LogisticsStatus, { zh: string; en: string }> = {
        preparing: { zh: '商家正在准备商品', en: 'The merchant is preparing your items' },
        transit: { zh: '商品正在由承运商配送', en: 'Your items are with the carrier' },
        delivered: { zh: '商品已完成配送', en: 'Your items have been delivered' },
        cancelled: { zh: '本次配送已停止', en: 'This delivery has stopped' },
    };
    return labels[status][language];
}

function logisticsStatusIcon(status: LogisticsStatus): ReactNode {
    if (status === 'transit') return <Truck aria-hidden="true" />;
    if (status === 'delivered') return <CircleCheck aria-hidden="true" />;
    if (status === 'cancelled') return <CircleAlert aria-hidden="true" />;
    return <PackageCheck aria-hidden="true" />;
}

function digitalDeliveryStatus(
    status: NonNullable<Order['digitalDeliveries']>[number]['status'],
    language: StorefrontLanguage,
): string {
    const labels = {
        READY: language === 'zh' ? '可下载' : 'Ready',
        PAYMENT_REQUIRED: language === 'zh' ? '付款后开放' : 'Available after payment',
        NOT_CONFIGURED: language === 'zh' ? '交付服务配置中' : 'Delivery is being configured',
        FILE_MISSING: language === 'zh' ? '内容准备中，请联系商家' : 'Content is being prepared',
    };
    return labels[status];
}

function orderStatesForTab(tab: OrderTab): string[] | undefined {
    if (tab === 'pending') return ['AddingItems', 'ArrangingPayment'];
    if (tab === 'shipping') return ['PaymentAuthorized', 'PaymentSettled'];
    if (tab === 'receiving') return ['Shipped', 'PartiallyShipped'];
    return undefined;
}
