import { useMutation, useQuery } from '@apollo/client/react';
import {
    AlertCircle,
    BadgePercent,
    Ban,
    Check,
    ChevronLeft,
    ChevronRight,
    Copy,
    Download,
    Edit3,
    Flame,
    LoaderCircle,
    Plus,
    RefreshCw,
    Search,
    Send,
    ShieldAlert,
    Trash2,
    TrendingUp,
    X,
} from 'lucide-react';
import { useDeferredValue, useEffect, useState } from 'react';
import {
    COUPON_DAILY_REPORT_QUERY,
    COUPON_LEDGER_QUERY,
    CREATE_COUPON_CAMPAIGN_MUTATION,
    CREATE_FLASH_SALE_MUTATION,
    CouponDailyMetricRecord,
    CouponLedgerRecord,
    DELETE_STORE_PROMOTION_MUTATION,
    GRANT_STORE_COUPON_MUTATION,
    MARKETING_CATALOG_LOOKUP_QUERY,
    MARKETING_CUSTOMER_LOOKUP_QUERY,
    MARKETING_OVERVIEW_QUERY,
    MarketingOverviewResult,
    PromotionProductRecord,
    REVOKE_COUPON_CAMPAIGN_MUTATION,
    SET_PROMOTION_ENABLED_MUTATION,
    STOP_COUPON_ISSUANCE_MUTATION,
    StoreCouponKind,
    StoreCouponRecord,
    StoreFlashSaleRecord,
    UPDATE_PROMOTION_NAME_MUTATION,
} from '../../graphql/marketing.graphql';
import { useAccessibleDialog } from '../../hooks/use-accessible-dialog';
import { useUrlTab } from '../../hooks/use-url-tab';
import { toUserFacingError } from '../../utils/user-facing-error';
import { formatDateTime, formatMoney, majorInputToMoney } from '../Sales/sales-utils';

type PromotionTab = 'COUPONS' | 'FLASH_SALES' | 'REPORT' | 'LEDGER';
const PROMOTION_TABS = {
    coupons: 'COUPONS',
    'flash-sales': 'FLASH_SALES',
    report: 'REPORT',
    ledger: 'LEDGER',
} as const;
type SensitiveAction =
    | { kind: 'TOGGLE'; id: string; name: string; enabled: boolean }
    | { kind: 'STOP'; id: string; name: string }
    | { kind: 'REVOKE'; id: string; name: string; affectedCount: number }
    | { kind: 'DELETE'; id: string; name: string; subject: '优惠券' | '秒杀' };

interface CouponDraft {
    name: string;
    kind: StoreCouponKind;
    minimumSpend: string;
    discountValue: string;
    startsAt: string;
    endsAt: string;
    claimStartsAt: string;
    claimEndsAt: string;
    validityDays: string;
    issueLimit: string;
    stackPolicy: 'EXCLUSIVE' | 'STACKABLE';
    returnOnCancellation: boolean;
    returnOnFullRefund: boolean;
    collectionIds: string[];
    productIds: string[];
}

interface FlashDraft {
    name: string;
    percentageOff: string;
    startsAt: string;
    endsAt: string;
    productIds: string[];
    variantPrices: Record<string, string>;
}

const couponKindLabels: Record<StoreCouponKind, string> = {
    ORDER_FIXED: '满减券',
    ORDER_PERCENTAGE: '订单折扣券',
    COLLECTION_PERCENTAGE: '分类折扣券',
    PRODUCT_PERCENTAGE: '单品折扣券',
};
const ledgerLabels: Record<string, string> = {
    CLAIMED: '已领取',
    LOCKED: '订单锁定',
    RELEASED: '已释放',
    REDEEMED: '已核销',
    RETURNED: '已返还',
    EXPIRED: '已过期',
    REVOKED: '已作废',
    REFUND_SETTLED: '退款完成',
};
const PAGE_SIZE = 50;

