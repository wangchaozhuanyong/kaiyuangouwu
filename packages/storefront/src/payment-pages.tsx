import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
    ArrowLeft,
    Check,
    CircleAlert,
    CircleCheck,
    Copy,
    Gift,
    House,
    Package,
    WalletCards,
} from 'lucide-react';
import { FormEvent, useEffect, useRef, useState } from 'react';

import { ShopApi } from './api';
import { DigitalReceiptPanel, orderHasDigitalDelivery } from './digital-receipt-panel';
import { languageCodeFor } from './i18n';
import { offlineLoadError } from './loading-state';
import { formatDisplayMoney } from './money-display';
import { OrderAdditionalPaymentPanel } from './order-additional-payment-panel';
import { formatUsdtPaymentAmount, usdtPaymentReceipt } from './order-payment-display';
import { orderStatusRefreshInterval } from './order-refresh';
import { isPaymentCompletedOrderState, isTestPaymentMethod, paymentAvailability } from './payment-readiness';
import { PUBLIC_QUERY_GC_TIME, ROUTE_QUERY_STALE_TIME, storefrontQueryKeys } from './query-client';
import { preloadStorefrontRouteComponent } from './route-component-preload';
import { PageSkeleton } from './route-loading';
import { storefrontErrorCode, storefrontErrorMessage } from './storefront-errors';
import { routeNavigateOptions } from './storefront-router';
import { customerOrderStateLabel } from './storefront-ui/order-ui';
import { EmptyState, InlineError, SubHeader, Subpage } from './storefront-ui/page-shell';
import './styles/checkout-payment-surfaces.css';
import './styles/order-aftercare.css';
import { TaxSummaryRows } from './tax-summary';
import {
    ActiveCustomer,
    MarketConfig,
    Order,
    StorefrontCart,
    StorefrontLanguage,
    StorefrontUsdtCheckoutQuote,
} from './types';

type PaymentRoute = { name: 'cart' | 'home' | 'orders'; tab?: 'shipping' | 'pending' };
const referralCurrencyBadgeClassName =
    'payment-balance-currency grid min-h-11 place-items-center px-3 type-body weight-bold';

