import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
    ArrowLeft,
    Check,
    CircleAlert,
    CircleCheck,
    Download,
    House,
    Package,
    ShieldCheck,
    WalletCards,
} from 'lucide-react';
import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';

import { ShopApi } from './api';
import { languageCodeFor } from './i18n';
import { offlineLoadError } from './loading-state';
import { orderStatusRefreshInterval } from './order-refresh';
import { paymentAvailability } from './payment-readiness';
import { PUBLIC_QUERY_GC_TIME, ROUTE_QUERY_STALE_TIME, storefrontQueryKeys } from './query-client';
import { PageSkeleton } from './route-loading';
import { routeNavigateOptions } from './storefront-router';
import { TaxSummaryRows } from './tax-summary';
import { ActiveCustomer, MarketConfig, Order, StorefrontCart, StorefrontLanguage } from './types';

type PaymentRoute = { name: 'cart' | 'home' | 'orders'; tab?: 'shipping' };

export function PaymentPage({
    api,
    cart,
    order,
    market,
    locale,
    language,
    onCancel,
    onComplete,
}: {
    api: ShopApi;
    cart: StorefrontCart | null;
    order: Order | null;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    onCancel: (order: Order) => void;
    onComplete: (order: Order, confirmationToken: string) => Promise<void>;
}) {
    const navigate = useNavigate();
    const navigateTo = (route: PaymentRoute) => void navigate(routeNavigateOptions(route) as never);
    const isZh = language === 'zh';
    const [selectedMethod, setSelectedMethod] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [paymentError, setPaymentError] = useState('');
    const submissionLock = useRef(false);
    const isTestMode = import.meta.env.DEV;
    const isPending = cart?.state === 'PAYMENT_PENDING' && order?.state === 'ArrangingPayment';
    const methodsQuery = useQuery({
        queryKey: storefrontQueryKeys.paymentMethods(market.code, languageCodeFor(language), order?.id ?? ''),
        queryFn: ({ signal }) => api.eligiblePaymentMethods(signal),
        enabled: isPending,
        staleTime: ROUTE_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
    });
    const availability = paymentAvailability(isPending ? (methodsQuery.data ?? []) : [], {
        allowTestMethods: isTestMode,
    });
    const methods = availability.methods;
    const loading = isPending && methodsQuery.isLoading;
    const methodLoadError =
        methodsQuery.isPaused && methodsQuery.data === undefined
            ? offlineLoadError(language)
            : methodsQuery.error instanceof Error
              ? methodsQuery.error.message
              : methodsQuery.error
                ? isZh
                    ? '支付方式加载失败'
                    : 'Could not load payment methods'
                : '';

    useEffect(() => {
        if (!isPending) {
            setSelectedMethod('');
            return;
        }
        setSelectedMethod(current =>
            methods.some(method => method.code === current && method.isEligible)
                ? current
                : (methods.find(method => method.isEligible)?.code ?? ''),
        );
    }, [isPending, methods]);

    const submitPayment = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (
            availability.status !== 'READY' ||
            !isPending ||
            !selectedMethod ||
            submitting ||
            submissionLock.current
        )
            return;
        submissionLock.current = true;
        setSubmitting(true);
        setPaymentError('');
        try {
            const confirmation = await api.createOrderConfirmationToken();
            const paidOrder = await api.addPaymentToOrder(selectedMethod);
            await onComplete(paidOrder, confirmation.token);
        } catch (requestError) {
            setPaymentError(
                requestError instanceof Error
                    ? requestError.message
                    : isZh
                      ? '支付提交失败，请重试'
                      : 'Payment failed. Please try again.',
            );
        } finally {
            submissionLock.current = false;
            setSubmitting(false);
        }
    };

    if (!order || !cart || !isPending) {
        return (
            <Subpage
                title={isZh ? '选择支付方式' : 'Choose payment'}
                language={language}
                onBack={() => navigateTo({ name: 'cart' })}
            >
                <EmptyState
                    icon={<WalletCards />}
                    title={isZh ? '没有待支付订单' : 'No order awaiting payment'}
                    detail={isZh ? '请返回购物车重新结算' : 'Return to your cart and start checkout again.'}
                    action={isZh ? '返回购物车' : 'Back to cart'}
                    onAction={() => navigateTo({ name: 'cart' })}
                />
            </Subpage>
        );
    }

    return (
        <main className="page subpage payment-page">
            <SubHeader
                title={isZh ? '选择支付方式' : 'Choose payment'}
                language={language}
                onBack={() => onCancel(order)}
            />
            <form className="payment-layout" onSubmit={event => void submitPayment(event)}>
                <div className="payment-main">
                    <section
                        className={`payment-test-notice${isTestMode ? '' : ' is-production'}`}
                        role="note"
                    >
                        <CircleAlert aria-hidden="true" />
                        <div>
                            <strong>
                                {isTestMode
                                    ? isZh
                                        ? '本地测试支付'
                                        : 'Local test payment'
                                    : availability.status === 'READY'
                                      ? isZh
                                          ? '安全支付'
                                          : 'Secure payment'
                                      : isZh
                                        ? '支付暂未开放'
                                        : 'Payment is not available yet'}
                            </strong>
                            <span>
                                {isTestMode
                                    ? isZh
                                        ? '仅用于预览结账流程，不会产生真实扣款。'
                                        : 'For previewing checkout only. No real charge will be made.'
                                    : availability.status === 'READY'
                                      ? isZh
                                          ? '请确认订单和金额后选择支付方式。'
                                          : 'Review the order and amount before choosing a payment method.'
                                      : isZh
                                        ? '订单已保留，不会发起扣款。你可以返回购物车继续修改。'
                                        : 'Your order is preserved and no charge will be attempted. You can return to edit it.'}
                            </span>
                        </div>
                    </section>
                    <section className="payment-method-section">
                        <h2>{isZh ? '支付方式' : 'Payment method'}</h2>
                        {loading ? (
                            <PageSkeleton label={isZh ? '正在加载支付方式' : 'Loading payment methods'} />
                        ) : methodLoadError && !methods.length ? (
                            <InlineError
                                message={methodLoadError}
                                action={isZh ? '重试' : 'Retry'}
                                onAction={() => void methodsQuery.refetch()}
                            />
                        ) : methods.length ? (
                            <fieldset className="payment-method-list">
                                <legend className="sr-only">
                                    {isZh ? '选择支付方式' : 'Choose a payment method'}
                                </legend>
                                {methods.map(method => (
                                    <label
                                        key={method.id}
                                        className={selectedMethod === method.code ? 'is-selected' : undefined}
                                    >
                                        <input
                                            type="radio"
                                            name="paymentMethod"
                                            value={method.code}
                                            checked={selectedMethod === method.code}
                                            disabled={!method.isEligible || submitting}
                                            onChange={event => setSelectedMethod(event.currentTarget.value)}
                                        />
                                        <WalletCards aria-hidden="true" />
                                        <span>
                                            <strong>{method.name}</strong>
                                            <small>
                                                {method.isEligible
                                                    ? method.description ||
                                                      (isTestMode
                                                          ? isZh
                                                              ? '本地即时模拟支付'
                                                              : 'Instant local payment simulation'
                                                          : isZh
                                                            ? '可用于当前订单'
                                                            : 'Available for this order')
                                                    : (method.eligibilityMessage ??
                                                      (isZh
                                                          ? '当前订单不可用'
                                                          : 'Unavailable for this order'))}
                                            </small>
                                        </span>
                                        <Check aria-hidden="true" />
                                    </label>
                                ))}
                            </fieldset>
                        ) : availability.status === 'NOT_CONFIGURED' ? (
                            <InlineError
                                message={
                                    isZh
                                        ? isTestMode
                                            ? '当前没有可用的本地测试支付方式'
                                            : '当前店铺尚未接入支付方式，订单已保留'
                                        : isTestMode
                                          ? 'No local test payment method is available'
                                          : 'No payment provider is configured for this store. Your order is preserved.'
                                }
                                action={isZh ? '重试' : 'Retry'}
                                onAction={() => void methodsQuery.refetch()}
                            />
                        ) : (
                            <InlineError
                                message={
                                    methods[0]?.eligibilityMessage ??
                                    (isZh
                                        ? '当前订单暂不满足支付条件，请返回修改订单'
                                        : 'This order is not currently eligible for payment. Return to edit it.')
                                }
                            />
                        )}
                        {paymentError && methods.length > 0 && <InlineError message={paymentError} />}
                    </section>
                </div>
                <aside className="payment-summary" aria-label={isZh ? '订单摘要' : 'Order summary'}>
                    <header>
                        <span>{isZh ? '订单号' : 'Order'}</span>
                        <strong>{order.code}</strong>
                    </header>
                    <div className="payment-summary-lines">
                        {order.lines.map(line => (
                            <div key={line.id}>
                                <span>{line.productVariant.name}</span>
                                <small>×{line.quantity}</small>
                                <b>{formatMoney(line.linePriceWithTax, order.currencyCode, locale)}</b>
                            </div>
                        ))}
                    </div>
                    <dl className="price-summary">
                        <div>
                            <dt>{isZh ? '商品小计' : 'Subtotal'}</dt>
                            <dd>{formatMoney(order.subTotalWithTax, order.currencyCode, locale)}</dd>
                        </div>
                        <div>
                            <dt>{isZh ? '配送费' : 'Delivery'}</dt>
                            <dd>{formatMoney(order.shippingWithTax, order.currencyCode, locale)}</dd>
                        </div>
                        {order.checkoutShipping && (
                            <div className="shipping-estimate-detail">
                                <dt>{isZh ? '配送时效' : 'Delivery estimate'}</dt>
                                <dd>{shippingEstimate(order, language)}</dd>
                            </div>
                        )}
                        <TaxSummaryRows order={order} locale={locale} language={language} />
                        <div className="summary-total">
                            <dt>{isZh ? '应付合计' : 'Total due'}</dt>
                            <dd>{formatMoney(order.totalWithTax, order.currencyCode, locale)}</dd>
                        </div>
                    </dl>
                    <button type="submit" disabled={!selectedMethod || submitting || loading}>
                        <WalletCards aria-hidden="true" />
                        {submitting
                            ? isTestMode
                                ? isZh
                                    ? '正在完成测试支付'
                                    : 'Completing test payment'
                                : isZh
                                  ? '正在提交支付'
                                  : 'Submitting payment'
                            : isTestMode
                              ? isZh
                                  ? '确认测试支付'
                                  : 'Confirm test payment'
                              : isZh
                                ? '确认支付'
                                : 'Confirm payment'}
                    </button>
                    <button
                        type="button"
                        className="payment-edit-order"
                        disabled={submitting}
                        onClick={() => onCancel(order)}
                    >
                        {isZh ? '返回修改订单' : 'Return to edit order'}
                    </button>
                </aside>
            </form>
        </main>
    );
}

