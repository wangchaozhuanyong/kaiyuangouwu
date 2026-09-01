import { useMutation, useQuery } from '@apollo/client/react';
import {
    AlertCircle,
    ArrowLeft,
    Check,
    CheckCircle2,
    Clock3,
    CreditCard,
    FileText,
    Image as ImageIcon,
    MapPin,
    MessageSquare,
    PackageCheck,
    PencilLine,
    Printer,
    RefreshCw,
    RotateCcw,
    Send,
    Store,
    Truck,
    User,
    X,
    XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { sensitiveActionContext } from '../../apollo';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { DynamicCustomFieldsForm } from '../../custom-fields/DynamicCustomFieldsForm';
import type { CustomFieldValueMap } from '../../custom-fields/custom-field-types';
import {
    addCustomFieldsToDocument,
    customFieldInputFromValues,
    customFieldValuesFromEntity,
    validateCustomFieldValues,
} from '../../custom-fields/custom-field-utils';
import { useCustomFieldDefinitions } from '../../custom-fields/custom-fields-context';
import { NextAdminActions, NextAdminPageBlocks } from '../../extensions/extension-hosts';
import {
    ADD_ORDER_FULFILLMENT,
    ADD_SALES_ORDER_NOTE,
    CANCEL_SALES_ORDER,
    GET_SALES_ORDER,
    REFUND_SALES_ORDER,
    SET_SALES_ORDER_CUSTOM_FIELDS,
    TRANSITION_SALES_FULFILLMENT,
    TRANSITION_SALES_ORDER,
} from '../../graphql/sales.graphql';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { getChannelDisplayName } from '../../utils/channel-display';
import { toUserFacingError } from '../../utils/user-facing-error';
import {
    formatAddress,
    formatDateTime,
    formatMoney,
    getCustomerName,
    getFulfillmentStateLabel,
    getMutationError,
    getOrderStateClass,
    getOrderStateLabel,
    getPaymentStateLabel,
    getRefundStateLabel,
    getRemainingPhysicalLines,
    majorInputToMoney,
    moneyToMajorInput,
} from './sales-utils';

interface OrderLineItem {
    id: string;
    quantity: number;
    unitPriceWithTax: number;
    proratedUnitPriceWithTax: number;
    linePriceWithTax: number;
    discountedLinePriceWithTax: number;
    featuredAsset?: { id: string; name?: string | null; preview: string } | null;
    productVariant: {
        id: string;
        name: string;
        sku: string;
        customFields?: { fulfillmentType?: string | null; digitalDeliveryMode?: string | null } | null;
    };
    customFields?: {
        fulfillmentTypeSnapshot?: string | null;
        digitalDeliveryModeSnapshot?: string | null;
    } | null;
}

interface RefundItem {
    id: string;
    state: string;
    total: number;
    reason?: string | null;
    transactionId?: string | null;
}

interface PaymentItem {
    id: string;
    state: string;
    method: string;
    transactionId?: string | null;
    amount: number;
    refunds: RefundItem[];
}

interface FulfillmentItem {
    id: string;
    state: string;
    nextStates: string[];
    handlerCode: string;
    method: string;
    trackingCode?: string | null;
    lines: Array<{ orderLineId: string; quantity: number }>;
}

interface HistoryItem {
    id: string;
    type: string;
    createdAt: string;
    isPublic: boolean;
    administrator?: { id: string; firstName?: string | null; lastName?: string | null } | null;
    data: Record<string, unknown>;
}

interface SalesOrderDetail {
    id: string;
    createdAt: string;
    orderPlacedAt?: string | null;
    code: string;
    state: string;
    nextStates: string[];
    active: boolean;
    totalQuantity: number;
    subTotalWithTax: number;
    shippingWithTax: number;
    totalWithTax: number;
    currencyCode: string;
    couponCodes: string[];
    customFields?: Record<string, unknown> | null;
    discounts: Array<{ description: string; amountWithTax: number }>;
    customer?: {
        id: string;
        firstName?: string | null;
        lastName?: string | null;
        emailAddress: string;
        phoneNumber?: string | null;
    } | null;
    shippingAddress?: AddressItem | null;
    billingAddress?: AddressItem | null;
    channels: Array<{ id: string; code: string; token: string }>;
    shippingLines: Array<{
        id: string;
        discountedPriceWithTax: number;
        shippingMethod: { id: string; code: string; name: string; fulfillmentHandlerCode: string };
    }>;
    lines: OrderLineItem[];
    fulfillments?: FulfillmentItem[] | null;
    payments?: PaymentItem[] | null;
    history: { items: HistoryItem[]; totalItems: number };
}

interface AddressItem {
    fullName?: string | null;
    company?: string | null;
    streetLine1?: string | null;
    streetLine2?: string | null;
    city?: string | null;
    province?: string | null;
    postalCode?: string | null;
    country?: string | null;
    countryCode?: string | null;
    phoneNumber?: string | null;
}

interface OrderQueryData {
    order?: SalesOrderDetail | null;
    fulfillmentHandlers: Array<{
        code: string;
        args: Array<{ name: string; type: string; required: boolean }>;
    }>;
}

interface ResultPayload {
    __typename: string;
    id?: string;
    state?: string;
    nextStates?: string[];
    errorCode?: string;
    message?: string;
    transitionError?: string;
}

interface RefundResultPayload extends ResultPayload {
    total?: number;
    transactionId?: string | null;
}

const refundCountsAgainstPayment = (refund: RefundItem) => !['Failed', 'Cancelled'].includes(refund.state);

const historyLabel = (entry: HistoryItem) => {
    if (entry.type === 'ORDER_STATE_TRANSITION')
        return `订单状态：${String(entry.data.from ?? '')} → ${String(entry.data.to ?? '')}`;
    if (entry.type === 'ORDER_PAYMENT_TRANSITION')
        return `支付状态：${String(entry.data.from ?? '')} → ${String(entry.data.to ?? '')}`;
    if (entry.type === 'ORDER_FULFILLMENT_TRANSITION')
        return `履约状态：${String(entry.data.from ?? '')} → ${String(entry.data.to ?? '')}`;
    if (entry.type === 'ORDER_REFUND_TRANSITION')
        return `退款状态：${String(entry.data.from ?? '')} → ${String(entry.data.to ?? '')}`;
    if (entry.type === 'ORDER_CANCELLATION') return `订单取消：${String(entry.data.reason ?? '未填写原因')}`;
    if (entry.type === 'ORDER_FULFILLMENT') return '创建履约记录';
    return entry.type;
};

export function OrderEditor() {
    const navigate = useNavigate();
    const { id } = useParams<{ id: string }>();
    const { hasAnyPermission } = useAdminPermissions();
    const canUpdateOrder = hasAnyPermission(['UpdateOrder']);
    const orderCustomFieldDefinitions = useCustomFieldDefinitions('Order');
    const orderDetailDocument = useMemo(
        () => addCustomFieldsToDocument(GET_SALES_ORDER, 'Order', orderCustomFieldDefinitions, ['order']),
        [orderCustomFieldDefinitions],
    );
    const [orderCustomFieldValues, setOrderCustomFieldValues] = useState<CustomFieldValueMap>({});
    const [notification, setNotification] = useState('');
    const [actionError, setActionError] = useState('');
    const [newNote, setNewNote] = useState('');
    const [isFulfillOpen, setIsFulfillOpen] = useState(false);
    const [carrier, setCarrier] = useState('');
    const [trackingCode, setTrackingCode] = useState('');
    const [isRefundOpen, setIsRefundOpen] = useState(false);
    const [refundPaymentId, setRefundPaymentId] = useState('');
    const [refundAmount, setRefundAmount] = useState('');
    const [refundReason, setRefundReason] = useState('');
    const [refundCurrentPassword, setRefundCurrentPassword] = useState('');
    const [isCancelOpen, setIsCancelOpen] = useState(false);
    const [cancelReason, setCancelReason] = useState('');
    const [cancelCurrentPassword, setCancelCurrentPassword] = useState('');

    const { data, loading, error, refetch } = useQuery<OrderQueryData>(orderDetailDocument, {
        variables: { id },
        skip: !id,
        fetchPolicy: 'cache-and-network',
        notifyOnNetworkStatusChange: true,
    });
    const [addNote, { loading: addingNote }] = useMutation<{ addNoteToOrder: { id: string } }>(
        ADD_SALES_ORDER_NOTE,
    );
    const [addFulfillment, { loading: addingFulfillment }] = useMutation<{
        addFulfillmentToOrder: ResultPayload;
    }>(ADD_ORDER_FULFILLMENT);
    const [transitionFulfillment, { loading: transitioningFulfillment }] = useMutation<{
        transitionFulfillmentToState: ResultPayload;
    }>(TRANSITION_SALES_FULFILLMENT);
    const [refundOrder, { loading: refunding }] = useMutation<{ refundOrder: RefundResultPayload }>(
        REFUND_SALES_ORDER,
    );
    const [cancelOrder, { loading: cancelling }] = useMutation<{ cancelOrder: ResultPayload }>(
        CANCEL_SALES_ORDER,
    );
    const [transitionOrder, { loading: transitioningOrder }] = useMutation<{
        transitionOrderToState: ResultPayload | null;
    }>(TRANSITION_SALES_ORDER);
    const [setOrderCustomFields, { loading: savingCustomFields }] = useMutation<{
        setOrderCustomFields: { id: string; updatedAt: string } | null;
    }>(SET_SALES_ORDER_CUSTOM_FIELDS);

    const order = data?.order;
    /* oxlint-disable react/set-state-in-effect */
    useEffect(() => {
        if (!order) return;
        setOrderCustomFieldValues(
            customFieldValuesFromEntity(orderCustomFieldDefinitions, order.customFields),
        );
    }, [order, orderCustomFieldDefinitions]);
    /* oxlint-enable react/set-state-in-effect */
    const remainingPhysicalLines = order ? getRemainingPhysicalLines(order) : [];
    const manualHandlerAvailable =
        data?.fulfillmentHandlers.some(handler => handler.code === 'manual-fulfillment') ?? false;
    const paymentsWithBalances = useMemo(
        () =>
            (order?.payments ?? [])
                .map(payment => {
                    const refunded = payment.refunds
                        .filter(refundCountsAgainstPayment)
                        .reduce((sum, refund) => sum + refund.total, 0);
                    return { payment, remaining: Math.max(0, payment.amount - refunded) };
                })
                .filter(item => item.payment.state === 'Settled' && item.remaining > 0),
        [order],
    );
    const selectedPayment =
        paymentsWithBalances.find(item => item.payment.id === refundPaymentId) ?? paymentsWithBalances[0];
    const notes = order?.history.items.filter(entry => entry.type === 'ORDER_NOTE') ?? [];
    const timeline = order?.history.items.filter(entry => entry.type !== 'ORDER_NOTE').slice(0, 20) ?? [];
    const busy =
        addingNote ||
        addingFulfillment ||
        transitioningFulfillment ||
        transitioningOrder ||
        refunding ||
        cancelling;

    const showNotice = (message: string) => {
        setNotification(message);
        window.setTimeout(() => setNotification(''), 4000);
    };
    const refreshAfterMutation = async (message: string) => {
        await refetch();
        setActionError('');
        showNotice(message);
    };

    const handleAddNote = async () => {
        const note = newNote.trim();
        if (!order || !note) {
            setActionError('请输入内部备注内容');
            return;
        }
        try {
            await addNote({ variables: { input: { id: order.id, note, isPublic: false } } });
            setNewNote('');
            await refreshAfterMutation('内部备注已保存');
        } catch (mutationError) {
            setActionError(toUserFacingError(mutationError, '备注保存失败，请稍后重试'));
        }
    };

    const handleSaveCustomFields = async () => {
        if (!order) return;
        const errors = validateCustomFieldValues(orderCustomFieldDefinitions, orderCustomFieldValues);
        if (Object.keys(errors).length > 0) {
            setActionError(Object.values(errors)[0] ?? '扩展字段校验失败');
            return;
        }
        try {
            const response = await setOrderCustomFields({
                variables: {
                    input: {
                        id: order.id,
                        customFields: customFieldInputFromValues(
                            orderCustomFieldDefinitions,
                            orderCustomFieldValues,
                        ),
                    },
                },
            });
            if (!response.data?.setOrderCustomFields) {
                throw new Error('后端未返回更新后的订单');
            }
            await refreshAfterMutation('订单扩展字段已保存');
        } catch (mutationError) {
            setActionError(toUserFacingError(mutationError, '订单扩展字段保存失败'));
        }
    };

    const handleFulfill = async () => {
        if (!order || remainingPhysicalLines.length === 0) return;
        if (!manualHandlerAvailable) {
            setActionError('后端未启用 manual-fulfillment 处理器，无法创建实物发货');
            return;
        }
        if (!carrier.trim() || !trackingCode.trim()) {
            setActionError('物流公司和真实运单号均为必填项');
            return;
        }
        try {
            const created = await addFulfillment({
                variables: {
                    input: {
                        lines: remainingPhysicalLines,
                        handler: {
                            code: 'manual-fulfillment',
                            arguments: [
                                { name: 'method', value: carrier.trim() },
                                { name: 'trackingCode', value: trackingCode.trim() },
                            ],
                        },
                    },
                },
            });
            const createResult = created.data?.addFulfillmentToOrder;
            if (createResult?.__typename !== 'Fulfillment' || !createResult.id) {
                setActionError(getMutationError(createResult));
                return;
            }
            const transitioned = await transitionFulfillment({
                variables: { id: createResult.id, state: 'Shipped' },
            });
            const transitionResult = transitioned.data?.transitionFulfillmentToState;
            if (transitionResult?.__typename !== 'Fulfillment') {
                setActionError(`履约记录已创建，但未能标记为已发货：${getMutationError(transitionResult)}`);
                await refetch();
                return;
            }
            setIsFulfillOpen(false);
            setCarrier('');
            setTrackingCode('');
            await refreshAfterMutation(`已创建发货记录，运单号 ${trackingCode.trim()}`);
        } catch (mutationError) {
            setActionError(toUserFacingError(mutationError, '发货请求失败'));
        }
    };

    const handleFulfillmentDelivered = async (fulfillment: FulfillmentItem) => {
        try {
            const response = await transitionFulfillment({
                variables: { id: fulfillment.id, state: 'Delivered' },
            });
            const result = response.data?.transitionFulfillmentToState;
            if (result?.__typename !== 'Fulfillment') {
                setActionError(getMutationError(result));
                return;
            }
            await refreshAfterMutation('履约记录已标记为送达');
        } catch (mutationError) {
            setActionError(toUserFacingError(mutationError, '履约状态更新失败，请稍后重试'));
        }
    };

    const openRefund = () => {
        const first = paymentsWithBalances[0];
        if (!order || !first) {
            setActionError('当前订单没有可退款的已结算支付');
            return;
        }
        setRefundPaymentId(first.payment.id);
        setRefundAmount(moneyToMajorInput(first.remaining, order.currencyCode));
        setRefundReason('');
        setRefundCurrentPassword('');
        setActionError('');
        setIsRefundOpen(true);
    };

    const handleRefund = async () => {
        if (!order || !selectedPayment) return;
        const amount = majorInputToMoney(refundAmount, order.currencyCode);
        if (amount == null || amount <= 0 || amount > selectedPayment.remaining) {
            setActionError(
                `退款金额必须大于 0，且不能超过 ${formatMoney(selectedPayment.remaining, order.currencyCode)}`,
            );
            return;
        }
        if (!refundReason.trim()) {
            setActionError('请填写退款原因，便于后续对账');
            return;
        }
        if (!refundCurrentPassword) {
            setActionError('请输入当前管理员密码后再提交退款');
            return;
        }
        try {
            const response = await refundOrder({
                variables: {
                    input: {
                        paymentId: selectedPayment.payment.id,
                        amount,
                        reason: refundReason.trim(),
                    },
                },
                context: sensitiveActionContext(refundCurrentPassword),
            });
            const result = response.data?.refundOrder;
            if (result?.__typename !== 'Refund') {
                setActionError(getMutationError(result));
                return;
            }
            setIsRefundOpen(false);
            setRefundCurrentPassword('');
            await refreshAfterMutation(
                `退款记录已创建，当前状态：${getRefundStateLabel(result.state ?? '')}`,
            );
        } catch (mutationError) {
            setActionError(toUserFacingError(mutationError, '退款请求失败，请稍后重试'));
        }
    };

    const handleCancel = async () => {
        if (!order) return;
        if (!cancelReason.trim()) {
            setActionError('请填写取消原因');
            return;
        }
        if (!cancelCurrentPassword) {
            setActionError('请输入当前管理员密码后再取消订单');
            return;
        }
        try {
            const response = await cancelOrder({
                variables: {
                    input: {
                        orderId: order.id,
                        cancelShipping: true,
                        reason: cancelReason.trim(),
                    },
                },
                context: sensitiveActionContext(cancelCurrentPassword),
            });
            const result = response.data?.cancelOrder;
            if (result?.__typename !== 'Order') {
                setActionError(getMutationError(result));
                return;
            }
            setIsCancelOpen(false);
            setCancelCurrentPassword('');
            await refreshAfterMutation('订单已取消，库存和未履约配送按后端规则处理');
        } catch (mutationError) {
            setActionError(toUserFacingError(mutationError, '取消订单失败，请稍后重试'));
        }
    };

    const handleBeginModify = async () => {
        if (!order) return;
        if (order.state === 'Modifying') {
            navigate(`/sales/orders/${order.id}/modify`);
            return;
        }
        try {
            const response = await transitionOrder({
                variables: { id: order.id, state: 'Modifying' },
            });
            const result = response.data?.transitionOrderToState;
            if (result?.__typename !== 'Order') {
                setActionError(getMutationError(result));
                return;
            }
            navigate(`/sales/orders/${order.id}/modify`);
        } catch (mutationError) {
            setActionError(toUserFacingError(mutationError, '订单无法进入修改状态'));
        }
    };

    if (loading && !data)
        return (
            <div className="flex h-full items-center justify-center bg-slate-50">
                <div className="flex items-center gap-2 text-sm text-slate-500">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    正在加载订单详情
                </div>
            </div>
        );
    if (error)
        return (
            <div className="flex h-full items-center justify-center bg-slate-50 p-6">
                <div className="max-w-lg rounded-2xl border border-rose-200 bg-white p-6 text-center shadow-sm">
                    <AlertCircle className="mx-auto h-8 w-8 text-rose-500" />
                    <h1 className="mt-3 text-base font-semibold text-slate-900">订单详情加载失败</h1>
                    <p className="mt-2 text-xs leading-5 text-slate-500">
                        {toUserFacingError(error, '订单详情加载失败，请稍后重试')}
                    </p>
                    <div className="mt-4 flex justify-center gap-2">
                        <button
                            type="button"
                            onClick={() => navigate('/sales/orders')}
                            className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold"
                        >
                            返回列表
                        </button>
                        <button
                            type="button"
                            onClick={() => refetch()}
                            className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white"
                        >
                            重试
                        </button>
                    </div>
                </div>
            </div>
        );
    if (!order)
        return (
            <div className="flex h-full items-center justify-center bg-slate-50 p-6">
                <div className="text-center">
                    <FileText className="mx-auto h-8 w-8 text-slate-300" />
                    <h1 className="mt-3 text-sm font-semibold text-slate-800">
                        订单不存在或当前账号无权查看
                    </h1>
                    <button
                        type="button"
                        onClick={() => navigate('/sales/orders')}
                        className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
                    >
                        返回订单列表
                    </button>
                </div>
            </div>
        );

    return (
        <main className="flex h-full min-w-0 flex-col overflow-hidden bg-slate-50">
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                        <button
                            type="button"
                            onClick={() => navigate('/sales/orders')}
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100"
                            aria-label="返回订单列表"
                        >
                            <ArrowLeft className="h-5 w-5" />
                        </button>
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                                <h1 className="truncate font-mono text-base font-semibold text-slate-950">
                                    {order.code}
                                </h1>
                                <span
                                    className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${getOrderStateClass(order.state)}`}
                                >
                                    {getOrderStateLabel(order.state)}
                                </span>
                            </div>
                            <p className="mt-1 text-[11px] text-slate-500">
                                下单时间 {formatDateTime(order.orderPlacedAt ?? order.createdAt)} · ID{' '}
                                {order.id}
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <NextAdminActions
                            pageId="order-detail"
                            entity={order as unknown as Record<string, unknown>}
                        />
                        {canUpdateOrder &&
                            (order.state === 'Modifying' || order.nextStates.includes('Modifying')) && (
                                <button
                                    type="button"
                                    onClick={() => void handleBeginModify()}
                                    disabled={busy}
                                    className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-40"
                                >
                                    <PencilLine className="h-3.5 w-3.5" />
                                    {order.state === 'Modifying' ? '继续修改订单' : '修改订单'}
                                </button>
                            )}
                        {canUpdateOrder && (
                            <button
                                type="button"
                                onClick={openRefund}
                                disabled={paymentsWithBalances.length === 0 || busy}
                                className="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                            >
                                <RotateCcw className="h-3.5 w-3.5" />
                                执行退款
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => window.print()}
                            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                            <Printer className="h-3.5 w-3.5" />
                            打印订单
                        </button>
                        {canUpdateOrder && order.nextStates.includes('Cancelled') && (
                            <button
                                type="button"
                                onClick={() => {
                                    setCancelReason('');
                                    setCancelCurrentPassword('');
                                    setActionError('');
                                    setIsCancelOpen(true);
                                }}
                                disabled={busy}
                                className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                                <XCircle className="h-3.5 w-3.5" />
                                取消订单
                            </button>
                        )}
                        {canUpdateOrder && remainingPhysicalLines.length > 0 && (
                            <button
                                type="button"
                                onClick={() => {
                                    setActionError('');
                                    setIsFulfillOpen(true);
                                }}
                                disabled={!manualHandlerAvailable || busy}
                                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
                            >
                                <Truck className="h-4 w-4" />
                                创建实物发货
                            </button>
                        )}
                    </div>
                </div>
            </header>

            <div className="flex-1 overflow-y-auto p-5 sm:p-6">
                <div className="mx-auto w-full max-w-none space-y-4">
                    {notification && (
                        <div
                            role="status"
                            className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs font-medium text-emerald-800"
                        >
                            <Check className="h-4 w-4" />
                            {notification}
                        </div>
                    )}
                    {actionError && !isFulfillOpen && !isRefundOpen && !isCancelOpen && (
                        <div
                            role="alert"
                            className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs leading-5 text-rose-800"
                        >
                            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                            <span>{actionError}</span>
                            <button
                                type="button"
                                onClick={() => setActionError('')}
                                className="ml-auto text-rose-500"
                                aria-label="关闭错误提示"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                    )}
                    {!manualHandlerAvailable && remainingPhysicalLines.length > 0 && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                            后端没有启用 manual-fulfillment 处理器，发货按钮已停用，未伪造本地发货状态。
                        </div>
                    )}

                    <NextAdminPageBlocks
                        pageId="order-detail"
                        entity={order as unknown as Record<string, unknown>}
                    />

                    {orderCustomFieldDefinitions.length > 0 && (
                        <div className="space-y-3">
                            <DynamicCustomFieldsForm
                                fields={orderCustomFieldDefinitions}
                                values={orderCustomFieldValues}
                                onChange={setOrderCustomFieldValues}
                                disabled={!canUpdateOrder || savingCustomFields}
                                title="订单扩展信息"
                            />
                            {canUpdateOrder && (
                                <div className="flex justify-end">
                                    <button
                                        type="button"
                                        onClick={() => void handleSaveCustomFields()}
                                        disabled={savingCustomFields}
                                        className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                                    >
                                        {savingCustomFields && (
                                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                        )}
                                        保存扩展信息
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
                        <div className="min-w-0 space-y-4">
                            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
                                <header className="flex items-center justify-between border-b border-slate-200 bg-slate-50/70 px-5 py-4">
                                    <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                                        <PackageCheck className="h-4 w-4 text-blue-600" />
                                        商品明细
                                    </h2>
                                    <span className="text-xs text-slate-500">
                                        {order.lines.length} 个 SKU · {order.totalQuantity} 件
                                    </span>
                                </header>
                                <div className="mobile-scrollbar-hidden overflow-x-auto">
                                    <table className="w-full min-w-[1040px] border-collapse text-left text-xs">
                                        <thead>
                                            <tr className="border-b border-slate-100 text-slate-400">
                                                <th scope="col" className="w-14 whitespace-nowrap px-3 py-3">
                                                    主图
                                                </th>
                                                <th scope="col" className="w-64 whitespace-nowrap px-3 py-3">
                                                    商品名称
                                                </th>
                                                <th scope="col" className="w-44 whitespace-nowrap px-3 py-3">
                                                    SKU
                                                </th>
                                                <th scope="col" className="w-28 whitespace-nowrap px-3 py-3">
                                                    商品类型
                                                </th>
                                                <th scope="col" className="w-32 whitespace-nowrap px-3 py-3">
                                                    含税单价
                                                </th>
                                                <th
                                                    scope="col"
                                                    className="w-20 whitespace-nowrap px-3 py-3 text-center"
                                                >
                                                    数量
                                                </th>
                                                <th
                                                    scope="col"
                                                    className="w-32 whitespace-nowrap px-3 py-3 text-right"
                                                >
                                                    小计
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {order.lines.map(line => (
                                                <tr key={line.id} className="h-[52px] hover:bg-slate-50/80">
                                                    <td className="h-[52px] px-3 py-0">
                                                        <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100">
                                                            {line.featuredAsset?.preview ? (
                                                                <img
                                                                    src={line.featuredAsset.preview}
                                                                    alt={line.productVariant.name}
                                                                    className="h-full w-full object-cover"
                                                                />
                                                            ) : (
                                                                <ImageIcon className="h-4 w-4 text-slate-300" />
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="h-[52px] max-w-64 px-3 py-0">
                                                        <span
                                                            className="block truncate font-semibold text-slate-900"
                                                            title={line.productVariant.name}
                                                        >
                                                            {line.productVariant.name}
                                                        </span>
                                                    </td>
                                                    <td className="h-[52px] max-w-44 px-3 py-0 font-mono text-[10px] text-slate-500">
                                                        <span
                                                            className="block truncate"
                                                            title={line.productVariant.sku}
                                                        >
                                                            {line.productVariant.sku}
                                                        </span>
                                                    </td>
                                                    <td className="h-[52px] whitespace-nowrap px-3 py-0 text-[10px] text-slate-500">
                                                        {line.customFields?.fulfillmentTypeSnapshot ===
                                                        'digital'
                                                            ? '虚拟交付'
                                                            : '实物配送'}
                                                    </td>
                                                    <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono tabular-nums">
                                                        {formatMoney(
                                                            line.proratedUnitPriceWithTax,
                                                            order.currencyCode,
                                                        )}
                                                    </td>
                                                    <td className="h-[52px] whitespace-nowrap px-3 py-0 text-center font-mono font-semibold">
                                                        {line.quantity}
                                                    </td>
                                                    <td className="h-[52px] whitespace-nowrap px-3 py-0 text-right font-mono font-semibold tabular-nums">
                                                        {formatMoney(
                                                            line.discountedLinePriceWithTax,
                                                            order.currencyCode,
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </section>

                            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
                                <div className="flex items-center justify-between">
                                    <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                                        <Truck className="h-4 w-4 text-blue-600" />
                                        履约与物流
                                    </h2>
                                    {remainingPhysicalLines.length > 0 && (
                                        <span className="rounded bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700">
                                            {remainingPhysicalLines.reduce(
                                                (sum, line) => sum + line.quantity,
                                                0,
                                            )}{' '}
                                            件实物待发
                                        </span>
                                    )}
                                </div>
                                <div className="mt-4 space-y-2">
                                    {(order.fulfillments ?? []).length === 0 ? (
                                        <div className="rounded-lg bg-slate-50 p-4 text-center text-xs text-slate-500">
                                            当前没有履约记录
                                        </div>
                                    ) : (
                                        order.fulfillments?.map(fulfillment => (
                                            <div
                                                key={fulfillment.id}
                                                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3"
                                            >
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-mono text-xs font-semibold text-slate-900">
                                                            #{fulfillment.id}
                                                        </span>
                                                        <span className="rounded bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                                                            {getFulfillmentStateLabel(fulfillment.state)}
                                                        </span>
                                                    </div>
                                                    <div className="mt-1 text-[11px] text-slate-500">
                                                        {fulfillment.method || fulfillment.handlerCode} ·{' '}
                                                        {fulfillment.trackingCode || '无物流单号'}
                                                    </div>
                                                </div>
                                                {canUpdateOrder &&
                                                    fulfillment.nextStates.includes('Delivered') && (
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                handleFulfillmentDelivered(fulfillment)
                                                            }
                                                            disabled={transitioningFulfillment}
                                                            className="rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                                                        >
                                                            <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
                                                            确认送达
                                                        </button>
                                                    )}
                                            </div>
                                        ))
                                    )}
                                </div>
                            </section>

                            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
                                <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                                    <CreditCard className="h-4 w-4 text-blue-600" />
                                    支付与退款
                                </h2>
                                <div className="mt-4 space-y-3">
                                    {(order.payments ?? []).length === 0 ? (
                                        <div className="rounded-lg bg-slate-50 p-4 text-center text-xs text-slate-500">
                                            当前没有支付记录
                                        </div>
                                    ) : (
                                        order.payments?.map(payment => (
                                            <div
                                                key={payment.id}
                                                className="rounded-xl border border-slate-200 p-3"
                                            >
                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                    <div>
                                                        <span className="font-semibold text-slate-900">
                                                            {payment.method}
                                                        </span>
                                                        <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
                                                            {getPaymentStateLabel(payment.state)}
                                                        </span>
                                                    </div>
                                                    <span className="font-mono text-sm font-semibold tabular-nums">
                                                        {formatMoney(payment.amount, order.currencyCode)}
                                                    </span>
                                                </div>
                                                <div className="mt-1 font-mono text-[10px] text-slate-400">
                                                    流水号：{payment.transactionId || '后端未返回'}
                                                </div>
                                                {payment.refunds.length > 0 && (
                                                    <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
                                                        {payment.refunds.map(refund => (
                                                            <div
                                                                key={refund.id}
                                                                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-rose-50 px-3 py-2 text-[11px] text-rose-700"
                                                            >
                                                                <span>
                                                                    退款 #{refund.id} ·{' '}
                                                                    {getRefundStateLabel(refund.state)} ·{' '}
                                                                    {refund.reason || '未填写原因'}
                                                                </span>
                                                                <strong className="font-mono">
                                                                    {formatMoney(
                                                                        refund.total,
                                                                        order.currencyCode,
                                                                    )}
                                                                </strong>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        ))
                                    )}
                                </div>
                            </section>

                            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
                                <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                                    <MessageSquare className="h-4 w-4 text-blue-600" />
                                    内部备注
                                </h2>
                                <p className="mt-1 text-[10px] text-slate-400">
                                    当前读取最近 {order.history.items.length} / {order.history.totalItems}{' '}
                                    条订单历史中的备注
                                </p>
                                {canUpdateOrder && (
                                    <div className="mt-4 flex gap-2">
                                        <input
                                            value={newNote}
                                            onChange={event => setNewNote(event.target.value)}
                                            onKeyDown={event => {
                                                if (event.key === 'Enter') handleAddNote();
                                            }}
                                            placeholder="输入仅管理员可见的跟进备注"
                                            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                                        />
                                        <button
                                            type="button"
                                            onClick={handleAddNote}
                                            disabled={addingNote || !newNote.trim()}
                                            className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
                                        >
                                            {addingNote ? (
                                                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                            ) : (
                                                <Send className="h-3.5 w-3.5" />
                                            )}
                                            保存
                                        </button>
                                    </div>
                                )}
                                <div className="mt-4 space-y-2">
                                    {notes.length === 0 ? (
                                        <div className="rounded-lg bg-slate-50 p-4 text-center text-xs text-slate-500">
                                            还没有内部备注
                                        </div>
                                    ) : (
                                        notes.map(note => (
                                            <div
                                                key={note.id}
                                                className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs"
                                            >
                                                <div className="flex flex-wrap justify-between gap-2 text-[10px] text-slate-400">
                                                    <span>
                                                        {[
                                                            note.administrator?.lastName,
                                                            note.administrator?.firstName,
                                                        ]
                                                            .filter(Boolean)
                                                            .join('') || '系统管理员'}
                                                    </span>
                                                    <span>{formatDateTime(note.createdAt)}</span>
                                                </div>
                                                <p className="mt-1.5 leading-5 text-slate-800">
                                                    {String(note.data.note ?? '')}
                                                </p>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </section>

                            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
                                <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                                    <Clock3 className="h-4 w-4 text-blue-600" />
                                    订单时间线（最近 20 条）
                                </h2>
                                <div className="mt-4 space-y-3">
                                    {timeline.length === 0 ? (
                                        <div className="text-xs text-slate-500">当前没有状态记录</div>
                                    ) : (
                                        timeline.map(entry => (
                                            <div
                                                key={entry.id}
                                                className="grid grid-cols-[0.75rem_1fr] gap-3"
                                            >
                                                <div className="mt-1.5 h-2.5 w-2.5 rounded-full bg-slate-300" />
                                                <div>
                                                    <div className="text-xs font-medium text-slate-800">
                                                        {historyLabel(entry)}
                                                    </div>
                                                    <div className="mt-0.5 text-[10px] text-slate-400">
                                                        {formatDateTime(entry.createdAt)}
                                                    </div>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </section>
                        </div>

                        <aside className="space-y-4 lg:sticky lg:top-0">
                            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
                                <h2 className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                                    <User className="h-4 w-4 text-blue-600" />
                                    买家信息
                                </h2>
                                <div className="mt-3 space-y-1.5 text-xs">
                                    <div className="font-semibold text-slate-900">
                                        {getCustomerName(order.customer)}
                                    </div>
                                    <div className="break-all text-slate-500">
                                        {order.customer?.emailAddress ?? '未留邮箱'}
                                    </div>
                                    <div className="text-slate-500">
                                        {order.customer?.phoneNumber ||
                                            order.shippingAddress?.phoneNumber ||
                                            '未留联系电话'}
                                    </div>
                                </div>
                            </section>
                            <AddressCard
                                title="收货地址"
                                icon={<MapPin className="h-4 w-4 text-blue-600" />}
                                address={order.shippingAddress}
                            />
                            <AddressCard
                                title="账单地址"
                                icon={<FileText className="h-4 w-4 text-blue-600" />}
                                address={order.billingAddress}
                            />
                            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
                                <h2 className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                                    <Store className="h-4 w-4 text-blue-600" />
                                    渠道与配送
                                </h2>
                                <div className="mt-3 space-y-2 text-xs text-slate-600">
                                    <div>
                                        <span className="text-slate-400">渠道：</span>
                                        {order.channels
                                            .map(channel => getChannelDisplayName(channel.code))
                                            .join('、') || '未返回'}
                                    </div>
                                    <div>
                                        <span className="text-slate-400">配送：</span>
                                        {order.shippingLines
                                            .map(line => line.shippingMethod.name)
                                            .join('、') || '无需配送'}
                                    </div>
                                </div>
                            </section>
                            <section className="rounded-xl bg-slate-900 p-5 text-white shadow-sm">
                                <h2 className="text-xs font-semibold text-slate-300">金额汇总</h2>
                                <div className="mt-4 space-y-2 text-xs">
                                    <div className="flex justify-between text-slate-300">
                                        <span>商品小计</span>
                                        <span className="font-mono">
                                            {formatMoney(order.subTotalWithTax, order.currencyCode)}
                                        </span>
                                    </div>
                                    <div className="flex justify-between text-slate-300">
                                        <span>配送费用</span>
                                        <span className="font-mono">
                                            {formatMoney(order.shippingWithTax, order.currencyCode)}
                                        </span>
                                    </div>
                                    {order.discounts.map((discount, index) => (
                                        <div
                                            key={`${discount.description}-${index}`}
                                            className="flex justify-between text-emerald-300"
                                        >
                                            <span className="truncate pr-2">
                                                {discount.description || '优惠'}
                                            </span>
                                            <span className="font-mono">
                                                {formatMoney(discount.amountWithTax, order.currencyCode)}
                                            </span>
                                        </div>
                                    ))}
                                    <div className="mt-3 flex justify-between border-t border-white/10 pt-3 text-sm font-semibold">
                                        <span>实付合计</span>
                                        <span className="font-mono text-lg tabular-nums">
                                            {formatMoney(order.totalWithTax, order.currencyCode)}
                                        </span>
                                    </div>
                                </div>
                            </section>
                        </aside>
                    </div>
                </div>
            </div>

            {canUpdateOrder && isFulfillOpen && (
                <ActionDialog
                    title="创建实物发货"
                    description="提交后会写入真实履约记录，并将履约状态推进为已发货。"
                    icon={<Truck className="h-5 w-5 text-blue-600" />}
                    busy={addingFulfillment || transitioningFulfillment}
                    error={actionError}
                    onClose={() => setIsFulfillOpen(false)}
                    onConfirm={handleFulfill}
                    confirmLabel="确认发货"
                >
                    <label className="block text-xs font-semibold text-slate-700">
                        物流公司 / 配送方式 *
                    </label>
                    <input
                        value={carrier}
                        onChange={event => setCarrier(event.target.value)}
                        className="mt-1.5 w-full rounded-lg border border-slate-300 p-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                    <label className="mt-4 block text-xs font-semibold text-slate-700">真实运单号 *</label>
                    <input
                        value={trackingCode}
                        onChange={event => setTrackingCode(event.target.value)}
                        placeholder="请从物流系统复制运单号"
                        className="mt-1.5 w-full rounded-lg border border-slate-300 p-2.5 font-mono text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                    <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                        本次发货：{remainingPhysicalLines.reduce((sum, line) => sum + line.quantity, 0)}{' '}
                        件实物商品
                    </div>
                </ActionDialog>
            )}

            {canUpdateOrder && isRefundOpen && (
                <ActionDialog
                    title="创建原支付渠道退款"
                    description="最终到账时间和状态以支付处理器返回结果为准，后台不会提前显示“已到账”。"
                    icon={<RotateCcw className="h-5 w-5 text-rose-600" />}
                    busy={refunding}
                    error={actionError}
                    onClose={() => {
                        setIsRefundOpen(false);
                        setRefundCurrentPassword('');
                    }}
                    onConfirm={handleRefund}
                    confirmLabel="提交退款"
                >
                    <label className="block text-xs font-semibold text-slate-700">退款支付记录 *</label>
                    <select
                        value={selectedPayment?.payment.id ?? ''}
                        onChange={event => {
                            const next = paymentsWithBalances.find(
                                item => item.payment.id === event.target.value,
                            );
                            setRefundPaymentId(event.target.value);
                            if (next && order)
                                setRefundAmount(moneyToMajorInput(next.remaining, order.currencyCode));
                        }}
                        className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm"
                    >
                        {paymentsWithBalances.map(item => (
                            <option key={item.payment.id} value={item.payment.id}>
                                {item.payment.method} · 可退 {formatMoney(item.remaining, order.currencyCode)}
                            </option>
                        ))}
                    </select>
                    <label className="mt-4 block text-xs font-semibold text-slate-700">退款金额 *</label>
                    <input
                        value={refundAmount}
                        onChange={event => setRefundAmount(event.target.value)}
                        inputMode="decimal"
                        className="mt-1.5 w-full rounded-lg border border-slate-300 p-2.5 font-mono text-sm font-semibold outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100"
                    />
                    <label className="mt-4 block text-xs font-semibold text-slate-700">退款原因 *</label>
                    <textarea
                        value={refundReason}
                        onChange={event => setRefundReason(event.target.value)}
                        rows={3}
                        placeholder="填写客户诉求和退款依据"
                        className="mt-1.5 w-full rounded-lg border border-slate-300 p-2.5 text-sm outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100"
                    />
                    <label className="mt-4 block text-xs font-semibold text-slate-700">
                        当前管理员密码 *
                    </label>
                    <input
                        type="password"
                        autoComplete="current-password"
                        value={refundCurrentPassword}
                        onChange={event => setRefundCurrentPassword(event.target.value)}
                        placeholder="输入密码确认本人操作"
                        className="mt-1.5 w-full rounded-lg border border-slate-300 p-2.5 text-sm outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100"
                    />
                </ActionDialog>
            )}

            {canUpdateOrder && isCancelOpen && (
                <ActionDialog
                    title="取消订单"
                    description="取消会按 Vendure 订单流程释放未履约库存和配送，不等同于自动完成退款。"
                    icon={<XCircle className="h-5 w-5 text-rose-600" />}
                    busy={cancelling}
                    error={actionError}
                    onClose={() => {
                        setIsCancelOpen(false);
                        setCancelCurrentPassword('');
                    }}
                    onConfirm={handleCancel}
                    confirmLabel="确认取消"
                >
                    <label className="block text-xs font-semibold text-slate-700">取消原因 *</label>
                    <textarea
                        value={cancelReason}
                        onChange={event => setCancelReason(event.target.value)}
                        rows={4}
                        placeholder="填写取消原因，便于审计和客服跟进"
                        className="mt-1.5 w-full rounded-lg border border-slate-300 p-2.5 text-sm outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100"
                    />
                    <label className="mt-4 block text-xs font-semibold text-slate-700">
                        当前管理员密码 *
                    </label>
                    <input
                        type="password"
                        autoComplete="current-password"
                        value={cancelCurrentPassword}
                        onChange={event => setCancelCurrentPassword(event.target.value)}
                        placeholder="输入密码确认本人操作"
                        className="mt-1.5 w-full rounded-lg border border-slate-300 p-2.5 text-sm outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100"
                    />
                </ActionDialog>
            )}
        </main>
    );
}

function AddressCard({
    title,
    icon,
    address,
}: {
    title: string;
    icon: React.ReactNode;
    address?: AddressItem | null;
}) {
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
            <h2 className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                {icon}
                {title}
            </h2>
            {address ? (
                <div className="mt-3 space-y-1 text-xs leading-5 text-slate-600">
                    <div className="font-semibold text-slate-900">{address.fullName || '未填写姓名'}</div>
                    {address.company && <div>{address.company}</div>}
                    <div>{formatAddress(address)}</div>
                    {address.phoneNumber && <div>{address.phoneNumber}</div>}
                </div>
            ) : (
                <div className="mt-3 text-xs text-slate-400">未填写</div>
            )}
        </section>
    );
}

function ActionDialog({
    title,
    description,
    icon,
    busy,
    error,
    onClose,
    onConfirm,
    confirmLabel,
    children,
}: {
    title: string;
    description: string;
    icon: React.ReactNode;
    busy: boolean;
    error: string;
    onClose: () => void;
    onConfirm: () => void;
    confirmLabel: string;
    children: React.ReactNode;
}) {
    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs"
            onClick={() => !busy && onClose()}
        >
            <AccessibleDialogSurface
                accessibleName={title}
                onRequestClose={() => {
                    if (!busy) onClose();
                }}
                className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl"
                onClick={event => event.stopPropagation()}
            >
                <header className="flex items-start justify-between border-b border-slate-200 bg-slate-50 px-6 py-4">
                    <div>
                        <h2
                            id={`dialog-${title}`}
                            className="flex items-center gap-2 text-base font-semibold text-slate-950"
                        >
                            {icon}
                            {title}
                        </h2>
                        <p className="mt-1.5 text-xs leading-5 text-slate-500">{description}</p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                        className="text-slate-400 hover:text-slate-700"
                        aria-label="关闭"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </header>
                <div className="p-6">
                    {children}
                    {error && (
                        <div
                            role="alert"
                            className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-700"
                        >
                            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                            {error}
                        </div>
                    )}
                </div>
                <footer className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                        className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
                    >
                        取消
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={busy}
                        className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                        {busy && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                        {confirmLabel}
                    </button>
                </footer>
            </AccessibleDialogSurface>
        </div>
    );
}
