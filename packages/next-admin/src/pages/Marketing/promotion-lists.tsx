import { Archive, BadgePercent, Ban, Copy, Edit3, Eye, Flame, Send, Trash2 } from 'lucide-react';
import { StoreCouponRecord, StoreFlashSaleRecord } from '../../graphql/marketing.graphql';
import { formatMoney } from '../Sales/sales-utils';
import {
    SensitiveAction,
    couponIsActive,
    couponKindLabels,
    couponRule,
    dateRange,
    formatRate,
} from './promotion-model';
import { CampaignState, EmptyState, SmallMetric } from './promotion-ui';

export function CouponList({
    coupons,
    currencyCode,
    actionPending,
    onCreate,
    onCopy,
    onGrant,
    onView,
    onRename,
    onSensitive,
}: {
    coupons: StoreCouponRecord[];
    currencyCode: string;
    actionPending: boolean;
    onCreate: () => void;
    onCopy: (code: string) => void;
    onGrant: (coupon: StoreCouponRecord) => void;
    onView: (coupon: StoreCouponRecord) => void;
    onRename: (value: { id: string; name: string }) => void;
    onSensitive: (action: SensitiveAction) => void;
}) {
    if (!coupons.length)
        return (
            <EmptyState
                icon={BadgePercent}
                title="还没有优惠券活动"
                detail="创建第一张优惠券后，领取、核销和退款数据会在这里汇总。"
                action="新建优惠券"
                onAction={onCreate}
            />
        );
    return (
        <div className="space-y-3">
            {coupons.map(coupon => (
                <article
                    key={coupon.id}
                    className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs"
                >
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                                <h2 className="font-bold text-slate-900">{coupon.name}</h2>
                                <span className="rounded bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                                    {couponKindLabels[coupon.kind]}
                                </span>
                                <CampaignState
                                    enabled={coupon.enabled}
                                    startsAt={coupon.claimStartsAt ?? coupon.startsAt}
                                    endsAt={coupon.claimEndsAt ?? coupon.endsAt}
                                />
                                {coupon.archivedAt && (
                                    <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700">
                                        已归档
                                    </span>
                                )}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                                <button
                                    type="button"
                                    onClick={() => onCopy(coupon.couponCode)}
                                    className="flex items-center gap-1 font-mono font-bold text-slate-700 hover:text-blue-600"
                                    title="这是系统内部兑换码，客户领券通常无需手输"
                                >
                                    {coupon.couponCode}
                                    <Copy className="h-3 w-3" />
                                </button>
                                <span>{couponRule(coupon, currencyCode)}</span>
                                <span>
                                    {dateRange(
                                        coupon.claimStartsAt ?? coupon.startsAt,
                                        coupon.claimEndsAt ?? coupon.endsAt,
                                    )}
                                </span>
                            </div>
                            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                                <SmallMetric label="已领取" value={`${coupon.claimedCount} 张`} />
                                <SmallMetric label="当前可用" value={`${coupon.availableCount} 张`} />
                                <SmallMetric label="已核销" value={`${coupon.usedCount} 张`} />
                                <SmallMetric
                                    label="使用率"
                                    value={formatRate(coupon.usedCount, coupon.claimedCount)}
                                />
                                <SmallMetric
                                    label="优惠金额"
                                    value={formatMoney(coupon.discountAmountTotal, currencyCode)}
                                />
                                <SmallMetric
                                    label="带动成交"
                                    value={formatMoney(coupon.assistedRevenueTotal, currencyCode)}
                                />
                            </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2 text-[11px]">
                            <button
                                type="button"
                                onClick={() => onView(coupon)}
                                className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 font-bold text-slate-700 hover:bg-slate-50"
                            >
                                <Eye className="h-3.5 w-3.5" />
                                查看详情
                            </button>
                            {!coupon.archivedAt && (
                                <button
                                    type="button"
                                    onClick={() => onGrant(coupon)}
                                    className="flex items-center gap-1 rounded-lg bg-blue-50 px-3 py-2 font-bold text-blue-700 hover:bg-blue-100"
                                >
                                    <Send className="h-3.5 w-3.5" />
                                    指定发券
                                </button>
                            )}
                            {!coupon.archivedAt && (
                                <button
                                    type="button"
                                    onClick={() => onRename({ id: coupon.id, name: coupon.name })}
                                    className="rounded-lg border border-slate-300 bg-white p-2 text-slate-600 hover:bg-slate-50"
                                    aria-label="修改名称"
                                >
                                    <Edit3 className="h-4 w-4" />
                                </button>
                            )}
                            {!coupon.archivedAt && couponIsActive(coupon) && (
                                <button
                                    type="button"
                                    onClick={() =>
                                        onSensitive({ kind: 'STOP', id: coupon.id, name: coupon.name })
                                    }
                                    disabled={actionPending}
                                    className="flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 font-bold text-amber-700 disabled:opacity-50"
                                >
                                    <Ban className="h-3.5 w-3.5" />
                                    停止发放
                                </button>
                            )}
                            {!coupon.archivedAt && coupon.availableCount > 0 && (
                                <button
                                    type="button"
                                    onClick={() =>
                                        onSensitive({
                                            kind: 'REVOKE',
                                            id: coupon.id,
                                            name: coupon.name,
                                            affectedCount: coupon.availableCount,
                                        })
                                    }
                                    disabled={actionPending}
                                    className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 font-bold text-rose-700 disabled:opacity-50"
                                >
                                    作废未使用券
                                </button>
                            )}
                            {!coupon.archivedAt && coupon.claimedCount > 0 && (
                                <button
                                    type="button"
                                    onClick={() =>
                                        onSensitive({
                                            kind: 'ARCHIVE',
                                            id: coupon.id,
                                            name: coupon.name,
                                            claimedCount: coupon.claimedCount,
                                        })
                                    }
                                    disabled={actionPending}
                                    className="flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 font-bold text-violet-700 disabled:opacity-50"
                                    title="已产生领取记录，归档后保留客户权益和财务流水"
                                >
                                    <Archive className="h-3.5 w-3.5" />
                                    归档
                                </button>
                            )}
                            {!coupon.archivedAt && coupon.claimedCount === 0 && (
                                <button
                                    type="button"
                                    onClick={() =>
                                        onSensitive({
                                            kind: 'DELETE',
                                            id: coupon.id,
                                            name: coupon.name,
                                            subject: '优惠券',
                                        })
                                    }
                                    disabled={actionPending}
                                    className="rounded-lg border border-slate-300 bg-white p-2 text-slate-400 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                                    aria-label="删除优惠券"
                                >
                                    <Trash2 className="h-4 w-4" />
                                </button>
                            )}
                        </div>
                    </div>
                </article>
            ))}
        </div>
    );
}

