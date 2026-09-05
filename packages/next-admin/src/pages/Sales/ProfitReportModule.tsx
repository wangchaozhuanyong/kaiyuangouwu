import { useQuery } from '@apollo/client/react';
import {
    AlertCircle,
    AlertTriangle,
    ArrowRight,
    ChevronLeft,
    ChevronRight,
    CircleDollarSign,
    FileSpreadsheet,
    PackageSearch,
    RefreshCw,
    Truck,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { FeatureHelpButton } from '../../components/FeatureHelp';

import {
    CATALOG_PROFIT_REPORT_QUERY,
    type CatalogProfitReportResult,
    type CatalogProfitReportSummary,
} from '../../graphql/catalog-operations.graphql';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { toUserFacingError } from '../../utils/user-facing-error';
import { OrderExpenseImportDialog } from './OrderExpenseImportDialog';
import { formatDateTime } from './sales-utils';

const PAGE_SIZE = 50;

export function ProfitReportModule() {
    const navigate = useNavigate();
    const { hasAnyPermission } = useAdminPermissions();
    const canImportExpenses =
        hasAnyPermission(['UpdateOrder']) && hasAnyPermission(['UpdateCatalogOperations']);
    const initialRange = useMemo(() => defaultDateRange(), []);
    const [fromDate, setFromDate] = useState(initialRange.from);
    const [toDate, setToDate] = useState(initialRange.to);
    const [page, setPage] = useState(0);
    const [importOpen, setImportOpen] = useState(false);
    const range = toIsoRange(fromDate, toDate);
    const query = useQuery<CatalogProfitReportResult>(CATALOG_PROFIT_REPORT_QUERY, {
        variables: {
            input: {
                from: range?.from,
                to: range?.to,
                skip: page * PAGE_SIZE,
                take: PAGE_SIZE,
            },
        },
        skip: range == null,
        fetchPolicy: 'cache-and-network',
        notifyOnNetworkStatusChange: true,
    });
    const report = query.data?.catalogProfitReport;
    const summary = report?.summary;
    const totalPages = Math.max(1, Math.ceil((report?.totalItems ?? 0) / PAGE_SIZE));
    const hasMissingCost = (summary?.missingCostLineCount ?? 0) > 0;
    const hasMissingExpenses =
        (summary?.missingCarrierShippingCostOrderCount ?? 0) > 0 ||
        (summary?.missingPaymentFeeOrderCount ?? 0) > 0;

    return (
        <div className="min-h-full bg-slate-50">
            <header className="border-b border-slate-200 bg-white px-5 py-5 shadow-xs sm:px-8">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <div className="flex items-center gap-2">
                            <CircleDollarSign className="h-5 w-5 text-emerald-600" />
                            <h1 className="text-xl font-bold text-slate-900">
                                利润统计
                                <FeatureHelpButton topic="sales.profit" title="利润统计" />
                            </h1>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                            按下单日期、当前店铺、已结算支付和商品历史成本核算；已结算退款会从收入中扣除。
                        </p>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                        <DateField
                            label="开始日期"
                            value={fromDate}
                            onChange={value => {
                                setFromDate(value);
                                setPage(0);
                            }}
                        />
                        <DateField
                            label="结束日期"
                            value={toDate}
                            onChange={value => {
                                setToDate(value);
                                setPage(0);
                            }}
                        />
                        <button
                            type="button"
                            onClick={() => void query.refetch()}
                            disabled={!range || query.loading}
                            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                        >
                            <RefreshCw className={`h-3.5 w-3.5 ${query.loading ? 'animate-spin' : ''}`} />
                            刷新
                        </button>
                        {canImportExpenses && summary && (
                            <button
                                type="button"
                                onClick={() => setImportOpen(true)}
                                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white transition hover:bg-emerald-700"
                            >
                                <FileSpreadsheet className="h-3.5 w-3.5" /> 导入实际费用
                            </button>
                        )}
                    </div>
                </div>
            </header>

            <main className="space-y-5 p-4 sm:p-6 lg:p-8">
                {!range && (
                    <Message tone="error" icon={<AlertCircle className="h-4 w-4" />}>
                        开始日期不能晚于结束日期，单次最多查询 366 天。
                    </Message>
                )}
                {query.error && (
                    <Message tone="error" icon={<AlertCircle className="h-4 w-4" />}>
                        {toUserFacingError(query.error, '利润报表加载失败')}
                    </Message>
                )}
                {summary && hasMissingCost && (
                    <Message tone="warning" icon={<AlertTriangle className="h-4 w-4" />}>
                        {summary.missingCostOrderCount} 笔订单、{summary.missingCostLineCount}{' '}
                        条商品行缺少成本。为避免假利润，成本、毛利润和毛利率不会显示合计值。
                        <button
                            type="button"
                            onClick={() => navigate('/catalog/list')}
                            className="ml-2 inline-flex items-center gap-1 font-bold underline underline-offset-2"
                        >
                            去补商品成本 <ArrowRight className="h-3 w-3" />
                        </button>
                    </Message>
                )}
                {summary && summary.estimatedCostLineCount > 0 && (
                    <Message tone="warning" icon={<AlertTriangle className="h-4 w-4" />}>
                        {summary.estimatedCostOrderCount} 笔历史订单没有当时成本记录，已用当前成本估算，共{' '}
                        {summary.estimatedCostLineCount} 条商品行；报表会明确保留该标记。
                    </Message>
                )}
                {summary && hasMissingExpenses && (
                    <Message tone="warning" icon={<AlertTriangle className="h-4 w-4" />}>
                        {summary.missingCarrierShippingCostOrderCount} 笔订单缺实际物流成本，
                        {summary.missingPaymentFeeOrderCount}{' '}
                        笔订单缺支付手续费。缺任一费用的订单不计算净利润；没有费用也要明确填 0。
                        {canImportExpenses && (
                            <button
                                type="button"
                                onClick={() => setImportOpen(true)}
                                className="ml-2 inline-flex items-center gap-1 font-bold underline underline-offset-2"
                            >
                                批量补费用 <ArrowRight className="h-3 w-3" />
                            </button>
                        )}
                    </Message>
                )}

                <SummaryCards summary={summary} loading={query.loading && !summary} />

                <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">
                    <div className="flex items-start gap-2">
                        <Truck className="mt-0.5 h-4 w-4 shrink-0" />
                        <div>
                            <strong>利润口径：</strong>净实收 = 已结算支付 − 已结算退款；可核算毛利润 = 净实收
                            − 商品成本；净利润 = 可核算毛利润 − 承运商实际物流成本 −
                            支付手续费。订单上的买家物流费已包含在支付金额中，这里只单独列出，不会再加一次；退款暂时无法拆分到商品或物流费。
                            <span className="block font-bold">
                                商品成本或任一实际费用未核算时，系统不会显示该订单及报表合计的净利润。
                            </span>
                        </div>
                    </div>
                </section>

                <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
                    <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                        <div>
                            <h2 className="text-sm font-bold text-slate-900">
                                订单利润明细
                                <FeatureHelpButton topic="sales.profit" title="订单利润明细" />
                            </h2>
                            <p className="mt-1 text-[11px] text-slate-500">
                                共 {report?.totalItems ?? 0} 笔已结算订单
                            </p>
                        </div>
                    </div>
                    {query.loading && !report ? (
                        <div className="space-y-3 p-6">
                            {[1, 2, 3, 4].map(item => (
                                <div key={item} className="h-11 animate-pulse rounded-lg bg-slate-100" />
                            ))}
                        </div>
                    ) : report && report.items.length > 0 ? (
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[1680px] border-collapse text-left text-xs">
                                <thead className="bg-slate-50 text-slate-500">
                                    <tr className="border-b border-slate-200">
                                        <Header>订单</Header>
                                        <Header>下单时间</Header>
                                        <Header>商品数量</Header>
                                        <Header>已结算</Header>
                                        <Header>已退款</Header>
                                        <Header>净实收</Header>
                                        <Header>买家支付物流费</Header>
                                        <Header>商品成本</Header>
                                        <Header>可核算毛利润</Header>
                                        <Header>毛利率</Header>
                                        <Header>实际物流成本</Header>
                                        <Header>支付手续费</Header>
                                        <Header>净利润</Header>
                                        <Header>净利率</Header>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 text-slate-700">
                                    {report.items.map(item => (
                                        <tr key={item.id} className="hover:bg-slate-50/70">
                                            <Cell>
                                                <button
                                                    type="button"
                                                    onClick={() => navigate(`/sales/orders/${item.id}`)}
                                                    className="font-bold text-blue-700 hover:underline"
                                                >
                                                    {item.code}
                                                </button>
                                            </Cell>
                                            <Cell>{formatDateTime(item.orderPlacedAt)}</Cell>
                                            <Cell>{item.quantity}</Cell>
                                            <MoneyCell
                                                value={item.settledRevenueMicrounits}
                                                currency={item.currencyCode}
                                            />
                                            <MoneyCell
                                                value={item.refundedRevenueMicrounits}
                                                currency={item.currencyCode}
                                            />
                                            <MoneyCell
                                                value={item.netRevenueMicrounits}
                                                currency={item.currencyCode}
                                                strong
                                            />
                                            <MoneyCell
                                                value={item.shippingRevenueMicrounits}
                                                currency={item.currencyCode}
                                            />
                                            <Cell>
                                                {item.productCostMicrounits == null ? (
                                                    <span className="font-bold text-rose-600">
                                                        缺 {item.missingCostLineCount} 条成本
                                                    </span>
                                                ) : (
                                                    <span className="font-mono font-bold">
                                                        {formatMicrounits(
                                                            item.productCostMicrounits,
                                                            item.currencyCode,
                                                        )}
                                                        {item.estimatedCostLineCount > 0 && (
                                                            <span className="ml-1 text-[10px] text-amber-700">
                                                                含估算
                                                            </span>
                                                        )}
                                                    </span>
                                                )}
                                            </Cell>
                                            <MoneyCell
                                                value={item.grossProfitMicrounits}
                                                currency={item.currencyCode}
                                                strong
                                            />
                                            <Cell>
                                                {item.grossMargin == null
                                                    ? '—'
                                                    : `${(item.grossMargin * 100).toFixed(1)}%`}
                                            </Cell>
                                            <ExpenseCell
                                                value={item.carrierShippingCostMicrounits}
                                                currency={item.currencyCode}
                                                label="物流成本"
                                                onEdit={() => navigate(`/sales/orders/${item.id}`)}
                                            />
                                            <ExpenseCell
                                                value={item.paymentFeeMicrounits}
                                                currency={item.currencyCode}
                                                label="手续费"
                                                onEdit={() => navigate(`/sales/orders/${item.id}`)}
                                            />
                                            <MoneyCell
                                                value={item.netProfitMicrounits}
                                                currency={item.currencyCode}
                                                strong
                                            />
                                            <Cell>
                                                {item.netMargin == null
                                                    ? '—'
                                                    : `${(item.netMargin * 100).toFixed(1)}%`}
                                            </Cell>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center gap-2 p-14 text-center">
                            <PackageSearch className="h-8 w-8 text-slate-300" />
                            <div className="text-sm font-bold text-slate-700">所选日期没有已结算订单</div>
                            <p className="text-xs text-slate-400">可调整日期范围或确认当前选择的店铺。</p>
                        </div>
                    )}
                    {(report?.totalItems ?? 0) > 0 && (
                        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs text-slate-500">
                            <span>
                                第 {page + 1} / {totalPages} 页
                            </span>
                            <div className="flex gap-2">
                                <PageButton
                                    disabled={page === 0}
                                    onClick={() => setPage(current => Math.max(0, current - 1))}
                                >
                                    <ChevronLeft className="h-3.5 w-3.5" /> 上一页
                                </PageButton>
                                <PageButton
                                    disabled={page + 1 >= totalPages}
                                    onClick={() => setPage(current => current + 1)}
                                >
                                    下一页 <ChevronRight className="h-3.5 w-3.5" />
                                </PageButton>
                            </div>
                        </div>
                    )}
                </section>
            </main>
            {importOpen && summary && (
                <OrderExpenseImportDialog
                    currencyCode={summary.currencyCode}
                    onClose={() => setImportOpen(false)}
                    onImported={() => query.refetch()}
                />
            )}
        </div>
    );
}

function SummaryCards({ summary, loading }: { summary?: CatalogProfitReportSummary; loading: boolean }) {
    const currency = summary?.currencyCode ?? 'CNY';
    const cards = [
        ['净实收', summary ? formatMicrounits(summary.netRevenueMicrounits, currency) : '—', 'text-blue-700'],
        [
            '商品成本',
            summary?.productCostMicrounits == null
                ? summary
                    ? '待补齐成本'
                    : '—'
                : formatMicrounits(summary.productCostMicrounits, currency),
            summary?.productCostMicrounits == null && summary ? 'text-rose-600' : 'text-slate-900',
        ],
        [
            '可核算毛利润',
            summary?.grossProfitMicrounits == null
                ? summary
                    ? '待补齐成本'
                    : '—'
                : formatMicrounits(summary.grossProfitMicrounits, currency),
            summary?.grossProfitMicrounits == null
                ? summary
                    ? 'text-rose-600'
                    : 'text-slate-900'
                : summary.grossProfitMicrounits < 0
                  ? 'text-rose-600'
                  : 'text-emerald-700',
        ],
        [
            '毛利率',
            summary?.grossMargin == null ? '—' : `${(summary.grossMargin * 100).toFixed(1)}%`,
            summary?.grossMargin != null && summary.grossMargin < 0 ? 'text-rose-600' : 'text-emerald-700',
        ],
        [
            '买家支付物流费',
            summary ? formatMicrounits(summary.shippingRevenueMicrounits, currency) : '—',
            'text-amber-700',
        ],
        [
            '实际物流成本',
            summary?.carrierShippingCostMicrounits == null
                ? summary
                    ? '待补齐'
                    : '—'
                : formatMicrounits(summary.carrierShippingCostMicrounits, currency),
            summary?.carrierShippingCostMicrounits == null && summary ? 'text-rose-600' : 'text-slate-900',
        ],
        [
            '支付手续费',
            summary?.paymentFeeMicrounits == null
                ? summary
                    ? '待补齐'
                    : '—'
                : formatMicrounits(summary.paymentFeeMicrounits, currency),
            summary?.paymentFeeMicrounits == null && summary ? 'text-rose-600' : 'text-slate-900',
        ],
        [
            '净利润',
            summary?.netProfitMicrounits == null
                ? summary
                    ? '待补齐数据'
                    : '—'
                : formatMicrounits(summary.netProfitMicrounits, currency),
            summary?.netProfitMicrounits == null
                ? summary
                    ? 'text-rose-600'
                    : 'text-slate-900'
                : summary.netProfitMicrounits < 0
                  ? 'text-rose-600'
                  : 'text-emerald-700',
        ],
        [
            '净利率',
            summary?.netMargin == null ? '—' : `${(summary.netMargin * 100).toFixed(1)}%`,
            summary?.netMargin != null && summary.netMargin < 0 ? 'text-rose-600' : 'text-emerald-700',
        ],
        ['已结算订单', summary ? `${summary.orderCount} 笔 / ${summary.quantity} 件` : '—', 'text-slate-900'],
    ] as const;
    return (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
            {cards.map(([label, value, color]) => (
                <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                    <div className="text-[11px] font-bold text-slate-500">{label}</div>
                    <div className={`mt-2 min-h-7 text-lg font-bold ${color}`}>
                        {loading ? (
                            <span className="inline-block h-6 w-24 animate-pulse rounded bg-slate-100" />
                        ) : (
                            value
                        )}
                    </div>
                </div>
            ))}
        </section>
    );
}

function DateField({
    label,
    value,
    onChange,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <label className="space-y-1 text-[11px] font-bold text-slate-600">
            <span>{label}</span>
            <input
                type="date"
                value={value}
                onChange={event => onChange(event.target.value)}
                className="block h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
        </label>
    );
}

function Message({
    tone,
    icon,
    children,
}: {
    tone: 'error' | 'warning';
    icon: ReactNode;
    children: ReactNode;
}) {
    return (
        <div
            className={`flex items-start gap-2 rounded-xl border p-4 text-xs leading-5 ${tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}
        >
            <span className="mt-0.5 shrink-0">{icon}</span>
            <div>{children}</div>
        </div>
    );
}

function Header({ children }: { children: ReactNode }) {
    return <th className="whitespace-nowrap px-4 py-3 font-bold">{children}</th>;
}

function Cell({ children }: { children: ReactNode }) {
    return <td className="whitespace-nowrap px-4 py-3">{children}</td>;
}

function MoneyCell({
    value,
    currency,
    strong = false,
}: {
    value?: number | null;
    currency: string;
    strong?: boolean;
}) {
    return (
        <Cell>
            <span className={`font-mono ${strong ? 'font-bold text-slate-900' : ''}`}>
                {value == null ? '—' : formatMicrounits(value, currency)}
            </span>
        </Cell>
    );
}

function ExpenseCell({
    value,
    currency,
    label,
    onEdit,
}: {
    value?: number | null;
    currency: string;
    label: string;
    onEdit: () => void;
}) {
    if (value != null) return <MoneyCell value={value} currency={currency} />;
    return (
        <Cell>
            <button
                type="button"
                onClick={onEdit}
                className="font-bold text-rose-600 underline decoration-dotted underline-offset-2"
            >
                待补{label}
            </button>
        </Cell>
    );
}

function PageButton({
    disabled,
    onClick,
    children,
}: {
    disabled: boolean;
    onClick: () => void;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-bold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
            {children}
        </button>
    );
}

function defaultDateRange() {
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - 29);
    return { from: dateInputValue(from), to: dateInputValue(to) };
}

function dateInputValue(value: Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function toIsoRange(from: string, to: string) {
    if (!from || !to || from > to) return null;
    const start = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T23:59:59.999`);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
    if (end.getTime() - start.getTime() > 366 * 24 * 60 * 60 * 1_000) return null;
    return { from: start.toISOString(), to: end.toISOString() };
}

function formatMicrounits(value: number, currency: string) {
    try {
        return new Intl.NumberFormat('zh-CN', {
            style: 'currency',
            currency,
            minimumFractionDigits: 2,
            maximumFractionDigits: 3,
        }).format(value / 1_000);
    } catch {
        return `${currency} ${(value / 1_000).toFixed(3)}`;
    }
}
