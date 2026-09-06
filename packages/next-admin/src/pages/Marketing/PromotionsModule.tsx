import { useMutation, useQuery } from '@apollo/client/react';
import {
    BadgePercent,
    Flame,
    Plus,
    RefreshCw,
    Search,
    Settings2,
    ShieldAlert,
    TrendingUp,
    X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import {
    ARCHIVE_COUPON_CAMPAIGN_MUTATION,
    COUPON_DAILY_REPORT_QUERY,
    COUPON_LEDGER_QUERY,
    CouponDailyMetricRecord,
    CouponLedgerRecord,
    DELETE_STORE_PROMOTION_MUTATION,
    MARKETING_OVERVIEW_QUERY,
    MarketingOverviewResult,
    REVOKE_COUPON_CAMPAIGN_MUTATION,
    SET_PROMOTION_ENABLED_MUTATION,
    STOP_COUPON_ISSUANCE_MUTATION,
    StoreCouponRecord,
    UPDATE_PROMOTION_NAME_MUTATION,
} from '../../graphql/marketing.graphql';
import { usePageSize } from '../../hooks/use-page-size';
import { useUrlTab } from '../../hooks/use-url-tab';
import { formatMoney } from '../Sales/sales-utils';
import { GenericPromotionsPanel } from './GenericPromotionsPanel';
import { NameDialog, SensitiveDialog } from './promotion-actions';
import { CampaignDetailDialog } from './promotion-details';
import { CouponEditor, FlashEditor, GrantCouponDialog } from './promotion-editors';
import { CouponList, FlashSaleList } from './promotion-lists';
import {
    CampaignDetail,
    couponIsActive,
    CouponVisibility,
    defaultReportFilter,
    errorText,
    formatRate,
    reportDateEnd,
    reportDateStart,
    SensitiveAction,
    sensitiveSuccessMessage,
    sum,
    validReportFilter,
} from './promotion-model';
import { CouponLedger, CouponReport } from './promotion-reports';
import { ErrorState, LoadingState, Message, OverviewMetric, TabButton } from './promotion-ui';

type PromotionTab = 'COUPONS' | 'FLASH_SALES' | 'REPORT' | 'LEDGER' | 'GENERIC';

const PROMOTION_TABS = {
    coupons: 'COUPONS',
    'flash-sales': 'FLASH_SALES',
    report: 'REPORT',
    ledger: 'LEDGER',
    generic: 'GENERIC',
} as const;

export function PromotionsModule() {
    const [activeTab, setActiveTab] = useUrlTab<PromotionTab>(PROMOTION_TABS, 'coupons');
    const [searchTerm, setSearchTerm] = useState('');
    const [couponEditorOpen, setCouponEditorOpen] = useState(false);
    const [flashEditorOpen, setFlashEditorOpen] = useState(false);
    const [sensitiveAction, setSensitiveAction] = useState<SensitiveAction | null>(null);
    const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
    const [granting, setGranting] = useState<StoreCouponRecord | null>(null);
    const [viewing, setViewing] = useState<CampaignDetail | null>(null);
    const [couponVisibility, setCouponVisibility] = useState<CouponVisibility>('CURRENT');
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');
    const [ledgerPage, setLedgerPage] = useState(0);
    const [pageSize, setPageSize] = usePageSize(setLedgerPage);
    const [ledgerCampaign, setLedgerCampaign] = useState('ALL');
    const [ledgerEvent, setLedgerEvent] = useState('ALL');
    const [reportFilter, setReportFilter] = useState(defaultReportFilter);
    const [, setStatusClock] = useState(() => Date.now());

    useEffect(() => {
        const timer = window.setInterval(() => setStatusClock(Date.now()), 60_000);
        return () => window.clearInterval(timer);
    }, []);

    const overview = useQuery<MarketingOverviewResult>(MARKETING_OVERVIEW_QUERY, {
        fetchPolicy: 'cache-and-network',
    });
    const coupons = overview.data?.storeCouponCampaigns ?? [];
    const flashSales = overview.data?.storeFlashSales ?? [];
    const currencyCode = overview.data?.activeChannel.defaultCurrencyCode ?? 'CNY';
    const ledger = useQuery<{ storeCouponLedger: { items: CouponLedgerRecord[]; totalItems: number } }>(
        COUPON_LEDGER_QUERY,
        {
            variables: {
                options: {
                    skip: ledgerPage * pageSize,
                    take: pageSize,
                    campaignId: ledgerCampaign === 'ALL' ? null : ledgerCampaign,
                    eventType: ledgerEvent === 'ALL' ? null : ledgerEvent,
                },
            },
            skip: activeTab !== 'LEDGER',
            fetchPolicy: 'cache-and-network',
        },
    );
    const report = useQuery<{ storeCouponDailyReport: CouponDailyMetricRecord[] }>(
        COUPON_DAILY_REPORT_QUERY,
        {
            variables: {
                from: reportDateStart(reportFilter.from),
                to: reportDateEnd(reportFilter.to),
                campaignId: reportFilter.campaignId === 'ALL' ? null : reportFilter.campaignId,
            },
            skip: activeTab !== 'REPORT' || !validReportFilter(reportFilter),
            fetchPolicy: 'cache-and-network',
        },
    );

    const [setEnabled, enabledState] = useMutation(SET_PROMOTION_ENABLED_MUTATION);
    const [stopIssuance, stopState] = useMutation(STOP_COUPON_ISSUANCE_MUTATION);
    const [archiveCoupon, archiveState] = useMutation(ARCHIVE_COUPON_CAMPAIGN_MUTATION);
    const [revokeOutstanding, revokeState] = useMutation(REVOKE_COUPON_CAMPAIGN_MUTATION);
    const [deletePromotion, deleteState] = useMutation<{
        deleteStorePromotion: { result: string; message?: string | null };
    }>(DELETE_STORE_PROMOTION_MUTATION);
    const [updateName, renameState] = useMutation(UPDATE_PROMOTION_NAME_MUTATION);
    const actionPending =
        enabledState.loading ||
        stopState.loading ||
        archiveState.loading ||
        revokeState.loading ||
        deleteState.loading;

    const refreshAll = async () => {
        setActionError('');
        await Promise.all([overview.refetch(), ledger.refetch(), report.refetch()]);
    };

    const openSensitiveAction = (action: SensitiveAction) => {
        setNotice('');
        setActionError('');
        setSensitiveAction(action);
    };

    const executeSensitiveAction = async (password: string, reason: string) => {
        if (!sensitiveAction) return;
        setNotice('');
        setActionError('');
        try {
            if (sensitiveAction.kind === 'TOGGLE')
                await setEnabled({
                    variables: { id: sensitiveAction.id, enabled: sensitiveAction.enabled, password },
                });
            if (sensitiveAction.kind === 'STOP')
                await stopIssuance({ variables: { id: sensitiveAction.id, password } });
            if (sensitiveAction.kind === 'REVOKE')
                await revokeOutstanding({
                    variables: {
                        id: sensitiveAction.id,
                        password,
                        reason: reason.trim() || '管理员在营销后台批量作废未使用优惠券',
                    },
                });
            if (sensitiveAction.kind === 'ARCHIVE')
                await archiveCoupon({ variables: { id: sensitiveAction.id, password } });
            if (sensitiveAction.kind === 'DELETE') {
                const response = await deletePromotion({
                    variables: { id: sensitiveAction.id, password },
                });
                const deletion = response.data?.deleteStorePromotion;
                if (!deletion || deletion.result !== 'DELETED') {
                    throw new Error(deletion?.message || '后端拒绝删除该营销活动');
                }
            }
            setNotice(sensitiveSuccessMessage(sensitiveAction));
            setSensitiveAction(null);
            await refreshAll();
        } catch (error) {
            setNotice('');
            setActionError(errorText(error));
        }
    };

    const saveName = async (name: string) => {
        if (!renaming || !name.trim()) return;
        try {
            await updateName({ variables: { id: renaming.id, name: name.trim() } });
            setRenaming(null);
            setNotice('活动名称已更新');
            await overview.refetch();
        } catch (error) {
            setActionError(errorText(error));
        }
    };

    const archivedCouponCount = coupons.filter(item => item.archivedAt).length;
    const currentCoupons = coupons.filter(item => !item.archivedAt);
    const visibleCoupons = coupons.filter(item => {
        const matchesSearch =
            !searchTerm.trim() ||
            `${item.name} ${item.couponCode}`.toLowerCase().includes(searchTerm.trim().toLowerCase());
        if (!matchesSearch) return false;
        if (couponVisibility === 'CURRENT') return !item.archivedAt;
        if (couponVisibility === 'ARCHIVED') return Boolean(item.archivedAt);
        if (couponVisibility === 'ACTIVE') return !item.archivedAt && couponIsActive(item);
        if (couponVisibility === 'ENDED') return !item.archivedAt && !couponIsActive(item);
        return true;
    });
    const visibleFlashSales = flashSales.filter(
        item => !searchTerm.trim() || item.name.toLowerCase().includes(searchTerm.trim().toLowerCase()),
    );

    return (
        <div className="flex h-full flex-col bg-slate-50">
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
                <div className="mx-auto flex w-full max-w-none flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                            优惠与促销
                            <FeatureHelpButton topic="marketing.promotions" title="优惠与促销" />
                        </h1>
                        <p className="mt-1 text-xs text-slate-500">
                            优惠券、限时秒杀、经营报表和客户使用流水统一管理
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => void refreshAll()}
                            disabled={overview.loading}
                            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50"
                        >
                            <RefreshCw className={`h-3.5 w-3.5 ${overview.loading ? 'animate-spin' : ''}`} />
                            刷新
                        </button>
                        {activeTab === 'COUPONS' && (
                            <button
                                type="button"
                                onClick={() => setCouponEditorOpen(true)}
                                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700"
                            >
                                <Plus className="h-3.5 w-3.5" />
                                新建优惠券
                            </button>
                        )}
                        {activeTab === 'FLASH_SALES' && (
                            <button
                                type="button"
                                onClick={() => setFlashEditorOpen(true)}
                                className="flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-orange-700"
                            >
                                <Plus className="h-3.5 w-3.5" />
                                新建秒杀
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
                {actionError && !sensitiveAction && (
                    <Message kind="error" onClose={() => setActionError('')}>
                        {actionError}
                    </Message>
                )}
                <section className="grid overflow-hidden rounded-xl border border-slate-200 bg-white sm:grid-cols-2 xl:grid-cols-4">
                    <OverviewMetric
                        label="优惠券活动"
                        value={`${currentCoupons.length} 个`}
                        detail={`${currentCoupons.filter(couponIsActive).length} 个正在发放·${archivedCouponCount} 个已归档`}
                    />
                    <OverviewMetric
                        label="累计领取"
                        value={`${sum(coupons, 'claimedCount')} 张`}
                        detail={`${sum(coupons, 'availableCount')} 张当前可用`}
                    />
                    <OverviewMetric
                        label="优惠券使用率"
                        value={formatRate(sum(coupons, 'usedCount'), sum(coupons, 'claimedCount'))}
                        detail={`${sum(coupons, 'usedCount')} 张已核销`}
                    />
                    <OverviewMetric
                        label="优惠券带动成交"
                        value={formatMoney(sum(coupons, 'assistedRevenueTotal'), currencyCode)}
                        detail={`优惠金额 ${formatMoney(sum(coupons, 'discountAmountTotal'), currencyCode)}`}
                    />
                </section>
                <nav className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 text-xs shadow-2xs">
                    <TabButton
                        active={activeTab === 'COUPONS'}
                        onClick={() => setActiveTab('COUPONS')}
                        icon={BadgePercent}
                        label={`优惠券 ${coupons.length}`}
                    />
                    <TabButton
                        active={activeTab === 'FLASH_SALES'}
                        onClick={() => setActiveTab('FLASH_SALES')}
                        icon={Flame}
                        label={`限时秒杀 ${flashSales.length}`}
                    />
                    <TabButton
                        active={activeTab === 'REPORT'}
                        onClick={() => setActiveTab('REPORT')}
                        icon={TrendingUp}
                        label="经营报表"
                    />
                    <TabButton
                        active={activeTab === 'LEDGER'}
                        onClick={() => setActiveTab('LEDGER')}
                        icon={ShieldAlert}
                        label="使用流水"
                    />
                    <TabButton
                        active={activeTab === 'GENERIC'}
                        onClick={() => setActiveTab('GENERIC')}
                        icon={Settings2}
                        label="通用促销"
                    />
                </nav>
                {(activeTab === 'COUPONS' || activeTab === 'FLASH_SALES') && (
                    <div className="flex max-w-2xl flex-col gap-2 sm:flex-row">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                            <input
                                type="search"
                                name="promotion-search"
                                autoComplete="off"
                                value={searchTerm}
                                onChange={event => setSearchTerm(event.target.value)}
                                aria-label="搜索营销活动"
                                placeholder="搜索活动名称或券码"
                                className="w-full appearance-none rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-9 text-xs outline-none focus:border-blue-500"
                            />
                            {searchTerm && (
                                <button
                                    type="button"
                                    onClick={() => setSearchTerm('')}
                                    className="absolute right-2.5 top-2 text-slate-400"
                                    aria-label="清空搜索"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            )}
                        </div>
                        {activeTab === 'COUPONS' && (
                            <select
                                value={couponVisibility}
                                onChange={event =>
                                    setCouponVisibility(event.target.value as CouponVisibility)
                                }
                                aria-label="筛选优惠券活动"
                                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700"
                            >
                                <option value="CURRENT">未归档（默认）</option>
                                <option value="ACTIVE">正在发放</option>
                                <option value="ENDED">已结束</option>
                                <option value="ARCHIVED">已归档</option>
                                <option value="ALL">全部活动</option>
                            </select>
                        )}
                    </div>
                )}

                {activeTab === 'GENERIC' ? (
                    <GenericPromotionsPanel />
                ) : overview.loading && !overview.data ? (
                    <LoadingState label="正在读取营销活动…" />
                ) : overview.error ? (
                    <ErrorState message={overview.error.message} onRetry={() => void overview.refetch()} />
                ) : activeTab === 'COUPONS' ? (
                    <CouponList
                        coupons={visibleCoupons}
                        currencyCode={currencyCode}
                        actionPending={actionPending}
                        onCreate={() => setCouponEditorOpen(true)}
                        onCopy={async code => {
                            try {
                                await navigator.clipboard.writeText(code);
                                setNotice('优惠券内部兑换码已复制');
                            } catch {
                                setActionError('浏览器未允许访问剪贴板，请手动复制');
                            }
                        }}
                        onGrant={setGranting}
                        onView={item => setViewing({ type: 'COUPON', item })}
                        onRename={setRenaming}
                        onSensitive={openSensitiveAction}
                    />
                ) : activeTab === 'FLASH_SALES' ? (
                    <FlashSaleList
                        sales={visibleFlashSales}
                        actionPending={actionPending}
                        onCreate={() => setFlashEditorOpen(true)}
                        onRename={setRenaming}
                        onView={item => setViewing({ type: 'FLASH_SALE', item })}
                        onSensitive={openSensitiveAction}
                    />
                ) : activeTab === 'REPORT' ? (
                    <CouponReport
                        coupons={coupons}
                        currencyCode={currencyCode}
                        filter={reportFilter}
                        setFilter={setReportFilter}
                        metrics={report.data?.storeCouponDailyReport ?? []}
                        loading={report.loading}
                        error={report.error?.message}
                    />
                ) : (
                    <CouponLedger
                        pageSize={pageSize}
                        onPageSizeChange={setPageSize}
                        coupons={coupons}
                        currencyCode={currencyCode}
                        page={ledgerPage}
                        setPage={setLedgerPage}
                        campaign={ledgerCampaign}
                        setCampaign={value => {
                            setLedgerCampaign(value);
                            setLedgerPage(0);
                        }}
                        event={ledgerEvent}
                        setEvent={value => {
                            setLedgerEvent(value);
                            setLedgerPage(0);
                        }}
                        data={ledger.data?.storeCouponLedger}
                        loading={ledger.loading}
                        error={ledger.error?.message}
                        onRetry={() => void ledger.refetch()}
                    />
                )}
            </main>

            {couponEditorOpen && overview.data && (
                <CouponEditor
                    currencyCode={currencyCode}
                    onClose={() => setCouponEditorOpen(false)}
                    onSaved={async () => {
                        setCouponEditorOpen(false);
                        setNotice('优惠券活动已创建并开始按排期生效');
                        await refreshAll();
                    }}
                    onError={setActionError}
                />
            )}
            {flashEditorOpen && overview.data && (
                <FlashEditor
                    currencyCode={currencyCode}
                    onClose={() => setFlashEditorOpen(false)}
                    onSaved={async () => {
                        setFlashEditorOpen(false);
                        setNotice('秒杀活动已创建，结算价格将按排期生效');
                        await refreshAll();
                    }}
                    onError={setActionError}
                />
            )}
            {sensitiveAction && (
                <SensitiveDialog
                    action={sensitiveAction}
                    pending={actionPending}
                    error={actionError}
                    onClose={() => {
                        setSensitiveAction(null);
                        setActionError('');
                    }}
                    onConfirm={executeSensitiveAction}
                />
            )}
            {renaming && (
                <NameDialog
                    value={renaming.name}
                    pending={renameState.loading}
                    onClose={() => setRenaming(null)}
                    onConfirm={saveName}
                />
            )}
            {granting && (
                <GrantCouponDialog
                    coupon={granting}
                    pending={false}
                    onClose={() => setGranting(null)}
                    onSaved={async () => {
                        setGranting(null);
                        setNotice('优惠券已发放到客户账户');
                        await refreshAll();
                    }}
                    onError={setActionError}
                />
            )}
            {viewing && (
                <CampaignDetailDialog
                    campaign={viewing}
                    currencyCode={currencyCode}
                    onClose={() => setViewing(null)}
                />
            )}
        </div>
    );
}
export { SensitiveDialog } from './promotion-actions';
export { CampaignDetailDialog } from './promotion-details';
