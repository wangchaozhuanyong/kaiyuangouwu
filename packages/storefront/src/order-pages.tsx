import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
    ArrowLeft,
    ChevronRight,
    CircleAlert,
    CircleCheck,
    Clock3,
    Headphones,
    Package,
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

import { fulfillmentStateDisplayLabel } from '../../common/src/display-localization';
import { ContentText } from '../../storefront-content-plugin/src/shared/content-text';

import { ShopApi } from './api';
import { formatBusinessDate } from './business-time';
import {
    AfterSalesEvidenceGallery,
    AfterSalesEvidenceUploader,
} from './components/common/after-sales-evidence';
import { useDesktopLayout } from './desktop-layout';
import { DigitalReceiptPanel, orderHasDigitalDelivery } from './digital-receipt-panel';
import { compactUiCopy, languageCodeFor } from './i18n';
import { isInputMethodKey } from './input-method';
import { offlineLoadError, storefrontInitialQueryError } from './loading-state';
import { OrderAdditionalPaymentPanel } from './order-additional-payment-panel';
import { formatUsdtPaymentAmount, usdtPaymentReceipt } from './order-payment-display';
import { ORDER_STATUS_REFRESH_INTERVAL, orderNeedsStatusRefresh } from './order-refresh';
import { PUBLIC_QUERY_GC_TIME, ROUTE_QUERY_STALE_TIME, storefrontQueryKeys } from './query-client';
import { PageSkeleton } from './route-loading';
import { acquireBodyScrollLock } from './scroll-lock';
import { storefrontErrorMessage } from './storefront-errors';
import { routeNavigateOptions } from './storefront-router';
import { DeliveryDetails, physicalDeliveryLines, TrackingCode } from './storefront-ui/delivery-details';
import { customerOrderStateLabel, orderStatesForTab } from './storefront-ui/order-ui';
import { EmptyState, Sheet, SubHeader, Subpage } from './storefront-ui/page-shell';
import {
    ProductImagePlaceholder,
    productImageUnavailableLabel,
    SafeImage,
} from './storefront-ui/product-display';
import './styles/checkout-payment-surfaces.css';
import './styles/logistics.css';
import './styles/order-aftercare.css';
import './styles/order-detail-drawer.css';
import './styles/order-navigation.css';
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

export type OrderTab = 'all' | 'pending' | 'shipping' | 'receiving' | 'completed' | 'service';
type OrderRoute = { name: 'login' | 'order-detail'; id?: string };

