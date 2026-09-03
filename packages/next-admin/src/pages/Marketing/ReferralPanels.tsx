import { useMutation } from '@apollo/client/react';
import { Edit3, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
    DELETE_REFERRAL_POSTER_MUTATION,
    ReferralPosterRecord,
    ReferralProgramRecord,
    ReferralProgramResult,
    ReferralReportsResult,
    UPDATE_REFERRAL_POSTER_MUTATION,
    UPDATE_REFERRAL_PROGRAM_MUTATION,
} from '../../graphql/marketing.graphql';
import { formatDateTime, formatMoney } from '../Sales/sales-utils';
import { ErrorState, LoadingState, Message, Modal } from '../Settings/settings-ui';
import {
    ActionButton,
    EmptyRow,
    ModalFooter,
    MoneyDelta,
    NumberField,
    OverviewMetric,
    ReportPagination,
    StatusBadge,
    TableCard,
    Td,
    TextField,
    Th,
    ToggleField,
    errorText,
    posterLabel,
    programDraftError,
} from './referral-ui';
import { ProgramDraft, ReportKey, WithdrawalAction } from './referrals-types';

export function TodayOverview({ data }: { data: ReferralProgramResult['referralTodayMetrics'] }) {
    return (
        <section>
            <div className="mb-2 flex items-center justify-between">
                <div>
                    <h2 className="text-sm font-bold text-slate-900">今日经营概览</h2>
                    <p className="mt-0.5 text-[10px] text-slate-500">
                        业务日期 {data.businessDate}，按支付结算与退款后的净数据统计
                    </p>
                </div>
            </div>
            <div className="grid overflow-hidden rounded-xl border border-slate-200 bg-white sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
                <OverviewMetric label="访客" value={`${data.visitorCount}`} />
                <OverviewMetric label="新增客户" value={`${data.newCustomerCount}`} />
                <OverviewMetric label="消费客户" value={`${data.consumerCount}`} />
                <OverviewMetric label="首购客户" value={`${data.firstTimeConsumerCount}`} />
                <OverviewMetric label="复购客户" value={`${data.returningConsumerCount}`} />
                <OverviewMetric label="订单" value={`${data.orderCount}`} />
                <OverviewMetric label="新增邀请" value={`${data.todayInvitedCount}`} />
                <OverviewMetric
                    label="受邀成交"
                    value={`${data.todayInvitedPurchaserCount}`}
                    detail={
                        data.salesByCurrency
                            .map(item => formatMoney(item.sales, item.currencyCode))
                            .join(' / ') || '暂无成交'
                    }
                />
            </div>
        </section>
    );
}

export const SYSTEM_POSTER_TEMPLATES = [
    {
        id: 'BRAND_MINIMAL',
        nameZh: '云桥简约',
        nameEn: 'CloudBridge minimal',
        desc: '经典白蓝极简科技版式，通用度最高，适合各类数字化产品。',
        gradient: 'linear-gradient(135deg, #1d4ed8, #60a5fa)',
    },
    {
        id: 'BENEFIT_RED_GOLD',
        nameZh: '冰川蓝光',
        nameEn: 'Glacier blue',
        desc: '冷光科技冰川蓝渐变，视觉聚焦，适合 SaaS 与 AI 服务。',
        gradient: 'linear-gradient(135deg, #0284c7, #38bdf8)',
    },
    {
        id: 'PRODUCT_STORY',
        nameZh: '青空流线',
        nameEn: 'Skyline flow',
        desc: '青空流线清新风格，视觉轻盈舒适，适合生活化与创作工具。',
        gradient: 'linear-gradient(135deg, #0369a1, #06b6d4)',
    },
    {
        id: 'PREMIUM_DARK',
        nameZh: '深海科技',
        nameEn: 'Deep-sea tech',
        desc: '深邃极客暗黑风，对比度鲜明，适合高阶开发者与 AI 工具。',
        gradient: 'linear-gradient(135deg, #020b1d, #0f2b5c)',
    },
    {
        id: 'CLOUD_BRIDGE_ORBIT',
        nameZh: '云桥轨道',
        nameEn: 'CloudBridge orbit',
        desc: '紫蓝科技轨道渐变，未来感与营销冲击力强。',
        gradient: 'linear-gradient(135deg, #4338ca, #7c3aed)',
    },
] as const;

