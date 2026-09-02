import { useMutation, useQuery } from '@apollo/client/react';
import { CreditCard, Plus, RefreshCw, ShieldCheck, Store, Ticket, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { sensitiveActionContext } from '../../apollo';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { SensitiveActionDialog } from '../../components/SensitiveActionDialog';
import type { NextAdminPageBlockContext } from '../../extensions/extension-api';
import {
    ADD_MANUAL_PAYMENT_MUTATION,
    CANCEL_PAYMENT_MUTATION,
    ORDER_OPERATIONS_QUERY,
    PAYMENT_METHODS_FOR_MANUAL_QUERY,
    SETTLE_PAYMENT_MUTATION,
    SETTLE_REFUND_MUTATION,
    TRANSITION_PAYMENT_MUTATION,
    type OrderOperationPayment,
    type OrderOperationResult,
    type OrderOperationsData,
    type PaymentMethodsForManualData,
} from '../../graphql/order-operations.graphql';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { toUserFacingError } from '../../utils/user-facing-error';
import { canAddManualPayment } from './order-operation-availability';
import { formatDateTime, formatMoney, getPaymentStateLabel, getRefundStateLabel } from './sales-utils';

type ProtectedAction =
    | { kind: 'manual'; method: string; transactionId: string }
    | { kind: 'settle-payment'; payment: OrderOperationPayment }
    | { kind: 'transition-payment'; payment: OrderOperationPayment; state: string }
    | { kind: 'cancel-payment'; payment: OrderOperationPayment }
    | { kind: 'settle-refund'; refundId: string; transactionId: string };

export function OrderOperationsBlock({ context }: { context: NextAdminPageBlockContext }) {
    const orderId = entityId(context.entity?.id);
    const { hasAnyPermission } = useAdminPermissions();
    const canUpdate = hasAnyPermission(['UpdateOrder']);
    const canReadPaymentMethods = hasAnyPermission(['ReadSettings', 'ReadPaymentMethod']);
    const query = useQuery<OrderOperationsData>(ORDER_OPERATIONS_QUERY, {
        variables: { id: orderId },
        skip: !orderId,
        fetchPolicy: 'cache-and-network',
    });
    const paymentMethodsQuery = useQuery<PaymentMethodsForManualData>(PAYMENT_METHODS_FOR_MANUAL_QUERY, {
        skip: !canUpdate || !canReadPaymentMethods,
        fetchPolicy: 'cache-first',
    });
    const [action, setAction] = useState<ProtectedAction | null>(null);
    const [manualOpen, setManualOpen] = useState(false);
    const [refundEditor, setRefundEditor] = useState<{ refundId: string } | null>(null);
    const [notice, setNotice] = useState('');
    const [error, setError] = useState('');
    const [addManual, addManualState] = useMutation<{ addManualPaymentToOrder: OrderOperationResult }>(
        ADD_MANUAL_PAYMENT_MUTATION,
    );
    const [settlePayment, settlePaymentState] = useMutation<{ settlePayment: OrderOperationResult }>(
        SETTLE_PAYMENT_MUTATION,
    );
    const [transitionPayment, transitionPaymentState] = useMutation<{
        transitionPaymentToState: OrderOperationResult;
    }>(TRANSITION_PAYMENT_MUTATION);
    const [cancelPayment, cancelPaymentState] = useMutation<{ cancelPayment: OrderOperationResult }>(
        CANCEL_PAYMENT_MUTATION,
    );
    const [settleRefund, settleRefundState] = useMutation<{ settleRefund: OrderOperationResult }>(
        SETTLE_REFUND_MUTATION,
    );
    const order = query.data?.order;
    const loadingAction =
        addManualState.loading ||
        settlePaymentState.loading ||
        transitionPaymentState.loading ||
        cancelPaymentState.loading ||
        settleRefundState.loading;

    if (!orderId) return null;
    if (query.loading && !order) return <State label="正在读取支付操作、优惠券和子订单…" />;
    if (query.error || !order)
        return <State tone="error" label="订单经营明细加载失败" action={() => void query.refetch()} />;

    const paid = order.payments
        .filter(payment => !['Cancelled', 'Declined', 'Error'].includes(payment.state))
        .reduce((sum, payment) => sum + payment.amount, 0);
    const outstanding = Math.max(0, order.totalWithTax - paid);
    const execute = async (password: string) => {
        if (!action) return;
        setError('');
        try {
            let result: OrderOperationResult | undefined;
            if (action.kind === 'manual') {
                const response = await addManual({
                    variables: {
                        input: {
                            orderId,
                            method: required(action.method, '支付方式'),
                            transactionId: required(action.transactionId, '交易号'),
                            metadata: {},
                        },
                    },
                    context: sensitiveActionContext(password),
                });
                result = response.data?.addManualPaymentToOrder;
            } else if (action.kind === 'settle-payment') {
                result = (
                    await settlePayment({
                        variables: { id: action.payment.id },
                        context: sensitiveActionContext(password),
                    })
                ).data?.settlePayment;
            } else if (action.kind === 'cancel-payment') {
                result = (
                    await cancelPayment({
                        variables: { id: action.payment.id },
                        context: sensitiveActionContext(password),
                    })
                ).data?.cancelPayment;
            } else if (action.kind === 'transition-payment') {
                result = (
                    await transitionPayment({
                        variables: { id: action.payment.id, state: action.state },
                        context: sensitiveActionContext(password),
                    })
                ).data?.transitionPaymentToState;
            } else {
                result = (
                    await settleRefund({
                        variables: {
                            input: {
                                id: action.refundId,
                                transactionId: required(action.transactionId, '退款交易号'),
                            },
                        },
                        context: sensitiveActionContext(password),
                    })
                ).data?.settleRefund;
            }
            if (!result || !['Order', 'Payment', 'Refund'].includes(result.__typename))
                throw new Error(result?.message || '后端拒绝了支付操作');
            setNotice(actionLabel(action));
            setAction(null);
            setManualOpen(false);
            setRefundEditor(null);
            await query.refetch();
        } catch (cause) {
            setError(toUserFacingError(cause, '支付操作失败，订单未显示为成功'));
        }
    };

    return (
        <div className="space-y-4">
            {notice && <Notice tone="success" message={notice} />}
            {error && !action && <Notice tone="error" message={error} />}
            <section className={sectionClass}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <Heading
                        icon={<CreditCard className="h-4 w-4 text-blue-600" />}
                        title="支付操作与退款结算"
                        detail="手工支付、支付状态转换与退款结算均要求当前管理员密码，并以后端返回实体作为成功依据。"
                    />
                    {canUpdate && canReadPaymentMethods && canAddManualPayment(order.state, outstanding) && (
                        <button type="button" onClick={() => setManualOpen(true)} className={primaryButton}>
                            <Plus className="h-4 w-4" />
                            手工添加支付
                        </button>
                    )}
                </div>
                <div className="mt-4 space-y-3">
                    {order.payments.map(payment => (
                        <PaymentCard
                            key={payment.id}
                            payment={payment}
                            currencyCode={order.currencyCode}
                            canOperate={canUpdate}
                            onAction={setAction}
                            onSettleRefund={refundId => setRefundEditor({ refundId })}
                        />
                    ))}
                    {!order.payments.length && (
                        <p className="rounded-lg border border-dashed p-6 text-center text-xs text-slate-500">
                            当前订单尚无支付记录，未结金额 {formatMoney(outstanding, order.currencyCode)}
                        </p>
                    )}
                </div>
            </section>
            {order.storeCouponAllocations.length > 0 && (
                <section className={sectionClass}>
                    <Heading
                        icon={<Ticket className="h-4 w-4 text-emerald-600" />}
                        title="用户优惠券分摊与退款"
                        detail="显示本订单锁定、核销、释放和退款的用户券金额。"
                    />
                    <div className="mt-4 space-y-2">
                        {order.storeCouponAllocations.map(allocation => (
                            <article
                                key={allocation.id}
                                className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3 text-xs sm:flex-row sm:items-center sm:justify-between"
                            >
                                <span>
                                    <strong>{allocation.campaignName}</strong>
                                    <small className="ml-2 rounded bg-slate-100 px-2 py-0.5">
                                        {couponStatus(allocation.status)}
                                    </small>
                                    <span className="mt-1 block text-[10px] text-slate-500">
                                        用户券 #{allocation.customerCouponId}
                                        {allocation.refundId ? ` · 退款 #${allocation.refundId}` : ''}
                                    </span>
                                </span>
                                <span className="sm:text-right">
                                    <b className="text-emerald-700">
                                        -
                                        {formatMoney(
                                            allocation.discountAmountWithTax,
                                            allocation.currencyCode,
                                        )}
                                    </b>
                                    {allocation.refundedAmount > 0 && (
                                        <small className="block text-slate-500">
                                            已退款{' '}
                                            {formatMoney(allocation.refundedAmount, allocation.currencyCode)}
                                        </small>
                                    )}
                                </span>
                            </article>
                        ))}
                    </div>
                </section>
            )}
            {(order.sellerOrders?.length ?? 0) > 0 && (
                <section className={sectionClass}>
                    <Heading
                        icon={<Store className="h-4 w-4 text-violet-600" />}
                        title="多商家子订单"
                        detail="聚合订单按商家拆分后的真实子订单，可进入统一订单详情继续处理。"
                    />
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                        {order.sellerOrders?.map(sellerOrder => (
                            <article
                                key={sellerOrder.id}
                                className="rounded-lg border border-slate-200 p-4 text-xs"
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <strong>{sellerOrder.code}</strong>
                                    <b>{formatMoney(sellerOrder.totalWithTax, sellerOrder.currencyCode)}</b>
                                </div>
                                <p className="mt-2 text-slate-500">
                                    {sellerOrder.channels
                                        .map(channel => channel.seller?.name ?? channel.code)
                                        .join('、')}{' '}
                                    · {sellerOrder.state}
                                </p>
                                <Link
                                    to={`/sales/orders/${sellerOrder.id}`}
                                    className="mt-3 inline-block font-bold text-blue-600 hover:underline"
                                >
                                    查看子订单详情
                                </Link>
                            </article>
                        ))}
                    </div>
                </section>
            )}
            {manualOpen && (
                <ManualPaymentEditor
                    methods={paymentMethodsQuery.data?.paymentMethods.items ?? []}
                    outstanding={outstanding}
                    currencyCode={order.currencyCode}
                    onClose={() => setManualOpen(false)}
                    onNext={(method, transactionId) => setAction({ kind: 'manual', method, transactionId })}
                />
            )}
            {refundEditor && (
                <RefundSettlementEditor
                    refundId={refundEditor.refundId}
                    onClose={() => setRefundEditor(null)}
                    onNext={transactionId =>
                        setAction({ kind: 'settle-refund', refundId: refundEditor.refundId, transactionId })
                    }
                />
            )}
            <SensitiveActionDialog
                open={action !== null}
                title="确认资金操作"
                description="该操作会改变真实支付或退款状态。后端将校验当前管理员密码，失败时页面不会伪造成功状态。"
                confirmLabel="验证并执行"
                loading={loadingAction}
                error={error}
                onClose={() => {
                    if (!loadingAction) {
                        setAction(null);
                        setError('');
                    }
                }}
                onConfirm={execute}
            />
        </div>
    );
}

function PaymentCard({
    payment,
    currencyCode,
    canOperate,
    onAction,
    onSettleRefund,
}: {
    payment: OrderOperationPayment;
    currencyCode: string;
    canOperate: boolean;
    onAction: (action: ProtectedAction) => void;
    onSettleRefund: (refundId: string) => void;
}) {
    const otherStates = payment.nextStates.filter(state => !['Settled', 'Error'].includes(state));
    return (
        <article className="rounded-xl border border-slate-200 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <span>
                    <strong className="text-sm">{payment.method}</strong>
                    <small className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-[10px]">
                        {getPaymentStateLabel(payment.state)}
                    </small>
                    <span className="mt-1 block font-mono text-[10px] text-slate-500">
                        {payment.transactionId ?? '无交易号'} · {formatDateTime(payment.createdAt)}
                    </span>
                    {payment.errorMessage && (
                        <span className="mt-1 block text-xs text-rose-600">{payment.errorMessage}</span>
                    )}
                </span>
                <b>{formatMoney(payment.amount, currencyCode)}</b>
            </div>
            {payment.refunds.length > 0 && (
                <div className="mt-3 space-y-2 border-t pt-3">
                    {payment.refunds.map(refund => (
                        <div
                            key={refund.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-700"
                        >
                            <span>
                                <strong>退款 #{refund.id}</strong> · {getRefundStateLabel(refund.state)} ·{' '}
                                {refund.reason ?? '无原因'}
                            </span>
                            <span>
                                <b>{formatMoney(refund.total, currencyCode)}</b>
                                {canOperate && refund.state === 'Pending' && (
                                    <button
                                        type="button"
                                        onClick={() => onSettleRefund(refund.id)}
                                        className="ml-3 font-bold underline"
                                    >
                                        结算退款
                                    </button>
                                )}
                            </span>
                        </div>
                    ))}
                </div>
            )}
            {canOperate && payment.nextStates.length > 0 && (
                <div className="mt-3 flex flex-wrap justify-end gap-2 border-t pt-3">
                    {payment.nextStates.includes('Settled') && (
                        <button
                            type="button"
                            onClick={() => onAction({ kind: 'settle-payment', payment })}
                            className={successButton}
                        >
                            结算支付
                        </button>
                    )}
                    {otherStates.map(state => (
                        <button
                            key={state}
                            type="button"
                            onClick={() =>
                                onAction(
                                    state === 'Cancelled'
                                        ? { kind: 'cancel-payment', payment }
                                        : { kind: 'transition-payment', payment, state },
                                )
                            }
                            className={secondaryButton}
                        >
                            {state === 'Cancelled' ? '取消支付' : `转为 ${getPaymentStateLabel(state)}`}
                        </button>
                    ))}
                </div>
            )}
        </article>
    );
}
function ManualPaymentEditor({
    methods,
    outstanding,
    currencyCode,
    onClose,
    onNext,
}: {
    methods: Array<{ code: string; name: string }>;
    outstanding: number;
    currencyCode: string;
    onClose: () => void;
    onNext: (method: string, transactionId: string) => void;
}) {
    const [method, setMethod] = useState(methods[0]?.code ?? '');
    const [transactionId, setTransactionId] = useState('');
    return (
        <Editor
            title="手工添加支付"
            onClose={onClose}
            onNext={() => onNext(method, transactionId)}
            nextDisabled={!method || !transactionId.trim()}
        >
            <p className="rounded-lg bg-blue-50 p-3 text-xs text-blue-800">
                将按后端订单未结金额添加：<strong>{formatMoney(outstanding, currencyCode)}</strong>
            </p>
            <label className={labelClass}>
                支付方式
                <select
                    value={method}
                    onChange={event => setMethod(event.target.value)}
                    className={inputClass}
                >
                    <option value="">请选择</option>
                    {methods.map(item => (
                        <option key={item.code} value={item.code}>
                            {item.name} ({item.code})
                        </option>
                    ))}
                </select>
            </label>
            <label className={labelClass}>
                真实交易号
                <input
                    value={transactionId}
                    onChange={event => setTransactionId(event.target.value)}
                    className={`${inputClass} font-mono`}
                />
            </label>
        </Editor>
    );
}
function RefundSettlementEditor({
    refundId,
    onClose,
    onNext,
}: {
    refundId: string;
    onClose: () => void;
    onNext: (transactionId: string) => void;
}) {
    const [transactionId, setTransactionId] = useState('');
    return (
        <Editor
            title={`结算退款 #${refundId}`}
            onClose={onClose}
            onNext={() => onNext(transactionId)}
            nextDisabled={!transactionId.trim()}
        >
            <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                仅在支付渠道已经确认退款成功后填写真实退款交易号。
            </p>
            <label className={labelClass}>
                退款交易号
                <input
                    value={transactionId}
                    onChange={event => setTransactionId(event.target.value)}
                    className={`${inputClass} font-mono`}
                />
            </label>
        </Editor>
    );
}
function Editor({
    title,
    children,
    onClose,
    onNext,
    nextDisabled,
}: {
    title: string;
    children: React.ReactNode;
    onClose: () => void;
    onNext: () => void;
    nextDisabled: boolean;
}) {
    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4">
            <AccessibleDialogSurface
                accessibleName={title}
                onRequestClose={onClose}
                className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
            >
                <div className="flex items-center justify-between">
                    <h2 className="text-base font-bold">{title}</h2>
                    <button type="button" onClick={onClose} aria-label="关闭">
                        <X className="h-4 w-4" />
                    </button>
                </div>
                <div className="mt-5 space-y-4">{children}</div>
                <div className="mt-6 flex justify-end gap-2 border-t pt-4">
                    <button type="button" onClick={onClose} className={secondaryButton}>
                        取消
                    </button>
                    <button type="button" onClick={onNext} disabled={nextDisabled} className={primaryButton}>
                        <ShieldCheck className="h-4 w-4" />
                        下一步验证密码
                    </button>
                </div>
            </AccessibleDialogSurface>
        </div>
    );
}
function actionLabel(action: ProtectedAction) {
    return (
        {
            manual: '手工支付已添加',
            'settle-payment': '支付已结算',
            'transition-payment': '支付状态已转换',
            'cancel-payment': '支付已取消',
            'settle-refund': '退款已结算',
        } as Record<ProtectedAction['kind'], string>
    )[action.kind];
}
function couponStatus(value: string) {
    return (
        (
            { LOCKED: '已锁定', USED: '已核销', RELEASED: '已释放', REFUNDED: '已退款' } as Record<
                string,
                string
            >
        )[value] ?? value
    );
}
function required(value: string, label: string) {
    const clean = value.trim();
    if (!clean) throw new Error(`${label}不能为空`);
    return clean;
}
const entityId = (value: unknown) =>
    typeof value === 'string' || typeof value === 'number' ? String(value) : '';
function Heading({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
    return (
        <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                {icon}
                {title}
            </h2>
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
            className={`rounded-xl border p-6 text-center text-sm ${tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-slate-200 bg-white text-slate-500'}`}
        >
            <p>{label}</p>
            {action && (
                <button
                    type="button"
                    onClick={action}
                    className="mt-3 inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold"
                >
                    <RefreshCw className="h-4 w-4" />
                    重试
                </button>
            )}
        </div>
    );
}
const sectionClass = 'rounded-xl border border-slate-200 bg-white p-5 shadow-2xs';
const labelClass = 'block text-xs font-bold text-slate-700';
const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal';
const primaryButton =
    'inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-40';
const successButton =
    'inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white';
const secondaryButton =
    'inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700';
