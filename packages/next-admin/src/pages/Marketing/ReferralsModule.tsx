import { useMutation, useQuery } from '@apollo/client/react';
import {
    CircleDollarSign,
    Gift,
    Plus,
    RefreshCw,
    Save,
    Search,
    Settings2,
    Users,
    WalletCards,
    X,
} from 'lucide-react';
import { useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import {
    REFERRAL_PROGRAM_QUERY,
    REFERRAL_REPORTS_QUERY,
    ReferralProgramRecord,
    ReferralProgramResult,
    ReferralReportsResult,
    UPDATE_REFERRAL_PROGRAM_MUTATION,
} from '../../graphql/marketing.graphql';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { usePageSize } from '../../hooks/use-page-size';
import { useUrlTab } from '../../hooks/use-url-tab';
import { majorInputToMoney } from '../Sales/sales-utils';
import { ErrorState, LoadingState, Message, TabButton } from '../Settings/settings-ui';
import { FinancialDialog, WithdrawalActionDialog } from './ReferralDialogs';
import {
    LedgerPanel,
    ProgramSettings,
    PromotersPanel,
    RewardsPanel,
    TodayOverview,
    WithdrawalsPanel,
} from './ReferralPanels';
import { ReferralHeading, errorText, programDraft, programDraftError } from './referral-ui';
import { ProgramDraft, ReferralTab, ReportKey, WithdrawalAction } from './referrals-types';

const REFERRAL_TABS = {
    settings: 'SETTINGS',
    promoters: 'PROMOTERS',
    rewards: 'REWARDS',
    ledger: 'LEDGER',
    withdrawals: 'WITHDRAWALS',
} as const;

export function ReferralsModule() {
    const [params] = useSearchParams();
    if (params.get('tab') === 'posters') return <Navigate to="/marketing/sharing" replace />;
    return <ReferralManagement />;
}

function ReferralManagement() {
    const { hasAnyPermission } = useAdminPermissions();
    const canUpdate = hasAnyPermission(['UpdateReferral']);
    const canWithdraw = hasAnyPermission(['ManageReferralWithdrawal']);
    const canAdjust = hasAnyPermission(['AdjustReferralBalance']);
    const canReadCustomers = hasAnyPermission(['ReadCustomer']);
    const [activeTab, setActiveTab] = useUrlTab<ReferralTab>(REFERRAL_TABS, 'settings');
    const [skips, setSkips] = useState<Record<ReportKey, number>>({
        summaries: 0,
        relationships: 0,
        rewards: 0,
        ledger: 0,
        withdrawals: 0,
    });
    const [pageSize, setPageSize] = usePageSize(() =>
        setSkips({ summaries: 0, relationships: 0, rewards: 0, ledger: 0, withdrawals: 0 }),
    );
    const [draftOverride, setDraftOverride] = useState<ProgramDraft | null>(null);
    const [search, setSearch] = useState('');
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');
    const [withdrawalAction, setWithdrawalAction] = useState<WithdrawalAction | null>(null);
    const [financialDialog, setFinancialDialog] = useState<'WITHDRAW' | 'ADJUST' | null>(null);

    const program = useQuery<ReferralProgramResult>(REFERRAL_PROGRAM_QUERY, {
        fetchPolicy: 'cache-and-network',
        pollInterval: 60_000,
    });
    const reports = useQuery<ReferralReportsResult>(REFERRAL_REPORTS_QUERY, {
        variables: {
            take: pageSize,
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
        if (!canUpdate || !draft) return;
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
                <div className="mx-auto flex w-full max-w-none flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <ReferralHeading />
                    <div className="flex flex-wrap gap-2">
                        <Link
                            to="/marketing/sharing"
                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700"
                        >
                            分享设置
                        </Link>
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
                        {activeTab === 'WITHDRAWALS' && canWithdraw && (
                            <button
                                type="button"
                                disabled={!canReadCustomers}
                                title={canReadCustomers ? undefined : '需要客户读取权限才能选择客户'}
                                onClick={() => setFinancialDialog('WITHDRAW')}
                                className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white"
                            >
                                <Plus className="h-3.5 w-3.5" />
                                代客发起提款
                            </button>
                        )}
                        {activeTab === 'LEDGER' && canAdjust && (
                            <button
                                type="button"
                                disabled={!canReadCustomers}
                                title={canReadCustomers ? undefined : '需要客户读取权限才能选择客户'}
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
                                disabled={!canUpdate || !draft || !isDirty || updateState.loading}
                                className="flex items-center gap-1 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
                            >
                                <Save className="h-3.5 w-3.5" />
                                {updateState.loading ? '保存中…' : '保存设置'}
                            </button>
                        )}
                    </div>
                </div>
            </header>
            <main className="mx-auto w-full max-w-none flex-1 space-y-4 overflow-y-auto p-5 sm:p-8">
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
                    <LoadingState />
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
                                    icon={<Settings2 className="h-3.5 w-3.5" />}
                                >
                                    功能设置
                                </TabButton>
                                <TabButton
                                    active={activeTab === 'PROMOTERS'}
                                    onClick={() => {
                                        setActiveTab('PROMOTERS');
                                        setSearch('');
                                    }}
                                    icon={<Users className="h-3.5 w-3.5" />}
                                >
                                    {`推广员 ${reports.data?.referralInviterSummaries.totalItems ?? 0}`}
                                </TabButton>
                                <TabButton
                                    active={activeTab === 'REWARDS'}
                                    onClick={() => {
                                        setActiveTab('REWARDS');
                                        setSearch('');
                                    }}
                                    icon={<Gift className="h-3.5 w-3.5" />}
                                >
                                    {`返利订单 ${reports.data?.referralRewards.totalItems ?? 0}`}
                                </TabButton>
                                <TabButton
                                    active={activeTab === 'LEDGER'}
                                    onClick={() => {
                                        setActiveTab('LEDGER');
                                        setSearch('');
                                    }}
                                    icon={<WalletCards className="h-3.5 w-3.5" />}
                                >
                                    钱包流水
                                </TabButton>
                                <TabButton
                                    active={activeTab === 'WITHDRAWALS'}
                                    onClick={() => {
                                        setActiveTab('WITHDRAWALS');
                                        setSearch('');
                                    }}
                                    icon={<CircleDollarSign className="h-3.5 w-3.5" />}
                                >
                                    {`提款 ${reports.data?.referralWithdrawals.totalItems ?? 0}`}
                                </TabButton>
                            </nav>
                            {activeTab !== 'SETTINGS' && (
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
                                <fieldset disabled={!canUpdate}>
                                    <ProgramSettings
                                        draft={draft}
                                        setDraft={setDraft}
                                        currencyCode={currencyCode}
                                    />
                                </fieldset>
                            )}
                            {activeTab === 'PROMOTERS' && (
                                <PromotersPanel
                                    pageSize={pageSize}
                                    onPageSizeChange={setPageSize}
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
                                    pageSize={pageSize}
                                    onPageSizeChange={setPageSize}
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
                                    pageSize={pageSize}
                                    onPageSizeChange={setPageSize}
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
                                    pageSize={pageSize}
                                    onPageSizeChange={setPageSize}
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
                        </>
                    )
                )}
            </main>
            {withdrawalAction && canWithdraw && (
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
            {financialDialog && (financialDialog === 'WITHDRAW' ? canWithdraw : canAdjust) && (
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
        </div>
    );
}