export function ProgramSettings({
    draft,
    setDraft,
    currencyCode,
    program,
}: {
    draft: ProgramDraft;
    setDraft: (value: ProgramDraft) => void;
    currencyCode: string;
    program: ReferralProgramRecord;
}) {
    const validation = programDraftError(draft);
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
            <div className="mb-5 border-b border-slate-100 pb-4">
                <h2 className="text-sm font-bold text-slate-900">邀请返利规则</h2>
                <p className="mt-1 text-[11px] text-slate-500">
                    当前后端是一级邀请返利，不存在二级团队分佣；规则调整只影响后续订单，不篡改已有流水。
                </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <ToggleField
                    label="开启客户端邀请返利"
                    detail="关闭后隐藏客户端入口，已有余额与流水不会删除。"
                    checked={draft.enabled}
                    onChange={enabled => setDraft({ ...draft, enabled })}
                />
                <ToggleField
                    label="允许余额购物抵扣"
                    detail="关闭后暂停消费抵扣，奖励和退款扣回仍继续记账。"
                    checked={draft.allowBalanceSpend}
                    onChange={allowBalanceSpend => setDraft({ ...draft, allowBalanceSpend })}
                />
                <NumberField
                    label="一级返利比例 (%)"
                    value={draft.rewardRate}
                    min={0}
                    max={100}
                    step={0.01}
                    onChange={rewardRate => setDraft({ ...draft, rewardRate })}
                    detail="按受邀客户有效商品实付金额计算，不含运费与余额抵扣。"
                />
                <NumberField
                    label="奖励等待生效 (天)"
                    value={draft.releaseDelayDays}
                    min={0}
                    max={30}
                    step={1}
                    onChange={releaseDelayDays => setDraft({ ...draft, releaseDelayDays })}
                    detail="等待期降低短期退款造成的余额追缴风险。"
                />
                <TextField
                    label={`最低有效消费 (${currencyCode})`}
                    type="number"
                    value={draft.minimumOrderAmount}
                    onChange={(minimumOrderAmount: string) => setDraft({ ...draft, minimumOrderAmount })}
                />
                <TextField
                    label={`单笔返利上限 (${currencyCode})`}
                    type="number"
                    value={draft.maxRewardPerOrder}
                    onChange={(maxRewardPerOrder: string) => setDraft({ ...draft, maxRewardPerOrder })}
                    placeholder="留空表示不限"
                />
                <NumberField
                    label="邀请归因有效期 (天)"
                    value={draft.attributionWindowDays}
                    min={1}
                    max={365}
                    step={1}
                    onChange={attributionWindowDays => setDraft({ ...draft, attributionWindowDays })}
                    detail="客户打开邀请链接后，在该期限内注册自动归因。"
                />
                <label className="block text-[11px] font-bold text-slate-600">
                    默认分享海报
                    <select
                        value={draft.defaultPosterTemplate}
                        onChange={event => setDraft({ ...draft, defaultPosterTemplate: event.target.value })}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-normal text-slate-900"
                    >
                        {SYSTEM_POSTER_TEMPLATES.filter(t =>
                            (draft.posterTemplates ?? []).includes(t.id),
                        ).map(template => (
                            <option key={template.id} value={template.id}>
                                {template.nameZh}（系统预置）
                            </option>
                        ))}
                        {program.posterTemplateConfigs
                            .filter(template => template.enabled)
                            .map(template => (
                                <option key={template.id} value={template.id}>
                                    {template.name}
                                </option>
                            ))}
                    </select>
                </label>
            </div>
            {validation && <p className="mt-4 text-xs text-rose-600">{validation}</p>}
        </section>
    );
}

