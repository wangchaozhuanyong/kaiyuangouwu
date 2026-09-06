import { useQuery } from '@apollo/client/react';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';

import {
    STOREFRONT_TRAFFIC_QUERY,
    type StorefrontTrafficData,
} from '../../graphql/storefront-traffic.graphql';

const numberLabel = (value: number | null | undefined) =>
    value == null ? '—' : value.toLocaleString('zh-CN');

export function StorefrontTrafficPanel() {
    const [days, setDays] = useState(7);
    const query = useQuery<StorefrontTrafficData>(STOREFRONT_TRAFFIC_QUERY, {
        variables: { days },
        fetchPolicy: 'network-only',
        pollInterval: 60_000,
    });

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-1 rounded-lg bg-slate-50 p-1" aria-label="访问统计日期范围">
                    {[7, 30].map(value => (
                        <button
                            key={value}
                            type="button"
                            aria-pressed={days === value}
                            onClick={() => setDays(value)}
                            className={`rounded-md px-3 py-1.5 text-xs font-bold ${days === value ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-500'}`}
                        >
                            最近 {value} 天
                        </button>
                    ))}
                </div>
                <button
                    type="button"
                    onClick={() => void query.refetch()}
                    disabled={query.loading}
                    className="inline-flex items-center gap-1 text-xs font-bold text-slate-600 disabled:opacity-50"
                >
                    <RefreshCw className={`h-3 w-3 ${query.loading ? 'animate-spin' : ''}`} />
                    刷新
                </button>
            </div>
            {query.error ? (
                <p role="alert" className="rounded-lg bg-rose-50 p-3 text-xs text-rose-800">
                    访问统计加载失败，请点击刷新重试。
                </p>
            ) : !query.data ? (
                <p role="status" className="py-8 text-center text-xs text-slate-500">
                    正在读取访问统计…
                </p>
            ) : (
                <StorefrontTrafficReport report={query.data.storefrontTraffic} />
            )}
            <p className="border-t border-slate-100 pt-3 text-[11px] text-slate-500">
                要排除自己检查店铺的访问，请打开对应店铺网站，在“我的 → 访问统计”中设置。
                设置仅对该浏览器和店铺域名生效，后台页面本身不采集访问。
            </p>
        </div>
    );
}

export function StorefrontTrafficReport({ report }: { report: StorefrontTrafficData['storefrontTraffic'] }) {
    const today = report.days.find(day => day.businessDate === report.businessDate);
    const maxVisitors = Math.max(1, ...report.days.map(day => day.visitorCount ?? 0));
    const metrics = [
        { label: '今日独立访客', value: today?.visitorCount, note: '估算 · 按账号／浏览器去重' },
        { label: '今日浏览量', value: today?.pageViewCount, note: '页面打开次数，含刷新' },
        { label: '今日独立 IP', value: today?.ipCount, note: '不同网络地址，不等于人数' },
    ];
    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-3">
                {metrics.map(metric => (
                    <div key={metric.label} className="min-w-0 rounded-lg bg-slate-50 p-3">
                        <p className="text-[11px] text-slate-500">{metric.label}</p>
                        <strong className="mt-1 block text-xl tabular-nums text-slate-900">
                            {numberLabel(metric.value)}
                        </strong>
                        <p className="mt-1 text-[10px] leading-4 text-slate-500">{metric.note}</p>
                    </div>
                ))}
            </div>
            {!report.firstRecordedAt ? (
                <p
                    role="status"
                    className="rounded-lg border border-dashed border-slate-200 p-4 text-xs leading-5 text-slate-500"
                >
                    暂无新版访问记录。开始采集后显示实际记录；历史访客汇总不能还原浏览量和独立 IP。
                </p>
            ) : (
                <div>
                    <p className="mb-3 text-xs font-bold text-slate-700">每日独立访客趋势（估算）</p>
                    <div
                        className="flex h-28 items-end gap-1"
                        role="img"
                        aria-label="每日独立访客柱状图，具体数值见下方每日数据"
                    >
                        {report.days.map(day => (
                            <div
                                key={day.businessDate}
                                className="flex h-full min-w-0 flex-1 items-end"
                                title={`${day.businessDate}：${numberLabel(day.visitorCount)}${day.visitorCount == null ? '（无采集记录）' : ' 位独立访客（估算）'}`}
                            >
                                <div
                                    className={`w-full rounded-t-sm ${day.visitorCount == null ? 'border-t border-dashed border-slate-300' : 'bg-blue-500'}`}
                                    style={{
                                        height:
                                            day.visitorCount == null
                                                ? '2px'
                                                : `${Math.max(3, (day.visitorCount / maxVisitors) * 100)}%`,
                                    }}
                                />
                            </div>
                        ))}
                    </div>
                    <div className="mt-2 flex justify-between text-[10px] tabular-nums text-slate-500">
                        <span>{report.days[0]?.businessDate}</span>
                        <span>{report.businessDate}</span>
                    </div>
                </div>
            )}
            <details className="rounded-lg border border-slate-200">
                <summary className="cursor-pointer px-3 py-2 text-xs font-bold text-slate-600">
                    查看每日数据
                </summary>
                <div className="max-h-64 overflow-auto">
                    <table className="w-full text-left text-[11px] tabular-nums">
                        <caption className="sr-only">北京时间每天的独立访客估算、浏览量及独立 IP</caption>
                        <thead className="sticky top-0 bg-slate-50 text-slate-500">
                            <tr>
                                {['日期', '访客（估算）', '浏览量', '独立 IP'].map(label => (
                                    <th key={label} className="whitespace-nowrap px-3 py-2 font-medium">
                                        {label}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-slate-700">
                            {[...report.days].reverse().map(day => (
                                <tr key={day.businessDate}>
                                    <td className="whitespace-nowrap px-3 py-2">{day.businessDate}</td>
                                    <td className="px-3 py-2">{numberLabel(day.visitorCount)}</td>
                                    <td className="px-3 py-2">{numberLabel(day.pageViewCount)}</td>
                                    <td className="px-3 py-2">{numberLabel(day.ipCount)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </details>
            <p className="text-[10px] leading-5 text-slate-500">
                北京时间 00:00–24:00，按当前店铺统计。— 表示没有采集记录或 IP 数据不完整。
                数据是已记录的访问，首次采集当天与今天可能不足全天；屏蔽统计、断网等可能造成漏记。
                已过滤常见机器人，但访客数不能保证等于真人数。
                {report.lastRecordedAt && (
                    <>
                        {' '}
                        最近记录：
                        {new Intl.DateTimeFormat('zh-CN', {
                            timeZone: report.timezone,
                            dateStyle: 'short',
                            timeStyle: 'short',
                        }).format(new Date(report.lastRecordedAt))}
                        。
                    </>
                )}
            </p>
        </div>
    );
}
