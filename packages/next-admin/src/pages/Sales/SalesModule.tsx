import { AdminButton, AdminInput, AdminSelect } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import {
    AdminMobileField,
    AdminMobileList,
    AdminMobileRecord,
    AdminMobileSort,
} from '../../components/AdminMobileList';
import { PageSizeSelect } from '../../components/PageSizeSelect';
import { useAdminQuery as useQuery } from '../../hooks/use-admin-query';
/* eslint-disable max-len -- Tailwind utility lists are intentionally kept as single JSX attributes. */
import { useMutation } from '@apollo/client/react';
import {
    AlertCircle,
    Check,
    ChevronLeft,
    ChevronRight,
    Download,
    FileText,
    PackageCheck,
    Plus,
    RefreshCw,
    RotateCcw,
    Search,
    Truck,
    X,
} from 'lucide-react';
import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { SearchInput } from '../../components/SearchInput';
import { SortableTableHeader } from '../../components/SortableTableHeader';
import {
    ADD_ORDER_FULFILLMENT,
    CREATE_DRAFT_ORDER,
    GET_SALES_ORDERS,
    TRANSITION_SALES_FULFILLMENT,
} from '../../graphql/sales.graphql';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { useUnsavedChangesWarning } from '../../hooks/use-unsaved-changes-warning';
import { useUrlListState } from '../../hooks/use-url-list-state';
import { type SortDirection, useUrlSortState } from '../../hooks/use-url-sort-state';
import { useUrlTab } from '../../hooks/use-url-tab';
import { publishAdminFeedback } from '../../utils/admin-feedback';
import { refreshAfterAdminWrite } from '../../utils/admin-write-readback';
import { getChannelDisplayName } from '../../utils/channel-display';
import { toUserFacingError } from '../../utils/user-facing-error';

import { canCreatePhysicalFulfillment } from './order-operation-availability';
import { csvCell } from './sales-csv';
import {
    canManageOrderInChannel,
    formatAddress,
    formatDateTime,
    formatMoney,
    getCustomerName,
    getDigitalNotificationLabel,
    getMutationError,
    getOrderFulfillmentKind,
    getOrderStateClass,
    getOrderStateLabel,
    getProcessingPhysicalLines,
    type OrderProcessingSummary,
    summarizeOrderListItem,
} from './sales-utils';

type OrderTab =
    | 'PENDING'
    | 'DIGITAL'
    | 'PHYSICAL'
    | 'EXCEPTIONS'
    | 'AFTER_SALES'
    | 'ALL'
    | 'DRAFT'
    | 'TO_SETTLE'
    | 'TO_FULFILL'
    | 'IN_TRANSIT'
    | 'DELIVERED'
    | 'CANCELLED';
const ORDER_TABS = {
    pending: 'PENDING',
    digital: 'DIGITAL',
    physical: 'PHYSICAL',
    exceptions: 'EXCEPTIONS',
    'after-sales': 'AFTER_SALES',
    all: 'ALL',
    drafts: 'DRAFT',
    'to-settle': 'TO_SETTLE',
    'to-fulfill': 'TO_FULFILL',
    'in-transit': 'IN_TRANSIT',
    delivered: 'DELIVERED',
    cancelled: 'CANCELLED',
} as const;

interface SalesOrderLine {
    id: string;
    quantity: number;
    featuredAsset?: { id: string; name?: string | null; preview: string } | null;
    productVariant: {
        id: string;
        name: string;
        sku: string;
        options?: Array<{ id: string; name: string; code: string }> | null;
        customFields?: { fulfillmentType?: string | null; digitalDeliveryMode?: string | null } | null;
    };
    customFields?: {
        fulfillmentTypeSnapshot?: string | null;
        digitalDeliveryModeSnapshot?: string | null;
    } | null;
}

interface SalesFulfillment {
    id: string;
    state: string;
    nextStates: string[];
    handlerCode: string;
    method: string;
    trackingCode?: string | null;
    lines: Array<{ orderLineId: string; quantity: number }>;
}

interface SalesOrderItem {
    processingSummary?: OrderProcessingSummary | null;
    salesChannel: {
        id: string;
        code: string;
        customFields?: { storefrontNameZh?: string | null; storefrontNameEn?: string | null } | null;
    } | null;
    id: string;
    createdAt: string;
    orderPlacedAt?: string | null;
    code: string;
    state: string;
    active: boolean;
    totalQuantity: number;
    totalWithTax: number;
    currencyCode: string;
    customer?: {
        id: string;
        firstName?: string | null;
        lastName?: string | null;
        emailAddress: string;
        phoneNumber?: string | null;
    } | null;
    shippingAddress?: {
        fullName?: string | null;
        company?: string | null;
        streetLine1?: string | null;
        streetLine2?: string | null;
        city?: string | null;
        province?: string | null;
        postalCode?: string | null;
        country?: string | null;
        phoneNumber?: string | null;
    } | null;
    lines: SalesOrderLine[];
    fulfillments?: SalesFulfillment[] | null;
}

interface SalesOrdersData {
    activeChannel: { id: string; code: string };
    orders: { items: SalesOrderItem[]; totalItems: number };
    orderProcessingCounts: {
        pending: number;
        digital: number;
        physical: number;
        exceptions: number;
        afterSales: number;
    };
}

interface FulfillmentMutationData {
    addFulfillmentToOrder: {
        __typename: string;
        id?: string;
        errorCode?: string;
        message?: string;
    };
}

