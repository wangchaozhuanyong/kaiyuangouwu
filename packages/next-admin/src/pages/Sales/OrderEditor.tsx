import { useMutation } from '@apollo/client/react';
import {
    AlertCircle,
    ArrowLeft,
    Check,
    CheckCircle2,
    Clock3,
    CreditCard,
    FileText,
    Image as ImageIcon,
    Mail,
    MapPin,
    MessageSquare,
    PackageCheck,
    PencilLine,
    Phone,
    Printer,
    RefreshCw,
    RotateCcw,
    Send,
    Truck,
    User,
    X,
    XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { sensitiveActionContext } from '../../apollo';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { AdminButton, AdminInput, AdminSelect, AdminTextArea } from '../../components/AdminControls';
import { DraftUpdateNotice } from '../../components/DraftUpdateNotice';
import { FeatureHelpButton } from '../../components/FeatureHelp';
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
import { RETRY_AUTO_CARD_DELIVERY_MUTATION } from '../../graphql/fulfillment.graphql';
import { RETRY_CHECKOUT_DELIVERY } from '../../graphql/order-operations.graphql';
import {
    ADD_ORDER_FULFILLMENT,
    ADD_SALES_ORDER_NOTE,
    CANCEL_SALES_ORDER,
    GET_SALES_ORDER,
    PREPARE_FULFILLMENT_SHIPMENT,
    REFUND_SALES_ORDER,
    SET_SALES_ORDER_CUSTOM_FIELDS,
    TRANSITION_SALES_FULFILLMENT,
    TRANSITION_SALES_ORDER,
    UPDATE_FULFILLMENT_DELIVERY,
} from '../../graphql/sales.graphql';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { useAdminQuery as useQuery } from '../../hooks/use-admin-query';
import { useAdminReturn } from '../../hooks/use-admin-return';
import { useServerDraft } from '../../hooks/use-server-draft';
import { refreshAfterAdminWrite } from '../../utils/admin-write-readback';
import { getChannelDisplayName } from '../../utils/channel-display';
import { isInputMethodKey } from '../../utils/input-method';
import { toUserFacingError } from '../../utils/user-facing-error';
import { DeliveryEditor } from './ManualDigitalDeliveryModule';
import { OrderProcessingSummaryPanel } from './OrderProcessingSummaryPanel';
import { OrderProfitExpensePanel } from './OrderProfitExpensePanel';
import { OrderRefundScopeFields, type OrderRefundScope } from './OrderRefundScopeFields';
import { canCreatePhysicalFulfillment } from './order-operation-availability';
import {
    buildCompatibleRefundOrderInput,
    canManageOrderInChannel,
    formatAddress,
    formatDateTime,
    formatMoney,
    getClaimStatusLabel,
    getCustomerName,
    getFulfillmentStateLabel,
    getMutationError,
    getOrderProductDisplayName,
    getOrderStateClass,
    getOrderStateLabel,
    getPaymentMethodLabel,
    getPaymentStateLabel,
    getProcessingLineLabel,
    getProcessingPhysicalLines,
    getRefundStateLabel,
    isSimulatedPayment,
    majorInputToMoney,
    moneyToMajorInput,
    type OrderProcessingSummary,
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
        product?: { name: string } | null;
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
    deliveryEvidence?: FulfillmentDeliveryEvidence | null;
}

interface FulfillmentDeliveryEvidence {
    id: string;
    status: 'IN_TRANSIT' | 'EXCEPTION' | 'DELIVERED';
    carrier: string;
    trackingCode: string;
    exceptionReason?: string | null;
    proofReference?: string | null;
    shippedAt: string;
    deliveredAt?: string | null;
    nextActionDueAt?: string | null;
    overdue: boolean;
    events: Array<{
        id: string;
        createdAt: string;
        status: string;
        actorType: string;
        actorLabel: string;
        note: string;
    }>;
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
    processingSummary?: OrderProcessingSummary | null;
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
    salesChannel: {
        id: string;
        code: string;
        customFields?: { storefrontNameZh?: string | null; storefrontNameEn?: string | null } | null;
    } | null;
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
    activeChannel: { id: string; code: string };
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

const historyLabel = (entry: HistoryItem) => {
    if (entry.type === 'ORDER_STATE_TRANSITION')
        return `订单状态：${getOrderStateLabel(String(entry.data.from ?? ''))} → ${getOrderStateLabel(String(entry.data.to ?? ''))}`;
    if (entry.type === 'ORDER_PAYMENT_TRANSITION')
        return `支付状态：${getPaymentStateLabel(String(entry.data.from ?? ''))} → ${getPaymentStateLabel(String(entry.data.to ?? ''))}`;
    if (entry.type === 'ORDER_FULFILLMENT_TRANSITION')
        return `履约状态：${getFulfillmentStateLabel(String(entry.data.from ?? ''))} → ${getFulfillmentStateLabel(String(entry.data.to ?? ''))}`;
    if (entry.type === 'ORDER_REFUND_TRANSITION')
        return `退款状态：${getRefundStateLabel(String(entry.data.from ?? ''))} → ${getRefundStateLabel(String(entry.data.to ?? ''))}`;
    if (entry.type === 'ORDER_CANCELLATION') return `订单取消：${String(entry.data.reason ?? '未填写原因')}`;
    if (entry.type === 'ORDER_FULFILLMENT') return '创建履约记录';
    if (entry.type === 'ORDER_COUPON_APPLIED') return '已使用优惠券';
    if (entry.type === 'ORDER_COUPON_REMOVED') return '已移除优惠券';
    return entry.type;
};

export function OrderEditor() {
    const navigate = useNavigate();
    const { returnToList } = useAdminReturn('/sales/orders');
    const { id } = useParams<{ id: string }>();
    const [searchParams] = useSearchParams();
    const afterSalesId = searchParams.get('afterSalesId') || undefined;
    const { hasAnyPermission } = useAdminPermissions();
    const canReadProfitExpenses = hasAnyPermission(['ReadCatalogOperations']);
    const orderCustomFieldDefinitions = useCustomFieldDefinitions('Order');
    const orderDetailDocument = useMemo(
        () => addCustomFieldsToDocument(GET_SALES_ORDER, 'Order', orderCustomFieldDefinitions, ['order']),
        [orderCustomFieldDefinitions],
    );
    const [notification, setNotification] = useState('');
    const [actionError, setActionError] = useState('');
    const [newNote, setNewNote] = useState('');
    const [isFulfillOpen, setIsFulfillOpen] = useState(false);
    const [carrier, setCarrier] = useState('');
    const [trackingCode, setTrackingCode] = useState('');
    const [deliveryAction, setDeliveryAction] = useState<{
        fulfillment: FulfillmentItem;
        status: 'SHIP' | 'IN_TRANSIT' | 'EXCEPTION' | 'DELIVERED';
    } | null>(null);
    const [deliveryNote, setDeliveryNote] = useState('');
    const [deliveryCarrier, setDeliveryCarrier] = useState('');
    const [deliveryTrackingCode, setDeliveryTrackingCode] = useState('');
    const [deliveryProof, setDeliveryProof] = useState('');
    const deliveryAttempt = useRef<{ signature: string; key: string } | null>(null);
    const [isRefundOpen, setIsRefundOpen] = useState(false);
    const [refundPaymentId, setRefundPaymentId] = useState('');
    const [refundAmount, setRefundAmount] = useState('');
    const [refundReason, setRefundReason] = useState('');
    const [refundScope, setRefundScope] = useState<OrderRefundScope>('ITEMS');
    const [refundQuantities, setRefundQuantities] = useState<Record<string, number>>({});
    const [refundCurrentPassword, setRefundCurrentPassword] = useState('');
    const refundAttempt = useRef<{ signature: string; key: string } | null>(null);
    const [manualTaskId, setManualTaskId] = useState<string | null>(null);
    useEffect(() => {
        if (!manualTaskId || !id) return;
        const frame = requestAnimationFrame(() => {
            const editor = document.getElementById(`order-manual-task-${id}-${manualTaskId}`);
            editor?.scrollIntoView({ behavior: 'auto', block: 'start' });
            editor?.focus({ preventScroll: true });
        });
        return () => cancelAnimationFrame(frame);
    }, [id, manualTaskId]);
    const [isCancelOpen, setIsCancelOpen] = useState(false);
    const [cancelReason, setCancelReason] = useState('');
    const [cancelCurrentPassword, setCancelCurrentPassword] = useState('');

    const { data, loading, error, refetch } = useQuery<OrderQueryData>(orderDetailDocument, {
        variables: { id },
        skip: !id,

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
    const [updateFulfillmentDelivery, { loading: updatingDelivery }] = useMutation<{
        updateFulfillmentDelivery: FulfillmentDeliveryEvidence;
    }>(UPDATE_FULFILLMENT_DELIVERY);
    const [prepareShipment, { loading: preparingShipment }] = useMutation<{
        prepareFulfillmentShipment: { id: string; state: string };
    }>(PREPARE_FULFILLMENT_SHIPMENT);
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
    const [retryAutoCard, { loading: retryingAutoCard }] = useMutation<{
        retryAutoCardDelivery: { id: string };
    }>(RETRY_AUTO_CARD_DELIVERY_MUTATION);
    const [retryCheckoutDelivery, { loading: retryingCheckoutDelivery }] = useMutation<{
        retryCheckoutDelivery: { id: string; orderId: string; state: string; reviewReason: string | null };
    }>(RETRY_CHECKOUT_DELIVERY);

    const order = data?.order;
    const inSalesStore = canManageOrderInChannel(order, data?.activeChannel?.id);
    const canUpdateOrder =
        inSalesStore && Boolean(order?.processingSummary?.canManage) && hasAnyPermission(['UpdateOrder']);
    const canUpdateProfitExpenses = canUpdateOrder && hasAnyPermission(['UpdateCatalogOperations']);
    const customFieldSource = order
        ? customFieldValuesFromEntity(orderCustomFieldDefinitions, order.customFields)
        : null;
    const orderFieldDraft = useServerDraft<CustomFieldValueMap>(
        order?.id ?? '',
        customFieldSource ? JSON.stringify(customFieldSource) : '',
        customFieldSource,
    );
    const orderCustomFieldValues = orderFieldDraft.draft ?? {};
    const setOrderCustomFieldValues = orderFieldDraft.setDraft;
    const remainingPhysicalLines = order ? getProcessingPhysicalLines(order) : [];
    const physicalLineIds = new Set(
        order?.processingSummary?.lines
            .filter(line => line.fulfillmentType === 'physical')
            .map(line => line.orderLineId) ?? [],
    );
    const physicalFulfillments = (order?.fulfillments ?? []).filter(item =>
        item.lines.some(line => physicalLineIds.has(line.orderLineId)),
    );
    const digitalLines =
        order?.processingSummary?.lines.filter(line => line.fulfillmentType === 'digital') ?? [];
    const hasPhysicalProducts = physicalLineIds.size > 0;
    const manualHandlerAvailable =
        data?.fulfillmentHandlers.some(handler => handler.code === 'manual-fulfillment') ?? false;
    const paymentsWithBalances = useMemo(
        () =>
            (order?.payments ?? [])
                .map(payment => {
                    const capability = order?.processingSummary?.paymentCapabilities.find(
                        item => item.paymentId === payment.id,
                    );
                    return { payment, remaining: capability?.refundableAmount ?? 0 };
                })
                .filter(
                    item =>
                        item.payment.state === 'Settled' &&
                        item.remaining > 0 &&
                        !isSimulatedPayment(item.payment.method) &&
                        order?.processingSummary?.paymentCapabilities.some(
                            capability => capability.paymentId === item.payment.id && capability.canRefund,
                        ),
                ),
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
        updatingDelivery ||
        preparingShipment ||
        transitioningOrder ||
        refunding ||
        cancelling;
    const processingBusy = busy || retryingAutoCard || retryingCheckoutDelivery;

    const showNotice = (message: string) => {
        setNotification(message);
        window.setTimeout(() => setNotification(''), 4000);
    };
    const refreshAfterMutation = async (message: string) => {
        setActionError('');
        showNotice(message);
        await refreshAfterAdminWrite(() => refetch(), setActionError);
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
        if (orderFieldDraft.sourceChanged) return;
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
            orderFieldDraft.accept(orderCustomFieldValues);
            await refreshAfterMutation('订单扩展字段已保存');
        } catch (mutationError) {
            setActionError(toUserFacingError(mutationError, '订单扩展字段保存失败'));
        }
    };

    const handleFulfill = async () => {
        if (!order || remainingPhysicalLines.length === 0) return;
        if (!canCreatePhysicalFulfillment(order.state)) {
            setActionError('订单未付款或未授权，不能创建实物发货');
            return;
        }
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

    const openDeliveryAction = (
        fulfillment: FulfillmentItem,
        status: 'SHIP' | 'IN_TRANSIT' | 'EXCEPTION' | 'DELIVERED',
    ) => {
        setDeliveryAction({ fulfillment, status });
        setDeliveryNote('');
        setDeliveryCarrier(fulfillment.deliveryEvidence?.carrier ?? fulfillment.method ?? '');
        setDeliveryTrackingCode(fulfillment.deliveryEvidence?.trackingCode ?? fulfillment.trackingCode ?? '');
        setDeliveryProof('');
        setActionError('');
    };

    const handleDeliveryAction = async () => {
        if (!deliveryAction) return;
        const { fulfillment, status } = deliveryAction;
        if (status !== 'SHIP' && !deliveryNote.trim()) {
            setActionError('请填写本次操作说明');
            return;
        }
        if (
            ['SHIP', 'IN_TRANSIT'].includes(status) &&
            (!deliveryCarrier.trim() || !deliveryTrackingCode.trim())
        ) {
            setActionError('发出包裹必须填写物流公司和真实运单号');
            return;
        }
        if (status === 'DELIVERED' && !deliveryProof.trim()) {
            setActionError('确认送达必须填写签收单、物流回执或其他送达凭证');
            return;
        }
        try {
            if (status === 'SHIP') {
                if (!['Created', 'Pending'].includes(fulfillment.state))
                    throw new Error('该包裹已不在待发状态，请刷新核实');
                const prepared = await prepareShipment({
                    variables: {
                        input: {
                            fulfillmentId: fulfillment.id,
                            carrier: deliveryCarrier.trim(),
                            trackingCode: deliveryTrackingCode.trim(),
                        },
                    },
                });
                const preparedFulfillment = prepared.data?.prepareFulfillmentShipment;
                if (preparedFulfillment?.id !== fulfillment.id) throw new Error('后端未确认原包裹物流资料');
                if (!['Created', 'Pending'].includes(preparedFulfillment.state))
                    throw new Error('原包裹已不在待发状态，请刷新核实');
                if (preparedFulfillment.state === 'Created') {
                    const pending = await transitionFulfillment({
                        variables: { id: fulfillment.id, state: 'Pending' },
                    });
                    const result = pending.data?.transitionFulfillmentToState;
                    if (result?.__typename !== 'Fulfillment') throw new Error(getMutationError(result));
                    if (result.id !== fulfillment.id || result.state !== 'Pending')
                        throw new Error('后端未确认原包裹进入待发状态，请刷新核实');
                }
                const response = await transitionFulfillment({
                    variables: { id: fulfillment.id, state: 'Shipped' },
                });
                if (response.data?.transitionFulfillmentToState?.__typename !== 'Fulfillment')
                    throw new Error(getMutationError(response.data?.transitionFulfillmentToState));
                if (
                    response.data.transitionFulfillmentToState.id !== fulfillment.id ||
                    response.data.transitionFulfillmentToState.state !== 'Shipped'
                )
                    throw new Error('后端未确认原包裹已发出，请刷新核实');
                setDeliveryAction(null);
                await refreshAfterMutation('已有包裹已发出，等待配送结果');
                return;
            }
            const signature = JSON.stringify([
                fulfillment.id,
                status,
                deliveryCarrier.trim(),
                deliveryTrackingCode.trim(),
                deliveryProof.trim(),
                deliveryNote.trim(),
            ]);
            if (deliveryAttempt.current?.signature !== signature)
                deliveryAttempt.current = { signature, key: crypto.randomUUID() };
            const response = await updateFulfillmentDelivery({
                variables: {
                    input: {
                        fulfillmentId: fulfillment.id,
                        status,
                        carrier: status === 'IN_TRANSIT' ? deliveryCarrier.trim() : null,
                        trackingCode: status === 'IN_TRANSIT' ? deliveryTrackingCode.trim() : null,
                        proofReference: status === 'DELIVERED' ? deliveryProof.trim() : null,
                        note: deliveryNote.trim(),
                        idempotencyKey: deliveryAttempt.current.key,
                    },
                },
            });
            if (!response.data?.updateFulfillmentDelivery?.id) throw new Error('后端未确认配送事件');
            deliveryAttempt.current = null;
            setDeliveryAction(null);
            await refreshAfterMutation(
                status === 'EXCEPTION'
                    ? '配送异常已登记并进入待处理队列'
                    : status === 'IN_TRANSIT'
                      ? '重新发运信息已保存'
                      : '送达凭证已保存，履约已完成',
            );
        } catch (mutationError) {
            setActionError(toUserFacingError(mutationError, '配送证据更新失败，请稍后重试'));
        }
    };

    const openRefund = () => {
        const first = paymentsWithBalances[0];
        if (!order?.processingSummary?.canRefund) {
            setActionError(order?.processingSummary?.refundBlockedReason || '当前订单不能发起退款');
            return;
        }
        if (!order || !first) {
            setActionError('当前订单没有可退款的已结算支付');
            return;
        }
        setRefundPaymentId(first.payment.id);
        setRefundAmount(moneyToMajorInput(first.remaining, order.currencyCode));
        setRefundReason('');
        setRefundScope('ITEMS');
        setRefundQuantities({});
        setRefundCurrentPassword('');
        setActionError('');
        setIsRefundOpen(true);
    };

    const handleRefund = async () => {
        if (!order || !selectedPayment) return;
        if (!order.processingSummary?.canRefund || order.processingSummary.isTestOrder) {
            setActionError(order.processingSummary?.refundBlockedReason || '本单当前不能执行真实退款');
            return;
        }
        const amount = majorInputToMoney(refundAmount, order.currencyCode);
        if (amount == null || amount <= 0 || amount > selectedPayment.remaining) {
            setActionError(
                `退款金额必须大于 0，且不能超过 ${formatMoney(selectedPayment.remaining, order.currencyCode)}`,
            );
            return;
        }
        const refundLines = order.processingSummary.lines.flatMap(line => {
            const quantity = refundQuantities[line.orderLineId] ?? 0;
            return quantity > 0 ? [{ orderLineId: line.orderLineId, quantity }] : [];
        });
        if (
            refundScope === 'ITEMS' &&
            (!refundLines.length ||
                refundLines.some(
                    line =>
                        !Number.isSafeInteger(line.quantity) ||
                        line.quantity >
                            (order.processingSummary?.lines.find(
                                item => item.orderLineId === line.orderLineId,
                            )?.refundableQuantity ?? 0),
                ))
        ) {
            setActionError('请选择可退款商品并填写有效退款份数');
            return;
        }
        if (
            refundScope === 'SHIPPING' &&
            (order.processingSummary.kind === 'DIGITAL' ||
                amount > order.processingSummary.refundableShippingAmount)
        ) {
            setActionError('退款金额不能超过本单可退实物运费');
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
            const signature = JSON.stringify([
                order.id,
                selectedPayment.payment.id,
                amount,
                refundReason.trim(),
                refundScope,
                refundLines,
                afterSalesId,
            ]);
            if (refundAttempt.current?.signature !== signature)
                refundAttempt.current = { signature, key: crypto.randomUUID() };
            const response = await refundOrder({
                variables: {
                    input: buildCompatibleRefundOrderInput(
                        selectedPayment.payment.id,
                        amount,
                        refundReason.trim(),
                        refundAttempt.current.key,
                        {
                            lines: refundScope === 'ITEMS' ? refundLines : [],
                            shipping: refundScope === 'SHIPPING' ? amount : 0,
                            reasonType: refundScope,
                            afterSalesId,
                        },
                    ),
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
            refundAttempt.current = null;
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

    const handleProcessingAction = async (action: NonNullable<OrderProcessingSummary['nextAction']>) => {
        if (!order || !action.enabled || !canUpdateOrder) return;
        if (action.code === 'RETRY_RESOURCE_DELIVERY') {
            setActionError('');
            try {
                const response = await retryCheckoutDelivery({ variables: { orderId: order.id } });
                const result = response.data?.retryCheckoutDelivery;
                if (!result || result.orderId !== order.id || result.state !== 'CONFIRMED')
                    throw new Error(result?.reviewReason || '交付资源尚未确认，请核对库存或付款结果');
                await refreshAfterMutation('交付资源已确认，交付结果已重新查询');
            } catch (cause) {
                setActionError(toUserFacingError(cause, '重试交付失败，请核对付款与库存后处理'));
            }
            return;
        }
        if (action.code === 'SHIP_PHYSICAL') {
            setActionError('');
            setIsFulfillOpen(true);
            return;
        }
        if (action.code === 'DISPATCH_PHYSICAL') {
            const fulfillment = physicalFulfillments.find(item => item.id === action.targetId);
            if (fulfillment && ['Created', 'Pending'].includes(fulfillment.state)) {
                openDeliveryAction(fulfillment, 'SHIP');
                return;
            }
            document
                .getElementById(
                    action.targetId ? `physical-fulfillment-${action.targetId}` : 'physical-order-delivery',
                )
                ?.scrollIntoView({ behavior: 'auto', block: 'center' });
            return;
        }
        if (action.code === 'PROCESS_REFUND') {
            openRefund();
            return;
        }
        if (action.code === 'RETRY_REFUND') {
            const target = action.targetId
                ? document.getElementById(`order-refund-${order.id}-${action.targetId}`)
                : document.getElementById('order-payment-operations');
            target?.scrollIntoView({ behavior: 'auto', block: 'center' });
            target?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
            return;
        }
        if (action.code === 'FINISH_MODIFICATION') {
            navigate(`/sales/orders/${order.id}/modify`);
            return;
        }
        if (action.code === 'PREPARE_DELIVERY' && action.targetId) {
            setManualTaskId(action.targetId);
            return;
        }
        if (action.code === 'RETRY_NOTIFICATION' && action.targetId) {
            const line = digitalLines.find(item => item.taskId === action.targetId);
            if (line?.digitalDeliveryMode === 'manual_service') {
                setManualTaskId(action.targetId);
                return;
            }
            if (line?.digitalDeliveryMode === 'auto_card') {
                try {
                    const response = await retryAutoCard({ variables: { id: action.targetId } });
                    if (!response.data?.retryAutoCardDelivery?.id) throw new Error('后端未返回通知任务');
                    await refreshAfterMutation('原交付通知已重新进入队列，发送结果待核实');
                } catch (cause) {
                    setActionError(toUserFacingError(cause, '重发通知失败'));
                }
                return;
            }
        }
        if (action.code === 'REPLENISH_CARDS') {
            navigate('/catalog/card-pool');
            return;
        }
        if (action.code === 'HANDLE_AFTER_SALES') {
            navigate('/sales/after-sales');
            return;
        }
        if (action.code === 'CONFIGURE_FILE') {
            navigate('/catalog/products');
            return;
        }
        document
            .getElementById(
                action.code === 'TRACK_SHIPMENT' ? 'physical-order-delivery' : 'order-payment-operations',
            )
            ?.scrollIntoView({ behavior: 'auto', block: 'start' });
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
    if (error && !data)
        return (
            <div className="flex h-full items-center justify-center bg-slate-50 p-6">
                <div className="max-w-lg rounded-2xl border border-rose-200 bg-white p-6 text-center shadow-sm">
                    <AlertCircle className="mx-auto h-8 w-8 text-rose-500" />
                    <h1 className="mt-3 text-base font-semibold text-slate-900">订单详情加载失败</h1>
                    <p className="mt-2 text-xs leading-5 text-slate-500">
                        {toUserFacingError(error, '订单详情加载失败，请稍后重试')}
                    </p>
                    <div className="mt-4 flex justify-center gap-2">
                        <AdminButton
                            type="button"
                            onClick={returnToList}
                            className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold"
                        >
                            返回列表
                        </AdminButton>
                        <AdminButton
                            type="button"
                            onClick={() => refetch()}
                            className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white"
                        >
                            重试
                        </AdminButton>
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
                    <AdminButton
                        type="button"
                        onClick={returnToList}
                        className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
                    >
                        返回订单列表
                    </AdminButton>
                </div>
            </div>
        );

    return (
        <main className="flex h-full min-w-0 flex-col overflow-hidden bg-slate-50">
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                        <AdminButton
                            type="button"
                            onClick={returnToList}
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100"
                            aria-label="返回订单列表"
                        >
                            <ArrowLeft className="h-5 w-5" />
                        </AdminButton>
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
                                <AdminButton
                                    type="button"
                                    onClick={() => void handleBeginModify()}
                                    disabled={busy}
                                    className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-40"
                                >
                                    <PencilLine className="h-3.5 w-3.5" />
                                    {order.state === 'Modifying' ? '继续修改订单' : '修改订单'}
                                </AdminButton>
                            )}
                        {canUpdateOrder && (
                            <AdminButton
                                type="button"
                                onClick={openRefund}
                                disabled={
                                    !order.processingSummary?.canRefund ||
                                    paymentsWithBalances.length === 0 ||
                                    busy
                                }
                                title={order.processingSummary?.refundBlockedReason || undefined}
                                className="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                            >
                                <RotateCcw className="h-3.5 w-3.5" />
                                申请退款
                            </AdminButton>
                        )}
                        <AdminButton
                            type="button"
                            onClick={() => window.print()}
                            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                            <Printer className="h-3.5 w-3.5" />
                            打印订单
                        </AdminButton>
                        {canUpdateOrder && order.nextStates.includes('Cancelled') && (
                            <AdminButton
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
                            </AdminButton>
                        )}
                        {canUpdateOrder && remainingPhysicalLines.length > 0 && (
                            <AdminButton
                                type="button"
                                onClick={() => {
                                    setActionError('');
                                    setIsFulfillOpen(true);
                                }}
                                disabled={
                                    !manualHandlerAvailable ||
                                    busy ||
                                    !canCreatePhysicalFulfillment(order.state)
                                }
                                title={
                                    canCreatePhysicalFulfillment(order.state)
                                        ? undefined
                                        : '订单完成付款或授权后才能发货'
                                }
                                className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                            >
                                <Truck className="h-4 w-4" />
                                创建实物发货
                            </AdminButton>
                        )}
                    </div>
                </div>
            </header>

            <div className="flex-1 overflow-y-auto p-4 sm:p-5 lg:p-6">
                <div className="mx-auto w-full max-w-[1536px] space-y-4">
                    <OrderProcessingSummaryPanel
                        summary={order.processingSummary}
                        currencyCode={order.currencyCode}
                        canOperate={canUpdateOrder}
                        busy={processingBusy}
                        onAction={action => void handleProcessingAction(action)}
                    />
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
                            <AdminButton
                                type="button"
                                onClick={() => setActionError('')}
                                className="ml-auto text-rose-500"
                                aria-label="关闭错误提示"
                            >
                                <X className="h-4 w-4" />
                            </AdminButton>
                        </div>
                    )}
                    {!manualHandlerAvailable && remainingPhysicalLines.length > 0 && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                            尚未启用手工发货功能，请先检查发货配置。
                        </div>
                    )}

                    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem] 2xl:grid-cols-[minmax(0,1fr)_24rem]">
                        <div className="min-w-0 space-y-4">
                            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
                                <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-5">
                                    <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                                        <PackageCheck className="h-4 w-4 text-blue-600" />
                                        商品明细
                                        <FeatureHelpButton topic="sales.order-items" title="商品明细" />
                                    </h2>
                                    <span className="text-xs text-slate-500">
                                        {order.lines.length} 个 SKU · {order.totalQuantity} 件
                                    </span>
                                </header>
                                <div className="mobile-scrollbar-hidden overflow-x-auto">
                                    <table className="admin-mobile-record-table w-full min-w-[640px] border-collapse text-left text-xs">
                                        <thead>
                                            <tr className="border-b border-slate-100 text-slate-400">
                                                <th scope="col" className="w-14 whitespace-nowrap px-4 py-3">
                                                    主图
                                                </th>
                                                <th
                                                    scope="col"
                                                    className="min-w-[180px] whitespace-nowrap px-4 py-3"
                                                >
                                                    商品名称
                                                </th>
                                                <th scope="col" className="w-36 whitespace-nowrap px-4 py-3">
                                                    SKU
                                                </th>
                                                <th scope="col" className="w-24 whitespace-nowrap px-4 py-3">
                                                    商品类型
                                                </th>
                                                <th
                                                    scope="col"
                                                    className="w-28 whitespace-nowrap px-4 py-3 text-right"
                                                >
                                                    含税单价
                                                </th>
                                                <th
                                                    scope="col"
                                                    className="w-16 whitespace-nowrap px-4 py-3 text-center"
                                                >
                                                    数量
                                                </th>
                                                <th
                                                    scope="col"
                                                    className="w-28 whitespace-nowrap px-4 py-3 text-right"
                                                >
                                                    小计
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {order.lines.map(line => (
                                                <tr key={line.id} className="hover:bg-slate-50">
                                                    <td data-label="主图" className="px-4 py-2.5">
                                                        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100">
                                                            {line.featuredAsset?.preview ? (
                                                                <img
                                                                    src={line.featuredAsset.preview}
                                                                    alt={getOrderProductDisplayName(
                                                                        line.productVariant,
                                                                    )}
                                                                    className="h-full w-full object-contain"
                                                                />
                                                            ) : (
                                                                <ImageIcon className="h-4 w-4 text-slate-300" />
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td
                                                        data-label="商品名称"
                                                        data-mobile-wide
                                                        className="px-4 py-2.5"
                                                    >
                                                        <span
                                                            className="block truncate font-semibold text-slate-900"
                                                            title={getOrderProductDisplayName(
                                                                line.productVariant,
                                                            )}
                                                        >
                                                            {getOrderProductDisplayName(line.productVariant)}
                                                        </span>
                                                    </td>
                                                    <td
                                                        data-label="SKU"
                                                        data-mobile-wide
                                                        className="px-4 py-2.5 font-mono text-[11px] text-slate-500"
                                                    >
                                                        <span
                                                            className="block truncate"
                                                            title={line.productVariant.sku}
                                                        >
                                                            {line.productVariant.sku}
                                                        </span>
                                                    </td>
                                                    <td
                                                        data-label="商品类型"
                                                        className="whitespace-nowrap px-4 py-2.5 text-[11px] text-slate-500"
                                                    >
                                                        {line.customFields?.fulfillmentTypeSnapshot ===
                                                        'digital'
                                                            ? '虚拟交付'
                                                            : '实物配送'}
                                                    </td>
                                                    <td
                                                        data-label="含税单价"
                                                        className="whitespace-nowrap px-4 py-2.5 text-right font-mono tabular-nums"
                                                    >
                                                        {formatMoney(
                                                            line.proratedUnitPriceWithTax,
                                                            order.currencyCode,
                                                        )}
                                                    </td>
                                                    <td
                                                        data-label="数量"
                                                        className="whitespace-nowrap px-4 py-2.5 text-center font-mono font-semibold"
                                                    >
                                                        {line.quantity}
                                                    </td>
                                                    <td
                                                        data-label="小计"
                                                        className="whitespace-nowrap px-4 py-2.5 text-right font-mono font-semibold tabular-nums text-slate-900"
                                                    >
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

                            {digitalLines.length > 0 && (
                                <section
                                    aria-label="数字商品交付"
                                    className="space-y-3 rounded-xl bg-white p-4 shadow-2xs"
                                >
                                    <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                                        <Mail className="h-4 w-4 text-blue-600" />
                                        数字商品交付
                                        <FeatureHelpButton
                                            topic="sales.manual-digital-delivery"
                                            title="数字商品交付"
                                        />
                                    </h2>
                                    <p className="text-xs text-slate-500">
                                        按商品分别准备成品、分配卡密或发布文件；本区不创建运单和物流费用。
                                    </p>
                                    {digitalLines.map(line => (
                                        <article
                                            key={line.orderLineId}
                                            className="space-y-2 rounded-lg bg-slate-50 p-3 text-xs"
                                        >
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <strong>{line.productName}</strong>
                                                <span>
                                                    {getProcessingLineLabel(line.status)} ·{' '}
                                                    {line.deliveredQuantity}/{line.requiredQuantity} 份已交付
                                                </span>
                                            </div>
                                            <p className="text-slate-500">
                                                {line.digitalDeliveryMode === 'auto_card'
                                                    ? '卡密自动交付'
                                                    : line.digitalDeliveryMode === 'file_download'
                                                      ? '私有文件领取'
                                                      : '人工成品交付'}{' '}
                                                · 交付邮箱 {line.recipientEmail || '待核实'} ·{' '}
                                                {getClaimStatusLabel(line.claimStatus)}
                                                {typeof line.claimedQuantity === 'number'
                                                    ? ` · 已领取 ${line.claimedQuantity} 份`
                                                    : ''}
                                            </p>
                                            {line.digitalDeliveryMode === 'manual_service' && line.taskId && (
                                                <AdminButton
                                                    type="button"
                                                    onClick={() => setManualTaskId(line.taskId!)}
                                                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-700"
                                                >
                                                    {line.pendingQuantity > 0
                                                        ? '准备成品 / 查看任务'
                                                        : '查看交付记录'}
                                                </AdminButton>
                                            )}
                                            {line.digitalDeliveryMode === 'auto_card' &&
                                                line.pendingQuantity > 0 && (
                                                    <p className="text-slate-500">
                                                        由统一卡密任务自动处理；缺货时补充号池，失败时重试原通知。
                                                    </p>
                                                )}
                                        </article>
                                    ))}
                                    {manualTaskId && (
                                        <div
                                            id={`order-manual-task-${order.id}-${manualTaskId}`}
                                            tabIndex={-1}
                                            aria-label="人工交付处理区"
                                            className="rounded-xl focus:outline-none"
                                        >
                                            <DeliveryEditor
                                                key={manualTaskId}
                                                id={manualTaskId}
                                                canUpdate={canUpdateOrder}
                                                onClose={() => setManualTaskId(null)}
                                                onSaved={message => {
                                                    setManualTaskId(null);
                                                    void refreshAfterMutation(message);
                                                }}
                                            />
                                        </div>
                                    )}
                                </section>
                            )}
                            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                {hasPhysicalProducts && (
                                    <section
                                        id="physical-order-delivery"
                                        aria-label="实物商品发货"
                                        className="flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-2xs"
                                    >
                                        <div className="flex flex-wrap items-center justify-between border-b border-slate-100 pb-3">
                                            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                                                <Truck className="h-4 w-4 text-blue-600" />
                                                实物商品发货与物流
                                                <FeatureHelpButton
                                                    topic="sales.fulfillment"
                                                    title="履约与物流"
                                                />
                                            </h2>
                                            {(order.processingSummary?.remainingPhysicalQuantity ?? 0) > 0 ? (
                                                <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700">
                                                    {order.processingSummary?.remainingPhysicalQuantity}{' '}
                                                    件待发
                                                </span>
                                            ) : physicalFulfillments.length > 0 ? (
                                                <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                                                    {order.processingSummary?.fulfillmentLabel ||
                                                        '结果待核实'}
                                                </span>
                                            ) : null}
                                        </div>
                                        <div className="mt-3 flex-1 space-y-2">
                                            {physicalFulfillments.length === 0 ? (
                                                <div className="flex h-24 items-center justify-center rounded-lg bg-slate-50 text-xs text-slate-400">
                                                    当前没有履约记录
                                                </div>
                                            ) : (
                                                physicalFulfillments.map(fulfillment => (
                                                    <div
                                                        key={fulfillment.id}
                                                        id={`physical-fulfillment-${fulfillment.id}`}
                                                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
                                                    >
                                                        <div className="min-w-0">
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-mono text-xs font-semibold text-slate-900">
                                                                    #{fulfillment.id}
                                                                </span>
                                                                <span className="rounded bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                                                                    {getFulfillmentStateLabel(
                                                                        fulfillment.state,
                                                                    )}
                                                                </span>
                                                            </div>
                                                            <div className="mt-1 text-[11px] text-slate-600">
                                                                <span>
                                                                    {fulfillment.method ||
                                                                        fulfillment.handlerCode}
                                                                </span>
                                                                <span className="mx-1 text-slate-300">·</span>
                                                                <span className="font-mono text-slate-500">
                                                                    {fulfillment.trackingCode || '无物流单号'}
                                                                </span>
                                                            </div>
                                                            {fulfillment.deliveryEvidence && (
                                                                <div
                                                                    className={`mt-2 rounded-md px-2 py-1.5 text-[10px] leading-4 ${
                                                                        fulfillment.deliveryEvidence
                                                                            .status === 'EXCEPTION'
                                                                            ? 'bg-rose-50 text-rose-700'
                                                                            : fulfillment.deliveryEvidence
                                                                                    .overdue
                                                                              ? 'bg-amber-50 text-amber-700'
                                                                              : 'bg-white text-slate-500'
                                                                    }`}
                                                                >
                                                                    {fulfillment.deliveryEvidence.status ===
                                                                    'EXCEPTION'
                                                                        ? `配送异常：${fulfillment.deliveryEvidence.exceptionReason ?? '待处理'}`
                                                                        : fulfillment.deliveryEvidence
                                                                                .status === 'DELIVERED'
                                                                          ? `送达凭证：${fulfillment.deliveryEvidence.proofReference ?? '-'}`
                                                                          : fulfillment.deliveryEvidence
                                                                                  .overdue
                                                                            ? '配送已超过跟进时限'
                                                                            : `运输中${fulfillment.deliveryEvidence.nextActionDueAt ? ` · ${formatDateTime(fulfillment.deliveryEvidence.nextActionDueAt)} 前跟进` : ''}`}
                                                                </div>
                                                            )}
                                                            {fulfillment.deliveryEvidence?.events
                                                                .slice(-2)
                                                                .reverse()
                                                                .map(event => (
                                                                    <div
                                                                        key={event.id}
                                                                        className="mt-1 text-[10px] leading-4 text-slate-500"
                                                                    >
                                                                        {formatDateTime(event.createdAt)} ·{' '}
                                                                        {event.actorLabel} · {event.note}
                                                                    </div>
                                                                ))}
                                                        </div>
                                                        {canUpdateOrder &&
                                                            ['Created', 'Pending'].includes(
                                                                fulfillment.state,
                                                            ) &&
                                                            fulfillment.nextStates.includes('Shipped') && (
                                                                <AdminButton
                                                                    type="button"
                                                                    disabled={processingBusy}
                                                                    title="核实并补充本包裹物流资料后发出"
                                                                    onClick={() =>
                                                                        openDeliveryAction(
                                                                            fulfillment,
                                                                            'SHIP',
                                                                        )
                                                                    }
                                                                    className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700"
                                                                >
                                                                    发出已有包裹
                                                                </AdminButton>
                                                            )}
                                                        {canUpdateOrder &&
                                                            fulfillment.state === 'Shipped' && (
                                                                <div className="flex flex-wrap justify-end gap-1.5">
                                                                    {fulfillment.deliveryEvidence?.status !==
                                                                        'EXCEPTION' && (
                                                                        <AdminButton
                                                                            type="button"
                                                                            onClick={() =>
                                                                                openDeliveryAction(
                                                                                    fulfillment,
                                                                                    'EXCEPTION',
                                                                                )
                                                                            }
                                                                            disabled={updatingDelivery}
                                                                            className="rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                                                                        >
                                                                            登记异常
                                                                        </AdminButton>
                                                                    )}
                                                                    {fulfillment.deliveryEvidence?.status ===
                                                                        'EXCEPTION' && (
                                                                        <AdminButton
                                                                            type="button"
                                                                            onClick={() =>
                                                                                openDeliveryAction(
                                                                                    fulfillment,
                                                                                    'IN_TRANSIT',
                                                                                )
                                                                            }
                                                                            disabled={updatingDelivery}
                                                                            className="rounded-lg border border-blue-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                                                                        >
                                                                            重新发运
                                                                        </AdminButton>
                                                                    )}
                                                                    <AdminButton
                                                                        type="button"
                                                                        onClick={() =>
                                                                            openDeliveryAction(
                                                                                fulfillment,
                                                                                'DELIVERED',
                                                                            )
                                                                        }
                                                                        disabled={updatingDelivery}
                                                                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-emerald-700 disabled:opacity-50"
                                                                    >
                                                                        <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
                                                                        确认送达
                                                                    </AdminButton>
                                                                </div>
                                                            )}
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </section>
                                )}

                                <div id="order-payment-operations">
                                    <NextAdminPageBlocks
                                        pageId="order-detail"
                                        entity={order as unknown as Record<string, unknown>}
                                        fallback={
                                            <section className="flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
                                                <div className="flex flex-wrap items-center justify-between border-b border-slate-100 pb-3">
                                                    <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                                                        <CreditCard className="h-4 w-4 text-blue-600" />
                                                        支付与退款
                                                        <FeatureHelpButton
                                                            topic="sales.payment"
                                                            title="支付与退款"
                                                        />
                                                    </h2>
                                                    {(order.payments ?? []).length > 0 && (
                                                        <span className="text-[11px] font-medium text-slate-500">
                                                            {order.payments?.length} 笔记录
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="mt-3 flex-1 space-y-2.5">
                                                    {(order.payments ?? []).length === 0 ? (
                                                        <div className="flex h-24 items-center justify-center rounded-lg bg-slate-50 text-xs text-slate-400">
                                                            当前没有支付记录
                                                        </div>
                                                    ) : (
                                                        order.payments?.map(payment => (
                                                            <div
                                                                key={payment.id}
                                                                className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                                                            >
                                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="text-xs font-semibold text-slate-900">
                                                                            {getPaymentMethodLabel(
                                                                                payment.method,
                                                                            )}
                                                                        </span>
                                                                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                                                                            {getPaymentStateLabel(
                                                                                payment.state,
                                                                            )}
                                                                        </span>
                                                                    </div>
                                                                    <span className="font-mono text-sm font-semibold tabular-nums text-slate-900">
                                                                        {formatMoney(
                                                                            payment.amount,
                                                                            order.currencyCode,
                                                                        )}
                                                                    </span>
                                                                </div>
                                                                <div className="mt-1 font-mono text-[10px] text-slate-400">
                                                                    流水号：
                                                                    {payment.transactionId || '后端未返回'}
                                                                </div>
                                                                {payment.refunds.length > 0 && (
                                                                    <div className="mt-2.5 space-y-1.5 border-t border-slate-200 pt-2">
                                                                        {payment.refunds.map(refund => (
                                                                            <div
                                                                                key={refund.id}
                                                                                className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-700"
                                                                            >
                                                                                <span className="truncate">
                                                                                    退款 #{refund.id} ·{' '}
                                                                                    {getRefundStateLabel(
                                                                                        refund.state,
                                                                                    )}{' '}
                                                                                    ·{' '}
                                                                                    {refund.reason ||
                                                                                        '未填写原因'}
                                                                                </span>
                                                                                <strong className="font-mono shrink-0">
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
                                        }
                                    />
                                </div>
                            </div>

                            <div
                                className="grid items-start gap-4 lg:grid-cols-2"
                                aria-label="订单补充资料与费用"
                            >
                                {orderCustomFieldDefinitions.length > 0 && (
                                    <details className="min-w-0 rounded-xl bg-white p-4 [&_textarea]:h-14 [&_textarea]:min-h-14 [&_textarea]:resize-y">
                                        <summary className="mb-3 cursor-pointer text-sm font-semibold text-slate-700">
                                            订单补充资料
                                        </summary>
                                        {orderFieldDraft.sourceChanged && (
                                            <DraftUpdateNotice onReload={orderFieldDraft.reload} />
                                        )}
                                        <DynamicCustomFieldsForm
                                            fields={orderCustomFieldDefinitions}
                                            values={orderCustomFieldValues}
                                            onChange={setOrderCustomFieldValues}
                                            disabled={!canUpdateOrder || savingCustomFields}
                                            title="订单扩展信息"
                                            columns={1}
                                            helpTopic="sales.orders"
                                            description="查看客户备注与交付资料，按需补充订单信息。"
                                            footer={
                                                canUpdateOrder ? (
                                                    <AdminButton
                                                        type="button"
                                                        onClick={() => void handleSaveCustomFields()}
                                                        disabled={
                                                            savingCustomFields ||
                                                            orderFieldDraft.sourceChanged
                                                        }
                                                        className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                                                    >
                                                        {savingCustomFields && (
                                                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                                        )}
                                                        保存扩展信息
                                                    </AdminButton>
                                                ) : null
                                            }
                                        />
                                    </details>
                                )}
                                {order.orderPlacedAt && (
                                    <OrderProfitExpensePanel
                                        orderId={order.id}
                                        targetChannelId={order.salesChannel?.id}
                                        currencyCode={order.currencyCode}
                                        canRead={canReadProfitExpenses}
                                        canUpdate={canUpdateProfitExpenses}
                                    />
                                )}
                            </div>

                            <details className="rounded-xl bg-white p-4">
                                <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                                    备注与历史记录
                                </summary>
                                <div
                                    className="mt-4 grid items-start gap-4 lg:grid-cols-2"
                                    aria-label="订单跟进记录"
                                >
                                    <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
                                        <div className="flex flex-wrap items-center justify-between border-b border-slate-100 pb-3">
                                            <div>
                                                <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                                                    <MessageSquare className="h-4 w-4 text-blue-600" />
                                                    内部备注
                                                    <FeatureHelpButton
                                                        topic="sales.orders"
                                                        title="订单内部备注"
                                                    />
                                                </h2>
                                                <p className="mt-0.5 text-[10px] text-slate-400">
                                                    仅管理员可见，共 {order.history.items.length} /{' '}
                                                    {order.history.totalItems} 条记录
                                                </p>
                                            </div>
                                        </div>
                                        {canUpdateOrder && (
                                            <div className="mt-3 flex gap-2">
                                                <AdminInput
                                                    value={newNote}
                                                    onChange={event => setNewNote(event.target.value)}
                                                    onKeyDown={event => {
                                                        if (isInputMethodKey(event.nativeEvent)) return;
                                                        if (event.key === 'Enter') handleAddNote();
                                                    }}
                                                    placeholder="输入仅管理员可见的跟进备注"
                                                    className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                                                />
                                                <AdminButton
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
                                                </AdminButton>
                                            </div>
                                        )}
                                        <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                                            {notes.length === 0 ? (
                                                <div className="rounded-lg bg-slate-50 p-4 text-center text-xs text-slate-400">
                                                    还没有内部备注
                                                </div>
                                            ) : (
                                                notes.map(note => (
                                                    <div
                                                        key={note.id}
                                                        className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs"
                                                    >
                                                        <div className="flex flex-wrap justify-between gap-2 text-[10px] text-slate-400">
                                                            <span className="font-medium text-slate-600">
                                                                {[
                                                                    note.administrator?.lastName,
                                                                    note.administrator?.firstName,
                                                                ]
                                                                    .filter(Boolean)
                                                                    .join('') || '系统管理员'}
                                                            </span>
                                                            <span>{formatDateTime(note.createdAt)}</span>
                                                        </div>
                                                        <p className="mt-1 leading-5 text-slate-800">
                                                            {String(note.data.note ?? '')}
                                                        </p>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </section>

                                    <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
                                        <div className="flex flex-wrap items-center justify-between border-b border-slate-100 pb-3">
                                            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                                                <Clock3 className="h-4 w-4 text-blue-600" />
                                                订单时间线
                                                <FeatureHelpButton topic="sales.orders" title="订单时间线" />
                                            </h2>
                                            <span className="text-[10px] text-slate-400">
                                                最近 {timeline.length} 条
                                            </span>
                                        </div>
                                        <div className="mt-3 max-h-72 overflow-y-auto pr-1">
                                            {timeline.length === 0 ? (
                                                <div className="py-6 text-center text-xs text-slate-400">
                                                    当前没有状态记录
                                                </div>
                                            ) : (
                                                <div className="relative ml-2 space-y-3 border-l-2 border-slate-100 py-1 pl-4">
                                                    {timeline.map(entry => (
                                                        <div key={entry.id} className="relative">
                                                            <div className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full border-2 border-white bg-blue-500 shadow-2xs" />
                                                            <div className="text-xs font-medium text-slate-800">
                                                                {historyLabel(entry)}
                                                            </div>
                                                            <div className="mt-0.5 text-[10px] text-slate-400">
                                                                {formatDateTime(entry.createdAt)}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </section>
                                </div>
                            </details>
                        </div>

                        <aside className="min-w-0 space-y-4">
                            <section className="rounded-xl bg-slate-950 p-4.5 text-white shadow-sm sm:p-5">
                                <div className="flex flex-wrap items-center justify-between border-b border-white/10 pb-3">
                                    <h2 className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                                        金额汇总
                                        <FeatureHelpButton topic="sales.totals" title="金额汇总" />
                                    </h2>
                                    <span className="font-mono text-[11px] text-slate-400">
                                        {order.currencyCode}
                                    </span>
                                </div>
                                <div className="mt-3 space-y-2 text-xs">
                                    <div className="flex justify-between text-slate-300">
                                        <span>商品折后小计</span>
                                        <span className="font-mono">
                                            {formatMoney(order.subTotalWithTax, order.currencyCode)}
                                        </span>
                                    </div>
                                    {hasPhysicalProducts && (
                                        <div className="flex justify-between text-slate-300">
                                            <span>实物配送费用</span>
                                            <span className="font-mono">
                                                {formatMoney(order.shippingWithTax, order.currencyCode)}
                                            </span>
                                        </div>
                                    )}
                                    {order.discounts.map((discount, index) => (
                                        <div
                                            key={`${discount.description}-${index}`}
                                            className="flex justify-between text-emerald-400"
                                        >
                                            <span className="truncate pr-2" title="已计入折后小计">
                                                {discount.description || '优惠折扣'}（已计入）
                                            </span>
                                            <span className="font-mono">
                                                {formatMoney(discount.amountWithTax, order.currencyCode)}
                                            </span>
                                        </div>
                                    ))}
                                    <div className="mt-3 flex items-baseline justify-between border-t border-white/10 pt-3 text-sm font-semibold">
                                        <span className="text-slate-200">订单合计</span>
                                        <span className="font-mono text-xl font-bold tabular-nums text-white">
                                            {formatMoney(order.totalWithTax, order.currencyCode)}
                                        </span>
                                    </div>
                                </div>
                            </section>

                            <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
                                <div className="flex flex-wrap items-center justify-between border-b border-slate-100 pb-3">
                                    <h2 className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                                        <User className="h-4 w-4 text-blue-600" />
                                        买家信息
                                        <FeatureHelpButton topic="sales.orders" title="买家信息" />
                                    </h2>
                                </div>
                                <div className="mt-3 space-y-2 text-xs">
                                    <div className="flex items-center gap-2.5">
                                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700">
                                            {getCustomerName(order.customer).slice(0, 1) || '客'}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="truncate font-semibold text-slate-900">
                                                {getCustomerName(order.customer)}
                                            </div>
                                            {order.customer?.id && (
                                                <div className="font-mono text-[10px] text-slate-400">
                                                    客户ID: {order.customer.id}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="space-y-1.5 border-t border-slate-100 pt-2 text-slate-600">
                                        <div className="flex items-center gap-2 text-[11px]">
                                            <Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                                            {order.customer?.emailAddress ? (
                                                <a
                                                    href={`mailto:${order.customer.emailAddress}`}
                                                    className="truncate text-blue-600 hover:underline"
                                                    title={order.customer.emailAddress}
                                                >
                                                    {order.customer.emailAddress}
                                                </a>
                                            ) : (
                                                <span className="text-slate-400">未留邮箱</span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2 text-[11px]">
                                            <Phone className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                                            {order.customer?.phoneNumber ||
                                            order.shippingAddress?.phoneNumber ? (
                                                <a
                                                    href={`tel:${order.customer?.phoneNumber || order.shippingAddress?.phoneNumber}`}
                                                    className="text-slate-700 hover:text-blue-600"
                                                >
                                                    {order.customer?.phoneNumber ||
                                                        order.shippingAddress?.phoneNumber}
                                                </a>
                                            ) : (
                                                <span className="text-slate-400">未留联系电话</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </section>

                            {hasPhysicalProducts && (
                                <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
                                    <div className="flex flex-wrap items-center justify-between border-b border-slate-100 pb-3">
                                        <h2 className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                                            <MapPin className="h-4 w-4 text-blue-600" />
                                            交付与配送
                                            <FeatureHelpButton topic="sales.orders" title="交付与配送" />
                                        </h2>
                                    </div>
                                    <div className="mt-3 space-y-3 text-xs">
                                        <div className="space-y-1.5 rounded-lg bg-slate-50 p-2.5 text-[11px]">
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <span className="text-slate-500">销售店铺</span>
                                                <span className="font-semibold text-slate-800">
                                                    {order.salesChannel
                                                        ? getChannelDisplayName(order.salesChannel)
                                                        : '归属待核实'}
                                                </span>
                                            </div>
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <span className="text-slate-500">配送方式</span>
                                                <span className="font-medium text-slate-700">
                                                    {order.shippingLines
                                                        .map(line => line.shippingMethod.name)
                                                        .join('、') || '无需配送'}
                                                </span>
                                            </div>
                                        </div>

                                        {!inSalesStore && (
                                            <div className="rounded-lg bg-amber-50 p-2.5 text-[11px] text-amber-800">
                                                {order.salesChannel
                                                    ? '请通过顶部店铺选择器切换到销售店铺后操作订单。'
                                                    : '历史订单归属尚未核实，暂时只能查看。'}
                                            </div>
                                        )}

                                        <div>
                                            <div className="mb-1.5 flex flex-wrap items-center justify-between">
                                                <span className="text-[11px] font-semibold text-slate-700">
                                                    收货地址
                                                </span>
                                            </div>
                                            {order.shippingAddress ? (
                                                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs leading-5 text-slate-600">
                                                    <div className="font-semibold text-slate-900">
                                                        {order.shippingAddress.fullName || '未填写姓名'}
                                                        {order.shippingAddress.phoneNumber && (
                                                            <span className="ml-2 font-normal text-slate-500">
                                                                {order.shippingAddress.phoneNumber}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {order.shippingAddress.company && (
                                                        <div className="text-[11px] text-slate-500">
                                                            {order.shippingAddress.company}
                                                        </div>
                                                    )}
                                                    <div className="mt-1 text-slate-700">
                                                        {formatAddress(order.shippingAddress)}
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="text-xs text-slate-400">未填写收货地址</div>
                                            )}
                                        </div>

                                        <div className="border-t border-slate-100 pt-2">
                                            <div className="mb-1 flex flex-wrap items-center justify-between">
                                                <span className="text-[11px] font-semibold text-slate-700">
                                                    账单地址
                                                </span>
                                                {(!order.billingAddress ||
                                                    (!order.billingAddress.fullName &&
                                                        !order.billingAddress.streetLine1) ||
                                                    (order.billingAddress.fullName ===
                                                        order.shippingAddress?.fullName &&
                                                        order.billingAddress.streetLine1 ===
                                                            order.shippingAddress?.streetLine1)) && (
                                                    <span className="text-[10px] text-slate-400">
                                                        同收货地址
                                                    </span>
                                                )}
                                            </div>
                                            {order.billingAddress &&
                                            (order.billingAddress.fullName ||
                                                order.billingAddress.streetLine1) &&
                                            (order.billingAddress.fullName !==
                                                order.shippingAddress?.fullName ||
                                                order.billingAddress.streetLine1 !==
                                                    order.shippingAddress?.streetLine1) ? (
                                                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs leading-5 text-slate-600">
                                                    <div className="font-semibold text-slate-900">
                                                        {order.billingAddress.fullName || '未填写姓名'}
                                                    </div>
                                                    <div className="mt-1 text-slate-700">
                                                        {formatAddress(order.billingAddress)}
                                                    </div>
                                                </div>
                                            ) : null}
                                        </div>
                                    </div>
                                </section>
                            )}
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
                    <AdminInput
                        value={carrier}
                        onChange={event => setCarrier(event.target.value)}
                        className="mt-1.5 w-full rounded-lg border border-slate-300 p-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                    <label className="mt-4 block text-xs font-semibold text-slate-700">真实运单号 *</label>
                    <AdminInput
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

            {canUpdateOrder && deliveryAction && (
                <ActionDialog
                    title={
                        deliveryAction.status === 'EXCEPTION'
                            ? '登记配送异常'
                            : deliveryAction.status === 'IN_TRANSIT'
                              ? '登记重新发运'
                              : deliveryAction.status === 'SHIP'
                                ? '发出已有包裹'
                                : '确认包裹送达'
                    }
                    description={
                        deliveryAction.status === 'SHIP'
                            ? `核实包裹 #${deliveryAction.fulfillment.id} 的物流资料；确认承运商已接收后再发出，失败时继续处理本包裹。`
                            : '操作会写入配送事件；确认送达还会推进履约和订单状态。'
                    }
                    icon={<PackageCheck className="h-5 w-5 text-blue-600" />}
                    busy={updatingDelivery || preparingShipment || transitioningFulfillment}
                    error={actionError}
                    onClose={() => setDeliveryAction(null)}
                    onConfirm={handleDeliveryAction}
                    confirmLabel={
                        deliveryAction.status === 'EXCEPTION'
                            ? '确认登记异常'
                            : deliveryAction.status === 'IN_TRANSIT'
                              ? '确认重新发运'
                              : deliveryAction.status === 'SHIP'
                                ? '确认包裹已发出'
                                : '保存凭证并完成'
                    }
                >
                    {['SHIP', 'IN_TRANSIT'].includes(deliveryAction.status) && (
                        <>
                            <label className="block text-xs font-semibold text-slate-700">
                                新物流公司 / 配送方式 *
                            </label>
                            <AdminInput
                                value={deliveryCarrier}
                                onChange={event => setDeliveryCarrier(event.target.value)}
                                className="mt-1.5 w-full rounded-lg border border-slate-300 p-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                            />
                            <label className="mt-4 block text-xs font-semibold text-slate-700">
                                新运单号 *
                            </label>
                            <AdminInput
                                value={deliveryTrackingCode}
                                onChange={event => setDeliveryTrackingCode(event.target.value)}
                                className="mt-1.5 w-full rounded-lg border border-slate-300 p-2.5 font-mono text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                            />
                        </>
                    )}
                    {deliveryAction.status === 'DELIVERED' && (
                        <>
                            <label className="block text-xs font-semibold text-slate-700">送达凭证 *</label>
                            <AdminInput
                                value={deliveryProof}
                                onChange={event => setDeliveryProof(event.target.value)}
                                placeholder="签收单号、物流回执编号或可追溯凭证"
                                className="mt-1.5 w-full rounded-lg border border-slate-300 p-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                            />
                        </>
                    )}
                    {deliveryAction.status !== 'SHIP' && (
                        <>
                            <label
                                className={`${deliveryAction.status === 'EXCEPTION' ? 'block' : 'mt-4 block'} text-xs font-semibold text-slate-700`}
                            >
                                操作说明 *
                            </label>
                            <AdminTextArea
                                value={deliveryNote}
                                onChange={event => setDeliveryNote(event.target.value)}
                                rows={3}
                                placeholder={
                                    deliveryAction.status === 'EXCEPTION'
                                        ? '填写退回、丢件、地址错误等实际异常'
                                        : '填写操作依据，便于客服和审计追踪'
                                }
                                className="mt-1.5 w-full rounded-lg border border-slate-300 p-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                            />
                        </>
                    )}
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
                    {order.processingSummary && (
                        <OrderRefundScopeFields
                            summary={order.processingSummary}
                            scope={refundScope}
                            quantities={refundQuantities}
                            onScopeChange={setRefundScope}
                            onQuantityChange={(lineId, quantity) =>
                                setRefundQuantities(current => ({ ...current, [lineId]: quantity }))
                            }
                        />
                    )}
                    {afterSalesId && (
                        <p className="my-3 text-xs text-slate-500">
                            本次退款将关联售后申请 #{afterSalesId}，可关联资格以服务端核验为准。
                        </p>
                    )}
                    <label className="block text-xs font-semibold text-slate-700">退款支付记录 *</label>
                    <AdminSelect
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
                                {getPaymentMethodLabel(item.payment.method)} · 可退{' '}
                                {formatMoney(item.remaining, order.currencyCode)}
                            </option>
                        ))}
                    </AdminSelect>
                    <label className="mt-4 block text-xs font-semibold text-slate-700">退款金额 *</label>
                    <AdminInput
                        value={refundAmount}
                        onChange={event => setRefundAmount(event.target.value)}
                        inputMode="decimal"
                        className="mt-1.5 w-full rounded-lg border border-slate-300 p-2.5 font-mono text-sm font-semibold outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100"
                    />
                    <label className="mt-4 block text-xs font-semibold text-slate-700">退款原因 *</label>
                    <AdminTextArea
                        value={refundReason}
                        onChange={event => setRefundReason(event.target.value)}
                        rows={3}
                        placeholder="填写客户诉求和退款依据"
                        className="mt-1.5 w-full rounded-lg border border-slate-300 p-2.5 text-sm outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100"
                    />
                    <label className="mt-4 block text-xs font-semibold text-slate-700">
                        当前管理员密码 *
                    </label>
                    <AdminInput
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
                    <AdminTextArea
                        value={cancelReason}
                        onChange={event => setCancelReason(event.target.value)}
                        rows={4}
                        placeholder="填写取消原因，便于审计和客服跟进"
                        className="mt-1.5 w-full rounded-lg border border-slate-300 p-2.5 text-sm outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100"
                    />
                    <label className="mt-4 block text-xs font-semibold text-slate-700">
                        当前管理员密码 *
                    </label>
                    <AdminInput
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
                <form
                    onSubmit={event => {
                        event.preventDefault();
                        if (!busy) onConfirm();
                    }}
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
                        <AdminButton
                            type="button"
                            onClick={onClose}
                            disabled={busy}
                            className="text-slate-400 hover:text-slate-700"
                            aria-label="关闭"
                        >
                            <X className="h-5 w-5" />
                        </AdminButton>
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
                        <AdminButton
                            type="button"
                            onClick={onClose}
                            disabled={busy}
                            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
                        >
                            取消
                        </AdminButton>
                        <AdminButton
                            type="submit"
                            disabled={busy}
                            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                            {busy && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                            {confirmLabel}
                        </AdminButton>
                    </footer>
                </form>
            </AccessibleDialogSurface>
        </div>
    );
}
