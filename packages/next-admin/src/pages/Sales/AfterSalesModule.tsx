import { useMutation, useQuery } from '@apollo/client/react';
import {
    AlertCircle,
    Check,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    CircleDollarSign,
    Clock3,
    FileSearch,
    RefreshCw,
    Search,
    X,
    XCircle,
} from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getSystemLabel } from '../../../../common/src/display-localization';
import { ADMIN_API_URL } from '../../apollo';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { PageSizeSelect } from '../../components/PageSizeSelect';
import { GET_STOCK_LOCATIONS } from '../../graphql/catalog-admin.graphql';
import {
    GET_AFTER_SALES_REQUESTS,
    INSPECT_AFTER_SALES_RETURN,
    RECEIVE_AFTER_SALES_RETURN,
    TRANSITION_AFTER_SALES_REQUEST,
    UPDATE_AFTER_SALES_REPLACEMENT,
} from '../../graphql/sales.graphql';
import { usePageSize } from '../../hooks/use-page-size';
import { useUrlTab } from '../../hooks/use-url-tab';
import { toUserFacingError } from '../../utils/user-facing-error';
import {
    formatDateTime,
    formatMoney,
    getOrderStateLabel,
    majorInputToMoney,
    moneyToMajorInput,
} from './sales-utils';

type AfterSalesTab = 'ALL' | 'EXCEPTIONS' | 'PENDING' | 'APPROVED' | 'COMPLETED' | 'REJECTED';
const AFTER_SALES_TABS = {
    all: 'ALL',
    exceptions: 'EXCEPTIONS',
    pending: 'PENDING',
    approved: 'APPROVED',
    completed: 'COMPLETED',
    rejected: 'REJECTED',
} as const;
type AfterSalesState = Exclude<AfterSalesTab, 'ALL' | 'EXCEPTIONS'> | 'CANCELLED';
type ReturnStatus = 'NOT_REQUIRED' | 'AWAITING_SHIPMENT' | 'IN_TRANSIT' | 'RECEIVED' | 'INSPECTED';
type ReplacementStatus = 'NOT_REQUIRED' | 'PENDING' | 'SHIPPED' | 'EXCEPTION' | 'DELIVERED';

interface RefundItem {
    id: string;
    state: string;
    total: number;
    reason?: string | null;
    transactionId?: string | null;
}

interface AfterSalesRequest {
    evidence?: Array<{ id: string; available: boolean; previewUrl: string | null; expiresAt: string | null }>;
    id: string;
    createdAt: string;
    updatedAt: string;
    code: string;
    type: 'REFUND_ONLY' | 'RETURN_AND_REFUND' | 'EXCHANGE' | 'RESHIP';
    state: AfterSalesState;
    reason: string;
    description: string;
    currencyCode: string;
    requestedAmount: number;
    approvedAmount?: number | null;
    resolution?: string | null;
    returnStatus: ReturnStatus;
    returnInstructions?: string | null;
    returnCarrier?: string | null;
    returnTrackingCode?: string | null;
    returnShippedAt?: string | null;
    returnReceivedAt?: string | null;
    inspectedAt?: string | null;
    inspectionNote?: string | null;
    replacementStatus: ReplacementStatus;
    replacementCarrier?: string | null;
    replacementTrackingCode?: string | null;
    replacementProofReference?: string | null;
    replacementException?: string | null;
    replacementShippedAt?: string | null;
    replacementDeliveredAt?: string | null;
    nextActionDueAt?: string | null;
    overdue: boolean;
    customerName: string;
    customerEmail: string;
    respondedAt?: string | null;
    completedAt?: string | null;
    cancelledAt?: string | null;
    refundedAt?: string | null;
    refund?: RefundItem | null;
    order: {
        id: string;
        code: string;
        state: string;
        totalWithTax: number;
        currencyCode: string;
        payments?: Array<{
            id: string;
            state: string;
            method: string;
            amount: number;
            refunds: RefundItem[];
        }> | null;
    };
    items: Array<{
        id: string;
        orderLineId?: string | null;
        quantity: number;
        unitPriceWithTax: number;
        lineAmountWithTax: number;
        productName: string;
        sku: string;
        fulfillmentType: string;
        acceptedReturnQuantity: number;
        rejectedReturnQuantity: number;
        returnLotCode?: string | null;
        inventoryOperationId?: string | null;
        returnStockLocation?: { id: string; name: string } | null;
    }>;
    events: Array<{
        id: string;
        createdAt: string;
        state: AfterSalesState;
        eventType: string;
        actorType: 'CUSTOMER' | 'ADMIN' | 'SYSTEM';
        actorLabel: string;
        actorId?: string | null;
        note: string;
    }>;
}

interface AfterSalesData {
    afterSalesRequests: { items: AfterSalesRequest[]; totalItems: number };
}

const EMPTY_REQUESTS: AfterSalesRequest[] = [];
const tabs: Array<{ id: AfterSalesTab; label: string }> = [
    { id: 'ALL', label: '全部工单' },
    { id: 'EXCEPTIONS', label: '超时/异常' },
    { id: 'PENDING', label: '待审核' },
    { id: 'APPROVED', label: '待退款/归档' },
    { id: 'COMPLETED', label: '已完成' },
    { id: 'REJECTED', label: '已驳回' },
];
const stateLabels: Record<AfterSalesState, string> = {
    PENDING: '待商家审核',
    APPROVED: '已通过，待退款完成',
    REJECTED: '已驳回',
    CANCELLED: '客户已撤销',
    COMPLETED: '已完成',
};
const stateClasses: Record<AfterSalesState, string> = {
    PENDING: 'border-amber-200 bg-amber-50 text-amber-700',
    APPROVED: 'border-blue-200 bg-blue-50 text-blue-700',
    REJECTED: 'border-rose-200 bg-rose-50 text-rose-700',
    CANCELLED: 'border-slate-200 bg-slate-100 text-slate-600',
    COMPLETED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
};
const typeLabels = {
    REFUND_ONLY: '仅退款',
    RETURN_AND_REFUND: '退货退款',
    EXCHANGE: '换货',
    RESHIP: '补发',
};
const returnStatusLabels: Record<ReturnStatus, string> = {
    NOT_REQUIRED: '无需退货',
    AWAITING_SHIPMENT: '等待客户寄回',
    IN_TRANSIT: '退货运输中',
    RECEIVED: '仓库已签收',
    INSPECTED: '质检已完成',
};
const replacementStatusLabels: Record<ReplacementStatus, string> = {
    NOT_REQUIRED: '无需换补发',
    PENDING: '等待换补发',
    SHIPPED: '换补发运输中',
    EXCEPTION: '换补发异常',
    DELIVERED: '换补发已送达',
};
const reasonLabels: Record<string, string> = {
    CHANGED_MIND: '不想要了',
    NOT_AS_DESCRIBED: '商品与描述不符',
    DAMAGED: '商品损坏',
    WRONG_ITEM: '发错商品',
    DELIVERY_ISSUE: '配送问题',
    DIGITAL_CONTENT_ISSUE: '数字内容异常',
    OTHER: '其他原因',
};

