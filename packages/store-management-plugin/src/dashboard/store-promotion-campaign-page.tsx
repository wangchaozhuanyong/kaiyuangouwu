import {
    Alert,
    AlertDescription,
    Badge,
    Button,
    DashboardRouteDefinition,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
    Label,
    Page,
    PageActionBar,
    PageActionBarRight,
    PageBlock,
    PageLayout,
    PageTitle,
    ProductMultiSelectorDialog,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
    Skeleton,
    Switch,
    UnsavedChangesConfirmation,
    api,
    toast,
    useChannel,
    useMutation,
    useQuery,
    useQueryClient,
} from '@vendure/dashboard';
import {
    BadgePercent,
    Ban,
    Download,
    Flame,
    Pencil,
    Plus,
    RefreshCw,
    ShieldAlert,
    Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
    StoreCouponDailyReportResult,
    StoreCouponKind,
    StorePromotionCampaignsResult,
    StorePromotionProductsResult,
    createStoreCouponCampaignMutation,
    createStoreFlashSaleMutation,
    deleteStorePromotionMutation,
    revokeStoreCouponCampaignOutstandingMutation,
    setStorePromotionEnabledMutation,
    stopStoreCouponIssuanceMutation,
    storeCouponDailyReportQuery,
    storePromotionCampaignsQuery,
    storePromotionProductsQuery,
    updateStorePromotionNameMutation,
} from './store-promotion-campaign.graphql';

interface CouponDraft {
    name: string;
    kind: StoreCouponKind;
    minimumSpend: string;
    discountAmount: string;
    discountRate: string;
    collectionIds: string[];
    productIds: string[];
    startsAt: string;
    endsAt: string;
    usageLimit: string;
    perCustomerUsageLimit: string;
    claimStartsAt: string;
    claimEndsAt: string;
    validityDays: string;
    issueLimit: string;
    stackPolicy: 'EXCLUSIVE' | 'STACKABLE';
    returnOnCancellation: boolean;
    returnOnFullRefund: boolean;
}

interface FlashSaleDraft {
    name: string;
    productIds: string[];
    percentageOff: string;
    startsAt: string;
    endsAt: string;
    variantPrices: Record<string, string>;
}

interface CouponReportFilter {
    from: string;
    to: string;
    campaignId: string;
}

type SensitivePromotionAction =
    | { kind: 'TOGGLE'; id: string; name: string; enabled: boolean }
    | { kind: 'DELETE_COUPON'; id: string; name: string }
    | { kind: 'DELETE_FLASH_SALE'; id: string; name: string }
    | { kind: 'STOP_ISSUANCE'; id: string; name: string; claimedCount: number }
    | { kind: 'REVOKE_OUTSTANDING'; id: string; name: string; affectedCount: number };

const couponKindLabels: Record<StoreCouponKind, string> = {
    ORDER_FIXED: '满减券',
    ORDER_PERCENTAGE: '消费折扣券',
    COLLECTION_PERCENTAGE: '分类折扣券',
    PRODUCT_PERCENTAGE: '单品折扣券',
};

const couponLedgerEventLabels = {
    CLAIMED: '领取',
    LOCKED: '订单锁定',
    RELEASED: '释放',
    REDEEMED: '核销',
    RETURNED: '返还',
    EXPIRED: '过期',
    REVOKED: '撤销',
    REFUND_SETTLED: '退款完成',
} as const;

function CampaignMetric({ label, value }: { label: string; value: string | number }) {
    return (
        <div>
            <span className="block text-muted-foreground">{label}</span>
            <strong className="mt-1 block text-sm">{value}</strong>
        </div>
    );
}

