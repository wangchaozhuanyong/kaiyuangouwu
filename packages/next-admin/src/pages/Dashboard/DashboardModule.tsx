/* eslint-disable max-len -- Tailwind utility lists are intentionally kept as single JSX attributes. */
import { useQuery } from '@apollo/client/react';
import {
    AlertCircle,
    ArrowRight,
    Clock3,
    Eye,
    EyeOff,
    GripVertical,
    KeyRound,
    LayoutGrid,
    LayoutTemplate,
    MessageSquareText,
    PackageCheck,
    Plus,
    ReceiptText,
    RefreshCw,
    RotateCcw,
    Settings2,
    ShoppingBag,
    Sparkles,
    TrendingUp,
    X,
    type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
    DASHBOARD_BOOTSTRAP_QUERY,
    DASHBOARD_METRICS_QUERY,
    type DashboardBootstrapData,
    type DashboardMetricsData,
} from '../../graphql/dashboard.graphql';
import { useAccessibleDialog } from '../../hooks/use-accessible-dialog';
import { getChannelDisplayName } from '../../utils/channel-display';
import {
    compareMetric,
    getMetricRange,
    getPreviousMetricRange,
    type MetricComparison,
    type MetricPeriod,
} from '../../utils/dashboard-metrics';
import { toUserFacingError } from '../../utils/user-facing-error';
import {
    formatDateTime,
    formatMoney,
    getCustomerName,
    getOrderStateClass,
    getOrderStateLabel,
} from '../Sales/sales-utils';

type DashboardWidgetId =
    | 'METRICS'
    | 'SHIPMENTS'
    | 'AFTER_SALES'
    | 'CARD_ALERTS'
    | 'REVIEWS'
    | 'RECENT_ORDERS'
    | 'QUICK_ACTIONS'
    | 'SEARCH_INDEX';
type DashboardPresetId = 'MANAGER' | 'CATALOG' | 'SERVICE';

const DASHBOARD_WIDGET_STORAGE_KEY = 'vendure-next-admin-dashboard-widgets-v1';
const ALL_WIDGETS: DashboardWidgetId[] = [
    'METRICS',
    'SHIPMENTS',
    'AFTER_SALES',
    'CARD_ALERTS',
    'REVIEWS',
    'RECENT_ORDERS',
    'QUICK_ACTIONS',
    'SEARCH_INDEX',
];
const WIDGET_LABELS: Record<DashboardWidgetId, string> = {
    METRICS: '核心经营指标',
    SHIPMENTS: '待发货订单',
    AFTER_SALES: '待处理售后',
    CARD_ALERTS: '卡密发货预警',
    REVIEWS: '待审核评价',
    RECENT_ORDERS: '最近订单',
    QUICK_ACTIONS: '快捷操作',
    SEARCH_INDEX: '商品索引状态',
};
const DASHBOARD_PRESETS: Record<
    DashboardPresetId,
    { label: string; description: string; visible: DashboardWidgetId[] }
> = {
    MANAGER: { label: '店长', description: '经营指标、全店待办与最新订单', visible: ALL_WIDGETS },
    CATALOG: {
        label: '商品运营',
        description: '商品发布、库存与索引状态优先',
        visible: ['METRICS', 'CARD_ALERTS', 'SEARCH_INDEX', 'RECENT_ORDERS', 'QUICK_ACTIONS'],
    },
    SERVICE: {
        label: '售后客服',
        description: '发货、售后、评价与订单优先',
        visible: ['SHIPMENTS', 'AFTER_SALES', 'REVIEWS', 'RECENT_ORDERS', 'QUICK_ACTIONS'],
    },
};

interface DashboardWidgetPreferences {
    order: DashboardWidgetId[];
    hidden: DashboardWidgetId[];
}

