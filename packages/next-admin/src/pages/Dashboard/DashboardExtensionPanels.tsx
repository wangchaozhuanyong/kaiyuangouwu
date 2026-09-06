import { useQuery } from '@apollo/client/react';
import { AlertTriangle, ArrowRight, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';

import {
    REFERRAL_TODAY_WIDGET_QUERY,
    STALE_TRANSLATION_ALERT_QUERY,
    type ReferralTodayWidgetData,
    type StaleTranslationAlertData,
} from '../../graphql/dashboard-extensions.graphql';

export function ReferralTodayExtensionWidget() {
    const query = useQuery<ReferralTodayWidgetData>(REFERRAL_TODAY_WIDGET_QUERY, {
        fetchPolicy: 'cache-and-network',
        pollInterval: 60_000,
    });
    const value = query.data?.referralTodayMetrics;
    const cards = value
        ? [
              ['独立访客（估算）', value.visitorCount ?? '—'],
              ['新增注册', value.newCustomerCount],
              ['消费客户', value.consumerCount],
              ['首次消费', value.firstTimeConsumerCount],
              ['老客复购', value.returningConsumerCount],
              ['成功订单', value.orderCount],
              ['新增邀请', value.todayInvitedCount],
              ['受邀首购', value.todayInvitedPurchaserCount],
          ]
        : [];

    if (query.loading && !value) {
        return <p className="py-8 text-center text-xs text-slate-500">正在读取今日数据…</p>;
    }
    if (query.error || !value) {
        return (
            <div
                className="flex items-center justify-between gap-3 rounded-lg bg-rose-50 p-3 text-xs text-rose-800"
                role="alert"
            >
                <span>今日客户与邀请数据加载失败</span>
                <button type="button" onClick={() => void query.refetch()} className="font-bold">
                    重试
                </button>
            </div>
        );
    }

    return (
        <div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {cards.map(([label, count]) => (
                    <div key={label} className="rounded-lg bg-slate-50 p-3">
                        <span className="text-[10px] text-slate-500">{label}</span>
                        <strong className="mt-1 block text-lg tabular-nums text-slate-900">{count}</strong>
                    </div>
                ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[10px] text-slate-500">
                <span>
                    统计日期 {value.businessDate}
                    {value.salesByCurrency.map(
                        item =>
                            ` · ${item.currencyCode} ${(item.sales / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`,
                    )}
                </span>
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={() => void query.refetch()}
                        className="inline-flex items-center gap-1 font-bold text-slate-600"
                    >
                        <RefreshCw className={`h-3 w-3 ${query.loading ? 'animate-spin' : ''}`} />
                        刷新
                    </button>
                    <Link
                        to="/marketing/referrals"
                        className="inline-flex items-center gap-1 font-bold text-blue-600"
                    >
                        查看邀请报表
                        <ArrowRight className="h-3 w-3" />
                    </Link>
                </div>
            </div>
        </div>
    );
}

export function StaleTranslationExtensionAlert() {
    const query = useQuery<StaleTranslationAlertData>(STALE_TRANSLATION_ALERT_QUERY, {
        fetchPolicy: 'cache-and-network',
        pollInterval: 15_000,
    });
    const count = query.data?.contentTranslationStaleCount ?? 0;
    if (query.error || count <= 0) return null;
    return (
        <div
            className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950 sm:flex-row sm:items-center sm:justify-between"
            role="status"
        >
            <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div>
                    <strong className="text-xs">{count} 项英文待同步或复核</strong>
                    <p className="mt-1 text-[11px] leading-5 text-amber-800">
                        中文已保存，英文正在后台同步；人工锁定的英文需要管理员复核。
                    </p>
                </div>
            </div>
            <Link
                to="/plugins/translations"
                className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-amber-900"
            >
                前往处理
                <ArrowRight className="h-3.5 w-3.5" />
            </Link>
        </div>
    );
}
