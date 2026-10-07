import { useMutation } from '@apollo/client/react';
import { CreditCard, Plus, RefreshCw, ShieldCheck, Store, Ticket, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getSystemLabel, serviceMessageDisplay } from '../../../../common/src/display-localization';
import { AdminButton, AdminInput, AdminSelect, AdminTextArea } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { useAdminQuery as useQuery } from '../../hooks/use-admin-query';

import { sensitiveActionContext } from '../../apollo';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { SensitiveActionDialog } from '../../components/SensitiveActionDialog';
import type { NextAdminPageBlockContext } from '../../extensions/extension-api';
import {
    ADD_MANUAL_PAYMENT_MUTATION,
    CANCEL_PAYMENT_MUTATION,
    ORDER_OPERATIONS_QUERY,
    PAYMENT_METHODS_FOR_MANUAL_QUERY,
    RECORD_MANUAL_REFUND_MUTATION,
    RETRY_REFUND_MUTATION,
    SETTLE_PAYMENT_MUTATION,
    TRANSITION_PAYMENT_MUTATION,
    type OrderOperationPayment,
    type OrderOperationResult,
    type OrderOperationsData,
    type PaymentMethodsForManualData,
} from '../../graphql/order-operations.graphql';
import { useAdminCapabilities } from '../../hooks/use-admin-capabilities';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { refreshAfterAdminWrite } from '../../utils/admin-write-readback';
import { getChannelDisplayName } from '../../utils/channel-display';
import { toUserFacingError } from '../../utils/user-facing-error';
import { canAddManualPayment } from './order-operation-availability';
import {
    canManageOrderInChannel,
    formatDateTime,
    formatMoney,
    getOrderStateLabel,
    getPaymentMethodLabel,
    getPaymentStateLabel,
    getRefundStateLabel,
    isSimulatedPayment,
} from './sales-utils';

type ProtectedAction =
    | { kind: 'manual'; method: string; transactionId: string }
    | { kind: 'settle-payment'; payment: OrderOperationPayment }
    | { kind: 'transition-payment'; payment: OrderOperationPayment; state: string }
    | { kind: 'cancel-payment'; payment: OrderOperationPayment }
    | { kind: 'retry-refund'; refundId: string; idempotencyKey: string }
    | {
          kind: 'manual-refund';
          refundId: string;
          transactionId: string;
          evidenceReference: string;
          note: string;
      };

