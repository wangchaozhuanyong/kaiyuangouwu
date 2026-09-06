import { useQuery } from '@apollo/client/react';
import {
    MARKETING_CAMPAIGN_SCOPE_QUERY,
    MarketingCampaignScopeResult,
} from '../../graphql/marketing.graphql';
import { formatDateTime, formatMoney } from '../Sales/sales-utils';
import { CampaignDetail, couponKindLabels, couponRule } from './promotion-model';
import { Modal } from './promotion-ui';

export function CampaignDetailDialog({
    campaign,
    currencyCode,
    onClose,
}: {
    campaign: CampaignDetail;
    currencyCode: string;
    onClose: () => void;
}) {
    const coupon = campaign.type === 'COUPON' ? campaign.item : null;
    const scopeQuery = useQuery<MarketingCampaignScopeResult>(MARKETING_CAMPAIGN_SCOPE_QUERY, {
        variables: {
            collectionIds: coupon?.collectionIds ?? [],
            variantIds: coupon?.productVariantIds ?? [],
            collectionTake: Math.max(1, coupon?.collectionIds.length ?? 0),
            variantTake: Math.max(1, coupon?.productVariantIds.length ?? 0),
        },
        skip: !coupon || (!coupon.collectionIds.length && !coupon.productVariantIds.length),
        fetchPolicy: 'cache-first',
    });

    if (campaign.type === 'FLASH_SALE') {
        const sale = campaign.item;
        return (
            <Modal
                title="秒杀活动设置详情"
                description="只读查看活动规则和商品价格，不会修改活动。"
                onClose={onClose}
                width="max-w-4xl"
            >
                <DetailGrid>
                    <DetailValue label="活动名称" value={sale.name} />
                    <DetailValue
                        label="当前状态"
                        value={campaignStateText(sale.enabled, sale.startsAt, sale.endsAt)}
                    />
                    <DetailValue label="开始时间" value={formatDateTime(sale.startsAt)} />
                    <DetailValue label="结束时间" value={formatDateTime(sale.endsAt)} />
                    <DetailValue label="创建时间" value={formatDateTime(sale.createdAt)} />
                    <DetailValue label="最后更新" value={formatDateTime(sale.updatedAt)} />
                    <DetailValue label="活动 ID" value={sale.id} mono />
                    <DetailValue label="商品规格" value={`${sale.items.length} 个`} />
                </DetailGrid>
                <DetailSection title="秒杀商品与价格">
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                        <table className="w-full min-w-[680px] text-left text-xs">
                            <thead className="bg-slate-50 text-slate-500">
                                <tr>
                                    <th className="px-3 py-2.5">商品</th>
                                    <th className="px-3 py-2.5">规格</th>
                                    <th className="px-3 py-2.5">原价</th>
                                    <th className="px-3 py-2.5">秒杀价</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {sale.items.map(item => (
                                    <tr key={item.productVariantId}>
                                        <td className="px-3 py-2.5 font-bold text-slate-800">
                                            {item.productName}
                                        </td>
                                        <td className="px-3 py-2.5 text-slate-600">{item.variantName}</td>
                                        <td className="px-3 py-2.5 font-mono text-slate-500">
                                            {formatMoney(item.originalPrice, item.currencyCode)}
                                        </td>
                                        <td className="px-3 py-2.5 font-mono font-bold text-orange-600">
                                            {formatMoney(item.salePrice, item.currencyCode)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </DetailSection>
            </Modal>
        );
    }

    if (!coupon) return null;

    const collectionNames = scopeQuery.data?.collections.items.map(item => item.name) ?? [];
    const variantNames =
        scopeQuery.data?.productVariants.items.map(
            item => `${item.product.name} / ${item.name}${item.sku ? `（${item.sku}）` : ''}`,
        ) ?? [];
    return (
        <Modal
            title="优惠券活动设置详情"
            description="只读查看活动设置、客户权益和经营结果。"
            onClose={onClose}
            width="max-w-4xl"
        >
            {coupon.archivedAt && (
                <div className="mb-4 rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs text-violet-700">
                    该活动已于 {formatDateTime(coupon.archivedAt)}{' '}
                    归档；客户已领取优惠券、订单与财务流水仍然保留。
                </div>
            )}
            <DetailSection title="基本信息">
                <DetailGrid>
                    <DetailValue label="活动名称" value={coupon.name} />
                    <DetailValue label="活动类型" value={couponKindLabels[coupon.kind]} />
                    <DetailValue
                        label="当前状态"
                        value={
                            coupon.archivedAt
                                ? '已归档'
                                : campaignStateText(
                                      coupon.enabled,
                                      coupon.claimStartsAt ?? coupon.startsAt,
                                      coupon.claimEndsAt ?? coupon.endsAt,
                                  )
                        }
                    />
                    <DetailValue label="内部券码" value={coupon.couponCode} mono />
                    <DetailValue label="创建时间" value={formatDateTime(coupon.createdAt)} />
                    <DetailValue label="最后更新" value={formatDateTime(coupon.updatedAt)} />
                    <DetailValue label="活动 ID" value={coupon.id} mono />
                    <DetailValue
                        label="删除策略"
                        value={
                            coupon.claimedCount > 0
                                ? `已领取 ${coupon.claimedCount} 张，只可归档`
                                : '尚无领取记录，可删除'
                        }
                    />
                </DetailGrid>
            </DetailSection>
            <DetailSection title="优惠与适用范围">
                <DetailGrid>
                    <DetailValue label="优惠规则" value={couponRule(coupon, currencyCode)} />
                    <DetailValue
                        label="叠加规则"
                        value={coupon.stackPolicy === 'STACKABLE' ? '可与其他优惠叠加' : '不可叠加'}
                    />
                    <DetailValue
                        label="适用分类"
                        value={scopeValue(
                            coupon.collectionIds,
                            collectionNames,
                            scopeQuery.loading,
                            scopeQuery.error?.message,
                        )}
                    />
                    <DetailValue
                        label="适用商品规格"
                        value={scopeValue(
                            coupon.productVariantIds,
                            variantNames,
                            scopeQuery.loading,
                            scopeQuery.error?.message,
                        )}
                    />
                </DetailGrid>
            </DetailSection>
            <DetailSection title="时间、数量与权益规则">
                <DetailGrid>
                    <DetailValue
                        label="领取开始"
                        value={formatDateTime(coupon.claimStartsAt ?? coupon.startsAt)}
                    />
                    <DetailValue
                        label="领取结束"
                        value={formatDateTime(coupon.claimEndsAt ?? coupon.endsAt)}
                    />
                    <DetailValue
                        label="领取后有效期"
                        value={coupon.validityDays ? `${coupon.validityDays} 天` : '按活动结束时间'}
                    />
                    <DetailValue label="发放总量" value={limitValue(coupon.issueLimit, '张')} />
                    <DetailValue label="剩余可发" value={limitValue(coupon.remainingIssueCount, '张')} />
                    <DetailValue label="每人领取上限" value={`${coupon.perCustomerClaimLimit} 张`} />
                    <DetailValue label="总使用次数" value={limitValue(coupon.usageLimit, '次')} />
                    <DetailValue
                        label="每人使用上限"
                        value={limitValue(coupon.perCustomerUsageLimit, '次')}
                    />
                    <DetailValue label="取消订单返券" value={coupon.returnOnCancellation ? '是' : '否'} />
                    <DetailValue label="全额退款返券" value={coupon.returnOnFullRefund ? '是' : '否'} />
                </DetailGrid>
            </DetailSection>
            <DetailSection title="领取、使用与经营数据">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                    <DetailMetric label="已领取" value={`${coupon.claimedCount} 张`} />
                    <DetailMetric label="当前可用" value={`${coupon.availableCount} 张`} />
                    <DetailMetric label="订单锁定" value={`${coupon.lockedCount} 张`} />
                    <DetailMetric label="已核销" value={`${coupon.usedCount} 张`} />
                    <DetailMetric label="已返还" value={`${coupon.returnedCount} 张`} />
                    <DetailMetric label="已过期" value={`${coupon.expiredCount} 张`} />
                    <DetailMetric label="已作废" value={`${coupon.revokedCount} 张`} />
                    <DetailMetric label="贡献订单" value={`${coupon.redeemedOrderCount} 笔`} />
                    <DetailMetric
                        label="优惠成本"
                        value={formatMoney(coupon.discountAmountTotal, currencyCode)}
                    />
                    <DetailMetric
                        label="带动成交"
                        value={formatMoney(coupon.assistedRevenueTotal, currencyCode)}
                    />
                </div>
            </DetailSection>
        </Modal>
    );
}

export function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="mb-5 last:mb-0">
            <h3 className="mb-2 text-xs font-bold text-slate-900">{title}</h3>
            {children}
        </section>
    );
}

export function DetailGrid({ children }: { children: React.ReactNode }) {
    return <div className="grid gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-2">{children}</div>;
}

export function DetailValue({
    label,
    value,
    mono = false,
}: {
    label: string;
    value: string;
    mono?: boolean;
}) {
    return (
        <div className="min-w-0 rounded-lg bg-slate-50 px-3 py-2.5">
            <div className="text-[10px] font-bold text-slate-400">{label}</div>
            <div
                className={`mt-1 break-words text-xs font-semibold text-slate-800 ${mono ? 'font-mono' : ''}`}
            >
                {value}
            </div>
        </div>
    );
}

export function DetailMetric({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-[10px] font-bold text-slate-400">{label}</div>
            <div className="mt-1 font-mono text-sm font-bold text-slate-900">{value}</div>
        </div>
    );
}

function scopeValue(ids: string[], names: string[], loading: boolean, error?: string) {
    if (!ids.length) return '全部';
    if (loading) return '正在读取…';
    if (error) return `读取失败（${ids.length} 项）`;
    return names.length ? names.join('、') : `${ids.length} 项（名称不可用）`;
}

function limitValue(value: number | null, unit: string) {
    return value == null ? '不限' : `${value} ${unit}`;
}

function campaignStateText(enabled: boolean, startsAt: string | null, endsAt: string | null) {
    if (!enabled) return '已停用';
    const now = Date.now();
    if (startsAt && Date.parse(startsAt) > now) return '待开始';
    if (endsAt && Date.parse(endsAt) <= now) return '已结束';
    return '进行中';
}
