/* eslint-disable max-len -- Tailwind utility lists are intentionally kept as single JSX attributes. */
import { useMutation, useQuery } from '@apollo/client/react';
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
    Search,
    Truck,
    X,
} from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import {
    ADD_ORDER_FULFILLMENT,
    CREATE_DRAFT_ORDER,
    GET_SALES_ORDERS,
    TRANSITION_SALES_FULFILLMENT,
} from '../../graphql/sales.graphql';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { useUrlListState } from '../../hooks/use-url-list-state';
import { useUrlTab } from '../../hooks/use-url-tab';
import { toUserFacingError } from '../../utils/user-facing-error';

import {
    formatAddress,
    formatDateTime,
    formatMoney,
    getCustomerName,
    getMutationError,
    getOrderFulfillmentKind,
    getOrderStateClass,
    getOrderStateLabel,
    getRemainingPhysicalLines,
    summarizeOrderListItem,
} from './sales-utils';

type OrderTab = 'ALL' | 'DRAFT' | 'TO_SETTLE' | 'TO_FULFILL' | 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED';
const ORDER_TABS = {
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
    orders: { items: SalesOrderItem[]; totalItems: number };
    physicalFulfillmentTodoCount: number;
}

interface FulfillmentMutationData {
    addFulfillmentToOrder: {
        __typename: string;
        id?: string;
        errorCode?: string;
        message?: string;
    };
}

const PAGE_SIZE = 20;
const ORDER_TAB_RESET_PARAMETERS = ['page'];
const EMPTY_ORDERS: SalesOrderItem[] = [];
const FULFILLABLE_STATES = ['PaymentAuthorized', 'PaymentSettled', 'PartiallyShipped', 'PartiallyDelivered'];
const tabs: Array<{ id: OrderTab; label: string }> = [
    { id: 'ALL', label: '全部交易' },
    { id: 'DRAFT', label: '草稿订单' },
    { id: 'TO_SETTLE', label: '支付已授权' },
    { id: 'TO_FULFILL', label: '待处理履约' },
    { id: 'IN_TRANSIT', label: '配送中' },
    { id: 'DELIVERED', label: '已完成' },
    { id: 'CANCELLED', label: '已取消' },
];
const tabStateFilter: Record<OrderTab, Record<string, unknown>> = {
    ALL: { notIn: ['AddingItems', 'Draft'] },
    DRAFT: { in: ['AddingItems', 'Draft'] },
    TO_SETTLE: { eq: 'PaymentAuthorized' },
    TO_FULFILL: { in: FULFILLABLE_STATES },
    IN_TRANSIT: { in: ['PartiallyShipped', 'Shipped', 'PartiallyDelivered'] },
    DELIVERED: { eq: 'Delivered' },
    CANCELLED: { eq: 'Cancelled' },
};
const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;

