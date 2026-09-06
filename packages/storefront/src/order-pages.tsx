import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
    ArrowLeft,
    Boxes,
    ChevronRight,
    CircleAlert,
    CircleCheck,
    Clock3,
    Download,
    Navigation,
    Package,
    PackageCheck,
    Radio,
    RotateCcw,
    Search,
    ShieldCheck,
    Sparkles,
    Store,
    Truck,
    UserRound,
    WifiOff,
    X,
} from 'lucide-react';
import { FormEvent, ReactNode, useEffect, useId, useRef, useState } from 'react';

import { ShopApi } from './api';
import { formatBusinessDate } from './business-time';
import { useDesktopLayout } from './desktop-layout';
import { compactUiCopy, languageCodeFor } from './i18n';
import { offlineLoadError } from './loading-state';
import { ORDER_STATUS_REFRESH_INTERVAL, orderNeedsStatusRefresh } from './order-refresh';
import { PUBLIC_QUERY_GC_TIME, ROUTE_QUERY_STALE_TIME, storefrontQueryKeys } from './query-client';
import { PageSkeleton } from './route-loading';
import { acquireBodyScrollLock } from './scroll-lock';
import { routeNavigateOptions } from './storefront-router';
import { SafeImage } from './storefront-ui/product-display';
import { orderPageStyles, pageClassName } from './tailwind/order-page-styles';
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