export function AfterSalesModule() {
    const location = useLocation();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useUrlTab<AfterSalesTab>(AFTER_SALES_TABS, 'all');
    const [page, setPage] = useState(0);
    const [pageSize, setPageSize] = usePageSize(setPage);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedRequest, setSelectedRequest] = useState<AfterSalesRequest | null>(null);
    const [resolution, setResolution] = useState('');
    const [approvedAmount, setApprovedAmount] = useState('');
    const [refundId, setRefundId] = useState('');
    const [returnInstructions, setReturnInstructions] = useState('');
    const [workflowNote, setWorkflowNote] = useState('');
    const [workflowCarrier, setWorkflowCarrier] = useState('');
    const [workflowTrackingCode, setWorkflowTrackingCode] = useState('');
    const [workflowProof, setWorkflowProof] = useState('');
    const [inspection, setInspection] = useState<
        Record<
            string,
            { acceptedQuantity: number; rejectedQuantity: number; stockLocationId: string; lotCode: string }
        >
    >({});
    const [notification, setNotification] = useState('');
    const [actionError, setActionError] = useState('');

    const { data, loading, error, refetch } = useQuery<AfterSalesData>(GET_AFTER_SALES_REQUESTS, {
        variables: {
            options: {
                skip: page * pageSize,
                take: pageSize,
                ...(activeTab === 'ALL' || activeTab === 'EXCEPTIONS' ? {} : { state: activeTab }),
                ...(activeTab === 'EXCEPTIONS' ? { exceptionsOnly: true } : {}),
                ...(searchTerm.trim() ? { search: searchTerm.trim() } : {}),
            },
        },
        fetchPolicy: 'cache-and-network',
        notifyOnNetworkStatusChange: true,
    });
    const [transitionRequest, { loading: transitioning }] = useMutation<{
        transitionAfterSalesRequest: AfterSalesRequest;
    }>(TRANSITION_AFTER_SALES_REQUEST);
    const [receiveReturn, { loading: receivingReturn }] = useMutation<{
        receiveAfterSalesReturn: AfterSalesRequest;
    }>(RECEIVE_AFTER_SALES_RETURN);
    const [inspectReturn, { loading: inspectingReturn }] = useMutation<{
        inspectAfterSalesReturn: AfterSalesRequest;
    }>(INSPECT_AFTER_SALES_RETURN);
    const [updateReplacement, { loading: updatingReplacement }] = useMutation<{
        updateAfterSalesReplacement: AfterSalesRequest;
    }>(UPDATE_AFTER_SALES_REPLACEMENT);
    const { data: stockLocationData } = useQuery<{
        stockLocations: { items: Array<{ id: string; name: string }> };
    }>(GET_STOCK_LOCATIONS, { variables: { options: { take: 200 } } });
    const workflowBusy = transitioning || receivingReturn || inspectingReturn || updatingReplacement;

    const requests = data?.afterSalesRequests.items ?? EMPTY_REQUESTS;
    const totalItems = data?.afterSalesRequests.totalItems ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const visibleRequests = requests;
    const settledRefunds = useMemo(
        () =>
            (selectedRequest?.order.payments ?? [])
                .flatMap(payment =>
                    payment.refunds.map(refund => ({ ...refund, paymentMethod: payment.method })),
                )
                .filter(refund => refund.state === 'Settled'),
        [selectedRequest],
    );
    const completionReady = selectedRequest
        ? (!afterSalesRequiresReturn(selectedRequest.type) || selectedRequest.returnStatus === 'INSPECTED') &&
          (!afterSalesRequiresReplacement(selectedRequest.type) ||
              selectedRequest.replacementStatus === 'DELIVERED')
        : false;

    const showNotice = (message: string) => {
        setNotification(message);
        window.setTimeout(() => setNotification(''), 4000);
    };
    const openRequest = (request: AfterSalesRequest) => {
        setSelectedRequest(request);
        setResolution(request.resolution ?? '');
        setApprovedAmount(
            moneyToMajorInput(request.approvedAmount ?? request.requestedAmount, request.currencyCode),
        );
        const firstSettledRefund = (request.order.payments ?? [])
            .flatMap(payment => payment.refunds)
            .find(refund => refund.state === 'Settled');
        setRefundId(request.refund?.id ?? firstSettledRefund?.id ?? '');
        setReturnInstructions(request.returnInstructions ?? '');
        setWorkflowNote('');
        setWorkflowCarrier(request.replacementCarrier ?? '');
        setWorkflowTrackingCode(request.replacementTrackingCode ?? '');
        setWorkflowProof(request.replacementProofReference ?? '');
        setInspection(
            Object.fromEntries(
                request.items.map(item => [
                    item.id,
                    {
                        acceptedQuantity: item.acceptedReturnQuantity || item.quantity,
                        rejectedQuantity: item.rejectedReturnQuantity,
                        stockLocationId:
                            item.returnStockLocation?.id ??
                            stockLocationData?.stockLocations.items[0]?.id ??
                            '',
                        lotCode: item.returnLotCode ?? `RETURN-${request.code}-${item.sku}`.slice(0, 80),
                    },
                ]),
            ),
        );
        setActionError('');
    };

    const handleTransition = async (nextState: 'APPROVED' | 'REJECTED' | 'COMPLETED') => {
        if (!selectedRequest) return;
        if (!resolution.trim()) {
            setActionError(nextState === 'REJECTED' ? '请填写驳回原因' : '请填写处理说明');
            return;
        }
        const input: Record<string, unknown> = {
            id: selectedRequest.id,
            state: nextState,
            resolution: resolution.trim(),
        };
        if (nextState === 'APPROVED') {
            const amount = majorInputToMoney(approvedAmount, selectedRequest.currencyCode);
            if (amount == null || amount < 0 || amount > selectedRequest.requestedAmount) {
                setActionError(
                    `通过金额必须在 0 到 ${formatMoney(selectedRequest.requestedAmount, selectedRequest.currencyCode)} 之间`,
                );
                return;
            }
            input.approvedAmount = amount;
            if (selectedRequest.type === 'RETURN_AND_REFUND' || selectedRequest.type === 'EXCHANGE') {
                if (!returnInstructions.trim()) {
                    setActionError('退货或换货审核通过时必须填写退货地址与寄回说明');
                    return;
                }
                input.returnInstructions = returnInstructions.trim();
            }
        }
        if (nextState === 'COMPLETED') {
            const mustLinkRefund = (selectedRequest.approvedAmount ?? 0) > 0;
            if (mustLinkRefund && !refundId) {
                setActionError('有退款金额的工单必须关联一笔已成功的真实退款后才能完成');
                return;
            }
            if (refundId) input.refundId = refundId;
        }

        try {
            const response = await transitionRequest({ variables: { input } });
            const updated = response.data?.transitionAfterSalesRequest;
            if (!updated) {
                setActionError('后端未返回更新后的工单');
                return;
            }
            setSelectedRequest(updated);
            setActionError('');
            await refetch();
            showNotice(
                nextState === 'APPROVED'
                    ? '售后申请已审核通过'
                    : nextState === 'REJECTED'
                      ? '售后申请已驳回'
                      : '售后工单已关联真实退款并完成',
            );
        } catch (mutationError) {
            setActionError(toUserFacingError(mutationError, '售后状态更新失败，请稍后重试'));
        }
    };

    const applyWorkflowResult = async (updated: AfterSalesRequest | undefined, message: string) => {
        if (!updated) throw new Error('后端未返回更新后的售后工单');
        setSelectedRequest(updated);
        setActionError('');
        await refetch();
        showNotice(message);
    };

    const handleReceiveReturn = async () => {
        if (!selectedRequest || !workflowNote.trim()) {
            setActionError('请填写退货签收说明');
            return;
        }
        try {
            const response = await receiveReturn({
                variables: {
                    input: {
                        id: selectedRequest.id,
                        note: workflowNote.trim(),
                        idempotencyKey: operationKey('return-received'),
                    },
                },
            });
            await applyWorkflowResult(response.data?.receiveAfterSalesReturn, '退货已签收，等待质检');
        } catch (mutationError) {
            setActionError(toUserFacingError(mutationError, '退货签收失败'));
        }
    };

    const handleInspectReturn = async () => {
        if (!selectedRequest || !workflowNote.trim()) {
            setActionError('请填写质检说明');
            return;
        }
        const items = selectedRequest.items.map(item => ({ item, draft: inspection[item.id] }));
        const invalid = items.find(
            ({ item, draft }) =>
                !draft ||
                draft.acceptedQuantity < 0 ||
                draft.rejectedQuantity < 0 ||
                draft.acceptedQuantity + draft.rejectedQuantity !== item.quantity ||
                (draft.acceptedQuantity > 0 && (!draft.stockLocationId || !draft.lotCode.trim())),
        );
        if (invalid) {
            setActionError(`商品 ${invalid.item.productName} 的验收/拒收数量或入库信息不完整`);
            return;
        }
        try {
            const response = await inspectReturn({
                variables: {
                    input: {
                        id: selectedRequest.id,
                        note: workflowNote.trim(),
                        idempotencyKey: operationKey('return-inspected'),
                        items: items.map(({ item, draft }) => ({
                            itemId: item.id,
                            acceptedQuantity: draft.acceptedQuantity,
                            rejectedQuantity: draft.rejectedQuantity,
                            ...(draft.acceptedQuantity > 0
                                ? {
                                      stockLocationId: draft.stockLocationId,
                                      lotCode: draft.lotCode.trim(),
                                  }
                                : {}),
                        })),
                    },
                },
            });
            await applyWorkflowResult(
                response.data?.inspectAfterSalesReturn,
                '退货质检完成，合格数量已审计入库',
            );
        } catch (mutationError) {
            setActionError(toUserFacingError(mutationError, '退货质检入库失败'));
        }
    };

    const handleReplacement = async (status: 'SHIPPED' | 'EXCEPTION' | 'DELIVERED') => {
        if (!selectedRequest || !workflowNote.trim()) {
            setActionError('请填写换货/补发处理说明');
            return;
        }
        if (status === 'SHIPPED' && (!workflowCarrier.trim() || !workflowTrackingCode.trim())) {
            setActionError('登记发货时必须填写承运商和运单号');
            return;
        }
        if (status === 'DELIVERED' && !workflowProof.trim()) {
            setActionError('确认送达时必须填写送达凭证引用');
            return;
        }
        try {
            const response = await updateReplacement({
                variables: {
                    input: {
                        id: selectedRequest.id,
                        status,
                        note: workflowNote.trim(),
                        idempotencyKey: operationKey(`replacement-${status.toLowerCase()}`),
                        ...(status === 'SHIPPED'
                            ? {
                                  carrier: workflowCarrier.trim(),
                                  trackingCode: workflowTrackingCode.trim(),
                              }
                            : {}),
                        ...(status === 'DELIVERED' ? { proofReference: workflowProof.trim() } : {}),
                    },
                },
            });
            await applyWorkflowResult(
                response.data?.updateAfterSalesReplacement,
                status === 'SHIPPED'
                    ? '换货/补发已登记发出'
                    : status === 'EXCEPTION'
                      ? '配送异常已进入例外队列'
                      : '换货/补发已确认送达',
            );
        } catch (mutationError) {
            setActionError(toUserFacingError(mutationError, '换货/补发状态更新失败'));
        }
    };

    return (
        <div className="flex h-full flex-col bg-slate-50">
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-5 sm:px-8">
                <div className="flex w-full flex-wrap items-center justify-between gap-4">
                    <div>
                        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-950">
                            售后与退款工单
                            <FeatureHelpButton topic="sales.after-sales" title="售后与退款工单" />
                        </h1>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                            审核买家售后申请，核对真实退款记录后完成归档
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => refetch()}
                        disabled={loading}
                        className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                        刷新
                    </button>
                </div>
            </header>

            <nav
                aria-label="售后状态筛选"
                className="scrollbar-hidden shrink-0 overflow-x-auto border-b border-slate-200 bg-white px-5 sm:px-8"
            >
                <div className="flex w-full min-w-max gap-6">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            type="button"
                            aria-current={activeTab === tab.id ? 'page' : undefined}
                            onClick={() => {
                                setActiveTab(tab.id);
                                setPage(0);
                                setSelectedRequest(null);
                            }}
                            className={`border-b-2 py-3.5 text-xs font-semibold transition ${activeTab === tab.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-900'}`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </nav>

            <div className="flex-1 overflow-y-auto p-5 sm:p-8">
                <div className="w-full max-w-none space-y-4">
                    {notification && (
                        <div
                            role="status"
                            className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-800"
                        >
                            <Check className="h-4 w-4" />
                            {notification}
                        </div>
                    )}
                    {error && (
                        <div
                            role="alert"
                            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800"
                        >
                            <span className="flex items-center gap-2">
                                <AlertCircle className="h-4 w-4" />
                                {toUserFacingError(error, '售后工单加载失败，请稍后重试')}
                            </span>
                            <button
                                type="button"
                                onClick={() => refetch()}
                                className="rounded-lg bg-rose-600 px-3 py-1.5 font-semibold text-white"
                            >
                                重试
                            </button>
                        </div>
                    )}
                    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/70 p-4">
                            <div className="relative min-w-[17rem] flex-1 sm:max-w-md">
                                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                                <input
                                    value={searchTerm}
                                    onChange={event => {
                                        setSearchTerm(event.target.value);
                                        setPage(0);
                                    }}
                                    aria-label="搜索售后工单"
                                    placeholder="搜索工单号、订单号、买家或邮箱"
                                    className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-9 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                                />
                                {searchTerm && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSearchTerm('');
                                            setPage(0);
                                        }}
                                        className="absolute right-2.5 top-2 text-slate-400"
                                        aria-label="清空搜索"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                )}
                            </div>
                            <span className="text-xs text-slate-500">
                                当前筛选共 <strong className="font-mono text-slate-900">{totalItems}</strong>{' '}
                                笔
                            </span>
                        </div>
                        {loading && !data ? (
                            <div className="space-y-3 p-6">
                                {[1, 2, 3, 4, 5].map(item => (
                                    <div key={item} className="h-12 animate-pulse rounded-lg bg-slate-100" />
                                ))}
                            </div>
                        ) : !error && visibleRequests.length === 0 ? (
                            <div className="flex min-h-80 flex-col items-center justify-center px-6 text-center">
                                <FileSearch className="h-9 w-9 text-slate-300" />
                                <h2 className="mt-3 text-sm font-semibold text-slate-800">
                                    没有匹配的售后工单
                                </h2>
                                <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">
                                    当前状态或当前页搜索条件下没有数据，不会展示示例工单。
                                </p>
                            </div>
                        ) : (
                            visibleRequests.length > 0 && (
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[1540px] border-collapse text-left text-xs">
                                        <thead>
                                            <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-500">
                                                <th
                                                    scope="col"
                                                    className="sticky left-0 z-20 w-44 whitespace-nowrap bg-slate-50 px-3 py-3"
                                                >
                                                    工单号
                                                </th>
                                                <th scope="col" className="w-44 whitespace-nowrap px-3 py-3">
                                                    订单号
                                                </th>
                                                <th scope="col" className="w-36 whitespace-nowrap px-3 py-3">
                                                    买家
                                                </th>
                                                <th scope="col" className="w-56 whitespace-nowrap px-3 py-3">
                                                    邮箱
                                                </th>
                                                <th scope="col" className="w-28 whitespace-nowrap px-3 py-3">
                                                    售后类型
                                                </th>
                                                <th scope="col" className="w-52 whitespace-nowrap px-3 py-3">
                                                    原因
                                                </th>
                                                <th scope="col" className="w-32 whitespace-nowrap px-3 py-3">
                                                    申请金额
                                                </th>
                                                <th scope="col" className="w-44 whitespace-nowrap px-3 py-3">
                                                    状态
                                                </th>
                                                <th scope="col" className="w-40 whitespace-nowrap px-3 py-3">
                                                    申请时间
                                                </th>
                                                <th
                                                    scope="col"
                                                    className="sticky right-0 z-20 w-28 whitespace-nowrap border-l border-slate-200 bg-slate-50 px-3 py-3 text-right"
                                                >
                                                    操作
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {visibleRequests.map(request => (
                                                <tr
                                                    key={request.id}
                                                    className="group h-[52px] hover:bg-slate-50/80"
                                                >
                                                    <td className="sticky left-0 z-10 h-[52px] max-w-44 bg-white px-3 py-0 group-hover:bg-slate-50">
                                                        <button
                                                            type="button"
                                                            onClick={() => openRequest(request)}
                                                            className="block max-w-40 truncate whitespace-nowrap font-mono text-xs font-bold text-slate-950 hover:text-blue-700"
                                                            title={request.code}
                                                        >
                                                            {request.code}
                                                        </button>
                                                    </td>
                                                    <td className="h-[52px] max-w-44 px-3 py-0">
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                navigate(
                                                                    `/sales/orders/${request.order.id}`,
                                                                    {
                                                                        state: {
                                                                            returnTo: `${location.pathname}${location.search}`,
                                                                        },
                                                                    },
                                                                )
                                                            }
                                                            className="block max-w-40 truncate whitespace-nowrap font-mono text-[10px] text-blue-600 hover:underline"
                                                            title={request.order.code}
                                                        >
                                                            {request.order.code}
                                                        </button>
                                                    </td>
                                                    <td className="h-[52px] max-w-36 px-3 py-0">
                                                        <span
                                                            className="block truncate font-semibold text-slate-900"
                                                            title={request.customerName}
                                                        >
                                                            {request.customerName}
                                                        </span>
                                                    </td>
                                                    <td className="h-[52px] max-w-56 px-3 py-0">
                                                        <span
                                                            className="block truncate text-slate-500"
                                                            title={request.customerEmail}
                                                        >
                                                            {request.customerEmail}
                                                        </span>
                                                    </td>
                                                    <td className="h-[52px] whitespace-nowrap px-3 py-0 font-semibold text-slate-800">
                                                        {typeLabels[request.type]}
                                                    </td>
                                                    <td className="h-[52px] max-w-52 px-3 py-0">
                                                        <span
                                                            className="block truncate text-slate-500"
                                                            title={getSystemLabel(
                                                                request.reason,
                                                                reasonLabels,
                                                                'zh',
                                                                'reason',
                                                            )}
                                                        >
                                                            {getSystemLabel(
                                                                request.reason,
                                                                reasonLabels,
                                                                'zh',
                                                                'reason',
                                                            )}
                                                        </span>
                                                    </td>
                                                    <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono text-xs font-bold tabular-nums text-slate-950">
                                                        {formatMoney(
                                                            request.requestedAmount,
                                                            request.currencyCode,
                                                        )}
                                                    </td>
                                                    <td className="h-[52px] whitespace-nowrap px-3 py-0">
                                                        <span
                                                            className={`inline-flex whitespace-nowrap rounded-md border px-2 py-1 text-[10px] font-semibold ${stateClasses[request.state]}`}
                                                        >
                                                            {stateLabels[request.state]}
                                                        </span>
                                                    </td>
                                                    <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono text-[10px] text-slate-500">
                                                        {formatDateTime(request.createdAt)}
                                                    </td>
                                                    <td className="sticky right-0 z-10 h-[52px] whitespace-nowrap border-l border-slate-100 bg-white px-3 py-0 text-right group-hover:bg-slate-50">
                                                        <button
                                                            type="button"
                                                            onClick={() => openRequest(request)}
                                                            className="whitespace-nowrap rounded-lg bg-blue-50 px-3 py-1.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-100"
                                                        >
                                                            审核详情
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )
                        )}
                        <div className="flex flex-wrap gap-y-3 gap-x-4 items-center justify-between border-t border-slate-200 bg-slate-50/60 px-4 py-3 text-xs text-slate-500">
                            <span>
                                第 {page + 1} / {totalPages} 页，共 {totalItems} 笔
                            </span>
                            <div className="flex flex-wrap items-center gap-1.5">
                                <PageSizeSelect
                                    pageSize={pageSize}
                                    onPageSizeChange={setPageSize}
                                    disabled={loading}
                                />
                                <button
                                    type="button"
                                    onClick={() => setPage(current => Math.max(0, current - 1))}
                                    disabled={loading || page === 0}
                                    className="rounded-lg border border-slate-300 bg-white p-1.5 disabled:opacity-40"
                                    aria-label="上一页"
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPage(current => Math.min(totalPages - 1, current + 1))}
                                    disabled={loading || page >= totalPages - 1}
                                    className="rounded-lg border border-slate-300 bg-white p-1.5 disabled:opacity-40"
                                    aria-label="下一页"
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </button>
                            </div>
                        </div>
                    </section>
                </div>
            </div>

            {selectedRequest && (
                <div
                    className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 backdrop-blur-xs"
                    onClick={() => !workflowBusy && setSelectedRequest(null)}
                >
                    <AccessibleDialogSurface
                        accessibleName="售后工单详情"
                        onRequestClose={() => {
                            if (!workflowBusy) setSelectedRequest(null);
                        }}
                        className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl"
                        onClick={event => event.stopPropagation()}
                    >
                        <header className="flex items-start justify-between border-b border-slate-200 bg-slate-50 px-6 py-5">
                            <div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <h2
                                        id="after-sales-detail-title"
                                        className="font-mono text-base font-semibold text-slate-950"
                                    >
                                        {selectedRequest.code}
                                    </h2>
                                    <span
                                        className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${stateClasses[selectedRequest.state]}`}
                                    >
                                        {stateLabels[selectedRequest.state]}
                                    </span>
                                </div>
                                <p className="mt-1 text-xs text-slate-500">
                                    申请于 {formatDateTime(selectedRequest.createdAt)}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSelectedRequest(null)}
                                disabled={workflowBusy}
                                className="text-slate-400 hover:text-slate-700"
                                aria-label="关闭"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </header>
                        <div className="flex-1 space-y-5 overflow-y-auto p-6">
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                                    <div className="text-[10px] font-semibold text-slate-400">关联订单</div>
                                    <button
                                        type="button"
                                        onClick={() =>
                                            navigate(`/sales/orders/${selectedRequest.order.id}`, {
                                                state: { returnTo: `${location.pathname}${location.search}` },
                                            })
                                        }
                                        className="mt-2 font-mono text-sm font-semibold text-blue-700 hover:underline"
                                    >
                                        {selectedRequest.order.code}
                                    </button>
                                    <div className="mt-1 text-[11px] text-slate-500">
                                        订单状态 {getOrderStateLabel(selectedRequest.order.state)}
                                    </div>
                                </div>
                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                                    <div className="text-[10px] font-semibold text-slate-400">申请金额</div>
                                    <div className="mt-2 font-mono text-xl font-semibold tabular-nums text-slate-950">
                                        {formatMoney(
                                            selectedRequest.requestedAmount,
                                            selectedRequest.currencyCode,
                                        )}
                                    </div>
                                    {selectedRequest.approvedAmount != null && (
                                        <div className="mt-1 text-[11px] text-slate-500">
                                            通过金额{' '}
                                            {formatMoney(
                                                selectedRequest.approvedAmount,
                                                selectedRequest.currencyCode,
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                            <section>
                                <h3 className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                                    买家诉求
                                    <FeatureHelpButton topic="sales.after-sales" title="买家诉求" />
                                </h3>
                                <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-6 text-amber-900">
                                    <div className="font-semibold">
                                        {typeLabels[selectedRequest.type]} ·{' '}
                                        {getSystemLabel(selectedRequest.reason, reasonLabels, 'zh', 'reason')}
                                    </div>
                                    <p className="mt-1 whitespace-pre-wrap">{selectedRequest.description}</p>
                                </div>
                                {!!selectedRequest.evidence?.length && (
                                    <div className="mt-4 space-y-2">
                                        <div className="flex items-center justify-between gap-3">
                                            <h4 className="text-xs font-semibold text-slate-900">
                                                买家图片凭证
                                                <FeatureHelpButton
                                                    topic="sales.after-sales"
                                                    title="买家图片凭证"
                                                />
                                            </h4>
                                            <button
                                                type="button"
                                                disabled={loading}
                                                className="text-xs text-slate-600 hover:text-slate-900 disabled:opacity-50"
                                                onClick={() => {
                                                    const id = selectedRequest.id;
                                                    void refetch()
                                                        .then(result => {
                                                            const current =
                                                                result.data?.afterSalesRequests.items.find(
                                                                    item => item.id === id,
                                                                );
                                                            if (current) setSelectedRequest(current);
                                                        })
                                                        .catch(() => setActionError('凭证刷新失败，请重试'));
                                                }}
                                            >
                                                刷新图片
                                            </button>
                                        </div>
                                        <div className="grid max-w-md grid-cols-3 gap-3">
                                            {selectedRequest.evidence.map((image, index) => {
                                                const url =
                                                    image.available &&
                                                    image.previewUrl?.startsWith('/after-sales/evidence/')
                                                        ? new URL(
                                                              image.previewUrl,
                                                              new URL(ADMIN_API_URL, window.location.origin),
                                                          ).href
                                                        : null;
                                                return url ? (
                                                    <a
                                                        key={image.id}
                                                        href={url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="block aspect-square overflow-hidden rounded-lg bg-slate-100 focus-visible:outline focus-visible:outline-2"
                                                        aria-label={`查看买家凭证 ${index + 1}`}
                                                    >
                                                        <img
                                                            src={url}
                                                            alt={`买家凭证 ${index + 1}`}
                                                            className="h-full w-full object-contain"
                                                            loading="lazy"
                                                        />
                                                    </a>
                                                ) : (
                                                    <span key={image.id} className="text-xs text-slate-500">
                                                        凭证已过保留期或已移除
                                                    </span>
                                                );
                                            })}
                                        </div>
                                        <p className="text-xs text-slate-500">
                                            凭证仅供有权限的人员查看，工单关闭后保留 180 天。
                                        </p>
                                    </div>
                                )}
                            </section>
                            <section>
                                <h3 className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                                    涉及商品
                                    <FeatureHelpButton topic="sales.after-sales" title="售后涉及商品" />
                                </h3>
                                <div className="mt-2 space-y-2">
                                    {selectedRequest.items.map(item => (
                                        <div
                                            key={item.id}
                                            className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-xs"
                                        >
                                            <div>
                                                <div className="font-semibold text-slate-900">
                                                    {item.productName}
                                                </div>
                                                <div className="mt-0.5 font-mono text-[10px] text-slate-400">
                                                    {item.sku} ·{' '}
                                                    {item.fulfillmentType === 'digital'
                                                        ? '虚拟交付'
                                                        : '实物配送'}{' '}
                                                    · × {item.quantity}
                                                </div>
                                            </div>
                                            <strong className="font-mono tabular-nums">
                                                {formatMoney(
                                                    item.lineAmountWithTax,
                                                    selectedRequest.currencyCode,
                                                )}
                                            </strong>
                                        </div>
                                    ))}
                                </div>
                            </section>
                            {selectedRequest.state === 'APPROVED' && (
                                <section className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/40 p-4 dark:border-violet-800 dark:bg-violet-950/30">
                                    <h3 className="flex items-center gap-2 text-xs font-semibold text-violet-950 dark:text-violet-100">
                                        退货与换补发闭环
                                        <FeatureHelpButton
                                            topic="sales.after-sales"
                                            title="退货与换补发闭环"
                                        />
                                    </h3>
                                    <div className="grid gap-2 text-xs sm:grid-cols-2">
                                        <div className="rounded-lg border border-violet-100 bg-white p-3">
                                            <span className="text-slate-500">退货状态</span>
                                            <strong className="mt-1 block text-slate-900">
                                                {returnStatusLabels[selectedRequest.returnStatus]}
                                            </strong>
                                            {selectedRequest.returnTrackingCode && (
                                                <small className="mt-1 block font-mono text-slate-500">
                                                    {selectedRequest.returnCarrier} ·{' '}
                                                    {selectedRequest.returnTrackingCode}
                                                </small>
                                            )}
                                        </div>
                                        <div className="rounded-lg border border-violet-100 bg-white p-3">
                                            <span className="text-slate-500">换货/补发状态</span>
                                            <strong className="mt-1 block text-slate-900">
                                                {replacementStatusLabels[selectedRequest.replacementStatus]}
                                            </strong>
                                            {selectedRequest.replacementTrackingCode && (
                                                <small className="mt-1 block font-mono text-slate-500">
                                                    {selectedRequest.replacementCarrier} ·{' '}
                                                    {selectedRequest.replacementTrackingCode}
                                                </small>
                                            )}
                                        </div>
                                    </div>
                                    {selectedRequest.returnInstructions && (
                                        <div className="whitespace-pre-wrap rounded-lg border border-violet-100 bg-white p-3 text-xs leading-5 text-slate-700">
                                            {selectedRequest.returnInstructions}
                                        </div>
                                    )}
                                    {selectedRequest.overdue && (
                                        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">
                                            当前节点已超过处理时限，请优先处理并记录原因。
                                        </div>
                                    )}
                                    {['AWAITING_SHIPMENT', 'IN_TRANSIT'].includes(
                                        selectedRequest.returnStatus,
                                    ) && (
                                        <WorkflowTextArea
                                            value={workflowNote}
                                            onChange={setWorkflowNote}
                                            placeholder="填写仓库签收结果、包裹外观和签收人"
                                        >
                                            <button
                                                type="button"
                                                onClick={() => void handleReceiveReturn()}
                                                disabled={workflowBusy}
                                                className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                                            >
                                                确认退货已签收
                                            </button>
                                        </WorkflowTextArea>
                                    )}
                                    {selectedRequest.returnStatus === 'RECEIVED' && (
                                        <div className="space-y-3 rounded-lg border border-violet-100 bg-white p-3">
                                            {selectedRequest.items.map(item => {
                                                const draft = inspection[item.id];
                                                return (
                                                    <div
                                                        key={item.id}
                                                        className="grid gap-2 border-b border-slate-100 pb-3 last:border-0 last:pb-0 sm:grid-cols-2"
                                                    >
                                                        <div className="sm:col-span-2 text-xs font-semibold text-slate-900">
                                                            {item.productName} · 退回 {item.quantity}
                                                        </div>
                                                        <label className="text-[11px] text-slate-600">
                                                            合格入库
                                                            <input
                                                                type="number"
                                                                min={0}
                                                                max={item.quantity}
                                                                value={draft?.acceptedQuantity ?? 0}
                                                                onChange={event =>
                                                                    setInspection(current => ({
                                                                        ...current,
                                                                        [item.id]: {
                                                                            ...current[item.id],
                                                                            acceptedQuantity: Number(
                                                                                event.target.value,
                                                                            ),
                                                                        },
                                                                    }))
                                                                }
                                                                className="mt-1 w-full rounded-md border border-slate-300 p-2"
                                                            />
                                                        </label>
                                                        <label className="text-[11px] text-slate-600">
                                                            拒收/报损
                                                            <input
                                                                type="number"
                                                                min={0}
                                                                max={item.quantity}
                                                                value={draft?.rejectedQuantity ?? 0}
                                                                onChange={event =>
                                                                    setInspection(current => ({
                                                                        ...current,
                                                                        [item.id]: {
                                                                            ...current[item.id],
                                                                            rejectedQuantity: Number(
                                                                                event.target.value,
                                                                            ),
                                                                        },
                                                                    }))
                                                                }
                                                                className="mt-1 w-full rounded-md border border-slate-300 p-2"
                                                            />
                                                        </label>
                                                        {(draft?.acceptedQuantity ?? 0) > 0 && (
                                                            <>
                                                                <label className="text-[11px] text-slate-600">
                                                                    入库仓库
                                                                    <select
                                                                        value={draft?.stockLocationId ?? ''}
                                                                        onChange={event =>
                                                                            setInspection(current => ({
                                                                                ...current,
                                                                                [item.id]: {
                                                                                    ...current[item.id],
                                                                                    stockLocationId:
                                                                                        event.target.value,
                                                                                },
                                                                            }))
                                                                        }
                                                                        className="mt-1 w-full rounded-md border border-slate-300 p-2"
                                                                    >
                                                                        <option value="">请选择</option>
                                                                        {(
                                                                            stockLocationData?.stockLocations
                                                                                .items ?? []
                                                                        ).map(location => (
                                                                            <option
                                                                                key={location.id}
                                                                                value={location.id}
                                                                            >
                                                                                {location.name}
                                                                            </option>
                                                                        ))}
                                                                    </select>
                                                                </label>
                                                                <label className="text-[11px] text-slate-600">
                                                                    退货批次号
                                                                    <input
                                                                        value={draft?.lotCode ?? ''}
                                                                        onChange={event =>
                                                                            setInspection(current => ({
                                                                                ...current,
                                                                                [item.id]: {
                                                                                    ...current[item.id],
                                                                                    lotCode:
                                                                                        event.target.value,
                                                                                },
                                                                            }))
                                                                        }
                                                                        className="mt-1 w-full rounded-md border border-slate-300 p-2 font-mono"
                                                                    />
                                                                </label>
                                                            </>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                            <WorkflowTextArea
                                                value={workflowNote}
                                                onChange={setWorkflowNote}
                                                placeholder="填写质检结论和拒收/报损依据"
                                            >
                                                <button
                                                    type="button"
                                                    onClick={() => void handleInspectReturn()}
                                                    disabled={workflowBusy}
                                                    className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                                                >
                                                    提交质检并审计入库
                                                </button>
                                            </WorkflowTextArea>
                                        </div>
                                    )}
                                    {selectedRequest.replacementStatus === 'PENDING' &&
                                        (selectedRequest.type === 'RESHIP' ||
                                            selectedRequest.returnStatus === 'INSPECTED') && (
                                            <ReplacementFields
                                                carrier={workflowCarrier}
                                                trackingCode={workflowTrackingCode}
                                                note={workflowNote}
                                                onCarrierChange={setWorkflowCarrier}
                                                onTrackingChange={setWorkflowTrackingCode}
                                                onNoteChange={setWorkflowNote}
                                            >
                                                <button
                                                    type="button"
                                                    onClick={() => void handleReplacement('SHIPPED')}
                                                    disabled={workflowBusy}
                                                    className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                                                >
                                                    登记换货/补发发出
                                                </button>
                                            </ReplacementFields>
                                        )}
                                    {['SHIPPED', 'EXCEPTION'].includes(selectedRequest.replacementStatus) && (
                                        <div className="space-y-2 rounded-lg border border-violet-100 bg-white p-3">
                                            <WorkflowTextArea
                                                value={workflowNote}
                                                onChange={setWorkflowNote}
                                                placeholder="填写配送进展、异常原因或送达说明"
                                            >
                                                {selectedRequest.replacementStatus === 'SHIPPED' && (
                                                    <button
                                                        type="button"
                                                        onClick={() => void handleReplacement('EXCEPTION')}
                                                        disabled={workflowBusy}
                                                        className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 disabled:opacity-50"
                                                    >
                                                        登记配送异常
                                                    </button>
                                                )}
                                            </WorkflowTextArea>
                                            <label className="block text-[11px] text-slate-600">
                                                送达凭证引用
                                                <input
                                                    value={workflowProof}
                                                    onChange={event => setWorkflowProof(event.target.value)}
                                                    placeholder="签收单、客服确认号或承运商凭证"
                                                    className="mt-1 w-full rounded-md border border-slate-300 p-2"
                                                />
                                            </label>
                                            <button
                                                type="button"
                                                onClick={() => void handleReplacement('DELIVERED')}
                                                disabled={workflowBusy}
                                                className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                                            >
                                                确认换货/补发已送达
                                            </button>
                                        </div>
                                    )}
                                </section>
                            )}
                            {(selectedRequest.state === 'PENDING' ||
                                selectedRequest.state === 'APPROVED') && (
                                <section className="rounded-xl border border-blue-200 bg-blue-50/50 p-4">
                                    <h3 className="flex items-center gap-2 text-xs font-semibold text-blue-950">
                                        商家处理
                                        <FeatureHelpButton topic="sales.after-sales" title="商家处理" />
                                    </h3>
                                    <label className="mt-3 block text-xs font-semibold text-slate-700">
                                        处理说明 *
                                    </label>
                                    <textarea
                                        value={resolution}
                                        onChange={event => setResolution(event.target.value)}
                                        rows={4}
                                        placeholder="填写审核依据、退货指引或退款说明"
                                        className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                                    />
                                    {selectedRequest.state === 'PENDING' && (
                                        <>
                                            {(selectedRequest.type === 'RETURN_AND_REFUND' ||
                                                selectedRequest.type === 'EXCHANGE') && (
                                                <>
                                                    <label className="mt-3 block text-xs font-semibold text-slate-700">
                                                        退货地址与寄回说明 *
                                                    </label>
                                                    <textarea
                                                        value={returnInstructions}
                                                        onChange={event =>
                                                            setReturnInstructions(event.target.value)
                                                        }
                                                        rows={3}
                                                        className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                                                    />
                                                </>
                                            )}
                                            <label className="mt-3 block text-xs font-semibold text-slate-700">
                                                通过金额 *
                                            </label>
                                            <input
                                                value={approvedAmount}
                                                onChange={event => setApprovedAmount(event.target.value)}
                                                inputMode="decimal"
                                                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white p-2.5 font-mono text-sm font-semibold outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                                            />
                                            <p className="mt-1 text-[10px] text-slate-500">
                                                可填 0，表示无需资金退款的换补发或服务补偿。
                                            </p>
                                        </>
                                    )}
                                    {selectedRequest.state === 'APPROVED' &&
                                        (selectedRequest.approvedAmount ?? 0) > 0 && (
                                            <>
                                                <label className="mt-3 block text-xs font-semibold text-slate-700">
                                                    关联已成功退款 *
                                                </label>
                                                <select
                                                    value={refundId}
                                                    onChange={event => setRefundId(event.target.value)}
                                                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm"
                                                >
                                                    <option value="">请选择 Settled 退款</option>
                                                    {settledRefunds.map(refund => (
                                                        <option key={refund.id} value={refund.id}>
                                                            #{refund.id} · {refund.paymentMethod} ·{' '}
                                                            {formatMoney(
                                                                refund.total,
                                                                selectedRequest.currencyCode,
                                                            )}
                                                        </option>
                                                    ))}
                                                </select>
                                                {settledRefunds.length === 0 && (
                                                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                                                        <span>订单下还没有已成功的退款记录。</span>
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                navigate(
                                                                    `/sales/orders/${selectedRequest.order.id}`,
                                                                )
                                                            }
                                                            className="font-semibold text-blue-700 hover:underline"
                                                        >
                                                            前往订单执行退款
                                                        </button>
                                                    </div>
                                                )}
                                            </>
                                        )}
                                </section>
                            )}
                            {selectedRequest.resolution &&
                                !['PENDING', 'APPROVED'].includes(selectedRequest.state) && (
                                    <section>
                                        <h3 className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                                            处理结论
                                            <FeatureHelpButton topic="sales.after-sales" title="处理结论" />
                                        </h3>
                                        <div className="mt-2 whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-6 text-slate-700">
                                            {selectedRequest.resolution}
                                        </div>
                                    </section>
                                )}
                            <section>
                                <h3 className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                                    <Clock3 className="h-4 w-4 text-blue-600" />
                                    工单时间线
                                    <FeatureHelpButton topic="sales.after-sales" title="工单时间线" />
                                </h3>
                                <div className="mt-3 space-y-3">
                                    {selectedRequest.events.map(event => (
                                        <div key={event.id} className="grid grid-cols-[0.75rem_1fr] gap-3">
                                            <div className="mt-1.5 h-2.5 w-2.5 rounded-full bg-slate-300" />
                                            <div>
                                                <div className="flex flex-wrap items-center gap-2 text-xs">
                                                    <span className="font-semibold text-slate-800">
                                                        {event.actorLabel}
                                                    </span>
                                                    <span className="text-slate-400">
                                                        {stateLabels[event.state]}
                                                    </span>
                                                </div>
                                                <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-600">
                                                    {event.note}
                                                </p>
                                                <div className="mt-1 text-[10px] text-slate-400">
                                                    {formatDateTime(event.createdAt)}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                            {actionError && (
                                <div
                                    role="alert"
                                    className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs leading-5 text-rose-700"
                                >
                                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                                    {actionError}
                                </div>
                            )}
                        </div>
                        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
                            <button
                                type="button"
                                onClick={() => setSelectedRequest(null)}
                                disabled={workflowBusy}
                                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
                            >
                                关闭
                            </button>
                            <div className="flex gap-2">
                                {selectedRequest.state === 'PENDING' && (
                                    <>
                                        <button
                                            type="button"
                                            onClick={() => handleTransition('REJECTED')}
                                            disabled={workflowBusy}
                                            className="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-4 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                                        >
                                            <XCircle className="h-3.5 w-3.5" />
                                            驳回申请
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleTransition('APPROVED')}
                                            disabled={workflowBusy}
                                            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                                        >
                                            {transitioning ? (
                                                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                            ) : (
                                                <CheckCircle2 className="h-3.5 w-3.5" />
                                            )}
                                            审核通过
                                        </button>
                                    </>
                                )}
                                {selectedRequest.state === 'APPROVED' && (
                                    <button
                                        type="button"
                                        onClick={() => handleTransition('COMPLETED')}
                                        disabled={workflowBusy || !completionReady}
                                        className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                                    >
                                        {transitioning ? (
                                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                            <CircleDollarSign className="h-3.5 w-3.5" />
                                        )}
                                        {afterSalesRequiresReplacement(selectedRequest.type)
                                            ? '确认送达并完成'
                                            : '确认退款并完成'}
                                    </button>
                                )}
                            </div>
                        </footer>
                    </AccessibleDialogSurface>
                </div>
            )}
        </div>
    );
}

function WorkflowTextArea({
    value,
    onChange,
    placeholder,
    children,
}: {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    children: ReactNode;
}) {
    return (
        <div className="space-y-2 rounded-lg border border-violet-100 bg-white p-3">
            <textarea
                value={value}
                onChange={event => onChange(event.target.value)}
                rows={3}
                placeholder={placeholder}
                className="w-full rounded-md border border-slate-300 p-2 text-xs"
            />
            <div className="flex flex-wrap gap-2">{children}</div>
        </div>
    );
}

function ReplacementFields({
    carrier,
    trackingCode,
    note,
    onCarrierChange,
    onTrackingChange,
    onNoteChange,
    children,
}: {
    carrier: string;
    trackingCode: string;
    note: string;
    onCarrierChange: (value: string) => void;
    onTrackingChange: (value: string) => void;
    onNoteChange: (value: string) => void;
    children: ReactNode;
}) {
    return (
        <div className="grid gap-2 rounded-lg border border-violet-100 bg-white p-3 sm:grid-cols-2">
            <label className="text-[11px] text-slate-600">
                承运商
                <input
                    value={carrier}
                    onChange={event => onCarrierChange(event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 p-2"
                />
            </label>
            <label className="text-[11px] text-slate-600">
                运单号
                <input
                    value={trackingCode}
                    onChange={event => onTrackingChange(event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 p-2 font-mono"
                />
            </label>
            <label className="text-[11px] text-slate-600 sm:col-span-2">
                发货说明
                <textarea
                    value={note}
                    onChange={event => onNoteChange(event.target.value)}
                    rows={3}
                    className="mt-1 w-full rounded-md border border-slate-300 p-2"
                />
            </label>
            <div className="sm:col-span-2">{children}</div>
        </div>
    );
}

function afterSalesRequiresReturn(type: AfterSalesRequest['type']): boolean {
    return type === 'RETURN_AND_REFUND' || type === 'EXCHANGE';
}

function afterSalesRequiresReplacement(type: AfterSalesRequest['type']): boolean {
    return type === 'EXCHANGE' || type === 'RESHIP';
}

function operationKey(prefix: string): string {
    const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    return `${prefix}-${random}`.slice(0, 80);
}