export function OrderOperationsBlock({ context }: { context: NextAdminPageBlockContext }) {
    const orderId = entityId(context.entity?.id);
    const { hasAnyPermission } = useAdminPermissions();
    const canReadPaymentMethods = hasAnyPermission(['ReadSettings', 'ReadPaymentMethod']);
    const query = useQuery<OrderOperationsData>(ORDER_OPERATIONS_QUERY, {
        variables: { id: orderId },
        skip: !orderId,
    });
    const canUpdate =
        hasAnyPermission(['UpdateOrder']) &&
        Boolean(query.data?.order?.processingSummary?.canManage) &&
        canManageOrderInChannel(query.data?.order, query.data?.activeChannel?.id);
    const canRetryRefund = canUpdate && hasAnyPermission(['SensitiveStoreFinance']);
    const refundRetryAttempts = useRef(new Map<string, string>());
    const paymentMethodsQuery = useQuery<PaymentMethodsForManualData>(PAYMENT_METHODS_FOR_MANUAL_QUERY, {
        skip: !canUpdate || !canReadPaymentMethods,
    });
    const [action, setAction] = useState<ProtectedAction | null>(null);
    const [manualOpen, setManualOpen] = useState(false);
    const [refundEditor, setRefundEditor] = useState<{ refundId: string } | null>(null);
    const [notice, setNotice] = useState('');
    const [noticeTone, setNoticeTone] = useState<'success' | 'error'>('success');
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
    const [recordManualRefund, settleRefundState] = useMutation<{ recordManualRefund: OrderOperationResult }>(
        RECORD_MANUAL_REFUND_MUTATION,
    );
    const [retryRefund, retryRefundState] = useMutation<{ retryRefund: OrderOperationResult }>(
        RETRY_REFUND_MUTATION,
    );
    const order = query.data?.order;
    const loadingAction =
        addManualState.loading ||
        settlePaymentState.loading ||
        transitionPaymentState.loading ||
        cancelPaymentState.loading ||
        settleRefundState.loading ||
        retryRefundState.loading;

    if (!orderId) return null;
    if (query.loading && !order) return <State label="正在读取支付操作、优惠券和子订单…" />;
    if ((query.error && !query.data) || !order)
        return <State tone="error" label="订单经营明细加载失败" action={() => void query.refetch()} />;

    const outstanding = order.processingSummary?.outstandingAmount ?? 0;
    const execute = async (password: string) => {
        if (!action || loadingAction) return;
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
                if (
                    action.payment.state === 'Settled' ||
                    !order.processingSummary?.paymentCapabilities.some(
                        item => item.paymentId === action.payment.id && item.canCancel,
                    )
                )
                    throw new Error('该笔支付不能取消，请按真实资金状态处理退款');
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
            } else if (action.kind === 'retry-refund') {
                const payment = order.payments.find(item =>
                    item.refunds.some(refund => refund.id === action.refundId),
                );
                if (
                    !canRetryRefund ||
                    !payment ||
                    order.processingSummary?.isTestOrder ||
                    isSimulatedPayment(payment.method)
                )
                    throw new Error('当前账号或订单不能重试真实退款');
                result = (
                    await retryRefund({
                        variables: {
                            input: { refundId: action.refundId, idempotencyKey: action.idempotencyKey },
                        },
                        context: sensitiveActionContext(password),
                    })
                ).data?.retryRefund;
                if (
                    result?.__typename !== 'Refund' ||
                    result.id !== action.refundId ||
                    !['Failed', 'Pending', 'Settled'].includes(result.state ?? '')
                )
                    throw new Error(result?.message || '后端未确认原退款的重试结果，重试将沿用同一请求编号');
                refundRetryAttempts.current.delete(action.refundId);
            } else {
                const payment = order.payments.find(item =>
                    item.refunds.some(refund => refund.id === action.refundId && refund.state === 'Pending'),
                );
                if (
                    !payment ||
                    order.processingSummary?.isTestOrder ||
                    isSimulatedPayment(payment.method) ||
                    order.processingSummary?.paymentCapabilities.find(item => item.paymentId === payment.id)
                        ?.refundSettlementMode !== 'manual'
                )
                    throw new Error('当前退款不能登记人工凭证，请按该支付渠道的核验流程处理');
                result = (
                    await recordManualRefund({
                        variables: {
                            input: {
                                refundId: action.refundId,
                                transactionId: required(action.transactionId, '退款交易号'),
                                evidenceReference: required(action.evidenceReference, '退款凭证'),
                                note: required(action.note, '核验说明'),
                            },
                        },
                        context: sensitiveActionContext(password),
                    })
                ).data?.recordManualRefund;
            }
            if (!result || !['Order', 'Payment', 'Refund'].includes(result.__typename))
                throw new Error(result?.message || '后端拒绝了支付操作');
            setNoticeTone(action.kind === 'retry-refund' && result.state === 'Failed' ? 'error' : 'success');
            setNotice(
                action.kind === 'retry-refund'
                    ? `原退款重试结果：${getRefundStateLabel(result.state ?? '')}；资金结果以渠道回执或专用核验记录为准`
                    : actionLabel(action),
            );
            setAction(null);
            setManualOpen(false);
            setRefundEditor(null);
            await refreshAfterAdminWrite(() => query.refetch(), setError);
        } catch (cause) {
            setError(toUserFacingError(cause, '支付操作失败，订单未显示为成功'));
        }
    };

    return (
        <div className="space-y-4">
            {notice && <Notice tone={noticeTone} message={notice} />}
            {error && !action && <Notice tone="error" message={error} />}
            <section className={sectionClass}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <Heading
                        icon={<CreditCard className="h-4 w-4 text-blue-600" />}
                        title="支付与退款"
                        detail="在此查看付款、处理退款；资金操作需验证管理员密码。"
                    />
                    {canUpdate && canReadPaymentMethods && canAddManualPayment(order.state, outstanding) && (
                        <AdminButton
                            type="button"
                            onClick={() => setManualOpen(true)}
                            className={primaryButton}
                        >
                            <Plus className="h-4 w-4" />
                            手工添加支付
                        </AdminButton>
                    )}
                </div>
                {canUpdate && !canReadPaymentMethods && canAddManualPayment(order.state, outstanding) && (
                    <Notice tone="error" message="登记补款需要读取支付方式的权限，请联系店铺负责人。" />
                )}
                <div className="mt-4 space-y-3">
                    {order.payments.map(payment => (
                        <PaymentCard
                            key={payment.id}
                            payment={payment}
                            methodName={
                                paymentMethodsQuery.data?.paymentMethods.items.find(
                                    method => method.code === payment.method,
                                )?.name
                            }
                            currencyCode={order.currencyCode}
                            canOperate={canUpdate}
                            canRetryRefund={canRetryRefund}
                            refundAnchorPrefix={orderId}
                            canCancel={Boolean(
                                order.processingSummary?.paymentCapabilities.find(
                                    item => item.paymentId === payment.id,
                                )?.canCancel,
                            )}
                            refundSettlementMode={
                                order.processingSummary?.paymentCapabilities.find(
                                    item => item.paymentId === payment.id,
                                )?.refundSettlementMode
                            }
                            isTestOrder={Boolean(order.processingSummary?.isTestOrder)}
                            onAction={setAction}
                            onSettleRefund={refundId => setRefundEditor({ refundId })}
                            onRetryRefund={refundId => {
                                const key = refundRetryAttempts.current.get(refundId) ?? crypto.randomUUID();
                                refundRetryAttempts.current.set(refundId, key);
                                setError('');
                                setAction({ kind: 'retry-refund', refundId, idempotencyKey: key });
                            }}
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
                <details className={sectionClass}>
                    <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-900">
                        <Ticket className="h-4 w-4 text-emerald-600" />
                        优惠券使用与退回记录 · {order.storeCouponAllocations.length} 条
                    </summary>
                    <p className="mt-2 text-xs text-slate-500">查看优惠券锁定、核销、释放及退款记录。</p>
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
                </details>
            )}
            {(order.sellerOrders?.length ?? 0) > 0 && (
                <details className={sectionClass}>
                    <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-900">
                        <Store className="h-4 w-4 text-violet-600" />
                        商家子订单 · {order.sellerOrders?.length} 笔
                    </summary>
                    <p className="mt-2 text-xs text-slate-500">查看本单各商家的商品、交付和资金记录。</p>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                        {order.sellerOrders?.map(sellerOrder => (
                            <article
                                key={sellerOrder.id}
                                className="rounded-lg border border-slate-200 p-4 text-xs"
                            >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <strong>{sellerOrder.code}</strong>
                                    <b>{formatMoney(sellerOrder.totalWithTax, sellerOrder.currencyCode)}</b>
                                </div>
                                <p className="mt-2 text-slate-500">
                                    {sellerOrder.salesChannel
                                        ? getChannelDisplayName(sellerOrder.salesChannel)
                                        : '归属待核实'}{' '}
                                    · {getOrderStateLabel(sellerOrder.state)}
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
                </details>
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
                    onNext={(transactionId, evidenceReference, note) =>
                        setAction({
                            kind: 'manual-refund',
                            refundId: refundEditor.refundId,
                            transactionId,
                            evidenceReference,
                            note,
                        })
                    }
                />
            )}
            <SensitiveActionDialog
                open={action !== null}
                title="确认资金操作"
                description={
                    action?.kind === 'retry-refund'
                        ? `重试原退款 #${action.refundId}，沿用原金额、用途和明细。网络结果未知时重试沿用同一请求编号；后端将校验当前管理员密码。`
                        : '该操作会改变真实支付或退款状态。后端将校验当前管理员密码，失败时页面不会伪造成功状态。'
                }
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

export function PaymentCard({
    payment,
    methodName,
    currencyCode,
    canOperate,
    onAction,
    onSettleRefund,
    canCancel,
    refundSettlementMode,
    isTestOrder,
    canRetryRefund = false,
    onRetryRefund,
    refundAnchorPrefix = '',
}: {
    payment: OrderOperationPayment;
    methodName?: string;
    currencyCode: string;
    canOperate: boolean;
    onAction: (action: ProtectedAction) => void;
    onSettleRefund: (refundId: string) => void;
    canCancel: boolean;
    refundSettlementMode?: string;
    isTestOrder: boolean;
    canRetryRefund?: boolean;
    onRetryRefund?: (refundId: string) => void;
    refundAnchorPrefix?: string;
}) {
    const { canAccessPath, snapshot } = useAdminCapabilities();
    const refundPath =
        snapshot?.scope === 'PLATFORM'
            ? '/settings/usdt-payments/refunds'
            : '/settings/store-profile/usdt-refunds';
    const canCancelPayment =
        canCancel && payment.state !== 'Settled' && payment.nextStates.includes('Cancelled');
    const simulated = isTestOrder || isSimulatedPayment(payment.method);
    return (
        <article className="grid min-w-0 gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                    <strong className="break-words text-sm">
                        {getPaymentMethodLabel(payment.method, methodName)}
                    </strong>
                    <small className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-[10px]">
                        {getPaymentStateLabel(payment.state)}
                    </small>
                    <span className="mt-1 block text-[11px] text-slate-500">
                        付款时间：{formatDateTime(payment.createdAt)}
                    </span>
                    <details className="mt-1 text-[11px] text-slate-500">
                        <summary className="w-fit cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-blue-500">
                            交易详情
                        </summary>
                        <dl className="mt-2 space-y-1 break-all">
                            <div>
                                <dt className="inline">支付方式编号：</dt>
                                <dd className="inline font-mono">{payment.method}</dd>
                            </div>
                            <div>
                                <dt className="inline">交易流水号：</dt>
                                <dd className="inline font-mono">{payment.transactionId || '无交易号'}</dd>
                            </div>
                        </dl>
                    </details>
                    {payment.errorMessage && (
                        <span className="mt-1 block text-xs text-rose-600">
                            {serviceMessageDisplay(payment.errorMessage, 'zh')}
                        </span>
                    )}
                </div>
                <b className="shrink-0 whitespace-nowrap text-sm tabular-nums">
                    {formatMoney(payment.amount, currencyCode)}
                </b>
            </div>
            {payment.refunds.length > 0 && (
                <div className="order-last space-y-2 border-t border-slate-200 pt-3 sm:col-span-2">
                    {payment.refunds.map(refund => (
                        <div
                            key={refund.id}
                            id={`order-refund-${refundAnchorPrefix}-${refund.id}`}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-700"
                        >
                            <span>
                                <strong>退款 #{refund.id}</strong> · {getRefundStateLabel(refund.state)} ·{' '}
                                {refund.reason ?? '无原因'}
                            </span>
                            <span>
                                <b>{formatMoney(refund.total, currencyCode)}</b>
                                {canOperate &&
                                    refund.state === 'Failed' &&
                                    !simulated &&
                                    canRetryRefund &&
                                    onRetryRefund &&
                                    ['automatic', 'manual', 'verified-external'].includes(
                                        refundSettlementMode ?? '',
                                    ) && (
                                        <AdminButton
                                            type="button"
                                            onClick={() => onRetryRefund(refund.id)}
                                            className="ml-3 font-bold underline"
                                        >
                                            重试原退款
                                        </AdminButton>
                                    )}
                                {refund.state === 'Failed' && (
                                    <small className="ml-3">退款失败，资金结果仍需核实</small>
                                )}
                                {canOperate &&
                                    !simulated &&
                                    refund.state === 'Pending' &&
                                    refundSettlementMode === 'manual' && (
                                        <AdminButton
                                            type="button"
                                            onClick={() => onSettleRefund(refund.id)}
                                            className="ml-3 font-bold underline"
                                        >
                                            登记人工退款凭证
                                        </AdminButton>
                                    )}
                                {refund.state === 'Pending' &&
                                    !simulated &&
                                    refundSettlementMode === 'verified-external' &&
                                    canAccessPath(refundPath) && (
                                        <Link to={refundPath} className="ml-3 font-semibold underline">
                                            进入专用退款核验
                                        </Link>
                                    )}
                                {refund.state === 'Pending' &&
                                    !simulated &&
                                    refundSettlementMode === 'automatic' && (
                                        <small className="ml-3">等待支付渠道退款回执</small>
                                    )}
                                {refund.state === 'Pending' &&
                                    (simulated ||
                                        !refundSettlementMode ||
                                        refundSettlementMode === 'unsupported') && (
                                        <small className="ml-3">退款结果待核实，不能手工标记成功</small>
                                    )}
                            </span>
                        </div>
                    ))}
                </div>
            )}
            {canOperate && payment.nextStates.length > 0 && (
                <div className="flex flex-wrap items-start justify-end gap-2 sm:self-start">
                    {payment.state === 'Authorized' && payment.nextStates.includes('Settled') && (
                        <AdminButton
                            type="button"
                            onClick={() => onAction({ kind: 'settle-payment', payment })}
                            className={successButton}
                        >
                            结算支付
                        </AdminButton>
                    )}
                    {canCancelPayment && (
                        <AdminButton
                            type="button"
                            onClick={() => onAction({ kind: 'cancel-payment', payment })}
                            className={secondaryButton}
                        >
                            取消支付授权
                        </AdminButton>
                    )}
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
            <AdminField className={labelClass} label="支付方式">
                <AdminSelect
                    value={method}
                    onChange={event => setMethod(event.target.value)}
                    className={inputClass}
                >
                    <option value="">请选择</option>
                    {methods.map(item => (
                        <option key={item.code} value={item.code}>
                            {item.name}
                        </option>
                    ))}
                </AdminSelect>
            </AdminField>
            <AdminField className={labelClass} label="真实交易号">
                <AdminInput
                    value={transactionId}
                    onChange={event => setTransactionId(event.target.value)}
                    className={`${inputClass} font-mono`}
                />
            </AdminField>
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
    onNext: (transactionId: string, evidenceReference: string, note: string) => void;
}) {
    const [transactionId, setTransactionId] = useState('');
    const [evidenceReference, setEvidenceReference] = useState('');
    const [note, setNote] = useState('');
    return (
        <Editor
            title={`登记人工退款凭证 #${refundId}`}
            onClose={onClose}
            onNext={() => onNext(transactionId, evidenceReference, note)}
            nextDisabled={!transactionId.trim() || !evidenceReference.trim() || !note.trim()}
        >
            <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                仅在支付渠道已经确认退款成功后填写真实退款交易号。
            </p>
            <AdminField className={labelClass} label={<>退款交易号</>}>
                {' '}
                <AdminInput
                    value={transactionId}
                    onChange={event => setTransactionId(event.target.value)}
                    className={`${inputClass} font-mono`}
                />
            </AdminField>
            <AdminField className={labelClass} label={<>退款凭证编号或地址</>}>
                {' '}
                <AdminInput
                    value={evidenceReference}
                    onChange={event => setEvidenceReference(event.target.value)}
                    className={inputClass}
                />
            </AdminField>
            <AdminField className={labelClass} label={<>核验说明</>}>
                {' '}
                <AdminTextArea
                    value={note}
                    onChange={event => setNote(event.target.value)}
                    className={inputClass}
                    rows={3}
                />
            </AdminField>
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
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-base font-bold">{title}</h2>
                    <AdminButton type="button" onClick={onClose} aria-label="关闭">
                        <X className="h-4 w-4" />
                    </AdminButton>
                </div>
                <div className="mt-5 space-y-4">{children}</div>
                <div className="mt-6 flex justify-end gap-2 border-t pt-4">
                    <AdminButton type="button" onClick={onClose} className={secondaryButton}>
                        取消
                    </AdminButton>
                    <AdminButton
                        type="button"
                        onClick={onNext}
                        disabled={nextDisabled}
                        className={primaryButton}
                    >
                        <ShieldCheck className="h-4 w-4" />
                        下一步验证密码
                    </AdminButton>
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
            'manual-refund': '人工退款凭证已登记，结果以核验记录为准',
            'retry-refund': '原退款重试结果待核实',
        } as Record<ProtectedAction['kind'], string>
    )[action.kind];
}
function couponStatus(value: string) {
    return getSystemLabel(
        value,
        { LOCKED: '已锁定', USED: '已核销', RELEASED: '已释放', REFUNDED: '已退款' } as Record<
            string,
            string
        >,
        'zh',
        'status',
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
                <FeatureHelpButton topic="sales.payment" title={title} description={detail} />
            </h2>
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
                <AdminButton
                    type="button"
                    onClick={action}
                    className="mt-3 inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold"
                >
                    <RefreshCw className="h-4 w-4" />
                    重试
                </AdminButton>
            )}
        </div>
    );
}
const sectionClass = 'min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs';
const labelClass = 'block text-xs font-bold text-slate-700';
const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal';
const primaryButton =
    'inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-40';
const successButton =
    'inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white';
const secondaryButton =
    'inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700';