export function FlashSaleList({
    sales,
    actionPending,
    onCreate,
    onRename,
    onView,
    onSensitive,
}: {
    sales: StoreFlashSaleRecord[];
    actionPending: boolean;
    onCreate: () => void;
    onRename: (value: { id: string; name: string }) => void;
    onView: (sale: StoreFlashSaleRecord) => void;
    onSensitive: (action: SensitiveAction) => void;
}) {
    if (!sales.length)
        return (
            <EmptyState
                icon={Flame}
                title="还没有秒杀活动"
                detail="秒杀会同时影响商城展示和购物车结算价格。"
                action="新建秒杀"
                onAction={onCreate}
            />
        );
    return (
        <div className="space-y-3">
            {sales.map(sale => (
                <article key={sale.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                                <h2 className="font-bold text-slate-900">{sale.name}</h2>
                                <CampaignState
                                    enabled={sale.enabled}
                                    startsAt={sale.startsAt}
                                    endsAt={sale.endsAt}
                                />
                            </div>
                            <p className="mt-1 text-[11px] text-slate-500">
                                {dateRange(sale.startsAt, sale.endsAt)} · {sale.items.length} 个商品规格
                            </p>
                            <div className="mt-3 flex gap-2 overflow-x-auto">
                                {sale.items.slice(0, 8).map(item => (
                                    <div
                                        key={item.productVariantId}
                                        className="min-w-[180px] rounded-lg bg-slate-50 p-2.5"
                                    >
                                        <div className="truncate text-[11px] font-bold text-slate-800">
                                            {item.productName}
                                        </div>
                                        <div className="truncate text-[10px] text-slate-400">
                                            {item.variantName}
                                        </div>
                                        <div className="mt-1 flex items-baseline gap-2">
                                            <strong className="font-mono text-xs text-orange-600">
                                                {formatMoney(item.salePrice, item.currencyCode)}
                                            </strong>
                                            <span className="font-mono text-[10px] text-slate-400 line-through">
                                                {formatMoney(item.originalPrice, item.currencyCode)}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                                {sale.items.length > 8 && (
                                    <div className="flex min-w-20 items-center justify-center rounded-lg bg-slate-50 text-[11px] text-slate-500">
                                        +{sale.items.length - 8}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="flex shrink-0 gap-2">
                            <button
                                type="button"
                                onClick={() => onView(sale)}
                                className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
                            >
                                <Eye className="h-3.5 w-3.5" />
                                查看详情
                            </button>
                            <button
                                type="button"
                                onClick={() => onRename({ id: sale.id, name: sale.name })}
                                className="rounded-lg border border-slate-300 bg-white p-2 text-slate-600"
                                aria-label="修改名称"
                            >
                                <Edit3 className="h-4 w-4" />
                            </button>
                            <button
                                type="button"
                                onClick={() =>
                                    onSensitive({
                                        kind: 'TOGGLE',
                                        id: sale.id,
                                        name: sale.name,
                                        enabled: !sale.enabled,
                                    })
                                }
                                disabled={actionPending}
                                className={`rounded-lg px-3 py-2 text-[11px] font-bold ${sale.enabled ? 'border border-amber-200 bg-amber-50 text-amber-700' : 'bg-emerald-600 text-white'}`}
                            >
                                {sale.enabled ? '停用活动' : '启用活动'}
                            </button>
                            <button
                                type="button"
                                onClick={() =>
                                    onSensitive({
                                        kind: 'DELETE',
                                        id: sale.id,
                                        name: sale.name,
                                        subject: '秒杀',
                                    })
                                }
                                disabled={actionPending}
                                className="rounded-lg border border-slate-300 bg-white p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                                aria-label="删除秒杀"
                            >
                                <Trash2 className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                </article>
            ))}
        </div>
    );
}