export function OrdersPage({
    api,
    customer,
    market,
    locale,
    language,
    storefrontName,
    initialTab,
    onBack,
    onNotify,
    onOpenOrder,
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
    onOpenOrder?: (orderId: string) => void;
}) {
    const navigate = useNavigate();
    const navigateTo = (route: OrderRoute) => void navigate(routeNavigateOptions(route) as never);
    const openOrder = onOpenOrder ?? ((id: string) => navigateTo({ name: 'order-detail', id }));
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
    const [updatingAfterSalesId, setUpdatingAfterSalesId] = useState('');
    const updateAfterSalesCache = (updated: AfterSalesRequest) => {
        queryClient.setQueryData<AfterSalesRequest[]>(
            storefrontQueryKeys.afterSalesRequests(
                storefrontQueryKeys.market(market),
                languageCodeFor(language),
                customer?.id ?? '',
            ),
            current => current?.map(item => (item.id === updated.id ? updated : item)) ?? [updated],
        );
    };
    const cancelAfterSales = async (id: string) => {
        if (cancellingAfterSalesId) return;
        setCancellingAfterSalesId(id);
        try {
            const cancelled = await api.cancelAfterSalesRequest(id);
            updateAfterSalesCache(cancelled);
            onNotify(isZh ? '售后申请已撤销' : 'Return request cancelled');
        } catch (requestError) {
            onNotify(
                requestError instanceof Error
                    ? storefrontErrorMessage(requestError, language)
                    : isZh
                      ? '撤销售后申请失败'
                      : 'Could not cancel the request',
            );
        } finally {
            setCancellingAfterSalesId('');
        }
    };
    const submitAfterSalesReturn = async (id: string, carrier: string, trackingCode: string) => {
        if (updatingAfterSalesId) return;
        setUpdatingAfterSalesId(id);
        try {
            const updated = await api.submitAfterSalesReturnShipment({
                id,
                carrier,
                trackingCode,
                idempotencyKey: `storefront-return-${id}`,
            });
            updateAfterSalesCache(updated);
            onNotify(isZh ? '退货物流已提交' : 'Return shipment submitted');
        } catch (requestError) {
            onNotify(
                requestError instanceof Error
                    ? storefrontErrorMessage(requestError, language)
                    : isZh
                      ? '提交退货物流失败'
                      : 'Could not submit return shipment',
            );
        } finally {
            setUpdatingAfterSalesId('');
        }
    };
    const confirmAfterSalesReplacement = async (id: string) => {
        if (updatingAfterSalesId) return;
        setUpdatingAfterSalesId(id);
        try {
            const updated = await api.confirmAfterSalesReplacement({
                id,
                idempotencyKey: `storefront-received-${id}`,
            });
            updateAfterSalesCache(updated);
            onNotify(isZh ? '已确认收到换货/补发商品' : 'Replacement delivery confirmed');
        } catch (requestError) {
            onNotify(
                requestError instanceof Error
                    ? storefrontErrorMessage(requestError, language)
                    : isZh
                      ? '确认收货失败'
                      : 'Could not confirm delivery',
            );
        } finally {
            setUpdatingAfterSalesId('');
        }
    };
    const totalItems = ordersQuery.data?.pages[0]?.totalItems ?? 0;
    const loading = ordersQuery.isLoading;
    const loadingMore = ordersQuery.isFetchingNextPage;
    const listError = storefrontInitialQueryError(ordersQuery, language);
    const tabs: Array<{ id: OrderTab; label: string }> = [
        { id: 'all', label: compactCopy.orders.all },
        { id: 'pending', label: compactCopy.orders.unpaid },
        { id: 'shipping', label: compactCopy.orders.processing },
        { id: 'receiving', label: compactCopy.orders.shipped },
        { id: 'completed', label: compactCopy.orders.completed },
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
                <h1 className="desktop-orders-heading">{compactCopy.orders.title}</h1>
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
                              ? storefrontErrorMessage(afterSalesQuery.error, language)
                              : ''
                    }
                    cancellingId={cancellingAfterSalesId}
                    updatingId={updatingAfterSalesId}
                    locale={locale}
                    language={language}
                    onRetry={() => void afterSalesQuery.refetch({ cancelRefetch: false })}
                    onOpenOrder={openOrder}
                    onCancel={id => void cancelAfterSales(id)}
                    onSubmitReturn={(id, carrier, trackingCode) =>
                        void submitAfterSalesReturn(id, carrier, trackingCode)
                    }
                    onConfirmReplacement={id => void confirmAfterSalesReplacement(id)}
                />
            ) : loading && !orders.length ? (
                <PageSkeleton label={isZh ? '正在加载订单' : 'Loading orders'} />
            ) : listError && !orders.length ? (
                <EmptyState
                    icon={<WifiOff />}
                    title={isZh ? '订单加载失败' : 'Could not load orders'}
                    detail={listError}
                    action={isZh ? '重试' : 'Retry'}
                    onAction={() => void ordersQuery.refetch({ cancelRefetch: false })}
                />
            ) : orders.length ? (
                <div className={orderPageClassName('order-list')}>
                    {orders.map(order => (
                        <OrderCard
                            key={order.id}
                            desktop={desktop}
                            order={order}
                            locale={locale}
                            language={language}
                            storefrontName={storefrontName}
                            onOpen={() => openOrder(order.id)}
                        />
                    ))}
                    {listError && (
                        <InlineError
                            message={listError}
                            action={isZh ? '重试' : 'Retry'}
                            onAction={() => void ordersQuery.fetchNextPage({ cancelRefetch: false })}
                        />
                    )}
                    {orders.length < totalItems && (
                        <button
                            type="button"
                            className={orderPageClassName('load-more-button order-load-more')}
                            disabled={loadingMore}
                            onClick={() => void ordersQuery.fetchNextPage({ cancelRefetch: false })}
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

export { LogisticsPage } from './pages/logistics-page';

function AfterSalesList({
    requests,
    loading,
    error,
    cancellingId,
    updatingId,
    locale,
    language,
    onRetry,
    onOpenOrder,
    onCancel,
    onSubmitReturn,
    onConfirmReplacement,
}: {
    requests: AfterSalesRequest[];
    loading: boolean;
    error: string;
    cancellingId: string;
    updatingId: string;
    locale: string;
    language: StorefrontLanguage;
    onRetry: () => void;
    onOpenOrder: (orderId: string) => void;
    onCancel: (id: string) => void;
    onSubmitReturn: (id: string, carrier: string, trackingCode: string) => void;
    onConfirmReplacement: (id: string) => void;
}) {
    const isZh = language === 'zh';
    const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
    const request = requests.find(item => item.id === selectedRequestId);
    const [shipmentDrafts, setShipmentDrafts] = useState<
        Record<string, { carrier: string; trackingCode: string }>
    >({});
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
        <>
            <section className="after-sales-list" aria-label={isZh ? '售后申请' : 'Return requests'}>
                {requests.map(item => (
                    <article key={item.id} className={`after-sales-card is-${item.state.toLowerCase()}`}>
                        <header>
                            <span className="after-sales-status">
                                {afterSalesStateIcon(item.state)}
                                <strong>{afterSalesStateLabel(item.state, language)}</strong>
                            </span>
                            <small>{afterSalesTypeLabel(item.type, language)}</small>
                        </header>
                        <div className="after-sales-summary">
                            <div>
                                <strong>
                                    {item.items[0]?.productName ?? (isZh ? '售后商品' : 'Requested items')}
                                </strong>
                                <small>
                                    {isZh
                                        ? `共 ${item.items.reduce((total, product) => total + product.quantity, 0)} 件商品`
                                        : `${item.items.reduce((total, product) => total + product.quantity, 0)} items`}
                                    {item.items.length > 1
                                        ? isZh
                                            ? ` · ${item.items.length} 款`
                                            : ` · ${item.items.length} products`
                                        : ''}
                                </small>
                            </div>
                            <div className="after-sales-summary-amount">
                                <small>{isZh ? '申请金额' : 'Requested'}</small>
                                <strong>
                                    {formatMoney(item.requestedAmount, item.currencyCode, locale)}
                                </strong>
                            </div>
                        </div>
                        {item.state === 'APPROVED' &&
                            (item.returnStatus === 'AWAITING_SHIPMENT' ||
                                ['SHIPPED', 'EXCEPTION'].includes(item.replacementStatus)) && (
                                <p className="after-sales-next-action">
                                    {item.returnStatus === 'AWAITING_SHIPMENT'
                                        ? isZh
                                            ? '待填写退货物流'
                                            : 'Return shipment needed'
                                        : item.replacementStatus === 'EXCEPTION'
                                          ? isZh
                                              ? '换货物流异常，请查看详情'
                                              : 'Replacement issue · view details'
                                          : isZh
                                            ? '待确认换货/补发收货'
                                            : 'Confirm replacement receipt'}
                                    {item.nextActionDueAt
                                        ? ` · ${formatOrderDate(item.nextActionDueAt, locale)}${item.overdue ? (isZh ? '（已超时）' : ' (overdue)') : ''}`
                                        : ''}
                                </p>
                            )}
                        <footer>
                            <small>
                                {isZh ? '更新于 ' : 'Updated '}
                                {formatOrderDate(item.updatedAt, locale)}
                            </small>
                            <button
                                type="button"
                                className="after-sales-details-button"
                                aria-haspopup="dialog"
                                onClick={() => setSelectedRequestId(item.id)}
                            >
                                {isZh ? '查看详情' : 'View details'}
                                <ChevronRight aria-hidden="true" />
                            </button>
                        </footer>
                    </article>
                ))}
            </section>
            {request && (
                <Sheet
                    title={isZh ? '售后详情' : 'After-sales details'}
                    language={language}
                    side="right"
                    className="after-sales-detail-sheet"
                    onClose={() => setSelectedRequestId(null)}
                >
                    <div className="after-sales-detail-body">
                        <div className="after-sales-detail-status">
                            <span className="after-sales-status">
                                {afterSalesStateIcon(request.state)}
                                <strong>{afterSalesStateLabel(request.state, language)}</strong>
                            </span>
                            <small>
                                {isZh ? '售后单号 ' : 'Request '}
                                {request.code}
                            </small>
                        </div>
                        <section
                            className="after-sales-detail-section"
                            aria-label={isZh ? '申请信息' : 'Request information'}
                        >
                            <h3>{isZh ? '申请信息' : 'Request information'}</h3>
                            <button
                                type="button"
                                className="after-sales-order-link"
                                onClick={() => {
                                    setSelectedRequestId(null);
                                    onOpenOrder(request.order.id);
                                }}
                            >
                                <span>
                                    {isZh ? `订单 ${request.order.code}` : `Order ${request.order.code}`}
                                </span>
                                <ChevronRight aria-hidden="true" />
                            </button>
                            <div className="after-sales-items">
                                {request.items.map(item => (
                                    <span key={item.id}>
                                        <strong>{item.productName}</strong>
                                        <small>
                                            {isZh ? '数量' : 'Qty'} × {item.quantity}
                                        </small>
                                    </span>
                                ))}
                            </div>
                            <dl className="after-sales-facts">
                                <div>
                                    <dt>{isZh ? '售后类型' : 'Type'}</dt>
                                    <dd>{afterSalesTypeLabel(request.type, language)}</dd>
                                </div>
                                <div>
                                    <dt>{isZh ? '申请原因' : 'Reason'}</dt>
                                    <dd>{afterSalesReasonLabel(request.reason, language)}</dd>
                                </div>
                                <div>
                                    <dt>{isZh ? '申请金额' : 'Requested'}</dt>
                                    <dd>
                                        {formatMoney(request.requestedAmount, request.currencyCode, locale)}
                                    </dd>
                                </div>
                                {request.approvedAmount != null && (
                                    <div>
                                        <dt>{isZh ? '通过金额' : 'Approved'}</dt>
                                        <dd>
                                            {formatMoney(
                                                request.approvedAmount,
                                                request.currencyCode,
                                                locale,
                                            )}
                                        </dd>
                                    </div>
                                )}
                                <div>
                                    <dt>{isZh ? '申请时间' : 'Submitted'}</dt>
                                    <dd>{formatOrderDate(request.createdAt, locale)}</dd>
                                </div>
                                <div>
                                    <dt>{isZh ? '更新时间' : 'Updated'}</dt>
                                    <dd>{formatOrderDate(request.updatedAt, locale)}</dd>
                                </div>
                            </dl>
                            {request.description && (
                                <div className="after-sales-detail-note">
                                    <strong>{isZh ? '问题描述' : 'Description'}</strong>
                                    <p>{request.description}</p>
                                </div>
                            )}
                            <AfterSalesEvidenceGallery
                                items={request.evidence ?? []}
                                language={language}
                                onRefresh={onRetry}
                            />
                        </section>
                        <section
                            className="after-sales-detail-section"
                            aria-label={isZh ? '处理进度' : 'Progress'}
                        >
                            <h3>{isZh ? '处理进度' : 'Progress'}</h3>
                            <dl className="after-sales-facts">
                                <div>
                                    <dt>{isZh ? '退货进度' : 'Return'}</dt>
                                    <dd>{afterSalesReturnStatusLabel(request.returnStatus, language)}</dd>
                                </div>
                                <div>
                                    <dt>{isZh ? '换货/补发进度' : 'Replacement'}</dt>
                                    <dd>
                                        {afterSalesReplacementStatusLabel(
                                            request.replacementStatus,
                                            language,
                                        )}
                                    </dd>
                                </div>
                                {request.nextActionDueAt && (
                                    <div>
                                        <dt>{isZh ? '下一步时限' : 'Next action due'}</dt>
                                        <dd>
                                            {formatOrderDate(request.nextActionDueAt, locale)}
                                            {request.overdue ? (isZh ? '（已超时）' : ' (overdue)') : ''}
                                        </dd>
                                    </div>
                                )}
                            </dl>
                            {request.resolution && (
                                <div className="after-sales-detail-note">
                                    <strong>{isZh ? '处理说明' : 'Resolution'}</strong>
                                    <p>{request.resolution}</p>
                                </div>
                            )}
                            {request.returnInstructions && (
                                <div className="after-sales-instructions">
                                    <strong>{isZh ? '退货说明' : 'Return instructions'}</strong>
                                    <p>{request.returnInstructions}</p>
                                </div>
                            )}
                            {request.returnTrackingCode && (
                                <p className="after-sales-tracking">
                                    {isZh ? '退货物流' : 'Return shipment'}: {request.returnCarrier} ·{' '}
                                    {request.returnTrackingCode}
                                </p>
                            )}
                            {request.replacementTrackingCode && (
                                <p className="after-sales-tracking">
                                    {isZh ? '换货/补发物流' : 'Replacement shipment'}:{' '}
                                    {request.replacementCarrier} · {request.replacementTrackingCode}
                                </p>
                            )}
                            {request.replacementException && (
                                <p className="after-sales-exception">{request.replacementException}</p>
                            )}
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
                            {request.state === 'APPROVED' && request.returnStatus === 'AWAITING_SHIPMENT' && (
                                <form
                                    className={orderPageClassName('after-sales-return-form')}
                                    onSubmit={event => {
                                        event.preventDefault();
                                        const draft = shipmentDrafts[request.id];
                                        if (!draft?.carrier.trim() || !draft.trackingCode.trim()) return;
                                        onSubmitReturn(
                                            request.id,
                                            draft.carrier.trim(),
                                            draft.trackingCode.trim(),
                                        );
                                    }}
                                >
                                    <label>
                                        <span>{isZh ? '物流公司' : 'Carrier'}</span>
                                        <input
                                            value={shipmentDrafts[request.id]?.carrier ?? ''}
                                            maxLength={120}
                                            disabled={Boolean(updatingId)}
                                            onChange={event =>
                                                setShipmentDrafts(current => ({
                                                    ...current,
                                                    [request.id]: {
                                                        carrier: event.target.value,
                                                        trackingCode: current[request.id]?.trackingCode ?? '',
                                                    },
                                                }))
                                            }
                                        />
                                    </label>
                                    <label>
                                        <span>{isZh ? '退货单号' : 'Return tracking code'}</span>
                                        <input
                                            value={shipmentDrafts[request.id]?.trackingCode ?? ''}
                                            maxLength={160}
                                            disabled={Boolean(updatingId)}
                                            onChange={event =>
                                                setShipmentDrafts(current => ({
                                                    ...current,
                                                    [request.id]: {
                                                        carrier: current[request.id]?.carrier ?? '',
                                                        trackingCode: event.target.value,
                                                    },
                                                }))
                                            }
                                        />
                                    </label>
                                    <button
                                        type="submit"
                                        disabled={
                                            Boolean(updatingId) ||
                                            !shipmentDrafts[request.id]?.carrier.trim() ||
                                            !shipmentDrafts[request.id]?.trackingCode.trim()
                                        }
                                    >
                                        {updatingId === request.id
                                            ? isZh
                                                ? '正在提交'
                                                : 'Submitting'
                                            : isZh
                                              ? '提交退货物流'
                                              : 'Submit return shipment'}
                                    </button>
                                </form>
                            )}
                            {request.state === 'APPROVED' &&
                                ['SHIPPED', 'EXCEPTION'].includes(request.replacementStatus) && (
                                    <button
                                        type="button"
                                        className={orderPageClassName('after-sales-confirm-delivery')}
                                        disabled={Boolean(updatingId)}
                                        onClick={() => onConfirmReplacement(request.id)}
                                    >
                                        {updatingId === request.id
                                            ? isZh
                                                ? '正在确认'
                                                : 'Confirming'
                                            : isZh
                                              ? '确认已收到换货/补发商品'
                                              : 'Confirm replacement received'}
                                    </button>
                                )}
                        </section>
                        <section
                            className="after-sales-detail-section"
                            aria-label={isZh ? '处理时间线' : 'Timeline'}
                        >
                            <h3>{isZh ? '处理时间线' : 'Timeline'}</h3>
                            {request.events.length ? (
                                <ol className="after-sales-timeline">
                                    {request.events.map(event => (
                                        <li key={event.id}>
                                            <span aria-hidden="true" />
                                            <div>
                                                <strong>{afterSalesStateLabel(event.state, language)}</strong>
                                                {event.note && <ContentText>{event.note}</ContentText>}
                                                <small>{formatOrderDate(event.createdAt, locale)}</small>
                                            </div>
                                        </li>
                                    ))}
                                </ol>
                            ) : (
                                <p className="after-sales-timeline-empty">
                                    {isZh ? '暂无处理记录' : 'No updates yet'}
                                </p>
                            )}
                        </section>
                    </div>
                </Sheet>
            )}
        </>
    );
}

export function OrderDetailPage({
    api,
    order,
    market,
    locale,
    language,
    reviewEnabled = true,
    storefrontName,
    onBack,
    backLabel,
    onBuyAgain,
    onReopen,
    onCancelOrder,
    onCreateAfterSales,
    onConfirmDelivery,
    onUnavailable,
    onNotify,
    presentation = 'page',
}: {
    presentation?: 'page' | 'drawer';
    api?: ShopApi;
    order: Order | null;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    reviewEnabled?: boolean;
    storefrontName: string;
    onBack: () => void;
    backLabel?: string;
    onBuyAgain: (order: Order) => Promise<void>;
    onReopen: (order: Order) => Promise<void>;
    onCancelOrder: (order: Order, reason: string) => Promise<void>;
    onCreateAfterSales: (input: CreateAfterSalesRequestInput) => Promise<void>;
    onConfirmDelivery: (fulfillmentId: string) => Promise<void>;
    onUnavailable: () => void;
    onNotify?: (message: string) => void;
}) {
    const navigate = useNavigate();
    const isZh = language === 'zh';
    const isDrawer = presentation === 'drawer';
    const desktop = useDesktopLayout() && !isDrawer;
    const [cancelOpen, setCancelOpen] = useState(false);
    const [afterSalesOpen, setAfterSalesOpen] = useState(false);
    const [logisticsSheetOpen, setLogisticsSheetOpen] = useState(false);
    const [confirmingDeliveryId, setConfirmingDeliveryId] = useState('');
    if (!order) {
        return (
            <Subpage title={isZh ? '订单详情' : 'Order details'} language={language} onBack={onBack}>
                <EmptyState icon={<Package />} title={isZh ? '没有找到订单' : 'Order not found'} />
            </Subpage>
        );
    }
    const inTransit = ['Shipped', 'PartiallyShipped'].includes(order.state);
    const inCart = order.state === 'AddingItems';
    const pending = ['AddingItems', 'ArrangingPayment'].includes(order.state);
    const needsAdditionalPayment = order.state === 'ArrangingAdditionalPayment';
    const isBeingModified = order.state === 'Modifying';
    const fulfillments = order.fulfillments ?? [];
    const canCancel =
        order.state === 'PaymentAuthorized' &&
        fulfillments.length === 0 &&
        order.lines.every(
            line =>
                line.customFields.fulfillmentTypeSnapshot !== 'digital' &&
                line.productVariant.customFields.fulfillmentType !== 'digital',
        );
    const refundableLines = order.lines.filter(
        line => line.customFields.refundPolicySnapshot !== 'NON_REFUNDABLE' && !isAutoCardLine(line),
    );
    const canRequestAfterSales =
        refundableLines.length > 0 &&
        ['PaymentSettled', 'TestPaymentSettled', 'PartiallyShipped', 'Shipped', 'Delivered'].includes(
            order.state,
        );
    const statusHint =
        order.state === 'TestPaymentSettled'
            ? isZh
                ? reviewEnabled
                    ? '订单已付款成功（测试模式），可正常测试发货、物流、评价及客服全流程'
                    : '订单已付款成功（测试模式），可正常测试发货、物流及客服流程'
                : reviewEnabled
                  ? 'Payment successful (test mode). Full fulfillment, logistics, review, and support workflows are enabled.'
                  : 'Payment successful (test mode). Fulfillment, logistics, and support workflows are enabled.'
            : needsAdditionalPayment
              ? isZh
                  ? '订单已调整，请在下方核对并完成补款'
                  : 'Your order changed. Review and complete the additional payment below.'
              : isBeingModified
                ? isZh
                    ? '请等待商家结束修改后查看订单状态'
                    : 'Wait for the merchant to finish updating the order.'
                : orderHasDigitalDelivery(order)
                  ? isZh
                      ? '数字交付状态与领取入口显示在下方'
                      : 'Delivery status and secure claim access are shown below.'
                  : inCart
                    ? isZh
                        ? '商品仍在购物车，尚未提交结算'
                        : 'Items are still in the cart and checkout has not started'
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
    const navigateToSupport = () => {
        void navigate(routeNavigateOptions({ name: 'support', orderCode: order.code }) as never);
    };
    const navigateToEvaluation = () => {
        void navigate(
            routeNavigateOptions({ name: 'support', orderCode: order.code, focus: 'evaluation' }) as never,
        );
    };

    const orderSummary = (
        <section className={orderPageClassName('order-detail-summary')}>
            <PriceSummary order={order} locale={locale} language={language} />
        </section>
    );
    const orderActions = !inCart && (
        <div className={isDrawer ? 'order-detail-actions' : orderPageClassName('order-detail-actions')}>
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
                <button
                    type="button"
                    className={orderPageClassName('order-secondary-action')}
                    onClick={() => setAfterSalesOpen(true)}
                >
                    <ShieldCheck aria-hidden="true" />
                    {isZh ? '申请售后' : 'Request after-sales'}
                </button>
            )}
            {(inTransit || fulfillments.length > 0) && (
                <button
                    type="button"
                    className={orderPageClassName('order-secondary-action')}
                    onClick={() => setLogisticsSheetOpen(true)}
                >
                    <Truck aria-hidden="true" />
                    {isZh ? '查看物流' : 'Track'}
                </button>
            )}
            {!pending && !needsAdditionalPayment && !isBeingModified && (
                <button
                    type="button"
                    className={orderPageClassName('order-secondary-action')}
                    onClick={navigateToEvaluation}
                >
                    <Sparkles aria-hidden="true" />
                    {isZh ? '服务评价' : 'Rate service'}
                </button>
            )}
            <button
                type="button"
                className={orderPageClassName('primary-action')}
                onClick={pending ? () => void onReopen(order) : () => void onBuyAgain(order)}
            >
                <RotateCcw aria-hidden="true" />
                {pending ? (isZh ? '返回修改订单' : 'Reopen order') : isZh ? '再来一单' : 'Buy again'}
            </button>
        </div>
    );
    const orderProductRows = order.lines.map(line => (
        <article key={line.id}>
            <ProductVariantImage
                language={language}
                variant={line.productVariant}
                alt={line.productVariant.name}
            />
            <div>
                <strong>{line.productVariant.name}</strong>
                <em>{orderLinePolicyLabel(line, language)}</em>
            </div>
            <span>
                <b>{formatMoney(line.linePriceWithTax, order.currencyCode, locale)}</b>
                <small>×{line.quantity}</small>
            </span>
        </article>
    ));
    const deliveryPanel = (
        <>
            {(physicalDeliveryLines(order).length > 0 || fulfillments.length > 0) && (
                <section className="order-delivery-panel" id="order-logistics">
                    <header>
                        <div>
                            <h2>{isZh ? '配送与交付' : 'Delivery & fulfillment'}</h2>
                            <p>
                                {isZh
                                    ? '包裹信息、配送状态和收货操作'
                                    : 'Shipment details, status and delivery confirmation'}
                            </p>
                        </div>
                        <button
                            type="button"
                            className="delivery-text-button"
                            onClick={() => setLogisticsSheetOpen(true)}
                        >
                            {isZh ? '查看配送记录' : 'View delivery history'}
                            <ChevronRight aria-hidden="true" />
                        </button>
                    </header>
                    {fulfillments.length ? (
                        <div className="delivery-table-scroll">
                            <table className="delivery-summary-table">
                                <thead>
                                    <tr>
                                        <th scope="col">{isZh ? '包裹 / 配送方式' : 'Package / method'}</th>
                                        <th scope="col">{isZh ? '运单号' : 'Tracking number'}</th>
                                        <th scope="col">{isZh ? '配送状态' : 'Status'}</th>
                                        <th scope="col">{isZh ? '操作' : 'Action'}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {fulfillments.map((fulfillment, index) => (
                                        <tr key={fulfillment.id}>
                                            <td data-label={isZh ? '包裹 / 配送方式' : 'Package / method'}>
                                                <strong>
                                                    {isZh ? `包裹 ${index + 1}` : `Package ${index + 1}`}
                                                </strong>
                                                <small>
                                                    {fulfillmentMethodLabel(fulfillment.method, language)}
                                                </small>
                                            </td>
                                            <td data-label={isZh ? '运单号' : 'Tracking number'}>
                                                <TrackingCode
                                                    code={fulfillment.trackingCode}
                                                    language={language}
                                                />
                                            </td>
                                            <td data-label={isZh ? '配送状态' : 'Status'}>
                                                <strong>
                                                    {fulfillment.deliveryEvidence?.status === 'EXCEPTION'
                                                        ? isZh
                                                            ? '配送异常待处理'
                                                            : 'Delivery exception'
                                                        : fulfillmentStateLabel(fulfillment.state, language)}
                                                </strong>
                                                <small>
                                                    {formatOrderDate(fulfillment.updatedAt, locale)}
                                                </small>
                                                {fulfillment.deliveryEvidence?.exceptionReason && (
                                                    <p className="delivery-exception">
                                                        {fulfillment.deliveryEvidence.exceptionReason}
                                                    </p>
                                                )}
                                            </td>
                                            <td data-label={isZh ? '操作' : 'Action'}>
                                                {fulfillment.state === 'Shipped' &&
                                                    fulfillment.deliveryEvidence?.status !== 'DELIVERED' && (
                                                        <button
                                                            type="button"
                                                            className="delivery-text-button"
                                                            disabled={confirmingDeliveryId === fulfillment.id}
                                                            onClick={() => {
                                                                setConfirmingDeliveryId(fulfillment.id);
                                                                void onConfirmDelivery(fulfillment.id)
                                                                    .catch(error =>
                                                                        onNotify?.(
                                                                            storefrontErrorMessage(
                                                                                error,
                                                                                language,
                                                                            ),
                                                                        ),
                                                                    )
                                                                    .finally(() =>
                                                                        setConfirmingDeliveryId(''),
                                                                    );
                                                            }}
                                                        >
                                                            {confirmingDeliveryId === fulfillment.id
                                                                ? isZh
                                                                    ? '正在确认'
                                                                    : 'Confirming'
                                                                : isZh
                                                                  ? '确认已收货'
                                                                  : 'Confirm delivery'}
                                                        </button>
                                                    )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <p className="delivery-pending-note">
                            {isZh
                                ? '商家尚未创建配送包裹。发货后，配送方式和运单信息会显示在这里。'
                                : 'No shipment has been created yet. Delivery and tracking details will appear after dispatch.'}
                        </p>
                    )}
                </section>
            )}
        </>
    );
    const content = (
        <>
            {!isDrawer && (
                <SubHeader title={isZh ? '订单详情' : 'Order details'} language={language} onBack={onBack} />
            )}
            {!isDrawer && (
                <header className="delivery-linked-order-heading">
                    <h1>{isZh ? '订单详情' : 'Order details'}</h1>
                    <button className="delivery-back-link" type="button" onClick={onBack}>
                        <ArrowLeft aria-hidden="true" />
                        {backLabel ?? (isZh ? '返回' : 'Back')}
                    </button>
                </header>
            )}
            <section className={orderPageClassName('order-status')}>
                <strong>{customerOrderStateLabel(order, language)}</strong>
                <span>{statusHint}</span>
                <small>{isZh ? `订单号 ${order.code}` : `Order ${order.code}`}</small>
            </section>
            {!isDrawer && deliveryPanel}
            <section className={orderPageClassName('order-detail-products')}>
                <header>
                    <strong>{storefrontName}</strong>
                    <span>{isZh ? `${order.lines.length} 种商品` : `${order.lines.length} products`}</span>
                </header>
                {desktop ? (
                    <div className="desktop-order-purchase-row">
                        <div className="desktop-order-products">{orderProductRows}</div>
                        {orderSummary}
                        {orderActions}
                    </div>
                ) : (
                    <>
                        {orderProductRows}
                        {isDrawer && orderSummary}
                    </>
                )}
            </section>
            {isDrawer && deliveryPanel}
            {api && (
                <OrderAdditionalPaymentPanel api={api} order={order} language={language} market={market} />
            )}
            {orderHasDigitalDelivery(order) &&
                (api ? (
                    <DigitalReceiptPanel api={api} order={order} language={language} market={market} />
                ) : (
                    <section className="digital-delivery-panel">
                        <p>
                            {isZh
                                ? '领取入口暂不可用，请重新打开订单详情。'
                                : 'Claim access is unavailable. Reopen order details.'}
                        </p>
                    </section>
                ))}
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
            {!desktop && !isDrawer && (
                <>
                    {orderSummary}
                    {orderActions}
                </>
            )}
        </>
    );
    const Container = isDrawer ? 'div' : 'main';
    return (
        <Container
            className={
                isDrawer ? 'order-detail-content' : orderPageClassName('page subpage order-detail-page')
            }
        >
            {isDrawer ? <div className="order-detail-sheet-body">{content}</div> : content}
            {isDrawer && orderActions && (
                <footer className="order-detail-sheet-footer">{orderActions}</footer>
            )}
            {afterSalesOpen && (
                <AfterSalesRequestSheet
                    api={api}
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
            {logisticsSheetOpen && (
                <LogisticsTrackingSheet
                    order={order}
                    locale={locale}
                    language={language}
                    reviewEnabled={reviewEnabled}
                    onClose={() => setLogisticsSheetOpen(false)}
                    onContactSupport={navigateToSupport}
                    onNotify={onNotify}
                />
            )}
        </Container>
    );
}

export function LogisticsTrackingSheet({
    order,
    locale,
    language,
    onClose,
    onContactSupport,
}: {
    order: Order;
    locale: string;
    language: StorefrontLanguage;
    reviewEnabled?: boolean;
    onClose: () => void;
    onContactSupport: () => void;
    onNotify?: (message: string) => void;
}) {
    const isZh = language === 'zh';
    const dialogRef = useRef<HTMLElement>(null);
    const closeRef = useRef(onClose);
    const previousFocus = useRef<HTMLElement | null>(null);
    const titleId = useId();
    useEffect(() => {
        closeRef.current = onClose;
    }, [onClose]);

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
            if (isInputMethodKey(event)) return;
            if (event.key === 'Escape') {
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

    return (
        <div className={orderPageClassName('sheet-layer')} role="presentation">
            <button
                className={orderPageClassName('sheet-mask')}
                type="button"
                onClick={onClose}
                aria-label={isZh ? '关闭' : 'Close'}
            />
            <section
                ref={dialogRef}
                className={orderPageClassName('sheet logistics-sheet')}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
            >
                <header>
                    <strong id={titleId}>{isZh ? '物流跟踪轨迹' : 'Logistics tracking'}</strong>
                    <button type="button" onClick={onClose} aria-label={isZh ? '关闭' : 'Close'}>
                        <X aria-hidden="true" />
                    </button>
                </header>

                <div className="logistics-sheet-content">
                    <DeliveryDetails order={order} locale={locale} language={language} />
                    <button
                        type="button"
                        className="delivery-text-button"
                        onClick={() => {
                            onClose();
                            onContactSupport();
                        }}
                    >
                        <Headphones aria-hidden="true" />
                        {isZh ? '遇到物流问题？联系客服处理' : 'Need help with delivery? Contact support'}
                    </button>
                </div>
            </section>
        </div>
    );
}

function AfterSalesRequestSheet({
    api,
    order,
    locale,
    language,
    onClose,
    onConfirm,
}: {
    api?: ShopApi;
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
    const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
    const [evidenceBusy, setEvidenceBusy] = useState(false);
    const [evidenceReady, setEvidenceReady] = useState(!api);
    const [error, setError] = useState('');
    const dialogRef = useRef<HTMLElement>(null);
    const closeRef = useRef(onClose);
    const submittingRef = useRef(submitting || evidenceBusy);
    const previousFocus = useRef<HTMLElement | null>(null);
    const titleId = useId();
    const eligibleLines = order.lines.filter(
        line => line.customFields.refundPolicySnapshot !== 'NON_REFUNDABLE' && !isAutoCardLine(line),
    );
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
        submittingRef.current = submitting || evidenceBusy;
    }, [submitting, evidenceBusy]);
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
            if (isInputMethodKey(event)) return;
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
        if (
            !selectedLines.length ||
            description.trim().length < 3 ||
            submitting ||
            evidenceBusy ||
            !evidenceReady
        )
            return;
        setSubmitting(true);
        setError('');
        try {
            await onConfirm({
                orderId: order.id,
                evidenceIds,
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
                    ? storefrontErrorMessage(requestError, language)
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
                disabled={submitting || evidenceBusy}
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
                        disabled={submitting || evidenceBusy}
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
                                            disabled={submitting || evidenceBusy}
                                            onChange={event => {
                                                const checked = event.currentTarget.checked;
                                                setQuantities(current => ({
                                                    ...current,
                                                    [line.id]: checked ? 1 : 0,
                                                }));
                                            }}
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
                                                disabled={submitting || evidenceBusy}
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
                            disabled={submitting || evidenceBusy}
                            onChange={event => setType(event.currentTarget.value as AfterSalesType)}
                        >
                            <option value="REFUND_ONLY">
                                {afterSalesTypeLabel('REFUND_ONLY', language)}
                            </option>
                            <option value="RETURN_AND_REFUND" disabled={containsDigital}>
                                {afterSalesTypeLabel('RETURN_AND_REFUND', language)}
                            </option>
                            <option value="EXCHANGE" disabled={containsDigital}>
                                {afterSalesTypeLabel('EXCHANGE', language)}
                            </option>
                            <option value="RESHIP" disabled={containsDigital}>
                                {afterSalesTypeLabel('RESHIP', language)}
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
                            disabled={submitting || evidenceBusy}
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
                            disabled={submitting || evidenceBusy}
                            placeholder={
                                isZh
                                    ? '请说明问题、期望处理方式；不要填写密码等敏感信息'
                                    : 'Describe the issue and expected resolution. Do not include passwords.'
                            }
                            onChange={event => setDescription(event.currentTarget.value)}
                        />
                    </label>
                    {api && (
                        <AfterSalesEvidenceUploader
                            api={api.contentReviewsApi}
                            orderId={order.id}
                            language={language}
                            disabled={submitting}
                            onChange={setEvidenceIds}
                            onBusyChange={setEvidenceBusy}
                            onReadyChange={setEvidenceReady}
                        />
                    )}
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
                        <button type="button" disabled={submitting || evidenceBusy} onClick={onClose}>
                            {isZh ? '取消' : 'Cancel'}
                        </button>
                        <button
                            className={orderPageClassName('primary-action')}
                            type="submit"
                            disabled={
                                submitting ||
                                evidenceBusy ||
                                !evidenceReady ||
                                !selectedLines.length ||
                                description.trim().length < 3
                            }
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
}: {
    desktop?: boolean;
    order: OrderSummary;
    locale: string;
    language: StorefrontLanguage;
    storefrontName: string;
    onOpen: () => void;
}) {
    const isZh = language === 'zh';
    const compactCopy = compactUiCopy[language];
    const isCart = order.state === 'AddingItems';
    const needsAdditionalPayment = order.state === 'ArrangingAdditionalPayment';
    const isPendingPayment = order.state === 'ArrangingPayment' || needsAdditionalPayment;
    const isPaidOrShipping = ['PaymentAuthorized', 'PaymentSettled'].includes(order.state);
    const isShipped = ['Shipped', 'PartiallyShipped'].includes(order.state);
    const isDelivered = order.state === 'Delivered' || order.state === 'TestPaymentSettled';
    const isCancelled = order.state === 'Cancelled';
    const totalLabel = isCart
        ? isZh
            ? '预估合计'
            : 'Estimated total'
        : needsAdditionalPayment
          ? isZh
              ? '订单金额'
              : 'Order total'
          : isPendingPayment
            ? compactCopy.orders.due
            : isZh
              ? '实付'
              : 'Total';

    const stateModifier =
        isCart || isPendingPayment
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

    if (desktop) {
        return (
            <article className={`order-card order-summary-card ${stateModifier}`}>
                <header className="order-summary-header">
                    <span className="order-summary-reference" title={order.code}>
                        {isZh ? '订单' : 'Order'} {order.code}
                    </span>
                    <span className="order-summary-state">{customerOrderStateLabel(order, language)}</span>
                </header>
                <button className="order-summary-product" type="button" onClick={onOpen}>
                    <OrderImage order={order} language={language} />
                    <span className="order-summary-copy">
                        <strong className="order-summary-title" title={firstLineName}>
                            {firstLineName}
                        </strong>
                        <small>
                            {isZh
                                ? `共 ${order.totalQuantity} 件`
                                : `${order.totalQuantity} ${order.totalQuantity === 1 ? 'item' : 'items'}`}
                            {order.lines.length > 1
                                ? isZh
                                    ? ` · ${order.lines.length} 种商品`
                                    : ` · ${order.lines.length} products`
                                : ''}
                        </small>
                        <span className="order-summary-total">
                            <small>{totalLabel}</small>
                            <strong>{formatMoney(order.totalWithTax, order.currencyCode, locale)}</strong>
                        </span>
                    </span>
                </button>
                <footer className="order-summary-footer">
                    <time className="desktop-order-date" dateTime={order.orderPlacedAt ?? undefined}>
                        {formattedTime}
                    </time>
                    <div className="order-summary-actions">
                        <button type="button" className="tertiary-action" onClick={onOpen}>
                            {isZh ? '查看详情' : 'Details'}
                            <ChevronRight aria-hidden="true" />
                        </button>
                        {isPendingPayment && (
                            <button type="button" className="primary-btn" onClick={onOpen}>
                                {needsAdditionalPayment
                                    ? isZh
                                        ? '核对补款'
                                        : 'Review amount due'
                                    : isZh
                                      ? '立即付款'
                                      : 'Pay now'}
                            </button>
                        )}
                    </div>
                </footer>
            </article>
        );
    }

    return (
        <article className={orderPageClassName(`order-card ${stateModifier}`)}>
            <header className={orderPageClassName('order-card-header')}>
                <button type="button" className={orderPageClassName('order-card-store-btn')} onClick={onOpen}>
                    <Store className={orderPageClassName('order-card-store-icon')} aria-hidden="true" />
                    <strong>{storefrontName}</strong>
                    <ChevronRight aria-hidden="true" />
                </button>
                <span className={orderPageClassName(`order-state-badge ${stateModifier}`)}>
                    {customerOrderStateLabel(order, language)}
                </span>
            </header>
            <button className={orderPageClassName('order-card-product')} type="button" onClick={onOpen}>
                <OrderImage language={language} order={order} />
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
            <footer className={orderPageClassName('order-card-footer')}>
                <div className={orderPageClassName('order-total-summary')}>
                    <span className={orderPageClassName('order-total-count')}>
                        {isZh
                            ? `共 ${order.totalQuantity} 件`
                            : `${order.totalQuantity} ${order.totalQuantity === 1 ? 'item' : 'items'}`}
                    </span>
                    <span className={orderPageClassName('order-total-label')}>{totalLabel}</span>
                    <strong className={orderPageClassName('order-total-amount')}>
                        {formatMoney(order.totalWithTax, order.currencyCode, locale)}
                    </strong>
                </div>
                <div className={orderPageClassName('order-card-buttons')}>
                    <button
                        type="button"
                        className={orderPageClassName('order-btn tertiary-action')}
                        onClick={onOpen}
                    >
                        {isZh ? '查看详情' : 'Details'}
                    </button>
                    {isCart ? null : isPendingPayment ? (
                        <button
                            type="button"
                            className={orderPageClassName('order-btn primary-btn')}
                            onClick={onOpen}
                        >
                            {needsAdditionalPayment
                                ? isZh
                                    ? '核对补款'
                                    : 'Review amount due'
                                : isZh
                                  ? '立即付款'
                                  : 'Pay now'}
                        </button>
                    ) : isShipped ? (
                        <button
                            type="button"
                            className={orderPageClassName('order-btn secondary-btn')}
                            onClick={onOpen}
                        >
                            {isZh ? '查看物流' : 'Track'}
                        </button>
                    ) : null}
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
                  ? '订单详情可查看配送信息'
                  : 'Delivery information in order details',
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

function ProductVariantImage({
    variant,
    alt,
    language,
}: {
    variant: ProductVariant;
    alt: string;
    language: StorefrontLanguage;
}) {
    const source = variant.featuredAsset?.preview ?? variant.product.featuredAsset?.preview;
    if (!source)
        return (
            <ProductImagePlaceholder
                language={language}
                className={orderPageClassName('image-placeholder')}
                compact
            />
        );
    return (
        <SafeImage
            src={source}
            alt={alt}
            fallbackLabel={productImageUnavailableLabel(language)}
            imageKind="thumbnail"
            loading="lazy"
            decoding="async"
        />
    );
}

function OrderImage({ order, language }: { order: OrderSummary; language: StorefrontLanguage }) {
    const variant = order.lines[0]?.productVariant;
    return variant ? (
        <ProductVariantImage language={language} variant={variant} alt={variant.name} />
    ) : (
        <ProductImagePlaceholder
            language={language}
            className={orderPageClassName('image-placeholder')}
            compact
        />
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
    const usdtReceipt = usdtPaymentReceipt(order);
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
            {usdtReceipt && (
                <div className={orderPageClassName('summary-total')}>
                    <dt>{isZh ? 'USDT 实付' : 'USDT paid'}</dt>
                    <dd>
                        {formatUsdtPaymentAmount(usdtReceipt)} {usdtReceipt.network}
                    </dd>
                </div>
            )}
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
            if (isInputMethodKey(event)) return;
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
                    ? storefrontErrorMessage(requestError, language)
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
    if (type === 'EXCHANGE') return language === 'zh' ? '换货' : 'Exchange';
    if (type === 'RESHIP') return language === 'zh' ? '补发' : 'Reship';
    return language === 'zh' ? '仅退款' : 'Refund only';
}

function afterSalesReturnStatusLabel(
    status: AfterSalesRequest['returnStatus'],
    language: StorefrontLanguage,
): string {
    const labels: Record<AfterSalesRequest['returnStatus'], { zh: string; en: string }> = {
        NOT_REQUIRED: { zh: '无需退货', en: 'Not required' },
        AWAITING_SHIPMENT: { zh: '等待寄回', en: 'Awaiting shipment' },
        IN_TRANSIT: { zh: '退货运输中', en: 'Return in transit' },
        RECEIVED: { zh: '仓库已签收', en: 'Warehouse received' },
        INSPECTED: { zh: '质检已完成', en: 'Inspection completed' },
    };
    return labels[status][language];
}

function afterSalesReplacementStatusLabel(
    status: AfterSalesRequest['replacementStatus'],
    language: StorefrontLanguage,
): string {
    const labels: Record<AfterSalesRequest['replacementStatus'], { zh: string; en: string }> = {
        NOT_REQUIRED: { zh: '无需换货/补发', en: 'Not required' },
        PENDING: { zh: '等待发出', en: 'Awaiting shipment' },
        SHIPPED: { zh: '运输中', en: 'In transit' },
        EXCEPTION: { zh: '物流异常', en: 'Shipment exception' },
        DELIVERED: { zh: '已送达', en: 'Delivered' },
    };
    return labels[status][language];
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

const fulfillmentStateLabel = fulfillmentStateDisplayLabel;

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
        return language === 'zh' ? '自动卡密交付' : 'Automatic credential delivery';
    }
    return method;
}

function orderLinePolicyLabel(line: Order['lines'][number], language: StorefrontLanguage): string {
    const isZh = language === 'zh';
    const digital = line.customFields.fulfillmentTypeSnapshot === 'digital';
    const mode = line.customFields.digitalDeliveryModeSnapshot;
    const delivery =
        mode === 'auto_card'
            ? isZh
                ? '虚拟商品 · 自动卡密'
                : 'Digital · automatic credentials'
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