const loadWidgetPreferences = (): DashboardWidgetPreferences => {
    try {
        const parsed = JSON.parse(
            localStorage.getItem(DASHBOARD_WIDGET_STORAGE_KEY) || '{}',
        ) as Partial<DashboardWidgetPreferences>;
        const order = Array.isArray(parsed.order)
            ? parsed.order.filter((item): item is DashboardWidgetId => ALL_WIDGETS.includes(item))
            : [];
        const hidden = Array.isArray(parsed.hidden)
            ? parsed.hidden.filter((item): item is DashboardWidgetId => ALL_WIDGETS.includes(item))
            : [];
        return { order: [...order, ...ALL_WIDGETS.filter(item => !order.includes(item))], hidden };
    } catch {
        return { order: ALL_WIDGETS, hidden: [] };
    }
};

const PERIODS: Array<{ id: MetricPeriod; label: string }> = [
    { id: 'TODAY', label: '今日' },
    { id: '7D', label: '近 7 天' },
    { id: '30D', label: '近 30 天' },
];

const metricTotal = (data: DashboardMetricsData | undefined, type: 'OrderCount' | 'OrderTotal') =>
    data?.dashboardMetricSummary
        .find(summary => summary.type === type)
        ?.entries.reduce((total, entry) => total + entry.value, 0) ?? 0;