const orderPageClassName = (className?: string | false | null) => pageClassName(orderPageStyles, className);

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
    onBuyAgain: (order: OrderSummary) => Promise<void>;
    onNotify: (message: string) => void;
}) {
    const navigate = useNavigate();
    const navigateTo = (route: OrderRoute) => void navigate(routeNavigateOptions(route) as never);
    const isZh = language === 'zh';
    const desktop = useDesktopLayout();
    const compactCopy = compactUiCopy[language];
    const [tab, setTab] = useState<OrderTab>(initialTab);
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchInput, setSearchInput] = useState('');
    const [orderCode, setOrderCode] = useState('');
    const pageSize = 10;
    const queryClient = useQueryClient();
    const ordersQuery = useInfiniteQuery({
        queryKey: storefrontQueryKeys.customerOrders(
            storefrontQueryKeys.market(market),
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
    const countsQuery = useQuery({
        queryKey: storefrontQueryKeys.customerOrderCounts(
            storefrontQueryKeys.market(market),
            languageCodeFor(language),
            customer?.id ?? '',
        ),
        queryFn: ({ signal }) => api.customerOrderCounts(signal),
        enabled: desktop && !!customer,
        staleTime: ROUTE_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
    });
    const afterSalesQuery = useQuery({
        queryKey: storefrontQueryKeys.afterSalesRequests(
            storefrontQueryKeys.market(market),
            languageCodeFor(language),
            customer?.id ?? '',
        ),
        queryFn: ({ signal }) => api.afterSalesRequests(signal),
        enabled: Boolean(customer) && (desktop || tab === 'service'),
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
                    storefrontQueryKeys.market(market),
                    languageCodeFor(language),
                    customer?.id ?? '',
                ),
                current => current?.map(item => (item.id === cancelled.id ? cancelled : item)) ?? [cancelled],
            );
            onNotify(isZh ? '售后申请已撤销' : 'Return request cancelled');
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
        { id: 'all', label: compactCopy.orders.all },
        { id: 'pending', label: compactCopy.orders.unpaid },
        { id: 'shipping', label: compactCopy.orders.processing },
        { id: 'receiving', label: compactCopy.orders.shipped },
        { id: 'service', label: compactCopy.orders.returns },
    ];

    const tabCounts: Partial<Record<OrderTab, number>> = {
        ...countsQuery.data,
        all: customer?.orders.totalItems,
        service: afterSalesQuery.data?.length,
    };

    useEffect(() => setTab(initialTab), [initialTab]);

    return (
        <main className={orderPageClassName('page subpage orders-page')}>
            {desktop ? (
                <div className="desktop-orders-heading">
                    <h1>{compactCopy.orders.title}</h1>
                </div>
            ) : (
                <SubHeader
                    title={compactCopy.orders.title}
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
            )}
            <nav className={orderPageClassName('order-tabs')} aria-label={isZh ? '订单状态' : 'Order status'}>
                {tabs.map(item => (
                    <button
                        type="button"
                        key={item.id}
                        className={orderPageClassName(tab === item.id ? 'is-active' : undefined)}
                        aria-pressed={tab === item.id}
                        onClick={() => setTab(item.id)}
                    >
                        {item.label}
                        {desktop && customer && (
                            <span className="desktop-order-tab-count">
                                {tabCounts[item.id] ?? (countsQuery.isError ? '—' : '…')}
                            </span>
                        )}
                    </button>
                ))}
            </nav>
            {(desktop || searchOpen) && (
                <form
                    className={orderPageClassName('order-search')}
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
                    onAction={() => navigateTo({ name: 'login' })}
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
                    onOpenOrder={orderId => navigateTo({ name: 'order-detail', id: orderId })}
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
                <div className={orderPageClassName('order-list')}>
                    {desktop && (
                        <div className="desktop-order-columns" aria-hidden="true">
                            <span>{isZh ? '商品信息' : 'Products'}</span>
                            <span>{isZh ? '数量' : 'Quantity'}</span>
                            <span>{isZh ? '订单金额' : 'Order total'}</span>
                            <span>{isZh ? '订单状态' : 'Status'}</span>
                            <span>{isZh ? '操作' : 'Actions'}</span>
                        </div>
                    )}
                    {orders.map(order => (
                        <OrderCard
                            key={order.id}
                            desktop={desktop}
                            order={order}
                            locale={locale}
                            language={language}
                            storefrontName={storefrontName}
                            onOpen={() => navigateTo({ name: 'order-detail', id: order.id })}
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
                            className={orderPageClassName('load-more-button order-load-more')}
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
                    {desktop && orders.length >= totalItems && !listError && (
                        <div className="desktop-orders-end">
                            <p>{isZh ? '没有更多订单' : 'No more orders'}</p>
                            <button
                                type="button"
                                onClick={() => void navigate(routeNavigateOptions({ name: 'home' }) as never)}
                            >
                                {isZh ? '继续选购' : 'Continue shopping'}
                            </button>
                        </div>
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
}: {
    api: ShopApi;
    customer: ActiveCustomer | null;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    onBack: () => void;
}) {
    const navigate = useNavigate();
    const navigateTo = (route: OrderRoute) => void navigate(routeNavigateOptions(route) as never);
    const isZh = language === 'zh';
    const [filter, setFilter] = useState<LogisticsFilter>('all');
    const pageSize = 10;
    const logisticsQuery = useInfiniteQuery({
        queryKey: storefrontQueryKeys.customerOrders(
            storefrontQueryKeys.market(market),
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
    const counts = {
        all: logisticsOrders.length,
        transit: logisticsOrders.filter(o => logisticsStatusForOrder(o) === 'transit').length,
        preparing: logisticsOrders.filter(o => logisticsStatusForOrder(o) === 'preparing').length,
        delivered: logisticsOrders.filter(o => logisticsStatusForOrder(o) === 'delivered').length,
    };

    return (
        <main className={orderPageClassName('page subpage logistics-page')}>
            <SubHeader title={isZh ? '物流动态' : 'Delivery updates'} language={language} onBack={onBack} />

            {/* 1. 模块化物流状态仪表盘 */}
            <div className={orderPageClassName('logistics-modular-hub')}>
                <nav
                    className={orderPageClassName('logistics-stats-grid')}
                    aria-label={isZh ? '物流状态筛选' : 'Filter delivery status'}
                >
                    <button
                        type="button"
                        className={orderPageClassName(
                            `logistics-stat-card ${filter === 'all' ? 'is-active' : ''}`,
                        )}
                        aria-pressed={filter === 'all'}
                        onClick={() => setFilter('all')}
                    >
                        <div className={orderPageClassName('stat-card-top')}>
                            <span className={orderPageClassName('stat-card-icon icon-all')}>
                                <Boxes size={18} />
                            </span>
                            <span className={orderPageClassName('stat-card-count')}>{counts.all}</span>
                        </div>
                        <span className={orderPageClassName('stat-card-label')}>
                            {isZh ? '全部包裹' : 'All'}
                        </span>
                    </button>

                    <button
                        type="button"
                        className={orderPageClassName(
                            `logistics-stat-card ${filter === 'transit' ? 'is-active' : ''}`,
                        )}
                        aria-pressed={filter === 'transit'}
                        onClick={() => setFilter('transit')}
                    >
                        <div className={orderPageClassName('stat-card-top')}>
                            <span className={orderPageClassName('stat-card-icon icon-transit')}>
                                <Truck size={18} />
                            </span>
                            <span className={orderPageClassName('stat-card-count')}>{counts.transit}</span>
                        </div>
                        <span className={orderPageClassName('stat-card-label')}>
                            {isZh ? '运输中' : 'In transit'}
                        </span>
                    </button>

                    <button
                        type="button"
                        className={orderPageClassName(
                            `logistics-stat-card ${filter === 'preparing' ? 'is-active' : ''}`,
                        )}
                        aria-pressed={filter === 'preparing'}
                        onClick={() => setFilter('preparing')}
                    >
                        <div className={orderPageClassName('stat-card-top')}>
                            <span className={orderPageClassName('stat-card-icon icon-preparing')}>
                                <Clock3 size={18} />
                            </span>
                            <span className={orderPageClassName('stat-card-count')}>{counts.preparing}</span>
                        </div>
                        <span className={orderPageClassName('stat-card-label')}>
                            {isZh ? '待发货' : 'Preparing'}
                        </span>
                    </button>

                    <button
                        type="button"
                        className={orderPageClassName(
                            `logistics-stat-card ${filter === 'delivered' ? 'is-active' : ''}`,
                        )}
                        aria-pressed={filter === 'delivered'}
                        onClick={() => setFilter('delivered')}
                    >
                        <div className={orderPageClassName('stat-card-top')}>
                            <span className={orderPageClassName('stat-card-icon icon-delivered')}>
                                <PackageCheck size={18} />
                            </span>
                            <span className={orderPageClassName('stat-card-count')}>{counts.delivered}</span>
                        </div>
                        <span className={orderPageClassName('stat-card-label')}>
                            {isZh ? '已签收' : 'Delivered'}
                        </span>
                    </button>
                </nav>

                {/* 2. 物流状态信息微条 */}
                <div className={orderPageClassName('logistics-service-strip')} aria-hidden="true">
                    <div className={orderPageClassName('service-strip-item')}>
                        <ShieldCheck size={13} />
                        <span>{isZh ? '配送状态可查' : 'Delivery Status'}</span>
                    </div>
                    <div className={orderPageClassName('service-strip-item')}>
                        <Radio size={13} />
                        <span>{isZh ? '实时路由追踪' : 'Live Tracking'}</span>
                    </div>
                    <div className={orderPageClassName('service-strip-item')}>
                        <Sparkles size={13} />
                        <span>{isZh ? '售后入口可查' : 'Returns available'}</span>
                    </div>
                </div>
            </div>
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
                    onAction={() => navigateTo({ name: 'login' })}
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
                <div className={orderPageClassName('logistics-list')}>
                    {visibleOrders.length ? (
                        visibleOrders.map(order => (
                            <LogisticsCard
                                key={order.id}
                                order={order}
                                locale={locale}
                                language={language}
                                onOpen={() => navigateTo({ name: 'order-detail', id: order.id })}
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
                            className={orderPageClassName('load-more-button logistics-load-more')}
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
        <article className={orderPageClassName(`logistics-card is-${status}`)}>
            <header>
                <span className={orderPageClassName('logistics-status-icon')}>
                    {logisticsStatusIcon(status)}
                </span>
                <span>
                    <strong>{logisticsStatusLabel(status, language)}</strong>
                    <small>{logisticsStatusHint(status, language)}</small>
                </span>
                <time dateTime={updatedAt ?? undefined}>
                    {updatedAt ? formatOrderDate(updatedAt, locale) : isZh ? '时间待更新' : 'Time pending'}
                </time>
            </header>
            <div className={orderPageClassName('logistics-products')}>
                {physicalLines.map(line => (
                    <div className={orderPageClassName('logistics-product')} key={line.id}>
                        <ProductVariantImage variant={line.productVariant} alt={line.productVariant.name} />
                        <span>
                            <strong>{line.productVariant.name}</strong>
                        </span>
                        <b>×{line.quantity}</b>
                    </div>
                ))}
            </div>
            <details className={orderPageClassName('logistics-detail')} open={status === 'transit'}>
                <summary>
                    <span>{isZh ? '查看物流详情' : 'View delivery details'}</span>
                    <ChevronRight aria-hidden="true" />
                </summary>
                <div className={orderPageClassName('logistics-detail-body')}>
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
                    <ol className={orderPageClassName('logistics-timeline')}>
                        <li className={orderPageClassName('is-current')}>
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
                    <button
                        type="button"
                        className={orderPageClassName('logistics-order-link')}
                        onClick={onOpen}
                    >
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
        <section
            className={orderPageClassName('after-sales-list')}
            aria-label={isZh ? '售后申请' : 'Return requests'}
        >
            {requests.map(request => (
                <article
                    key={request.id}
                    className={orderPageClassName(`after-sales-card is-${request.state.toLowerCase()}`)}
                >
                    <header>
                        <span>
                            {afterSalesStateIcon(request.state)}
                            <strong>{afterSalesStateLabel(request.state, language)}</strong>
                        </span>
                        <small>{request.code}</small>
                    </header>
                    <button
                        type="button"
                        className={orderPageClassName('after-sales-order-link')}
                        onClick={() => onOpenOrder(request.order.id)}
                    >
                        <span>{isZh ? `订单 ${request.order.code}` : `Order ${request.order.code}`}</span>
                        <ChevronRight aria-hidden="true" />
                    </button>
                    <div className={orderPageClassName('after-sales-items')}>
                        {request.items.map(item => (
                            <span key={item.id}>
                                <strong>{item.productName}</strong>
                                <small>
                                    {isZh ? '数量' : 'Qty'} × {item.quantity}
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
                            className={orderPageClassName('after-sales-cancel')}
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
    const autoCardDeliveries = order.autoCardDeliveries ?? [];
    const manualDigitalDeliveries = order.manualDigitalDeliveries ?? [];
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
    const refundableLines = order.lines.filter(
        line => line.customFields.refundPolicySnapshot !== 'NON_REFUNDABLE',
    );
    const canRequestAfterSales =
        refundableLines.length > 0 &&
        ['PaymentSettled', 'PartiallyShipped', 'Shipped', 'Delivered'].includes(order.state);
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
        <main className={orderPageClassName('page subpage order-detail-page')}>
            <SubHeader title={isZh ? '订单详情' : 'Order details'} language={language} onBack={onBack} />
            <section className={orderPageClassName('order-status')}>
                <strong>{orderStateLabel(order.state, language)}</strong>
                <span>{statusHint}</span>
                <small>{isZh ? `订单号 ${order.code}` : `Order ${order.code}`}</small>
            </section>
            {(inTransit || fulfillments.length > 0) && (
                <section className={orderPageClassName('order-logistics')} id="order-logistics">
                    <Navigation />
                    <div className={orderPageClassName('order-logistics-content')}>
                        <strong>{isZh ? '物流信息' : 'Delivery details'}</strong>
                        {fulfillments.length ? (
                            fulfillments.map((fulfillment, index) => (
                                <div
                                    className={orderPageClassName('order-logistics-item')}
                                    key={fulfillment.id}
                                >
                                    <span>
                                        {fulfillments.length > 1
                                            ? isZh
                                                ? `包裹 ${index + 1}`
                                                : `Shipment ${index + 1}`
                                            : isZh
                                              ? '配送包裹'
                                              : 'Shipment'}
                                    </span>
                                    <small>{fulfillmentMethodLabel(fulfillment.method, language)}</small>
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
            <section className={orderPageClassName('order-detail-products')}>
                <header>
                    <strong>{storefrontName}</strong>
                    <span>{isZh ? `${order.lines.length} 种商品` : `${order.lines.length} products`}</span>
                </header>
                {order.lines.map(line => (
                    <article key={line.id}>
                        <ProductVariantImage variant={line.productVariant} alt={line.productVariant.name} />
                        <div>
                            <strong>{line.productVariant.name}</strong>
                            <em>{orderLinePolicyLabel(line, language)}</em>
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
                <section
                    className={orderPageClassName('digital-delivery-panel')}
                    aria-labelledby="digital-delivery-title"
                >
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
            {!!autoCardDeliveries.length && (
                <section
                    className={orderPageClassName('digital-delivery-panel auto-card-delivery-panel')}
                    aria-labelledby="auto-card-delivery-title"
                >
                    <header>
                        <div>
                            <ShieldCheck aria-hidden="true" />
                            <strong id="auto-card-delivery-title">
                                {isZh ? '邮箱自动发卡' : 'Automatic email delivery'}
                            </strong>
                        </div>
                        <small>
                            {isZh
                                ? '付款后系统按号池顺序取号并发送到下单邮箱；请检查垃圾邮件。'
                                : 'Credentials are assigned in sequence and sent to the checkout email after payment.'}
                        </small>
                    </header>
                    <div>
                        {autoCardDeliveries.map(delivery => (
                            <article key={delivery.id}>
                                <span>
                                    <strong>{delivery.productName}</strong>
                                    <small>
                                        {isZh ? '数量' : 'Qty'} × {delivery.quantity}
                                    </small>
                                </span>
                                <em>{autoCardDeliveryStatus(delivery.state, language)}</em>
                            </article>
                        ))}
                    </div>
                </section>
            )}
            {!!manualDigitalDeliveries.length && (
                <section
                    className={orderPageClassName('digital-delivery-panel manual-digital-delivery-panel')}
                    aria-labelledby="manual-digital-delivery-title"
                >
                    <header>
                        <div>
                            <Clock3 aria-hidden="true" />
                            <strong id="manual-digital-delivery-title">
                                {isZh ? '人工虚拟交付' : 'Manual digital delivery'}
                            </strong>
                        </div>
                        <small>
                            {isZh
                                ? '商家完成后会将对应数量的成品发送到订单交付邮箱。'
                                : 'The merchant will email the exact purchased quantity when preparation is complete.'}
                        </small>
                    </header>
                    <div>
                        {manualDigitalDeliveries.map(delivery => (
                            <article key={delivery.id}>
                                <span>
                                    <strong>{delivery.productName}</strong>
                                    <small>
                                        {isZh ? '数量' : 'Qty'} × {delivery.quantity}
                                    </small>
                                </span>
                                <em>{manualDigitalDeliveryStatus(delivery, locale, language)}</em>
                            </article>
                        ))}
                    </div>
                </section>
            )}
            <section className={orderPageClassName('order-information')}>
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
            <section className={orderPageClassName('order-detail-summary')}>
                <PriceSummary order={order} locale={locale} language={language} />
            </section>
            <div className={orderPageClassName('order-detail-actions')}>
                {canCancel && (
                    <button
                        type="button"
                        className={orderPageClassName('danger-action')}
                        onClick={() => setCancelOpen(true)}
                    >
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
                    className={orderPageClassName('primary-action')}
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
    const eligibleLines = order.lines.filter(line => !isAutoCardLine(line));
    const selectedLines = eligibleLines.filter(line => (quantities[line.id] ?? 0) > 0);
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
        const releaseBodyScrollLock = acquireBodyScrollLock();
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
        document.addEventListener('keydown', keydown);
        return () => {
            cancelAnimationFrame(frame);
            document.removeEventListener('keydown', keydown);
            releaseBodyScrollLock();
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
        <div className={orderPageClassName('sheet-layer')} role="presentation">
            <button
                className={orderPageClassName('sheet-mask')}
                type="button"
                disabled={submitting}
                onClick={onClose}
                aria-label={isZh ? '关闭' : 'Close'}
            />
            <section
                ref={dialogRef}
                className={orderPageClassName('sheet after-sales-sheet')}
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
                    <fieldset className={orderPageClassName('after-sales-line-selection')}>
                        <legend>{isZh ? '选择商品和数量' : 'Select products and quantities'}</legend>
                        {eligibleLines.map(line => {
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
                                        </span>
                                    </label>
                                    {selected && (
                                        <label className={orderPageClassName('after-sales-quantity')}>
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
                        {eligibleLines.length < order.lines.length && (
                            <div className={orderPageClassName('inline-notice')} role="note">
                                {isZh
                                    ? '自动发卡商品发卡后不支持退款，发卡异常请联系客服。'
                                    : 'Automatically delivered credentials are non-refundable. Contact support for delivery issues.'}
                            </div>
                        )}
                    </fieldset>
                    <label className={orderPageClassName('after-sales-field')}>
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
                    <label className={orderPageClassName('after-sales-field')}>
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
                    <label className={orderPageClassName('after-sales-field')}>
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
                    <div className={orderPageClassName('after-sales-request-total')}>
                        <span>{isZh ? '预计申请金额' : 'Estimated request amount'}</span>
                        <strong>{formatMoney(requestedPreview, order.currencyCode, locale)}</strong>
                        <small>
                            {isZh
                                ? '最终金额由商家审核，当前不会发起真实退款'
                                : 'The store will review the final amount. No payment refund is initiated now.'}
                        </small>
                    </div>
                    {error && (
                        <div className={orderPageClassName('inline-error')} role="alert">
                            {error}
                        </div>
                    )}
                    <div className={orderPageClassName('after-sales-submit-actions')}>
                        <button type="button" disabled={submitting} onClick={onClose}>
                            {isZh ? '取消' : 'Cancel'}
                        </button>
                        <button
                            className={orderPageClassName('primary-action')}
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
    desktop = false,
    order,
    locale,
    language,
    storefrontName,
    onOpen,
    onBuyAgain,
}: {
    desktop?: boolean;
    order: OrderSummary;
    locale: string;
    language: StorefrontLanguage;
    storefrontName: string;
    onOpen: () => void;
    onBuyAgain: () => void;
}) {
    const isZh = language === 'zh';
    const compactCopy = compactUiCopy[language];
    const isPendingPayment = ['AddingItems', 'ArrangingPayment'].includes(order.state);
    const isPaidOrShipping = ['PaymentAuthorized', 'PaymentSettled'].includes(order.state);
    const isShipped = ['Shipped', 'PartiallyShipped'].includes(order.state);
    const isDelivered = order.state === 'Delivered';
    const isCancelled = order.state === 'Cancelled';

    const stateModifier = isPendingPayment
        ? 'is-pending'
        : isShipped
          ? 'is-shipped'
          : isPaidOrShipping
            ? 'is-shipping'
            : isDelivered
              ? 'is-delivered'
              : 'is-cancelled';

    const line = order.lines[0];
    const firstLineName = line?.productVariant.name ?? (isZh ? '订单商品' : 'Order item');
    const productPresentation = orderProductPresentation(line, order.lines.length - 1, language);

    const formattedTime = order.orderPlacedAt ? formatBusinessDate(locale, order.orderPlacedAt) : '';

    return (
        <article className={orderPageClassName(`order-card ${stateModifier}`)}>
            <header className={orderPageClassName('order-card-header')}>
                <button type="button" className={orderPageClassName('order-card-store-btn')} onClick={onOpen}>
                    <Store className={orderPageClassName('order-card-store-icon')} aria-hidden="true" />
                    <strong>{desktop ? `${isZh ? '订单' : 'Order'} ${order.code}` : storefrontName}</strong>
                    <ChevronRight aria-hidden="true" />
                </button>
                {desktop && formattedTime ? (
                    <time className="desktop-order-date" dateTime={order.orderPlacedAt ?? undefined}>
                        {formattedTime}
                    </time>
                ) : null}
                <span className={orderPageClassName(`order-state-badge ${stateModifier}`)}>
                    {orderStateLabel(order.state, language)}
                </span>
            </header>
            <button className={orderPageClassName('order-card-product')} type="button" onClick={onOpen}>
                <OrderImage order={order} />
                <div className={orderPageClassName('order-product-content')}>
                    <div className={orderPageClassName('order-product-heading')}>
                        <strong className={orderPageClassName('order-product-title')}>{firstLineName}</strong>
                        <b className={orderPageClassName('order-product-price')}>
                            {formatMoney(
                                line?.linePriceWithTax ?? order.totalWithTax,
                                order.currencyCode,
                                locale,
                            )}
                        </b>
                    </div>
                    <small className={orderPageClassName('order-product-spec')}>
                        {productPresentation.description}
                    </small>
                    <div className={orderPageClassName('order-product-bottom')}>
                        <div className={orderPageClassName('order-product-tags')}>
                            {productPresentation.tags.map((tag, index) => (
                                <span
                                    key={`${index}-${tag}`}
                                    className={orderPageClassName(
                                        `order-product-tag ${index === 1 ? 'is-service' : ''}`,
                                    )}
                                >
                                    {tag}
                                </span>
                            ))}
                        </div>
                        <small className={orderPageClassName('order-product-qty')}>
                            ×{order.totalQuantity}
                        </small>
                    </div>
                </div>
            </button>
            {desktop && (
                <div className="desktop-order-values">
                    <span>{order.totalQuantity}</span>
                    <strong>{formatMoney(order.totalWithTax, order.currencyCode, locale)}</strong>
                    <span>{orderStateLabel(order.state, language)}</span>
                </div>
            )}
            <footer className={orderPageClassName('order-card-footer')}>
                <div className={orderPageClassName('order-total-summary')}>
                    <span className={orderPageClassName('order-total-count')}>
                        {isZh ? `共 ${order.totalQuantity} 件` : `${order.totalQuantity} items`}
                    </span>
                    <span className={orderPageClassName('order-total-label')}>
                        {isPendingPayment ? compactCopy.orders.due : isZh ? '实付' : 'Total'}
                    </span>
                    <strong className={orderPageClassName('order-total-amount')}>
                        {formatMoney(order.totalWithTax, order.currencyCode, locale)}
                    </strong>
                </div>
                <div className={orderPageClassName('order-card-buttons')}>
                    <button
                        type="button"
                        className={orderPageClassName('order-btn secondary-btn')}
                        onClick={onOpen}
                    >
                        {isZh ? '查看详情' : 'Details'}
                    </button>
                    {isPendingPayment && (
                        <button
                            type="button"
                            className={orderPageClassName('order-btn primary-btn')}
                            onClick={onOpen}
                        >
                            {isZh ? '立即付款' : 'Pay now'}
                        </button>
                    )}
                    {isShipped && (
                        <button
                            type="button"
                            className={orderPageClassName('order-btn primary-btn')}
                            onClick={onOpen}
                        >
                            {isZh ? '查看物流' : 'Track'}
                        </button>
                    )}
                    {(isDelivered || isCancelled) && (
                        <button
                            type="button"
                            className={orderPageClassName('order-btn primary-btn')}
                            onClick={onBuyAgain}
                        >
                            {isZh ? '再次购买' : 'Buy again'}
                        </button>
                    )}
                </div>
            </footer>
        </article>
    );
}

function orderProductPresentation(
    line: OrderSummary['lines'][number] | undefined,
    additionalLineCount: number,
    language: StorefrontLanguage,
): { description: string; tags: [string, string] } {
    const isZh = language === 'zh';
    if (!line) {
        return {
            description: isZh ? '查看订单了解商品与交付信息' : 'Open the order for item and delivery details',
            tags: isZh ? ['订单商品', '详情可查'] : ['Order item', 'Details available'],
        };
    }

    const fulfillmentType =
        line.customFields.fulfillmentTypeSnapshot ?? line.productVariant.customFields.fulfillmentType;
    const deliveryMode =
        line.customFields.digitalDeliveryModeSnapshot ??
        line.productVariant.customFields.digitalDeliveryMode ??
        'manual_service';
    const hasAdditionalLines = additionalLineCount > 0;
    const additionalItemsDescription = isZh
        ? `另有 ${additionalLineCount} 种商品，详情中可查看`
        : `${additionalLineCount} more ${additionalLineCount === 1 ? 'item' : 'items'} in this order`;

    if (fulfillmentType === 'physical') {
        return {
            description: hasAdditionalLines
                ? additionalItemsDescription
                : isZh
                  ? '商家发货后可查看配送进度'
                  : 'Track delivery after the item ships',
            tags: isZh ? ['实体商品', '物流可查'] : ['Physical item', 'Tracking'],
        };
    }

    const digitalCopy = {
        auto_card: {
            description: isZh ? '支付后自动发送至下单邮箱' : 'Sent automatically to your checkout email',
            tag: isZh ? '自动发货' : 'Auto delivery',
        },
        file_download: {
            description: isZh ? '支付后可在订单详情中下载' : 'Download from the order details after payment',
            tag: isZh ? '文件下载' : 'Download',
        },
        manual_service: {
            description: isZh ? '支付后由商家按订单信息处理' : 'The merchant handles delivery after payment',
            tag: isZh ? '人工服务' : 'Manual service',
        },
    } as const;
    const presentation = digitalCopy[deliveryMode];

    return {
        description: hasAdditionalLines ? additionalItemsDescription : presentation.description,
        tags: isZh ? ['数字商品', presentation.tag] : ['Digital item', presentation.tag],
    };
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
        <header className={orderPageClassName('topbar subpage-header')}>
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
        <main className={orderPageClassName('page subpage')}>
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
        <section className={orderPageClassName('empty-state')}>
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
        <div className={orderPageClassName('inline-error')} role="alert">
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
            <div className={orderPageClassName('image-placeholder')} aria-hidden="true">
                <Package />
            </div>
        );
    return <SafeImage src={source} alt={alt} imageKind="thumbnail" loading="lazy" decoding="async" />;
}

function OrderImage({ order }: { order: OrderSummary }) {
    const variant = order.lines[0]?.productVariant;
    return variant ? (
        <ProductVariantImage variant={variant} alt={variant.name} />
    ) : (
        <div className={orderPageClassName('image-placeholder')} aria-hidden="true">
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
        <dl className={orderPageClassName('price-summary')}>
            <div>
                <dt>{isZh ? '商品金额' : 'Items'}</dt>
                <dd>{formatMoney(order.subTotalWithTax + discount, order.currencyCode, locale)}</dd>
            </div>
            <div>
                <dt>{isZh ? '运费' : 'Shipping'}</dt>
                <dd>{formatMoney(order.shippingWithTax, order.currencyCode, locale)}</dd>
            </div>
            {discount > 0 && (
                <div className={orderPageClassName('discount')}>
                    <dt>{isZh ? '优惠' : 'Discount'}</dt>
                    <dd>-{formatMoney(discount, order.currencyCode, locale)}</dd>
                </div>
            )}
            <TaxSummaryRows order={order} locale={locale} language={language} />
            <div className={orderPageClassName('summary-total')}>
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
        const releaseBodyScrollLock = acquireBodyScrollLock();
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
        document.addEventListener('keydown', keydown);
        return () => {
            cancelAnimationFrame(frame);
            document.removeEventListener('keydown', keydown);
            releaseBodyScrollLock();
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
        <div className={orderPageClassName('sheet-layer')} role="presentation">
            <button
                className={orderPageClassName('sheet-mask')}
                type="button"
                disabled={submitting}
                onClick={onClose}
                aria-label={isZh ? '关闭' : 'Close'}
            />
            <section
                ref={dialogRef}
                className={orderPageClassName('sheet order-cancel-sheet')}
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
                        <div className={orderPageClassName('inline-error')} role="alert">
                            {error}
                        </div>
                    )}
                    <div className={orderPageClassName('order-cancel-actions')}>
                        <button type="button" disabled={submitting} onClick={onClose}>
                            {isZh ? '暂不取消' : 'Keep order'}
                        </button>
                        <button
                            className={orderPageClassName('danger-action')}
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

function isAutoCardLine(line: Order['lines'][number]): boolean {
    const fulfillmentType =
        line.customFields.fulfillmentTypeSnapshot ?? line.productVariant.customFields.fulfillmentType;
    const deliveryMode =
        line.customFields.digitalDeliveryModeSnapshot ??
        line.productVariant.customFields.digitalDeliveryMode ??
        'manual_service';
    return fulfillmentType === 'digital' && deliveryMode === 'auto_card';
}

function fulfillmentMethodLabel(method: string, language: StorefrontLanguage): string {
    const normalizedMethod = method.trim().toLowerCase();
    if (normalizedMethod === 'digital-fulfillment') {
        return language === 'zh' ? '文件下载' : 'File download';
    }
    if (normalizedMethod === 'manual-digital-service' || normalizedMethod === 'manual-service-fulfillment') {
        return language === 'zh' ? '人工数字服务' : 'Manual digital service';
    }
    if (normalizedMethod === 'auto-card-email' || normalizedMethod === 'auto-card-fulfillment') {
        return language === 'zh' ? '邮箱自动发卡' : 'Automatic email delivery';
    }
    return method;
}

function autoCardDeliveryStatus(
    state: NonNullable<Order['autoCardDeliveries']>[number]['state'],
    language: StorefrontLanguage,
): string {
    const labels = {
        WAITING_STOCK: language === 'zh' ? '等待补货，商家已收到告警' : 'Waiting for stock',
        ALLOCATED: language === 'zh' ? '已取号，准备发送' : 'Credentials allocated',
        RETRYING: language === 'zh' ? '邮件发送重试中' : 'Email delivery retrying',
        SENT: language === 'zh' ? '已发送到下单邮箱' : 'Sent to checkout email',
        MANUAL_REVIEW: language === 'zh' ? '发送异常，已转人工处理' : 'Delivery needs manual review',
    };
    return labels[state];
}

function manualDigitalDeliveryStatus(
    delivery: NonNullable<Order['manualDigitalDeliveries']>[number],
    locale: string,
    language: StorefrontLanguage,
): string {
    if (delivery.state === 'SENT') return language === 'zh' ? '已发送到交付邮箱' : 'Sent to delivery email';
    if (delivery.state === 'EMAIL_FAILED')
        return language === 'zh' ? '邮件发送失败，正在重试' : 'Email failed; retrying';
    if (delivery.state === 'MANUAL_REVIEW')
        return language === 'zh' ? '交付异常，已转人工核查' : 'Delivery needs manual review';
    if (delivery.state === 'CANCELLED') return language === 'zh' ? '交付任务已取消' : 'Delivery cancelled';
    if (delivery.overdue)
        return language === 'zh' ? '已超过预计时间，请联系商家' : 'Past estimate; contact the merchant';
    return language === 'zh'
        ? `预计 ${formatOrderDate(delivery.expectedAt, locale)} 前完成`
        : `Expected by ${formatOrderDate(delivery.expectedAt, locale)}`;
}

function orderLinePolicyLabel(line: Order['lines'][number], language: StorefrontLanguage): string {
    const isZh = language === 'zh';
    const digital = line.customFields.fulfillmentTypeSnapshot === 'digital';
    const mode = line.customFields.digitalDeliveryModeSnapshot;
    const delivery =
        mode === 'auto_card'
            ? isZh
                ? '虚拟商品 · 邮箱自动发卡'
                : 'Digital credentials · email delivery'
            : mode === 'file_download'
              ? isZh
                  ? '虚拟商品 · 文件下载'
                  : 'Digital · file download'
              : digital
                ? isZh
                    ? '虚拟商品 · 人工交付'
                    : 'Digital · manual delivery'
                : isZh
                  ? '实物商品 · 物流配送'
                  : 'Physical · shipping';
    const policy =
        line.customFields.refundPolicySnapshot === 'NON_REFUNDABLE'
            ? isZh
                ? '不支持退款'
                : 'Non-refundable'
            : line.customFields.refundPolicySnapshot === 'SEVEN_DAY_NO_REASON'
              ? isZh
                  ? '7天无理由'
                  : 'Seven-day return'
              : isZh
                ? '退款需商家审核'
                : 'Merchant-reviewed refunds';
    return `${delivery} · ${policy}`;
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
