import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, CircleAlert, CircleCheck, House, Package, WalletCards } from 'lucide-react';
import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';

import { ShopApi } from './api';
import { languageCodeFor } from './i18n';
import { PUBLIC_QUERY_GC_TIME, ROUTE_QUERY_STALE_TIME, storefrontQueryKeys } from './query-client';
import { PageSkeleton } from './route-loading';
import { ActiveCustomer, MarketConfig, Order, StorefrontCart, StorefrontLanguage } from './types';

const LOCAL_TEST_PAYMENT_CODE = '测试支付';
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
    onNavigate,
}: {
    api: ShopApi;
    cart: StorefrontCart | null;
    order: Order | null;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    onCancel: (order: Order) => void;
    onComplete: (order: Order) => Promise<void>;
    onNavigate: (route: PaymentRoute) => void;
}) {
    const isZh = language === 'zh';
    const [selectedMethod, setSelectedMethod] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [paymentError, setPaymentError] = useState('');
    const submissionLock = useRef(false);
    const isPending = cart?.state === 'PAYMENT_PENDING' && order?.state === 'ArrangingPayment';
    const methodsQuery = useQuery({
        queryKey: storefrontQueryKeys.paymentMethods(market.code, languageCodeFor(language), order?.id ?? ''),
        queryFn: async ({ signal }) => {
            const result = await api.eligiblePaymentMethods(signal);
            return import.meta.env.DEV
                ? result.filter(method => method.code === LOCAL_TEST_PAYMENT_CODE)
                : [];
        },
        enabled: isPending,
        staleTime: ROUTE_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
    });
    const methods = isPending ? (methodsQuery.data ?? []) : [];
    const loading = isPending && methodsQuery.isPending;
    const methodLoadError =
        methodsQuery.error instanceof Error
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
        if (!import.meta.env.DEV || !isPending || !selectedMethod || submitting || submissionLock.current)
            return;
        submissionLock.current = true;
        setSubmitting(true);
        setPaymentError('');
        try {
            const paidOrder = await api.addPaymentToOrder(selectedMethod);
            await onComplete(paidOrder);
        } catch (requestError) {
            setPaymentError(
                requestError instanceof Error
                    ? requestError.message
                    : isZh
                      ? '测试支付失败，请重试'
                      : 'Test payment failed. Please try again.',
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
                onBack={() => onNavigate({ name: 'cart' })}
            >
                <EmptyState
                    icon={<WalletCards />}
                    title={isZh ? '没有待支付订单' : 'No order awaiting payment'}
                    detail={isZh ? '请返回购物车重新结算' : 'Return to your cart and start checkout again.'}
                    action={isZh ? '返回购物车' : 'Back to cart'}
                    onAction={() => onNavigate({ name: 'cart' })}
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
                    <section className="payment-test-notice" role="note">
                        <CircleAlert aria-hidden="true" />
                        <div>
                            <strong>{isZh ? '本地测试支付' : 'Local test payment'}</strong>
                            <span>
                                {isZh
                                    ? '仅用于预览结账流程，不会产生真实扣款。'
                                    : 'For previewing checkout only. No real charge will be made.'}
                            </span>
                        </div>
                    </section>
                    <section className="payment-method-section">
                        <h2>{isZh ? '支付方式' : 'Payment method'}</h2>
                        {loading ? (
                            <PageSkeleton />
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
                                            <strong>{isZh ? '测试支付' : 'Test payment'}</strong>
                                            <small>
                                                {method.isEligible
                                                    ? isZh
                                                        ? '本地即时模拟支付'
                                                        : 'Instant local payment simulation'
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
                        ) : (
                            <InlineError
                                message={
                                    isZh
                                        ? '当前没有可用的本地测试支付方式'
                                        : 'No local test payment method is available'
                                }
                                action={isZh ? '重试' : 'Retry'}
                                onAction={() => void methodsQuery.refetch()}
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
                        <div className="summary-total">
                            <dt>{isZh ? '应付合计' : 'Total due'}</dt>
                            <dd>{formatMoney(order.totalWithTax, order.currencyCode, locale)}</dd>
                        </div>
                    </dl>
                    <button type="submit" disabled={!selectedMethod || submitting || loading}>
                        <WalletCards aria-hidden="true" />
                        {submitting
                            ? isZh
                                ? '正在完成测试支付'
                                : 'Completing test payment'
                            : isZh
                              ? '确认测试支付'
                              : 'Confirm test payment'}
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
    initialOrder,
    customer,
    market,
    locale,
    language,
    onNavigate,
}: {
    api: ShopApi;
    code: string;
    initialOrder: Order | null;
    customer: ActiveCustomer | null;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    onNavigate: (route: PaymentRoute) => void;
}) {
    const isZh = language === 'zh';
    const orderQuery = useQuery({
        queryKey: storefrontQueryKeys.orderByCode(
            market.code,
            languageCodeFor(language),
            customer?.id ?? 'guest',
            code,
        ),
        queryFn: ({ signal }) => api.orderByCode(code, signal),
        enabled: !!code,
        initialData: initialOrder?.code === code ? initialOrder : undefined,
        staleTime: ROUTE_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
    });
    const order = code ? (orderQuery.data ?? null) : null;
    const loading = !!code && orderQuery.isPending;
    const loadError = orderQuery.error instanceof Error ? orderQuery.error.message : '';

    if (loading) {
        return (
            <Subpage
                title={isZh ? '订单已提交' : 'Order confirmed'}
                language={language}
                onBack={() => onNavigate({ name: 'home' })}
            >
                <PageSkeleton />
            </Subpage>
        );
    }
    if (!order) {
        return (
            <Subpage
                title={isZh ? '订单已提交' : 'Order confirmed'}
                language={language}
                onBack={() => onNavigate({ name: 'home' })}
            >
                <EmptyState
                    icon={<Package />}
                    title={isZh ? '无法读取订单' : 'Could not retrieve the order'}
                    detail={
                        loadError ||
                        (isZh
                            ? '访问时间可能已超过游客查询时限'
                            : 'The guest access window may have expired.')
                    }
                    action={loadError ? (isZh ? '重试' : 'Retry') : isZh ? '返回首页' : 'Back to home'}
                    onAction={() => (loadError ? void orderQuery.refetch() : onNavigate({ name: 'home' }))}
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
                <p>{isZh ? '本地测试订单' : 'Local test order'}</p>
                <h1>{isZh ? '订单提交成功' : 'Order confirmed'}</h1>
                <span>
                    {isZh
                        ? '测试支付已完成，不会产生真实扣款。'
                        : 'The test payment is complete. No real charge was made.'}
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
                </dl>
                <small>
                    {isZh
                        ? '请保留订单号。游客订单只能在有限时间内通过当前链接查看。'
                        : 'Keep your order number. Guest access through this link is available for a limited time.'}
                </small>
            </section>
            <div className="order-confirmation-actions">
                <button type="button" className="primary-action" onClick={() => onNavigate({ name: 'home' })}>
                    <House aria-hidden="true" />
                    {isZh ? '继续购物' : 'Continue shopping'}
                </button>
                {customer && (
                    <button type="button" onClick={() => onNavigate({ name: 'orders', tab: 'shipping' })}>
                        <Package aria-hidden="true" />
                        {isZh ? '查看我的订单' : 'View my orders'}
                    </button>
                )}
            </div>
        </main>
    );
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
