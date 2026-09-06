import { Download } from 'lucide-react';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import {
    CouponDailyMetricRecord,
    CouponLedgerRecord,
    StoreCouponRecord,
} from '../../graphql/marketing.graphql';
import { formatDateTime, formatMoney } from '../Sales/sales-utils';
import { defaultReportFilter, ledgerLabels, validReportFilter } from './promotion-model';
import { DateInput, ErrorState, LoadingState, Message, SimplePagination, SmallMetric } from './promotion-ui';

export function CouponReport({
    coupons,
    currencyCode,
    filter,
    setFilter,
    metrics,
    loading,
    error,
}: {
    coupons: StoreCouponRecord[];
    currencyCode: string;
    filter: ReturnType<typeof defaultReportFilter>;
    setFilter: (value: ReturnType<typeof defaultReportFilter>) => void;
    metrics: CouponDailyMetricRecord[];
    loading: boolean;
    error?: string;
}) {
    const totals = metrics.reduce(
        (value, item) => ({
            claimed: value.claimed + item.claimedCount,
            redeemed: value.redeemed + item.redeemedCount,
            refunded: value.refunded + item.refundedCount,
            discount: value.discount + item.discountAmountTotal,
            revenue: value.revenue + item.assistedRevenueTotal,
        }),
        { claimed: 0, redeemed: 0, refunded: 0, discount: 0, revenue: 0 },
    );
    const validationError = validReportFilter(filter) ? '' : '请选择不超过366天的有效日期区间';
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
            <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                        优惠券经营报表
                        <FeatureHelpButton topic="marketing.coupon-report" title="优惠券经营报表" />
                    </h2>
                    <p className="mt-1 text-[11px] text-slate-500">
                        统计领取、核销、退款、优惠成本和带动成交
                    </p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                    <DateInput
                        label="开始日期"
                        value={filter.from}
                        onChange={value => setFilter({ ...filter, from: value })}
                        type="date"
                    />
                    <DateInput
                        label="结束日期"
                        value={filter.to}
                        onChange={value => setFilter({ ...filter, to: value })}
                        type="date"
                    />
                    <label className="text-[10px] font-bold text-slate-500">
                        优惠券
                        <select
                            value={filter.campaignId}
                            onChange={event => setFilter({ ...filter, campaignId: event.target.value })}
                            className="mt-1 block rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-normal text-slate-900"
                        >
                            <option value="ALL">全部活动</option>
                            {coupons.map(coupon => (
                                <option key={coupon.id} value={coupon.id}>
                                    {coupon.name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <button
                        type="button"
                        onClick={() => exportReport(metrics, currencyCode)}
                        disabled={!metrics.length}
                        className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-40"
                    >
                        <Download className="h-3.5 w-3.5" />
                        导出 CSV
                    </button>
                </div>
            </div>
            {validationError ? (
                <Message kind="error" onClose={() => undefined}>
                    {validationError}
                </Message>
            ) : loading ? (
                <LoadingState label="正在计算经营报表…" />
            ) : error ? (
                <ErrorState message={error} onRetry={() => undefined} />
            ) : (
                <>
                    <div className="my-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
                        <SmallMetric label="领取" value={`${totals.claimed} 张`} />
                        <SmallMetric label="核销" value={`${totals.redeemed} 张`} />
                        <SmallMetric label="退款涉及" value={`${totals.refunded} 张`} />
                        <SmallMetric label="优惠成本" value={formatMoney(totals.discount, currencyCode)} />
                        <SmallMetric label="带动成交" value={formatMoney(totals.revenue, currencyCode)} />
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[980px] border-collapse text-left text-xs">
                            <thead className="border-y border-slate-200 bg-slate-50 text-slate-500">
                                <tr>
                                    <th scope="col" className="whitespace-nowrap px-3 py-3">
                                        日期
                                    </th>
                                    <th scope="col" className="whitespace-nowrap px-3 py-3">
                                        领取
                                    </th>
                                    <th scope="col" className="whitespace-nowrap px-3 py-3">
                                        核销
                                    </th>
                                    <th scope="col" className="whitespace-nowrap px-3 py-3">
                                        退款
                                    </th>
                                    <th scope="col" className="whitespace-nowrap px-3 py-3">
                                        返还
                                    </th>
                                    <th scope="col" className="whitespace-nowrap px-3 py-3">
                                        过期
                                    </th>
                                    <th scope="col" className="whitespace-nowrap px-3 py-3">
                                        作废
                                    </th>
                                    <th scope="col" className="whitespace-nowrap px-3 py-3">
                                        优惠金额
                                    </th>
                                    <th scope="col" className="whitespace-nowrap px-3 py-3">
                                        带动成交
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {metrics.map(item => (
                                    <tr key={item.date} className="h-[52px] hover:bg-slate-50/80">
                                        <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono">
                                            {item.date}
                                        </td>
                                        <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono">
                                            {item.claimedCount}
                                        </td>
                                        <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono">
                                            {item.redeemedCount}
                                        </td>
                                        <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono">
                                            {item.refundedCount}
                                        </td>
                                        <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono">
                                            {item.returnedCount}
                                        </td>
                                        <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono">
                                            {item.expiredCount}
                                        </td>
                                        <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono">
                                            {item.revokedCount}
                                        </td>
                                        <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono">
                                            {formatMoney(item.discountAmountTotal, currencyCode)}
                                        </td>
                                        <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono font-bold text-emerald-600">
                                            {formatMoney(item.assistedRevenueTotal, currencyCode)}
                                        </td>
                                    </tr>
                                ))}
                                {!metrics.length && (
                                    <tr>
                                        <td colSpan={9} className="p-10 text-center text-slate-400">
                                            所选日期内暂无优惠券数据
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </section>
    );
}

export function CouponLedger({
    pageSize,
    onPageSizeChange,
    coupons,
    currencyCode,
    page,
    setPage,
    campaign,
    setCampaign,
    event,
    setEvent,
    data,
    loading,
    error,
    onRetry,
}: {
    pageSize: number;
    onPageSizeChange: (size: number) => void;
    coupons: StoreCouponRecord[];
    currencyCode: string;
    page: number;
    setPage: (value: number) => void;
    campaign: string;
    setCampaign: (value: string) => void;
    event: string;
    setEvent: (value: string) => void;
    data?: { items: CouponLedgerRecord[]; totalItems: number };
    loading: boolean;
    error?: string;
    onRetry: () => void;
}) {
    const totalPages = Math.max(1, Math.ceil((data?.totalItems ?? 0) / pageSize));
    return (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
            <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                        优惠券全生命周期流水
                        <FeatureHelpButton topic="marketing.coupon-ledger" title="优惠券全生命周期流水" />
                    </h2>
                    <p className="mt-1 text-[11px] text-slate-500">
                        每次领取、锁定、核销、退款和作废均可追溯
                    </p>
                </div>
                <div className="flex gap-2">
                    <select
                        value={campaign}
                        onChange={eventValue => setCampaign(eventValue.target.value)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                    >
                        <option value="ALL">全部活动</option>
                        {coupons.map(coupon => (
                            <option key={coupon.id} value={coupon.id}>
                                {coupon.name}
                            </option>
                        ))}
                    </select>
                    <select
                        value={event}
                        onChange={eventValue => setEvent(eventValue.target.value)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                    >
                        <option value="ALL">全部事件</option>
                        {Object.entries(ledgerLabels).map(([value, label]) => (
                            <option key={value} value={value}>
                                {label}
                            </option>
                        ))}
                    </select>
                </div>
            </div>
            {loading && !data ? (
                <LoadingState label="正在读取使用流水…" />
            ) : error ? (
                <ErrorState message={error} onRetry={onRetry} />
            ) : (
                <>
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[1320px] border-collapse text-left text-xs">
                            <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                                <tr>
                                    <th scope="col" className="whitespace-nowrap px-3 py-3">
                                        时间
                                    </th>
                                    <th scope="col" className="whitespace-nowrap px-3 py-3">
                                        事件
                                    </th>
                                    <th scope="col" className="whitespace-nowrap px-3 py-3">
                                        优惠券
                                    </th>
                                    <th scope="col" className="whitespace-nowrap px-3 py-3">
                                        客户姓名
                                    </th>
                                    <th scope="col" className="whitespace-nowrap px-3 py-3">
                                        客户邮箱
                                    </th>
                                    <th scope="col" className="whitespace-nowrap px-3 py-3">
                                        订单
                                    </th>
                                    <th scope="col" className="whitespace-nowrap px-3 py-3">
                                        优惠金额
                                    </th>
                                    <th scope="col" className="whitespace-nowrap px-3 py-3">
                                        操作来源
                                    </th>
                                    <th scope="col" className="whitespace-nowrap px-3 py-3">
                                        备注
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {data?.items.map(item => (
                                    <tr key={item.id} className="h-[52px] hover:bg-slate-50/80">
                                        <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono text-[10px] text-slate-500">
                                            {formatDateTime(item.createdAt)}
                                        </td>
                                        <td className="h-[52px] whitespace-nowrap px-3 py-0">
                                            <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                                                {ledgerLabels[item.eventType] ?? item.eventType}
                                            </span>
                                        </td>
                                        <td className="h-[52px] max-w-52 px-3 py-0 font-medium text-slate-900">
                                            <span className="block truncate" title={item.campaignName}>
                                                {item.campaignName}
                                            </span>
                                        </td>
                                        <td className="h-[52px] max-w-40 px-3 py-0 font-medium">
                                            <span className="block truncate" title={item.customerName}>
                                                {item.customerName}
                                            </span>
                                        </td>
                                        <td className="h-[52px] max-w-56 px-3 py-0 text-[10px] text-slate-500">
                                            <span className="block truncate" title={item.customerEmail}>
                                                {item.customerEmail}
                                            </span>
                                        </td>
                                        <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono text-blue-600">
                                            {item.orderCode ?? '—'}
                                        </td>
                                        <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono">
                                            {item.discountAmount == null
                                                ? '—'
                                                : formatMoney(item.discountAmount, currencyCode)}
                                        </td>
                                        <td className="h-[52px] whitespace-nowrap px-3 py-0 text-slate-500">
                                            {item.actorType}
                                        </td>
                                        <td
                                            className="h-[52px] max-w-52 truncate px-3 py-0 text-slate-500"
                                            title={item.note ?? ''}
                                        >
                                            {item.note ?? '—'}
                                        </td>
                                    </tr>
                                ))}
                                {!data?.items.length && (
                                    <tr>
                                        <td colSpan={9} className="p-10 text-center text-slate-400">
                                            当前条件下没有流水
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    <SimplePagination
                        loading={loading}
                        pageSize={pageSize}
                        onPageSizeChange={onPageSizeChange}
                        page={page}
                        totalPages={totalPages}
                        totalItems={data?.totalItems ?? 0}
                        onPageChange={setPage}
                    />
                </>
            )}
        </section>
    );
}

function exportReport(metrics: CouponDailyMetricRecord[], currencyCode: string) {
    const rows = [
        [
            '日期',
            '领取',
            '核销',
            '退款',
            '返还',
            '过期',
            '作废',
            `优惠金额(${currencyCode})`,
            `带动成交(${currencyCode})`,
        ],
        ...metrics.map(item => [
            item.date,
            item.claimedCount,
            item.redeemedCount,
            item.refundedCount,
            item.returnedCount,
            item.expiredCount,
            item.revokedCount,
            item.discountAmountTotal,
            item.assistedRevenueTotal,
        ]),
    ];
    const csv = `\uFEFF${rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `coupon-report-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}
