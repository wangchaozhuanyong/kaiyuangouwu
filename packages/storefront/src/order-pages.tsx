import { useInfiniteQuery } from '@tanstack/react-query';
import {
    ArrowLeft,
    ChevronRight,
    Navigation,
    Package,
    RotateCcw,
    Search,
    UserRound,
    WifiOff,
    X,
} from 'lucide-react';
import { ReactNode, useEffect, useState } from 'react';

import { ShopApi } from './api';
import { formatBusinessDate } from './business-time';
import { languageCodeFor } from './i18n';
import { PUBLIC_QUERY_GC_TIME, ROUTE_QUERY_STALE_TIME, storefrontQueryKeys } from './query-client';
import { responsiveImageSources } from './responsive-image';
import { PageSkeleton } from './route-loading';
import { ActiveCustomer, MarketConfig, Order, ProductVariant, StorefrontLanguage } from './types';

export type OrderTab = 'all' | 'pending' | 'shipping' | 'receiving' | 'service';
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
    onNavigate,
    onBuyAgain,
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
    onBuyAgain: (order: Order) => Promise<void>;
}) {
    const isZh = language === 'zh';
    const [tab, setTab] = useState<OrderTab>(initialTab);
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchInput, setSearchInput] = useState('');
    const [orderCode, setOrderCode] = useState('');
    const pageSize = 10;
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
        staleTime: ROUTE_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
    });
    const orders = Array.from(
        new Map(
            (ordersQuery.data?.pages.flatMap(page => page.items) ?? []).map(order => [order.id, order]),
        ).values(),
    );
    const totalItems = ordersQuery.data?.pages[0]?.totalItems ?? 0;
    const loading = ordersQuery.isPending;
    const loadingMore = ordersQuery.isFetchingNextPage;
    const listError =
        ordersQuery.error instanceof Error
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
                <EmptyState
                    icon={<RotateCcw />}
                    title={isZh ? '暂无售后记录' : 'No after-sales records'}
                    detail={
                        isZh
                            ? '售后能力需要商家后台服务流程支持'
                            : 'After-sales requires merchant service workflow support'
                    }
                />
            ) : loading && !orders.length ? (
                <PageSkeleton />
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

export function OrderDetailPage({
    order,
    locale,
    language,
    storefrontName,
    onBack,
    onBuyAgain,
    onReopen,
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
    onUnavailable: () => void;
}) {
    const isZh = language === 'zh';
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
    const statusHint = pending
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
            <section className="order-information">
                <div>
                    <span>{isZh ? '下单时间' : 'Placed at'}</span>
                    <b>{formatOrderDate(order.orderPlacedAt, locale)}</b>
                </div>
                <div>
                    <span>{isZh ? '订单编号' : 'Order code'}</span>
                    <b>{order.code}</b>
                </div>
            </section>
            <section className="order-detail-summary">
                <PriceSummary order={order} locale={locale} language={language} />
            </section>
            <div className="order-detail-actions">
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
        </main>
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
    order: Order;
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

function OrderImage({ order }: { order: Order }) {
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
            <div className="summary-total">
                <dt>{isZh ? '合计' : 'Total'}</dt>
                <dd>{formatMoney(order.totalWithTax, order.currencyCode, locale)}</dd>
            </div>
        </dl>
    );
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

function orderStatesForTab(tab: OrderTab): string[] | undefined {
    if (tab === 'pending') return ['AddingItems', 'ArrangingPayment'];
    if (tab === 'shipping') return ['PaymentAuthorized', 'PaymentSettled'];
    if (tab === 'receiving') return ['Shipped', 'PartiallyShipped'];
    return undefined;
}
