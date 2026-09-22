import { useMutation, useQuery } from '@apollo/client/react';
import { AlertTriangle, Plus, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';

import { FeatureHelpButton } from '../../components/FeatureHelp';
import {
    MARKETING_ATTRIBUTION_REPORT_QUERY,
    MarketingAttributionReportResult,
    RECORD_MARKETING_CAMPAIGN_COST_MUTATION,
} from '../../graphql/marketing.graphql';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { toUserFacingError } from '../../utils/user-facing-error';

export function MarketingAttributionPanel({ currencyCode }: { currencyCode: string }) {
    const initial = useMemo(() => defaultRange(), []);
    const [from, setFrom] = useState(initial.from);
    const [to, setTo] = useState(initial.to);
    const [costOpen, setCostOpen] = useState(false);
    const [message, setMessage] = useState('');
    const { hasAnyPermission } = useAdminPermissions();
    const canRecordCost = hasAnyPermission(['UpdatePromotion']);
    const range = isoRange(from, to);
    const query = useQuery<MarketingAttributionReportResult>(MARKETING_ATTRIBUTION_REPORT_QUERY, {
        variables: { input: { from: range?.from, to: range?.to, currencyCode } },
        skip: !range,
        fetchPolicy: 'cache-and-network',
        notifyOnNetworkStatusChange: true,
    });
    const report = query.data?.marketingAttributionReport;
    const summary = report?.summary;

    return (
        <section className="space-y-4">
            <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                        渠道归因与投放回报
                        <FeatureHelpButton topic="marketing.attribution" title="渠道归因与投放回报" />
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                        30 天末次非直接归因；付款成功后固化订单来源，ROAS/ROI 已扣除已结算退款。
                    </p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                    <DateField label="开始日期" value={from} onChange={setFrom} />
                    <DateField label="结束日期" value={to} onChange={setTo} />
                    <button
                        type="button"
                        onClick={() => void query.refetch()}
                        disabled={!range || query.loading}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-bold text-slate-700 disabled:opacity-50"
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${query.loading ? 'animate-spin' : ''}`} />
                        刷新
                    </button>
                    {canRecordCost && (
                        <button
                            type="button"
                            onClick={() => setCostOpen(true)}
                            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white"
                        >
                            <Plus className="h-3.5 w-3.5" />
                            记录投放费用
                        </button>
                    )}
                </div>
            </div>

            {message && (
                <div className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{message}</div>
            )}
            {query.error && (
                <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">
                    {toUserFacingError(query.error, '营销归因报表读取失败')}
                </div>
            )}
            {!range && (
                <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <AlertTriangle className="h-4 w-4" />
                    请选择有效的日期范围。
                </div>
            )}

            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 xl:grid-cols-8">
                <Metric label="访客" value={summary ? String(summary.visitorCount) : '—'} />
                <Metric label="商品浏览" value={summary ? String(summary.productViewCount) : '—'} />
                <Metric label="到达结账" value={summary ? String(summary.checkoutViewCount) : '—'} />
                <Metric label="成交订单" value={summary ? String(summary.orderCount) : '—'} />
                <Metric
                    label="净收入"
                    value={summary ? money(summary.netRevenueMicrounits, currencyCode) : '—'}
                />
                <Metric
                    label="投放费用"
                    value={summary ? money(summary.campaignCostMicrounits, currencyCode) : '—'}
                />
                <Metric label="退款后 ROAS" value={ratio(summary?.refundAdjustedRoas)} />
                <Metric label="退款后 ROI" value={percent(summary?.refundAdjustedRoi)} />
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-xs">
                        <thead className="bg-slate-50 text-slate-500">
                            <tr>
                                {[
                                    '来源 / 媒介',
                                    '活动',
                                    '搜索词',
                                    '访客',
                                    '商品 / 结账',
                                    '订单',
                                    '转化率',
                                    '净收入',
                                    '费用',
                                    'ROAS',
                                    'ROI',
                                ].map(label => (
                                    <th key={label} className="whitespace-nowrap px-3 py-2 font-bold">
                                        {label}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {(report?.items ?? []).map(item => (
                                <tr key={`${item.source}:${item.medium}:${item.campaign}`}>
                                    <td className="px-3 py-2 font-semibold text-slate-800">
                                        {item.source} / {item.medium}
                                    </td>
                                    <td className="px-3 py-2 text-slate-700">{item.campaign}</td>
                                    <td className="max-w-56 px-3 py-2 text-slate-600">
                                        {item.searchTerms.length ? item.searchTerms.join('、') : '—'}
                                    </td>
                                    <td className="px-3 py-2 tabular-nums">{item.visitorCount}</td>
                                    <td className="px-3 py-2 tabular-nums">
                                        {item.productViewCount} / {item.checkoutViewCount}
                                    </td>
                                    <td className="px-3 py-2 tabular-nums">{item.orderCount}</td>
                                    <td className="px-3 py-2 tabular-nums">{percent(item.conversionRate)}</td>
                                    <td className="px-3 py-2 tabular-nums">
                                        {money(item.netRevenueMicrounits, currencyCode)}
                                    </td>
                                    <td className="px-3 py-2 tabular-nums">
                                        {money(item.campaignCostMicrounits, currencyCode)}
                                    </td>
                                    <td className="px-3 py-2 tabular-nums">
                                        {ratio(item.refundAdjustedRoas)}
                                    </td>
                                    <td className="px-3 py-2 tabular-nums">
                                        {percent(item.refundAdjustedRoi)}
                                    </td>
                                </tr>
                            ))}
                            {!query.loading && !(report?.items.length ?? 0) && (
                                <tr>
                                    <td colSpan={11} className="px-3 py-10 text-center text-slate-500">
                                        当前日期范围暂无归因流量或投放费用。
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {costOpen && (
                <CampaignCostDialog
                    currencyCode={currencyCode}
                    onClose={() => setCostOpen(false)}
                    onSaved={async () => {
                        setCostOpen(false);
                        setMessage('投放费用已追加到审计账本');
                        await query.refetch();
                    }}
                />
            )}
        </section>
    );
}

function CampaignCostDialog({
    currencyCode,
    onClose,
    onSaved,
}: {
    currencyCode: string;
    onClose: () => void;
    onSaved: () => Promise<void>;
}) {
    const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
    const [source, setSource] = useState('google');
    const [medium, setMedium] = useState('cpc');
    const [campaign, setCampaign] = useState('');
    const [amount, setAmount] = useState('');
    const [reason, setReason] = useState('');
    const [error, setError] = useState('');
    const [recordCost, state] = useMutation(RECORD_MARKETING_CAMPAIGN_COST_MUTATION);
    const save = async () => {
        setError('');
        try {
            const amountMicrounits = signedMicrounits(amount);
            if (!campaign.trim()) throw new Error('请填写投放活动名称');
            if (!reason.trim()) throw new Error('请填写费用来源或冲正原因');
            await recordCost({
                variables: {
                    input: {
                        businessDate: date,
                        currencyCode,
                        source,
                        medium,
                        campaign,
                        amountMicrounits,
                        idempotencyKey: `admin:${crypto.randomUUID()}`,
                        reason,
                    },
                },
            });
            await onSaved();
        } catch (caught) {
            setError(toUserFacingError(caught, '投放费用记录失败'));
        }
    };
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
            <div className="w-full max-w-lg space-y-4 rounded-xl bg-white p-5 shadow-xl">
                <div>
                    <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
                        记录投放费用
                        <FeatureHelpButton topic="marketing.attribution-cost" title="记录投放费用" />
                    </h3>
                    <p className="mt-1 text-xs text-slate-500">
                        账本只追加不覆盖；需要修正时新增一笔负数冲正。金额支持 3 位小数。
                    </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="业务日期" value={date} onChange={setDate} type="date" />
                    <Field
                        label="金额"
                        value={amount}
                        onChange={setAmount}
                        placeholder="120.500 或 -20.000"
                    />
                    <Field label="来源" value={source} onChange={setSource} placeholder="google" />
                    <Field label="媒介" value={medium} onChange={setMedium} placeholder="cpc" />
                    <div className="sm:col-span-2">
                        <Field
                            label="活动"
                            value={campaign}
                            onChange={setCampaign}
                            placeholder="september-launch"
                        />
                    </div>
                    <div className="sm:col-span-2">
                        <Field
                            label="原因 / 账单凭证"
                            value={reason}
                            onChange={setReason}
                            placeholder="Google Ads 2026-09-21 日账单"
                        />
                    </div>
                </div>
                {error && (
                    <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>
                )}
                <div className="flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg border px-4 py-2 text-xs font-bold"
                    >
                        取消
                    </button>
                    <button
                        type="button"
                        onClick={() => void save()}
                        disabled={state.loading}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                    >
                        {state.loading ? '保存中…' : '追加费用'}
                    </button>
                </div>
            </div>
        </div>
    );
}

function Field({
    label,
    value,
    onChange,
    type = 'text',
    placeholder,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    type?: string;
    placeholder?: string;
}) {
    return (
        <label className="block text-xs font-bold text-slate-600">
            {label}
            <input
                type={type}
                value={value}
                onChange={event => onChange(event.target.value)}
                placeholder={placeholder}
                className="mt-1 h-9 w-full rounded-lg border border-slate-300 px-3 text-xs font-normal"
            />
        </label>
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
    return <Field label={label} value={value} onChange={onChange} type="date" />;
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="text-[11px] font-bold text-slate-500">{label}</div>
            <div className="mt-1 truncate text-sm font-bold tabular-nums text-slate-900" title={value}>
                {value}
            </div>
        </div>
    );
}

function defaultRange() {
    const to = new Date();
    const from = new Date(to.getTime() - 29 * 24 * 60 * 60 * 1_000);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function isoRange(from: string, to: string) {
    if (!from || !to || from > to) return null;
    return { from: `${from}T00:00:00.000Z`, to: `${to}T23:59:59.999Z` };
}

function signedMicrounits(value: string) {
    const normalized = value.trim().replace(/,/gu, '');
    if (!/^-?(?:\d+)(?:\.\d{1,3})?$/u.test(normalized)) throw new Error('金额必须是有效数字，最多 3 位小数');
    const result = Math.round(Number(normalized) * 1_000);
    if (!Number.isSafeInteger(result) || result === 0) throw new Error('金额不能为 0 或超出可支持范围');
    return result;
}

function money(value: number, currencyCode: string) {
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: currencyCode }).format(
        value / 1_000,
    );
}

function percent(value?: number | null) {
    return value == null ? '—' : `${(value * 100).toFixed(1)}%`;
}

function ratio(value?: number | null) {
    return value == null ? '—' : `${value.toFixed(2)}x`;
}