export function OrderConfirmationPage({
    api,
    code,
    confirmationToken,
    initialOrder,
    customer,
    market,
    locale,
    language,
}: {
    api: ShopApi;
    code: string;
    confirmationToken: string;
    initialOrder: Order | null;
    customer: ActiveCustomer | null;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
}) {
    const navigate = useNavigate();
    const navigateTo = (route: PaymentRoute) => void navigate(routeNavigateOptions(route) as never);
    const isZh = language === 'zh';
    const orderQuery = useQuery({
        queryKey: storefrontQueryKeys.orderByCode(market.code, languageCodeFor(language), code),
        queryFn: ({ signal }) => api.orderByConfirmationToken(confirmationToken, signal),
        enabled: Boolean(code && confirmationToken),
        initialData: confirmationToken && initialOrder?.code === code ? initialOrder : undefined,
        staleTime: 0,
        refetchOnMount: 'always',
        refetchInterval: query => orderStatusRefreshInterval(query.state.data?.state),
        gcTime: PUBLIC_QUERY_GC_TIME,
    });
    const order = code ? (orderQuery.data ?? null) : null;
    const loading = Boolean(code && confirmationToken && orderQuery.isLoading);
    const loadError =
        orderQuery.isPaused && orderQuery.data === undefined
            ? offlineLoadError(language)
            : orderQuery.error instanceof Error
              ? orderQuery.error.message
              : '';

    if (loading) {
        return (
            <Subpage
                title={isZh ? '订单已提交' : 'Order confirmed'}
                language={language}
                onBack={() => navigateTo({ name: 'home' })}
            >
                <PageSkeleton label={isZh ? '正在加载订单结果' : 'Loading order result'} />
            </Subpage>
        );
    }
    if (!order) {
        return (
            <Subpage
                title={isZh ? '订单已提交' : 'Order confirmed'}
                language={language}
                onBack={() => navigateTo({ name: 'home' })}
            >
                <EmptyState
                    icon={<Package />}
                    title={isZh ? '无法读取订单' : 'Could not retrieve the order'}
                    detail={
                        loadError ||
                        (isZh
                            ? confirmationToken
                                ? '确认链接可能已过期，请登录账户后从订单列表查看'
                                : '确认链接缺少安全令牌，请登录账户后从订单列表查看'
                            : confirmationToken
                              ? 'The confirmation link may have expired. Sign in to view your orders.'
                              : 'The confirmation link is missing its security token. Sign in to view your orders.')
                    }
                    action={loadError ? (isZh ? '重试' : 'Retry') : isZh ? '返回首页' : 'Back to home'}
                    onAction={() => (loadError ? void orderQuery.refetch() : navigateTo({ name: 'home' }))}
                />
            </Subpage>
        );
    }
    return (
        <main className="page subpage order-confirmation-page">
            <section className="order-confirmation-hero">
                <span className="order-confirmation-icon">
                    <CircleCheck aria-hidden="true" />
                </span>
                <p>
                    {import.meta.env.DEV
                        ? isZh
                            ? '本地测试订单'
                            : 'Local test order'
                        : isZh
                          ? '订单状态'
                          : 'Order status'}
                </p>
                <h1>{isZh ? '订单提交成功' : 'Order confirmed'}</h1>
                <span>
                    {import.meta.env.DEV
                        ? isZh
                            ? '测试支付已完成，不会产生真实扣款。'
                            : 'The test payment is complete. No real charge was made.'
                        : isZh
                          ? '支付状态已更新，请保留订单号。'
                          : 'The payment status has been updated. Keep your order number.'}
                </span>
            </section>
            <section className="order-confirmation-summary">
                <dl>
                    <div>
                        <dt>{isZh ? '订单号' : 'Order number'}</dt>
                        <dd>{order.code}</dd>
                    </div>
                    <div>
                        <dt>{isZh ? '订单状态' : 'Status'}</dt>
                        <dd>{orderStateLabel(order.state, language)}</dd>
                    </div>
                    <div>
                        <dt>{isZh ? '支付金额' : 'Payment total'}</dt>
                        <dd>{formatMoney(order.totalWithTax, order.currencyCode, locale)}</dd>
                    </div>
                    {order.checkoutShipping && (
                        <div>
                            <dt>{isZh ? '配送时效' : 'Delivery estimate'}</dt>
                            <dd>{shippingEstimate(order, language)}</dd>
                        </div>
                    )}
                </dl>
                <small>
                    {isZh
                        ? '请保留订单号。游客订单只能在有限时间内通过当前链接查看。'
                        : 'Keep your order number. Guest access through this link is available for a limited time.'}
                </small>
            </section>
            {!!order.digitalDeliveries?.length && (
                <section className="digital-delivery-panel order-confirmation-downloads">
                    <header>
                        <div>
                            <Download aria-hidden="true" />
                            <strong>{isZh ? '数字商品交付' : 'Digital delivery'}</strong>
                        </div>
                        <small>
                            {isZh
                                ? '请立即保存内容；过期后可从订单详情生成新链接'
                                : 'Save your files now. New links are available from order details.'}
                        </small>
                    </header>
                    <div>
                        {order.digitalDeliveries.map(delivery => (
                            <article key={delivery.orderLineId}>
                                <span>
                                    <strong>{delivery.name}</strong>
                                    <small>{delivery.sku}</small>
                                </span>
                                {delivery.status === 'READY' && delivery.downloadUrl ? (
                                    <a href={delivery.downloadUrl} rel="noreferrer">
                                        <Download aria-hidden="true" />
                                        {isZh ? '下载' : 'Download'}
                                    </a>
                                ) : (
                                    <em>
                                        {delivery.status === 'PAYMENT_REQUIRED'
                                            ? isZh
                                                ? '付款后开放'
                                                : 'Available after payment'
                                            : isZh
                                              ? '内容准备中'
                                              : 'Content is being prepared'}
                                    </em>
                                )}
                            </article>
                        ))}
                    </div>
                </section>
            )}
            {!!order.autoCardDeliveries?.length && (
                <section className="digital-delivery-panel auto-card-delivery-panel">
                    <header>
                        <div>
                            <ShieldCheck aria-hidden="true" />
                            <strong>{isZh ? '邮箱自动发卡' : 'Automatic email delivery'}</strong>
                        </div>
                        <small>
                            {isZh
                                ? '系统会按号池顺序发送到下单邮箱，请同时检查垃圾邮件。'
                                : 'Credentials are assigned in sequence and sent to the checkout email.'}
                        </small>
                    </header>
                    <div>
                        {order.autoCardDeliveries.map(delivery => (
                            <article key={delivery.id}>
                                <span>
                                    <strong>{delivery.productName}</strong>
                                    <small>
                                        {delivery.sku} × {delivery.quantity}
                                    </small>
                                </span>
                                <em>{confirmationAutoCardStatus(delivery.state, language)}</em>
                            </article>
                        ))}
                    </div>
                </section>
            )}
            <div className="order-confirmation-actions">
                <button type="button" className="primary-action" onClick={() => navigateTo({ name: 'home' })}>
                    <House aria-hidden="true" />
                    {isZh ? '继续购物' : 'Continue shopping'}
                </button>
                {customer && (
                    <button type="button" onClick={() => navigateTo({ name: 'orders', tab: 'shipping' })}>
                        <Package aria-hidden="true" />
                        {isZh ? '查看我的订单' : 'View my orders'}
                    </button>
                )}
            </div>
        </main>
    );
}

function confirmationAutoCardStatus(
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

function SubHeader({
    title,
    language,
    onBack,
}: {
    title: string;
    language: StorefrontLanguage;
    onBack: () => void;
}) {
    return (
        <header className="topbar subpage-header">
            <button type="button" onClick={onBack} aria-label={language === 'zh' ? '返回' : 'Back'}>
                <ArrowLeft aria-hidden="true" />
            </button>
            <strong>{title}</strong>
            <span />
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
    action?: string;
    onAction?: () => void;
}) {
    return (
        <div className="inline-error" role="alert">
            <span>{message}</span>
            {action && (
                <button type="button" onClick={onAction}>
                    {action}
                </button>
            )}
        </div>
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