function CouponReport({
    coupons,
    currencyCode,
    dailyMetrics,
    filter,
    reportPending,
    reportError,
    onFilterChange,
}: {
    coupons: StorePromotionCampaignsResult['storeCouponCampaigns'];
    currencyCode: string;
    dailyMetrics: StoreCouponDailyReportResult['storeCouponDailyReport'];
    filter: CouponReportFilter;
    reportPending: boolean;
    reportError: unknown;
    onFilterChange: (filter: CouponReportFilter) => void;
}) {
    const totals = coupons.reduce(
        (result, coupon) => ({
            claimed: result.claimed + coupon.claimedCount,
            available: result.available + coupon.availableCount,
            locked: result.locked + coupon.lockedCount,
            used: result.used + coupon.usedCount,
            returned: result.returned + coupon.returnedCount,
            expired: result.expired + coupon.expiredCount,
            revoked: result.revoked + coupon.revokedCount,
            orders: result.orders + coupon.redeemedOrderCount,
            refundedOrders: result.refundedOrders + coupon.refundedOrderCount,
            discount: result.discount + coupon.discountAmountTotal,
            revenue: result.revenue + coupon.assistedRevenueTotal,
        }),
        {
            claimed: 0,
            available: 0,
            locked: 0,
            used: 0,
            returned: 0,
            expired: 0,
            revoked: 0,
            orders: 0,
            refundedOrders: 0,
            discount: 0,
            revenue: 0,
        },
    );
    const dailyTotals = dailyMetrics.reduce(
        (result, item) => ({
            claimed: result.claimed + item.claimedCount,
            redeemed: result.redeemed + item.redeemedCount,
            refunded: result.refunded + item.refundedCount,
            discount: result.discount + item.discountAmountTotal,
            revenue: result.revenue + item.assistedRevenueTotal,
        }),
        { claimed: 0, redeemed: 0, refunded: 0, discount: 0, revenue: 0 },
    );

    return (
        <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                <ReportMetric label="累计发放" value={`${totals.claimed} 张`} />
                <ReportMetric
                    label="当前已用"
                    value={`${totals.used} 张`}
                    detail={`占发放 ${formatRate(totals.used, totals.claimed)}`}
                />
                <ReportMetric
                    label="当前可用"
                    value={`${totals.available} 张`}
                    detail={`购物车锁定 ${totals.locked} 张`}
                />
                <ReportMetric label="历史核销订单" value={`${totals.orders} 单`} />
                <ReportMetric label="历史优惠金额" value={formatMoney(totals.discount, currencyCode)} />
                <ReportMetric
                    label="优惠券归因订单金额"
                    value={formatMoney(totals.revenue, currencyCode)}
                    detail={`含后续退款订单 · 产出比 ${formatMultiple(totals.revenue, totals.discount)}`}
                />
            </div>
            <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                    当前共 {coupons.length} 个优惠券活动、{totals.orders} 个历史核销订单，其中{' '}
                    {totals.refundedOrders}{' '}
                    个发生全额退款；数据来自领取记录和订单优惠分摊。跨活动合计按券归因，
                    叠加多张券的同一订单会分别计入对应活动。
                </p>
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!coupons.length}
                    onClick={() => exportCouponReport(coupons, currencyCode)}
                >
                    <Download className="size-4" />
                    导出 CSV
                </Button>
            </div>
            <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[1450px] text-left text-sm">
                    <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                        <tr>
                            <ReportHeading>活动</ReportHeading>
                            <ReportHeading>类型</ReportHeading>
                            <ReportHeading>发放状态</ReportHeading>
                            <ReportHeading align="right">发放</ReportHeading>
                            <ReportHeading align="right">可用</ReportHeading>
                            <ReportHeading align="right">锁定</ReportHeading>
                            <ReportHeading align="right">当前已用</ReportHeading>
                            <ReportHeading align="right">当前已用率</ReportHeading>
                            <ReportHeading align="right">当前返还</ReportHeading>
                            <ReportHeading align="right">当前过期</ReportHeading>
                            <ReportHeading align="right">当前作废</ReportHeading>
                            <ReportHeading align="right">历史核销订单</ReportHeading>
                            <ReportHeading align="right">退款订单</ReportHeading>
                            <ReportHeading align="right">历史优惠金额</ReportHeading>
                            <ReportHeading align="right">优惠券归因订单金额</ReportHeading>
                            <ReportHeading align="right">优惠产出比</ReportHeading>
                        </tr>
                    </thead>
                    <tbody>
                        {coupons.map(coupon => (
                            <tr key={coupon.id} className="border-b last:border-0">
                                <td className="max-w-60 px-3 py-3 font-medium">{coupon.name}</td>
                                <td className="px-3 py-3">{couponKindLabels[coupon.kind]}</td>
                                <td className="px-3 py-3">
                                    <Badge variant={couponIssuanceIsActive(coupon) ? 'default' : 'secondary'}>
                                        {couponIssuanceStatusLabel(coupon)}
                                    </Badge>
                                </td>
                                <ReportCell>{coupon.claimedCount}</ReportCell>
                                <ReportCell>{coupon.availableCount}</ReportCell>
                                <ReportCell>{coupon.lockedCount}</ReportCell>
                                <ReportCell>{coupon.usedCount}</ReportCell>
                                <ReportCell>{formatRate(coupon.usedCount, coupon.claimedCount)}</ReportCell>
                                <ReportCell>{coupon.returnedCount}</ReportCell>
                                <ReportCell>{coupon.expiredCount}</ReportCell>
                                <ReportCell>{coupon.revokedCount}</ReportCell>
                                <ReportCell>{coupon.redeemedOrderCount}</ReportCell>
                                <ReportCell>{coupon.refundedOrderCount}</ReportCell>
                                <ReportCell>
                                    {formatMoney(coupon.discountAmountTotal, currencyCode)}
                                </ReportCell>
                                <ReportCell>
                                    {formatMoney(coupon.assistedRevenueTotal, currencyCode)}
                                </ReportCell>
                                <ReportCell>
                                    {formatMultiple(coupon.assistedRevenueTotal, coupon.discountAmountTotal)}
                                </ReportCell>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {!coupons.length ? (
                    <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                        暂无可统计的优惠券活动。
                    </p>
                ) : null}
            </div>
            <div className="space-y-3 rounded-lg border p-4">
                <div>
                    <h3 className="text-sm font-semibold">每日发放与使用趋势</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                        日期区间统计事件发生量；开始和结束日期均包含在内，单次最多查询 366 天。
                        成交金额按优惠券归因，同一订单叠加多张券时会分别归因。
                    </p>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                    <FormField label="开始日期">
                        <Input
                            type="date"
                            value={filter.from}
                            max={filter.to}
                            onChange={event => onFilterChange({ ...filter, from: event.target.value })}
                        />
                    </FormField>
                    <FormField label="结束日期">
                        <Input
                            type="date"
                            value={filter.to}
                            min={filter.from}
                            onChange={event => onFilterChange({ ...filter, to: event.target.value })}
                        />
                    </FormField>
                    <FormField label="优惠券活动">
                        <Select
                            value={filter.campaignId}
                            onValueChange={campaignId =>
                                campaignId && onFilterChange({ ...filter, campaignId })
                            }
                        >
                            <SelectTrigger className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ALL">全部活动</SelectItem>
                                {coupons.map(coupon => (
                                    <SelectItem key={coupon.id} value={coupon.id}>
                                        {coupon.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </FormField>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    <ReportMetric label="区间发放" value={`${dailyTotals.claimed} 张`} />
                    <ReportMetric label="区间核销订单" value={`${dailyTotals.redeemed} 单`} />
                    <ReportMetric label="区间退款订单" value={`${dailyTotals.refunded} 单`} />
                    <ReportMetric
                        label="区间优惠金额"
                        value={formatMoney(dailyTotals.discount, currencyCode)}
                    />
                    <ReportMetric
                        label="区间归因订单金额"
                        value={formatMoney(dailyTotals.revenue, currencyCode)}
                        detail={`产出比 ${formatMultiple(dailyTotals.revenue, dailyTotals.discount)}`}
                    />
                </div>
                <div className="flex justify-end">
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!dailyMetrics.length || reportPending}
                        onClick={() => exportCouponDailyReport(dailyMetrics, currencyCode, filter)}
                    >
                        <Download className="size-4" />
                        导出区间日报
                    </Button>
                </div>
                {reportError ? (
                    <Alert variant="destructive">
                        <AlertDescription>{errorMessage(reportError)}</AlertDescription>
                    </Alert>
                ) : (
                    <div className="overflow-x-auto rounded-lg border">
                        <table className="w-full min-w-[980px] text-left text-sm">
                            <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                                <tr>
                                    <ReportHeading>日期</ReportHeading>
                                    <ReportHeading align="right">发放</ReportHeading>
                                    <ReportHeading align="right">核销</ReportHeading>
                                    <ReportHeading align="right">退款</ReportHeading>
                                    <ReportHeading align="right">返还事件</ReportHeading>
                                    <ReportHeading align="right">过期事件</ReportHeading>
                                    <ReportHeading align="right">作废事件</ReportHeading>
                                    <ReportHeading align="right">优惠金额</ReportHeading>
                                    <ReportHeading align="right">归因订单金额</ReportHeading>
                                </tr>
                            </thead>
                            <tbody>
                                {dailyMetrics.map(item => (
                                    <tr key={item.date} className="border-b last:border-0">
                                        <td className="whitespace-nowrap px-3 py-3">{item.date}</td>
                                        <ReportCell>{item.claimedCount}</ReportCell>
                                        <ReportCell>{item.redeemedCount}</ReportCell>
                                        <ReportCell>{item.refundedCount}</ReportCell>
                                        <ReportCell>{item.returnedCount}</ReportCell>
                                        <ReportCell>{item.expiredCount}</ReportCell>
                                        <ReportCell>{item.revokedCount}</ReportCell>
                                        <ReportCell>
                                            {formatMoney(item.discountAmountTotal, currencyCode)}
                                        </ReportCell>
                                        <ReportCell>
                                            {formatMoney(item.assistedRevenueTotal, currencyCode)}
                                        </ReportCell>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {!reportPending && !dailyMetrics.length ? (
                            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                                当前日期区间没有优惠券发放或使用数据。
                            </p>
                        ) : null}
                        {reportPending ? (
                            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                                正在加载区间报表…
                            </p>
                        ) : null}
                    </div>
                )}
            </div>
        </div>
    );
}

function ReportMetric({ label, value, detail }: { label: string; value: string; detail?: string }) {
    return (
        <div className="rounded-lg border bg-card p-4">
            <span className="text-xs text-muted-foreground">{label}</span>
            <strong className="mt-1 block text-xl">{value}</strong>
            {detail ? <small className="mt-1 block text-muted-foreground">{detail}</small> : null}
        </div>
    );
}

function ReportHeading({
    children,
    align = 'left',
}: {
    children: React.ReactNode;
    align?: 'left' | 'right';
}) {
    return (
        <th
            className={`whitespace-nowrap px-3 py-2 font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}
        >
            {children}
        </th>
    );
}

function ReportCell({ children }: { children: React.ReactNode }) {
    return <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{children}</td>;
}

export const storeCouponCampaignRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'marketing',
        id: 'store-coupons',
        url: '/store-coupons',
        title: '优惠券',
        icon: BadgePercent,
        order: 5,
        requiresPermission: ['ReadPromotion'],
    },
    path: '/store-coupons',
    loader: () => ({ breadcrumb: () => '优惠券' }),
    component: () => <StorePromotionCampaignPage mode="COUPONS" />,
};

export const storeFlashSaleRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'marketing',
        id: 'store-flash-sales',
        url: '/store-flash-sales',
        title: '限时秒杀',
        icon: Flame,
        order: 6,
        requiresPermission: ['ReadPromotion'],
    },
    path: '/store-flash-sales',
    loader: () => ({ breadcrumb: () => '限时秒杀' }),
    component: () => <StorePromotionCampaignPage mode="FLASH_SALES" />,
};

/** Keeps existing bookmarks working while the two business areas use separate navigation. */
export const storePromotionCampaignRoute: DashboardRouteDefinition = {
    path: '/store-promotion-campaigns',
    loader: () => ({ breadcrumb: () => '优惠券' }),
    component: () => <StorePromotionCampaignPage mode="COUPONS" />,
};

function StorePromotionCampaignPage({ mode }: { mode: 'COUPONS' | 'FLASH_SALES' }) {
    const { activeChannel } = useChannel();
    const queryClient = useQueryClient();
    const queryKey = ['store-promotion-campaigns', activeChannel?.id];
    const [reportFilter, setReportFilter] = useState<CouponReportFilter>(defaultCouponReportFilter);
    const [couponOpen, setCouponOpen] = useState(false);
    const [flashOpen, setFlashOpen] = useState(false);
    const [sensitiveAction, setSensitiveAction] = useState<SensitivePromotionAction | null>(null);
    const [editingName, setEditingName] = useState<{ id: string; name: string } | null>(null);
    const query = useQuery({
        queryKey,
        queryFn: () => api.query<StorePromotionCampaignsResult>(storePromotionCampaignsQuery),
        enabled: Boolean(activeChannel?.id),
    });
    const reportValidationError = couponReportFilterError(reportFilter);
    const reportQuery = useQuery({
        queryKey: [
            'store-coupon-daily-report',
            activeChannel?.id,
            reportFilter.from,
            reportFilter.to,
            reportFilter.campaignId,
        ],
        queryFn: () =>
            api.query<StoreCouponDailyReportResult>(storeCouponDailyReportQuery, {
                from: reportDateStart(reportFilter.from),
                to: reportDateExclusiveEnd(reportFilter.to),
                campaignId: reportFilter.campaignId === 'ALL' ? null : reportFilter.campaignId,
            }),
        enabled: mode === 'COUPONS' && Boolean(activeChannel?.id) && !reportValidationError,
    });
    const refresh = async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey }),
            queryClient.invalidateQueries({
                queryKey: ['store-coupon-daily-report', activeChannel?.id],
            }),
        ]);
    };
    const sensitiveMutation = useMutation({
        mutationFn: ({ action, password }: { action: SensitivePromotionAction; password: string }) => {
            if (action.kind === 'TOGGLE') {
                return api.mutate(setStorePromotionEnabledMutation, {
                    id: action.id,
                    enabled: action.enabled,
                    password,
                });
            }
            if (action.kind === 'STOP_ISSUANCE') {
                return api.mutate(stopStoreCouponIssuanceMutation, { id: action.id, password });
            }
            if (action.kind === 'REVOKE_OUTSTANDING') {
                return api.mutate(revokeStoreCouponCampaignOutstandingMutation, {
                    id: action.id,
                    password,
                    reason: '管理员在营销后台批量作废未使用优惠券',
                });
            }
            return api.mutate(deleteStorePromotionMutation, { id: action.id, password });
        },
        onSuccess: async (result, variables) => {
            if (variables.action.kind === 'TOGGLE') {
                toast.success(variables.action.enabled ? '秒杀活动已启用' : '秒杀活动已停用');
            } else if (variables.action.kind === 'STOP_ISSUANCE') {
                toast.success('优惠券已停止发放，客户已领取券仍可按原规则使用');
            } else if (variables.action.kind === 'REVOKE_OUTSTANDING') {
                const affectedCount = (
                    result as { revokeStoreCouponCampaignOutstanding?: { affectedCount: number } }
                ).revokeStoreCouponCampaignOutstanding?.affectedCount;
                toast.success(`已作废 ${affectedCount ?? variables.action.affectedCount} 张未使用优惠券`);
            } else {
                toast.success('活动已删除');
            }
            setSensitiveAction(null);
            await refresh();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const nameMutation = useMutation({
        mutationFn: ({ id, name }: { id: string; name: string }) =>
            api.mutate(updateStorePromotionNameMutation, { id, name }),
        onSuccess: async () => {
            toast.success('活动名称已更新');
            setEditingName(null);
            await refresh();
        },
        onError: error => toast.error(errorMessage(error)),
    });

    return (
        <Page pageId={mode === 'COUPONS' ? 'store-coupons' : 'store-flash-sales'}>
            <PageTitle>{mode === 'COUPONS' ? '优惠券' : '限时秒杀'}</PageTitle>
            <PageActionBar>
                <PageActionBarRight>
                    {mode === 'COUPONS' ? (
                        <Button onClick={() => setCouponOpen(true)}>
                            <BadgePercent className="size-4" aria-hidden="true" />
                            新建优惠券活动
                        </Button>
                    ) : (
                        <Button onClick={() => setFlashOpen(true)}>
                            <Flame className="size-4" aria-hidden="true" />
                            新建秒杀活动
                        </Button>
                    )}
                </PageActionBarRight>
            </PageActionBar>
            <PageLayout>
                {mode === 'COUPONS' ? (
                    <>
                        <PageBlock
                            column="full"
                            blockId="store-coupon-campaigns"
                            title="优惠券"
                            description="创建满减、消费折扣、分类折扣和单品折扣券；客户在前台领取，结算时由真实 Promotion 规则计算。"
                        >
                            <CampaignState query={query} onRetry={() => void query.refetch()}>
                                <div className="grid gap-3 lg:grid-cols-2">
                                    {query.data?.storeCouponCampaigns.map(coupon => (
                                        <div key={coupon.id} className="rounded-lg border p-4">
                                            <div className="flex items-start justify-between gap-4">
                                                <div className="min-w-0">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <strong className="truncate text-sm">
                                                            {coupon.name}
                                                        </strong>
                                                        <Badge variant="outline">
                                                            {couponKindLabels[coupon.kind]}
                                                        </Badge>
                                                        <Badge
                                                            variant={
                                                                couponIssuanceIsActive(coupon)
                                                                    ? 'default'
                                                                    : 'secondary'
                                                            }
                                                        >
                                                            {couponIssuanceStatusLabel(coupon)}
                                                        </Badge>
                                                    </div>
                                                    <p className="mt-1 text-xs text-muted-foreground">
                                                        {couponSummary(coupon)}
                                                    </p>
                                                    <p className="mt-1 text-xs text-muted-foreground">
                                                        领取 {coupon.claimedCount} · 已用 {coupon.usedCount} ·
                                                        返还 {coupon.returnedCount} · 过期{' '}
                                                        {coupon.expiredCount}
                                                    </p>
                                                </div>
                                                <div className="flex flex-wrap items-center justify-end gap-2">
                                                    <Button
                                                        type="button"
                                                        size="icon-sm"
                                                        variant="ghost"
                                                        aria-label="修改优惠券名称"
                                                        onClick={() =>
                                                            setEditingName({
                                                                id: coupon.id,
                                                                name: coupon.name,
                                                            })
                                                        }
                                                    >
                                                        <Pencil className="size-4" />
                                                    </Button>
                                                    {couponIssuanceCanBeStopped(coupon) ? (
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() =>
                                                                setSensitiveAction({
                                                                    kind: 'STOP_ISSUANCE',
                                                                    id: coupon.id,
                                                                    name: coupon.name,
                                                                    claimedCount: coupon.claimedCount,
                                                                })
                                                            }
                                                        >
                                                            停止发放
                                                        </Button>
                                                    ) : null}
                                                    {coupon.availableCount +
                                                        coupon.returnedCount +
                                                        coupon.lockedCount >
                                                    0 ? (
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() =>
                                                                setSensitiveAction({
                                                                    kind: 'REVOKE_OUTSTANDING',
                                                                    id: coupon.id,
                                                                    name: coupon.name,
                                                                    affectedCount:
                                                                        coupon.availableCount +
                                                                        coupon.returnedCount +
                                                                        coupon.lockedCount,
                                                                })
                                                            }
                                                        >
                                                            <Ban className="size-4" />
                                                            作废未使用券
                                                        </Button>
                                                    ) : null}
                                                    {coupon.claimedCount === 0 ? (
                                                        <Button
                                                            type="button"
                                                            size="icon-sm"
                                                            variant="ghost"
                                                            aria-label="删除优惠券"
                                                            onClick={() =>
                                                                setSensitiveAction({
                                                                    kind: 'DELETE_COUPON',
                                                                    id: coupon.id,
                                                                    name: coupon.name,
                                                                })
                                                            }
                                                        >
                                                            <Trash2 className="size-4" />
                                                        </Button>
                                                    ) : null}
                                                </div>
                                            </div>
                                            <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-3 text-xs sm:grid-cols-4">
                                                <CampaignMetric
                                                    label="可用券"
                                                    value={coupon.availableCount}
                                                />
                                                <CampaignMetric
                                                    label="核销订单"
                                                    value={coupon.redeemedOrderCount}
                                                />
                                                <CampaignMetric
                                                    label="优惠金额"
                                                    value={formatMoney(
                                                        coupon.discountAmountTotal,
                                                        activeChannel?.defaultCurrencyCode ?? 'CNY',
                                                    )}
                                                />
                                                <CampaignMetric
                                                    label="带动成交"
                                                    value={formatMoney(
                                                        coupon.assistedRevenueTotal,
                                                        activeChannel?.defaultCurrencyCode ?? 'CNY',
                                                    )}
                                                />
                                            </div>
                                            {coupon.claimedCount > 0 ? (
                                                <p className="mt-3 text-xs text-muted-foreground">
                                                    已产生发放记录，活动不可删除；可以停止发放或作废未使用券。
                                                </p>
                                            ) : null}
                                        </div>
                                    ))}
                                    {!query.data?.storeCouponCampaigns.length ? (
                                        <p className="text-sm text-muted-foreground">还没有优惠券。</p>
                                    ) : null}
                                </div>
                            </CampaignState>
                        </PageBlock>

                        <PageBlock
                            column="full"
                            blockId="store-coupon-report"
                            title="优惠券经营报表"
                            description="按活动统计发放、可用、锁定、核销、返还、过期、作废、优惠金额和带动成交。"
                        >
                            <CampaignState query={query} onRetry={() => void query.refetch()}>
                                <CouponReport
                                    coupons={query.data?.storeCouponCampaigns ?? []}
                                    currencyCode={activeChannel?.defaultCurrencyCode ?? 'CNY'}
                                    dailyMetrics={reportQuery.data?.storeCouponDailyReport ?? []}
                                    filter={reportFilter}
                                    reportPending={reportQuery.isPending || reportQuery.isFetching}
                                    reportError={reportValidationError ?? reportQuery.error}
                                    onFilterChange={setReportFilter}
                                />
                            </CampaignState>
                        </PageBlock>

                        <PageBlock
                            column="full"
                            blockId="store-coupon-ledger"
                            title="优惠券使用流水"
                            description={`记录领取、锁定、核销、返还、过期和退款事件，共 ${query.data?.storeCouponLedger.totalItems ?? 0} 条。`}
                        >
                            <CampaignState query={query} onRetry={() => void query.refetch()}>
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[760px] text-left text-sm">
                                        <thead className="border-b text-xs text-muted-foreground">
                                            <tr>
                                                <th className="px-2 py-2 font-medium">时间</th>
                                                <th className="px-2 py-2 font-medium">事件</th>
                                                <th className="px-2 py-2 font-medium">优惠券</th>
                                                <th className="px-2 py-2 font-medium">客户</th>
                                                <th className="px-2 py-2 font-medium">订单</th>
                                                <th className="px-2 py-2 text-right font-medium">优惠金额</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {query.data?.storeCouponLedger.items.map(entry => (
                                                <tr key={entry.id} className="border-b last:border-0">
                                                    <td className="px-2 py-3 text-xs">
                                                        {new Date(entry.createdAt).toLocaleString()}
                                                    </td>
                                                    <td className="px-2 py-3">
                                                        <Badge variant="outline">
                                                            {couponLedgerEventLabels[entry.eventType]}
                                                        </Badge>
                                                    </td>
                                                    <td className="px-2 py-3">{entry.campaignName}</td>
                                                    <td className="px-2 py-3">
                                                        <div>{entry.customerName}</div>
                                                        <small className="text-muted-foreground">
                                                            {entry.customerEmail}
                                                        </small>
                                                    </td>
                                                    <td className="px-2 py-3">
                                                        {entry.orderCode ?? '—'}
                                                        {entry.refundId ? (
                                                            <small className="block text-muted-foreground">
                                                                退款 #{entry.refundId}
                                                            </small>
                                                        ) : null}
                                                    </td>
                                                    <td className="px-2 py-3 text-right">
                                                        {entry.discountAmount == null
                                                            ? '—'
                                                            : formatMoney(
                                                                  entry.discountAmount,
                                                                  activeChannel?.defaultCurrencyCode ?? 'CNY',
                                                              )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    {!query.data?.storeCouponLedger.items.length ? (
                                        <p className="py-4 text-sm text-muted-foreground">暂无优惠券流水。</p>
                                    ) : null}
                                </div>
                            </CampaignState>
                        </PageBlock>
                    </>
                ) : null}

                {mode === 'FLASH_SALES' ? (
                    <PageBlock
                        column="full"
                        blockId="store-flash-sales"
                        title="限时秒杀"
                        description="活动时间内同时影响首页展示和购物车结算，不能只改前端显示价格。"
                    >
                        <CampaignState query={query} onRetry={() => void query.refetch()}>
                            <div className="space-y-3">
                                {query.data?.storeFlashSales.map(sale => (
                                    <div
                                        key={sale.id}
                                        className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center"
                                    >
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <strong className="text-sm">{sale.name}</strong>
                                                <Badge variant={sale.enabled ? 'default' : 'secondary'}>
                                                    {sale.enabled ? '启用' : '停用'}
                                                </Badge>
                                            </div>
                                            <p className="mt-1 text-xs text-muted-foreground">
                                                {sale.items.length} 个商品规格 ·{' '}
                                                {formatDateRange(sale.startsAt, sale.endsAt)}
                                            </p>
                                        </div>
                                        <Button
                                            type="button"
                                            size="icon-sm"
                                            variant="ghost"
                                            aria-label="修改秒杀活动名称"
                                            onClick={() => setEditingName({ id: sale.id, name: sale.name })}
                                        >
                                            <Pencil className="size-4" />
                                        </Button>
                                        <Switch
                                            checked={sale.enabled}
                                            disabled={sensitiveMutation.isPending}
                                            aria-label={`${sale.enabled ? '停用' : '启用'}秒杀活动 ${sale.name}`}
                                            onCheckedChange={enabled =>
                                                setSensitiveAction({
                                                    kind: 'TOGGLE',
                                                    id: sale.id,
                                                    name: sale.name,
                                                    enabled,
                                                })
                                            }
                                        />
                                        <Button
                                            type="button"
                                            size="icon-sm"
                                            variant="ghost"
                                            aria-label="删除秒杀"
                                            disabled={sensitiveMutation.isPending}
                                            onClick={() =>
                                                setSensitiveAction({
                                                    kind: 'DELETE_FLASH_SALE',
                                                    id: sale.id,
                                                    name: sale.name,
                                                })
                                            }
                                        >
                                            <Trash2 className="size-4" />
                                        </Button>
                                    </div>
                                ))}
                                {!query.data?.storeFlashSales.length ? (
                                    <p className="text-sm text-muted-foreground">还没有秒杀活动。</p>
                                ) : null}
                            </div>
                        </CampaignState>
                    </PageBlock>
                ) : null}
            </PageLayout>

            {mode === 'COUPONS' ? (
                <CouponEditor
                    open={couponOpen}
                    collections={query.data?.collections.items ?? []}
                    onClose={() => setCouponOpen(false)}
                    onSaved={async () => {
                        setCouponOpen(false);
                        await refresh();
                    }}
                />
            ) : (
                <FlashSaleEditor
                    open={flashOpen}
                    onClose={() => setFlashOpen(false)}
                    onSaved={async () => {
                        setFlashOpen(false);
                        await refresh();
                    }}
                />
            )}
            <SensitivePromotionDialog
                action={sensitiveAction}
                pending={sensitiveMutation.isPending}
                onClose={() => setSensitiveAction(null)}
                onConfirm={password =>
                    sensitiveAction
                        ? sensitiveMutation
                              .mutateAsync({ action: sensitiveAction, password })
                              .then(() => undefined)
                        : Promise.resolve()
                }
            />
            <PromotionNameDialog
                key={editingName?.id ?? 'closed'}
                promotion={editingName}
                pending={nameMutation.isPending}
                onClose={() => setEditingName(null)}
                onConfirm={name =>
                    editingName
                        ? nameMutation.mutateAsync({ id: editingName.id, name }).then(() => undefined)
                        : Promise.resolve()
                }
            />
        </Page>
    );
}

function SensitivePromotionDialog({
    action,
    pending,
    onClose,
    onConfirm,
}: {
    action: SensitivePromotionAction | null;
    pending: boolean;
    onClose: () => void;
    onConfirm: (password: string) => Promise<void>;
}) {
    const [password, setPassword] = useState('');
    const copy = action ? sensitiveActionCopy(action) : null;
    const close = () => {
        if (pending) return;
        setPassword('');
        onClose();
    };
    const submit = async () => {
        if (!password) {
            toast.error('请输入当前账号密码');
            return;
        }
        try {
            await onConfirm(password);
            setPassword('');
        } catch {
            // The mutation already displays the server error and the dialog stays open for correction.
        }
    };

    return (
        <Dialog open={Boolean(action)} onOpenChange={open => !open && close()}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ShieldAlert className="size-5 text-destructive" />
                        {copy?.title}
                    </DialogTitle>
                    <DialogDescription>{copy?.description}</DialogDescription>
                </DialogHeader>
                <FormField label="当前账号密码" hint="密码只用于本次操作校验，不会被保存。">
                    <Input
                        type="password"
                        autoComplete="current-password"
                        value={password}
                        onChange={event => setPassword(event.target.value)}
                        onKeyDown={event => {
                            if (event.key === 'Enter') void submit();
                        }}
                    />
                </FormField>
                <DialogFooter>
                    <Button variant="outline" disabled={pending} onClick={close}>
                        取消
                    </Button>
                    <Button
                        variant="destructive"
                        disabled={pending || !password}
                        onClick={() => void submit()}
                    >
                        {pending ? '正在处理' : copy?.confirmText}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function PromotionNameDialog({
    promotion,
    pending,
    onClose,
    onConfirm,
}: {
    promotion: { id: string; name: string } | null;
    pending: boolean;
    onClose: () => void;
    onConfirm: (name: string) => Promise<void>;
}) {
    const [name, setName] = useState(promotion?.name ?? '');
    const close = () => {
        if (!pending) onClose();
    };
    const submit = async () => {
        if (!name.trim()) {
            toast.error('活动名称不能为空');
            return;
        }
        try {
            await onConfirm(name.trim());
        } catch {
            // The mutation already displays the server error.
        }
    };

    return (
        <Dialog open={Boolean(promotion)} onOpenChange={open => !open && close()}>
            <DialogContent key={promotion?.id} className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>修改活动名称</DialogTitle>
                    <DialogDescription>修改名称不会改变优惠规则、价格、商品范围或有效期。</DialogDescription>
                </DialogHeader>
                <FormField label="活动名称">
                    <Input
                        autoFocus
                        maxLength={120}
                        defaultValue={promotion?.name ?? ''}
                        onChange={event => setName(event.target.value)}
                        onKeyDown={event => {
                            if (event.key === 'Enter') void submit();
                        }}
                    />
                </FormField>
                <DialogFooter>
                    <Button variant="outline" disabled={pending} onClick={close}>
                        取消
                    </Button>
                    <Button disabled={pending} onClick={() => void submit()}>
                        {pending ? '正在保存' : '保存名称'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function sensitiveActionCopy(action: SensitivePromotionAction) {
    if (action.kind === 'TOGGLE') {
        return {
            title: `${action.enabled ? '启用' : '停用'}秒杀活动“${action.name}”？`,
            description: action.enabled
                ? '启用后，活动时间内首页和购物车将立即使用秒杀价。'
                : '停用后，首页将停止展示，购物车重新计价时会移除秒杀优惠。',
            confirmText: action.enabled ? '确认启用' : '确认停用',
        };
    }
    if (action.kind === 'STOP_ISSUANCE') {
        return {
            title: `停止发放“${action.name}”？`,
            description: `停止后客户不能继续领取；已经发放的 ${action.claimedCount} 张券仍按原有效期和优惠规则使用。`,
            confirmText: '确认停止发放',
        };
    }
    if (action.kind === 'REVOKE_OUTSTANDING') {
        return {
            title: `批量作废“${action.name}”的未使用券？`,
            description: `预计影响 ${action.affectedCount} 张可用、返还或购物车锁定券。已核销券和历史订单不会改变。`,
            confirmText: '确认批量作废',
        };
    }
    return {
        title: `删除“${action.name}”？`,
        description:
            action.kind === 'DELETE_FLASH_SALE'
                ? '删除后首页和购物车将立即停止使用秒杀价，历史订单保留。'
                : '仅从未发放过的优惠券活动允许删除，操作后无法从后台恢复。',
        confirmText: '确认删除',
    };
}

function CouponEditor({
    open,
    collections,
    onClose,
    onSaved,
}: {
    open: boolean;
    collections: Array<{ id: string; name: string }>;
    onClose: () => void;
    onSaved: () => Promise<void>;
}) {
    const [draft, setDraft] = useState<CouponDraft>(() => newCouponDraft());
    const { requestClose, isDirty } = useDraftCloseGuard(open, draft, onClose);
    const [productPickerOpen, setProductPickerOpen] = useState(false);
    const mutation = useMutation({
        mutationFn: (value: CouponDraft) =>
            api.mutate(createStoreCouponCampaignMutation, { input: couponInput(value) }),
        onSuccess: async () => {
            toast.success('优惠券已创建');
            setDraft(newCouponDraft());
            await onSaved();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const update = <K extends keyof CouponDraft>(key: K, value: CouponDraft[K]) =>
        setDraft(current => ({ ...current, [key]: value }));
    const toggleCollection = (id: string) =>
        update(
            'collectionIds',
            draft.collectionIds.includes(id)
                ? draft.collectionIds.filter(current => current !== id)
                : [...draft.collectionIds, id],
        );
    const submit = () => {
        const validationError = couponDraftError(draft);
        if (validationError) {
            toast.error(validationError);
            return;
        }
        mutation.mutate(draft);
    };

    return (
        <>
            <UnsavedChangesConfirmation when={isDirty} />
            <Sheet open={open} onOpenChange={value => !value && requestClose()}>
                <SheetContent className="flex w-full max-w-none flex-col gap-0 overflow-hidden p-0 sm:w-[640px] sm:max-w-[640px]">
                    <SheetHeader className="shrink-0 border-b px-6 py-5 text-left">
                        <SheetTitle>新建优惠券</SheetTitle>
                        <SheetDescription>
                            设置优惠规则后，客户可在商城客户端领取；系统会自动生成内部识别码。
                        </SheetDescription>
                    </SheetHeader>
                    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                        <div className="grid gap-4 sm:grid-cols-2">
                            <FormField label="优惠券名称">
                                <Input
                                    value={draft.name}
                                    onChange={event => update('name', event.target.value)}
                                />
                            </FormField>
                            <FormField label="优惠券类型">
                                <Select
                                    value={draft.kind}
                                    onValueChange={value => value && update('kind', value)}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {(Object.keys(couponKindLabels) as StoreCouponKind[]).map(kind => (
                                            <SelectItem key={kind} value={kind}>
                                                {couponKindLabels[kind]}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </FormField>
                            <FormField label="最低消费金额" hint="0 表示无门槛，金额单位为店铺币种。">
                                <Input
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    value={draft.minimumSpend}
                                    onChange={event => update('minimumSpend', event.target.value)}
                                />
                            </FormField>
                            {draft.kind === 'ORDER_FIXED' ? (
                                <FormField label="减免金额">
                                    <Input
                                        type="number"
                                        min={0.01}
                                        step="0.01"
                                        value={draft.discountAmount}
                                        onChange={event => update('discountAmount', event.target.value)}
                                    />
                                </FormField>
                            ) : (
                                <FormField label="享受折扣" hint="例如 8.5 表示按 8.5 折结算。">
                                    <Input
                                        type="number"
                                        min={0.1}
                                        max={9.9}
                                        step="0.1"
                                        value={draft.discountRate}
                                        onChange={event => update('discountRate', event.target.value)}
                                    />
                                </FormField>
                            )}
                            {draft.kind === 'COLLECTION_PERCENTAGE' ? (
                                <FormField label="适用分类" className="sm:col-span-2">
                                    <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto rounded-md border p-3">
                                        {collections.map(collection => (
                                            <Button
                                                key={collection.id}
                                                type="button"
                                                size="sm"
                                                variant={
                                                    draft.collectionIds.includes(collection.id)
                                                        ? 'default'
                                                        : 'outline'
                                                }
                                                onClick={() => toggleCollection(collection.id)}
                                            >
                                                {collection.name}
                                            </Button>
                                        ))}
                                    </div>
                                </FormField>
                            ) : null}
                            {draft.kind === 'PRODUCT_PERCENTAGE' ? (
                                <FormField
                                    label="适用商品"
                                    className="sm:col-span-2"
                                    hint="选择器支持按分类筛选。"
                                >
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => setProductPickerOpen(true)}
                                    >
                                        <Plus className="size-4" />
                                        已选择 {draft.productIds.length} 个商品
                                    </Button>
                                    <ProductMultiSelectorDialog
                                        mode="product"
                                        initialSelectionIds={draft.productIds}
                                        onSelectionChange={ids => update('productIds', ids)}
                                        open={productPickerOpen}
                                        onOpenChange={setProductPickerOpen}
                                    />
                                </FormField>
                            ) : null}
                            <FormField label="优惠可用开始时间">
                                <Input
                                    type="datetime-local"
                                    value={draft.startsAt}
                                    onChange={event => update('startsAt', event.target.value)}
                                />
                            </FormField>
                            <FormField label="优惠可用结束时间">
                                <Input
                                    type="datetime-local"
                                    value={draft.endsAt}
                                    onChange={event => update('endsAt', event.target.value)}
                                />
                            </FormField>
                            <FormField label="总使用次数" hint="留空表示不限制。">
                                <Input
                                    type="number"
                                    min={1}
                                    value={draft.usageLimit}
                                    onChange={event => update('usageLimit', event.target.value)}
                                />
                            </FormField>
                            <FormField label="每位客户可用次数" hint="留空表示不限制。">
                                <Input
                                    type="number"
                                    min={1}
                                    value={draft.perCustomerUsageLimit}
                                    onChange={event => update('perCustomerUsageLimit', event.target.value)}
                                />
                            </FormField>
                            <FormField label="领取开始时间">
                                <Input
                                    type="datetime-local"
                                    value={draft.claimStartsAt}
                                    onChange={event => update('claimStartsAt', event.target.value)}
                                />
                            </FormField>
                            <FormField label="领取结束时间">
                                <Input
                                    type="datetime-local"
                                    value={draft.claimEndsAt}
                                    onChange={event => update('claimEndsAt', event.target.value)}
                                />
                            </FormField>
                            <FormField label="领取后有效天数" hint="留空则有效至活动结束。">
                                <Input
                                    type="number"
                                    min={1}
                                    value={draft.validityDays}
                                    onChange={event => update('validityDays', event.target.value)}
                                />
                            </FormField>
                            <FormField label="发放总量" hint="留空表示不限制领取数量。">
                                <Input
                                    type="number"
                                    min={1}
                                    value={draft.issueLimit}
                                    onChange={event => update('issueLimit', event.target.value)}
                                />
                            </FormField>
                            <FormField label="每位客户领取限制">
                                <div className="flex h-9 items-center rounded-md border bg-muted/30 px-3 text-sm">
                                    每个活动限领 1 张
                                </div>
                            </FormField>
                            <FormField label="叠加规则">
                                <Select
                                    value={draft.stackPolicy}
                                    onValueChange={value => value && update('stackPolicy', value)}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="EXCLUSIVE">不可与其他优惠券叠加</SelectItem>
                                        <SelectItem value="STACKABLE">允许叠加</SelectItem>
                                    </SelectContent>
                                </Select>
                            </FormField>
                            <FormField label="取消订单返券">
                                <div className="flex h-9 items-center justify-between rounded-md border px-3">
                                    <span className="text-sm">订单取消后恢复可用</span>
                                    <Switch
                                        checked={draft.returnOnCancellation}
                                        onCheckedChange={value => update('returnOnCancellation', value)}
                                    />
                                </div>
                            </FormField>
                            <FormField label="全额退款返券">
                                <div className="flex h-9 items-center justify-between rounded-md border px-3">
                                    <span className="text-sm">退款结算后恢复可用</span>
                                    <Switch
                                        checked={draft.returnOnFullRefund}
                                        onCheckedChange={value => update('returnOnFullRefund', value)}
                                    />
                                </div>
                            </FormField>
                        </div>
                    </div>
                    <SheetFooter className="shrink-0 border-t px-6 py-4">
                        <Button variant="outline" onClick={requestClose}>
                            取消
                        </Button>
                        <Button disabled={mutation.isPending} onClick={submit}>
                            {mutation.isPending ? '正在创建' : '创建优惠券'}
                        </Button>
                    </SheetFooter>
                </SheetContent>
            </Sheet>
        </>
    );
}

function FlashSaleEditor({
    open,
    onClose,
    onSaved,
}: {
    open: boolean;
    onClose: () => void;
    onSaved: () => Promise<void>;
}) {
    const { activeChannel } = useChannel();
    const [draft, setDraft] = useState<FlashSaleDraft>(() => newFlashSaleDraft());
    const { requestClose, isDirty } = useDraftCloseGuard(open, draft, onClose);
    const [productPickerOpen, setProductPickerOpen] = useState(false);
    const productQuery = useQuery({
        queryKey: ['store-promotion-products', activeChannel?.id, draft.productIds],
        queryFn: () =>
            api.query<StorePromotionProductsResult>(storePromotionProductsQuery, {
                ids: draft.productIds,
                take: Math.max(1, draft.productIds.length),
            }),
        enabled: open && draft.productIds.length > 0,
    });
    const products = productQuery.data?.products.items ?? [];
    const mutation = useMutation({
        mutationFn: (value: FlashSaleDraft) =>
            api.mutate(createStoreFlashSaleMutation, { input: flashSaleInput(value) }),
        onSuccess: async () => {
            toast.success('限时秒杀已创建');
            setDraft(newFlashSaleDraft());
            await onSaved();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const update = <K extends keyof FlashSaleDraft>(key: K, value: FlashSaleDraft[K]) =>
        setDraft(current => ({ ...current, [key]: value }));
    const submit = () => {
        const validationError = flashSaleDraftError(draft);
        if (validationError) {
            toast.error(validationError);
            return;
        }
        mutation.mutate(draft);
    };

    return (
        <>
            <UnsavedChangesConfirmation when={isDirty} />
            <Sheet open={open} onOpenChange={value => !value && requestClose()}>
                <SheetContent className="flex w-full max-w-none flex-col gap-0 overflow-hidden p-0 sm:w-[82vw] sm:max-w-[1200px]">
                    <SheetHeader className="shrink-0 border-b px-6 py-5 text-left">
                        <SheetTitle>新建限时秒杀</SheetTitle>
                        <SheetDescription>
                            先批量设置降价百分比，需要时再给某个规格填写单独秒杀价。
                        </SheetDescription>
                    </SheetHeader>
                    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                        <div className="grid gap-4 sm:grid-cols-2">
                            <FormField
                                label="活动名称"
                                className="sm:col-span-2"
                                hint="仅供管理后台识别，不会展示在客户端。"
                            >
                                <Input
                                    value={draft.name}
                                    onChange={event => update('name', event.target.value)}
                                />
                            </FormField>
                            <FormField
                                label="秒杀商品"
                                className="sm:col-span-2"
                                hint="选择器支持先按分类筛选商品。"
                            >
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setProductPickerOpen(true)}
                                >
                                    <Plus className="size-4" />
                                    已选择 {draft.productIds.length} 个商品
                                </Button>
                                <ProductMultiSelectorDialog
                                    mode="product"
                                    initialSelectionIds={draft.productIds}
                                    onSelectionChange={ids => update('productIds', ids)}
                                    open={productPickerOpen}
                                    onOpenChange={setProductPickerOpen}
                                />
                            </FormField>
                            <FormField label="批量降价百分比" hint="例如 20 表示统一降价 20%。">
                                <Input
                                    type="number"
                                    min={0}
                                    max={99}
                                    step="1"
                                    value={draft.percentageOff}
                                    onChange={event => update('percentageOff', event.target.value)}
                                />
                            </FormField>
                            <div />
                            <FormField label="开始时间">
                                <Input
                                    type="datetime-local"
                                    value={draft.startsAt}
                                    onChange={event => update('startsAt', event.target.value)}
                                />
                            </FormField>
                            <FormField label="结束时间">
                                <Input
                                    type="datetime-local"
                                    value={draft.endsAt}
                                    onChange={event => update('endsAt', event.target.value)}
                                />
                            </FormField>
                        </div>
                        {products.length ? (
                            <div className="space-y-3 border-t pt-4">
                                <h3 className="text-sm font-medium">单独规格秒杀价（可选）</h3>
                                {products.flatMap(product =>
                                    product.variants.map(variant => (
                                        <div
                                            key={variant.id}
                                            className="grid items-center gap-3 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_140px]"
                                        >
                                            <div className="min-w-0">
                                                <strong className="block truncate text-sm">
                                                    {product.name}
                                                </strong>
                                                <span className="text-xs text-muted-foreground">
                                                    {variant.name} · 原价{' '}
                                                    {formatMoney(variant.priceWithTax, variant.currencyCode)}
                                                </span>
                                            </div>
                                            <Input
                                                type="number"
                                                min={0}
                                                step="0.01"
                                                placeholder="单独秒杀价"
                                                value={draft.variantPrices[variant.id] ?? ''}
                                                onChange={event =>
                                                    update('variantPrices', {
                                                        ...draft.variantPrices,
                                                        [variant.id]: event.target.value,
                                                    })
                                                }
                                            />
                                        </div>
                                    )),
                                )}
                            </div>
                        ) : null}
                    </div>
                    <SheetFooter className="shrink-0 border-t px-6 py-4">
                        <Button variant="outline" onClick={requestClose}>
                            取消
                        </Button>
                        <Button disabled={mutation.isPending} onClick={submit}>
                            {mutation.isPending ? '正在创建' : '创建秒杀'}
                        </Button>
                    </SheetFooter>
                </SheetContent>
            </Sheet>
        </>
    );
}

function useDraftCloseGuard<T>(open: boolean, draft: T, onClose: () => void) {
    const [initialDraft, setInitialDraft] = useState<string | null>(null);
    const wasOpen = useRef(false);

    useEffect(() => {
        if (open && !wasOpen.current) setInitialDraft(JSON.stringify(draft));
        if (!open) setInitialDraft(null);
        wasOpen.current = open;
    }, [draft, open]);

    const isDirty = Boolean(open && initialDraft !== null && initialDraft !== JSON.stringify(draft));
    const requestClose = () => {
        if (isDirty && !window.confirm('有未保存的修改，确定放弃吗？')) return;
        onClose();
    };

    return { isDirty, requestClose };
}

function CampaignState({
    query,
    onRetry,
    children,
}: {
    query: { isPending: boolean; isError: boolean };
    onRetry: () => void;
    children: React.ReactNode;
}) {
    if (query.isPending)
        return (
            <div className="space-y-3">
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
            </div>
        );
    if (query.isError)
        return (
            <Alert variant="destructive">
                <AlertDescription className="flex items-center justify-between">
                    <span>营销活动加载失败</span>
                    <Button size="sm" variant="outline" onClick={onRetry}>
                        <RefreshCw className="size-4" />
                        重试
                    </Button>
                </AlertDescription>
            </Alert>
        );
    return children;
}

function FormField({
    label,
    hint,
    className,
    children,
}: {
    label: string;
    hint?: string;
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <div className={`space-y-2 ${className ?? ''}`}>
            <Label>{label}</Label>
            {children}
            {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
    );
}

function newCouponDraft(): CouponDraft {
    const range = defaultDateRange();
    return {
        name: '',
        kind: 'ORDER_FIXED',
        minimumSpend: '0',
        discountAmount: '1',
        discountRate: '8.5',
        collectionIds: [],
        productIds: [],
        startsAt: range.startsAt,
        endsAt: range.endsAt,
        usageLimit: '1',
        perCustomerUsageLimit: '1',
        claimStartsAt: range.startsAt,
        claimEndsAt: range.endsAt,
        validityDays: '1',
        issueLimit: '1',
        stackPolicy: 'EXCLUSIVE',
        returnOnCancellation: true,
        returnOnFullRefund: true,
    };
}

function couponDraftError(draft: CouponDraft): string | null {
    if (!draft.name.trim()) return '请填写优惠券名称';
    if (Number(draft.minimumSpend) < 0) return '最低消费金额不能小于 0';
    if (draft.kind === 'ORDER_FIXED' && Number(draft.discountAmount) <= 0) {
        return '请填写大于 0 的减免金额';
    }
    if (draft.kind !== 'ORDER_FIXED') {
        const rate = Number(draft.discountRate);
        if (!Number.isFinite(rate) || rate <= 0 || rate >= 10) return '折扣必须在 0 折到 10 折之间';
    }
    if (draft.kind === 'COLLECTION_PERCENTAGE' && !draft.collectionIds.length) {
        return '请选择至少一个适用分类';
    }
    if (draft.kind === 'PRODUCT_PERCENTAGE' && !draft.productIds.length) {
        return '请选择至少一个适用商品';
    }
    if (draft.startsAt && draft.endsAt && Date.parse(draft.startsAt) >= Date.parse(draft.endsAt)) {
        return '结束时间必须晚于开始时间';
    }
    if (
        draft.claimStartsAt &&
        draft.claimEndsAt &&
        Date.parse(draft.claimStartsAt) >= Date.parse(draft.claimEndsAt)
    ) {
        return '领取结束时间必须晚于领取开始时间';
    }
    if (draft.validityDays && Number(draft.validityDays) < 1) return '领取后有效天数必须大于 0';
    if (draft.issueLimit && Number(draft.issueLimit) < 1) return '发放总量必须大于 0';
    return null;
}

function newFlashSaleDraft(): FlashSaleDraft {
    const range = defaultDateRange();
    return {
        name: '',
        productIds: [],
        percentageOff: '20',
        startsAt: range.startsAt,
        endsAt: range.endsAt,
        variantPrices: {},
    };
}

function flashSaleDraftError(draft: FlashSaleDraft): string | null {
    if (!draft.name.trim()) return '请填写秒杀活动名称';
    if (!draft.productIds.length) return '请选择至少一个秒杀商品';
    const percentageOff = Number(draft.percentageOff);
    if (!Number.isFinite(percentageOff) || percentageOff <= 0 || percentageOff >= 100) {
        return '批量降价比例必须大于 0% 并且小于 100%';
    }
    if (!draft.startsAt || !draft.endsAt || Date.parse(draft.startsAt) >= Date.parse(draft.endsAt)) {
        return '请填写有效的活动时间，结束时间必须晚于开始时间';
    }
    const invalidPrice = Object.values(draft.variantPrices).some(
        value => value.trim() && (!Number.isFinite(Number(value)) || Number(value) < 0),
    );
    return invalidPrice ? '单独秒杀价必须是大于或等于 0 的金额' : null;
}

function defaultDateRange() {
    const start = new Date();
    const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1_000);
    return { startsAt: toLocalDateTime(start), endsAt: toLocalDateTime(end) };
}

function defaultCouponReportFilter(): CouponReportFilter {
    const to = new Date();
    const from = new Date(to.getTime() - 29 * 24 * 60 * 60 * 1_000);
    return {
        from: toLocalDate(from),
        to: toLocalDate(to),
        campaignId: 'ALL',
    };
}

function couponReportFilterError(filter: CouponReportFilter): Error | null {
    if (!filter.from || !filter.to) return new Error('请选择完整的报表日期区间');
    const from = Date.parse(`${filter.from}T00:00:00.000Z`);
    const to = Date.parse(`${filter.to}T00:00:00.000Z`);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return new Error('报表日期格式不正确');
    if (from > to) return new Error('报表结束日期不能早于开始日期');
    if ((to - from) / (24 * 60 * 60 * 1_000) + 1 > 366) {
        return new Error('单次报表查询最多支持 366 天');
    }
    return null;
}

function reportDateStart(value: string): string {
    return new Date(`${value}T00:00:00.000Z`).toISOString();
}

function reportDateExclusiveEnd(value: string): string {
    return new Date(Date.parse(`${value}T00:00:00.000Z`) + 24 * 60 * 60 * 1_000).toISOString();
}

function couponInput(draft: CouponDraft) {
    return {
        name: draft.name,
        kind: draft.kind,
        minimumSpend: moneyInput(draft.minimumSpend),
        discountAmount: draft.kind === 'ORDER_FIXED' ? moneyInput(draft.discountAmount) : null,
        discountRate: draft.kind === 'ORDER_FIXED' ? null : Number(draft.discountRate),
        collectionIds: draft.kind === 'COLLECTION_PERCENTAGE' ? draft.collectionIds : [],
        productIds: draft.kind === 'PRODUCT_PERCENTAGE' ? draft.productIds : [],
        startsAt: dateInput(draft.startsAt),
        endsAt: dateInput(draft.endsAt),
        usageLimit: integerInput(draft.usageLimit),
        perCustomerUsageLimit: integerInput(draft.perCustomerUsageLimit),
        claimStartsAt: dateInput(draft.claimStartsAt),
        claimEndsAt: dateInput(draft.claimEndsAt),
        validityDays: integerInput(draft.validityDays),
        issueLimit: integerInput(draft.issueLimit),
        perCustomerClaimLimit: 1,
        stackPolicy: draft.stackPolicy,
        returnOnCancellation: draft.returnOnCancellation,
        returnOnFullRefund: draft.returnOnFullRefund,
    };
}

function flashSaleInput(draft: FlashSaleDraft) {
    return {
        name: draft.name,
        productIds: draft.productIds,
        percentageOff: Number(draft.percentageOff),
        startsAt: dateInput(draft.startsAt),
        endsAt: dateInput(draft.endsAt),
        variantPrices: Object.entries(draft.variantPrices).flatMap(([productVariantId, value]) =>
            value.trim() ? [{ productVariantId, salePrice: moneyInput(value) }] : [],
        ),
    };
}

function moneyInput(value: string): number {
    return Math.round((Number(value) || 0) * 100);
}
function integerInput(value: string): number | null {
    return value.trim() ? Math.round(Number(value)) : null;
}
function dateInput(value: string): string | null {
    return value ? new Date(value).toISOString() : null;
}
function toLocalDateTime(value: Date): string {
    const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
}
function toLocalDate(value: Date): string {
    const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 10);
}
function formatDateRange(startsAt: string | null, endsAt: string | null): string {
    return `${startsAt ? new Date(startsAt).toLocaleString() : '立即'} 至 ${endsAt ? new Date(endsAt).toLocaleString() : '长期'}`;
}
function formatMoney(value: number, currencyCode: string): string {
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: currencyCode }).format(value / 100);
}
function formatRate(value: number, total: number): string {
    return total > 0 ? `${((value / total) * 100).toFixed(1)}%` : '0.0%';
}
function formatMultiple(value: number, cost: number): string {
    return cost > 0 ? `${(value / cost).toFixed(2)}×` : '—';
}
function couponIssuanceIsActive(
    coupon: StorePromotionCampaignsResult['storeCouponCampaigns'][number],
): boolean {
    const now = Date.now();
    return Boolean(
        coupon.enabled &&
        (!coupon.claimStartsAt || Date.parse(coupon.claimStartsAt) <= now) &&
        (!coupon.claimEndsAt || Date.parse(coupon.claimEndsAt) > now) &&
        (coupon.remainingIssueCount == null || coupon.remainingIssueCount > 0),
    );
}
function couponIssuanceCanBeStopped(
    coupon: StorePromotionCampaignsResult['storeCouponCampaigns'][number],
): boolean {
    const now = Date.now();
    return Boolean(
        coupon.enabled &&
        (!coupon.claimEndsAt || Date.parse(coupon.claimEndsAt) > now) &&
        (coupon.remainingIssueCount == null || coupon.remainingIssueCount > 0),
    );
}
function couponIssuanceStatusLabel(
    coupon: StorePromotionCampaignsResult['storeCouponCampaigns'][number],
): string {
    const now = Date.now();
    if (!coupon.enabled) return '活动已停用';
    if (coupon.remainingIssueCount === 0) return '已领完';
    if (coupon.claimEndsAt && Date.parse(coupon.claimEndsAt) <= now) return '已停止发放';
    if (coupon.claimStartsAt && Date.parse(coupon.claimStartsAt) > now) return '待开始';
    return '发放中';
}
function exportCouponReport(
    coupons: StorePromotionCampaignsResult['storeCouponCampaigns'],
    currencyCode: string,
) {
    const rows: Array<Array<string | number>> = [
        [
            '活动名称',
            '优惠券类型',
            '发放状态',
            '累计发放',
            '当前可用',
            '购物车锁定',
            '当前已用',
            '当前已用率',
            '当前返还',
            '当前过期',
            '当前作废',
            '历史核销订单数',
            '退款订单数',
            `历史优惠金额(${currencyCode})`,
            `优惠券归因订单金额-含后续退款(${currencyCode})`,
            '优惠产出比',
        ],
        ...coupons.map(coupon => [
            coupon.name,
            couponKindLabels[coupon.kind],
            couponIssuanceStatusLabel(coupon),
            coupon.claimedCount,
            coupon.availableCount,
            coupon.lockedCount,
            coupon.usedCount,
            formatRate(coupon.usedCount, coupon.claimedCount),
            coupon.returnedCount,
            coupon.expiredCount,
            coupon.revokedCount,
            coupon.redeemedOrderCount,
            coupon.refundedOrderCount,
            (coupon.discountAmountTotal / 100).toFixed(2),
            (coupon.assistedRevenueTotal / 100).toFixed(2),
            formatMultiple(coupon.assistedRevenueTotal, coupon.discountAmountTotal),
        ]),
    ];
    const csv = `\uFEFF${rows.map(row => row.map(csvValue).join(',')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `优惠券经营报表-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
function exportCouponDailyReport(
    metrics: StoreCouponDailyReportResult['storeCouponDailyReport'],
    currencyCode: string,
    filter: CouponReportFilter,
) {
    const rows: Array<Array<string | number>> = [
        [
            '日期',
            '发放数量',
            '核销订单数',
            '退款订单数',
            '返还事件数',
            '过期事件数',
            '作废事件数',
            `优惠金额(${currencyCode})`,
            `优惠券归因订单金额(${currencyCode})`,
        ],
        ...metrics.map(item => [
            item.date,
            item.claimedCount,
            item.redeemedCount,
            item.refundedCount,
            item.returnedCount,
            item.expiredCount,
            item.revokedCount,
            (item.discountAmountTotal / 100).toFixed(2),
            (item.assistedRevenueTotal / 100).toFixed(2),
        ]),
    ];
    const csv = `\uFEFF${rows.map(row => row.map(csvValue).join(',')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `优惠券区间日报-${filter.from}-${filter.to}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
function csvValue(value: string | number): string {
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function couponSummary(coupon: StorePromotionCampaignsResult['storeCouponCampaigns'][number]): string {
    const threshold = coupon.minimumSpend ? `满 ${coupon.minimumSpend / 100}` : '无门槛';
    return coupon.discountAmount != null
        ? `${threshold} 减 ${coupon.discountAmount / 100}`
        : `${threshold} 享 ${coupon.discountRate ?? '-'} 折`;
}
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