export function PromotersPanel({
    data,
    loading,
    error,
    search,
    skips,
    changeSkip,
    onRetry,
}: {
    data?: ReferralReportsResult;
    loading: boolean;
    error?: string;
    search: string;
    skips: Record<ReportKey, number>;
    changeSkip: (key: ReportKey, value: number) => void;
    onRetry: () => void;
}) {
    if (loading && !data) return <LoadingState />;
    if (error) return <ErrorState message={error} onRetry={onRetry} />;
    const q = search.trim().toLowerCase();
    const summaries = (data?.referralInviterSummaries.items ?? []).filter(
        item =>
            !q || `${item.customerName} ${item.customerEmail} ${item.inviteCode}`.toLowerCase().includes(q),
    );
    const relationships = (data?.referralRelationships.items ?? []).filter(
        item =>
            !q ||
            `${item.inviterName} ${item.inviterEmail} ${item.inviteeName} ${item.inviteeEmail} ${item.inviteCodeSnapshot}`
                .toLowerCase()
                .includes(q),
    );
    return (
        <div className="space-y-4">
            <TableCard title="推广员团队" description="按邀请码汇总邀请人数与成交人数">
                <table className="w-full min-w-[980px] border-collapse text-left text-xs">
                    <thead>
                        <tr>
                            <Th>推广员姓名</Th>
                            <Th>推广员邮箱</Th>
                            <Th>邀请码</Th>
                            <Th>已邀请</Th>
                            <Th>已成交受邀人</Th>
                            <Th>转化率</Th>
                        </tr>
                    </thead>
                    <tbody>
                        {summaries.map(item => (
                            <tr key={item.customerId} className="h-[52px] border-t border-slate-100">
                                <Td>
                                    <span
                                        className="block max-w-44 truncate font-bold text-slate-900"
                                        title={item.customerName || item.customerEmail}
                                    >
                                        {item.customerName || item.customerEmail}
                                    </span>
                                </Td>
                                <Td>
                                    <span
                                        className="block max-w-56 truncate text-slate-500"
                                        title={item.customerEmail}
                                    >
                                        {item.customerEmail}
                                    </span>
                                </Td>
                                <Td>
                                    <span className="font-mono font-bold text-blue-600">
                                        {item.inviteCode}
                                    </span>
                                </Td>
                                <Td>{item.invitedCount} 人</Td>
                                <Td>{item.purchasedInviteeCount} 人</Td>
                                <Td>
                                    {item.invitedCount
                                        ? `${((item.purchasedInviteeCount / item.invitedCount) * 100).toFixed(1)}%`
                                        : '0%'}
                                </Td>
                            </tr>
                        ))}
                        {!summaries.length && <EmptyRow colSpan={6} />}
                    </tbody>
                </table>
                <ReportPagination
                    skip={skips.summaries}
                    total={data?.referralInviterSummaries.totalItems ?? 0}
                    onChange={value => changeSkip('summaries', value)}
                />
            </TableCard>
            <TableCard title="邀请关系明细" description="每条绑定关系与首次成交时间均可追溯">
                <table className="w-full min-w-[1420px] border-collapse text-left text-xs">
                    <thead>
                        <tr>
                            <Th>邀请人姓名</Th>
                            <Th>邀请人邮箱</Th>
                            <Th>受邀客户姓名</Th>
                            <Th>受邀客户邮箱</Th>
                            <Th>邀请码</Th>
                            <Th>来源</Th>
                            <Th>绑定时间</Th>
                            <Th>首次成交</Th>
                        </tr>
                    </thead>
                    <tbody>
                        {relationships.map(item => (
                            <tr key={item.id} className="h-[52px] border-t border-slate-100">
                                <Td>
                                    <span
                                        className="block max-w-40 truncate font-bold text-slate-900"
                                        title={item.inviterName || item.inviterEmail}
                                    >
                                        {item.inviterName || item.inviterEmail}
                                    </span>
                                </Td>
                                <Td>
                                    <span
                                        className="block max-w-56 truncate text-slate-500"
                                        title={item.inviterEmail}
                                    >
                                        {item.inviterEmail}
                                    </span>
                                </Td>
                                <Td>
                                    <span
                                        className="block max-w-40 truncate font-bold text-slate-900"
                                        title={item.inviteeName || item.inviteeEmail}
                                    >
                                        {item.inviteeName || item.inviteeEmail}
                                    </span>
                                </Td>
                                <Td>
                                    <span
                                        className="block max-w-56 truncate text-slate-500"
                                        title={item.inviteeEmail}
                                    >
                                        {item.inviteeEmail}
                                    </span>
                                </Td>
                                <Td>
                                    <span className="font-mono text-blue-600">{item.inviteCodeSnapshot}</span>
                                </Td>
                                <Td>{item.source || '—'}</Td>
                                <Td>{formatDateTime(item.boundAt)}</Td>
                                <Td>{formatDateTime(item.firstPaidOrderAt)}</Td>
                            </tr>
                        ))}
                        {!relationships.length && <EmptyRow colSpan={8} />}
                    </tbody>
                </table>
                <ReportPagination
                    skip={skips.relationships}
                    total={data?.referralRelationships.totalItems ?? 0}
                    onChange={value => changeSkip('relationships', value)}
                />
            </TableCard>
        </div>
    );
}