export function PromotionsModule() {
    const [activeTab, setActiveTab] = useUrlTab<PromotionTab>(PROMOTION_TABS, 'coupons');
    const [searchTerm, setSearchTerm] = useState('');
    const [couponEditorOpen, setCouponEditorOpen] = useState(false);
    const [flashEditorOpen, setFlashEditorOpen] = useState(false);
    const [sensitiveAction, setSensitiveAction] = useState<SensitiveAction | null>(null);
    const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
    const [granting, setGranting] = useState<StoreCouponRecord | null>(null);
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');
    const [ledgerPage, setLedgerPage] = useState(0);
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
                    skip: ledgerPage * PAGE_SIZE,
                    take: PAGE_SIZE,
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
    const [revokeOutstanding, revokeState] = useMutation(REVOKE_COUPON_CAMPAIGN_MUTATION);
    const [deletePromotion, deleteState] = useMutation<{
        deleteStorePromotion: { result: string; message?: string | null };
    }>(DELETE_STORE_PROMOTION_MUTATION);
    const [updateName, renameState] = useMutation(UPDATE_PROMOTION_NAME_MUTATION);
    const actionPending =
        enabledState.loading || stopState.loading || revokeState.loading || deleteState.loading;

    const refreshAll = async () => {
        setActionError('');
        await Promise.all([overview.refetch(), ledger.refetch(), report.refetch()]);
    };

    const executeSensitiveAction = async (password: string, reason: string) => {
        if (!sensitiveAction) return;
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

    const visibleCoupons = coupons.filter(
        item =>
            !searchTerm.trim() ||
            `${item.name} ${item.couponCode}`.toLowerCase().includes(searchTerm.trim().toLowerCase()),
    );
    const visibleFlashSales = flashSales.filter(
        item => !searchTerm.trim() || item.name.toLowerCase().includes(searchTerm.trim().toLowerCase()),
    );

    return (
        <div className="flex h-full flex-col bg-slate-50">
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
                <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="text-xl font-bold text-slate-900">优惠与促销</h1>
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
            <main className="mx-auto w-full max-w-[1500px] flex-1 space-y-4 overflow-y-auto p-5 sm:p-8">
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
                <section className="grid overflow-hidden rounded-xl border border-slate-200 bg-white sm:grid-cols-2 xl:grid-cols-4">
                    <OverviewMetric
                        label="优惠券活动"
                        value={`${coupons.length} 个`}
                        detail={`${coupons.filter(couponIsActive).length} 个正在发放`}
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
                </nav>
                {(activeTab === 'COUPONS' || activeTab === 'FLASH_SALES') && (
                    <div className="relative max-w-md">
                        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                        <input
                            value={searchTerm}
                            onChange={event => setSearchTerm(event.target.value)}
                            aria-label="搜索营销活动"
                            placeholder="搜索活动名称或券码"
                            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-9 text-xs outline-none focus:border-blue-500"
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
                )}

                {overview.loading && !overview.data ? (
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
                        onRename={setRenaming}
                        onSensitive={setSensitiveAction}
                    />
                ) : activeTab === 'FLASH_SALES' ? (
                    <FlashSaleList
                        sales={visibleFlashSales}
                        actionPending={actionPending}
                        onCreate={() => setFlashEditorOpen(true)}
                        onRename={setRenaming}
                        onSensitive={setSensitiveAction}
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
                    onClose={() => setSensitiveAction(null)}
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
        </div>
    );
}

function CouponList({
    coupons,
    currencyCode,
    actionPending,
    onCreate,
    onCopy,
    onGrant,
    onRename,
    onSensitive,
}: {
    coupons: StoreCouponRecord[];
    currencyCode: string;
    actionPending: boolean;
    onCreate: () => void;
    onCopy: (code: string) => void;
    onGrant: (coupon: StoreCouponRecord) => void;
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
                                onClick={() => onGrant(coupon)}
                                className="flex items-center gap-1 rounded-lg bg-blue-50 px-3 py-2 font-bold text-blue-700 hover:bg-blue-100"
                            >
                                <Send className="h-3.5 w-3.5" />
                                指定发券
                            </button>
                            <button
                                type="button"
                                onClick={() => onRename({ id: coupon.id, name: coupon.name })}
                                className="rounded-lg border border-slate-300 bg-white p-2 text-slate-600 hover:bg-slate-50"
                                aria-label="修改名称"
                            >
                                <Edit3 className="h-4 w-4" />
                            </button>
                            {couponIsActive(coupon) && (
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
                            {coupon.availableCount > 0 && (
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
                        </div>
                    </div>
                </article>
            ))}
        </div>
    );
}

function FlashSaleList({
    sales,
    actionPending,
    onCreate,
    onRename,
    onSensitive,
}: {
    sales: StoreFlashSaleRecord[];
    actionPending: boolean;
    onCreate: () => void;
    onRename: (value: { id: string; name: string }) => void;
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

function CouponReport({
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
                    <h2 className="text-sm font-bold text-slate-900">优惠券经营报表</h2>
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
                        <table className="w-full min-w-[760px] text-left text-xs">
                            <thead className="border-y border-slate-200 bg-slate-50 text-slate-500">
                                <tr>
                                    <th className="p-3">日期</th>
                                    <th className="p-3">领取</th>
                                    <th className="p-3">核销</th>
                                    <th className="p-3">退款</th>
                                    <th className="p-3">返还/过期/作废</th>
                                    <th className="p-3">优惠金额</th>
                                    <th className="p-3">带动成交</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {metrics.map(item => (
                                    <tr key={item.date}>
                                        <td className="p-3 font-mono">{item.date}</td>
                                        <td className="p-3 font-mono">{item.claimedCount}</td>
                                        <td className="p-3 font-mono">{item.redeemedCount}</td>
                                        <td className="p-3 font-mono">{item.refundedCount}</td>
                                        <td className="p-3 font-mono">
                                            {item.returnedCount}/{item.expiredCount}/{item.revokedCount}
                                        </td>
                                        <td className="p-3 font-mono">
                                            {formatMoney(item.discountAmountTotal, currencyCode)}
                                        </td>
                                        <td className="p-3 font-mono font-bold text-emerald-600">
                                            {formatMoney(item.assistedRevenueTotal, currencyCode)}
                                        </td>
                                    </tr>
                                ))}
                                {!metrics.length && (
                                    <tr>
                                        <td colSpan={7} className="p-10 text-center text-slate-400">
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

function CouponLedger({
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
    const totalPages = Math.max(1, Math.ceil((data?.totalItems ?? 0) / PAGE_SIZE));
    return (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
            <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-sm font-bold text-slate-900">优惠券全生命周期流水</h2>
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
                        <table className="w-full min-w-[1000px] text-left text-xs">
                            <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                                <tr>
                                    <th className="p-3">时间</th>
                                    <th className="p-3">事件</th>
                                    <th className="p-3">优惠券</th>
                                    <th className="p-3">客户</th>
                                    <th className="p-3">订单</th>
                                    <th className="p-3">优惠金额</th>
                                    <th className="p-3">操作来源</th>
                                    <th className="p-3">备注</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {data?.items.map(item => (
                                    <tr key={item.id}>
                                        <td className="p-3 whitespace-nowrap text-[10px] text-slate-500">
                                            {formatDateTime(item.createdAt)}
                                        </td>
                                        <td className="p-3">
                                            <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                                                {ledgerLabels[item.eventType] ?? item.eventType}
                                            </span>
                                        </td>
                                        <td className="p-3 font-medium text-slate-900">
                                            {item.campaignName}
                                        </td>
                                        <td className="p-3">
                                            <div className="font-medium">{item.customerName}</div>
                                            <div className="text-[10px] text-slate-400">
                                                {item.customerEmail}
                                            </div>
                                        </td>
                                        <td className="p-3 font-mono text-blue-600">
                                            {item.orderCode ?? '—'}
                                        </td>
                                        <td className="p-3 font-mono">
                                            {item.discountAmount == null
                                                ? '—'
                                                : formatMoney(item.discountAmount, currencyCode)}
                                        </td>
                                        <td className="p-3 text-slate-500">{item.actorType}</td>
                                        <td
                                            className="max-w-52 truncate p-3 text-slate-500"
                                            title={item.note ?? ''}
                                        >
                                            {item.note ?? '—'}
                                        </td>
                                    </tr>
                                ))}
                                {!data?.items.length && (
                                    <tr>
                                        <td colSpan={8} className="p-10 text-center text-slate-400">
                                            当前条件下没有流水
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    <SimplePagination
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

function CouponEditor({
    currencyCode,
    onClose,
    onSaved,
    onError,
}: {
    currencyCode: string;
    onClose: () => void;
    onSaved: () => Promise<void>;
    onError: (message: string) => void;
}) {
    const [draft, setDraft] = useState<CouponDraft>(newCouponDraft());
    const [selectorSearch, setSelectorSearch] = useState('');
    const deferredSearch = useDeferredValue(selectorSearch.trim());
    const hasScope = draft.kind === 'COLLECTION_PERCENTAGE' || draft.kind === 'PRODUCT_PERCENTAGE';
    const catalog = useQuery<{
        collections: { totalItems: number; items: Array<{ id: string; name: string }> };
        products: { totalItems: number; items: PromotionProductRecord[] };
    }>(MARKETING_CATALOG_LOOKUP_QUERY, {
        variables: {
            collectionOptions: {
                take: draft.kind === 'COLLECTION_PERCENTAGE' ? 30 : 1,
                sort: { name: 'ASC' },
                filter:
                    draft.kind === 'COLLECTION_PERCENTAGE' && deferredSearch
                        ? { name: { contains: deferredSearch } }
                        : {},
            },
            productOptions: {
                take: draft.kind === 'PRODUCT_PERCENTAGE' ? 30 : 1,
                sort: { name: 'ASC' },
                filter:
                    draft.kind === 'PRODUCT_PERCENTAGE' && deferredSearch
                        ? { name: { contains: deferredSearch } }
                        : {},
            },
        },
        skip: !hasScope,
        fetchPolicy: 'cache-and-network',
    });
    const [create, state] = useMutation(CREATE_COUPON_CAMPAIGN_MUTATION);
    const validation = couponDraftError(draft);
    const submit = async () => {
        if (validation) return onError(validation);
        try {
            const minimumSpend = majorInputToMoney(draft.minimumSpend || '0', currencyCode);
            const discountAmount =
                draft.kind === 'ORDER_FIXED' ? majorInputToMoney(draft.discountValue, currencyCode) : null;
            if (minimumSpend == null || (draft.kind === 'ORDER_FIXED' && discountAmount == null))
                throw new Error('金额格式不正确');
            const optionalInt = (value: string) => (value.trim() ? Number.parseInt(value, 10) : null);
            await create({
                variables: {
                    input: {
                        name: draft.name.trim(),
                        kind: draft.kind,
                        minimumSpend,
                        discountAmount,
                        discountRate: draft.kind === 'ORDER_FIXED' ? null : Number(draft.discountValue),
                        collectionIds: draft.kind === 'COLLECTION_PERCENTAGE' ? draft.collectionIds : [],
                        productIds: draft.kind === 'PRODUCT_PERCENTAGE' ? draft.productIds : [],
                        startsAt: dateInput(draft.startsAt),
                        endsAt: dateInput(draft.endsAt),
                        usageLimit: optionalInt(draft.issueLimit),
                        perCustomerUsageLimit: 1,
                        claimStartsAt: dateInput(draft.claimStartsAt),
                        claimEndsAt: dateInput(draft.claimEndsAt),
                        validityDays: optionalInt(draft.validityDays),
                        issueLimit: optionalInt(draft.issueLimit),
                        perCustomerClaimLimit: 1,
                        stackPolicy: draft.stackPolicy,
                        returnOnCancellation: draft.returnOnCancellation,
                        returnOnFullRefund: draft.returnOnFullRefund,
                    },
                },
            });
            await onSaved();
        } catch (error) {
            onError(errorText(error));
        }
    };
    const scopedItems =
        draft.kind === 'COLLECTION_PERCENTAGE'
            ? (catalog.data?.collections.items ?? [])
            : (catalog.data?.products.items ?? []);
    const scopedTotal =
        draft.kind === 'COLLECTION_PERCENTAGE'
            ? (catalog.data?.collections.totalItems ?? 0)
            : (catalog.data?.products.totalItems ?? 0);
    const selectedIds = draft.kind === 'COLLECTION_PERCENTAGE' ? draft.collectionIds : draft.productIds;
    const updateSelected = (ids: string[]) =>
        setDraft(
            draft.kind === 'COLLECTION_PERCENTAGE'
                ? { ...draft, collectionIds: ids }
                : { ...draft, productIds: ids },
        );
    return (
        <Modal
            title="新建优惠券活动"
            description="先设置客户看得懂的规则，系统会自动生成内部兑换码并记录全生命周期流水。"
            onClose={onClose}
            width="max-w-3xl"
        >
            <div className="grid gap-4 sm:grid-cols-2">
                <FormInput
                    label="活动名称 *"
                    value={draft.name}
                    onChange={value => setDraft({ ...draft, name: value })}
                    placeholder="例如：新客首单满100减20"
                />
                <FormSelect
                    label="优惠类型 *"
                    value={draft.kind}
                    onChange={value => {
                        setSelectorSearch('');
                        setDraft({
                            ...draft,
                            kind: value as StoreCouponKind,
                            collectionIds: [],
                            productIds: [],
                        });
                    }}
                    options={Object.entries(couponKindLabels)}
                />
                <FormInput
                    label={`最低消费金额 (${currencyCode})`}
                    type="number"
                    value={draft.minimumSpend}
                    onChange={value => setDraft({ ...draft, minimumSpend: value })}
                />
                <FormInput
                    label={
                        draft.kind === 'ORDER_FIXED'
                            ? `减免金额 (${currencyCode}) *`
                            : '折扣（例如 8.5 表示八五折）*'
                    }
                    type="number"
                    value={draft.discountValue}
                    onChange={value => setDraft({ ...draft, discountValue: value })}
                />
                <DateInput
                    label="领取开始"
                    type="datetime-local"
                    value={draft.claimStartsAt}
                    onChange={value => setDraft({ ...draft, claimStartsAt: value, startsAt: value })}
                />
                <DateInput
                    label="领取结束"
                    type="datetime-local"
                    value={draft.claimEndsAt}
                    onChange={value => setDraft({ ...draft, claimEndsAt: value, endsAt: value })}
                />
                <FormInput
                    label="发放总量 *"
                    type="number"
                    value={draft.issueLimit}
                    onChange={value => setDraft({ ...draft, issueLimit: value })}
                />
                <FormInput
                    label="领取后有效天数 *"
                    type="number"
                    value={draft.validityDays}
                    onChange={value => setDraft({ ...draft, validityDays: value })}
                />
                <FormSelect
                    label="叠加策略"
                    value={draft.stackPolicy}
                    onChange={value =>
                        setDraft({ ...draft, stackPolicy: value as CouponDraft['stackPolicy'] })
                    }
                    options={[
                        ['EXCLUSIVE', '不可与其他优惠券叠加'],
                        ['STACKABLE', '允许叠加'],
                    ]}
                />
            </div>
            {(draft.kind === 'COLLECTION_PERCENTAGE' || draft.kind === 'PRODUCT_PERCENTAGE') && (
                <MultiSelector
                    title={draft.kind === 'COLLECTION_PERCENTAGE' ? '适用分类 *' : '适用商品 *'}
                    items={scopedItems}
                    totalItems={scopedTotal}
                    loading={catalog.loading}
                    error={catalog.error?.message}
                    selectedIds={selectedIds}
                    search={selectorSearch}
                    setSearch={setSelectorSearch}
                    onChange={updateSelected}
                />
            )}
            <div className="mt-4 space-y-2 rounded-xl bg-slate-50 p-3 text-xs">
                <label className="flex items-center justify-between gap-3">
                    <span>
                        <strong className="text-slate-800">订单取消时自动返券</strong>
                        <small className="block text-[10px] text-slate-400">
                            避免客户因取消未履约订单损失优惠券
                        </small>
                    </span>
                    <input
                        type="checkbox"
                        checked={draft.returnOnCancellation}
                        onChange={event => setDraft({ ...draft, returnOnCancellation: event.target.checked })}
                        className="h-4 w-4"
                    />
                </label>
                <label className="flex items-center justify-between gap-3">
                    <span>
                        <strong className="text-slate-800">全额退款后自动返券</strong>
                        <small className="block text-[10px] text-slate-400">部分退款不会自动返券</small>
                    </span>
                    <input
                        type="checkbox"
                        checked={draft.returnOnFullRefund}
                        onChange={event => setDraft({ ...draft, returnOnFullRefund: event.target.checked })}
                        className="h-4 w-4"
                    />
                </label>
            </div>
            {validation && <p className="mt-3 text-xs text-rose-600">{validation}</p>}
            <ModalFooter
                onCancel={onClose}
                onConfirm={() => void submit()}
                pending={state.loading}
                disabled={Boolean(validation)}
                confirmLabel="创建优惠券"
            />
        </Modal>
    );
}

function FlashEditor({
    currencyCode,
    onClose,
    onSaved,
    onError,
}: {
    currencyCode: string;
    onClose: () => void;
    onSaved: () => Promise<void>;
    onError: (message: string) => void;
}) {
    const [draft, setDraft] = useState<FlashDraft>(newFlashDraft());
    const [search, setSearch] = useState('');
    const [knownProducts, setKnownProducts] = useState<Record<string, PromotionProductRecord>>({});
    const deferredSearch = useDeferredValue(search.trim());
    const catalog = useQuery<{
        collections: { totalItems: number; items: Array<{ id: string; name: string }> };
        products: { totalItems: number; items: PromotionProductRecord[] };
    }>(MARKETING_CATALOG_LOOKUP_QUERY, {
        variables: {
            collectionOptions: { take: 1 },
            productOptions: {
                take: 30,
                sort: { name: 'ASC' },
                filter: deferredSearch ? { name: { contains: deferredSearch } } : {},
            },
        },
        fetchPolicy: 'cache-and-network',
    });
    const products = catalog.data?.products.items ?? [];
    const [create, state] = useMutation(CREATE_FLASH_SALE_MUTATION);
    const productMap = new Map(
        [...Object.values(knownProducts), ...products].map(product => [product.id, product]),
    );
    const selectedProducts = draft.productIds
        .map(id => productMap.get(id))
        .filter((product): product is PromotionProductRecord => Boolean(product));
    const validation = flashDraftError(draft, selectedProducts, currencyCode);
    const submit = async () => {
        if (validation) return onError(validation);
        try {
            const variantPrices = selectedProducts.flatMap(product =>
                product.variants.flatMap(variant => {
                    const value = draft.variantPrices[variant.id]?.trim();
                    if (!value) return [];
                    const amount = majorInputToMoney(value, variant.currencyCode);
                    return amount == null ? [] : [{ productVariantId: variant.id, salePrice: amount }];
                }),
            );
            await create({
                variables: {
                    input: {
                        name: draft.name.trim(),
                        productIds: draft.productIds,
                        percentageOff: Number(draft.percentageOff),
                        variantPrices,
                        startsAt: dateInput(draft.startsAt),
                        endsAt: dateInput(draft.endsAt),
                    },
                },
            });
            await onSaved();
        } catch (error) {
            onError(errorText(error));
        }
    };
    return (
        <Modal
            title="新建限时秒杀"
            description="秒杀价由后端结算，活动重叠或价格不合法时会阻止创建。"
            onClose={onClose}
            width="max-w-4xl"
        >
            <div className="grid gap-4 sm:grid-cols-2">
                <FormInput
                    label="活动名称 *"
                    value={draft.name}
                    onChange={value => setDraft({ ...draft, name: value })}
                    placeholder="例如：周末数码限时秒杀"
                />
                <FormInput
                    label="统一降价比例 (%) *"
                    type="number"
                    value={draft.percentageOff}
                    onChange={value => setDraft({ ...draft, percentageOff: value })}
                />
                <DateInput
                    label="开始时间 *"
                    type="datetime-local"
                    value={draft.startsAt}
                    onChange={value => setDraft({ ...draft, startsAt: value })}
                />
                <DateInput
                    label="结束时间 *"
                    type="datetime-local"
                    value={draft.endsAt}
                    onChange={value => setDraft({ ...draft, endsAt: value })}
                />
            </div>
            <MultiSelector
                title={`秒杀商品 *（已选 ${draft.productIds.length}/50）`}
                items={products}
                totalItems={catalog.data?.products.totalItems ?? 0}
                loading={catalog.loading}
                error={catalog.error?.message}
                selectedIds={draft.productIds}
                search={search}
                setSearch={setSearch}
                onChange={ids => {
                    setKnownProducts(current => ({
                        ...current,
                        ...Object.fromEntries(products.map(product => [product.id, product])),
                    }));
                    setDraft({ ...draft, productIds: ids.slice(0, 50) });
                }}
            />
            {selectedProducts.length > 0 && (
                <div className="mt-4">
                    <h3 className="text-xs font-bold text-slate-800">可选：单独设置 SKU 秒杀价</h3>
                    <p className="mt-1 text-[10px] text-slate-400">
                        留空则按统一降价比例计算；填写价格必须低于原价。
                    </p>
                    <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">
                        {selectedProducts.flatMap(product =>
                            product.variants.map(variant => (
                                <div
                                    key={variant.id}
                                    className="grid grid-cols-[1fr_110px_120px] items-center gap-2 rounded-lg bg-slate-50 p-2 text-[11px]"
                                >
                                    <div className="min-w-0">
                                        <div className="truncate font-bold text-slate-800">
                                            {product.name}
                                        </div>
                                        <div className="truncate text-slate-400">{variant.name}</div>
                                    </div>
                                    <span className="font-mono text-slate-500">
                                        原价 {formatMoney(variant.priceWithTax, variant.currencyCode)}
                                    </span>
                                    <input
                                        type="number"
                                        value={draft.variantPrices[variant.id] ?? ''}
                                        onChange={event =>
                                            setDraft({
                                                ...draft,
                                                variantPrices: {
                                                    ...draft.variantPrices,
                                                    [variant.id]: event.target.value,
                                                },
                                            })
                                        }
                                        placeholder={currencyCode}
                                        className="rounded border border-slate-300 bg-white px-2 py-1.5 font-mono"
                                    />
                                </div>
                            )),
                        )}
                    </div>
                </div>
            )}
            {validation && <p className="mt-3 text-xs text-rose-600">{validation}</p>}
            <ModalFooter
                onCancel={onClose}
                onConfirm={() => void submit()}
                pending={state.loading}
                disabled={Boolean(validation)}
                confirmLabel="创建秒杀"
            />
        </Modal>
    );
}

function GrantCouponDialog({
    coupon,
    onClose,
    onSaved,
    onError,
}: {
    coupon: StoreCouponRecord;
    pending: boolean;
    onClose: () => void;
    onSaved: () => Promise<void>;
    onError: (message: string) => void;
}) {
    const [search, setSearch] = useState('');
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
        variables: { options: { take: 20, sort: { createdAt: 'DESC' }, filter } },
        fetchPolicy: 'cache-and-network',
    });
    const [grant, state] = useMutation(GRANT_STORE_COUPON_MUTATION);
    const submit = async (customerId: string) => {
        try {
            await grant({ variables: { campaignId: coupon.id, customerId } });
            await onSaved();
        } catch (error) {
            onError(errorText(error));
        }
    };
    return (
        <Modal
            title={`指定发券：${coupon.name}`}
            description="选择客户后立即发放到其账户；同一客户的领取上限仍由后端校验。"
            onClose={onClose}
            width="max-w-lg"
        >
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
            <div className="mt-3 max-h-96 space-y-2 overflow-y-auto">
                {lookup.loading && !lookup.data ? (
                    <LoadingState label="正在查找客户…" />
                ) : lookup.error ? (
                    <p className="p-4 text-xs text-rose-600">
                        {toUserFacingError(lookup.error, '客户查找失败，请稍后重试')}
                    </p>
                ) : (
                    lookup.data?.customers.items.map(customer => (
                        <div
                            key={customer.id}
                            className="flex items-center justify-between rounded-lg border border-slate-200 p-3"
                        >
                            <div className="min-w-0">
                                <div className="truncate text-xs font-bold text-slate-900">
                                    {`${customer.lastName}${customer.firstName}` || customer.emailAddress}
                                </div>
                                <div className="truncate text-[10px] text-slate-400">
                                    {customer.phoneNumber || customer.emailAddress}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => void submit(customer.id)}
                                disabled={state.loading}
                                className="rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
                            >
                                发放
                            </button>
                        </div>
                    ))
                )}
                {lookup.data && !lookup.data.customers.items.length && (
                    <p className="p-8 text-center text-xs text-slate-400">没有匹配客户</p>
                )}
            </div>
            {lookup.data && (
                <p className="mt-2 text-[10px] text-slate-400">
                    匹配 {lookup.data.customers.totalItems} 位客户，当前显示前 20 位；继续输入可缩小范围
                </p>
            )}
        </Modal>
    );
}

function SensitiveDialog({
    action,
    pending,
    onClose,
    onConfirm,
}: {
    action: SensitiveAction;
    pending: boolean;
    onClose: () => void;
    onConfirm: (password: string, reason: string) => Promise<void>;
}) {
    const [password, setPassword] = useState('');
    const [reason, setReason] = useState('');
    const copy = sensitiveCopy(action);
    return (
        <Modal title={copy.title} description={copy.description} onClose={onClose} width="max-w-md">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <strong>{action.name}</strong>
                <p className="mt-1">{copy.impact}</p>
            </div>
            {action.kind === 'REVOKE' && (
                <label className="mt-4 block text-xs font-bold text-slate-700">
                    作废原因
                    <textarea
                        value={reason}
                        onChange={event => setReason(event.target.value)}
                        rows={2}
                        maxLength={500}
                        className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 font-normal"
                        placeholder="会写入优惠券审计流水"
                    />
                </label>
            )}
            <label className="mt-4 block text-xs font-bold text-slate-700">
                管理员密码确认 *
                <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
                />
            </label>
            <ModalFooter
                onCancel={onClose}
                onConfirm={() => void onConfirm(password, reason)}
                pending={pending}
                disabled={!password}
                confirmLabel={copy.confirmLabel}
                danger
            />
        </Modal>
    );
}

function NameDialog({
    value,
    pending,
    onClose,
    onConfirm,
}: {
    value: string;
    pending: boolean;
    onClose: () => void;
    onConfirm: (value: string) => Promise<void>;
}) {
    const [name, setName] = useState(value);
    return (
        <Modal title="修改活动名称" onClose={onClose} width="max-w-md">
            <FormInput label="活动名称 *" value={name} onChange={setName} />
            <ModalFooter
                onCancel={onClose}
                onConfirm={() => void onConfirm(name)}
                pending={pending}
                disabled={!name.trim()}
                confirmLabel="保存名称"
            />
        </Modal>
    );
}

function MultiSelector<T extends { id: string; name: string }>({
    title,
    items,
    totalItems,
    loading,
    error,
    selectedIds,
    search,
    setSearch,
    onChange,
}: {
    title: string;
    items: T[];
    totalItems: number;
    loading: boolean;
    error?: string;
    selectedIds: string[];
    search: string;
    setSearch: (value: string) => void;
    onChange: (ids: string[]) => void;
}) {
    const visible = items.filter(
        item => !search.trim() || item.name.toLowerCase().includes(search.trim().toLowerCase()),
    );
    return (
        <div className="mt-4 rounded-xl border border-slate-200 p-3">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h3 className="text-xs font-bold text-slate-800">{title}</h3>
                    <p className="mt-0.5 text-[9px] text-slate-400">
                        {loading ? '正在查询…' : `匹配 ${totalItems} 条，当前显示前 ${items.length} 条`}
                    </p>
                </div>
                <div className="relative">
                    <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                    <input
                        value={search}
                        onChange={event => setSearch(event.target.value)}
                        aria-label={`搜索${title}`}
                        placeholder="搜索"
                        className="w-48 rounded-lg border border-slate-300 py-1.5 pl-8 pr-2 text-[11px]"
                    />
                </div>
            </div>
            <div className="mt-2 max-h-52 overflow-y-auto rounded-lg bg-slate-50 p-2">
                {error && (
                    <p className="p-3 text-center text-[11px] text-rose-600">
                        {toUserFacingError(error, '列表读取失败')}
                    </p>
                )}
                <div className="grid gap-1 sm:grid-cols-2">
                    {visible.map(item => (
                        <label
                            key={item.id}
                            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[11px] hover:bg-white"
                        >
                            <input
                                type="checkbox"
                                checked={selectedIds.includes(item.id)}
                                onChange={event =>
                                    onChange(
                                        event.target.checked
                                            ? [...selectedIds, item.id]
                                            : selectedIds.filter(id => id !== item.id),
                                    )
                                }
                            />
                            <span className="truncate">{item.name}</span>
                        </label>
                    ))}
                </div>
                {!loading && !error && !visible.length && (
                    <p className="py-5 text-center text-[11px] text-slate-400">没有匹配项</p>
                )}
            </div>
        </div>
    );
}

function CampaignState({
    enabled,
    startsAt,
    endsAt,
}: {
    enabled: boolean;
    startsAt: string | null;
    endsAt: string | null;
}) {
    const [currentTime, setCurrentTime] = useState(() => Date.now());
    useEffect(() => {
        const timer = window.setInterval(() => setCurrentTime(Date.now()), 60_000);
        return () => window.clearInterval(timer);
    }, []);
    const start = startsAt ? Date.parse(startsAt) : null;
    const end = endsAt ? Date.parse(endsAt) : null;
    let label = enabled ? '进行中' : '已停用';
    let cls = enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600';
    if (enabled && start && start > currentTime) {
        label = '待开始';
        cls = 'bg-blue-100 text-blue-700';
    }
    if (end && end <= currentTime) {
        label = '已结束';
        cls = 'bg-slate-100 text-slate-600';
    }
    return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${cls}`}>{label}</span>;
}
function OverviewMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
    return (
        <div className="border-b border-slate-200 p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
            <div className="text-[11px] font-bold text-slate-400">{label}</div>
            <strong className="mt-1 block text-xl text-slate-900">{value}</strong>
            <div className="mt-1 text-[10px] text-slate-500">{detail}</div>
        </div>
    );
}
function SmallMetric({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <div className="text-[10px] font-bold text-slate-400">{label}</div>
            <div className="mt-1 truncate font-mono text-xs font-bold text-slate-800">{value}</div>
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
    icon: typeof BadgePercent;
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
function FormInput({
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
        <label className="block text-[11px] font-bold text-slate-600">
            {label}
            <input
                type={type}
                value={value}
                onChange={event => onChange(event.target.value)}
                placeholder={placeholder}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-normal text-slate-900 outline-none focus:border-blue-500"
            />
        </label>
    );
}
function DateInput(props: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    type: 'date' | 'datetime-local';
}) {
    return <FormInput {...props} />;
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
                {options.map(([optionValue, labelValue]) => (
                    <option key={optionValue} value={optionValue}>
                        {labelValue}
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
function SimplePagination({
    page,
    totalPages,
    totalItems,
    onPageChange,
}: {
    page: number;
    totalPages: number;
    totalItems: number;
    onPageChange: (value: number) => void;
}) {
    return (
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
            <span>
                共 {totalItems} 条，第 {page + 1}/{totalPages} 页
            </span>
            <div className="flex gap-2">
                <button
                    type="button"
                    disabled={page === 0}
                    onClick={() => onPageChange(page - 1)}
                    aria-label="上一页"
                    className="rounded border border-slate-300 bg-white p-1.5 disabled:opacity-40"
                >
                    <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                    type="button"
                    disabled={page + 1 >= totalPages}
                    onClick={() => onPageChange(page + 1)}
                    aria-label="下一页"
                    className="rounded border border-slate-300 bg-white p-1.5 disabled:opacity-40"
                >
                    <ChevronRight className="h-4 w-4" />
                </button>
            </div>
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
            className={`my-3 flex items-center gap-2 rounded-xl border p-3 text-xs ${kind === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}
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
            <h3 className="mt-3 text-sm font-bold text-slate-900">营销数据读取失败</h3>
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
function EmptyState({
    icon: Icon,
    title,
    detail,
    action,
    onAction,
}: {
    icon: typeof BadgePercent;
    title: string;
    detail: string;
    action: string;
    onAction: () => void;
}) {
    return (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-14 text-center">
            <Icon className="mx-auto h-10 w-10 text-slate-300" />
            <h3 className="mt-3 text-sm font-bold text-slate-800">{title}</h3>
            <p className="mt-1 text-xs text-slate-400">{detail}</p>
            <button
                type="button"
                onClick={onAction}
                className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white"
            >
                {action}
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

function newCouponDraft(): CouponDraft {
    const range = defaultDateRange();
    return {
        name: '',
        kind: 'ORDER_FIXED',
        minimumSpend: '0',
        discountValue: '1',
        startsAt: range.start,
        endsAt: range.end,
        claimStartsAt: range.start,
        claimEndsAt: range.end,
        validityDays: '7',
        issueLimit: '100',
        stackPolicy: 'EXCLUSIVE',
        returnOnCancellation: true,
        returnOnFullRefund: true,
        collectionIds: [],
        productIds: [],
    };
}
function newFlashDraft(): FlashDraft {
    const range = defaultDateRange();
    return {
        name: '',
        percentageOff: '20',
        startsAt: range.start,
        endsAt: range.end,
        productIds: [],
        variantPrices: {},
    };
}
function defaultDateRange() {
    const start = new Date();
    const end = new Date(start.getTime() + 7 * 86_400_000);
    return { start: localDateTime(start), end: localDateTime(end) };
}
function defaultReportFilter() {
    const to = new Date();
    const from = new Date(to.getTime() - 29 * 86_400_000);
    return { from: localDate(from), to: localDate(to), campaignId: 'ALL' };
}
function localDate(date: Date) {
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}
function localDateTime(date: Date) {
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
function dateInput(value: string) {
    return value ? new Date(value).toISOString() : null;
}
function reportDateStart(value: string) {
    return new Date(`${value}T00:00:00`).toISOString();
}
function reportDateEnd(value: string) {
    return new Date(new Date(`${value}T00:00:00`).getTime() + 86_400_000).toISOString();
}
function validReportFilter(value: ReturnType<typeof defaultReportFilter>) {
    const from = Date.parse(value.from);
    const to = Date.parse(value.to);
    return Boolean(
        value.from &&
        value.to &&
        Number.isFinite(from) &&
        Number.isFinite(to) &&
        from <= to &&
        to - from <= 365 * 86_400_000,
    );
}
function couponDraftError(draft: CouponDraft) {
    if (!draft.name.trim()) return '请填写活动名称';
    if (Number(draft.minimumSpend) < 0) return '最低消费金额不能小于0';
    if (
        draft.kind === 'ORDER_FIXED'
            ? Number(draft.discountValue) <= 0
            : Number(draft.discountValue) <= 0 || Number(draft.discountValue) >= 10
    )
        return draft.kind === 'ORDER_FIXED' ? '减免金额必须大于0' : '折扣必须大于0折并小于10折';
    if (!draft.issueLimit || Number(draft.issueLimit) < 1) return '发放总量必须大于0';
    if (!draft.validityDays || Number(draft.validityDays) < 1) return '有效天数必须大于0';
    if (Date.parse(draft.claimStartsAt) >= Date.parse(draft.claimEndsAt))
        return '领取结束时间必须晚于开始时间';
    if (draft.kind === 'COLLECTION_PERCENTAGE' && !draft.collectionIds.length)
        return '请选择至少一个适用分类';
    if (draft.kind === 'PRODUCT_PERCENTAGE' && !draft.productIds.length) return '请选择至少一个适用商品';
    return '';
}
function flashDraftError(draft: FlashDraft, products: PromotionProductRecord[], currencyCode: string) {
    if (!draft.name.trim()) return '请填写活动名称';
    if (!draft.productIds.length) return '请选择至少一个秒杀商品';
    if (draft.productIds.length > 50) return '一个秒杀活动最多选择50个商品';
    const rate = Number(draft.percentageOff);
    if (!Number.isFinite(rate) || rate <= 0 || rate >= 100) return '降价比例必须大于0%且小于100%';
    if (Date.parse(draft.startsAt) >= Date.parse(draft.endsAt)) return '结束时间必须晚于开始时间';
    for (const product of products)
        for (const variant of product.variants) {
            const value = draft.variantPrices[variant.id]?.trim();
            if (!value) continue;
            const amount = majorInputToMoney(value, variant.currencyCode || currencyCode);
            if (amount == null || amount >= variant.priceWithTax)
                return `“${product.name} / ${variant.name}”的秒杀价必须低于原价`;
        }
    return '';
}
function couponIsActive(coupon: StoreCouponRecord) {
    const now = Date.now();
    const start = coupon.claimStartsAt ? Date.parse(coupon.claimStartsAt) : null;
    const end = coupon.claimEndsAt ? Date.parse(coupon.claimEndsAt) : null;
    return coupon.enabled && (!start || start <= now) && (!end || end > now);
}
function couponRule(coupon: StoreCouponRecord, currencyCode: string) {
    const threshold = coupon.minimumSpend ? `满 ${formatMoney(coupon.minimumSpend, currencyCode)}` : '无门槛';
    return coupon.kind === 'ORDER_FIXED'
        ? `${threshold}减 ${formatMoney(coupon.discountAmount ?? 0, currencyCode)}`
        : `${threshold}享 ${coupon.discountRate ?? '—'} 折`;
}
function dateRange(start: string | null, end: string | null) {
    return `${start ? formatDateTime(start) : '立即'} 至 ${end ? formatDateTime(end) : '长期'}`;
}
function formatRate(value: number, total: number) {
    return total ? `${((value / total) * 100).toFixed(1)}%` : '0%';
}
function sum(items: StoreCouponRecord[], field: keyof StoreCouponRecord) {
    return items.reduce(
        (total, item) => total + (typeof item[field] === 'number' ? (item[field] as number) : 0),
        0,
    );
}
function errorText(error: unknown) {
    return toUserFacingError(error, '操作失败，请稍后重试');
}
function sensitiveSuccessMessage(action: SensitiveAction) {
    if (action.kind === 'TOGGLE') return action.enabled ? '秒杀活动已启用' : '秒杀活动已停用';
    if (action.kind === 'STOP') return '优惠券已停止发放，客户已领取券仍可按原规则使用';
    if (action.kind === 'REVOKE') return `未使用优惠券已作废（预计影响 ${action.affectedCount} 张）`;
    return `${action.subject}活动已删除`;
}
function sensitiveCopy(action: SensitiveAction) {
    if (action.kind === 'TOGGLE')
        return {
            title: action.enabled ? '启用秒杀活动' : '停用秒杀活动',
            description: '该操作会立即改变商城展示与结算规则。',
            impact: action.enabled ? '启用后将在活动时间内生效。' : '停用后新订单不再享受秒杀价。',
            confirmLabel: action.enabled ? '确认启用' : '确认停用',
        };
    if (action.kind === 'STOP')
        return {
            title: '停止发放优惠券',
            description: '停止新的领取，但不会伤害客户已有权益。',
            impact: '已领取优惠券仍可在有效期内使用。',
            confirmLabel: '确认停止发放',
        };
    if (action.kind === 'REVOKE')
        return {
            title: '批量作废未使用优惠券',
            description: '这是不可逆的客户权益变更。',
            impact: `预计作废 ${action.affectedCount} 张可用券，已核销券不受影响。`,
            confirmLabel: '确认批量作废',
        };
    return {
        title: `删除${action.subject}活动`,
        description: '仅未产生受保护业务数据的活动允许删除。',
        impact: '删除后该活动将不再显示，后端会阻止删除已发放优惠券。',
        confirmLabel: '确认删除',
    };
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
