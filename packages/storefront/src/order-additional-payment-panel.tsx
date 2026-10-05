import type { ShopApi } from './api';
import type {
    MarketConfig,
    Order,
    PaymentMethod,
    StorefrontLanguage,
    StorefrontUsdtCheckoutQuote,
} from './types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';

import { languageCodeFor } from './i18n';
import { formatDisplayMoney } from './money-display';
import { storefrontQueryKeys } from './query-client';
import { storefrontErrorMessage } from './storefront-errors';

export interface OrderAdditionalPaymentQuote {
    orderId: string;
    state: string;
    outstandingAmount: number;
    blockedReason: string | null;
    methods: PaymentMethod[];
    walletAvailableAmount?: number;
    usdtPayment?: StorefrontUsdtCheckoutQuote | null;
}

interface Props {
    api: ShopApi;
    order: Order;
    market: MarketConfig;
    language: StorefrontLanguage;
    confirmationToken?: string;
}

export function OrderAdditionalPaymentPanel(props: Props) {
    if (props.order.state !== 'ArrangingAdditionalPayment') return null;
    return (
        <AdditionalPayment
            key={[
                props.market.code,
                props.market.currencyCode,
                props.order.id,
                props.order.customer?.id,
                props.confirmationToken ?? 'account',
            ].join(':')}
            {...props}
        />
    );
}