export function RewardsPanel({
    data,
    loading,
    error,
    search,
    skip,
    changeSkip,
    onRetry,
}: {
    data?: ReferralReportsResult;
    loading: boolean;
    error?: string;
    search: string;
    skip: number;
    changeSkip: (value: number) => void;
    onRetry: () => void;
}) {
    if (loading && !data) return <LoadingState />;
    if (error) return <ErrorState message={error} onRetry={onRetry} />;
    const q = search.trim().toLowerCase();
    const items = (data?.referralRewards.items ?? []).filter(
        item =>
            !q ||
            `${item.orderCode} ${item.inviterName} ${item.inviterEmail} ${item.inviteeName}`
                .toLowerCase()
                .includes(q),
    );
    return (
        <TableCard
            title="返利订单与退款扣回"
            description="奖励从待生效到可用、部分扣回或完全扣回均保留原始金额"
        >
            <table className="w-full min-w-[1760px] border-collapse text-left text-xs">
                <thead>
                    <tr>
                        <Th>订单</Th>
                        <Th>推广员姓名</Th>
                        <Th>推广员邮箱</Th>
                        <Th>受邀客户姓名</Th>
                        <Th>受邀客户邮箱</Th>
                        <Th>有效金额</Th>
                        <Th>比例</Th>
                        <Th>奖励</Th>
                        <Th>已生效</Th>
                        <Th>已扣回</Th>
                        <Th>状态</Th>
                        <Th>生效时间</Th>
                    </tr>
                </thead>
                <tbody>
                    {items.map(item => (
                        <tr key={item.id} className="h-[52px] border-t border-slate-100">
                            <Td>
                                <span className="font-mono font-bold text-blue-600">{item.orderCode}</span>
                            </Td>
                            <Td>
                                <span
                                    className="block max-w-40 truncate font-bold text-slate-900"
                                    title={item.inviterName || item.inviterEmail}
                                >
                                    {item.inviterName || item.inviterEmail}
                                </span>
                            </Td>
                            <Td>
                                <span
                                    className="block max-w-56 truncate text-slate-500"
                                    title={item.inviterEmail}
                                >
                                    {item.inviterEmail}
                                </span>
                            </Td>
                            <Td>
                                <span
                                    className="block max-w-40 truncate font-bold text-slate-900"
                                    title={item.inviteeName || item.inviteeEmail}
                                >
                                    {item.inviteeName || item.inviteeEmail}
                                </span>
                            </Td>
                            <Td>
                                <span
                                    className="block max-w-56 truncate text-slate-500"
                                    title={item.inviteeEmail}
                                >
                                    {item.inviteeEmail}
                                </span>
                            </Td>
                            <Td>{formatMoney(item.eligibleAmount, item.currencyCode)}</Td>
                            <Td>{item.rewardRate}%</Td>
                            <Td>
                                <strong className="font-mono text-emerald-600">
                                    {formatMoney(item.rewardAmount, item.currencyCode)}
                                </strong>
                            </Td>
                            <Td>{formatMoney(item.releasedAmount, item.currencyCode)}</Td>
                            <Td>{formatMoney(item.clawedBackAmount, item.currencyCode)}</Td>
                            <Td>
                                <StatusBadge value={item.status} />
                            </Td>
                            <Td>{formatDateTime(item.availableAt)}</Td>
                        </tr>
                    ))}
                    {!items.length && <EmptyRow colSpan={12} />}
                </tbody>
            </table>
            <ReportPagination
                skip={skip}
                total={data?.referralRewards.totalItems ?? 0}
                onChange={changeSkip}
            />
        </TableCard>
    );
}

export function LedgerPanel({
    data,
    loading,
    error,
    search,
    skip,
    changeSkip,
    onRetry,
}: {
    data?: ReferralReportsResult;
    loading: boolean;
    error?: string;
    search: string;
    skip: number;
    changeSkip: (value: number) => void;
    onRetry: () => void;
}) {
    if (loading && !data) return <LoadingState />;
    if (error) return <ErrorState message={error} onRetry={onRetry} />;
    const q = search.trim().toLowerCase();
    const items = (data?.referralLedger.items ?? []).filter(
        item =>
            !q ||
            `${item.customerName} ${item.customerEmail} ${item.eventType} ${item.orderId} ${item.withdrawalId}`
                .toLowerCase()
                .includes(q),
    );
    const mismatches =
        data?.referralBalanceAudit.items.filter(
            item => item.availableDifference || item.pendingDifference || item.reservedDifference,
        ) ?? [];
    return (
        <div className="space-y-4">
            {mismatches.length ? (
                <Message kind="error" onClose={() => undefined}>
                    发现 {mismatches.length} 个钱包账实差异，请暂停人工调整并核对流水。
                </Message>
            ) : (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                    <ShieldCheck className="h-4 w-4" />
                    已校验 {data?.referralBalanceAudit.auditedWallets ?? 0} 个钱包，账实一致
                </div>
            )}
            <TableCard
                title="钱包审计流水"
                description="所有奖励、消费抵扣、退款追缴、提款和人工调整均写入不可变流水"
            >
                <table className="w-full min-w-[1500px] border-collapse text-left text-xs">
                    <thead>
                        <tr>
                            <Th>时间</Th>
                            <Th>客户姓名</Th>
                            <Th>客户邮箱</Th>
                            <Th>事件</Th>
                            <Th>可用变化</Th>
                            <Th>待生效变化</Th>
                            <Th>冻结变化</Th>
                            <Th>变化后可用</Th>
                            <Th>关联单据</Th>
                            <Th>备注</Th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map(item => (
                            <tr key={item.id} className="h-[52px] border-t border-slate-100">
                                <Td>{formatDateTime(item.createdAt)}</Td>
                                <Td>
                                    <span
                                        className="block max-w-40 truncate font-bold text-slate-900"
                                        title={item.customerName || item.customerEmail}
                                    >
                                        {item.customerName || item.customerEmail}
                                    </span>
                                </Td>
                                <Td>
                                    <span
                                        className="block max-w-56 truncate text-slate-500"
                                        title={item.customerEmail}
                                    >
                                        {item.customerEmail}
                                    </span>
                                </Td>
                                <Td>
                                    <span className="font-mono text-[10px] font-bold text-slate-700">
                                        {item.eventType}
                                    </span>
                                </Td>
                                <Td>
                                    <MoneyDelta value={item.availableDelta} currency={item.currencyCode} />
                                </Td>
                                <Td>
                                    <MoneyDelta value={item.pendingDelta} currency={item.currencyCode} />
                                </Td>
                                <Td>
                                    <MoneyDelta value={item.reservedDelta} currency={item.currencyCode} />
                                </Td>
                                <Td>{formatMoney(item.availableAfter, item.currencyCode)}</Td>
                                <Td>
                                    <span className="font-mono text-[10px] text-blue-600">
                                        {item.orderId || item.withdrawalId || item.refundId || '—'}
                                    </span>
                                </Td>
                                <Td>
                                    <span
                                        className="block max-w-64 truncate text-slate-500"
                                        title={item.note || undefined}
                                    >
                                        {item.note || '—'}
                                    </span>
                                </Td>
                            </tr>
                        ))}
                        {!items.length && <EmptyRow colSpan={10} />}
                    </tbody>
                </table>
                <ReportPagination
                    skip={skip}
                    total={data?.referralLedger.totalItems ?? 0}
                    onChange={changeSkip}
                />
            </TableCard>
        </div>
    );
}

