import { useMutation, useQuery } from '@apollo/client/react';
import { Check, ChevronLeft, ChevronRight, RefreshCw, ShieldCheck, WalletCards, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import { sensitiveActionContext } from '../../apollo';
import { SensitiveActionDialog } from '../../components/SensitiveActionDialog';
import {
    PLATFORM_USDT_PAYMENT_MANAGEMENT_QUERY,
    RECORD_STORE_USDT_MANUAL_REFUND_MUTATION,
    REVIEW_STORE_USDT_WALLET_MUTATION,
    type ManualRefundRecord,
    type PaymentDetailRecord,
    type PlatformFinanceData,
    type UsdtWalletRecord,
} from '../../graphql/store-finance.graphql';
import { toUserFacingError } from '../../utils/user-facing-error';
import { formatDateTime, formatMoney } from '../Sales/sales-utils';

const PAGE_SIZE = 50;
type ProtectedAction =
    | { kind: 'approve'; wallet: UsdtWalletRecord }
    | { kind: 'reject'; wallet: UsdtWalletRecord; reason: string }
    | { kind: 'refund'; payment: PaymentDetailRecord; input: RefundDraft };
interface RefundDraft {
    amount: string;
    usdtAmount: string;
    recipientAddress: string;
    transactionId: string;
    reason: string;
}

export function UsdtPaymentManagementModule() {
    const [channelId, setChannelId] = useState('ALL');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [paymentPage, setPaymentPage] = useState(0);
    const [refundPage, setRefundPage] = useState(0);
    const [rejectionReasons, setRejectionReasons] = useState<Record<string, string>>({});
    const [refundPayment, setRefundPayment] = useState<PaymentDetailRecord | null>(null);
    const [action, setAction] = useState<ProtectedAction | null>(null);
    const [notice, setNotice] = useState('');
    const [error, setError] = useState('');
    const dateOptions = useMemo(
        () => ({
            ...(from ? { from: `${from}T00:00:00.000Z` } : {}),
            ...(to ? { to: `${to}T23:59:59.999Z` } : {}),
        }),
        [from, to],
    );
    const query = useQuery<PlatformFinanceData>(PLATFORM_USDT_PAYMENT_MANAGEMENT_QUERY, {
        variables: {
            channelId: channelId === 'ALL' ? null : channelId,
            statsOptions: dateOptions,
            paymentOptions: { ...dateOptions, skip: paymentPage * PAGE_SIZE, take: PAGE_SIZE },
            refundOptions: { ...dateOptions, skip: refundPage * PAGE_SIZE, take: PAGE_SIZE },
        },
        fetchPolicy: 'cache-and-network',
    });
    const [reviewWallet, reviewState] = useMutation<{ reviewStoreUsdtWallet: UsdtWalletRecord }>(
        REVIEW_STORE_USDT_WALLET_MUTATION,
    );
    const [recordRefund, refundState] = useMutation<{
        recordStoreUsdtManualRefund: ManualRefundRecord;
    }>(RECORD_STORE_USDT_MANUAL_REFUND_MUTATION);
    const wallets = query.data?.storeUsdtWallets ?? [];
    const loading = reviewState.loading || refundState.loading;

    const execute = async (password: string) => {
        if (!action) return;
        setError('');
        try {
            if (action.kind === 'refund') {
                const input = refundInput(action.payment, action.input);
                const result = await recordRefund({
                    variables: { input },
                    context: sensitiveActionContext(password),
                });
                if (!result.data?.recordStoreUsdtManualRefund) throw new Error('后端未返回人工退款审计记录');
                setNotice(`订单 ${action.payment.orderCode} 的 USDT 人工退款已记录`);
                setRefundPayment(null);
            } else {
                const result = await reviewWallet({
                    variables: {
                        input: {
                            channelId: action.wallet.channelId,
                            approved: action.kind === 'approve',
                            ...(action.kind === 'reject'
                                ? { rejectionReason: required(action.reason, '驳回原因') }
                                : {}),
                        },
                    },
                    context: sensitiveActionContext(password),
                });
                if (!result.data?.reviewStoreUsdtWallet) throw new Error('后端未返回钱包审核结果');
                setNotice(action.kind === 'approve' ? '收款地址已审核启用' : '收款地址已驳回');
            }
            setAction(null);
            await query.refetch();
        } catch (cause) {
            setError(toUserFacingError(cause, '资金操作失败，后端未确认成功'));
        }
    };

    return (
        <div className="flex h-full flex-col bg-slate-50">
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
                <div className="mx-auto flex w-full max-w-[1500px] items-center justify-between gap-4">
                    <div>
                        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                            <WalletCards className="h-5 w-5 text-emerald-600" />
                            支付与 USDT 收款管理
                        </h1>
                        <p className="mt-1 text-xs text-slate-500">
                            平台级钱包审核、全部支付流水、链上意向和人工退款审计
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => void query.refetch()}
                        disabled={query.loading}
                        className={secondaryButton}
                    >
                        <RefreshCw className={`h-4 w-4 ${query.loading ? 'animate-spin' : ''}`} />
                        刷新
                    </button>
                </div>
            </header>
            <main className="mx-auto w-full max-w-[1500px] flex-1 space-y-4 overflow-y-auto p-5 sm:p-8">
                {notice && <Notice tone="success" message={notice} />}
                {error && !action && <Notice tone="error" message={error} />}
                {query.loading && !query.data ? (
                    <State label="正在读取平台支付数据…" />
                ) : query.error ? (
                    <State tone="error" label="平台支付数据加载失败" action={() => void query.refetch()} />
                ) : (
                    <>
                        <section className={sectionClass}>
                            <Heading
                                title="网店 USDT 收款地址审核"
                                detail="仅待审地址可以通过或驳回；通过后只影响该 Channel 新生成的付款意向。"
                            />
                            <div className="mt-4 grid gap-3 lg:grid-cols-2">
                                {wallets.map(wallet => (
                                    <WalletReview
                                        key={wallet.channelId}
                                        wallet={wallet}
                                        reason={rejectionReasons[wallet.channelId] ?? ''}
                                        onReason={reason =>
                                            setRejectionReasons(current => ({
                                                ...current,
                                                [wallet.channelId]: reason,
                                            }))
                                        }
                                        onApprove={() => setAction({ kind: 'approve', wallet })}
                                        onReject={() => {
                                            const reason = rejectionReasons[wallet.channelId]?.trim() ?? '';
                                            if (!reason) {
                                                setError('驳回时必须填写原因');
                                                return;
                                            }
                                            setError('');
                                            setAction({ kind: 'reject', wallet, reason });
                                        }}
                                    />
                                ))}
                                {!wallets.length && <p className="text-xs text-slate-500">暂无网店钱包</p>}
                            </div>
                        </section>
                        <section className={sectionClass}>
                            <Heading
                                title="支付与退款报表"
                                detail="按网店和 UTC 日期筛选，已结算支付计入实收，退款计入净收。"
                            />
                            <div className="mt-4 grid gap-3 md:grid-cols-3">
                                <label className={labelClass}>
                                    网店
                                    <select
                                        value={channelId}
                                        onChange={event => {
                                            setChannelId(event.target.value);
                                            setPaymentPage(0);
                                            setRefundPage(0);
                                        }}
                                        className={inputClass}
                                    >
                                        <option value="ALL">全部网店</option>
                                        {wallets.map(wallet => (
                                            <option key={wallet.channelId} value={wallet.channelId}>
                                                {wallet.channelCode}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <label className={labelClass}>
                                    开始日期
                                    <input
                                        type="date"
                                        value={from}
                                        max={to || undefined}
                                        onChange={event => {
                                            setFrom(event.target.value);
                                            setPaymentPage(0);
                                            setRefundPage(0);
                                        }}
                                        className={inputClass}
                                    />
                                </label>
                                <label className={labelClass}>
                                    结束日期
                                    <input
                                        type="date"
                                        value={to}
                                        min={from || undefined}
                                        onChange={event => {
                                            setTo(event.target.value);
                                            setPaymentPage(0);
                                            setRefundPage(0);
                                        }}
                                        className={inputClass}
                                    />
                                </label>
                            </div>
                            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                                {(query.data?.storePaymentStats ?? []).map(item => (
                                    <article
                                        key={`${item.channelId}:${item.paymentMethodCode}:${item.currencyCode}`}
                                        className="rounded-lg border border-slate-200 p-4 text-xs"
                                    >
                                        <div>
                                            <strong>{item.channelCode}</strong>
                                            <span className="ml-2 rounded bg-slate-100 px-2 py-0.5">
                                                {item.paymentMethodCode}
                                            </span>
                                        </div>
                                        <b className="mt-3 block text-xl">
                                            {formatMoney(item.netAmount, item.currencyCode)}
                                        </b>
                                        <small className="text-slate-500">
                                            实收 {formatMoney(item.grossAmount, item.currencyCode)} · 退款{' '}
                                            {formatMoney(item.refundedAmount, item.currencyCode)}
                                        </small>
                                    </article>
                                ))}
                            </div>
                        </section>
                        <section className={sectionClass}>
                            <Heading
                                title="全部支付方式明细"
                                detail="USDT 已结算支付可补录链上人工退款证据。"
                            />
                            <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
                                <table className="min-w-[980px] w-full text-left text-xs">
                                    <thead className="bg-slate-50 text-slate-500">
                                        <tr>
                                            {[
                                                '网店 / 订单',
                                                '支付方式',
                                                '状态',
                                                '金额',
                                                '已退',
                                                '交易号',
                                                '创建时间',
                                                '操作',
                                            ].map(label => (
                                                <th key={label} className="px-3 py-2.5 font-bold">
                                                    {label}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {(query.data?.storePaymentDetails.items ?? []).map(payment => (
                                            <tr key={`${payment.channelId}:${payment.id}`}>
                                                <td className="px-3 py-3">
                                                    <strong>{payment.channelCode}</strong>
                                                    <span className="block">{payment.orderCode}</span>
                                                </td>
                                                <td className="px-3 py-3">{payment.paymentMethodCode}</td>
                                                <td className="px-3 py-3">{payment.paymentState}</td>
                                                <td className="px-3 py-3">
                                                    {formatMoney(payment.amount, payment.currencyCode)}
                                                </td>
                                                <td className="px-3 py-3">
                                                    {formatMoney(
                                                        payment.refundedAmount,
                                                        payment.currencyCode,
                                                    )}
                                                </td>
                                                <td
                                                    className="max-w-44 truncate px-3 py-3 font-mono"
                                                    title={payment.transactionId ?? ''}
                                                >
                                                    {payment.transactionId ?? '—'}
                                                </td>
                                                <td className="px-3 py-3">
                                                    {formatDateTime(payment.createdAt)}
                                                </td>
                                                <td className="px-3 py-3">
                                                    {payment.paymentMethodCode === 'usdt-trc20' &&
                                                        payment.paymentState === 'Settled' && (
                                                            <button
                                                                type="button"
                                                                onClick={() => setRefundPayment(payment)}
                                                                className="font-bold text-blue-600 hover:underline"
                                                            >
                                                                记录人工退款
                                                            </button>
                                                        )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <Pager
                                page={paymentPage}
                                total={query.data?.storePaymentDetails.totalItems ?? 0}
                                onChange={setPaymentPage}
                            />
                        </section>
                        <section className={sectionClass}>
                            <Heading
                                title="USDT 人工退款审计"
                                detail="包含法币退款金额、实际 USDT、收款地址、交易号、区块和操作人。"
                            />
                            <div className="mt-4 max-h-[32rem] space-y-2 overflow-auto">
                                {(query.data?.storeUsdtManualRefunds.items ?? []).map(refund => (
                                    <article
                                        key={refund.id}
                                        className="rounded-lg border border-slate-200 p-3 text-xs"
                                    >
                                        <div className="flex flex-wrap justify-between gap-2">
                                            <strong>
                                                {refund.channelCode} · 订单 {refund.orderCode}
                                            </strong>
                                            <b>
                                                {formatMoney(refund.amount, refund.currencyCode)} /{' '}
                                                {refund.usdtAmount} USDT
                                            </b>
                                        </div>
                                        <p className="mt-1 break-all font-mono text-[10px] text-slate-500">
                                            {refund.transactionId} · 区块 {refund.blockNumber}
                                        </p>
                                        <p className="mt-1 text-slate-500">
                                            {refund.reason} · {formatDateTime(refund.createdAt)}
                                        </p>
                                    </article>
                                ))}
                                {!query.data?.storeUsdtManualRefunds.items.length && (
                                    <p className="py-8 text-center text-xs text-slate-500">
                                        暂无人工退款记录
                                    </p>
                                )}
                            </div>
                            <Pager
                                page={refundPage}
                                total={query.data?.storeUsdtManualRefunds.totalItems ?? 0}
                                onChange={setRefundPage}
                            />
                        </section>
                        <section className={sectionClass}>
                            <Heading
                                title="USDT 链上收款意向"
                                detail="最新报价、到账、人工复核和过期状态。"
                            />
                            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                                {(query.data?.storeUsdtPaymentStats ?? []).map(item => (
                                    <article
                                        key={item.channelId}
                                        className="rounded-lg border border-slate-200 p-4 text-xs"
                                    >
                                        <strong>{item.channelCode}</strong>
                                        <b className="mt-2 block text-xl">
                                            {item.receivedUsdtTotal.toFixed(6)} USDT
                                        </b>
                                        <span className="text-slate-500">
                                            到账 {item.settledCount} · 待复核 {item.manualReviewCount} · 过期{' '}
                                            {item.expiredCount}
                                        </span>
                                    </article>
                                ))}
                            </div>
                            <div className="mt-4 max-h-[32rem] space-y-2 overflow-auto">
                                {(query.data?.storeUsdtPaymentIntents ?? []).map(intent => (
                                    <article
                                        key={intent.id}
                                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 text-xs"
                                    >
                                        <span>
                                            <strong>
                                                {intent.channelCode} · {intent.orderCode}
                                            </strong>
                                            <small className="ml-2 text-slate-500">{intent.status}</small>
                                            <span className="mt-1 block font-mono text-[10px] text-slate-500">
                                                {intent.transactionId ?? '尚无交易号'}
                                            </span>
                                        </span>
                                        <b>{intent.expectedUsdtAmount.toFixed(6)} USDT</b>
                                    </article>
                                ))}
                            </div>
                        </section>
                    </>
                )}
            </main>
            {refundPayment && (
                <RefundEditor
                    payment={refundPayment}
                    onClose={() => setRefundPayment(null)}
                    onSubmit={input => setAction({ kind: 'refund', payment: refundPayment, input })}
                />
            )}
            <SensitiveActionDialog
                open={action !== null}
                title={action?.kind === 'refund' ? '确认记录 USDT 人工退款' : '确认审核收款地址'}
                description="这是资金敏感操作。系统将验证当前超级管理员密码，并以后端返回的持久化结果作为成功依据。"
                confirmLabel="验证并执行"
                loading={loading}
                error={error}
                onClose={() => {
                    if (!loading) {
                        setAction(null);
                        setError('');
                    }
                }}
                onConfirm={execute}
            />
        </div>
    );
}

function WalletReview({
    wallet,
    reason,
    onReason,
    onApprove,
    onReject,
}: {
    wallet: UsdtWalletRecord;
    reason: string;
    onReason: (value: string) => void;
    onApprove: () => void;
    onReject: () => void;
}) {
    return (
        <article className="rounded-xl border border-slate-200 p-4 text-xs">
            <div className="flex items-center justify-between gap-2">
                <strong>{wallet.channelCode}</strong>
                <span
                    className={`rounded px-2 py-1 font-bold ${wallet.reviewStatus === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}
                >
                    {wallet.reviewStatus}
                </span>
            </div>
            <p className="mt-3 break-all text-slate-500">
                当前：{wallet.activeReceivingAddressMasked ?? '无'}
                <br />
                待审：{wallet.pendingReceivingAddress ?? '无'}
                <br />
                指纹：{wallet.pendingReceivingAddressFingerprint ?? '无'}
            </p>
            {wallet.reviewStatus === 'PENDING' && (
                <div className="mt-3 border-t pt-3">
                    <input
                        value={reason}
                        maxLength={500}
                        onChange={event => onReason(event.target.value)}
                        placeholder="驳回原因（驳回时必填）"
                        className={inputClass}
                    />
                    <div className="mt-2 flex justify-end gap-2">
                        <button
                            type="button"
                            onClick={onReject}
                            className={`${secondaryButton} text-rose-600`}
                        >
                            <X className="h-4 w-4" />
                            驳回
                        </button>
                        <button type="button" onClick={onApprove} className={primaryButton}>
                            <Check className="h-4 w-4" />
                            通过
                        </button>
                    </div>
                </div>
            )}
        </article>
    );
}
function RefundEditor({
    payment,
    onClose,
    onSubmit,
}: {
    payment: PaymentDetailRecord;
    onClose: () => void;
    onSubmit: (input: RefundDraft) => void;
}) {
    const [draft, setDraft] = useState<RefundDraft>({
        amount: String(Math.max(payment.amount - payment.refundedAmount, 0) / 100),
        usdtAmount: '',
        recipientAddress: '',
        transactionId: '',
        reason: '',
    });
    const update = (field: keyof RefundDraft, value: string) =>
        setDraft(current => ({ ...current, [field]: value }));
    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4">
            <div
                role="dialog"
                aria-modal="true"
                aria-label="记录 USDT 人工退款"
                className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl"
            >
                <div className="flex justify-between">
                    <div>
                        <h2 className="text-base font-bold">记录 USDT 人工退款</h2>
                        <p className="mt-1 text-xs text-slate-500">
                            订单 {payment.orderCode} · 支付 {payment.id}
                        </p>
                    </div>
                    <button type="button" onClick={onClose} aria-label="关闭">
                        <X className="h-4 w-4" />
                    </button>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <RefundField
                        label={`法币退款 (${payment.currencyCode})`}
                        type="number"
                        value={draft.amount}
                        onChange={value => update('amount', value)}
                    />
                    <RefundField
                        label="实际 USDT 数量"
                        type="number"
                        value={draft.usdtAmount}
                        onChange={value => update('usdtAmount', value)}
                    />
                    <RefundField
                        label="收款 TRC20 地址"
                        value={draft.recipientAddress}
                        onChange={value => update('recipientAddress', value)}
                    />
                    <RefundField
                        label="链上交易号"
                        value={draft.transactionId}
                        onChange={value => update('transactionId', value)}
                    />
                    <div className="sm:col-span-2">
                        <RefundField
                            label="退款原因"
                            value={draft.reason}
                            onChange={value => update('reason', value)}
                        />
                    </div>
                </div>
                <div className="mt-6 flex justify-end gap-2 border-t pt-4">
                    <button type="button" onClick={onClose} className={secondaryButton}>
                        取消
                    </button>
                    <button type="button" onClick={() => onSubmit(draft)} className={primaryButton}>
                        <ShieldCheck className="h-4 w-4" />
                        下一步验证密码
                    </button>
                </div>
            </div>
        </div>
    );
}
function RefundField({
    label,
    value,
    onChange,
    type = 'text',
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    type?: string;
}) {
    return (
        <label className={labelClass}>
            {label}
            <input
                type={type}
                min={type === 'number' ? 0 : undefined}
                step={type === 'number' ? 'any' : undefined}
                value={value}
                onChange={event => onChange(event.target.value)}
                className={inputClass}
            />
        </label>
    );
}
function refundInput(payment: PaymentDetailRecord, draft: RefundDraft) {
    const amount = Number(draft.amount);
    const usdtAmount = Number(draft.usdtAmount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('退款金额必须大于 0');
    if (Math.round(amount * 100) > payment.amount - payment.refundedAmount)
        throw new Error('退款金额不能超过剩余可退金额');
    if (!Number.isFinite(usdtAmount) || usdtAmount <= 0) throw new Error('USDT 数量必须大于 0');
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(draft.recipientAddress.trim()))
        throw new Error('收款地址不是有效 TRC20 地址');
    return {
        paymentId: payment.id,
        amount: Math.round(amount * 100),
        usdtAmount: String(usdtAmount),
        recipientAddress: draft.recipientAddress.trim(),
        transactionId: required(draft.transactionId, '链上交易号'),
        reason: required(draft.reason, '退款原因'),
    };
}
function required(value: string, label: string) {
    const clean = value.trim();
    if (!clean) throw new Error(`${label}不能为空`);
    return clean;
}
function Pager({ page, total, onChange }: { page: number; total: number; onChange: (page: number) => void }) {
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    return (
        <div className="mt-4 flex items-center justify-end gap-2 text-xs text-slate-500">
            <span>
                {total} 条 · {page + 1}/{pages}
            </span>
            <button
                type="button"
                onClick={() => onChange(page - 1)}
                disabled={page === 0}
                className={pagerButton}
            >
                <ChevronLeft className="h-4 w-4" />
            </button>
            <button
                type="button"
                onClick={() => onChange(page + 1)}
                disabled={page + 1 >= pages}
                className={pagerButton}
            >
                <ChevronRight className="h-4 w-4" />
            </button>
        </div>
    );
}
function Heading({ title, detail }: { title: string; detail: string }) {
    return (
        <div>
            <h2 className="text-sm font-bold text-slate-900">{title}</h2>
            <p className="mt-1 text-xs text-slate-500">{detail}</p>
        </div>
    );
}
function Notice({ tone, message }: { tone: 'success' | 'error'; message: string }) {
    return (
        <div
            role={tone === 'error' ? 'alert' : 'status'}
            className={`rounded-lg border p-3 text-xs ${tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}
        >
            {message}
        </div>
    );
}
function State({
    label,
    tone = 'default',
    action,
}: {
    label: string;
    tone?: 'default' | 'error';
    action?: () => void;
}) {
    return (
        <div
            role={tone === 'error' ? 'alert' : 'status'}
            className={`rounded-xl border p-10 text-center text-sm ${tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-slate-200 bg-white text-slate-500'}`}
        >
            <p>{label}</p>
            {action && (
                <button
                    type="button"
                    onClick={action}
                    className="mt-3 rounded-lg border px-3 py-2 text-xs font-bold"
                >
                    重试
                </button>
            )}
        </div>
    );
}
const sectionClass = 'rounded-xl border border-slate-200 bg-white p-5';
const labelClass = 'text-xs font-bold text-slate-600';
const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal';
const primaryButton =
    'inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40';
const secondaryButton =
    'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-40';
const pagerButton = 'rounded-lg border border-slate-300 p-1.5 disabled:opacity-30';