function AdditionalPayment({ api, order, market, language, confirmationToken }: Props) {
    const isZh = language === 'zh';
    const scope = useId();
    const client = useQueryClient();
    const [selected, setSelected] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [unconfirmed, setUnconfirmed] = useState(false);
    const [awaitingUpdatedAmount, setAwaitingUpdatedAmount] = useState(false);
    const expectedRemaining = useRef<number | null>(null);
    const [issuedUsdt, setIssuedUsdt] = useState<StorefrontUsdtCheckoutQuote | null>(null);
    const balanceKey = useRef(crypto.randomUUID());
    const flight = useRef(false);
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    const quote = useQuery({
        queryKey: [
            'storefront',
            storefrontQueryKeys.market(market),
            languageCodeFor(language),
            'additional-payment',
            order.id,
            scope,
        ],
        queryFn: ({ signal }) => api.orderAdditionalPaymentQuote(order.id, confirmationToken, signal),
        staleTime: 0,
        gcTime: 0,
        retry: false,
        refetchInterval: query =>
            query.state.data?.usdtPayment?.paymentStatus === 'PENDING' ? 10_000 : false,
    });
    const eligible = quote.data?.methods.filter(methodValue => methodValue.isEligible) ?? [];
    const method = eligible.find(item => item.code === selected) ?? eligible[0];
    const amount = formatDisplayMoney(quote.data?.outstandingAmount ?? 0, order.currencyCode, market.locale);
    const walletAmount = Math.min(quote.data?.outstandingAmount ?? 0, quote.data?.walletAvailableAmount ?? 0);
    const walletLabel = formatDisplayMoney(walletAmount, order.currencyCode, market.locale);
    const usdt = quote.data?.usdtPayment ?? issuedUsdt;
    const waitingUsdt = Boolean(usdt && ['PENDING', 'MANUAL_REVIEW'].includes(usdt.paymentStatus));
    const refresh = async () => {
        try {
            const updated = await quote.refetch({ cancelRefetch: false });
            if (updated.error) throw updated.error;
            if (
                mounted.current &&
                expectedRemaining.current !== null &&
                updated.data?.outstandingAmount === expectedRemaining.current
            ) {
                expectedRemaining.current = null;
                balanceKey.current = crypto.randomUUID();
                setAwaitingUpdatedAmount(false);
                setError('');
            }
            await client.invalidateQueries({
                predicate: query => query.queryKey.includes(order.id) || query.queryKey.includes(order.code),
            });
        } catch (cause) {
            if (mounted.current) setError(storefrontErrorMessage(cause, language));
        }
    };
    const pay = async () => {
        if (
            flight.current ||
            busy ||
            unconfirmed ||
            awaitingUpdatedAmount ||
            !method ||
            !quote.data ||
            quote.data.blockedReason
        )
            return;
        flight.current = true;
        setBusy(true);
        setError('');
        setNotice('');
        try {
            if (method.code === 'usdt-trc20') {
                const issued = await api.createModifiedOrderUsdtQuote(
                    order.id,
                    quote.data.outstandingAmount,
                    confirmationToken,
                );
                if (!mounted.current) return;
                setIssuedUsdt(issued);
                setNotice(
                    isZh
                        ? 'USDT 付款请求已生成，链上确认到账后才会完成补款。'
                        : 'USDT request created. Payment completes only after on-chain confirmation.',
                );
                void refresh();
                return;
            }
            const usingWallet = method.code === 'referral-balance';
            const paid = usingWallet
                ? await api.useModifiedOrderReferralBalance(
                      order.id,
                      quote.data.outstandingAmount,
                      walletAmount,
                      balanceKey.current,
                  )
                : await api.addPaymentToModifiedOrder(
                      order.id,
                      method.code,
                      quote.data.outstandingAmount,
                      confirmationToken,
                  );
            if (!mounted.current) return;
            if (paid.id !== order.id || (paid.state === 'ArrangingAdditionalPayment' && !usingWallet)) {
                throw new Error(
                    isZh
                        ? '付款结果尚待核验，请联系商家，不要重复支付。'
                        : 'Payment needs verification. Contact the store and do not pay again.',
                );
            }
            const partial = usingWallet && paid.state === 'ArrangingAdditionalPayment';
            setNotice(
                partial
                    ? isZh
                        ? '余额抵扣已登记，请查看更新后的剩余补款金额。'
                        : 'Balance applied. Check the updated remaining amount.'
                    : isZh
                      ? '补款已登记，请查看最新订单状态。'
                      : 'Additional payment recorded. Check the updated order status.',
            );
            setUnconfirmed(!partial);
            if (partial) {
                expectedRemaining.current = quote.data.outstandingAmount - walletAmount;
                setAwaitingUpdatedAmount(true);
            }
            void refresh();
        } catch (cause) {
            if (!mounted.current) return;
            setError(storefrontErrorMessage(cause, language));
            // An HTTP error cannot establish whether an external charge succeeded.
            setUnconfirmed(true);
            void refresh();
        } finally {
            flight.current = false;
            if (mounted.current) setBusy(false);
        }
    };
    return (
        <section
            className="digital-delivery-panel digital-receipt-panel order-additional-payment"
            aria-label={isZh ? '订单补款' : 'Additional order payment'}
            aria-busy={busy || quote.isFetching}
        >
            <h3>{isZh ? '订单待补款' : 'Additional payment needed'}</h3>
            {quote.isPending && (
                <p role="status">{isZh ? '正在核对待补款金额…' : 'Checking the amount due…'}</p>
            )}
            {quote.isError && <p role="alert">{storefrontErrorMessage(quote.error, language)}</p>}
            {quote.data && (
                <>
                    <p>
                        {isZh ? '商家调整了订单，待补款金额：' : 'Your order changed. Amount due: '}
                        {amount}
                    </p>
                    {quote.data.blockedReason ? (
                        <p role="status">
                            {isZh
                                ? quote.data.blockedReason
                                : 'Check the order with the store before paying again.'}
                        </p>
                    ) : eligible.length === 0 ? (
                        <p>
                            {isZh
                                ? '当前支付方式需商家核验补款，请联系商家。'
                                : 'Contact the store to arrange and verify additional payment.'}
                        </p>
                    ) : (
                        <>
                            <label>
                                {isZh ? '支付方式' : 'Payment method'}
                                <select
                                    disabled={busy || unconfirmed || awaitingUpdatedAmount || waitingUsdt}
                                    value={method?.code ?? ''}
                                    onChange={event => setSelected(event.target.value)}
                                >
                                    {eligible.map(item => (
                                        <option key={item.code} value={item.code}>
                                            {item.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            {!waitingUsdt && (
                                <button
                                    type="button"
                                    className="primary-action"
                                    disabled={
                                        busy || unconfirmed || awaitingUpdatedAmount || quote.isFetching
                                    }
                                    onClick={() => void pay()}
                                >
                                    {busy
                                        ? isZh
                                            ? '正在提交…'
                                            : 'Submitting…'
                                        : method?.code === 'usdt-trc20'
                                          ? isZh
                                              ? `生成 USDT 补款报价（${amount}）`
                                              : `Create USDT quote (${amount})`
                                          : method?.code === 'referral-balance'
                                            ? isZh
                                                ? `确认使用余额抵扣 ${walletLabel}`
                                                : `Apply balance ${walletLabel}`
                                            : isZh
                                              ? `确认支付 ${amount}`
                                              : `Confirm payment ${amount}`}
                                </button>
                            )}
                        </>
                    )}
                </>
            )}
            {waitingUsdt && usdt && (
                <div className="order-additional-usdt">
                    <p>
                        {isZh ? '当前 USDT 付款请求' : 'Current USDT payment request'} ·{' '}
                        {usdt.paymentStatus === 'MANUAL_REVIEW'
                            ? isZh
                                ? '已到账待复核，请勿重复转账'
                                : 'Received; review needed. Do not transfer again.'
                            : isZh
                              ? '等待链上固化到账，请勿重复转账'
                              : 'Awaiting on-chain confirmation. Do not transfer twice.'}
                    </p>
                    <p>
                        {isZh ? '网络' : 'Network'}：{usdt.network} · {isZh ? '精确金额' : 'Exact amount'}：
                        {Number(usdt.usdtAmount).toFixed(6)} USDT
                    </p>
                    <label>
                        {isZh ? '本订单收款地址' : 'Address for this order'}
                        <input
                            readOnly
                            value={usdt.receivingAddress}
                            aria-label={isZh ? 'USDT 收款地址' : 'USDT receiving address'}
                        />
                    </label>
                    <p>
                        {isZh
                            ? '请使用指定网络和完整金额，保留交易哈希。过期或异常到账仍需核验，刷新不会创建新付款。'
                            : 'Use the specified network and exact amount. Keep the transaction hash. ' +
                              'Expired or exceptional receipts require verification; refreshing never creates another payment.'}
                    </p>
                </div>
            )}
            {error && <p role="alert">{error}</p>}
            {notice && <p role="status">{notice}</p>}
            {awaitingUpdatedAmount && (
                <p role="status">
                    {isZh
                        ? '抵扣已成功，剩余金额尚未更新。请刷新核对后再继续付款。'
                        : 'Balance applied. Refresh and verify the remaining amount before paying again.'}
                </p>
            )}
            {unconfirmed && !notice && (
                <p>
                    {isZh
                        ? '请先核对原付款结果。结果确认前不要再次支付。'
                        : 'Verify the original payment before making another payment.'}
                </p>
            )}
            <button
                type="button"
                className="secondary-action"
                disabled={busy || quote.isFetching}
                onClick={() => void refresh()}
            >
                {isZh ? '刷新付款状态' : 'Refresh payment status'}
            </button>
        </section>
    );
}
// organize-imports-ignore -- Preserve ESLint grouping of type-only imports.