export function WithdrawalsPanel({
    data,
    loading,
    error,
    search,
    skip,
    changeSkip,
    onAction,
    onRetry,
}: {
    data?: ReferralReportsResult;
    loading: boolean;
    error?: string;
    search: string;
    skip: number;
    changeSkip: (value: number) => void;
    onAction: (action: WithdrawalAction) => void;
    onRetry: () => void;
}) {
    if (loading && !data) return <LoadingState />;
    if (error) return <ErrorState message={error} onRetry={onRetry} />;
    const q = search.trim().toLowerCase();
    const items = (data?.referralWithdrawals.items ?? []).filter(
        item =>
            !q ||
            `${item.code} ${item.customerName} ${item.customerEmail} ${item.externalReference}`
                .toLowerCase()
                .includes(q),
    );
    return (
        <TableCard
            title="人工提款审批"
            description="批准仅代表审核通过；完成线下打款后必须填写外部流水号并标记已打款"
        >
            <table className="w-full min-w-[1680px] border-collapse text-left text-xs">
                <thead>
                    <tr>
                        <Th>申请编号</Th>
                        <Th>客户姓名</Th>
                        <Th>客户邮箱</Th>
                        <Th>金额</Th>
                        <Th>付款方式</Th>
                        <Th>脱敏账户</Th>
                        <Th>申请时间</Th>
                        <Th>状态</Th>
                        <Th>外部流水</Th>
                        <Th>操作</Th>
                    </tr>
                </thead>
                <tbody>
                    {items.map(item => (
                        <tr key={item.id} className="h-[52px] border-t border-slate-100">
                            <Td>
                                <span className="font-mono font-bold text-slate-900">{item.code}</span>
                            </Td>
                            <Td>
                                <span
                                    className="block max-w-40 truncate font-bold text-slate-900"
                                    title={item.customerName || item.customerEmail}
                                >
                                    {item.customerName || item.customerEmail}
                                </span>
                            </Td>
                            <Td>
                                <span
                                    className="block max-w-56 truncate text-slate-500"
                                    title={item.customerEmail}
                                >
                                    {item.customerEmail}
                                </span>
                            </Td>
                            <Td>
                                <strong className="font-mono text-rose-600">
                                    {formatMoney(item.amount, item.currencyCode)}
                                </strong>
                            </Td>
                            <Td>
                                <span
                                    className="block max-w-40 truncate font-bold text-slate-700"
                                    title={item.payoutMethod}
                                >
                                    {item.payoutMethod}
                                </span>
                            </Td>
                            <Td>
                                <span
                                    className="block max-w-56 truncate font-mono text-[10px] text-slate-500"
                                    title={item.payoutAccountMasked}
                                >
                                    {item.payoutAccountMasked}
                                </span>
                            </Td>
                            <Td>{formatDateTime(item.createdAt)}</Td>
                            <Td>
                                <StatusBadge value={item.status} />
                            </Td>
                            <Td>
                                <span className="font-mono text-[10px]">{item.externalReference || '—'}</span>
                            </Td>
                            <Td>
                                <div className="flex flex-nowrap gap-1 whitespace-nowrap">
                                    {item.status === 'PENDING' && (
                                        <>
                                            <ActionButton
                                                onClick={() => onAction({ item, status: 'APPROVED' })}
                                                label="批准"
                                                positive
                                            />
                                            <ActionButton
                                                onClick={() => onAction({ item, status: 'REJECTED' })}
                                                label="驳回"
                                            />
                                            <ActionButton
                                                onClick={() => onAction({ item, status: 'CANCELLED' })}
                                                label="取消"
                                            />
                                        </>
                                    )}
                                    {item.status === 'APPROVED' && (
                                        <>
                                            <ActionButton
                                                onClick={() => onAction({ item, status: 'PAID' })}
                                                label="登记已打款"
                                                positive
                                            />
                                            <ActionButton
                                                onClick={() => onAction({ item, status: 'REJECTED' })}
                                                label="驳回"
                                            />
                                            <ActionButton
                                                onClick={() => onAction({ item, status: 'CANCELLED' })}
                                                label="取消"
                                            />
                                        </>
                                    )}
                                    {!['PENDING', 'APPROVED'].includes(item.status) && (
                                        <span className="text-slate-400">已结束</span>
                                    )}
                                </div>
                            </Td>
                        </tr>
                    ))}
                    {!items.length && <EmptyRow colSpan={10} />}
                </tbody>
            </table>
            <ReportPagination
                skip={skip}
                total={data?.referralWithdrawals.totalItems ?? 0}
                onChange={changeSkip}
            />
        </TableCard>
    );
}