export function PaymentPage({
    api,
    cart,
    order,
    customer,
    market,
    displayCurrencyCode,
    locale,
    language,
    onCancel,
    onComplete,
    onOrderChange,
}: {
    api: ShopApi;
    cart: StorefrontCart | null;
    order: Order | null;
    customer: ActiveCustomer | null;
    market: MarketConfig;
    displayCurrencyCode: string;
    locale: string;
    language: StorefrontLanguage;
    onCancel: (order: Order) => void;
    onComplete: (order: Order, confirmationToken: string) => Promise<void>;
    onOrderChange: (order: Order) => void;
}) {
    const navigate = useNavigate();
    const navigateTo = (route: PaymentRoute) => void navigate(routeNavigateOptions(route) as never);
    const isZh = language === 'zh';
    const [selectedMethod, setSelectedMethod] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [paymentError, setPaymentError] = useState('');
    const [referralAmount, setReferralAmount] = useState('');
    const [applyingReferral, setApplyingReferral] = useState(false);
    const [copiedUsdtAddress, setCopiedUsdtAddress] = useState(false);
    const submissionLock = useRef(false);
    const usdtCompletionLock = useRef(false);
    const confirmationTokenRef = useRef('');
    const paymentCurrencyCode = order?.customFields.paymentCurrencyCode || displayCurrencyCode;
    const isPending = cart?.state === 'PAYMENT_PENDING' && order?.state === 'ArrangingPayment';
    const methodsQuery = useQuery({
        queryKey: storefrontQueryKeys.paymentMethods(
            storefrontQueryKeys.market(market),
            languageCodeFor(language),
            order?.id ?? '',
        ),
        queryFn: ({ signal }) => api.eligiblePaymentMethods(signal, order?.id),
        enabled: isPending,
        initialData:
            order && typeof api.cachedEligiblePaymentMethods === 'function'
                ? api.cachedEligiblePaymentMethods(order.id)
                : undefined,
        staleTime: ROUTE_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
    });
    const referralProgramQuery = useQuery({
        queryKey: storefrontQueryKeys.referralProgram(
            storefrontQueryKeys.market(market),
            languageCodeFor(language),
        ),
        queryFn: ({ signal }) => api.referralProgram(signal),
        enabled: Boolean(customer && isPending),
        staleTime: ROUTE_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
    });
    const referralOverviewQuery = useQuery({
        queryKey: storefrontQueryKeys.customerReferral(
            storefrontQueryKeys.market(market),
            languageCodeFor(language),
            customer?.id ?? '',
        ),
        queryFn: ({ signal }) => api.myReferralOverview(signal),
        enabled: Boolean(customer && isPending && referralProgramQuery.data?.enabled),
        staleTime: 0,
        gcTime: PUBLIC_QUERY_GC_TIME,
    });
    const coveredPayments =
        order?.payments?.filter(payment => payment.state === 'Settled' || payment.state === 'Authorized') ??
        [];
    const appliedReferralAmount = coveredPayments
        .filter(payment => payment.method === 'referral-balance')
        .reduce((total, payment) => total + payment.amount, 0);
    const otherCoveredAmount = coveredPayments
        .filter(payment => payment.method !== 'referral-balance')
        .reduce((total, payment) => total + payment.amount, 0);
    const referralWallet = referralOverviewQuery.data?.wallets.find(
        wallet => wallet.currencyCode === order?.currencyCode,
    );
    const outstandingAmount = Math.max(
        0,
        (order?.totalWithTax ?? 0) - appliedReferralAmount - otherCoveredAmount,
    );
    const maximumReferralAmount = Math.min(referralWallet?.availableBalance ?? 0, outstandingAmount);
    const canUseReferral =
        paymentCurrencyCode !== 'USDT' &&
        referralProgramQuery.data?.enabled === true &&
        referralProgramQuery.data.allowBalanceSpend &&
        maximumReferralAmount > 0 &&
        appliedReferralAmount === 0;
    const isUsdtPayment = paymentCurrencyCode === 'USDT';
    const usdtQuoteQuery = useQuery({
        queryKey: ['storefront', market.code, 'usdt-checkout-quote', order?.id ?? '', outstandingAmount],
        queryFn: ({ signal }) => api.createUsdtCheckoutQuote(signal),
        enabled: isUsdtPayment && isPending && outstandingAmount > 0,
        staleTime: 30_000,
        refetchInterval: 60_000,
    });
    const usdtConfirmationTokenQuery = useQuery({
        queryKey: ['storefront', market.code, 'usdt-order-confirmation-token', order?.id ?? ''],
        queryFn: () => api.createOrderConfirmationToken(),
        enabled: Boolean(isUsdtPayment && isPending && usdtQuoteQuery.data),
        staleTime: Number.POSITIVE_INFINITY,
        retry: false,
    });
    const usdtPaidOrderQuery = useQuery({
        queryKey: [
            'storefront',
            market.code,
            'usdt-paid-order',
            order?.id ?? '',
            usdtConfirmationTokenQuery.data?.token ?? '',
        ],
        queryFn: ({ signal }) =>
            api.orderByConfirmationToken(usdtConfirmationTokenQuery.data?.token ?? '', signal),
        enabled: Boolean(isUsdtPayment && isPending && usdtConfirmationTokenQuery.data?.token),
        staleTime: 0,
        refetchInterval: 5_000,
    });
    const currencyMethods = (methodsQuery.data ?? []).filter(method =>
        isUsdtPayment ? method.code === 'usdt-trc20' : method.code !== 'usdt-trc20',
    );
    const availability = paymentAvailability(isPending ? currencyMethods : [], {
        allowTestMethods: import.meta.env.DEV,
    });
    const methods = availability.methods;
    const isTestMode = methods.some(method => method.code === selectedMethod && isTestPaymentMethod(method));
    const loading = isPending && methodsQuery.isLoading;
    const methodLoadError =
        methodsQuery.isPaused && methodsQuery.data === undefined
            ? offlineLoadError(language)
            : methodsQuery.error instanceof Error
              ? storefrontErrorMessage(methodsQuery.error, language)
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
        setSelectedMethod(current => {
            if (methods.some(method => method.code === current && method.isEligible)) return current;
            const preferredUsdtMethod = isUsdtPayment
                ? methods.find(method => method.code === 'usdt-trc20' && method.isEligible)
                : undefined;
            return preferredUsdtMethod?.code ?? methods.find(method => method.isEligible)?.code ?? '';
        });
    }, [isPending, isUsdtPayment, methods]);

    useEffect(() => {
        if (!canUseReferral || referralAmount) return;
        setReferralAmount((maximumReferralAmount / 100).toFixed(2));
    }, [canUseReferral, maximumReferralAmount, referralAmount]);

    useEffect(() => {
        const token = usdtConfirmationTokenQuery.data?.token;
        if (token) confirmationTokenRef.current = token;
    }, [usdtConfirmationTokenQuery.data?.token]);

    useEffect(() => {
        const paidOrder = usdtPaidOrderQuery.data;
        const token = usdtConfirmationTokenQuery.data?.token;
        if (
            !paidOrder ||
            !token ||
            usdtCompletionLock.current ||
            !isPaymentCompletedOrderState(paidOrder.state)
        ) {
            return;
        }
        usdtCompletionLock.current = true;
        onOrderChange(paidOrder);
        void onComplete(paidOrder, token).catch(() => {
            usdtCompletionLock.current = false;
        });
    }, [onComplete, onOrderChange, usdtConfirmationTokenQuery.data?.token, usdtPaidOrderQuery.data]);

    const copyUsdtAddress = async () => {
        const quote = usdtQuoteQuery.data;
        if (!quote?.receivingAddress || quote.paymentStatus !== 'PENDING') return;
        try {
            await navigator.clipboard.writeText(quote.receivingAddress);
            setCopiedUsdtAddress(true);
            window.setTimeout(() => setCopiedUsdtAddress(false), 1800);
        } catch {
            setPaymentError(
                isZh ? '复制失败，请手动选择并复制钱包地址' : 'Copy failed. Copy the address manually.',
            );
        }
    };

    const applyReferralBalance = async () => {
        const amount = Math.round(Number(referralAmount) * 100);
        if (!Number.isInteger(amount) || amount <= 0 || amount > maximumReferralAmount || applyingReferral) {
            setPaymentError(
                isZh
                    ? '请输入不超过可用余额和待支付金额的有效金额'
                    : 'Enter a valid amount within your available balance',
            );
            return;
        }
        setApplyingReferral(true);
        setPaymentError('');
        try {
            if (!confirmationTokenRef.current) {
                confirmationTokenRef.current = (await api.createOrderConfirmationToken()).token;
            }
            const result = await api.useReferralBalance(amount);
            onOrderChange(result.order);
            await referralOverviewQuery.refetch({ cancelRefetch: false });
            if (isPaymentCompletedOrderState(result.order.state)) {
                await onComplete(result.order, confirmationTokenRef.current);
            }
        } catch (requestError) {
            setPaymentError(
                requestError instanceof Error
                    ? storefrontErrorMessage(requestError, language)
                    : isZh
                      ? '返利余额抵扣失败，请重试'
                      : 'Could not apply the referral balance',
            );
        } finally {
            setApplyingReferral(false);
        }
    };

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
        const confirmationRouteRequest = preloadStorefrontRouteComponent('order-confirmation');
        try {
            const confirmationToken =
                confirmationTokenRef.current || (await api.createOrderConfirmationToken()).token;
            const paidOrder = await api.addPaymentToOrder(selectedMethod);
            await confirmationRouteRequest;
            await onComplete(paidOrder, confirmationToken);
        } catch (requestError) {
            if (storefrontErrorCode(requestError) === 'COUPON_REMOVED_DURING_CHECKOUT_ERROR') {
                const refreshed = await api.cart().catch(() => null);
                if (refreshed?.checkoutOrder) onOrderChange(refreshed.checkoutOrder);
            }
            setPaymentError(
                requestError instanceof Error
                    ? storefrontErrorMessage(requestError, language)
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
                    {isUsdtPayment ? (
                        <section className="payment-usdt-quote p-4" role="note">
                            <div className="flex items-start gap-3">
                                <WalletCards
                                    className="mt-0.5 size-5 text-[var(--success)]"
                                    aria-hidden="true"
                                />
                                <div className="min-w-0 flex-1">
                                    <strong className="block text-[var(--text)]">
                                        {isZh ? 'USDT 结账锁价' : 'Locked USDT checkout quote'}
                                    </strong>
                                    {usdtQuoteQuery.data ? (
                                        <>
                                            <span className="mt-1 block type-page weight-bold text-[var(--success)]">
                                                ₮{usdtQuoteQuery.data.usdtAmount.toFixed(6)}
                                            </span>
                                            <small className="mt-2 block [line-height:var(--line-height-body)] text-[var(--muted)]">
                                                {usdtQuoteDescription(usdtQuoteQuery.data, locale, language)}
                                            </small>
                                            <div className="mt-3 payment-quote-details p-3">
                                                <div className="flex items-center justify-between gap-3">
                                                    <span className="type-helper weight-bold text-[var(--muted)]">
                                                        {usdtQuoteQuery.data.network} USDT
                                                    </span>
                                                    <span className="type-helper weight-semibold text-[var(--success)]">
                                                        {usdtQuoteQuery.data.paymentStatus === 'PENDING'
                                                            ? isZh
                                                                ? '等待链上到账'
                                                                : 'Awaiting transfer'
                                                            : usdtQuoteQuery.data.paymentStatus ===
                                                                'MANUAL_REVIEW'
                                                              ? isZh
                                                                  ? '待人工复核'
                                                                  : 'Awaiting review'
                                                              : usdtQuoteQuery.data.paymentStatus ===
                                                                  'SETTLED'
                                                                ? isZh
                                                                    ? '已确认付款'
                                                                    : 'Payment confirmed'
                                                                : isZh
                                                                  ? '报价已过期'
                                                                  : 'Quote expired'}
                                                    </span>
                                                </div>
                                                <code className="mt-2 block break-all type-body weight-bold text-[var(--text)]">
                                                    {usdtQuoteQuery.data.receivingAddress}
                                                </code>
                                                <button
                                                    type="button"
                                                    className="mt-3 inline-flex min-h-10 items-center gap-2 payment-secondary-action px-3 type-action"
                                                    disabled={usdtQuoteQuery.data.paymentStatus !== 'PENDING'}
                                                    onClick={() => void copyUsdtAddress()}
                                                >
                                                    <Copy aria-hidden="true" className="size-4" />
                                                    {copiedUsdtAddress
                                                        ? isZh
                                                            ? '已复制'
                                                            : 'Copied'
                                                        : isZh
                                                          ? '复制收款地址'
                                                          : 'Copy address'}
                                                </button>
                                            </div>
                                            <small className="mt-2 block break-all [line-height:var(--line-height-body)] text-[var(--muted)]">
                                                {isZh ? '钱包校验码：' : 'Wallet verification: '}
                                                {usdtQuoteQuery.data.receivingAddressFingerprint.slice(0, 16)}
                                            </small>
                                            <small className="mt-1 block [line-height:var(--line-height-body)] weight-semibold text-[var(--warning)]">
                                                {usdtQuoteQuery.data.paymentStatus === 'MANUAL_REVIEW'
                                                    ? isZh
                                                        ? '这笔付款需要人工复核，请停止继续转账并联系客服。'
                                                        : 'This payment needs manual review. Do not send another transfer.'
                                                    : isZh
                                                      ? `只能通过 TRC20 转入，并且必须准确支付 ₮${usdtQuoteQuery.data.usdtAmount.toFixed(6)}。` +
                                                        '请勿使用 ERC20 或其他网络。系统确认固化到账及付款归属后进入待发货；归属不明确的付款需人工复核。'
                                                      : `Send exactly ₮${usdtQuoteQuery.data.usdtAmount.toFixed(6)} over TRC20 only. ` +
                                                        'Other networks are not supported. Fulfillment follows solidified confirmation and payment attribution. ' +
                                                        'Ambiguous payments require manual review.'}
                                            </small>
                                        </>
                                    ) : usdtQuoteQuery.isLoading ? (
                                        <span className="mt-2 block type-body text-[var(--muted)]">
                                            {isZh ? '正在锁定当前报价…' : 'Locking the current quote…'}
                                        </span>
                                    ) : (
                                        <span className="mt-2 block type-body text-[var(--danger)]">
                                            {usdtQuoteQuery.error instanceof Error
                                                ? storefrontErrorMessage(usdtQuoteQuery.error, language)
                                                : isZh
                                                  ? '暂时无法生成 USDT 报价'
                                                  : 'Could not create a USDT quote'}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </section>
                    ) : null}
                    <section
                        className={`payment-test-notice${isTestMode ? '' : ' is-production'}`}
                        role="note"
                    >
                        <CircleAlert aria-hidden="true" />
                        <div>
                            <strong>
                                {isUsdtPayment
                                    ? isZh
                                        ? '链上到账检测'
                                        : 'On-chain payment detection'
                                    : isTestMode
                                      ? isZh
                                          ? '测试支付'
                                          : 'Test payment'
                                      : availability.status === 'READY'
                                        ? isZh
                                            ? '安全支付'
                                            : 'Secure payment'
                                        : isZh
                                          ? '支付暂未开放'
                                          : 'Payment is not available yet'}
                            </strong>
                            <span>
                                {isUsdtPayment
                                    ? isZh
                                        ? '系统每分钟补扫 TRON 链，当前页面每 5 秒检查订单状态；无需提交付款成功。'
                                        : 'TRON is reconciled every minute and this page checks the order every 5 seconds.'
                                    : isTestMode
                                      ? isZh
                                          ? '按订单应付金额模拟付款成功，确认后正常下单，无需真实转账。'
                                          : 'Simulates successful payment of the amount due and completes checkout without a real transfer.'
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
                    {customer && !isUsdtPayment && referralProgramQuery.data?.enabled && (
                        <section className="payment-method-section">
                            <h2>{isZh ? '返利余额抵扣' : 'Referral balance'}</h2>
                            <div className="payment-balance-panel p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <span className="flex items-center gap-2 weight-bold text-[var(--text)]">
                                        <Gift
                                            aria-hidden="true"
                                            className="size-4 text-[var(--interaction-ink)]"
                                        />
                                        {isZh ? '可用余额' : 'Available balance'}
                                    </span>
                                    <strong className="text-[var(--interaction-ink)]">
                                        {formatSettlementMoney(
                                            referralWallet?.availableBalance ?? 0,
                                            order.currencyCode,
                                            locale,
                                        )}
                                    </strong>
                                </div>
                                {appliedReferralAmount > 0 ? (
                                    <p className="mb-0 mt-3 type-body weight-semibold text-[var(--success)]">
                                        {isZh
                                            ? `已抵扣 ${formatSettlementMoney(appliedReferralAmount, order.currencyCode, locale)}，剩余金额请继续选择支付方式。`
                                            : `${formatSettlementMoney(appliedReferralAmount, order.currencyCode, locale)} applied. Choose a method for the remainder.`}
                                    </p>
                                ) : canUseReferral ? (
                                    <div className="mt-3 flex gap-2">
                                        <label className="sr-only" htmlFor="referral-balance-amount">
                                            {isZh ? '返利余额抵扣金额' : 'Referral balance amount'}
                                        </label>
                                        <span className={referralCurrencyBadgeClassName}>
                                            {order.currencyCode}
                                        </span>
                                        <input
                                            id="referral-balance-amount"
                                            className="payment-balance-input min-w-0 flex-1 px-3 type-input"
                                            type="number"
                                            min="0.01"
                                            max={(maximumReferralAmount / 100).toFixed(2)}
                                            step="0.01"
                                            value={referralAmount}
                                            disabled={applyingReferral || submitting}
                                            onChange={event => setReferralAmount(event.currentTarget.value)}
                                        />
                                        <button
                                            type="button"
                                            className="payment-secondary-action min-h-11 px-4 weight-bold"
                                            disabled={applyingReferral || submitting}
                                            onClick={() => void applyReferralBalance()}
                                        >
                                            {applyingReferral
                                                ? isZh
                                                    ? '抵扣中…'
                                                    : 'Applying…'
                                                : isZh
                                                  ? '使用余额'
                                                  : 'Apply'}
                                        </button>
                                    </div>
                                ) : (
                                    <p className="mb-0 mt-3 type-body text-[var(--muted)]">
                                        {referralProgramQuery.data.allowBalanceSpend
                                            ? isZh
                                                ? '当前币种暂无可用返利余额。'
                                                : 'No referral balance is available in this currency.'
                                            : isZh
                                              ? '店铺暂时关闭了返利余额消费。'
                                              : 'Referral balance spending is temporarily paused.'}
                                    </p>
                                )}
                            </div>
                        </section>
                    )}
                    <section className="payment-method-section">
                        <h2>{isZh ? '支付方式' : 'Payment method'}</h2>
                        {loading ? (
                            <PageSkeleton label={isZh ? '正在加载支付方式' : 'Loading payment methods'} />
                        ) : methodLoadError && !methods.length ? (
                            <InlineError
                                message={methodLoadError}
                                action={isZh ? '重试' : 'Retry'}
                                onAction={() => void methodsQuery.refetch({ cancelRefetch: false })}
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
                                                      (isTestPaymentMethod(method)
                                                          ? isZh
                                                              ? '模拟付款，不真实扣款或交付'
                                                              : 'Simulated payment without a real charge or delivery'
                                                          : isZh
                                                            ? '可用于当前订单'
                                                            : 'Available for this order')
                                                    : storefrontErrorMessage(
                                                          method.eligibilityMessage,
                                                          language,
                                                          isZh
                                                              ? '当前订单不可用'
                                                              : 'Unavailable for this order',
                                                      )}
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
                                            : '暂未接入支付方式，订单已保留'
                                        : isTestMode
                                          ? 'No local test payment method is available'
                                          : 'No payment provider is configured. Your order is preserved.'
                                }
                                action={isZh ? '重试' : 'Retry'}
                                onAction={() => void methodsQuery.refetch({ cancelRefetch: false })}
                            />
                        ) : (
                            <InlineError
                                message={storefrontErrorMessage(
                                    methods[0]?.eligibilityMessage,
                                    language,
                                    isZh
                                        ? '当前订单暂不满足支付条件，请返回修改订单'
                                        : 'This order is not currently eligible for payment. Return to edit it.',
                                )}
                            />
                        )}
                        {paymentError && methods.length > 0 && <InlineError message={paymentError} />}
                    </section>
                    {isUsdtPayment && paymentError ? <InlineError message={paymentError} /> : null}
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
                        <TaxSummaryRows
                            order={order}
                            locale={locale}
                            language={language}
                            useDisplayCurrency
                        />
                        <div className="summary-total">
                            <dt>
                                {isUsdtPayment
                                    ? isZh
                                        ? '订单计价合计'
                                        : 'Order total'
                                    : isZh
                                      ? '应付合计'
                                      : 'Total due'}
                            </dt>
                            <dd>{formatMoney(order.totalWithTax, order.currencyCode, locale)}</dd>
                        </div>
                        {appliedReferralAmount > 0 && (
                            <div>
                                <dt>{isZh ? '返利余额抵扣' : 'Referral balance'}</dt>
                                <dd>-{formatMoney(appliedReferralAmount, order.currencyCode, locale)}</dd>
                            </div>
                        )}
                        {otherCoveredAmount > 0 && (
                            <div>
                                <dt>{isZh ? '已付／已授权' : 'Paid or authorized'}</dt>
                                <dd>-{formatMoney(otherCoveredAmount, order.currencyCode, locale)}</dd>
                            </div>
                        )}
                        {appliedReferralAmount + otherCoveredAmount > 0 && (
                            <div className="summary-total">
                                <dt>{isZh ? '剩余待支付' : 'Remaining due'}</dt>
                                <dd>{formatMoney(outstandingAmount, order.currencyCode, locale)}</dd>
                            </div>
                        )}
                        {isUsdtPayment && (
                            <div className="summary-total">
                                <dt>{isZh ? 'USDT 锁价应付' : 'Locked USDT due'}</dt>
                                <dd>
                                    {usdtQuoteQuery.data
                                        ? `₮${usdtQuoteQuery.data.usdtAmount.toFixed(6)}`
                                        : isZh
                                          ? '正在锁价…'
                                          : 'Locking quote…'}
                                </dd>
                            </div>
                        )}
                    </dl>
                    {isUsdtPayment ? (
                        <button
                            type="button"
                            disabled={
                                !usdtConfirmationTokenQuery.data?.token || usdtPaidOrderQuery.isFetching
                            }
                            onClick={() => void usdtPaidOrderQuery.refetch({ cancelRefetch: false })}
                        >
                            <WalletCards aria-hidden="true" />
                            {usdtPaidOrderQuery.isFetching
                                ? isZh
                                    ? '正在检查链上到账'
                                    : 'Checking payment'
                                : isZh
                                  ? '立即检查到账'
                                  : 'Check payment now'}
                        </button>
                    ) : (
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
                    )}
                    <button
                        type="button"
                        className="payment-edit-order"
                        disabled={submitting || applyingReferral || appliedReferralAmount > 0}
                        onClick={() => onCancel(order)}
                    >
                        {appliedReferralAmount === 0 && <ArrowLeft aria-hidden="true" />}
                        {appliedReferralAmount > 0
                            ? isZh
                                ? '余额已抵扣，订单需完成支付'
                                : 'Balance applied; complete payment'
                            : isZh
                              ? '返回修改订单'
                              : 'Return to edit order'}
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
    customer,
    market,
    locale,
    language,
}: {
    api: ShopApi;
    code: string;
    confirmationToken: string;
    customer: ActiveCustomer | null;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
}) {
    const navigate = useNavigate();
    const navigateTo = (route: PaymentRoute) => void navigate(routeNavigateOptions(route) as never);
    const isZh = language === 'zh';
    const orderQuery = useQuery({
        queryKey: [
            ...storefrontQueryKeys.orderByCode(
                storefrontQueryKeys.market(market),
                languageCodeFor(language),
                code,
            ),
            confirmationToken,
        ],
        queryFn: ({ signal }) => api.orderByConfirmationToken(confirmationToken, signal),
        enabled: Boolean(code && confirmationToken),
        staleTime: 0,
        refetchOnMount: 'always',
        refetchInterval: query => orderStatusRefreshInterval(query.state.data?.state),
        gcTime: 0,
    });
    const order =
        code &&
        confirmationToken &&
        orderQuery.isFetchedAfterMount &&
        !orderQuery.isError &&
        !orderQuery.isPaused &&
        orderQuery.data?.code === code
            ? orderQuery.data
            : null;
    const usdtReceipt = order ? usdtPaymentReceipt(order) : null;
    const isTestOrder = order?.state === 'TestPaymentSettled';
    const needsAdditionalPayment = order?.state === 'ArrangingAdditionalPayment';
    const isBeingModified = order?.state === 'Modifying';
    const isCancelled = order?.state === 'Cancelled';
    const loading = Boolean(
        code &&
        confirmationToken &&
        (orderQuery.isLoading || (orderQuery.isFetching && !orderQuery.isFetchedAfterMount)),
    );
    const loadError = orderQuery.isPaused
        ? offlineLoadError(language)
        : orderQuery.error instanceof Error
          ? storefrontErrorMessage(orderQuery.error, language)
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
                    onAction={() =>
                        loadError
                            ? void orderQuery.refetch({ cancelRefetch: false })
                            : navigateTo({ name: 'home' })
                    }
                />
            </Subpage>
        );
    }
    return (
        <main className="page subpage order-confirmation-page">
            <section className="order-confirmation-hero">
                <span className="order-confirmation-icon">
                    {needsAdditionalPayment || isBeingModified || isCancelled ? (
                        <CircleAlert aria-hidden="true" />
                    ) : (
                        <CircleCheck aria-hidden="true" />
                    )}
                </span>
                <p>{isTestOrder ? (isZh ? '测试订单' : 'Test order') : isZh ? '订单状态' : 'Order status'}</p>
                <h1>
                    {isTestOrder
                        ? isZh
                            ? '测试支付成功'
                            : 'Test payment complete'
                        : needsAdditionalPayment
                          ? isZh
                              ? '订单待补款'
                              : 'Additional payment needed'
                          : isBeingModified
                            ? isZh
                                ? '商家正在调整订单'
                                : 'The merchant is updating your order'
                            : isCancelled
                              ? isZh
                                  ? '订单已取消'
                                  : 'Order cancelled'
                              : isZh
                                ? '订单提交成功'
                                : 'Order confirmed'}
                </h1>
                <span>
                    {isTestOrder
                        ? isZh
                            ? '测试付款和订单流程已完成，未真实扣款、发货或扣库存，不计入收入和返利。'
                            : 'Test checkout is complete. No real charge, delivery, stock deduction, revenue or rewards.'
                        : needsAdditionalPayment
                          ? isZh
                              ? '订单金额已调整，请核对下方补款金额与支付方式后确认支付。'
                              : 'Your order total changed. Review the additional amount and payment method before confirming.'
                          : isBeingModified
                            ? isZh
                                ? '请等待商家结束修改，订单会显示更新后的处理状态。'
                                : 'Wait for the merchant to finish the update and check the order status.'
                            : isCancelled
                              ? isZh
                                  ? '交付已停止。如已付款，请查看退款进度或联系商家。'
                                  : 'Delivery has stopped. If you paid, check the refund status or contact the merchant.'
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
                        <dd>{customerOrderStateLabel(order, language)}</dd>
                    </div>
                    <div>
                        <dt>
                            {isTestOrder
                                ? isZh
                                    ? '模拟金额'
                                    : 'Simulated total'
                                : isZh
                                  ? '订单金额'
                                  : 'Order total'}
                        </dt>
                        <dd>
                            {usdtReceipt
                                ? `${formatUsdtPaymentAmount(usdtReceipt)} ${usdtReceipt.network}`
                                : formatMoney(order.totalWithTax, order.currencyCode, locale)}
                        </dd>
                    </div>
                    {!isTestOrder && order.checkoutShipping && (
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
            {!isTestOrder && orderHasDigitalDelivery(order) && (
                <DigitalReceiptPanel
                    api={api}
                    order={order}
                    language={language}
                    market={market}
                    confirmationToken={confirmationToken}
                />
            )}
            {!isTestOrder && (
                <OrderAdditionalPaymentPanel
                    api={api}
                    order={order}
                    market={market}
                    language={language}
                    confirmationToken={confirmationToken}
                />
            )}
            <div className="order-confirmation-actions">
                <button type="button" className="primary-action" onClick={() => navigateTo({ name: 'home' })}>
                    <House aria-hidden="true" />
                    {isZh ? '继续购物' : 'Continue shopping'}
                </button>
                {customer && (
                    <button
                        type="button"
                        onClick={() =>
                            navigateTo({
                                name: 'orders',
                                tab:
                                    isTestOrder || isCancelled || isBeingModified
                                        ? undefined
                                        : needsAdditionalPayment
                                          ? 'pending'
                                          : 'shipping',
                            })
                        }
                    >
                        <Package aria-hidden="true" />
                        {isZh ? '查看我的订单' : 'View my orders'}
                    </button>
                )}
            </div>
        </main>
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
    return formatDisplayMoney(value, currency, locale);
}

function formatSettlementMoney(value: number, currency: string, locale: string): string {
    return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    }).format(value / 100);
}

function usdtQuoteDescription(
    quote: StorefrontUsdtCheckoutQuote,
    locale: string,
    language: StorefrontLanguage,
): string {
    const expiry = new Date(quote.expiresAt).toLocaleTimeString(locale, {
        hour: '2-digit',
        minute: '2-digit',
    });
    const rate = `${quote.fiatPerUsdtRate.toFixed(4)} ${quote.fiatCurrencyCode}`;
    return language === 'zh'
        ? `1 USDT = ${rate}，有效至 ${expiry}`
        : `1 USDT = ${rate}, valid until ${expiry}`;
}