const ORDER_TAB_RESET_PARAMETERS = ['page'];
const ORDER_SORT_FIELDS = [
    'orderPlacedAt',
    'code',
    'totalQuantity',
    'customerLastName',
    'totalWithTax',
    'state',
] as const;
type OrderSortField = (typeof ORDER_SORT_FIELDS)[number];
const ORDER_SORT_OPTIONS: Array<{ value: OrderSortField; label: string }> = [
    { value: 'orderPlacedAt', label: '下单时间' },
    { value: 'code', label: '订单号' },
    { value: 'totalQuantity', label: '商品数量' },
    { value: 'customerLastName', label: '客户姓名' },
    { value: 'totalWithTax', label: '订单金额' },
    { value: 'state', label: '订单状态' },
];
const EMPTY_ORDERS: SalesOrderItem[] = [];
const tabs: Array<{ id: OrderTab; label: string }> = [
    { id: 'PENDING', label: '待处理' },
    { id: 'DIGITAL', label: '虚拟待交付' },
    { id: 'PHYSICAL', label: '实物待发货' },
    { id: 'EXCEPTIONS', label: '异常与通知' },
    { id: 'AFTER_SALES', label: '售后待处理' },
    { id: 'ALL', label: '全部交易' },
    { id: 'DRAFT', label: '草稿订单' },
    { id: 'TO_SETTLE', label: '支付已授权' },
    { id: 'IN_TRANSIT', label: '配送中' },
    { id: 'DELIVERED', label: '已完成' },
    { id: 'CANCELLED', label: '已取消' },
];
export function SalesModule() {
    const navigate = useNavigate();
    const { hasAnyPermission } = useAdminPermissions();
    const canCreateOrder = hasAnyPermission(['CreateOrder']);
    const canUpdateOrder = hasAnyPermission(['UpdateOrder']);
    const [activeTab, setActiveTab] = useUrlTab<OrderTab>(
        ORDER_TABS,
        'pending',
        'tab',
        ORDER_TAB_RESET_PARAMETERS,
    );
    const location = useLocation();
    const [, setSearchParams] = useSearchParams();
    const { isFiltered, page, pageSize, setPageSize, searchTerm, setPage, setSearchTerm, resetFilters } =
        useUrlListState();
    const { sortDirection, sortField, toggleSort } = useUrlSortState({
        fields: ORDER_SORT_FIELDS,
        defaultField: 'orderPlacedAt',
        defaultDirection: 'DESC',
    });
    const deferredSearchTerm = useDeferredValue(searchTerm);
    const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
    const [mobileFilterDraft, setMobileFilterDraft] = useState<{
        tab: OrderTab;
        field: OrderSortField;
        direction: SortDirection;
        clearSearch: boolean;
    } | null>(null);
    const [mobileBatchMode, setMobileBatchMode] = useState(false);
    const [isBatchOpen, setIsBatchOpen] = useState(false);
    const [carrier, setCarrier] = useState('');
    const [trackingCodes, setTrackingCodes] = useState<Record<string, string>>({});
    const [notification, setNotification] = useState('');
    const [actionError, setActionError] = useState('');
    const [batchProgress, setBatchProgress] = useState('');
    const [batchOrders, setBatchOrders] = useState<SalesOrderItem[]>([]);
    const [batchSummary, setBatchSummary] = useState('');
    const [batchNeedsVerification, setBatchNeedsVerification] = useState(false);
    const [batchPhase, setBatchPhase] = useState<'idle' | 'writing' | 'reading' | 'read-failed' | 'done'>(
        'idle',
    );
    const batchRunning = useRef(false);
    const batchReadRunning = useRef(false);
    useUnsavedChangesWarning(
        batchPhase === 'writing' || batchPhase === 'reading' || batchPhase === 'read-failed',
        '批量发货结果尚未完成核对。离开后请勿重复提交，确定离开吗？',
    );

    const queryVariables = useMemo(() => {
        return {
            options: {
                category: activeTab === 'TO_FULFILL' ? 'PHYSICAL' : activeTab,
                skip: page * pageSize,
                take: pageSize,
                term: deferredSearchTerm.trim(),
                sortBy: sortField,
                sortOrder: sortDirection,
            },
        };
    }, [activeTab, deferredSearchTerm, page, pageSize, sortDirection, sortField]);

    const { data, loading, error, refetch } = useQuery<SalesOrdersData>(GET_SALES_ORDERS, {
        variables: queryVariables,

        notifyOnNetworkStatusChange: true,
    });
    const [addFulfillment, { loading: fulfilling }] =
        useMutation<FulfillmentMutationData>(ADD_ORDER_FULFILLMENT);
    const [createDraftOrder, { loading: creatingDraft }] = useMutation<{
        createDraftOrder: { id: string; code: string; state: string };
    }>(CREATE_DRAFT_ORDER);
    const [transitionFulfillment, { loading: transitioning }] = useMutation<{
        transitionFulfillmentToState: FulfillmentMutationData['addFulfillmentToOrder'];
    }>(TRANSITION_SALES_FULFILLMENT);
    const batchLocked =
        fulfilling ||
        transitioning ||
        batchPhase === 'writing' ||
        batchPhase === 'reading' ||
        batchPhase === 'read-failed';
    const orders = data?.orders?.items ?? EMPTY_ORDERS;
    const totalItems = data?.orders?.totalItems ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const physicalTodoCount = data?.orderProcessingCounts?.physical;
    const deliveryExceptionCount = data?.orderProcessingCounts?.exceptions;
    const selectableOrders = orders.filter(
        order =>
            canManageOrderInChannel(order, data?.activeChannel?.id) &&
            canCreatePhysicalFulfillment(order.state) &&
            getProcessingPhysicalLines(order).length > 0,
    );
    const selectedOrders = selectableOrders.filter(order => selectedOrderIds.includes(order.id));
    const allSelectableChecked =
        selectableOrders.length > 0 && selectableOrders.every(order => selectedOrderIds.includes(order.id));

    const showNotice = (message: string) => {
        setNotification(message);
        window.setTimeout(() => setNotification(''), 3500);
    };
    const handleCreateDraftOrder = async () => {
        setActionError('');
        try {
            const response = await createDraftOrder();
            const draft = response.data?.createDraftOrder;
            if (!draft?.id) throw new Error('后端没有返回草稿订单 ID');
            navigate(`/sales/orders/draft/${draft.id}`, {
                state: { returnTo: `${location.pathname}${location.search}` },
            });
        } catch (mutationError) {
            setActionError(toUserFacingError(mutationError, '草稿订单创建失败'));
        }
    };
    const resetListState = (tab: OrderTab) => {
        setActiveTab(tab);
        setSelectedOrderIds([]);
        setActionError('');
    };
    const toggleOrder = (orderId: string) => {
        setSelectedOrderIds(current =>
            current.includes(orderId) ? current.filter(id => id !== orderId) : [...current, orderId],
        );
    };
    const toggleAll = () => {
        if (allSelectableChecked) {
            setSelectedOrderIds(current =>
                current.filter(id => !selectableOrders.some(order => order.id === id)),
            );
        } else {
            setSelectedOrderIds(current => [
                ...new Set([...current, ...selectableOrders.map(order => order.id)]),
            ]);
        }
    };
    const changeSort = (field: OrderSortField, initialDirection?: SortDirection) => {
        toggleSort(field, initialDirection);
        setSelectedOrderIds([]);
    };
    const applyMobileFilters = () => {
        if (!mobileFilterDraft) return;
        // Apply the existing URL filter contract atomically; sequential setters would lose one change.
        setSearchParams(
            current => {
                const next = new URLSearchParams(mobileFilterDraft.clearSearch ? undefined : current);
                const key =
                    Object.entries(ORDER_TABS).find(([, tab]) => tab === mobileFilterDraft.tab)?.[0] ?? 'all';
                if (key === 'pending') next.delete('tab');
                else next.set('tab', key);
                if (mobileFilterDraft.field === 'orderPlacedAt' && mobileFilterDraft.direction === 'DESC') {
                    next.delete('sort');
                    next.delete('direction');
                } else {
                    next.set('sort', mobileFilterDraft.field);
                    next.set('direction', mobileFilterDraft.direction);
                }
                if (mobileFilterDraft.clearSearch) next.delete('search');
                next.delete('page');
                return next;
            },
            { replace: true },
        );
        setSelectedOrderIds([]);
        setActionError('');
        setMobileFilterDraft(null);
    };
    const openBatchFulfillment = () => {
        if (!canUpdateOrder || batchRunning.current || selectedOrders.length === 0) return;
        setBatchOrders(selectedOrders);
        setTrackingCodes(
            Object.fromEntries(selectedOrders.map(order => [order.id, trackingCodes[order.id] ?? ''])),
        );
        setActionError('');
        setBatchProgress('');
        setBatchSummary('');
        setBatchNeedsVerification(false);
        setBatchPhase('idle');
        setIsBatchOpen(true);
    };

    const readBatchResult = async (needsVerification = batchNeedsVerification) => {
        if (batchReadRunning.current) return;
        batchReadRunning.current = true;
        setBatchPhase('reading');
        setActionError('');
        let failed = false;
        try {
            const onReadError = (message: string) => {
                failed = true;
                setActionError(message);
            };
            if (needsVerification) {
                // Some responses are unknown: a failed read must not announce that all writes completed.
                try {
                    await refetch();
                } catch {
                    const message = '本次批量处理结果已保留，但最新履约读取失败。请核对后继续，勿重复提交。';
                    onReadError(message);
                    publishAdminFeedback({ kind: 'info', title: '批量处理结果需核对', message });
                }
            } else {
                await refreshAfterAdminWrite(() => refetch(), onReadError);
            }
            setBatchPhase(failed ? 'read-failed' : 'done');
        } finally {
            batchReadRunning.current = false;
        }
    };

    const handleBatchFulfillment = async () => {
        if (!canUpdateOrder || batchRunning.current || batchPhase !== 'idle') return;
        const normalizedCarrier = carrier.trim();
        if (!normalizedCarrier) {
            setActionError('请填写物流公司或配送方式');
            return;
        }
        const missingTrackingOrder = batchOrders.find(order => !trackingCodes[order.id]?.trim());
        if (missingTrackingOrder) {
            setActionError(`订单 ${missingTrackingOrder.code} 尚未填写运单号`);
            return;
        }

        setActionError('');
        batchRunning.current = true;
        setBatchPhase('writing');
        const failures: string[] = [];
        let successCount = 0;
        for (let index = 0; index < batchOrders.length; index += 1) {
            const order = batchOrders[index];
            if (!canCreatePhysicalFulfillment(order.state)) {
                failures.push(`${order.code}：订单未付款或未授权，不能发货`);
                continue;
            }
            setBatchProgress(`正在处理 ${index + 1}/${batchOrders.length}：${order.code}`);
            try {
                const response = await addFulfillment({
                    variables: {
                        input: {
                            lines: getProcessingPhysicalLines(order),
                            handler: {
                                code: 'manual-fulfillment',
                                arguments: [
                                    { name: 'method', value: normalizedCarrier },
                                    { name: 'trackingCode', value: trackingCodes[order.id].trim() },
                                ],
                            },
                        },
                    },
                });
                const result = response.data?.addFulfillmentToOrder;
                if (result?.__typename !== 'Fulfillment' || !result.id) {
                    failures.push(`${order.code}：${getMutationError(result)}`);
                    continue;
                }
                const transitioned = await transitionFulfillment({
                    variables: { id: result.id, state: 'Shipped' },
                });
                const transitionResult = transitioned.data?.transitionFulfillmentToState;
                if (transitionResult?.__typename === 'Fulfillment') successCount += 1;
                else
                    failures.push(
                        `${order.code}：履约已创建，但标记发货失败（${getMutationError(transitionResult)}）`,
                    );
            } catch (mutationError) {
                failures.push(
                    `${order.code}：${toUserFacingError(mutationError, '发货请求结果尚未确认')}；请核对履约记录，勿重复提交`,
                );
            }
        }

        setBatchProgress('');
        setSelectedOrderIds([]);
        setBatchNeedsVerification(failures.length > 0);
        setBatchSummary(
            `已确认发货 ${successCount} 笔，需核对/处理 ${failures.length} 笔。${failures.join('；')}`,
        );
        try {
            await readBatchResult(failures.length > 0);
        } finally {
            batchRunning.current = false;
        }
    };

    const exportCurrentPage = () => {
        if (orders.length === 0) {
            setActionError('当前页没有可导出的订单');
            return;
        }
        const header = [
            '销售店铺',
            '订单号',
            '下单时间',
            '客户',
            '邮箱',
            '金额',
            '币种',
            '状态',
            '履约类型',
            '收货地址',
        ];
        const rows = orders.map(order => [
            order.salesChannel ? getChannelDisplayName(order.salesChannel) : '归属待核实',
            order.code,
            formatDateTime(order.orderPlacedAt ?? order.createdAt),
            getCustomerName(order.customer),
            order.customer?.emailAddress ?? '',
            formatMoney(order.totalWithTax, order.currencyCode),
            order.currencyCode,
            getOrderStateLabel(order.state),
            getOrderFulfillmentKind(order),
            formatAddress(order.shippingAddress),
        ]);
        const csv = `\uFEFF${[header, ...rows].map(row => row.map(csvCell).join(',')).join('\n')}`;
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `orders-page-${page + 1}-${new Date().toISOString().slice(0, 10)}.csv`;
        anchor.click();
        URL.revokeObjectURL(url);
        showNotice(`已导出当前页 ${orders.length} 笔订单`);
    };

    return (
        <div className="flex h-full flex-col bg-slate-50">
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-5 sm:px-8">
                <div className="flex w-full flex-wrap items-center justify-between gap-4">
                    <div>
                        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-950">
                            订单处理台
                            <FeatureHelpButton
                                topic="sales.orders"
                                title="订单与履约"
                                description="先处理待办，再查看付款、交付、售后与通知进度"
                            />
                        </h1>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {canCreateOrder && (
                            <AdminButton
                                type="button"
                                onClick={() => void handleCreateDraftOrder()}
                                disabled={creatingDraft}
                                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-blue-700 active:scale-[0.98] disabled:opacity-50"
                            >
                                {creatingDraft ? (
                                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <Plus className="h-3.5 w-3.5" />
                                )}
                                新建草稿订单
                            </AdminButton>
                        )}
                        <AdminButton
                            refreshPage
                            type="button"
                            onClick={() => refetch()}
                            disabled={loading}
                            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 active:scale-[0.98] disabled:opacity-50"
                        >
                            <RefreshCw className={`h-3.5 w-3.5 ${loading && !data ? 'animate-spin' : ''}`} />
                            刷新
                        </AdminButton>
                        <AdminButton
                            type="button"
                            onClick={exportCurrentPage}
                            className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 active:scale-[0.98]"
                        >
                            <Download className="h-3.5 w-3.5" />
                            导出当前页
                        </AdminButton>
                    </div>
                </div>
            </header>

            <nav
                aria-label="订单状态筛选"
                className="scrollbar-hidden hidden shrink-0 overflow-x-auto border-b border-slate-200 bg-white px-5 md:block sm:px-8"
            >
                <div className="flex w-full min-w-max gap-6">
                    {tabs.map(tab => (
                        <AdminButton
                            key={tab.id}
                            type="button"
                            aria-current={activeTab === tab.id ? 'page' : undefined}
                            onClick={() => resetListState(tab.id)}
                            className={`border-b-2 py-3.5 text-xs font-semibold transition ${activeTab === tab.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-900'}`}
                        >
                            {tab.label}
                        </AdminButton>
                    ))}
                </div>
            </nav>

            <div className="flex-1 overflow-y-auto p-5 sm:p-8">
                <div className="w-full max-w-none space-y-4">
                    <details className="rounded-lg bg-white px-3 text-sm text-slate-600 md:hidden">
                        <summary className="min-h-11 cursor-pointer py-3">
                            共 {totalItems} 笔订单 · 运营概览
                        </summary>
                        <dl className="grid grid-cols-2 gap-3 pb-3">
                            <div>
                                <dt>实物待发货</dt>
                                <dd className="font-semibold">{physicalTodoCount ?? '—'}</dd>
                            </div>
                            <div>
                                <dt>配送异常 / 逾期</dt>
                                <dd className="font-semibold">{deliveryExceptionCount ?? '—'}</dd>
                            </div>
                            <div className="col-span-2">
                                <dt>本页可批量发货（未履约实物）</dt>
                                <dd className="font-semibold">{selectableOrders.length}</dd>
                            </div>
                        </dl>
                    </details>
                    <div className="hidden grid-cols-2 gap-2 md:grid lg:grid-cols-4">
                        <div className="min-w-0 rounded-lg bg-slate-900 px-3 py-2.5 text-white shadow-sm">
                            <div className="text-[11px] font-medium text-slate-300">当前筛选</div>
                            <div className="mt-1 font-mono text-lg font-semibold tabular-nums">
                                {totalItems}
                            </div>
                            <div className="mt-0.5 text-[11px] text-slate-400">笔订单</div>
                        </div>
                        <div className="min-w-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-700">
                                <Truck className="h-3.5 w-3.5" />
                                实物待发货
                            </div>
                            <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-amber-900">
                                {physicalTodoCount ?? '—'}
                            </div>
                            <div className="mt-0.5 text-[11px] text-amber-700">已排除纯虚拟订单</div>
                        </div>
                        <div className="min-w-0 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5">
                            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-rose-700">
                                <AlertCircle className="h-3.5 w-3.5" />
                                交付异常 / 通知失败
                            </div>
                            <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-rose-900">
                                {deliveryExceptionCount ?? '—'}
                            </div>
                            <div className="mt-0.5 text-[11px] text-rose-700">需进入订单处理并留证</div>
                        </div>
                        <div className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                                <PackageCheck className="h-3.5 w-3.5" />
                                虚拟待交付
                            </div>
                            <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-900">
                                {data?.orderProcessingCounts?.digital ?? '—'}
                            </div>
                            <div className="mt-0.5 text-[11px] text-slate-500">
                                人工成品、卡密与文件交付待办
                            </div>
                        </div>
                    </div>

                    {notification && (
                        <div
                            role="status"
                            className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs font-medium text-emerald-800"
                        >
                            <Check className="h-4 w-4" />
                            {notification}
                        </div>
                    )}
                    {actionError && !isBatchOpen && (
                        <div
                            role="alert"
                            className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-800"
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
                    {error && (
                        <div
                            role="alert"
                            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800"
                        >
                            <span className="flex items-center gap-2">
                                <AlertCircle className="h-4 w-4" />
                                {toUserFacingError(error, '订单数据加载失败，请稍后重试')}
                            </span>
                            <AdminButton
                                type="button"
                                onClick={() => refetch()}
                                className="rounded-lg bg-rose-600 px-3 py-1.5 font-semibold text-white"
                            >
                                重试
                            </AdminButton>
                        </div>
                    )}

                    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/70 p-4">
                            <div className="relative w-full min-w-0 flex-auto md:flex-1 md:max-w-md">
                                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                                <SearchInput
                                    value={searchTerm}
                                    onValueChange={value => {
                                        setSearchTerm(value);
                                        setSelectedOrderIds([]);
                                    }}
                                    aria-label="搜索订单"
                                    placeholder="搜索订单号、买家姓氏、邮箱或支付流水号"
                                    className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-12 text-xs outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                                />
                                {searchTerm && (
                                    <AdminButton
                                        type="button"
                                        onClick={() => {
                                            setSearchTerm('');
                                        }}
                                        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400 hover:text-slate-700"
                                        aria-label="清空搜索"
                                    >
                                        <X className="h-4 w-4" />
                                    </AdminButton>
                                )}
                            </div>

                            {isFiltered && (
                                <AdminButton
                                    type="button"
                                    onClick={resetFilters}
                                    className="hidden items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs md:flex font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
                                    title="清空搜索与筛选条件"
                                >
                                    <RotateCcw className="h-3.5 w-3.5 text-slate-400" />
                                    <span>重置筛选</span>
                                </AdminButton>
                            )}
                            <div
                                className={`${mobileBatchMode ? 'flex' : 'hidden md:flex'} flex-wrap items-center gap-3`}
                            >
                                <span className="text-xs text-slate-500">
                                    已选{' '}
                                    <strong className="font-mono text-slate-900">
                                        {selectedOrderIds.length}
                                    </strong>{' '}
                                    笔
                                </span>
                                {canUpdateOrder && (
                                    <AdminButton
                                        type="button"
                                        onClick={openBatchFulfillment}
                                        disabled={selectedOrders.length === 0}
                                        className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-amber-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        <Truck className="h-3.5 w-3.5" />
                                        批量填写运单并发货
                                    </AdminButton>
                                )}
                            </div>
                        </div>

                        <div className="space-y-3 border-b border-slate-200 p-4 md:hidden">
                            <div className="flex flex-wrap items-center gap-2">
                                <AdminButton
                                    type="button"
                                    onClick={() =>
                                        setMobileFilterDraft({
                                            tab: activeTab,
                                            field: sortField,
                                            direction: sortDirection,
                                            clearSearch: false,
                                        })
                                    }
                                    className="rounded-lg border border-slate-300 bg-white px-3 py-2"
                                >
                                    筛选与排序
                                </AdminButton>
                                {canUpdateOrder && (
                                    <div className="flex flex-wrap items-center gap-2">
                                        <AdminButton
                                            type="button"
                                            aria-expanded={mobileBatchMode}
                                            onClick={() => {
                                                setMobileBatchMode(value => !value);
                                                setSelectedOrderIds([]);
                                            }}
                                            className="rounded-lg border border-slate-300 bg-white px-3 py-2"
                                        >
                                            {mobileBatchMode ? '退出批量管理' : '批量管理'}
                                        </AdminButton>
                                        {mobileBatchMode && (
                                            <label className="flex min-h-11 items-center gap-2 text-sm">
                                                <AdminInput
                                                    type="checkbox"
                                                    checked={allSelectableChecked}
                                                    disabled={selectableOrders.length === 0}
                                                    onChange={toggleAll}
                                                />
                                                本页可发货订单全选
                                            </label>
                                        )}
                                    </div>
                                )}
                            </div>
                            <p className="text-xs text-slate-500">
                                {tabs.find(tab => tab.id === activeTab)?.label} ·{' '}
                                {ORDER_SORT_OPTIONS.find(option => option.value === sortField)?.label}
                                {sortDirection === 'ASC' ? '升序' : '降序'}
                            </p>
                        </div>

                        {loading && !data ? (
                            <div className="space-y-3 p-6" aria-label="正在加载订单">
                                {[1, 2, 3, 4, 5].map(item => (
                                    <div key={item} className="h-12 animate-pulse rounded-lg bg-slate-100" />
                                ))}
                            </div>
                        ) : !error && orders.length === 0 ? (
                            <div className="flex min-h-80 flex-col items-center justify-center px-6 text-center">
                                <FileText className="h-9 w-9 text-slate-300" />
                                <h2 className="mt-3 text-sm font-semibold text-slate-800">没有匹配的订单</h2>
                                <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">
                                    调整状态筛选或搜索条件后再试。后台不会用示例订单填充空结果。
                                </p>
                            </div>
                        ) : (
                            orders.length > 0 && (
                                <>
                                    <AdminMobileList ariaLabel="订单摘要列表">
                                        {orders.map(order => {
                                            const summary = summarizeOrderListItem(order);
                                            const canFulfill =
                                                canUpdateOrder &&
                                                canManageOrderInChannel(order, data?.activeChannel?.id) &&
                                                canCreatePhysicalFulfillment(order.state) &&
                                                getProcessingPhysicalLines(order).length > 0;
                                            return (
                                                <AdminMobileRecord
                                                    key={order.id}
                                                    title={order.code}
                                                    status={
                                                        <span
                                                            className={`rounded-md border px-2 py-1 text-xs ${getOrderStateClass(order.state)}`}
                                                        >
                                                            {getOrderStateLabel(order.state)}
                                                        </span>
                                                    }
                                                    selection={
                                                        mobileBatchMode && canUpdateOrder ? (
                                                            <AdminInput
                                                                type="checkbox"
                                                                checked={selectedOrderIds.includes(order.id)}
                                                                disabled={!canFulfill}
                                                                onChange={() => toggleOrder(order.id)}
                                                                aria-label={`选择订单 ${order.code}`}
                                                            />
                                                        ) : undefined
                                                    }
                                                    actions={
                                                        <AdminButton
                                                            type="button"
                                                            onClick={() =>
                                                                navigate(`/sales/orders/${order.id}`, {
                                                                    state: {
                                                                        returnTo: `${location.pathname}${location.search}`,
                                                                    },
                                                                })
                                                            }
                                                            className="rounded-lg bg-blue-50 px-3 py-2 font-semibold text-blue-700"
                                                        >
                                                            {order.processingSummary?.nextAction?.label ||
                                                                '查看订单'}
                                                        </AdminButton>
                                                    }
                                                >
                                                    <AdminMobileField label="订单金额">
                                                        {formatMoney(order.totalWithTax, order.currencyCode)}
                                                    </AdminMobileField>
                                                    <AdminMobileField label="商品数量">
                                                        {summary.quantity}
                                                    </AdminMobileField>
                                                    <AdminMobileField label="商品" fullWidth>
                                                        {summary.productName}
                                                        {summary.additionalLineCount > 0
                                                            ? ` · 另 ${summary.additionalLineCount} 项`
                                                            : ''}
                                                    </AdminMobileField>
                                                    <AdminMobileField label="客户">
                                                        {summary.customerName}
                                                    </AdminMobileField>
                                                    <AdminMobileField label="资金">
                                                        {order.processingSummary?.paymentLabel ||
                                                            '付款待核实'}
                                                    </AdminMobileField>
                                                    <AdminMobileField label="交付">
                                                        {order.processingSummary?.fulfillmentLabel ||
                                                            '交付待核实'}
                                                    </AdminMobileField>
                                                    <AdminMobileField label="售后">
                                                        {order.processingSummary?.afterSalesLabel ||
                                                            '售后待核实'}
                                                    </AdminMobileField>
                                                    <AdminMobileField label="通知">
                                                        {order.processingSummary
                                                            ? getDigitalNotificationLabel(
                                                                  order.processingSummary.lines,
                                                              )
                                                            : '通知待核实'}
                                                    </AdminMobileField>
                                                    <AdminMobileField label="联系方式" fullWidth>
                                                        {summary.contact}
                                                    </AdminMobileField>
                                                    <AdminMobileField label="下单时间" fullWidth>
                                                        {formatDateTime(
                                                            order.orderPlacedAt ?? order.createdAt,
                                                        )}
                                                    </AdminMobileField>
                                                    <AdminMobileField label="店铺" fullWidth>
                                                        {order.salesChannel
                                                            ? getChannelDisplayName(order.salesChannel)
                                                            : '归属待核实'}
                                                    </AdminMobileField>
                                                </AdminMobileRecord>
                                            );
                                        })}
                                    </AdminMobileList>
                                    <div className="admin-desktop-table overflow-x-auto">
                                        <table className="w-full min-w-[1380px] border-collapse text-left text-xs">
                                            <thead>
                                                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-500">
                                                    <th
                                                        scope="col"
                                                        className="sticky left-0 z-20 w-12 bg-slate-50 px-3 py-3"
                                                    >
                                                        <AdminInput
                                                            type="checkbox"
                                                            checked={allSelectableChecked}
                                                            onChange={toggleAll}
                                                            aria-label="选择本页所有可发货订单"
                                                            className="h-4 w-4 rounded"
                                                        />
                                                    </th>
                                                    <SortableTableHeader
                                                        label="订单号"
                                                        sortField="code"
                                                        activeSortField={sortField}
                                                        sortDirection={sortDirection}
                                                        onSort={changeSort}
                                                        className="sticky left-12 z-20 w-48 whitespace-nowrap bg-slate-50 px-3 py-3"
                                                    />
                                                    <SortableTableHeader
                                                        label="下单时间"
                                                        sortField="orderPlacedAt"
                                                        activeSortField={sortField}
                                                        sortDirection={sortDirection}
                                                        onSort={changeSort}
                                                        initialDirection="DESC"
                                                        className="w-40 whitespace-nowrap px-3 py-3"
                                                    />
                                                    <th
                                                        scope="col"
                                                        className="w-24 whitespace-nowrap px-3 py-3"
                                                    >
                                                        商品类型
                                                    </th>
                                                    <th
                                                        scope="col"
                                                        className="w-60 whitespace-nowrap px-3 py-3"
                                                    >
                                                        商品名称
                                                    </th>
                                                    <SortableTableHeader
                                                        label="购买数量"
                                                        sortField="totalQuantity"
                                                        activeSortField={sortField}
                                                        sortDirection={sortDirection}
                                                        onSort={changeSort}
                                                        initialDirection="DESC"
                                                        align="center"
                                                        className="w-24 whitespace-nowrap px-3 py-3 text-center"
                                                    />
                                                    <SortableTableHeader
                                                        label="买家"
                                                        sortField="customerLastName"
                                                        activeSortField={sortField}
                                                        sortDirection={sortDirection}
                                                        onSort={changeSort}
                                                        className="w-40 whitespace-nowrap px-3 py-3"
                                                    />
                                                    <SortableTableHeader
                                                        label="订单金额"
                                                        sortField="totalWithTax"
                                                        activeSortField={sortField}
                                                        sortDirection={sortDirection}
                                                        onSort={changeSort}
                                                        initialDirection="DESC"
                                                        className="w-36 whitespace-nowrap px-3 py-3"
                                                    />
                                                    <SortableTableHeader
                                                        label="订单状态"
                                                        sortField="state"
                                                        activeSortField={sortField}
                                                        sortDirection={sortDirection}
                                                        onSort={changeSort}
                                                        className="w-32 whitespace-nowrap px-3 py-3"
                                                    />
                                                    <th
                                                        scope="col"
                                                        className="w-64 whitespace-nowrap px-3 py-3"
                                                    >
                                                        四项进度 / 下一步
                                                    </th>
                                                    <th
                                                        scope="col"
                                                        className="sticky right-0 z-20 w-32 whitespace-nowrap border-l border-slate-200 bg-slate-50 px-3 py-3 text-right"
                                                    >
                                                        操作
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                                {orders.map(order => {
                                                    const remainingLines = getProcessingPhysicalLines(order);
                                                    const canFulfill =
                                                        canUpdateOrder &&
                                                        canManageOrderInChannel(
                                                            order,
                                                            data?.activeChannel?.id,
                                                        ) &&
                                                        canCreatePhysicalFulfillment(order.state) &&
                                                        remainingLines.length > 0;
                                                    const summary = summarizeOrderListItem(order);
                                                    const isSelected = selectedOrderIds.includes(order.id);
                                                    const stickyBackground = isSelected
                                                        ? 'bg-blue-50'
                                                        : 'bg-white group-hover:bg-slate-50';
                                                    const kindLabel =
                                                        summary.fulfillmentKind === 'PHYSICAL'
                                                            ? '实物'
                                                            : summary.fulfillmentKind === 'DIGITAL'
                                                              ? '虚拟'
                                                              : '混合';
                                                    return (
                                                        <tr
                                                            key={order.id}
                                                            className={`group h-[52px] transition hover:bg-slate-50/80 ${isSelected ? 'bg-blue-50/50' : ''}`}
                                                        >
                                                            <td
                                                                className={`sticky left-0 z-10 h-[52px] w-12 px-3 py-0 ${stickyBackground}`}
                                                            >
                                                                <AdminInput
                                                                    type="checkbox"
                                                                    checked={isSelected}
                                                                    disabled={!canFulfill}
                                                                    onChange={() => toggleOrder(order.id)}
                                                                    aria-label={`选择订单 ${order.code}`}
                                                                    title={
                                                                        canFulfill
                                                                            ? '选择发货'
                                                                            : '当前订单没有可发货的实物明细'
                                                                    }
                                                                    className="h-4 w-4 rounded disabled:cursor-not-allowed disabled:opacity-30"
                                                                />
                                                            </td>
                                                            <td
                                                                className={`sticky left-12 z-10 h-[52px] max-w-48 px-3 py-0 ${stickyBackground}`}
                                                            >
                                                                <AdminButton
                                                                    type="button"
                                                                    onClick={() =>
                                                                        navigate(
                                                                            `/sales/orders/${order.id}`,
                                                                            {
                                                                                state: {
                                                                                    returnTo: `${location.pathname}${location.search}`,
                                                                                },
                                                                            },
                                                                        )
                                                                    }
                                                                    className="block max-w-44 truncate whitespace-nowrap font-mono text-xs font-bold text-slate-950 hover:text-blue-700"
                                                                    title={order.code}
                                                                >
                                                                    {order.code}
                                                                </AdminButton>
                                                                <span
                                                                    className="block truncate text-[10px] text-slate-500"
                                                                    title={
                                                                        order.salesChannel
                                                                            ? getChannelDisplayName(
                                                                                  order.salesChannel,
                                                                              )
                                                                            : '归属待核实'
                                                                    }
                                                                >
                                                                    {order.salesChannel
                                                                        ? getChannelDisplayName(
                                                                              order.salesChannel,
                                                                          )
                                                                        : '归属待核实'}
                                                                </span>
                                                            </td>
                                                            <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono text-[10px] text-slate-500">
                                                                {formatDateTime(
                                                                    order.orderPlacedAt ?? order.createdAt,
                                                                )}
                                                            </td>
                                                            <td className="h-[52px] whitespace-nowrap px-3 py-0">
                                                                <span className="inline-flex whitespace-nowrap rounded bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-700">
                                                                    {kindLabel}
                                                                </span>
                                                            </td>
                                                            <td className="h-[52px] max-w-60 px-3 py-0">
                                                                <div className="flex max-w-56 items-center gap-1 whitespace-nowrap">
                                                                    <span
                                                                        tabIndex={0}
                                                                        className="min-w-0 truncate font-semibold text-slate-800 outline-none focus:text-blue-700"
                                                                        title={summary.productName}
                                                                        aria-label={summary.productName}
                                                                    >
                                                                        {summary.productName}
                                                                    </span>
                                                                    {summary.additionalLineCount > 0 && (
                                                                        <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold text-blue-700">
                                                                            +{summary.additionalLineCount}项
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </td>

                                                            <td className="h-[52px] whitespace-nowrap px-3 py-0 text-center font-mono font-bold text-slate-800">
                                                                {summary.quantity}
                                                            </td>
                                                            <td className="h-[52px] max-w-40 px-3 py-0">
                                                                <span
                                                                    tabIndex={0}
                                                                    className="block truncate font-semibold text-slate-900 outline-none focus:text-blue-700"
                                                                    title={summary.customerName}
                                                                    aria-label={summary.customerName}
                                                                >
                                                                    {summary.customerName}
                                                                </span>
                                                                <span
                                                                    className="block truncate text-[10px] text-slate-500"
                                                                    title={summary.contact}
                                                                >
                                                                    {summary.contact}
                                                                </span>
                                                            </td>

                                                            <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono text-xs font-bold tabular-nums text-slate-950">
                                                                {formatMoney(
                                                                    order.totalWithTax,
                                                                    order.currencyCode,
                                                                )}
                                                            </td>
                                                            <td className="h-[52px] whitespace-nowrap px-3 py-0">
                                                                <span
                                                                    className={`inline-flex whitespace-nowrap rounded-md border px-2 py-1 text-[10px] font-semibold ${getOrderStateClass(order.state)}`}
                                                                >
                                                                    {getOrderStateLabel(order.state)}
                                                                </span>
                                                            </td>
                                                            <td className="h-[52px] whitespace-nowrap px-3 py-0">
                                                                <span
                                                                    className={`whitespace-nowrap text-[10px] font-semibold ${summary.remainingPhysicalQuantity > 0 ? 'text-amber-700' : 'text-slate-500'}`}
                                                                >
                                                                    {order.processingSummary?.paymentLabel ||
                                                                        '付款待核实'}{' '}
                                                                    ·{' '}
                                                                    {order.processingSummary
                                                                        ?.fulfillmentLabel || '交付待核实'}
                                                                </span>
                                                                <span className="block text-[10px] text-slate-500">
                                                                    {order.processingSummary
                                                                        ?.afterSalesLabel ||
                                                                        '售后待核实'}{' '}
                                                                    ·{' '}
                                                                    {order.processingSummary
                                                                        ? getDigitalNotificationLabel(
                                                                              order.processingSummary.lines,
                                                                          )
                                                                        : '通知待核实'}
                                                                </span>
                                                            </td>
                                                            <td
                                                                className={`sticky right-0 z-10 h-[52px] whitespace-nowrap border-l border-slate-100 px-3 py-0 text-right ${stickyBackground}`}
                                                            >
                                                                <AdminButton
                                                                    type="button"
                                                                    onClick={() =>
                                                                        navigate(
                                                                            `/sales/orders/${order.id}`,
                                                                            {
                                                                                state: {
                                                                                    returnTo: `${location.pathname}${location.search}`,
                                                                                },
                                                                            },
                                                                        )
                                                                    }
                                                                    className="whitespace-nowrap rounded-lg bg-blue-50 px-3 py-1.5 text-[10px] font-semibold text-blue-700 transition hover:bg-blue-100 active:scale-[0.98]"
                                                                >
                                                                    {order.processingSummary?.nextAction
                                                                        ?.label || '查看订单'}
                                                                </AdminButton>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </>
                            )
                        )}

                        <div className="flex flex-wrap gap-y-3 gap-x-4 items-center justify-between border-t border-slate-200 bg-slate-50/60 px-4 py-3 text-xs text-slate-500">
                            <span>
                                第 {page + 1} / {totalPages} 页，共 {totalItems} 笔
                            </span>
                            <div className="flex flex-wrap items-center gap-1.5">
                                <PageSizeSelect
                                    pageSize={pageSize}
                                    onPageSizeChange={size => {
                                        setPageSize(size);
                                        setSelectedOrderIds([]);
                                    }}
                                    disabled={loading}
                                />
                                <AdminButton
                                    type="button"
                                    onClick={() => {
                                        setPage(Math.max(0, page - 1));
                                        setSelectedOrderIds([]);
                                    }}
                                    disabled={loading || page === 0}
                                    className="rounded-lg border border-slate-300 bg-white p-1.5 text-slate-600 disabled:opacity-40"
                                    aria-label="上一页"
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </AdminButton>
                                <AdminButton
                                    type="button"
                                    onClick={() => {
                                        setPage(Math.min(totalPages - 1, page + 1));
                                        setSelectedOrderIds([]);
                                    }}
                                    disabled={loading || page >= totalPages - 1}
                                    className="rounded-lg border border-slate-300 bg-white p-1.5 text-slate-600 disabled:opacity-40"
                                    aria-label="下一页"
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </AdminButton>
                            </div>
                        </div>
                    </section>
                </div>
            </div>

            {mobileFilterDraft && (
                <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-3 sm:items-center">
                    <AccessibleDialogSurface
                        accessibleName="订单筛选与排序"
                        onRequestClose={() => setMobileFilterDraft(null)}
                        mobilePresentation="sheet"
                        className="w-full max-w-lg rounded-xl bg-white p-4 shadow-xl"
                    >
                        <h2 className="mb-4 flex items-center gap-2 text-base font-semibold">
                            订单筛选与排序
                            <FeatureHelpButton topic="sales.orders" title="订单筛选与排序" />
                        </h2>
                        <div className="space-y-4">
                            <AdminField label="订单状态">
                                <AdminSelect
                                    value={mobileFilterDraft.tab}
                                    onChange={event =>
                                        setMobileFilterDraft({
                                            ...mobileFilterDraft,
                                            tab: event.target.value as OrderTab,
                                        })
                                    }
                                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                                >
                                    {tabs.map(tab => (
                                        <option key={tab.id} value={tab.id}>
                                            {tab.label}
                                        </option>
                                    ))}
                                </AdminSelect>
                            </AdminField>
                            <AdminMobileSort
                                fields={ORDER_SORT_OPTIONS}
                                sortField={mobileFilterDraft.field}
                                sortDirection={mobileFilterDraft.direction}
                                onSort={(field, direction) =>
                                    setMobileFilterDraft({ ...mobileFilterDraft, field, direction })
                                }
                            />
                            {mobileFilterDraft.clearSearch && (
                                <p className="text-xs text-slate-500">应用后清空搜索并恢复默认条件。</p>
                            )}
                        </div>
                        <footer className="mt-5 flex flex-wrap justify-end gap-2">
                            <AdminButton
                                type="button"
                                onClick={() =>
                                    setMobileFilterDraft({
                                        tab: 'ALL',
                                        field: 'orderPlacedAt',
                                        direction: 'DESC',
                                        clearSearch: true,
                                    })
                                }
                                className="mr-auto rounded-lg border border-slate-300 px-3 py-2"
                            >
                                重置
                            </AdminButton>
                            <AdminButton
                                type="button"
                                onClick={() => setMobileFilterDraft(null)}
                                className="rounded-lg border border-slate-300 px-3 py-2"
                            >
                                取消
                            </AdminButton>
                            <AdminButton
                                type="button"
                                onClick={applyMobileFilters}
                                className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white"
                            >
                                应用
                            </AdminButton>
                        </footer>
                    </AccessibleDialogSurface>
                </div>
            )}

            {canUpdateOrder && isBatchOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs"
                    onClick={() => !batchLocked && setIsBatchOpen(false)}
                >
                    <AccessibleDialogSurface
                        accessibleName="批量填写运单并创建履约"
                        onRequestClose={() => {
                            if (!batchLocked) setIsBatchOpen(false);
                        }}
                        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
                        onClick={event => event.stopPropagation()}
                    >
                        <header className="flex items-start justify-between border-b border-slate-200 bg-slate-50 px-6 py-4">
                            <div>
                                <h2
                                    id="batch-fulfillment-title"
                                    className="flex items-center gap-2 text-base font-semibold text-slate-950"
                                >
                                    批量填写运单并创建履约
                                    <FeatureHelpButton
                                        topic="sales.fulfillment"
                                        title="批量填写运单并创建履约"
                                        description={'每笔订单必须填写真实运单号，不自动生成虚假物流信息。'}
                                    />
                                </h2>
                            </div>
                            <AdminButton
                                type="button"
                                onClick={() => setIsBatchOpen(false)}
                                disabled={batchLocked}
                                className="text-slate-400 hover:text-slate-700"
                                aria-label="关闭"
                            >
                                <X className="h-5 w-5" />
                            </AdminButton>
                        </header>
                        <div className="flex-1 space-y-4 overflow-y-auto p-6">
                            <AdminField
                                label={
                                    <span className="mb-1.5 block text-xs font-semibold text-slate-700">
                                        物流公司 / 配送方式 *
                                    </span>
                                }
                            >
                                <AdminInput
                                    value={carrier}
                                    disabled={batchPhase !== 'idle'}
                                    onChange={event => setCarrier(event.target.value)}
                                    placeholder="例如：顺丰速运"
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                                />
                            </AdminField>
                            <div className="space-y-2">
                                <div className="text-xs font-semibold text-slate-700">订单与运单号</div>
                                {batchOrders.map(order => (
                                    <AdminField
                                        key={order.id}
                                        className="grid gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-[1fr_1.2fr] sm:items-center"
                                        label={
                                            <>
                                                <span>
                                                    <span className="block font-mono text-xs font-semibold text-slate-900">
                                                        {order.code}
                                                    </span>
                                                    <span className="mt-0.5 block text-[10px] text-slate-500">
                                                        {getProcessingPhysicalLines(order).reduce(
                                                            (sum, line) => sum + line.quantity,
                                                            0,
                                                        )}{' '}
                                                        件实物
                                                    </span>
                                                </span>
                                            </>
                                        }
                                    >
                                        {' '}
                                        <AdminInput
                                            value={trackingCodes[order.id] ?? ''}
                                            disabled={batchPhase !== 'idle'}
                                            onChange={event =>
                                                setTrackingCodes(current => ({
                                                    ...current,
                                                    [order.id]: event.target.value,
                                                }))
                                            }
                                            placeholder="填写该订单真实运单号"
                                            className="rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                                        />
                                    </AdminField>
                                ))}
                            </div>
                            {batchProgress && (
                                <div className="flex items-center gap-2 rounded-lg bg-blue-50 p-3 text-xs text-blue-700">
                                    <RefreshCw className="h-4 w-4 animate-spin" />
                                    {batchProgress}
                                </div>
                            )}
                            {batchSummary && (
                                <div
                                    role="status"
                                    className="rounded-lg bg-blue-50 p-3 text-xs leading-5 text-blue-700"
                                >
                                    {batchSummary}
                                </div>
                            )}
                            {actionError && (
                                <div
                                    role="alert"
                                    className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-700"
                                >
                                    {actionError}
                                </div>
                            )}
                        </div>
                        <footer className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4">
                            <AdminButton
                                type="button"
                                onClick={() => setIsBatchOpen(false)}
                                disabled={batchLocked}
                                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
                            >
                                {batchPhase === 'done' ? '完成' : '取消'}
                            </AdminButton>
                            {batchPhase === 'read-failed' ? (
                                <AdminButton
                                    type="button"
                                    onClick={() => void readBatchResult()}
                                    className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white"
                                >
                                    核对最新履约
                                </AdminButton>
                            ) : (
                                batchPhase !== 'done' && (
                                    <AdminButton
                                        type="button"
                                        onClick={handleBatchFulfillment}
                                        disabled={batchLocked}
                                        className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                                    >
                                        {batchLocked && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                                        确认创建履约
                                    </AdminButton>
                                )
                            )}
                        </footer>
                    </AccessibleDialogSurface>
                </div>
            )}
        </div>
    );
}
