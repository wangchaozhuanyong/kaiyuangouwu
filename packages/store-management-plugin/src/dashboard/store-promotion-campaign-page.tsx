import {
    Alert,
    AlertDescription,
    Badge,
    Button,
    ConfirmationDialog,
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
    Skeleton,
    Switch,
    api,
    toast,
    useChannel,
    useMutation,
    useQuery,
    useQueryClient,
} from '@vendure/dashboard';
import { BadgePercent, Flame, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';

import {
    StoreCouponKind,
    StorePromotionCampaignsResult,
    StorePromotionProductsResult,
    createStoreCouponCampaignMutation,
    createStoreFlashSaleMutation,
    deleteStorePromotionMutation,
    setStorePromotionEnabledMutation,
    storePromotionCampaignsQuery,
    storePromotionProductsQuery,
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
    perCustomerClaimLimit: string;
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
    const [couponOpen, setCouponOpen] = useState(false);
    const [flashOpen, setFlashOpen] = useState(false);
    const query = useQuery({
        queryKey,
        queryFn: () => api.query<StorePromotionCampaignsResult>(storePromotionCampaignsQuery),
        enabled: Boolean(activeChannel?.id),
    });
    const refresh = () => queryClient.invalidateQueries({ queryKey });
    const toggleMutation = useMutation({
        mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
            api.mutate(setStorePromotionEnabledMutation, { id, enabled }),
        onSuccess: refresh,
        onError: error => toast.error(errorMessage(error)),
    });
    const deleteMutation = useMutation({
        mutationFn: (id: string) => api.mutate(deleteStorePromotionMutation, { id }),
        onSuccess: async () => {
            toast.success('活动已删除');
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
                                                            variant={coupon.enabled ? 'default' : 'secondary'}
                                                        >
                                                            {coupon.enabled ? '启用' : '停用'}
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
                                                <div className="flex items-center gap-2">
                                                    <Switch
                                                        checked={coupon.enabled}
                                                        disabled={toggleMutation.isPending}
                                                        onCheckedChange={enabled =>
                                                            toggleMutation.mutate({ id: coupon.id, enabled })
                                                        }
                                                    />
                                                    <ConfirmationDialog
                                                        title="删除这张优惠券？"
                                                        description="删除后客户将不能再领取或使用该优惠券。"
                                                        confirmText="确认删除"
                                                        cancelText="取消"
                                                        onConfirm={() => deleteMutation.mutate(coupon.id)}
                                                    >
                                                        <Button
                                                            type="button"
                                                            size="icon-sm"
                                                            variant="ghost"
                                                            aria-label="删除优惠券"
                                                            disabled={deleteMutation.isPending}
                                                        >
                                                            <Trash2 className="size-4" />
                                                        </Button>
                                                    </ConfirmationDialog>
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
                                        <Switch
                                            checked={sale.enabled}
                                            disabled={toggleMutation.isPending}
                                            onCheckedChange={enabled =>
                                                toggleMutation.mutate({ id: sale.id, enabled })
                                            }
                                        />
                                        <ConfirmationDialog
                                            title="删除这个秒杀活动？"
                                            description="删除后首页和购物车将立即停止使用该秒杀价。"
                                            confirmText="确认删除"
                                            cancelText="取消"
                                            onConfirm={() => deleteMutation.mutate(sale.id)}
                                        >
                                            <Button
                                                type="button"
                                                size="icon-sm"
                                                variant="ghost"
                                                aria-label="删除秒杀"
                                                disabled={deleteMutation.isPending}
                                            >
                                                <Trash2 className="size-4" />
                                            </Button>
                                        </ConfirmationDialog>
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
        </Page>
    );
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
        <Dialog open={open} onOpenChange={value => !value && onClose()}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>新建优惠券</DialogTitle>
                    <DialogDescription>
                        设置优惠规则后，客户可在商城客户端领取；系统会自动生成内部识别码。
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 sm:grid-cols-2">
                    <FormField label="优惠券名称">
                        <Input value={draft.name} onChange={event => update('name', event.target.value)} />
                    </FormField>
                    <FormField label="优惠券类型">
                        <Select value={draft.kind} onValueChange={value => value && update('kind', value)}>
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
                        <FormField label="适用商品" className="sm:col-span-2" hint="选择器支持按分类筛选。">
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
                    <FormField label="每位客户可领取张数">
                        <Input
                            type="number"
                            min={1}
                            value={draft.perCustomerClaimLimit}
                            onChange={event => update('perCustomerClaimLimit', event.target.value)}
                        />
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
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        取消
                    </Button>
                    <Button disabled={mutation.isPending} onClick={submit}>
                        {mutation.isPending ? '正在创建' : '创建优惠券'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
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
    const [draft, setDraft] = useState<FlashSaleDraft>(() => newFlashSaleDraft());
    const [productPickerOpen, setProductPickerOpen] = useState(false);
    const productQuery = useQuery({
        queryKey: ['store-promotion-products', draft.productIds],
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
        <Dialog open={open} onOpenChange={value => !value && onClose()}>
            <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>新建限时秒杀</DialogTitle>
                    <DialogDescription>
                        先批量设置降价百分比，需要时再给某个规格填写单独秒杀价。
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 sm:grid-cols-2">
                    <FormField label="活动名称" className="sm:col-span-2">
                        <Input value={draft.name} onChange={event => update('name', event.target.value)} />
                    </FormField>
                    <FormField label="秒杀商品" className="sm:col-span-2" hint="选择器支持先按分类筛选商品。">
                        <Button type="button" variant="outline" onClick={() => setProductPickerOpen(true)}>
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
                                        <strong className="block truncate text-sm">{product.name}</strong>
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
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        取消
                    </Button>
                    <Button disabled={mutation.isPending} onClick={submit}>
                        {mutation.isPending ? '正在创建' : '创建秒杀'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
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
        perCustomerClaimLimit: '1',
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
    if (Number(draft.perCustomerClaimLimit) < 1) return '每位客户领取张数必须大于 0';
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
        perCustomerClaimLimit: integerInput(draft.perCustomerClaimLimit),
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
function formatDateRange(startsAt: string | null, endsAt: string | null): string {
    return `${startsAt ? new Date(startsAt).toLocaleString() : '立即'} 至 ${endsAt ? new Date(endsAt).toLocaleString() : '长期'}`;
}
function formatMoney(value: number, currencyCode: string): string {
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: currencyCode }).format(value / 100);
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
