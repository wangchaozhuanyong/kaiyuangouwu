import { useMutation, useQuery } from '@apollo/client/react';
import {
    AlertCircle,
    Check,
    ChevronLeft,
    ChevronRight,
    CircleDollarSign,
    Edit3,
    Gift,
    ImagePlus,
    LoaderCircle,
    Plus,
    RefreshCw,
    Save,
    Search,
    Settings2,
    ShieldCheck,
    Trash2,
    Users,
    WalletCards,
    X,
} from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { sensitiveActionContext } from '../../apollo';
import { useConfirmDialog } from '../../components/confirm-dialog-context';
import { GET_ASSETS } from '../../graphql/catalog.graphql';
import {
    ADJUST_REFERRAL_BALANCE_MUTATION,
    CREATE_REFERRAL_POSTER_MUTATION,
    CREATE_REFERRAL_WITHDRAWAL_MUTATION,
    DELETE_REFERRAL_POSTER_MUTATION,
    MARKETING_CUSTOMER_LOOKUP_QUERY,
    PROCESS_REFERRAL_WITHDRAWAL_MUTATION,
    REFERRAL_CUSTOMER_WALLETS_QUERY,
    REFERRAL_PROGRAM_QUERY,
    REFERRAL_REPORTS_QUERY,
    ReferralPosterRecord,
    ReferralProgramRecord,
    ReferralProgramResult,
    ReferralReportsResult,
    UPDATE_REFERRAL_POSTER_MUTATION,
    UPDATE_REFERRAL_PROGRAM_MUTATION,
} from '../../graphql/marketing.graphql';
import { useAccessibleDialog } from '../../hooks/use-accessible-dialog';
import { useUrlTab } from '../../hooks/use-url-tab';
import { toUserFacingError } from '../../utils/user-facing-error';
import { formatDateTime, formatMoney, majorInputToMoney } from '../Sales/sales-utils';

type ReferralTab = 'SETTINGS' | 'PROMOTERS' | 'REWARDS' | 'LEDGER' | 'WITHDRAWALS' | 'POSTERS';
const REFERRAL_TABS = {
    settings: 'SETTINGS',
    promoters: 'PROMOTERS',
    rewards: 'REWARDS',
    ledger: 'LEDGER',
    withdrawals: 'WITHDRAWALS',
    posters: 'POSTERS',
} as const;
type ReportKey = 'summaries' | 'relationships' | 'rewards' | 'ledger' | 'withdrawals';
type WithdrawalRecord = ReferralReportsResult['referralWithdrawals']['items'][number];
type WithdrawalAction = { item: WithdrawalRecord; status: 'APPROVED' | 'PAID' | 'REJECTED' | 'CANCELLED' };

interface ProgramDraft {
    expectedUpdatedAt: string;
    enabled: boolean;
    rewardRate: number;
    releaseDelayDays: number;
    minimumOrderAmount: string;
    maxRewardPerOrder: string;
    allowBalanceSpend: boolean;
    attributionWindowDays: number;
    defaultPosterTemplate: string;
}

interface PosterDraft {
    id?: string;
    name: string;
    enabled: boolean;
    position: number;
    layoutVariant: string;
    posterBackgroundAssetId: string;
    shareBackgroundAssetId: string;
    titleZh: string;
    titleEn: string;
    headlineZh: string;
    headlineEn: string;
    rewardTextZh: string;
    rewardTextEn: string;
    siteIntroZh: string;
    siteIntroEn: string;
    serviceTextZh: string;
    serviceTextEn: string;
    foregroundColor: string;
    accentColor: string;
    overlayOpacity: number;
}

interface PosterAssetChoice {
    id: string;
    name: string;
    preview: string;
}

interface PosterAssetLookupResult {
    assets: {
        totalItems: number;
        items: PosterAssetChoice[];
    };
}

const PAGE_SIZE = 50;