export function DashboardModule() {
    const navigate = useNavigate();
    const [period, setPeriod] = useState<MetricPeriod>('TODAY');
    const [rangeEnd, setRangeEnd] = useState(() => Date.now());
    const [widgetPreferences, setWidgetPreferences] = useState(loadWidgetPreferences);
    const [isCustomizing, setIsCustomizing] = useState(false);
    const { dialogRef: customizerDialogRef, titleId: customizerTitleId } = useAccessibleDialog(
        () => setIsCustomizing(false),
        isCustomizing,
    );
    const [draggedWidget, setDraggedWidget] = useState<DashboardWidgetId | null>(null);
    const dateRange = useMemo(() => getMetricRange(period, rangeEnd), [period, rangeEnd]);
    const previousDateRange = useMemo(() => getPreviousMetricRange(dateRange), [dateRange]);

    useEffect(() => {
        const timer = window.setInterval(() => setRangeEnd(Date.now()), 60_000);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        localStorage.setItem(DASHBOARD_WIDGET_STORAGE_KEY, JSON.stringify(widgetPreferences));
    }, [widgetPreferences]);

    const dashboard = useQuery<DashboardBootstrapData>(DASHBOARD_BOOTSTRAP_QUERY, {
        variables: {
            input: {
                types: ['OrderCount', 'OrderTotal'],
                refresh: true,
                ...dateRange,
            },
            options: {
                take: 8,
                sort: { orderPlacedAt: 'DESC' },
                filter: { active: { eq: false } },
            },
        },
        fetchPolicy: 'cache-first',
        notifyOnNetworkStatusChange: true,
    });
    const previousMetrics = useQuery<DashboardMetricsData>(DASHBOARD_METRICS_QUERY, {
        variables: {
            input: {
                types: ['OrderCount', 'OrderTotal'],
                refresh: true,
                ...previousDateRange,
            },
        },
        fetchPolicy: 'cache-first',
        notifyOnNetworkStatusChange: true,
    });
    const metrics = dashboard;
    const todo = dashboard;
    const recentOrders = dashboard;

    const currencyCode = metrics.data?.activeChannel.defaultCurrencyCode ?? 'CNY';
    const orderTotal = metricTotal(metrics.data, 'OrderTotal');
    const orderCount = metricTotal(metrics.data, 'OrderCount');
    const averageOrderValue = orderCount > 0 ? orderTotal / orderCount : 0;
    const previousOrderTotal = metricTotal(previousMetrics.data, 'OrderTotal');
    const previousOrderCount = metricTotal(previousMetrics.data, 'OrderCount');
    const previousAverageOrderValue = previousOrderCount > 0 ? previousOrderTotal / previousOrderCount : 0;
    const autoCardCount = todo.data
        ? todo.data.autoCardTodoSummary.lowStockSkuCount +
          todo.data.autoCardTodoSummary.waitingStockDeliveryCount +
          todo.data.autoCardTodoSummary.manualReviewCount
        : 0;
    const isRefreshing = metrics.loading || previousMetrics.loading || todo.loading || recentOrders.loading;

    const refreshAll = () => {
        setRangeEnd(Date.now());
    };

    const toggleWidget = (widgetId: DashboardWidgetId) => {
        setWidgetPreferences(previous => ({
            ...previous,
            hidden: previous.hidden.includes(widgetId)
                ? previous.hidden.filter(item => item !== widgetId)
                : [...previous.hidden, widgetId],
        }));
    };

    const applyPreset = (presetId: DashboardPresetId) => {
        const visible = DASHBOARD_PRESETS[presetId].visible;
        setWidgetPreferences({
            order: [...visible, ...ALL_WIDGETS.filter(item => !visible.includes(item))],
            hidden: ALL_WIDGETS.filter(item => !visible.includes(item)),
        });
    };

    const moveWidgetBefore = (targetWidget: DashboardWidgetId) => {
        if (!draggedWidget || draggedWidget === targetWidget) return;
        setWidgetPreferences(previous => {
            const order = previous.order.filter(item => item !== draggedWidget);
            const targetIndex = order.indexOf(targetWidget);
            order.splice(targetIndex, 0, draggedWidget);
            return { ...previous, order };
        });
    };

    const visibleWidgets = widgetPreferences.order.filter(
        widgetId => !widgetPreferences.hidden.includes(widgetId),
    );

    return (
        <div className="flex h-full flex-col bg-slate-50">
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
                <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <div className="flex flex-wrap items-center gap-2">
                            <h1 className="text-xl font-bold text-slate-900">经营概览</h1>
                            <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">
                                当前店铺：
                                {metrics.data
                                    ? getChannelDisplayName(metrics.data.activeChannel.code)
                                    : '读取中'}
                            </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">订单、履约与售后数据每分钟自动更新</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="flex rounded-lg bg-slate-100 p-1" aria-label="经营指标统计周期">
                            {PERIODS.map(item => (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => setPeriod(item.id)}
                                    className={`rounded-md px-3 py-1.5 text-xs font-bold transition-colors ${period === item.id ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                                    aria-pressed={period === item.id}
                                >
                                    {item.label}
                                </button>
                            ))}
                        </div>
                        <button
                            type="button"
                            onClick={() => setIsCustomizing(true)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                        >
                            <LayoutGrid className="h-3.5 w-3.5" /> 调整工作台
                        </button>
                        <button
                            type="button"
                            onClick={refreshAll}
                            disabled={isRefreshing}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                            刷新
                        </button>
                        <button
                            type="button"
                            onClick={() => navigate('/catalog/products/new')}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700"
                        >
                            <Plus className="h-4 w-4" /> 发布商品
                        </button>
                    </div>
                </div>
            </header>

            <main className="flex-1 overflow-y-auto px-5 py-6 sm:px-8">
                <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-12">
                    {visibleWidgets.map(widgetId => {
                        const spanClass =
                            widgetId === 'METRICS' || widgetId === 'SEARCH_INDEX'
                                ? 'sm:col-span-2 xl:col-span-12'
                                : widgetId === 'RECENT_ORDERS'
                                  ? 'sm:col-span-2 xl:col-span-8'
                                  : widgetId === 'QUICK_ACTIONS'
                                    ? 'sm:col-span-2 xl:col-span-4'
                                    : 'xl:col-span-3';
                        return (
                            <div
                                key={widgetId}
                                className={`relative min-w-0 ${spanClass} ${draggedWidget === widgetId ? 'opacity-50' : ''}`}
                                onDragOver={event => event.preventDefault()}
                                onDrop={() => {
                                    moveWidgetBefore(widgetId);
                                    setDraggedWidget(null);
                                }}
                            >
                                {isCustomizing && (
                                    <div className="absolute right-2 top-2 z-20 flex items-center gap-1 rounded-lg border border-blue-200 bg-white p-1 shadow-sm">
                                        <button
                                            type="button"
                                            draggable
                                            onDragStart={() => setDraggedWidget(widgetId)}
                                            onDragEnd={() => setDraggedWidget(null)}
                                            className="cursor-grab rounded p-1 text-slate-400 hover:bg-slate-100 active:cursor-grabbing"
                                            aria-label={`拖动${WIDGET_LABELS[widgetId]}`}
                                            title="拖动排序"
                                        >
                                            <GripVertical className="h-4 w-4" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => toggleWidget(widgetId)}
                                            className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                                            aria-label={`隐藏${WIDGET_LABELS[widgetId]}`}
                                        >
                                            <EyeOff className="h-4 w-4" />
                                        </button>
                                    </div>
                                )}

                                {widgetId === 'METRICS' && (
                                    <section aria-labelledby="dashboard-metrics-title">
                                        <div className="mb-3">
                                            <h2
                                                id="dashboard-metrics-title"
                                                className="text-sm font-bold text-slate-900"
                                            >
                                                核心经营指标
                                            </h2>
                                            <p className="mt-0.5 text-[11px] text-slate-500">
                                                按已结算支付金额统计，退款会从成交额中扣除
                                            </p>
                                        </div>
                                        {metrics.error && !metrics.data ? (
                                            <ErrorPanel
                                                message="经营指标加载失败"
                                                detail={metrics.error.message}
                                                onRetry={() => void metrics.refetch()}
                                            />
                                        ) : (
                                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                                                <MetricCard
                                                    label="实付成交额"
                                                    value={
                                                        metrics.loading && !metrics.data
                                                            ? '读取中…'
                                                            : formatMoney(orderTotal, currencyCode)
                                                    }
                                                    detail={
                                                        PERIODS.find(item => item.id === period)?.label ??
                                                        '当前周期'
                                                    }
                                                    comparison={
                                                        previousMetrics.data
                                                            ? compareMetric(orderTotal, previousOrderTotal)
                                                            : undefined
                                                    }
                                                    icon={TrendingUp}
                                                    tone="emerald"
                                                />
                                                <MetricCard
                                                    label="支付订单数"
                                                    value={
                                                        metrics.loading && !metrics.data
                                                            ? '读取中…'
                                                            : `${new Intl.NumberFormat('zh-CN').format(orderCount)} 笔`
                                                    }
                                                    detail="已完成支付的有效订单"
                                                    comparison={
                                                        previousMetrics.data
                                                            ? compareMetric(orderCount, previousOrderCount)
                                                            : undefined
                                                    }
                                                    icon={ShoppingBag}
                                                    tone="blue"
                                                />
                                                <MetricCard
                                                    label="平均客单价"
                                                    value={
                                                        metrics.loading && !metrics.data
                                                            ? '读取中…'
                                                            : formatMoney(averageOrderValue, currencyCode)
                                                    }
                                                    detail={
                                                        orderCount > 0
                                                            ? '成交额 ÷ 支付订单数'
                                                            : '当前周期暂无支付订单'
                                                    }
                                                    comparison={
                                                        previousMetrics.data
                                                            ? compareMetric(
                                                                  averageOrderValue,
                                                                  previousAverageOrderValue,
                                                              )
                                                            : undefined
                                                    }
                                                    icon={ReceiptText}
                                                    tone="violet"
                                                />
                                            </div>
                                        )}
                                    </section>
                                )}

                                {widgetId === 'SHIPMENTS' && (
                                    <TodoCard
                                        label="待发货订单"
                                        description="已付款、等待履约"
                                        count={todo.data?.pendingShipment}
                                        loading={todo.loading && !todo.data}
                                        icon={PackageCheck}
                                        onClick={() => navigate('/sales/orders?tab=to-fulfill')}
                                    />
                                )}
                                {widgetId === 'AFTER_SALES' && (
                                    <TodoCard
                                        label="待处理售后"
                                        description="退款与退货申请"
                                        count={todo.data?.pendingAfterSales.totalItems}
                                        loading={todo.loading && !todo.data}
                                        icon={RotateCcw}
                                        onClick={() => navigate('/sales/after-sales?tab=pending')}
                                    />
                                )}
                                {widgetId === 'CARD_ALERTS' && (
                                    <TodoCard
                                        label="卡密发货预警"
                                        description={
                                            todo.data
                                                ? `低库存 ${todo.data.autoCardTodoSummary.lowStockSkuCount} · 待补发 ${todo.data.autoCardTodoSummary.waitingStockDeliveryCount} · 异常 ${todo.data.autoCardTodoSummary.manualReviewCount}`
                                                : '库存、补发与异常'
                                        }
                                        count={todo.data ? autoCardCount : undefined}
                                        loading={todo.loading && !todo.data}
                                        icon={KeyRound}
                                        onClick={() => navigate('/catalog/card-pool')}
                                    />
                                )}
                                {widgetId === 'REVIEWS' && (
                                    <TodoCard
                                        label="待审核评价"
                                        description="等待发布或驳回"
                                        count={todo.data?.pendingReviews.totalItems}
                                        loading={todo.loading && !todo.data}
                                        icon={MessageSquareText}
                                        onClick={() => navigate('/sales/reviews')}
                                    />
                                )}

                                {widgetId === 'RECENT_ORDERS' && (
                                    <section
                                        className="h-full overflow-hidden rounded-xl border border-slate-200 bg-white"
                                        aria-labelledby="recent-orders-title"
                                    >
                                        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                                            <div>
                                                <h2
                                                    id="recent-orders-title"
                                                    className="text-sm font-bold text-slate-900"
                                                >
                                                    最近订单
                                                </h2>
                                                <p className="mt-0.5 text-[11px] text-slate-500">
                                                    最新下单记录，共{' '}
                                                    {recentOrders.data?.orders.totalItems ?? 0} 笔
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => navigate('/sales/orders')}
                                                className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-800"
                                            >
                                                查看全部 <ArrowRight className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                        {recentOrders.error && !recentOrders.data ? (
                                            <div className="p-5">
                                                <ErrorPanel
                                                    message="最近订单加载失败"
                                                    detail={recentOrders.error.message}
                                                    onRetry={() => void recentOrders.refetch()}
                                                />
                                            </div>
                                        ) : recentOrders.loading && !recentOrders.data ? (
                                            <div className="space-y-3 p-5" aria-busy="true">
                                                {[0, 1, 2, 3].map(item => (
                                                    <div
                                                        key={item}
                                                        className="h-12 animate-pulse rounded-lg bg-slate-100"
                                                    />
                                                ))}
                                            </div>
                                        ) : (recentOrders.data?.orders.items.length ?? 0) === 0 ? (
                                            <div className="flex min-h-56 flex-col items-center justify-center px-5 text-center">
                                                <ShoppingBag className="h-8 w-8 text-slate-300" />
                                                <p className="mt-3 text-sm font-bold text-slate-700">
                                                    暂无已下单订单
                                                </p>
                                                <p className="mt-1 text-xs text-slate-400">
                                                    买家完成下单后会显示在这里
                                                </p>
                                            </div>
                                        ) : (
                                            <div className="overflow-x-auto">
                                                <table className="w-full min-w-[720px] text-left text-xs">
                                                    <thead className="bg-slate-50 text-[11px] text-slate-500">
                                                        <tr>
                                                            <th className="px-5 py-3 font-medium">订单号</th>
                                                            <th className="px-4 py-3 font-medium">买家</th>
                                                            <th className="px-4 py-3 font-medium">商品</th>
                                                            <th className="px-4 py-3 font-medium">金额</th>
                                                            <th className="px-4 py-3 font-medium">状态</th>
                                                            <th className="px-4 py-3 font-medium">
                                                                下单时间
                                                            </th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-100">
                                                        {recentOrders.data?.orders.items.map(order => (
                                                            <tr
                                                                key={order.id}
                                                                className="hover:bg-blue-50/40"
                                                            >
                                                                <td className="px-5 py-3.5">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() =>
                                                                            navigate(
                                                                                `/sales/orders/${order.id}`,
                                                                            )
                                                                        }
                                                                        className="font-mono font-bold text-blue-700 hover:underline"
                                                                    >
                                                                        {order.code}
                                                                    </button>
                                                                </td>
                                                                <td className="max-w-44 truncate px-4 py-3.5 text-slate-700">
                                                                    {getCustomerName(order.customer)}
                                                                </td>
                                                                <td className="px-4 py-3.5 text-slate-600">
                                                                    {order.totalQuantity} 件
                                                                </td>
                                                                <td className="px-4 py-3.5 font-mono font-bold text-slate-900">
                                                                    {formatMoney(
                                                                        order.totalWithTax,
                                                                        order.currencyCode,
                                                                    )}
                                                                </td>
                                                                <td className="px-4 py-3.5">
                                                                    <span
                                                                        className={`rounded-md border px-2 py-1 text-[11px] font-bold ${getOrderStateClass(order.state)}`}
                                                                    >
                                                                        {getOrderStateLabel(order.state)}
                                                                    </span>
                                                                </td>
                                                                <td className="whitespace-nowrap px-4 py-3.5 text-slate-500">
                                                                    {formatDateTime(
                                                                        order.orderPlacedAt ??
                                                                            order.createdAt,
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </section>
                                )}

                                {widgetId === 'QUICK_ACTIONS' && (
                                    <section
                                        className="h-full rounded-xl border border-slate-200 bg-white p-5"
                                        aria-labelledby="quick-actions-title"
                                    >
                                        <h2
                                            id="quick-actions-title"
                                            className="text-sm font-bold text-slate-900"
                                        >
                                            快捷操作
                                        </h2>
                                        <p className="mt-1 text-[11px] text-slate-500">
                                            常用经营入口集中在这里
                                        </p>
                                        <div className="mt-4 space-y-2">
                                            <QuickAction
                                                icon={Plus}
                                                label="发布新商品"
                                                description="创建 SPU 与 SKU"
                                                onClick={() => navigate('/catalog/products/new')}
                                            />
                                            <QuickAction
                                                icon={Sparkles}
                                                label="AI 商品生图"
                                                description="进入生图任务台"
                                                onClick={() => navigate('/plugins/ai-settings')}
                                            />
                                            <QuickAction
                                                icon={LayoutTemplate}
                                                label="装修商城首页"
                                                description="调整轮播与楼层"
                                                onClick={() => navigate('/storefront/decoration')}
                                            />
                                            <QuickAction
                                                icon={Settings2}
                                                label="店铺综合设置"
                                                description="支付、配送与域名"
                                                onClick={() => navigate('/settings/store-profile')}
                                            />
                                        </div>
                                    </section>
                                )}

                                {widgetId === 'SEARCH_INDEX' && (
                                    <section
                                        className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-5"
                                        aria-labelledby="search-index-title"
                                    >
                                        <span
                                            className={`rounded-xl p-3 ${(metrics.data?.pendingSearchIndexUpdates ?? 0) > 0 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}
                                        >
                                            <Clock3 className="h-5 w-5" />
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <h2
                                                id="search-index-title"
                                                className="text-sm font-bold text-slate-900"
                                            >
                                                商品索引状态
                                            </h2>
                                            <p className="mt-1 text-[11px] text-slate-500">
                                                {(metrics.data?.pendingSearchIndexUpdates ?? 0) > 0
                                                    ? `${metrics.data?.pendingSearchIndexUpdates} 项变更正在等待后台任务同步`
                                                    : '商品搜索索引已经同步完成'}
                                            </p>
                                        </div>
                                        <strong className="font-mono text-xl text-slate-900">
                                            {metrics.loading && !metrics.data
                                                ? '—'
                                                : (metrics.data?.pendingSearchIndexUpdates ?? 0)}
                                        </strong>
                                    </section>
                                )}
                            </div>
                        );
                    })}

                    {visibleWidgets.length === 0 && (
                        <div className="sm:col-span-2 xl:col-span-12 rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center">
                            <LayoutGrid className="mx-auto h-9 w-9 text-slate-300" />
                            <p className="mt-3 text-sm font-bold text-slate-700">工作台暂时没有显示组件</p>
                            <button
                                type="button"
                                onClick={() => setIsCustomizing(true)}
                                className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white"
                            >
                                添加组件
                            </button>
                        </div>
                    )}
                </div>
            </main>

            {isCustomizing && (
                <div
                    className="fixed inset-0 z-50 bg-slate-900/40"
                    onMouseDown={event => {
                        if (event.target === event.currentTarget) setIsCustomizing(false);
                    }}
                >
                    <aside
                        ref={customizerDialogRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={customizerTitleId}
                        tabIndex={-1}
                        className="ml-auto flex h-full w-full max-w-md flex-col bg-white shadow-2xl outline-none"
                    >
                        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                            <div>
                                <h2 id={customizerTitleId} className="text-base font-bold text-slate-900">
                                    调整工作台
                                </h2>
                                <p className="mt-1 text-[11px] text-slate-500">
                                    选择预设、显示组件；回到工作台可拖动排序
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsCustomizing(false)}
                                className="rounded p-1.5 text-slate-400 hover:bg-slate-100"
                                aria-label="关闭工作台设置"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="flex-1 space-y-6 overflow-y-auto p-5">
                            <section>
                                <h3 className="text-xs font-bold text-slate-800">角色预设</h3>
                                <div className="mt-3 grid gap-2">
                                    {(
                                        Object.entries(DASHBOARD_PRESETS) as Array<
                                            [DashboardPresetId, (typeof DASHBOARD_PRESETS)[DashboardPresetId]]
                                        >
                                    ).map(([presetId, preset]) => (
                                        <button
                                            key={presetId}
                                            type="button"
                                            onClick={() => applyPreset(presetId)}
                                            className="rounded-xl border border-slate-200 p-3 text-left hover:border-blue-300 hover:bg-blue-50"
                                        >
                                            <span className="block text-xs font-bold text-slate-800">
                                                {preset.label}
                                            </span>
                                            <span className="mt-1 block text-[11px] text-slate-500">
                                                {preset.description}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </section>
                            <section>
                                <div className="flex items-center justify-between">
                                    <h3 className="text-xs font-bold text-slate-800">8 个工作台组件</h3>
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setWidgetPreferences({ order: ALL_WIDGETS, hidden: [] })
                                        }
                                        className="text-[11px] font-bold text-blue-600"
                                    >
                                        恢复默认
                                    </button>
                                </div>
                                <div className="mt-3 space-y-2">
                                    {widgetPreferences.order.map(widgetId => {
                                        const visible = !widgetPreferences.hidden.includes(widgetId);
                                        return (
                                            <button
                                                key={widgetId}
                                                type="button"
                                                onClick={() => toggleWidget(widgetId)}
                                                className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5 text-left hover:bg-slate-50"
                                            >
                                                <span className="text-xs font-medium text-slate-700">
                                                    {WIDGET_LABELS[widgetId]}
                                                </span>
                                                <span
                                                    className={`flex items-center gap-1 text-[11px] font-bold ${visible ? 'text-emerald-700' : 'text-slate-400'}`}
                                                >
                                                    {visible ? (
                                                        <Eye className="h-3.5 w-3.5" />
                                                    ) : (
                                                        <EyeOff className="h-3.5 w-3.5" />
                                                    )}
                                                    {visible ? '显示' : '隐藏'}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </section>
                        </div>
                        <div className="border-t border-slate-200 p-4">
                            <button
                                type="button"
                                onClick={() => setIsCustomizing(false)}
                                className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-bold text-white"
                            >
                                完成调整
                            </button>
                        </div>
                    </aside>
                </div>
            )}
        </div>
    );
}

function MetricCard({
    label,
    value,
    detail,
    comparison,
    icon: Icon,
    tone,
}: {
    label: string;
    value: string;
    detail: string;
    comparison?: MetricComparison;
    icon: LucideIcon;
    tone: 'emerald' | 'blue' | 'violet';
}) {
    const tones = {
        emerald: 'bg-emerald-50 text-emerald-700',
        blue: 'bg-blue-50 text-blue-700',
        violet: 'bg-violet-50 text-violet-700',
    };
    const comparisonTones = {
        positive: 'text-emerald-700',
        negative: 'text-rose-600',
        neutral: 'text-slate-500',
    };
    return (
        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="flex items-start justify-between">
                <div>
                    <p className="text-xs font-medium text-slate-500">{label}</p>
                    <p className="mt-2 font-mono text-2xl font-bold tracking-tight text-slate-900">{value}</p>
                </div>
                <span className={`rounded-lg p-2 ${tones[tone]}`}>
                    <Icon className="h-4 w-4" />
                </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-1 text-[11px]">
                <span className="text-slate-400">{detail}</span>
                {comparison && (
                    <span className={`font-bold ${comparisonTones[comparison.tone]}`}>
                        {comparison.label} <span className="font-normal text-slate-400">较上一周期</span>
                    </span>
                )}
            </div>
        </article>
    );
}

function TodoCard({
    label,
    description,
    count,
    loading,
    icon: Icon,
    onClick,
}: {
    label: string;
    description: string;
    count?: number;
    loading: boolean;
    icon: LucideIcon;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="group flex h-full min-h-28 w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 text-left shadow-xs transition-colors hover:border-blue-200 hover:bg-blue-50/50"
        >
            <span className="rounded-lg bg-slate-100 p-2 text-slate-600 group-hover:bg-blue-100 group-hover:text-blue-700">
                <Icon className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block text-xs font-bold text-slate-800">{label}</span>
                <span className="mt-1 block truncate text-[11px] text-slate-400" title={description}>
                    {description}
                </span>
            </span>
            <span className="font-mono text-2xl font-bold text-slate-900">
                {loading ? '—' : (count ?? 0)}
            </span>
        </button>
    );
}

function QuickAction({
    icon: Icon,
    label,
    description,
    onClick,
}: {
    icon: LucideIcon;
    label: string;
    description: string;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="group flex w-full items-center gap-3 rounded-lg border border-slate-100 p-3 text-left hover:border-blue-200 hover:bg-blue-50/50"
        >
            <span className="rounded-md bg-slate-100 p-2 text-slate-600 group-hover:bg-blue-100 group-hover:text-blue-700">
                <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block text-xs font-bold text-slate-800">{label}</span>
                <span className="mt-0.5 block text-[11px] text-slate-400">{description}</span>
            </span>
            <ArrowRight className="h-4 w-4 text-slate-300 group-hover:text-blue-600" />
        </button>
    );
}

function ErrorPanel({ message, detail, onRetry }: { message: string; detail: string; onRetry: () => void }) {
    return (
        <div className="flex min-h-28 flex-col items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-5 py-4 text-center sm:flex-row sm:justify-between sm:text-left">
            <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                <div>
                    <p className="text-xs font-bold text-rose-800">{message}</p>
                    <p className="mt-1 max-w-2xl text-[11px] text-rose-600">{toUserFacingError(detail)}</p>
                </div>
            </div>
            <button
                type="button"
                onClick={onRetry}
                className="mt-3 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100 sm:mt-0"
            >
                重试
            </button>
        </div>
    );
}