export function PostersPanel({
    program,
    onEdit,
    onChanged,
    onError,
}: {
    program: ReferralProgramRecord;
    onEdit: (source: ReferralPosterRecord | 'NEW') => void;
    onChanged: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const [deleting, setDeleting] = useState<ReferralPosterRecord | null>(null);
    const [remove, state] = useMutation<{
        deleteReferralPosterTemplate: { result: string; message?: string | null };
    }>(DELETE_REFERRAL_POSTER_MUTATION);
    const [updateProgram, updateProgramState] = useMutation(UPDATE_REFERRAL_PROGRAM_MUTATION);
    const [updatePoster, updatePosterState] = useMutation(UPDATE_REFERRAL_POSTER_MUTATION);

    const toggleSystemTemplate = async (templateId: string, enabled: boolean) => {
        const current = program.posterTemplates ?? [];
        const next = enabled
            ? [...new Set([...current, templateId])]
            : current.filter(id => id !== templateId);
        let nextDefault = program.defaultPosterTemplate;
        if (!enabled && program.defaultPosterTemplate === templateId) {
            const customEnabled = program.posterTemplateConfigs.filter(t => t.enabled).map(t => t.id);
            const allRemaining = [...next, ...customEnabled];
            if (allRemaining.length > 0) nextDefault = allRemaining[0];
        }
        try {
            await updateProgram({
                variables: {
                    input: {
                        expectedUpdatedAt: program.updatedAt,
                        enabled: program.enabled,
                        rewardRate: program.rewardRate,
                        releaseDelayDays: program.releaseDelayDays,
                        minimumOrderAmount: program.minimumOrderAmount,
                        maxRewardPerOrder: program.maxRewardPerOrder,
                        allowBalanceSpend: program.allowBalanceSpend,
                        attributionWindowDays: program.attributionWindowDays,
                        defaultPosterTemplate: nextDefault,
                        posterTemplates: next,
                    },
                },
            });
            await onChanged(
                `系统预置模板「${posterLabel(templateId)}」已${enabled ? '开启客户端显示' : '隐藏'}`,
            );
        } catch (error) {
            onError(errorText(error));
        }
    };

    const makeDefaultTemplate = async (templateId: string) => {
        try {
            await updateProgram({
                variables: {
                    input: {
                        expectedUpdatedAt: program.updatedAt,
                        enabled: program.enabled,
                        rewardRate: program.rewardRate,
                        releaseDelayDays: program.releaseDelayDays,
                        minimumOrderAmount: program.minimumOrderAmount,
                        maxRewardPerOrder: program.maxRewardPerOrder,
                        allowBalanceSpend: program.allowBalanceSpend,
                        attributionWindowDays: program.attributionWindowDays,
                        defaultPosterTemplate: templateId,
                        posterTemplates: program.posterTemplates,
                    },
                },
            });
            await onChanged(`默认海报已设置为「${posterLabel(templateId)}」`);
        } catch (error) {
            onError(errorText(error));
        }
    };

    const toggleCustomTemplate = async (template: ReferralPosterRecord, enabled: boolean) => {
        let nextDefault = program.defaultPosterTemplate;
        if (!enabled && program.defaultPosterTemplate === template.id) {
            const currentSystem = program.posterTemplates ?? [];
            const otherCustom = program.posterTemplateConfigs
                .filter(t => t.id !== template.id && t.enabled)
                .map(t => t.id);
            const allRemaining = [...currentSystem, ...otherCustom];
            if (allRemaining.length > 0) nextDefault = allRemaining[0];
        }
        try {
            await updatePoster({
                variables: {
                    input: {
                        id: template.id,
                        name: template.name,
                        enabled,
                        position: template.position,
                        layoutVariant: template.layoutVariant,
                        posterBackgroundAssetId: template.posterBackgroundAsset?.id || null,
                        shareBackgroundAssetId: template.shareBackgroundAsset?.id || null,
                        titleZh: template.titleZh,
                        titleEn: template.titleEn,
                        headlineZh: template.headlineZh,
                        headlineEn: template.headlineEn,
                        rewardTextZh: template.rewardTextZh,
                        rewardTextEn: template.rewardTextEn,
                        siteIntroZh: template.siteIntroZh,
                        siteIntroEn: template.siteIntroEn,
                        serviceTextZh: template.serviceTextZh,
                        serviceTextEn: template.serviceTextEn,
                        foregroundColor: template.foregroundColor,
                        accentColor: template.accentColor,
                        overlayOpacity: template.overlayOpacity,
                    },
                },
            });
            if (nextDefault !== program.defaultPosterTemplate) {
                await updateProgram({
                    variables: {
                        input: {
                            expectedUpdatedAt: program.updatedAt,
                            enabled: program.enabled,
                            rewardRate: program.rewardRate,
                            releaseDelayDays: program.releaseDelayDays,
                            minimumOrderAmount: program.minimumOrderAmount,
                            maxRewardPerOrder: program.maxRewardPerOrder,
                            allowBalanceSpend: program.allowBalanceSpend,
                            attributionWindowDays: program.attributionWindowDays,
                            defaultPosterTemplate: nextDefault,
                            posterTemplates: program.posterTemplates,
                        },
                    },
                });
            }
            await onChanged(`模板「${template.name}」已${enabled ? '启用客户端显示' : '停用隐藏'}`);
        } catch (error) {
            onError(errorText(error));
        }
    };

    const deleteTemplate = async () => {
        if (!deleting) return;
        try {
            const response = await remove({ variables: { id: deleting.id } });
            const deletion = response.data?.deleteReferralPosterTemplate;
            if (!deletion || deletion.result !== 'DELETED') {
                throw new Error(deletion?.message || '后端拒绝删除该海报模板');
            }
            setDeleting(null);
            await onChanged('海报模板已删除');
        } catch (error) {
            onError(errorText(error));
        }
    };

    const isProgramBusy = updateProgramState.loading || updatePosterState.loading;

    return (
        <div className="space-y-6">
            {/* 系统预置海报模板 */}
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
                <div className="border-b border-slate-100 pb-4">
                    <h2 className="text-sm font-bold text-slate-900">系统预置海报模板</h2>
                    <p className="mt-1 text-[11px] text-slate-500">
                        系统内置 5
                        款全屏移动端海报模板（1080×1920）。您可以通过“在客户端显示”开关自由选择哪些在买家端展示；开启的模板会自动与自定义模板一同在前台展示。
                    </p>
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {SYSTEM_POSTER_TEMPLATES.map(sys => {
                        const isEnabled = (program.posterTemplates ?? []).includes(sys.id);
                        const isDefault = program.defaultPosterTemplate === sys.id;
                        return (
                            <article
                                key={sys.id}
                                className="flex flex-col justify-between overflow-hidden rounded-xl border border-slate-200"
                            >
                                <div>
                                    <div
                                        className="aspect-[16/9] p-4 text-white flex flex-col justify-between"
                                        style={{ background: sys.gradient }}
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="text-[10px] font-bold uppercase tracking-wider opacity-90">
                                                预置海报
                                            </span>
                                            {isDefault && (
                                                <span className="rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-bold text-slate-900">
                                                    当前默认
                                                </span>
                                            )}
                                        </div>
                                        <div>
                                            <div className="text-sm font-bold drop-shadow-sm">
                                                {sys.nameZh}
                                            </div>
                                            <div className="text-[11px] opacity-80">{sys.nameEn}</div>
                                        </div>
                                    </div>
                                    <div className="p-3 space-y-1.5">
                                        <div className="flex items-center justify-between">
                                            <h3 className="text-xs font-bold text-slate-900">{sys.nameZh}</h3>
                                            <span
                                                className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                                    isEnabled
                                                        ? 'bg-emerald-50 text-emerald-700'
                                                        : 'bg-slate-100 text-slate-400'
                                                }`}
                                            >
                                                {isEnabled ? '已启用显示' : '已隐藏'}
                                            </span>
                                        </div>
                                        <p className="text-[11px] text-slate-500 leading-relaxed">
                                            {sys.desc}
                                        </p>
                                    </div>
                                </div>
                                <div className="p-3 pt-0 space-y-2">
                                    <label className="flex cursor-pointer items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-1.5 text-xs">
                                        <span className="text-[11px] font-medium text-slate-700">
                                            在客户端显示
                                        </span>
                                        <input
                                            type="checkbox"
                                            checked={isEnabled}
                                            disabled={isProgramBusy}
                                            onChange={e =>
                                                void toggleSystemTemplate(sys.id, e.target.checked)
                                            }
                                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                        />
                                    </label>
                                    <button
                                        type="button"
                                        disabled={isProgramBusy || !isEnabled || isDefault}
                                        onClick={() => void makeDefaultTemplate(sys.id)}
                                        className="w-full rounded-lg border border-slate-200 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        {isDefault ? '当前为默认海报' : '设为默认海报'}
                                    </button>
                                </div>
                            </article>
                        );
                    })}
                </div>
            </section>

            {/* 自定义海报模板 */}
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                    <div>
                        <h2 className="text-sm font-bold text-slate-900">店铺自定义海报模板</h2>
                        <p className="mt-1 text-[11px] text-slate-500">
                            上传您自己设计的专属背景图（建议尺寸 1080×1920
                            竖版）。开启开关后，买家在前台即可选用该海报。
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => onEdit('NEW')}
                        className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white"
                    >
                        <Plus className="h-3.5 w-3.5" />
                        新建模板
                    </button>
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {program.posterTemplateConfigs.map(template => {
                        const isDefault = program.defaultPosterTemplate === template.id;
                        return (
                            <article
                                key={template.id}
                                className="flex flex-col justify-between overflow-hidden rounded-xl border border-slate-200"
                            >
                                <div>
                                    <div
                                        className="aspect-[16/9] bg-slate-100"
                                        style={{
                                            background: template.posterBackgroundAsset
                                                ? `url(${template.posterBackgroundAsset.preview}) center/cover`
                                                : `linear-gradient(135deg, ${template.accentColor}, ${template.foregroundColor})`,
                                        }}
                                    >
                                        <div
                                            className="flex h-full items-end p-4"
                                            style={{
                                                backgroundColor: `rgba(15,23,42,${template.overlayOpacity / 100})`,
                                            }}
                                        >
                                            <div style={{ color: template.foregroundColor }}>
                                                <div className="text-xs font-bold">{template.titleZh}</div>
                                                <div className="mt-1 text-lg font-bold">
                                                    {template.headlineZh}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="p-3">
                                        <div className="flex items-center justify-between">
                                            <h3 className="text-xs font-bold text-slate-900">
                                                {template.name}
                                            </h3>
                                            <div className="flex items-center gap-1">
                                                <span
                                                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                                        template.enabled
                                                            ? 'bg-emerald-50 text-emerald-700'
                                                            : 'bg-slate-100 text-slate-400'
                                                    }`}
                                                >
                                                    {template.enabled ? '已启用' : '已停用'}
                                                </span>
                                                {isDefault && (
                                                    <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                                        默认
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <p className="mt-0.5 text-[10px] text-slate-400">
                                            移动端 1080×1920 · 排序 {template.position}
                                        </p>
                                    </div>
                                </div>
                                <div className="p-3 pt-0 space-y-2">
                                    <label className="flex cursor-pointer items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-1.5 text-xs">
                                        <span className="text-[11px] font-medium text-slate-700">
                                            在客户端显示
                                        </span>
                                        <input
                                            type="checkbox"
                                            checked={template.enabled}
                                            disabled={isProgramBusy}
                                            onChange={e =>
                                                void toggleCustomTemplate(template, e.target.checked)
                                            }
                                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                        />
                                    </label>
                                    <div className="grid grid-cols-3 gap-1.5">
                                        <button
                                            type="button"
                                            onClick={() => onEdit(template)}
                                            className="flex items-center justify-center gap-1 rounded-lg border border-slate-200 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                        >
                                            <Edit3 className="h-3 w-3" />
                                            编辑
                                        </button>
                                        <button
                                            type="button"
                                            disabled={isProgramBusy || !template.enabled || isDefault}
                                            onClick={() => void makeDefaultTemplate(template.id)}
                                            className="rounded-lg border border-slate-200 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                                        >
                                            设为默认
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setDeleting(template)}
                                            disabled={state.loading}
                                            className="flex items-center justify-center gap-1 rounded-lg border border-rose-200 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50"
                                        >
                                            <Trash2 className="h-3 w-3" />
                                            删除
                                        </button>
                                    </div>
                                </div>
                            </article>
                        );
                    })}
                    {!program.posterTemplateConfigs.length && (
                        <div className="col-span-full py-12 text-center text-xs text-slate-400">
                            暂无店铺自定义海报模板。点击右上角“新建模板”可上传您自己设计的专属海报图。
                        </div>
                    )}
                </div>
            </section>
            {deleting && (
                <Modal
                    title="删除海报模板"
                    description={`确认删除“${deleting.name}”？如果它是默认模板，请先在功能设置中更换默认模板。`}
                    onClose={() => setDeleting(null)}
                >
                    <ModalFooter
                        onCancel={() => setDeleting(null)}
                        onConfirm={() => void deleteTemplate()}
                        pending={state.loading}
                        disabled={false}
                        confirmLabel="确认删除"
                        danger
                    />
                </Modal>
            )}
        </div>
    );
}