export function ReferralsModule() {
    const [activeTab, setActiveTab] = useUrlTab<ReferralTab>(REFERRAL_TABS, 'settings');
    const contentWidthClass =
        activeTab === 'SETTINGS' || activeTab === 'POSTERS' ? 'max-w-[1500px]' : 'max-w-none';
    const [skips, setSkips] = useState<Record<ReportKey, number>>({
        summaries: 0,
        relationships: 0,
        rewards: 0,
        ledger: 0,
        withdrawals: 0,
    });
    const [draftOverride, setDraftOverride] = useState<ProgramDraft | null>(null);
    const [search, setSearch] = useState('');
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');
    const [withdrawalAction, setWithdrawalAction] = useState<WithdrawalAction | null>(null);
    const [financialDialog, setFinancialDialog] = useState<'WITHDRAW' | 'ADJUST' | null>(null);
    const [posterEditing, setPosterEditing] = useState<ReferralPosterRecord | 'NEW' | null>(null);

    const program = useQuery<ReferralProgramResult>(REFERRAL_PROGRAM_QUERY, {
        fetchPolicy: 'cache-and-network',
        pollInterval: 60_000,
    });
    const reports = useQuery<ReferralReportsResult>(REFERRAL_REPORTS_QUERY, {
        variables: {
            take: PAGE_SIZE,
            summarySkip: skips.summaries,
            relationshipSkip: skips.relationships,
            rewardSkip: skips.rewards,
            ledgerSkip: skips.ledger,
            withdrawalSkip: skips.withdrawals,
        },
        fetchPolicy: 'cache-and-network',
    });
    const [updateProgram, updateState] = useMutation(UPDATE_REFERRAL_PROGRAM_MUTATION);

    const currencyCode = program.data?.activeChannel.defaultCurrencyCode ?? 'CNY';
    const draft =
        draftOverride ?? (program.data?.referralProgram ? programDraft(program.data.referralProgram) : null);
    const setDraft = setDraftOverride;
    const isDirty = Boolean(
        draft &&
        program.data?.referralProgram &&
        JSON.stringify(draft) !== JSON.stringify(programDraft(program.data.referralProgram)),
    );
    const refreshAll = async () => {
        setActionError('');
        setDraftOverride(null);
        await Promise.all([program.refetch(), reports.refetch()]);
    };
    const changeSkip = (key: ReportKey, value: number) =>
        setSkips(current => ({ ...current, [key]: Math.max(0, value) }));

    const saveProgram = async () => {
        if (!draft) return;
        const validation = programDraftError(draft);
        if (validation) return setActionError(validation);
        const minimumOrderAmount = majorInputToMoney(draft.minimumOrderAmount, currencyCode);
        const maxRewardPerOrder = draft.maxRewardPerOrder.trim()
            ? majorInputToMoney(draft.maxRewardPerOrder, currencyCode)
            : null;
        if (minimumOrderAmount == null || (draft.maxRewardPerOrder.trim() && maxRewardPerOrder == null))
            return setActionError('金额格式不正确');
        try {
            const result = await updateProgram({
                variables: { input: { ...draft, minimumOrderAmount, maxRewardPerOrder } },
            });
            const updated = (result.data as { updateReferralProgram?: ReferralProgramRecord } | undefined)
                ?.updateReferralProgram;
            setNotice('邀请返利规则已保存');
            await program.refetch();
            setDraftOverride(updated ? null : draft);
        } catch (error) {
            setActionError(errorText(error));
        }
    };

    return (
        <div className="flex h-full flex-col bg-slate-50">
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
                <div
                    className={`mx-auto flex w-full ${contentWidthClass} flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}
                >
                    <div>
                        <h1 className="text-xl font-bold text-slate-900">分销与返利</h1>
                        <p className="mt-1 text-xs text-slate-500">
                            一级邀请返利、推广员、奖励、钱包、提现和分享海报统一管理
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={() => void refreshAll()}
                            disabled={program.loading || reports.loading}
                            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50"
                        >
                            <RefreshCw
                                className={`h-3.5 w-3.5 ${program.loading || reports.loading ? 'animate-spin' : ''}`}
                            />
                            刷新
                        </button>
                        {activeTab === 'WITHDRAWALS' && (
                            <button
                                type="button"
                                onClick={() => setFinancialDialog('WITHDRAW')}
                                className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white"
                            >
                                <Plus className="h-3.5 w-3.5" />
                                代客发起提款
                            </button>
                        )}
                        {activeTab === 'LEDGER' && (
                            <button
                                type="button"
                                onClick={() => setFinancialDialog('ADJUST')}
                                className="flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white"
                            >
                                <WalletCards className="h-3.5 w-3.5" />
                                人工余额调整
                            </button>
                        )}
                        {activeTab === 'SETTINGS' && (
                            <button
                                type="button"
                                onClick={() => void saveProgram()}
                                disabled={!draft || !isDirty || updateState.loading}
                                className="flex items-center gap-1 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
                            >
                                <Save className="h-3.5 w-3.5" />
                                {updateState.loading ? '保存中…' : '保存设置'}
                            </button>
                        )}
                    </div>
                </div>
            </header>
            <main
                className={`mx-auto w-full ${contentWidthClass} flex-1 space-y-4 overflow-y-auto p-5 sm:p-8`}
            >
                {notice && (
                    <Message kind="success" onClose={() => setNotice('')}>
                        {notice}
                    </Message>
                )}
                {actionError && (
                    <Message kind="error" onClose={() => setActionError('')}>
                        {actionError}
                    </Message>
                )}
                {program.loading && !program.data ? (
                    <LoadingState label="正在读取邀请返利数据…" />
                ) : program.error ? (
                    <ErrorState message={program.error.message} onRetry={() => void program.refetch()} />
                ) : (
                    program.data && (
                        <>
                            <TodayOverview data={program.data.referralTodayMetrics} />
                            <nav className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 text-xs shadow-2xs">
                                <TabButton
                                    active={activeTab === 'SETTINGS'}
                                    onClick={() => {
                                        setActiveTab('SETTINGS');
                                        setSearch('');
                                    }}
                                    icon={Settings2}
                                    label="功能设置"
                                />
                                <TabButton
                                    active={activeTab === 'PROMOTERS'}
                                    onClick={() => {
                                        setActiveTab('PROMOTERS');
                                        setSearch('');
                                    }}
                                    icon={Users}
                                    label={`推广员 ${reports.data?.referralInviterSummaries.totalItems ?? 0}`}
                                />
                                <TabButton
                                    active={activeTab === 'REWARDS'}
                                    onClick={() => {
                                        setActiveTab('REWARDS');
                                        setSearch('');
                                    }}
                                    icon={Gift}
                                    label={`返利订单 ${reports.data?.referralRewards.totalItems ?? 0}`}
                                />
                                <TabButton
                                    active={activeTab === 'LEDGER'}
                                    onClick={() => {
                                        setActiveTab('LEDGER');
                                        setSearch('');
                                    }}
                                    icon={WalletCards}
                                    label="钱包流水"
                                />
                                <TabButton
                                    active={activeTab === 'WITHDRAWALS'}
                                    onClick={() => {
                                        setActiveTab('WITHDRAWALS');
                                        setSearch('');
                                    }}
                                    icon={CircleDollarSign}
                                    label={`提款 ${reports.data?.referralWithdrawals.totalItems ?? 0}`}
                                />
                                <TabButton
                                    active={activeTab === 'POSTERS'}
                                    onClick={() => {
                                        setActiveTab('POSTERS');
                                        setSearch('');
                                    }}
                                    icon={ImagePlus}
                                    label="分享海报"
                                />
                            </nav>
                            {activeTab !== 'SETTINGS' && activeTab !== 'POSTERS' && (
                                <div className="relative max-w-md">
                                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                                    <input
                                        value={search}
                                        onChange={event => setSearch(event.target.value)}
                                        aria-label="搜索分销流水"
                                        placeholder="搜索姓名、邮箱、订单号或流水号"
                                        className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-9 text-xs outline-none focus:border-blue-500"
                                    />
                                    {search && (
                                        <button
                                            type="button"
                                            onClick={() => setSearch('')}
                                            className="absolute right-2.5 top-2 text-slate-400"
                                            aria-label="清空分销数据搜索"
                                        >
                                            <X className="h-4 w-4" />
                                        </button>
                                    )}
                                </div>
                            )}
                            {activeTab === 'SETTINGS' && draft && (
                                <ProgramSettings
                                    draft={draft}
                                    setDraft={setDraft}
                                    currencyCode={currencyCode}
                                    program={program.data.referralProgram}
                                />
                            )}
                            {activeTab === 'PROMOTERS' && (
                                <PromotersPanel
                                    data={reports.data}
                                    loading={reports.loading}
                                    error={reports.error?.message}
                                    search={search}
                                    skips={skips}
                                    changeSkip={changeSkip}
                                    onRetry={() => void reports.refetch()}
                                />
                            )}
                            {activeTab === 'REWARDS' && (
                                <RewardsPanel
                                    data={reports.data}
                                    loading={reports.loading}
                                    error={reports.error?.message}
                                    search={search}
                                    skip={skips.rewards}
                                    changeSkip={value => changeSkip('rewards', value)}
                                    onRetry={() => void reports.refetch()}
                                />
                            )}
                            {activeTab === 'LEDGER' && (
                                <LedgerPanel
                                    data={reports.data}
                                    loading={reports.loading}
                                    error={reports.error?.message}
                                    search={search}
                                    skip={skips.ledger}
                                    changeSkip={value => changeSkip('ledger', value)}
                                    onRetry={() => void reports.refetch()}
                                />
                            )}
                            {activeTab === 'WITHDRAWALS' && (
                                <WithdrawalsPanel
                                    data={reports.data}
                                    loading={reports.loading}
                                    error={reports.error?.message}
                                    search={search}
                                    skip={skips.withdrawals}
                                    changeSkip={value => changeSkip('withdrawals', value)}
                                    onAction={setWithdrawalAction}
                                    onRetry={() => void reports.refetch()}
                                />
                            )}
                            {activeTab === 'POSTERS' && (
                                <PostersPanel
                                    program={program.data.referralProgram}
                                    onEdit={setPosterEditing}
                                    onChanged={async message => {
                                        setNotice(message);
                                        await program.refetch();
                                    }}
                                    onError={setActionError}
                                />
                            )}
                        </>
                    )
                )}
            </main>
            {withdrawalAction && (
                <WithdrawalActionDialog
                    action={withdrawalAction}
                    onClose={() => setWithdrawalAction(null)}
                    onSaved={async message => {
                        setWithdrawalAction(null);
                        setNotice(message);
                        await reports.refetch();
                    }}
                    onError={setActionError}
                />
            )}
            {financialDialog && (
                <FinancialDialog
                    mode={financialDialog}
                    defaultCurrency={currencyCode}
                    onClose={() => setFinancialDialog(null)}
                    onSaved={async message => {
                        setFinancialDialog(null);
                        setNotice(message);
                        await reports.refetch();
                    }}
                    onError={setActionError}
                />
            )}
            {posterEditing && program.data && (
                <PosterEditor
                    source={posterEditing}
                    onClose={() => setPosterEditing(null)}
                    onSaved={async message => {
                        setPosterEditing(null);
                        setNotice(message);
                        await program.refetch();
                    }}
                    onError={setActionError}
                />
            )}
        </div>
    );
}

function TodayOverview({ data }: { data: ReferralProgramResult['referralTodayMetrics'] }) {
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

function ProgramSettings({
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
                    onChange={minimumOrderAmount => setDraft({ ...draft, minimumOrderAmount })}
                />
                <TextField
                    label={`单笔返利上限 (${currencyCode})`}
                    type="number"
                    value={draft.maxRewardPerOrder}
                    onChange={maxRewardPerOrder => setDraft({ ...draft, maxRewardPerOrder })}
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
                        {program.posterTemplates.map(template => (
                            <option key={template} value={template}>
                                {posterLabel(template)}
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

function PromotersPanel({
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
    if (loading && !data) return <LoadingState label="正在读取推广员与邀请关系…" />;
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
                <table className="w-full min-w-[720px] text-left text-xs">
                    <thead>
                        <tr>
                            <Th>推广员</Th>
                            <Th>邀请码</Th>
                            <Th>已邀请</Th>
                            <Th>已成交受邀人</Th>
                            <Th>转化率</Th>
                        </tr>
                    </thead>
                    <tbody>
                        {summaries.map(item => (
                            <tr key={item.customerId} className="border-t border-slate-100">
                                <Td>
                                    <NameEmail name={item.customerName} email={item.customerEmail} />
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
                        {!summaries.length && <EmptyRow colSpan={5} />}
                    </tbody>
                </table>
                <ReportPagination
                    skip={skips.summaries}
                    total={data?.referralInviterSummaries.totalItems ?? 0}
                    onChange={value => changeSkip('summaries', value)}
                />
            </TableCard>
            <TableCard title="邀请关系明细" description="每条绑定关系与首次成交时间均可追溯">
                <table className="w-full min-w-[920px] text-left text-xs">
                    <thead>
                        <tr>
                            <Th>邀请人</Th>
                            <Th>受邀客户</Th>
                            <Th>邀请码</Th>
                            <Th>来源</Th>
                            <Th>绑定时间</Th>
                            <Th>首次成交</Th>
                        </tr>
                    </thead>
                    <tbody>
                        {relationships.map(item => (
                            <tr key={item.id} className="border-t border-slate-100">
                                <Td>
                                    <NameEmail name={item.inviterName} email={item.inviterEmail} />
                                </Td>
                                <Td>
                                    <NameEmail name={item.inviteeName} email={item.inviteeEmail} />
                                </Td>
                                <Td>
                                    <span className="font-mono text-blue-600">{item.inviteCodeSnapshot}</span>
                                </Td>
                                <Td>{item.source || '—'}</Td>
                                <Td>{formatDateTime(item.boundAt)}</Td>
                                <Td>{formatDateTime(item.firstPaidOrderAt)}</Td>
                            </tr>
                        ))}
                        {!relationships.length && <EmptyRow colSpan={6} />}
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

function RewardsPanel({
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
    if (loading && !data) return <LoadingState label="正在读取返利订单…" />;
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
            <table className="w-full min-w-[1180px] text-left text-xs">
                <thead>
                    <tr>
                        <Th>订单</Th>
                        <Th>推广员</Th>
                        <Th>受邀客户</Th>
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
                        <tr key={item.id} className="border-t border-slate-100">
                            <Td>
                                <span className="font-mono font-bold text-blue-600">{item.orderCode}</span>
                            </Td>
                            <Td>
                                <NameEmail name={item.inviterName} email={item.inviterEmail} />
                            </Td>
                            <Td>
                                <NameEmail name={item.inviteeName} email={item.inviteeEmail} />
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
                    {!items.length && <EmptyRow colSpan={10} />}
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

function LedgerPanel({
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
    if (loading && !data) return <LoadingState label="正在读取钱包流水…" />;
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
                <table className="w-full min-w-[1180px] text-left text-xs">
                    <thead>
                        <tr>
                            <Th>时间</Th>
                            <Th>客户</Th>
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
                            <tr key={item.id} className="border-t border-slate-100">
                                <Td>{formatDateTime(item.createdAt)}</Td>
                                <Td>
                                    <NameEmail name={item.customerName} email={item.customerEmail} />
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
                                    <span className="line-clamp-2 max-w-64 text-slate-500">
                                        {item.note || '—'}
                                    </span>
                                </Td>
                            </tr>
                        ))}
                        {!items.length && <EmptyRow colSpan={9} />}
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

function WithdrawalsPanel({
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
    if (loading && !data) return <LoadingState label="正在读取提款申请…" />;
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
            <table className="w-full min-w-[1180px] text-left text-xs">
                <thead>
                    <tr>
                        <Th>申请编号</Th>
                        <Th>客户</Th>
                        <Th>金额</Th>
                        <Th>方式/账户</Th>
                        <Th>申请时间</Th>
                        <Th>状态</Th>
                        <Th>外部流水</Th>
                        <Th>操作</Th>
                    </tr>
                </thead>
                <tbody>
                    {items.map(item => (
                        <tr key={item.id} className="border-t border-slate-100">
                            <Td>
                                <span className="font-mono font-bold text-slate-900">{item.code}</span>
                            </Td>
                            <Td>
                                <NameEmail name={item.customerName} email={item.customerEmail} />
                            </Td>
                            <Td>
                                <strong className="font-mono text-rose-600">
                                    {formatMoney(item.amount, item.currencyCode)}
                                </strong>
                            </Td>
                            <Td>
                                <div className="font-bold text-slate-700">{item.payoutMethod}</div>
                                <div className="mt-0.5 font-mono text-[10px] text-slate-400">
                                    {item.payoutAccountMasked}
                                </div>
                            </Td>
                            <Td>{formatDateTime(item.createdAt)}</Td>
                            <Td>
                                <StatusBadge value={item.status} />
                            </Td>
                            <Td>
                                <span className="font-mono text-[10px]">{item.externalReference || '—'}</span>
                            </Td>
                            <Td>
                                <div className="flex flex-wrap gap-1">
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
                    {!items.length && <EmptyRow colSpan={8} />}
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

function PostersPanel({
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
    return (
        <>
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                    <div>
                        <h2 className="text-sm font-bold text-slate-900">分享海报模板</h2>
                        <p className="mt-1 text-[11px] text-slate-500">
                            配置买家端生成的邀请海报和分享图，不再使用外部演示图片。
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
                    {program.posterTemplateConfigs.map(template => (
                        <article
                            key={template.id}
                            className="overflow-hidden rounded-xl border border-slate-200"
                        >
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
                                        <div className="mt-1 text-lg font-bold">{template.headlineZh}</div>
                                    </div>
                                </div>
                            </div>
                            <div className="p-3">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h3 className="text-xs font-bold text-slate-900">{template.name}</h3>
                                        <p className="mt-0.5 text-[10px] text-slate-400">
                                            {template.enabled ? '已启用' : '已停用'} · 排序{' '}
                                            {template.position}
                                            {program.defaultPosterTemplate === template.id
                                                ? ' · 默认模板'
                                                : ''}
                                        </p>
                                    </div>
                                    <div className="flex gap-1">
                                        <button
                                            type="button"
                                            onClick={() => onEdit(template)}
                                            className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
                                            aria-label="编辑模板"
                                        >
                                            <Edit3 className="h-4 w-4" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setDeleting(template)}
                                            disabled={state.loading}
                                            className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                                            aria-label="删除模板"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </article>
                    ))}
                    {!program.posterTemplateConfigs.length && (
                        <div className="col-span-full py-12 text-center text-xs text-slate-400">
                            尚未创建自定义海报模板，可继续使用系统内置模板。
                        </div>
                    )}
                </div>
            </section>
            {deleting && (
                <Modal
                    title="删除海报模板"
                    description={`确认删除“${deleting.name}”？如果它是默认模板，请先在功能设置中更换默认模板。`}
                    onClose={() => setDeleting(null)}
                    width="max-w-md"
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
        </>
    );
}

function WithdrawalActionDialog({
    action,
    onClose,
    onSaved,
    onError,
}: {
    action: WithdrawalAction;
    onClose: () => void;
    onSaved: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const requestConfirmation = useConfirmDialog();
    const [externalReference, setExternalReference] = useState('');
    const [note, setNote] = useState('');
    const [process, state] = useMutation(PROCESS_REFERRAL_WITHDRAWAL_MUTATION);
    const submit = async () => {
        if (action.status === 'PAID' && !externalReference.trim())
            return onError('登记已打款必须填写外部打款流水号');
        if (action.status === 'REJECTED' && !note.trim()) return onError('驳回时必须填写原因');
        const confirmation = await requestConfirmation({
            title: `确认${withdrawalActionLabel(action.status)}？`,
            description: `申请 ${action.item.code} 涉及 ${formatMoney(action.item.amount, action.item.currencyCode)}，操作会写入财务审计流水。`,
            confirmLabel: '验证并处理',
            tone: 'warning',
            requireCurrentPassword: true,
        });
        if (!confirmation) return;
        try {
            await process({
                variables: {
                    input: {
                        id: action.item.id,
                        status: action.status,
                        externalReference: externalReference.trim() || null,
                        note: note.trim() || null,
                    },
                },
                context: sensitiveActionContext(confirmation.currentPassword ?? ''),
            });
            await onSaved(withdrawalSuccess(action.status));
        } catch (error) {
            onError(errorText(error));
        }
    };
    return (
        <Modal
            title={withdrawalActionLabel(action.status)}
            description={`申请 ${action.item.code} · ${formatMoney(action.item.amount, action.item.currencyCode)}`}
            onClose={onClose}
            width="max-w-md"
        >
            <div className="rounded-xl bg-slate-50 p-3 text-xs">
                <NameEmail name={action.item.customerName} email={action.item.customerEmail} />
                <p className="mt-2">
                    收款：{action.item.payoutMethod} / {action.item.payoutAccountMasked}
                </p>
            </div>
            {action.status === 'PAID' && (
                <TextField
                    label="外部打款流水号 *"
                    value={externalReference}
                    onChange={setExternalReference}
                    placeholder="银行、支付宝或链上交易号"
                />
            )}
            <label className="mt-4 block text-[11px] font-bold text-slate-600">
                处理备注{action.status === 'REJECTED' ? ' *' : ''}
                <textarea
                    value={note}
                    onChange={event => setNote(event.target.value)}
                    rows={3}
                    maxLength={500}
                    className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 text-xs font-normal"
                    placeholder={
                        action.status === 'REJECTED'
                            ? '请填写驳回原因，余额会退回可用余额'
                            : '可选，写入审计记录'
                    }
                />
            </label>
            <ModalFooter
                onCancel={onClose}
                onConfirm={() => void submit()}
                pending={state.loading}
                disabled={
                    (action.status === 'PAID' && !externalReference.trim()) ||
                    (action.status === 'REJECTED' && !note.trim())
                }
                confirmLabel={withdrawalActionLabel(action.status)}
                danger={['REJECTED', 'CANCELLED'].includes(action.status)}
            />
        </Modal>
    );
}

function FinancialDialog({
    mode,
    defaultCurrency,
    onClose,
    onSaved,
    onError,
}: {
    mode: 'WITHDRAW' | 'ADJUST';
    defaultCurrency: string;
    onClose: () => void;
    onSaved: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const requestConfirmation = useConfirmDialog();
    const [search, setSearch] = useState('');
    const [customer, setCustomer] = useState<{ id: string; name: string; email: string } | null>(null);
    const [currency, setCurrency] = useState(defaultCurrency);
    const [amount, setAmount] = useState('');
    const [method, setMethod] = useState('ALIPAY');
    const [account, setAccount] = useState('');
    const [reason, setReason] = useState('');
    const deferredSearch = useDeferredValue(search.trim());
    const filter = deferredSearch
        ? {
              _or: [
                  { firstName: { contains: deferredSearch } },
                  { lastName: { contains: deferredSearch } },
                  { emailAddress: { contains: deferredSearch } },
                  { phoneNumber: { contains: deferredSearch } },
              ],
          }
        : undefined;
    const lookup = useQuery<{
        customers: {
            totalItems: number;
            items: Array<{
                id: string;
                firstName: string;
                lastName: string;
                emailAddress: string;
                phoneNumber: string | null;
            }>;
        };
    }>(MARKETING_CUSTOMER_LOOKUP_QUERY, {
        variables: { options: { take: 20, filter } },
        skip: Boolean(customer),
        fetchPolicy: 'cache-and-network',
    });
    const wallets = useQuery<{
        referralCustomerWallets: Array<{
            id: string;
            currencyCode: string;
            availableBalance: number;
            pendingBalance: number;
            reservedBalance: number;
        }>;
    }>(REFERRAL_CUSTOMER_WALLETS_QUERY, {
        variables: { customerId: customer?.id },
        skip: !customer,
        fetchPolicy: 'network-only',
    });
    const [createWithdrawal, withdrawalState] = useMutation(CREATE_REFERRAL_WITHDRAWAL_MUTATION);
    const [adjust, adjustState] = useMutation(ADJUST_REFERRAL_BALANCE_MUTATION);
    const effectiveCurrency = wallets.data?.referralCustomerWallets.some(
        wallet => wallet.currencyCode === currency,
    )
        ? currency
        : (wallets.data?.referralCustomerWallets[0]?.currencyCode ?? currency);
    const dialogTitle = mode === 'WITHDRAW' ? '代客户发起人工提款' : '人工调整返利余额';
    const dialogDescription =
        mode === 'WITHDRAW'
            ? '创建后从可用余额转入冻结余额，仍需后续审批与打款登记。'
            : '支持正负调整，必须填写业务原因，操作会永久写入审计流水。';
    const submit = async () => {
        if (!customer) return onError('请先选择客户');
        if (wallets.loading && !wallets.data) return onError('客户返利余额仍在读取，请稍后再试');
        if (wallets.error || !wallets.data) return onError('客户返利余额读取失败，请重新加载');
        const money = signedMoney(amount, effectiveCurrency, mode === 'ADJUST');
        if (money == null || money === 0)
            return onError(mode === 'ADJUST' ? '请输入非0的调整金额' : '请输入大于0的提款金额');
        if (!reason.trim()) return onError(mode === 'ADJUST' ? '请填写余额调整原因' : '请填写客服处理备注');
        if (mode === 'WITHDRAW' && !account.trim()) return onError('请填写脱敏后的收款账号');
        const adjustmentConfirmation =
            mode === 'ADJUST'
                ? await requestConfirmation({
                      title: '确认人工调整返利余额？',
                      description: `将为${customer.name || customer.email}调整 ${formatMoney(money, effectiveCurrency)}，该操作会永久写入财务审计流水。`,
                      confirmLabel: '验证并调整',
                      tone: 'warning',
                      requireCurrentPassword: true,
                  })
                : null;
        if (mode === 'ADJUST' && !adjustmentConfirmation) return;
        const adjustmentContext = adjustmentConfirmation
            ? sensitiveActionContext(adjustmentConfirmation.currentPassword ?? '')
            : undefined;
        try {
            if (mode === 'WITHDRAW')
                await createWithdrawal({
                    variables: {
                        input: {
                            customerId: customer.id,
                            currencyCode: effectiveCurrency,
                            amount: money,
                            payoutMethod: method,
                            payoutAccountMasked: account.trim(),
                            note: reason.trim(),
                        },
                    },
                });
            else
                await adjust({
                    variables: {
                        customerId: customer.id,
                        currencyCode: effectiveCurrency,
                        amount: money,
                        reason: reason.trim(),
                    },
                    context: adjustmentContext,
                });
            await onSaved(
                mode === 'WITHDRAW' ? '人工提款申请已创建并冻结对应余额' : '人工余额调整已完成并写入审计流水',
            );
        } catch (error) {
            onError(errorText(error));
        }
    };
    if (!customer && lookup.error)
        return (
            <Modal title={dialogTitle} description={dialogDescription} onClose={onClose} width="max-w-lg">
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-center" role="alert">
                    <AlertCircle className="mx-auto h-7 w-7 text-rose-500" />
                    <p className="mt-2 text-xs text-rose-700">
                        {toUserFacingError(lookup.error, '客户列表读取失败，请重新加载。')}
                    </p>
                    <button
                        type="button"
                        onClick={() => void lookup.refetch()}
                        className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white"
                    >
                        重新加载客户
                    </button>
                </div>
            </Modal>
        );
    if (customer && wallets.loading && !wallets.data)
        return (
            <Modal title={dialogTitle} description={dialogDescription} onClose={onClose} width="max-w-lg">
                <LoadingState label="正在读取客户返利余额…" />
            </Modal>
        );
    if (customer && wallets.error)
        return (
            <Modal title={dialogTitle} description={dialogDescription} onClose={onClose} width="max-w-lg">
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-center" role="alert">
                    <AlertCircle className="mx-auto h-7 w-7 text-rose-500" />
                    <p className="mt-2 text-xs text-rose-700">
                        {toUserFacingError(wallets.error, '客户返利余额读取失败，请重新加载。')}
                    </p>
                    <button
                        type="button"
                        onClick={() => void wallets.refetch()}
                        className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white"
                    >
                        重新加载余额
                    </button>
                </div>
            </Modal>
        );
    return (
        <Modal
            title={mode === 'WITHDRAW' ? '代客户发起人工提款' : '人工调整返利余额'}
            description={
                mode === 'WITHDRAW'
                    ? '创建后从可用余额转入冻结余额，仍需后续审批与打款登记。'
                    : '支持正负调整，必须填写业务原因，操作会永久写入审计流水。'
            }
            onClose={onClose}
            width="max-w-lg"
        >
            {!customer ? (
                <>
                    <div className="relative">
                        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                        <input
                            value={search}
                            onChange={event => setSearch(event.target.value)}
                            aria-label="搜索客户"
                            placeholder="搜索客户姓名、手机号或邮箱"
                            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-xs"
                        />
                    </div>
                    <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                        {lookup.loading && !lookup.data ? (
                            <LoadingState label="正在查找客户…" />
                        ) : (
                            lookup.data?.customers.items.map(item => (
                                <button
                                    type="button"
                                    key={item.id}
                                    onClick={() =>
                                        setCustomer({
                                            id: item.id,
                                            name: `${item.lastName}${item.firstName}` || item.emailAddress,
                                            email: item.emailAddress,
                                        })
                                    }
                                    className="flex w-full items-center justify-between rounded-lg border border-slate-200 p-3 text-left hover:border-blue-300"
                                >
                                    <NameEmail
                                        name={`${item.lastName}${item.firstName}` || item.emailAddress}
                                        email={item.phoneNumber || item.emailAddress}
                                    />
                                    <ChevronRight className="h-4 w-4 text-slate-400" />
                                </button>
                            ))
                        )}
                    </div>
                    {lookup.data && (
                        <p className="mt-2 text-[10px] text-slate-400">
                            匹配 {lookup.data.customers.totalItems} 位客户，当前显示前 20
                            位；继续输入可缩小范围
                        </p>
                    )}
                </>
            ) : (
                <>
                    <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3">
                        <NameEmail name={customer.name} email={customer.email} />
                        <button
                            type="button"
                            onClick={() => setCustomer(null)}
                            className="text-[11px] font-bold text-blue-600"
                        >
                            更换客户
                        </button>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                        {wallets.data?.referralCustomerWallets.map(wallet => (
                            <div
                                key={wallet.id}
                                className="col-span-3 grid grid-cols-3 rounded-lg border border-slate-200 p-3 text-center text-[10px]"
                            >
                                <SmallMetric
                                    label={`${wallet.currencyCode} 可用`}
                                    value={formatMoney(wallet.availableBalance, wallet.currencyCode)}
                                />
                                <SmallMetric
                                    label="待生效"
                                    value={formatMoney(wallet.pendingBalance, wallet.currencyCode)}
                                />
                                <SmallMetric
                                    label="冻结"
                                    value={formatMoney(wallet.reservedBalance, wallet.currencyCode)}
                                />
                            </div>
                        ))}
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <FormSelect
                            label="币种"
                            value={effectiveCurrency}
                            onChange={setCurrency}
                            options={
                                wallets.data?.referralCustomerWallets.length
                                    ? wallets.data.referralCustomerWallets.map(wallet => [
                                          wallet.currencyCode,
                                          wallet.currencyCode,
                                      ])
                                    : [[defaultCurrency, defaultCurrency]]
                            }
                        />
                        <TextField
                            label={mode === 'ADJUST' ? '调整金额（正数增加，负数扣减）*' : '提款金额 *'}
                            type="number"
                            value={amount}
                            onChange={setAmount}
                        />
                        {mode === 'WITHDRAW' && (
                            <>
                                <FormSelect
                                    label="提款方式"
                                    value={method}
                                    onChange={setMethod}
                                    options={[
                                        ['ALIPAY', '支付宝'],
                                        ['BANK', '银行卡'],
                                        ['USDT_TRC20', 'USDT-TRC20'],
                                    ]}
                                />
                                <TextField
                                    label="脱敏收款账号 *"
                                    value={account}
                                    onChange={setAccount}
                                    placeholder="例如 138****0000 / TAbc…xyz"
                                />
                            </>
                        )}
                    </div>
                    <label className="mt-3 block text-[11px] font-bold text-slate-600">
                        {mode === 'ADJUST' ? '调整原因 *' : '客服处理备注 *'}
                        <textarea
                            value={reason}
                            onChange={event => setReason(event.target.value)}
                            rows={3}
                            className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 text-xs font-normal"
                        />
                    </label>
                    <ModalFooter
                        onCancel={onClose}
                        onConfirm={() => void submit()}
                        pending={withdrawalState.loading || adjustState.loading}
                        disabled={!amount || !reason.trim() || (mode === 'WITHDRAW' && !account.trim())}
                        confirmLabel={mode === 'WITHDRAW' ? '创建提款申请' : '确认调整余额'}
                        danger={mode === 'ADJUST'}
                    />
                </>
            )}
        </Modal>
    );
}

function PosterEditor({
    source,
    onClose,
    onSaved,
    onError,
}: {
    source: ReferralPosterRecord | 'NEW';
    onClose: () => void;
    onSaved: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const [draft, setDraft] = useState<PosterDraft>(() => posterDraft(source));
    const [assetSearch, setAssetSearch] = useState('');
    const [knownAssets, setKnownAssets] = useState<PosterAssetChoice[]>(() => {
        if (source === 'NEW') return [];
        const selected: PosterAssetChoice[] = [];
        if (source.posterBackgroundAsset) selected.push(source.posterBackgroundAsset);
        if (
            source.shareBackgroundAsset &&
            !selected.some(asset => asset.id === source.shareBackgroundAsset?.id)
        ) {
            selected.push(source.shareBackgroundAsset);
        }
        return selected;
    });
    const deferredAssetSearch = useDeferredValue(assetSearch.trim());
    const assetQuery = useQuery<PosterAssetLookupResult>(GET_ASSETS, {
        variables: {
            options: {
                take: 30,
                sort: { updatedAt: 'DESC' },
                filter: {
                    type: { eq: 'IMAGE' },
                    ...(deferredAssetSearch ? { name: { contains: deferredAssetSearch } } : {}),
                },
            },
        },
        fetchPolicy: 'cache-and-network',
        notifyOnNetworkStatusChange: true,
    });
    const [create, createState] = useMutation(CREATE_REFERRAL_POSTER_MUTATION);
    const [update, updateState] = useMutation(UPDATE_REFERRAL_POSTER_MUTATION);
    const assets = [
        ...new Map(
            [...knownAssets, ...(assetQuery.data?.assets.items ?? [])].map(asset => [asset.id, asset]),
        ).values(),
    ];
    const selectAsset = (field: 'posterBackgroundAssetId' | 'shareBackgroundAssetId', assetId: string) => {
        const selected = assets.find(asset => asset.id === assetId);
        if (selected && !knownAssets.some(asset => asset.id === selected.id)) {
            setKnownAssets(current => [...current, selected]);
        }
        setDraft(current => ({ ...current, [field]: assetId }));
    };
    const validation = posterDraftError(draft);
    const submit = async () => {
        if (validation) return onError(validation);
        const input = {
            ...draft,
            posterBackgroundAssetId: draft.posterBackgroundAssetId || null,
            shareBackgroundAssetId: draft.shareBackgroundAssetId || null,
        };
        try {
            if (draft.id) await update({ variables: { input } });
            else {
                const { id: _id, ...createInput } = input;
                await create({ variables: { input: createInput } });
            }
            await onSaved(draft.id ? '海报模板已更新' : '海报模板已创建');
        } catch (error) {
            onError(errorText(error));
        }
    };
    return (
        <Modal
            title={draft.id ? '编辑分享海报模板' : '新建分享海报模板'}
            description="中文与英文内容分别填写；{rewardRate} 会在客户端替换为实时返利比例。"
            onClose={onClose}
            width="max-w-4xl"
        >
            <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                    label="模板名称 *"
                    value={draft.name}
                    onChange={name => setDraft({ ...draft, name })}
                />
                <TextField
                    label="排序"
                    type="number"
                    value={String(draft.position)}
                    onChange={value => setDraft({ ...draft, position: Number(value) })}
                />
                <div className="sm:col-span-2">
                    <TextField
                        label="搜索全部图片素材"
                        value={assetSearch}
                        onChange={setAssetSearch}
                        placeholder="输入素材名称"
                    />
                    <div className="mt-1 flex min-h-4 items-center justify-between gap-3 text-[10px] text-slate-400">
                        {assetQuery.loading ? (
                            <span className="flex items-center gap-1" role="status">
                                <LoaderCircle className="h-3 w-3 animate-spin" />
                                正在查询素材库…
                            </span>
                        ) : assetQuery.error ? (
                            <span className="text-rose-600" role="alert">
                                素材读取失败，请重试
                            </span>
                        ) : (
                            <span>
                                匹配 {assetQuery.data?.assets.totalItems ?? 0} 张图片，当前显示前 30 张
                            </span>
                        )}
                        {assetQuery.error && (
                            <button
                                type="button"
                                onClick={() => void assetQuery.refetch()}
                                className="font-bold text-blue-600 hover:text-blue-700"
                            >
                                重新加载
                            </button>
                        )}
                    </div>
                </div>
                <FormSelect
                    label="海报背景图"
                    value={draft.posterBackgroundAssetId}
                    onChange={posterBackgroundAssetId =>
                        selectAsset('posterBackgroundAssetId', posterBackgroundAssetId)
                    }
                    options={[['', '不使用图片'], ...assets.map(asset => [asset.id, asset.name])]}
                />
                <FormSelect
                    label="分享背景图"
                    value={draft.shareBackgroundAssetId}
                    onChange={shareBackgroundAssetId =>
                        selectAsset('shareBackgroundAssetId', shareBackgroundAssetId)
                    }
                    options={[['', '不使用图片'], ...assets.map(asset => [asset.id, asset.name])]}
                />
                <TextField
                    label="中文标题 *"
                    value={draft.titleZh}
                    onChange={titleZh => setDraft({ ...draft, titleZh })}
                />
                <TextField
                    label="English title *"
                    value={draft.titleEn}
                    onChange={titleEn => setDraft({ ...draft, titleEn })}
                />
                <TextField
                    label="中文主文案 *"
                    value={draft.headlineZh}
                    onChange={headlineZh => setDraft({ ...draft, headlineZh })}
                />
                <TextField
                    label="English headline *"
                    value={draft.headlineEn}
                    onChange={headlineEn => setDraft({ ...draft, headlineEn })}
                />
                <TextField
                    label="中文奖励说明 *"
                    value={draft.rewardTextZh}
                    onChange={rewardTextZh => setDraft({ ...draft, rewardTextZh })}
                />
                <TextField
                    label="English reward text *"
                    value={draft.rewardTextEn}
                    onChange={rewardTextEn => setDraft({ ...draft, rewardTextEn })}
                />
                <TextField
                    label="中文站点介绍 *"
                    value={draft.siteIntroZh}
                    onChange={siteIntroZh => setDraft({ ...draft, siteIntroZh })}
                />
                <TextField
                    label="English site intro *"
                    value={draft.siteIntroEn}
                    onChange={siteIntroEn => setDraft({ ...draft, siteIntroEn })}
                />
                <TextField
                    label="中文服务说明 *"
                    value={draft.serviceTextZh}
                    onChange={serviceTextZh => setDraft({ ...draft, serviceTextZh })}
                />
                <TextField
                    label="English service text *"
                    value={draft.serviceTextEn}
                    onChange={serviceTextEn => setDraft({ ...draft, serviceTextEn })}
                />
                <TextField
                    label="前景色"
                    type="color"
                    value={draft.foregroundColor}
                    onChange={foregroundColor => setDraft({ ...draft, foregroundColor })}
                />
                <TextField
                    label="强调色"
                    type="color"
                    value={draft.accentColor}
                    onChange={accentColor => setDraft({ ...draft, accentColor })}
                />
                <NumberField
                    label="遮罩透明度 (%)"
                    value={draft.overlayOpacity}
                    min={0}
                    max={80}
                    step={1}
                    onChange={overlayOpacity => setDraft({ ...draft, overlayOpacity })}
                />
                <ToggleField
                    label="启用模板"
                    detail="停用后客户端不会提供该模板。"
                    checked={draft.enabled}
                    onChange={enabled => setDraft({ ...draft, enabled })}
                />
            </div>
            {draft.posterBackgroundAssetId && (
                <img
                    src={assets.find(asset => asset.id === draft.posterBackgroundAssetId)?.preview}
                    alt="海报背景预览"
                    className="mt-4 h-36 w-full rounded-xl object-cover"
                />
            )}
            {validation && <p className="mt-3 text-xs text-rose-600">{validation}</p>}
            <ModalFooter
                onCancel={onClose}
                onConfirm={() => void submit()}
                pending={createState.loading || updateState.loading}
                disabled={Boolean(validation)}
                confirmLabel="保存海报模板"
            />
        </Modal>
    );
}

function TableCard({
    title,
    description,
    children,
}: {
    title: string;
    description: string;
    children: React.ReactNode;
}) {
    return (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
            <div className="border-b border-slate-200 p-4">
                <h2 className="text-sm font-bold text-slate-900">{title}</h2>
                <p className="mt-1 text-[11px] text-slate-500">{description}</p>
            </div>
            <div className="overflow-x-auto">{children}</div>
        </section>
    );
}
function Th({ children }: { children: React.ReactNode }) {
    return <th className="whitespace-nowrap bg-slate-50 p-3 font-bold text-slate-500">{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
    return <td className="p-3 text-slate-700">{children}</td>;
}
function EmptyRow({ colSpan }: { colSpan: number }) {
    return (
        <tr>
            <td colSpan={colSpan} className="p-10 text-center text-xs text-slate-400">
                当前条件下没有数据
            </td>
        </tr>
    );
}
function NameEmail({ name, email }: { name: string; email: string }) {
    return (
        <div className="min-w-0">
            <div className="truncate font-bold text-slate-900">{name || email}</div>
            <div className="truncate text-[10px] text-slate-400">{email}</div>
        </div>
    );
}
function MoneyDelta({ value, currency }: { value: number; currency: string }) {
    return (
        <span
            className={`font-mono font-bold ${value > 0 ? 'text-emerald-600' : value < 0 ? 'text-rose-600' : 'text-slate-400'}`}
        >
            {value > 0 ? '+' : ''}
            {formatMoney(value, currency)}
        </span>
    );
}
function StatusBadge({ value }: { value: string }) {
    const cls = ['PAID', 'AVAILABLE'].includes(value)
        ? 'bg-emerald-100 text-emerald-700'
        : ['REJECTED', 'REVERSED', 'CANCELLED'].includes(value)
          ? 'bg-rose-100 text-rose-700'
          : value === 'APPROVED'
            ? 'bg-blue-100 text-blue-700'
            : 'bg-amber-100 text-amber-700';
    return (
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${cls}`}>{statusLabel(value)}</span>
    );
}
function ActionButton({
    label,
    onClick,
    positive = false,
}: {
    label: string;
    onClick: () => void;
    positive?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`rounded px-2 py-1 text-[10px] font-bold ${positive ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-rose-50 hover:text-rose-600'}`}
        >
            {label}
        </button>
    );
}
function ReportPagination({
    skip,
    total,
    onChange,
}: {
    skip: number;
    total: number;
    onChange: (value: number) => void;
}) {
    const page = Math.floor(skip / PAGE_SIZE);
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    return (
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
            <span>
                共 {total} 条，第 {page + 1}/{totalPages} 页
            </span>
            <div className="flex gap-2">
                <button
                    type="button"
                    disabled={skip === 0}
                    onClick={() => onChange(skip - PAGE_SIZE)}
                    aria-label="上一页"
                    className="rounded border border-slate-300 bg-white p-1.5 disabled:opacity-40"
                >
                    <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                    type="button"
                    disabled={skip + PAGE_SIZE >= total}
                    onClick={() => onChange(skip + PAGE_SIZE)}
                    aria-label="下一页"
                    className="rounded border border-slate-300 bg-white p-1.5 disabled:opacity-40"
                >
                    <ChevronRight className="h-4 w-4" />
                </button>
            </div>
        </div>
    );
}
function OverviewMetric({ label, value, detail }: { label: string; value: string; detail?: string }) {
    return (
        <div className="border-b border-slate-200 p-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
            <div className="text-[10px] font-bold text-slate-400">{label}</div>
            <strong className="mt-1 block text-lg text-slate-900">{value}</strong>
            {detail && (
                <div className="mt-1 truncate text-[9px] text-slate-500" title={detail}>
                    {detail}
                </div>
            )}
        </div>
    );
}
function SmallMetric({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <div className="text-[9px] font-bold text-slate-400">{label}</div>
            <div className="mt-1 truncate font-mono text-[11px] font-bold text-slate-800">{value}</div>
        </div>
    );
}
function TabButton({
    active,
    onClick,
    icon: Icon,
    label,
}: {
    active: boolean;
    onClick: () => void;
    icon: typeof Users;
    label: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-4 py-2 font-bold ${active ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}
        >
            <Icon className="h-3.5 w-3.5" />
            {label}
        </button>
    );
}
function ToggleField({
    label,
    detail,
    checked,
    onChange,
}: {
    label: string;
    detail: string;
    checked: boolean;
    onChange: (value: boolean) => void;
}) {
    return (
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
            <span>
                <strong className="text-xs text-slate-800">{label}</strong>
                <small className="mt-1 block text-[10px] leading-4 text-slate-400">{detail}</small>
            </span>
            <input
                type="checkbox"
                checked={checked}
                onChange={event => onChange(event.target.checked)}
                className="h-4 w-4"
            />
        </label>
    );
}
function NumberField({
    label,
    value,
    min,
    max,
    step,
    onChange,
    detail,
}: {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    onChange: (value: number) => void;
    detail?: string;
}) {
    return (
        <label className="block text-[11px] font-bold text-slate-600">
            {label}
            <input
                type="number"
                value={value}
                min={min}
                max={max}
                step={step}
                onChange={event => onChange(Number(event.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-normal text-slate-900"
            />
            {detail && (
                <small className="mt-1 block text-[10px] font-normal leading-4 text-slate-400">
                    {detail}
                </small>
            )}
        </label>
    );
}
function TextField({
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
        <label className="mt-3 block text-[11px] font-bold text-slate-600">
            {label}
            <input
                type={type}
                value={value}
                onChange={event => onChange(event.target.value)}
                placeholder={placeholder}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-normal text-slate-900"
            />
        </label>
    );
}
function FormSelect({
    label,
    value,
    onChange,
    options,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: string[][];
}) {
    return (
        <label className="block text-[11px] font-bold text-slate-600">
            {label}
            <select
                value={value}
                onChange={event => onChange(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-normal text-slate-900"
            >
                {options.map(([key, text]) => (
                    <option key={key} value={key}>
                        {text}
                    </option>
                ))}
            </select>
        </label>
    );
}
function ModalFooter({
    onCancel,
    onConfirm,
    pending,
    disabled,
    confirmLabel,
    danger = false,
}: {
    onCancel: () => void;
    onConfirm: () => void;
    pending: boolean;
    disabled: boolean;
    confirmLabel: string;
    danger?: boolean;
}) {
    return (
        <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button
                type="button"
                onClick={onCancel}
                className="rounded-lg bg-slate-100 px-4 py-2 text-xs font-bold text-slate-700"
            >
                取消
            </button>
            <button
                type="button"
                onClick={onConfirm}
                disabled={pending || disabled}
                className={`rounded-lg px-4 py-2 text-xs font-bold text-white disabled:opacity-50 ${danger ? 'bg-rose-600' : 'bg-blue-600'}`}
            >
                {pending ? '处理中…' : confirmLabel}
            </button>
        </div>
    );
}
function Message({
    kind,
    children,
    onClose,
}: {
    kind: 'success' | 'error';
    children: React.ReactNode;
    onClose: () => void;
}) {
    return (
        <div
            className={`flex items-center gap-2 rounded-xl border p-3 text-xs ${kind === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}
        >
            {kind === 'success' ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            <span className="flex-1">{children}</span>
            <button type="button" onClick={onClose} aria-label="关闭提示">
                <X className="h-4 w-4" />
            </button>
        </div>
    );
}
function LoadingState({ label }: { label: string }) {
    return (
        <div className="flex min-h-52 items-center justify-center rounded-xl border border-slate-200 bg-white text-xs text-slate-500">
            <LoaderCircle className="mr-2 h-5 w-5 animate-spin text-blue-600" />
            {label}
        </div>
    );
}
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <div className="rounded-xl border border-rose-200 bg-white p-10 text-center">
            <AlertCircle className="mx-auto h-8 w-8 text-rose-500" />
            <h3 className="mt-3 text-sm font-bold text-slate-900">邀请返利数据读取失败</h3>
            <p className="mt-1 text-xs text-rose-600">{toUserFacingError(message)}</p>
            <button
                type="button"
                onClick={onRetry}
                className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white"
            >
                重新加载
            </button>
        </div>
    );
}
function Modal({
    title,
    description,
    onClose,
    width,
    children,
}: {
    title: string;
    description?: string;
    onClose: () => void;
    width: string;
    children: React.ReactNode;
}) {
    const { dialogRef, titleId } = useAccessibleDialog(onClose);
    return (
        <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-2xs"
            onMouseDown={event => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div
                ref={dialogRef as React.RefObject<HTMLDivElement>}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                className={`max-h-[92vh] w-full ${width} overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl outline-none`}
            >
                <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-100 bg-white px-5 py-4">
                    <div>
                        <h2 id={titleId} className="text-base font-bold text-slate-900">
                            {title}
                        </h2>
                        {description && <p className="mt-1 text-[11px] text-slate-500">{description}</p>}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100"
                        aria-label="关闭"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>
                <div className="p-5">{children}</div>
            </div>
        </div>
    );
}

function programDraft(program: ReferralProgramRecord): ProgramDraft {
    return {
        expectedUpdatedAt: program.updatedAt,
        enabled: program.enabled,
        rewardRate: program.rewardRate,
        releaseDelayDays: program.releaseDelayDays,
        minimumOrderAmount: (program.minimumOrderAmount / 100).toFixed(2),
        maxRewardPerOrder:
            program.maxRewardPerOrder == null ? '' : (program.maxRewardPerOrder / 100).toFixed(2),
        allowBalanceSpend: program.allowBalanceSpend,
        attributionWindowDays: program.attributionWindowDays,
        defaultPosterTemplate: program.defaultPosterTemplate,
    };
}
function programDraftError(draft: ProgramDraft) {
    if (!Number.isFinite(draft.rewardRate) || draft.rewardRate < 0 || draft.rewardRate > 100)
        return '返利比例必须在0%到100%之间';
    if (
        !Number.isInteger(draft.releaseDelayDays) ||
        draft.releaseDelayDays < 0 ||
        draft.releaseDelayDays > 30
    )
        return '奖励等待期必须是0到30天的整数';
    if (Number(draft.minimumOrderAmount) < 0) return '最低有效消费不能小于0';
    if (draft.maxRewardPerOrder && Number(draft.maxRewardPerOrder) <= 0) return '单笔返利上限必须大于0或留空';
    if (
        !Number.isInteger(draft.attributionWindowDays) ||
        draft.attributionWindowDays < 1 ||
        draft.attributionWindowDays > 365
    )
        return '归因有效期必须是1到365天的整数';
    return '';
}
function posterDraft(source: ReferralPosterRecord | 'NEW'): PosterDraft {
    if (source === 'NEW')
        return {
            name: '',
            enabled: true,
            position: 0,
            layoutVariant: 'STANDARD_CENTER',
            posterBackgroundAssetId: '',
            shareBackgroundAssetId: '',
            titleZh: '邀请好友，一起发现好物',
            titleEn: 'Invite friends and discover more',
            headlineZh: '好友成功消费，你可获得奖励',
            headlineEn: 'Earn rewards when friends shop',
            rewardTextZh: '最高可获得 {rewardRate}% 奖励用于消费抵扣',
            rewardTextEn: 'Earn up to {rewardRate}% in shopping rewards',
            siteIntroZh: '精选商品与可靠服务',
            siteIntroEn: 'Curated products and reliable service',
            serviceTextZh: '注册后自动绑定邀请关系',
            serviceTextEn: 'Referral is linked automatically after signup',
            foregroundColor: '#FFFFFF',
            accentColor: '#2563EB',
            overlayOpacity: 28,
        };
    return {
        id: source.id,
        name: source.name,
        enabled: source.enabled,
        position: source.position,
        layoutVariant: source.layoutVariant,
        posterBackgroundAssetId: source.posterBackgroundAsset?.id ?? '',
        shareBackgroundAssetId: source.shareBackgroundAsset?.id ?? '',
        titleZh: source.titleZh,
        titleEn: source.titleEn,
        headlineZh: source.headlineZh,
        headlineEn: source.headlineEn,
        rewardTextZh: source.rewardTextZh,
        rewardTextEn: source.rewardTextEn,
        siteIntroZh: source.siteIntroZh,
        siteIntroEn: source.siteIntroEn,
        serviceTextZh: source.serviceTextZh,
        serviceTextEn: source.serviceTextEn,
        foregroundColor: source.foregroundColor,
        accentColor: source.accentColor,
        overlayOpacity: source.overlayOpacity,
    };
}
function posterDraftError(draft: PosterDraft) {
    if (
        ![
            draft.name,
            draft.titleZh,
            draft.titleEn,
            draft.headlineZh,
            draft.headlineEn,
            draft.rewardTextZh,
            draft.rewardTextEn,
            draft.siteIntroZh,
            draft.siteIntroEn,
            draft.serviceTextZh,
            draft.serviceTextEn,
        ].every(value => value.trim())
    )
        return '模板名称和中英文文案均不能为空';
    if (!Number.isInteger(draft.position)) return '排序必须是整数';
    if (!Number.isInteger(draft.overlayOpacity) || draft.overlayOpacity < 0 || draft.overlayOpacity > 80)
        return '遮罩透明度必须是0到80的整数';
    return '';
}
function signedMoney(value: string, currency: string, allowNegative: boolean) {
    const number = Number(value);
    if (!Number.isFinite(number) || (!allowNegative && number <= 0)) return null;
    const absolute = majorInputToMoney(String(Math.abs(number)), currency);
    return absolute == null ? null : number < 0 ? -absolute : absolute;
}
function statusLabel(value: string) {
    return (
        (
            {
                PENDING: '待处理',
                APPROVED: '已批准',
                PAID: '已打款',
                REJECTED: '已驳回',
                CANCELLED: '已取消',
                AVAILABLE: '已生效',
                PARTIALLY_REVERSED: '部分扣回',
                REVERSED: '已扣回',
            } as Record<string, string>
        )[value] ?? value
    );
}
function posterLabel(value: string) {
    return (
        (
            {
                BRAND_MINIMAL: '品牌简约',
                BENEFIT_RED_GOLD: '红金礼遇',
                PRODUCT_STORY: '生活故事',
                PREMIUM_DARK: '鎏金深色',
            } as Record<string, string>
        )[value] ?? value
    );
}
function withdrawalActionLabel(status: WithdrawalAction['status']) {
    return (
        { APPROVED: '批准申请', PAID: '登记已打款', REJECTED: '驳回申请', CANCELLED: '取消申请' } as Record<
            string,
            string
        >
    )[status];
}
function withdrawalSuccess(status: WithdrawalAction['status']) {
    return (
        {
            APPROVED: '提款申请已批准，等待线下打款',
            PAID: '外部打款已登记，冻结余额已扣除',
            REJECTED: '提款申请已驳回，冻结金额已退回可用余额',
            CANCELLED: '提款申请已取消，冻结金额已退回可用余额',
        } as Record<string, string>
    )[status];
}
function errorText(error: unknown) {
    return toUserFacingError(error, '操作失败，请稍后重试');
}