export function SalesModule() {
    const navigate = useNavigate();
    const { hasAnyPermission } = useAdminPermissions();
    const canCreateOrder = hasAnyPermission(['CreateOrder']);
    const canUpdateOrder = hasAnyPermission(['UpdateOrder']);
    const [activeTab, setActiveTab] = useUrlTab<OrderTab>(
        ORDER_TABS,
        'all',
        'tab',
        ORDER_TAB_RESET_PARAMETERS,
    );
    const { page, searchTerm, setPage, setSearchTerm } = useUrlListState();
    const deferredSearchTerm = useDeferredValue(searchTerm);
    const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
    const [isBatchOpen, setIsBatchOpen] = useState(false);
    const [carrier, setCarrier] = useState('');
    const [trackingCodes, setTrackingCodes] = useState<Record<string, string>>({});
    const [notification, setNotification] = useState('');
    const [actionError, setActionError] = useState('');
    const [batchProgress, setBatchProgress] = useState('');

    const queryVariables = useMemo(() => {
        const filters: Array<Record<string, unknown>> = [{ state: tabStateFilter[activeTab] }];
        if (activeTab !== 'DRAFT') filters.unshift({ active: { eq: false } });
        const query = deferredSearchTerm.trim();
        if (query) {
            filters.push({
                _or: [
                    { code: { contains: query } },
                    { customerLastName: { contains: query } },
                    { deliveryEmail: { contains: query } },
                    { transactionId: { contains: query } },
                ],
            });
        }
        return {
            options: {
                skip: page * PAGE_SIZE,
                take: PAGE_SIZE,
                sort: { orderPlacedAt: 'DESC' },
                filter: { _and: filters },
            },
        };
    }, [activeTab, deferredSearchTerm, page]);

    const { data, loading, error, refetch } = useQuery<SalesOrdersData>(GET_SALES_ORDERS, {
        variables: queryVariables,
        fetchPolicy: 'cache-first',
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
    const orders = data?.orders.items ?? EMPTY_ORDERS;
    const totalItems = data?.orders.totalItems ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
    const physicalTodoCount = data?.physicalFulfillmentTodoCount ?? 0;
    const selectableOrders = orders.filter(
        order => FULFILLABLE_STATES.includes(order.state) && getRemainingPhysicalLines(order).length > 0,
    );
    const selectedOrders = orders.filter(order => selectedOrderIds.includes(order.id));
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
            navigate(`/sales/orders/draft/${draft.id}`);
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
    const openBatchFulfillment = () => {
        if (selectedOrders.length === 0) return;
        setTrackingCodes(
            Object.fromEntries(selectedOrders.map(order => [order.id, trackingCodes[order.id] ?? ''])),
        );
        setActionError('');
        setBatchProgress('');
        setIsBatchOpen(true);
    };

    const handleBatchFulfillment = async () => {
        const normalizedCarrier = carrier.trim();
        if (!normalizedCarrier) {
            setActionError('请填写物流公司或配送方式');
            return;
        }
        const missingTrackingOrder = selectedOrders.find(order => !trackingCodes[order.id]?.trim());
        if (missingTrackingOrder) {
            setActionError(`订单 ${missingTrackingOrder.code} 尚未填写运单号`);
            return;
        }

        setActionError('');
        const failures: string[] = [];
        let successCount = 0;
        for (let index = 0; index < selectedOrders.length; index += 1) {
            const order = selectedOrders[index];
            setBatchProgress(`正在处理 ${index + 1}/${selectedOrders.length}：${order.code}`);
            try {
                const response = await addFulfillment({
                    variables: {
                        input: {
                            lines: getRemainingPhysicalLines(order),
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
                failures.push(`${order.code}：${toUserFacingError(mutationError, '发货请求失败')}`);
            }
        }

        setBatchProgress('');
        await refetch();
        setSelectedOrderIds([]);
        if (failures.length) {
            setActionError(`已成功 ${successCount} 笔，失败 ${failures.length} 笔。${failures.join('；')}`);
            return;
        }
        setIsBatchOpen(false);
        setCarrier('');
        setTrackingCodes({});
        showNotice(`已创建 ${successCount} 笔真实履约记录`);
    };

    const exportCurrentPage = () => {
        if (orders.length === 0) {
            setActionError('当前页没有可导出的订单');
            return;
        }
        const header = ['订单号', '下单时间', '客户', '邮箱', '金额', '币种', '状态', '履约类型', '收货地址'];
        const rows = orders.map(order => [
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
                        <h1 className="text-xl font-semibold tracking-tight text-slate-950">订单与履约</h1>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                            集中处理支付状态、实物发货、虚拟交付与交易查询
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {canCreateOrder && (
                            <button
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
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => refetch()}
                            disabled={loading}
                            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 active:scale-[0.98] disabled:opacity-50"
                        >
                            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                            刷新
                        </button>
                        <button
                            type="button"
                            onClick={exportCurrentPage}
                            className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 active:scale-[0.98]"
                        >
                            <Download className="h-3.5 w-3.5" />
                            导出当前页
                        </button>
                    </div>
                </div>
            </header>

            <nav
                aria-label="订单状态筛选"
                className="scrollbar-hidden shrink-0 overflow-x-auto border-b border-slate-200 bg-white px-5 sm:px-8"
            >
                <div className="flex w-full min-w-max gap-6">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            type="button"
                            aria-current={activeTab === tab.id ? 'page' : undefined}
                            onClick={() => resetListState(tab.id)}
                            className={`border-b-2 py-3.5 text-xs font-semibold transition ${activeTab === tab.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-900'}`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </nav>

            <div className="flex-1 overflow-y-auto p-5 sm:p-8">
                <div className="w-full max-w-none space-y-4">
                    <div className="grid gap-3 sm:grid-cols-3">
                        <div className="rounded-xl bg-slate-900 p-4 text-white shadow-sm">
                            <div className="text-[11px] font-medium text-slate-300">当前筛选</div>
                            <div className="mt-2 font-mono text-2xl font-semibold tabular-nums">
                                {totalItems}
                            </div>
                            <div className="mt-1 text-[11px] text-slate-400">笔订单</div>
                        </div>
                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-700">
                                <Truck className="h-3.5 w-3.5" />
                                实物待发货
                            </div>
                            <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-amber-900">
                                {physicalTodoCount}
                            </div>
                            <div className="mt-1 text-[11px] text-amber-700">已排除纯虚拟订单</div>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-white p-4">
                            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                                <PackageCheck className="h-3.5 w-3.5" />
                                本页可批量发货
                            </div>
                            <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900">
                                {selectableOrders.length}
                            </div>
                            <div className="mt-1 text-[11px] text-slate-500">只包含尚未履约的实物明细</div>
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
                    {error && (
                        <div
                            role="alert"
                            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800"
                        >
                            <span className="flex items-center gap-2">
                                <AlertCircle className="h-4 w-4" />
                                {toUserFacingError(error, '订单数据加载失败，请稍后重试')}
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
                                        setSelectedOrderIds([]);
                                    }}
                                    aria-label="搜索订单"
                                    placeholder="搜索订单号、买家姓氏、邮箱或支付流水号"
                                    className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-9 text-xs outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                                />
                                {searchTerm && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSearchTerm('');
                                        }}
                                        className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-700"
                                        aria-label="清空搜索"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                )}
                            </div>
                            <div className="flex items-center gap-3">
                                <span className="text-xs text-slate-500">
                                    已选{' '}
                                    <strong className="font-mono text-slate-900">
                                        {selectedOrderIds.length}
                                    </strong>{' '}
                                    笔
                                </span>
                                {canUpdateOrder && (
                                    <button
                                        type="button"
                                        onClick={openBatchFulfillment}
                                        disabled={selectedOrders.length === 0}
                                        className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-amber-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        <Truck className="h-3.5 w-3.5" />
                                        批量填写运单并发货
                                    </button>
                                )}
                            </div>
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
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[2180px] border-collapse text-left text-xs">
                                        <thead>
                                            <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-500">
                                                <th
                                                    scope="col"
                                                    className="sticky left-0 z-20 w-12 bg-slate-50 px-3 py-3"
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={allSelectableChecked}
                                                        onChange={toggleAll}
                                                        aria-label="选择本页所有可发货订单"
                                                        className="h-4 w-4 rounded"
                                                    />
                                                </th>
                                                <th
                                                    scope="col"
                                                    className="sticky left-12 z-20 w-48 whitespace-nowrap bg-slate-50 px-3 py-3"
                                                >
                                                    订单号
                                                </th>
                                                <th scope="col" className="w-40 whitespace-nowrap px-3 py-3">
                                                    下单时间
                                                </th>
                                                <th scope="col" className="w-24 whitespace-nowrap px-3 py-3">
                                                    商品类型
                                                </th>
                                                <th scope="col" className="w-60 whitespace-nowrap px-3 py-3">
                                                    商品名称
                                                </th>
                                                <th scope="col" className="w-48 whitespace-nowrap px-3 py-3">
                                                    规格
                                                </th>
                                                <th scope="col" className="w-40 whitespace-nowrap px-3 py-3">
                                                    SKU
                                                </th>
                                                <th
                                                    scope="col"
                                                    className="w-24 whitespace-nowrap px-3 py-3 text-center"
                                                >
                                                    购买数量
                                                </th>
                                                <th scope="col" className="w-40 whitespace-nowrap px-3 py-3">
                                                    买家
                                                </th>
                                                <th scope="col" className="w-56 whitespace-nowrap px-3 py-3">
                                                    联系方式
                                                </th>
                                                <th scope="col" className="w-72 whitespace-nowrap px-3 py-3">
                                                    收货地址
                                                </th>
                                                <th scope="col" className="w-36 whitespace-nowrap px-3 py-3">
                                                    实付金额
                                                </th>
                                                <th scope="col" className="w-32 whitespace-nowrap px-3 py-3">
                                                    订单状态
                                                </th>
                                                <th scope="col" className="w-28 whitespace-nowrap px-3 py-3">
                                                    履约状态
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
                                                const remainingLines = getRemainingPhysicalLines(order);
                                                const canFulfill =
                                                    canUpdateOrder &&
                                                    FULFILLABLE_STATES.includes(order.state) &&
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
                                                            <input
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
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    navigate(`/sales/orders/${order.id}`)
                                                                }
                                                                className="block max-w-44 truncate whitespace-nowrap font-mono text-xs font-bold text-slate-950 hover:text-blue-700"
                                                                title={order.code}
                                                            >
                                                                {order.code}
                                                            </button>
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
                                                        <td className="h-[52px] max-w-48 px-3 py-0">
                                                            <span
                                                                tabIndex={0}
                                                                className="block truncate outline-none focus:text-blue-700"
                                                                title={summary.specification}
                                                                aria-label={summary.specification}
                                                            >
                                                                {summary.specification}
                                                            </span>
                                                        </td>
                                                        <td className="h-[52px] max-w-40 px-3 py-0">
                                                            <span
                                                                tabIndex={0}
                                                                className="block truncate font-mono text-[10px] text-slate-600 outline-none focus:text-blue-700"
                                                                title={summary.sku}
                                                                aria-label={summary.sku}
                                                            >
                                                                {summary.sku}
                                                            </span>
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
                                                        </td>
                                                        <td className="h-[52px] max-w-56 px-3 py-0">
                                                            <span
                                                                tabIndex={0}
                                                                className="block truncate text-slate-600 outline-none focus:text-blue-700"
                                                                title={summary.contact}
                                                                aria-label={summary.contact}
                                                            >
                                                                {summary.contact}
                                                            </span>
                                                        </td>
                                                        <td className="h-[52px] max-w-72 px-3 py-0">
                                                            <span
                                                                tabIndex={0}
                                                                className="block truncate text-slate-500 outline-none focus:text-blue-700"
                                                                title={summary.shippingAddress}
                                                                aria-label={summary.shippingAddress}
                                                            >
                                                                {summary.shippingAddress}
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
                                                                {summary.fulfillmentLabel}
                                                            </span>
                                                        </td>
                                                        <td
                                                            className={`sticky right-0 z-10 h-[52px] whitespace-nowrap border-l border-slate-100 px-3 py-0 text-right ${stickyBackground}`}
                                                        >
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    navigate(`/sales/orders/${order.id}`)
                                                                }
                                                                className="whitespace-nowrap rounded-lg bg-blue-50 px-3 py-1.5 text-[10px] font-semibold text-blue-700 transition hover:bg-blue-100 active:scale-[0.98]"
                                                            >
                                                                查看处理
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )
                        )}

                        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50/60 px-4 py-3 text-xs text-slate-500">
                            <span>
                                第 {page + 1} / {totalPages} 页，共 {totalItems} 笔
                            </span>
                            <div className="flex gap-1.5">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setPage(Math.max(0, page - 1));
                                        setSelectedOrderIds([]);
                                    }}
                                    disabled={page === 0}
                                    className="rounded-lg border border-slate-300 bg-white p-1.5 text-slate-600 disabled:opacity-40"
                                    aria-label="上一页"
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setPage(Math.min(totalPages - 1, page + 1));
                                        setSelectedOrderIds([]);
                                    }}
                                    disabled={page >= totalPages - 1}
                                    className="rounded-lg border border-slate-300 bg-white p-1.5 text-slate-600 disabled:opacity-40"
                                    aria-label="下一页"
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </button>
                            </div>
                        </div>
                    </section>
                </div>
            </div>

            {canUpdateOrder && isBatchOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs"
                    onClick={() => !fulfilling && !transitioning && setIsBatchOpen(false)}
                >
                    <AccessibleDialogSurface
                        accessibleName="批量填写运单并创建履约"
                        onRequestClose={() => {
                            if (!fulfilling && !transitioning) setIsBatchOpen(false);
                        }}
                        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
                        onClick={event => event.stopPropagation()}
                    >
                        <header className="flex items-start justify-between border-b border-slate-200 bg-slate-50 px-6 py-4">
                            <div>
                                <h2
                                    id="batch-fulfillment-title"
                                    className="text-base font-semibold text-slate-950"
                                >
                                    批量填写运单并创建履约
                                </h2>
                                <p className="mt-1 text-xs text-slate-500">
                                    每笔订单必须填写真实运单号，不自动生成虚假物流信息。
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsBatchOpen(false)}
                                disabled={fulfilling || transitioning}
                                className="text-slate-400 hover:text-slate-700"
                                aria-label="关闭"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </header>
                        <div className="flex-1 space-y-4 overflow-y-auto p-6">
                            <div>
                                <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                                    物流公司 / 配送方式 *
                                </label>
                                <input
                                    value={carrier}
                                    onChange={event => setCarrier(event.target.value)}
                                    placeholder="例如：顺丰速运"
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                                />
                            </div>
                            <div className="space-y-2">
                                <div className="text-xs font-semibold text-slate-700">订单与运单号</div>
                                {selectedOrders.map(order => (
                                    <label
                                        key={order.id}
                                        className="grid gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-[1fr_1.2fr] sm:items-center"
                                    >
                                        <span>
                                            <span className="block font-mono text-xs font-semibold text-slate-900">
                                                {order.code}
                                            </span>
                                            <span className="mt-0.5 block text-[10px] text-slate-500">
                                                {getRemainingPhysicalLines(order).reduce(
                                                    (sum, line) => sum + line.quantity,
                                                    0,
                                                )}{' '}
                                                件实物
                                            </span>
                                        </span>
                                        <input
                                            value={trackingCodes[order.id] ?? ''}
                                            onChange={event =>
                                                setTrackingCodes(current => ({
                                                    ...current,
                                                    [order.id]: event.target.value,
                                                }))
                                            }
                                            placeholder="填写该订单真实运单号"
                                            className="rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                                        />
                                    </label>
                                ))}
                            </div>
                            {batchProgress && (
                                <div className="flex items-center gap-2 rounded-lg bg-blue-50 p-3 text-xs text-blue-700">
                                    <RefreshCw className="h-4 w-4 animate-spin" />
                                    {batchProgress}
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
                            <button
                                type="button"
                                onClick={() => setIsBatchOpen(false)}
                                disabled={fulfilling || transitioning}
                                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
                            >
                                取消
                            </button>
                            <button
                                type="button"
                                onClick={handleBatchFulfillment}
                                disabled={fulfilling || transitioning}
                                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                                {(fulfilling || transitioning) && (
                                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                )}
                                确认创建履约
                            </button>
                        </footer>
                    </AccessibleDialogSurface>
                </div>
            )}
        </div>
    );
}
