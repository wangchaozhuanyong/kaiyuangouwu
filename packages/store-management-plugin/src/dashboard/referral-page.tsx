/* eslint-disable max-len -- Tailwind utility strings must remain intact for static extraction. */
import {
    Alert,
    AlertDescription,
    Asset,
    AssetPickerDialog,
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
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Skeleton,
    Switch,
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
    Textarea,
    UnsavedChangesConfirmation,
    api,
    toast,
    useChannel,
    useMutation,
    usePermissions,
    useQuery,
} from '@vendure/dashboard';
import {
    Gift,
    ImagePlus,
    LoaderCircle,
    Pencil,
    Plus,
    RefreshCw,
    Save,
    Search,
    Trash2,
    WalletCards,
    X,
} from 'lucide-react';
import { ReactNode, useEffect, useState } from 'react';

import {
    ReferralCustomerRecord,
    ReferralCustomerWalletRecord,
    ReferralInviterSummaryRecord,
    ReferralLedgerRecord,
    ReferralPosterTemplateRecord,
    ReferralProgramRecord,
    ReferralRelationshipRecord,
    ReferralReportsResult,
    ReferralRewardRecord,
    ReferralTodayMetricsResult,
    ReferralWithdrawalRecord,
    adjustReferralBalanceMutation,
    createReferralPosterTemplateMutation,
    createReferralWithdrawalMutation,
    deleteReferralPosterTemplateMutation,
    processReferralWithdrawalMutation,
    referralCustomerLookupQuery,
    referralCustomerWalletsQuery,
    referralProgramQuery,
    referralReportsQuery,
    referralTodayMetricsQuery,
    updateReferralPosterTemplateMutation,
    updateReferralProgramMutation,
} from './referral.graphql';

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

interface CustomerLookupResult {
    customers: { items: ReferralCustomerRecord[] };
}

interface WithdrawalDraft {
    customer: ReferralCustomerRecord | null;
    currencyCode: string;
    amount: string;
    payoutMethod: string;
    payoutAccountMasked: string;
    note: string;
}

const REPORT_PAGE_SIZE = 50;

export const referralRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'marketing',
        id: 'referral-rewards',
        url: '/referral-rewards',
        title: '邀请返利',
        icon: Gift,
        order: 30,
        requiresPermission: ['ReadReferral'],
    },
    path: '/referral-rewards',
    loader: () => ({ breadcrumb: () => '邀请返利' }),
    component: () => <ReferralAdminPage />,
};

function ReferralAdminPage() {
    const { activeChannel } = useChannel();
    const { hasPermissions } = usePermissions();
    const [draft, setDraft] = useState<ProgramDraft | null>(null);
    const [reportSkips, setReportSkips] = useState({
        summaries: 0,
        relationships: 0,
        rewards: 0,
        ledger: 0,
        withdrawals: 0,
    });
    const canUpdate = hasPermissions(['UpdateReferral']);
    const canWithdraw = hasPermissions(['ManageReferralWithdrawal']);
    const canAdjust = hasPermissions(['AdjustReferralBalance']);
    const program = useQuery({
        queryKey: ['referral-program-admin', activeChannel?.id],
        queryFn: () => api.query<{ referralProgram: ReferralProgramRecord }>(referralProgramQuery),
        enabled: Boolean(activeChannel?.id),
    });
    const reports = useQuery({
        queryKey: ['referral-reports-admin', activeChannel?.id, reportSkips],
        queryFn: () =>
            api.query<ReferralReportsResult>(referralReportsQuery, {
                take: REPORT_PAGE_SIZE,
                summarySkip: reportSkips.summaries,
                relationshipSkip: reportSkips.relationships,
                rewardSkip: reportSkips.rewards,
                ledgerSkip: reportSkips.ledger,
                withdrawalSkip: reportSkips.withdrawals,
            }),
        enabled: Boolean(activeChannel?.id),
    });
    const metrics = useQuery({
        queryKey: ['referral-today-metrics', activeChannel?.id],
        queryFn: () => api.query<ReferralTodayMetricsResult>(referralTodayMetricsQuery),
        enabled: Boolean(activeChannel?.id),
        refetchInterval: 60_000,
    });

    useEffect(() => {
        if (program.data?.referralProgram) setDraft(programDraft(program.data.referralProgram));
    }, [program.data?.referralProgram, activeChannel?.id]);

    const save = useMutation({
        mutationFn: (value: ProgramDraft) =>
            api.mutate<{ updateReferralProgram: ReferralProgramRecord }>(updateReferralProgramMutation, {
                input: {
                    ...value,
                    minimumOrderAmount: toMinorAmount(value.minimumOrderAmount),
                    maxRewardPerOrder: value.maxRewardPerOrder.trim()
                        ? toMinorAmount(value.maxRewardPerOrder)
                        : null,
                },
            }),
        onSuccess: result => {
            setDraft(programDraft(result.updateReferralProgram));
            void program.refetch();
            toast.success('邀请返利设置已保存');
        },
        onError: error => toast.error(errorMessage(error)),
    });

    const refreshAll = async () => {
        await Promise.all([program.refetch(), reports.refetch(), metrics.refetch()]);
    };
    const isProgramDirty = Boolean(
        draft &&
        program.data?.referralProgram &&
        JSON.stringify(draft) !== JSON.stringify(programDraft(program.data.referralProgram)),
    );

    return (
        <Page pageId="referral-rewards">
            <UnsavedChangesConfirmation when={isProgramDirty} />
            <PageTitle>邀请返利</PageTitle>
            <PageActionBar>
                <PageActionBarRight>
                    <Button variant="outline" type="button" onClick={() => void refreshAll()}>
                        <RefreshCw className="size-4" />
                        刷新
                    </Button>
                    {canUpdate && (
                        <Button
                            type="button"
                            disabled={!draft || save.isPending}
                            onClick={() =>
                                draft && validProgramDraft(draft)
                                    ? save.mutate(draft)
                                    : toast.error('请检查返利比例、金额和生效天数')
                            }
                        >
                            {save.isPending ? (
                                <LoaderCircle className="size-4 animate-spin" />
                            ) : (
                                <Save className="size-4" />
                            )}
                            保存设置
                        </Button>
                    )}
                </PageActionBarRight>
            </PageActionBar>
            <PageLayout>
                <PageBlock
                    column="main"
                    blockId="referral-today"
                    title="今日经营概览"
                    description="按北京时间和支付结算日统计；访客按 IP 去重；订单、消费客户和成交额以已结算支付扣除已结算退款后的净实收为准。"
                >
                    <TodayMetrics query={metrics} />
                </PageBlock>
                <PageBlock column="main" blockId="referral-management" title="功能设置与全链路报表">
                    <Tabs defaultValue="settings">
                        <TabsList className="mb-4 flex h-auto flex-wrap">
                            <TabsTrigger value="settings">功能设置</TabsTrigger>
                            <TabsTrigger value="relationships">邀请报表</TabsTrigger>
                            <TabsTrigger value="rewards">返利与退款</TabsTrigger>
                            <TabsTrigger value="ledger">详细流水</TabsTrigger>
                            <TabsTrigger value="withdrawals">人工提款</TabsTrigger>
                        </TabsList>
                        <TabsContent value="settings">
                            {program.isPending || !draft ? (
                                <SettingsSkeleton />
                            ) : program.isError ? (
                                <QueryError onRetry={() => void program.refetch()} />
                            ) : (
                                <div className="space-y-8">
                                    <ProgramSettings
                                        draft={draft}
                                        setDraft={setDraft}
                                        disabled={!canUpdate}
                                        templates={program.data?.referralProgram.posterTemplates ?? []}
                                        customTemplates={
                                            program.data?.referralProgram.posterTemplateConfigs ?? []
                                        }
                                    />
                                    <PosterTemplateManager
                                        templates={program.data?.referralProgram.posterTemplateConfigs ?? []}
                                        disabled={!canUpdate}
                                        defaultTemplate={draft.defaultPosterTemplate}
                                        onMakeDefault={id =>
                                            setDraft({ ...draft, defaultPosterTemplate: id })
                                        }
                                        onChanged={() => void program.refetch()}
                                    />
                                </div>
                            )}
                        </TabsContent>
                        <TabsContent value="relationships">
                            <RelationshipReport
                                summaries={reports.data?.referralInviterSummaries.items ?? []}
                                summaryTotal={reports.data?.referralInviterSummaries.totalItems ?? 0}
                                summarySkip={reportSkips.summaries}
                                onSummarySkipChange={skip =>
                                    setReportSkips(value => ({ ...value, summaries: skip }))
                                }
                                items={reports.data?.referralRelationships.items ?? []}
                                loading={reports.isPending}
                                total={reports.data?.referralRelationships.totalItems ?? 0}
                                skip={reportSkips.relationships}
                                onSkipChange={skip =>
                                    setReportSkips(value => ({ ...value, relationships: skip }))
                                }
                            />
                        </TabsContent>
                        <TabsContent value="rewards">
                            <RewardReport
                                items={reports.data?.referralRewards.items ?? []}
                                loading={reports.isPending}
                                total={reports.data?.referralRewards.totalItems ?? 0}
                                skip={reportSkips.rewards}
                                onSkipChange={skip => setReportSkips(value => ({ ...value, rewards: skip }))}
                            />
                        </TabsContent>
                        <TabsContent value="ledger">
                            <LedgerReport
                                audit={reports.data?.referralBalanceAudit}
                                items={reports.data?.referralLedger.items ?? []}
                                loading={reports.isPending}
                                total={reports.data?.referralLedger.totalItems ?? 0}
                                skip={reportSkips.ledger}
                                onSkipChange={skip => setReportSkips(value => ({ ...value, ledger: skip }))}
                            />
                        </TabsContent>
                        <TabsContent value="withdrawals">
                            <WithdrawalManagement
                                items={reports.data?.referralWithdrawals.items ?? []}
                                loading={reports.isPending}
                                total={reports.data?.referralWithdrawals.totalItems ?? 0}
                                skip={reportSkips.withdrawals}
                                onSkipChange={skip =>
                                    setReportSkips(value => ({ ...value, withdrawals: skip }))
                                }
                                canWithdraw={canWithdraw}
                                canAdjust={canAdjust}
                                defaultCurrency={activeChannel?.defaultCurrencyCode ?? 'CNY'}
                                onChanged={() => void Promise.all([reports.refetch(), metrics.refetch()])}
                            />
                        </TabsContent>
                    </Tabs>
                </PageBlock>
            </PageLayout>
        </Page>
    );
}

function TodayMetrics({ query }: { query: ReturnType<typeof useQuery<ReferralTodayMetricsResult>> }) {
    if (query.isPending)
        return (
            <div className="grid gap-3 sm:grid-cols-4">
                {Array.from({ length: 8 }, (_, index) => (
                    <Skeleton key={index} className="h-20" />
                ))}
            </div>
        );
    if (query.isError || !query.data) return <QueryError onRetry={() => void query.refetch()} />;
    const value = query.data.referralTodayMetrics;
    const cards = [
        ['今日访客', value.visitorCount],
        ['新增注册', value.newCustomerCount],
        ['消费客户', value.consumerCount],
        ['首次消费', value.firstTimeConsumerCount],
        ['老客复购', value.returningConsumerCount],
        ['成功订单', value.orderCount],
        ['今日邀请', value.todayInvitedCount],
        ['受邀后首购', value.todayInvitedPurchaserCount],
    ] as const;
    return (
        <div>
            <div className="grid gap-3 sm:grid-cols-4">
                {cards.map(([label, number]) => (
                    <div key={label} className="rounded-lg border bg-muted/20 p-4">
                        <span className="text-sm text-muted-foreground">{label}</span>
                        <strong className="mt-1 block text-2xl tabular-nums">{number}</strong>
                    </div>
                ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
                {value.salesByCurrency.map(item => (
                    <Badge key={item.currencyCode} variant="outline">
                        今日成交额 {formatMoney(item.sales, item.currencyCode)}
                    </Badge>
                ))}
                <Badge variant="secondary">统计日期 {value.businessDate}</Badge>
            </div>
        </div>
    );
}

function ProgramSettings({
    draft,
    setDraft,
    disabled,
    templates,
    customTemplates,
}: {
    draft: ProgramDraft;
    setDraft: (draft: ProgramDraft) => void;
    disabled: boolean;
    templates: string[];
    customTemplates: ReferralPosterTemplateRecord[];
}) {
    const update = <K extends keyof ProgramDraft>(key: K, value: ProgramDraft[K]) =>
        setDraft({ ...draft, [key]: value });
    return (
        <div className="grid gap-5 sm:grid-cols-2">
            <BooleanField
                label="开启客户端邀请返利"
                checked={draft.enabled}
                disabled={disabled}
                onChange={value => update('enabled', value)}
                description="关闭后注册页、我的页面入口和邀请页均不显示；已有流水与余额不会删除。"
            />
            <BooleanField
                label="允许余额购物抵扣"
                checked={draft.allowBalanceSpend}
                disabled={disabled}
                onChange={value => update('allowBalanceSpend', value)}
                description="关闭后客户暂时不能使用余额，但奖励、退款扣回和报表继续运行。"
            />
            <Field label="返利比例（%）">
                <Input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={draft.rewardRate}
                    disabled={disabled}
                    onChange={event => update('rewardRate', Number(event.target.value))}
                />
                <Help>按受邀客户成功订单的有效商品实付金额计算，不含运费和返利余额支付部分。</Help>
            </Field>
            <Field label="奖励等待生效（天）">
                <Input
                    type="number"
                    min={0}
                    max={30}
                    step={1}
                    value={draft.releaseDelayDays}
                    disabled={disabled}
                    onChange={event => update('releaseDelayDays', Number(event.target.value))}
                />
                <Help>订单成功后先进入待生效余额，降低短期退款风险。</Help>
            </Field>
            <Field label="最低有效消费金额">
                <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={draft.minimumOrderAmount}
                    disabled={disabled}
                    onChange={event => update('minimumOrderAmount', event.target.value)}
                />
            </Field>
            <Field label="单笔返利上限（留空不限）">
                <Input
                    type="number"
                    min={0.01}
                    step="0.01"
                    value={draft.maxRewardPerOrder}
                    disabled={disabled}
                    onChange={event => update('maxRewardPerOrder', event.target.value)}
                />
            </Field>
            <Field label="邀请归因有效期（天）">
                <Input
                    type="number"
                    min={1}
                    max={365}
                    step={1}
                    value={draft.attributionWindowDays}
                    disabled={disabled}
                    onChange={event => update('attributionWindowDays', Number(event.target.value))}
                />
                <Help>客户打开邀请链接后，在该期限内注册会自动带入邀请码，最长 365 天。</Help>
            </Field>
            <Field label="默认分享海报">
                <Select
                    value={draft.defaultPosterTemplate}
                    disabled={disabled}
                    onValueChange={value => value && update('defaultPosterTemplate', value)}
                >
                    <SelectTrigger>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {templates.map(template => (
                            <SelectItem key={template} value={template}>
                                {posterLabel(template)}
                            </SelectItem>
                        ))}
                        {customTemplates
                            .filter(template => template.enabled)
                            .map(template => (
                                <SelectItem key={template.id} value={template.id}>
                                    {template.name}
                                </SelectItem>
                            ))}
                    </SelectContent>
                </Select>
                <Help>新建并启用自定义模板后，客户端只展示当前店铺的自定义模板。</Help>
            </Field>
            {!disabled && (
                <Alert className="sm:col-span-2">
                    <AlertDescription>
                        奖励只在受邀人的订单进入成功支付状态后生成；成功退款会按比例自动扣回。返利余额默认只能消费，人工提款必须由拥有“管理邀请返利提款”权限的账号处理。
                    </AlertDescription>
                </Alert>
            )}
        </div>
    );
}

interface PosterTemplateDraft {
    id?: string;
    name: string;
    enabled: boolean;
    position: number;
    layoutVariant: 'STANDARD_CENTER';
    posterBackgroundAsset: Asset | null;
    shareBackgroundAsset: Asset | null;
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

function PosterTemplateManager({
    templates,
    disabled,
    defaultTemplate,
    onMakeDefault,
    onChanged,
}: {
    templates: ReferralPosterTemplateRecord[];
    disabled: boolean;
    defaultTemplate: string;
    onMakeDefault: (id: string) => void;
    onChanged: () => void;
}) {
    const [draft, setDraft] = useState<PosterTemplateDraft | null>(null);
    const [assetTarget, setAssetTarget] = useState<'poster' | 'share' | null>(null);
    const createTemplate = useMutation({
        mutationFn: (value: PosterTemplateDraft) =>
            api.mutate<{ createReferralPosterTemplate: ReferralPosterTemplateRecord }>(
                createReferralPosterTemplateMutation,
                { input: posterTemplateInput(value) },
            ),
        onSuccess: result => {
            toast.success('海报模板已创建');
            setDraft(null);
            onChanged();
            if (templates.length === 0) onMakeDefault(result.createReferralPosterTemplate.id);
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const updateTemplate = useMutation({
        mutationFn: (value: PosterTemplateDraft & { id: string }) =>
            api.mutate<{ updateReferralPosterTemplate: ReferralPosterTemplateRecord }>(
                updateReferralPosterTemplateMutation,
                { input: { id: value.id, ...posterTemplateInput(value) } },
            ),
        onSuccess: () => {
            toast.success('海报模板已保存');
            setDraft(null);
            onChanged();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const deleteTemplate = useMutation({
        mutationFn: (id: string) =>
            api.mutate<{ deleteReferralPosterTemplate: { result: string; message?: string | null } }>(
                deleteReferralPosterTemplateMutation,
                { id },
            ),
        onSuccess: result => {
            if (result.deleteReferralPosterTemplate.result !== 'DELETED') {
                toast.error(result.deleteReferralPosterTemplate.message ?? '模板未删除');
                return;
            }
            toast.success('海报模板已删除');
            onChanged();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const pending = createTemplate.isPending || updateTemplate.isPending;
    const saveTemplate = () => {
        if (!draft || !validPosterTemplateDraft(draft)) {
            toast.error('请检查模板名称、中英文标题、奖励文案和颜色');
            return;
        }
        if (draft.id) updateTemplate.mutate(draft as PosterTemplateDraft & { id: string });
        else createTemplate.mutate(draft);
    };

    return (
        <section className="border-t pt-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h3 className="m-0 text-base font-semibold">店铺邀请海报模板</h3>
                    <p className="mb-0 mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                        店铺可按行业上传任意背景图。平台统一叠加标题、奖励文案、邀请码和二维码，避免图片与动态内容错位。
                    </p>
                </div>
                <Button
                    type="button"
                    variant="outline"
                    disabled={disabled}
                    onClick={() => setDraft(emptyPosterTemplateDraft(templates.length))}
                >
                    <Plus className="size-4" />
                    新增模板
                </Button>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {templates.map(template => (
                    <article key={template.id} className="overflow-hidden rounded-xl border bg-card">
                        <div className="relative aspect-[2/3] overflow-hidden bg-slate-900">
                            {template.posterBackgroundAsset ? (
                                <img
                                    src={template.posterBackgroundAsset.preview}
                                    alt=""
                                    className="size-full object-cover"
                                />
                            ) : (
                                <div className="grid size-full place-items-center bg-[linear-gradient(145deg,#172554,#7c3aed,#db2777)] text-sm font-semibold text-white/80">
                                    待上传竖版背景
                                </div>
                            )}
                            <div className="absolute inset-0 bg-black/25" />
                            <div className="absolute inset-x-5 top-5 text-white">
                                <small className="font-bold">{template.titleZh}</small>
                                <strong className="mt-3 block text-xl leading-tight">
                                    {template.headlineZh}
                                </strong>
                            </div>
                            <div className="absolute inset-x-5 top-[43%] rounded-xl bg-white/95 p-3 text-center text-xs font-bold text-slate-800 shadow">
                                二维码与邀请码安全区
                            </div>
                            <div className="absolute inset-x-5 bottom-5 rounded-lg border border-white/25 bg-black/30 px-3 py-2 text-[11px] text-white backdrop-blur">
                                {template.serviceTextZh || '店铺服务说明'}
                            </div>
                        </div>
                        <div className="space-y-3 p-4">
                            <div className="flex items-center justify-between gap-2">
                                <strong className="truncate">{template.name}</strong>
                                <div className="flex gap-1">
                                    <Badge variant={template.enabled ? 'secondary' : 'outline'}>
                                        {template.enabled ? '已启用' : '已停用'}
                                    </Badge>
                                    {defaultTemplate === template.id && <Badge>默认</Badge>}
                                </div>
                            </div>
                            <p className="m-0 text-xs text-muted-foreground">
                                竖版 1080×1620 · 横版 1200×630 · 排序 {template.position}
                            </p>
                            <div className="grid grid-cols-2 gap-2">
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={disabled}
                                    onClick={() => setDraft(posterTemplateDraft(template))}
                                >
                                    <Pencil className="size-3.5" />
                                    编辑
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={disabled || !template.enabled}
                                    onClick={() => onMakeDefault(template.id)}
                                >
                                    设为默认
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="col-span-2 text-destructive hover:text-destructive"
                                    disabled={disabled || deleteTemplate.isPending}
                                    onClick={() => {
                                        if (window.confirm(`确定删除模板“${template.name}”？`)) {
                                            deleteTemplate.mutate(template.id);
                                        }
                                    }}
                                >
                                    <Trash2 className="size-3.5" />
                                    删除模板
                                </Button>
                            </div>
                        </div>
                    </article>
                ))}
                {!templates.length && (
                    <div className="rounded-xl border border-dashed p-6 text-sm leading-6 text-muted-foreground md:col-span-2 xl:col-span-3">
                        暂无店铺自定义模板。客户端会继续使用内置通用样式；创建并启用第一个模板后，将自动切换为店铺模板。
                    </div>
                )}
            </div>

            <Dialog open={Boolean(draft)} onOpenChange={open => !open && !pending && setDraft(null)}>
                <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{draft?.id ? '编辑邀请海报模板' : '新建邀请海报模板'}</DialogTitle>
                        <DialogDescription>
                            背景图不要直接写邀请码或二维码。竖版建议 1080×1620，横版分享图建议 1200×630。
                        </DialogDescription>
                    </DialogHeader>
                    {draft && (
                        <PosterTemplateEditor
                            draft={draft}
                            setDraft={setDraft}
                            disabled={pending}
                            onPickAsset={setAssetTarget}
                        />
                    )}
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={pending}
                            onClick={() => setDraft(null)}
                        >
                            取消
                        </Button>
                        <Button type="button" disabled={pending} onClick={saveTemplate}>
                            {pending ? (
                                <LoaderCircle className="size-4 animate-spin" />
                            ) : (
                                <Save className="size-4" />
                            )}
                            保存模板
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            {draft && (
                <AssetPickerDialog
                    open={Boolean(assetTarget)}
                    onClose={() => setAssetTarget(null)}
                    onSelect={assets => {
                        const asset = assets[0] ?? null;
                        setDraft(current =>
                            current
                                ? {
                                      ...current,
                                      ...(assetTarget === 'share'
                                          ? { shareBackgroundAsset: asset }
                                          : { posterBackgroundAsset: asset }),
                                  }
                                : current,
                        );
                    }}
                    initialSelectedAssets={
                        assetTarget === 'share'
                            ? draft.shareBackgroundAsset
                                ? [draft.shareBackgroundAsset]
                                : []
                            : draft.posterBackgroundAsset
                              ? [draft.posterBackgroundAsset]
                              : []
                    }
                    title={assetTarget === 'share' ? '选择横版分享背景' : '选择竖版海报背景'}
                />
            )}
        </section>
    );
}

function PosterTemplateEditor({
    draft,
    setDraft,
    disabled,
    onPickAsset,
}: {
    draft: PosterTemplateDraft;
    setDraft: (draft: PosterTemplateDraft) => void;
    disabled: boolean;
    onPickAsset: (target: 'poster' | 'share') => void;
}) {
    const update = <K extends keyof PosterTemplateDraft>(key: K, value: PosterTemplateDraft[K]) =>
        setDraft({ ...draft, [key]: value });
    return (
        <div className="grid gap-5 py-2 sm:grid-cols-2">
            <Field label="模板名称">
                <Input
                    value={draft.name}
                    maxLength={128}
                    disabled={disabled}
                    onChange={e => update('name', e.target.value)}
                />
            </Field>
            <Field label="展示排序">
                <Input
                    type="number"
                    min={0}
                    step={1}
                    value={draft.position}
                    disabled={disabled}
                    onChange={e => update('position', Number(e.target.value))}
                />
            </Field>
            <BooleanField
                label="启用模板"
                checked={draft.enabled}
                disabled={disabled}
                onChange={value => update('enabled', value)}
                description="关闭后客户端立即停止展示该模板。"
            />
            <Field label="背景遮罩（0–80）">
                <Input
                    type="number"
                    min={0}
                    max={80}
                    step={1}
                    value={draft.overlayOpacity}
                    disabled={disabled}
                    onChange={e => update('overlayOpacity', Number(e.target.value))}
                />
            </Field>
            <PosterAssetField
                label="竖版海报背景"
                guidance="1080×1620（2:3）"
                asset={draft.posterBackgroundAsset}
                disabled={disabled}
                onPick={() => onPickAsset('poster')}
                onClear={() => update('posterBackgroundAsset', null)}
            />
            <PosterAssetField
                label="横版分享背景"
                guidance="1200×630（链接预览）"
                asset={draft.shareBackgroundAsset}
                disabled={disabled}
                onPick={() => onPickAsset('share')}
                onClear={() => update('shareBackgroundAsset', null)}
            />
            <Field label="中文小标题">
                <Input
                    value={draft.titleZh}
                    maxLength={80}
                    disabled={disabled}
                    onChange={e => update('titleZh', e.target.value)}
                />
            </Field>
            <Field label="英文小标题">
                <Input
                    value={draft.titleEn}
                    maxLength={80}
                    disabled={disabled}
                    onChange={e => update('titleEn', e.target.value)}
                />
            </Field>
            <Field label="中文主标题">
                <Textarea
                    value={draft.headlineZh}
                    maxLength={180}
                    disabled={disabled}
                    onChange={e => update('headlineZh', e.target.value)}
                />
            </Field>
            <Field label="英文主标题">
                <Textarea
                    value={draft.headlineEn}
                    maxLength={180}
                    disabled={disabled}
                    onChange={e => update('headlineEn', e.target.value)}
                />
            </Field>
            <Field label="中文奖励文案">
                <Textarea
                    value={draft.rewardTextZh}
                    maxLength={220}
                    disabled={disabled}
                    onChange={e => update('rewardTextZh', e.target.value)}
                />
                {/* i18n-audit-ignore -- Literal template token documented for the Chinese copy field. */}
                <Help>支持 {'{rewardRate}'} 动态奖励比例；只表述消费抵扣，不建议出现提现文字。</Help>
            </Field>
            <Field label="英文奖励文案">
                <Textarea
                    value={draft.rewardTextEn}
                    maxLength={220}
                    disabled={disabled}
                    onChange={e => update('rewardTextEn', e.target.value)}
                />
                {/* i18n-audit-ignore -- English guidance belongs to the English copy field. */}
                <Help>Use {'{rewardRate}'} for the live reward percentage.</Help>
            </Field>
            <Field label="中文网站介绍">
                <Textarea
                    value={draft.siteIntroZh}
                    maxLength={260}
                    disabled={disabled}
                    onChange={e => update('siteIntroZh', e.target.value)}
                />
            </Field>
            <Field label="英文网站介绍">
                <Textarea
                    value={draft.siteIntroEn}
                    maxLength={260}
                    disabled={disabled}
                    onChange={e => update('siteIntroEn', e.target.value)}
                />
            </Field>
            <Field label="中文底部服务文字">
                <Input
                    value={draft.serviceTextZh}
                    maxLength={260}
                    disabled={disabled}
                    onChange={e => update('serviceTextZh', e.target.value)}
                />
            </Field>
            <Field label="英文底部服务文字">
                <Input
                    value={draft.serviceTextEn}
                    maxLength={260}
                    disabled={disabled}
                    onChange={e => update('serviceTextEn', e.target.value)}
                />
            </Field>
            <Field label="主文字颜色">
                <Input
                    type="color"
                    value={draft.foregroundColor}
                    disabled={disabled}
                    onChange={e => update('foregroundColor', e.target.value.toUpperCase())}
                />
            </Field>
            <Field label="强调颜色">
                <Input
                    type="color"
                    value={draft.accentColor}
                    disabled={disabled}
                    onChange={e => update('accentColor', e.target.value.toUpperCase())}
                />
            </Field>
        </div>
    );
}

function PosterAssetField({
    label,
    guidance,
    asset,
    disabled,
    onPick,
    onClear,
}: {
    label: string;
    guidance: string;
    asset: Asset | null;
    disabled: boolean;
    onPick: () => void;
    onClear: () => void;
}) {
    return (
        <Field label={label}>
            <div className="flex items-center gap-3 rounded-lg border p-2">
                {asset ? (
                    <img src={asset.preview} alt="" className="size-16 rounded-md object-cover" />
                ) : (
                    <div className="grid size-16 place-items-center rounded-md bg-muted">
                        <ImagePlus className="size-5 text-muted-foreground" />
                    </div>
                )}
                <div className="min-w-0 flex-1">
                    <strong className="block truncate text-sm">{asset?.name ?? '未选择图片'}</strong>
                    <small className="text-muted-foreground">{guidance}</small>
                </div>
                <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={onPick}>
                    选择
                </Button>
                {asset && (
                    <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        disabled={disabled}
                        onClick={onClear}
                        aria-label="移除图片"
                    >
                        <X className="size-4" />
                    </Button>
                )}
            </div>
        </Field>
    );
}

function emptyPosterTemplateDraft(position: number): PosterTemplateDraft {
    return {
        name: `店铺模板 ${position + 1}`,
        enabled: true,
        position,
        layoutVariant: 'STANDARD_CENTER',
        posterBackgroundAsset: null,
        shareBackgroundAsset: null,
        titleZh: '好友邀请函',
        titleEn: 'Invitation for friends',
        headlineZh: '发现好东西，一起分享',
        headlineEn: 'Discover something worth sharing',
        rewardTextZh: '好友成功消费，可获得 {rewardRate}% 奖励用于消费抵扣',
        rewardTextEn: 'Earn {rewardRate}% in rewards when a friend makes a purchase',
        siteIntroZh: '',
        siteIntroEn: '',
        serviceTextZh: '好物严选 · 便捷消费 · 售后服务',
        serviceTextEn: 'Curated products · Easy shopping · Customer support',
        foregroundColor: '#FFFFFF',
        accentColor: '#FF4D4F',
        overlayOpacity: 28,
    };
}

function posterTemplateDraft(template: ReferralPosterTemplateRecord): PosterTemplateDraft {
    return {
        ...template,
        layoutVariant: 'STANDARD_CENTER',
        posterBackgroundAsset: template.posterBackgroundAsset as Asset | null,
        shareBackgroundAsset: template.shareBackgroundAsset as Asset | null,
    };
}

function posterTemplateInput(draft: PosterTemplateDraft) {
    const { id: _id, posterBackgroundAsset, shareBackgroundAsset, ...input } = draft;
    return {
        ...input,
        posterBackgroundAssetId: posterBackgroundAsset?.id ?? null,
        shareBackgroundAssetId: shareBackgroundAsset?.id ?? null,
    };
}

function validPosterTemplateDraft(draft: PosterTemplateDraft): boolean {
    return Boolean(
        draft.name.trim() &&
        draft.titleZh.trim() &&
        draft.titleEn.trim() &&
        draft.headlineZh.trim() &&
        draft.headlineEn.trim() &&
        draft.rewardTextZh.trim() &&
        draft.rewardTextEn.trim() &&
        /^#[0-9A-F]{6}$/i.test(draft.foregroundColor) &&
        /^#[0-9A-F]{6}$/i.test(draft.accentColor) &&
        Number.isInteger(draft.overlayOpacity) &&
        draft.overlayOpacity >= 0 &&
        draft.overlayOpacity <= 80,
    );
}

function RelationshipReport({
    summaries,
    summaryTotal,
    summarySkip,
    onSummarySkipChange,
    items,
    loading,
    total,
    skip,
    onSkipChange,
}: {
    summaries: ReferralInviterSummaryRecord[];
    summaryTotal: number;
    summarySkip: number;
    onSummarySkipChange: (skip: number) => void;
    items: ReferralRelationshipRecord[];
    loading: boolean;
    total: number;
    skip: number;
    onSkipChange: (skip: number) => void;
}) {
    if (loading)
        return (
            <ReportShell loading empty={false} total={0}>
                <span />
            </ReportShell>
        );
    return (
        <div className="space-y-6">
            <div>
                <h3 className="mb-2 text-base font-semibold">邀请人汇总</h3>
                <ReportShell
                    loading={false}
                    empty={!summaries.length}
                    total={summaryTotal}
                    skip={summarySkip}
                    onSkipChange={onSummarySkipChange}
                >
                    <table className="w-full min-w-[760px] text-sm">
                        <thead>
                            <tr className="border-b text-left text-muted-foreground">
                                <Th>邀请人</Th>
                                <Th>邀请码</Th>
                                <Th>邀请人数</Th>
                                <Th>完成首购人数</Th>
                                <Th>首购转化率</Th>
                            </tr>
                        </thead>
                        <tbody>
                            {summaries.map(item => (
                                <tr key={item.customerId} className="border-b">
                                    <Td>
                                        <Person name={item.customerName} email={item.customerEmail} />
                                    </Td>
                                    <Td>
                                        <code>{item.inviteCode}</code>
                                    </Td>
                                    <Td>
                                        <strong>{item.invitedCount}</strong>
                                    </Td>
                                    <Td>{item.purchasedInviteeCount}</Td>
                                    <Td>
                                        {item.invitedCount
                                            ? `${((item.purchasedInviteeCount / item.invitedCount) * 100).toFixed(1)}%`
                                            : '0%'}
                                    </Td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </ReportShell>
            </div>
            <div>
                <h3 className="mb-2 text-base font-semibold">受邀人明细</h3>
                <ReportShell
                    loading={false}
                    empty={!items.length}
                    total={total}
                    skip={skip}
                    onSkipChange={onSkipChange}
                >
                    <table className="w-full min-w-[920px] text-sm">
                        <thead>
                            <tr className="border-b text-left text-muted-foreground">
                                <Th>邀请人</Th>
                                <Th>受邀人</Th>
                                <Th>邀请码/来源</Th>
                                <Th>绑定时间</Th>
                                <Th>首购状态</Th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map(item => (
                                <tr key={item.id} className="border-b">
                                    <Td>
                                        <Person name={item.inviterName} email={item.inviterEmail} />
                                    </Td>
                                    <Td>
                                        <Person name={item.inviteeName} email={item.inviteeEmail} />
                                    </Td>
                                    <Td>
                                        <code>{item.inviteCodeSnapshot}</code>
                                        <Badge className="ml-2" variant="outline">
                                            {item.source}
                                        </Badge>
                                    </Td>
                                    <Td>{formatDate(item.boundAt)}</Td>
                                    <Td>
                                        {item.firstPaidOrderAt ? (
                                            <Badge>已首购 · {formatDate(item.firstPaidOrderAt)}</Badge>
                                        ) : (
                                            <Badge variant="secondary">未消费</Badge>
                                        )}
                                    </Td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </ReportShell>
            </div>
        </div>
    );
}

function RewardReport({
    items,
    loading,
    total,
    skip,
    onSkipChange,
}: {
    items: ReferralRewardRecord[];
    loading: boolean;
    total: number;
    skip: number;
    onSkipChange: (skip: number) => void;
}) {
    return (
        <ReportShell
            loading={loading}
            empty={!items.length}
            total={total}
            skip={skip}
            onSkipChange={onSkipChange}
        >
            <table className="w-full min-w-[1180px] text-sm">
                <thead>
                    <tr className="border-b text-left text-muted-foreground">
                        <Th>订单</Th>
                        <Th>邀请人与受邀人</Th>
                        <Th>有效金额</Th>
                        <Th>返利</Th>
                        <Th>已生效</Th>
                        <Th>退款扣回</Th>
                        <Th>状态</Th>
                        <Th>获得/生效时间</Th>
                    </tr>
                </thead>
                <tbody>
                    {items.map(item => (
                        <tr key={item.id} className="border-b">
                            <Td>
                                <strong>{item.orderCode}</strong>
                                <small className="block text-muted-foreground">
                                    订单总额 {formatMoney(item.orderTotalWithTax, item.currencyCode)}
                                </small>
                            </Td>
                            <Td>
                                <Person name={item.inviterName} email={item.inviterEmail} />
                                <span className="text-muted-foreground"> ← </span>
                                {item.inviteeName}
                            </Td>
                            <Td>{formatMoney(item.eligibleAmount, item.currencyCode)}</Td>
                            <Td>
                                <strong>{formatMoney(item.rewardAmount, item.currencyCode)}</strong>
                                <small className="block text-muted-foreground">{item.rewardRate}%</small>
                            </Td>
                            <Td>{formatMoney(item.releasedAmount, item.currencyCode)}</Td>
                            <Td className="text-destructive">
                                {formatMoney(item.clawedBackAmount, item.currencyCode)}
                                <small className="block">
                                    总退款 {formatMoney(item.settledRefundTotal, item.currencyCode)}
                                </small>
                                <small className="block">
                                    计入扣回 {formatMoney(item.settledEligibleRefundTotal, item.currencyCode)}
                                </small>
                            </Td>
                            <Td>
                                <StatusBadge value={item.status} />
                            </Td>
                            <Td>
                                {formatDate(item.earnedAt)}
                                <small className="block text-muted-foreground">
                                    预计 {formatDate(item.availableAt)}
                                </small>
                            </Td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </ReportShell>
    );
}

function LedgerReport({
    audit,
    items,
    loading,
    total,
    skip,
    onSkipChange,
}: {
    audit?: ReferralReportsResult['referralBalanceAudit'];
    items: ReferralLedgerRecord[];
    loading: boolean;
    total: number;
    skip: number;
    onSkipChange: (skip: number) => void;
}) {
    return (
        <div className="space-y-4">
            {audit && (
                <Alert variant={audit.items.length ? 'destructive' : 'default'}>
                    <AlertDescription>
                        {audit.items.length
                            ? `账务对账发现 ${audit.items.length} 个异常钱包，请暂停人工调整并联系技术人员核查。`
                            : `自动对账正常：已核对 ${audit.auditedWallets} 个多币种钱包，钱包余额与完整流水一致。`}
                    </AlertDescription>
                </Alert>
            )}
            {audit?.items.map(item => (
                <div key={item.walletId} className="rounded-md border border-destructive/40 p-3 text-sm">
                    <Person name={item.customerName} email={item.customerEmail} />
                    <p className="mb-0 mt-2 text-destructive">
                        {item.currencyCode} 差额：可用{' '}
                        {formatMoney(item.availableDifference, item.currencyCode)} · 待生效{' '}
                        {formatMoney(item.pendingDifference, item.currencyCode)} · 冻结{' '}
                        {formatMoney(item.reservedDifference, item.currencyCode)}
                    </p>
                </div>
            ))}
            <ReportShell
                loading={loading}
                empty={!items.length}
                total={total}
                skip={skip}
                onSkipChange={onSkipChange}
            >
                <table className="w-full min-w-[1250px] text-sm">
                    <thead>
                        <tr className="border-b text-left text-muted-foreground">
                            <Th>时间/类型</Th>
                            <Th>客户</Th>
                            <Th>可用变动</Th>
                            <Th>待生效变动</Th>
                            <Th>冻结变动</Th>
                            <Th>变动后余额</Th>
                            <Th>关联业务</Th>
                            <Th>备注</Th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map(item => (
                            <tr key={item.id} className="border-b">
                                <Td>
                                    {formatDate(item.createdAt)}
                                    <Badge className="mt-1 block w-fit" variant="outline">
                                        {item.eventType}
                                    </Badge>
                                </Td>
                                <Td>
                                    <Person name={item.customerName} email={item.customerEmail} />
                                </Td>
                                <MoneyDelta value={item.availableDelta} currency={item.currencyCode} />
                                <MoneyDelta value={item.pendingDelta} currency={item.currencyCode} />
                                <MoneyDelta value={item.reservedDelta} currency={item.currencyCode} />
                                <Td>
                                    <span className="block">
                                        可用 {formatMoney(item.availableAfter, item.currencyCode)}
                                    </span>
                                    <small className="text-muted-foreground">
                                        待生效 {formatMoney(item.pendingAfter, item.currencyCode)} · 冻结{' '}
                                        {formatMoney(item.reservedAfter, item.currencyCode)}
                                    </small>
                                </Td>
                                <Td>
                                    <small className="block">订单 {item.orderId ?? '-'}</small>
                                    <small className="block">退款 {item.refundId ?? '-'}</small>
                                    <small className="block">提款 {item.withdrawalId ?? '-'}</small>
                                </Td>
                                <Td>{item.note ?? '-'}</Td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </ReportShell>
        </div>
    );
}

function WithdrawalManagement({
    items,
    loading,
    total,
    skip,
    onSkipChange,
    canWithdraw,
    canAdjust,
    defaultCurrency,
    onChanged,
}: {
    items: ReferralWithdrawalRecord[];
    loading: boolean;
    total: number;
    skip: number;
    onSkipChange: (skip: number) => void;
    canWithdraw: boolean;
    canAdjust: boolean;
    defaultCurrency: string;
    onChanged: () => void;
}) {
    const { activeChannel } = useChannel();
    const [searchEmail, setSearchEmail] = useState('');
    const [draft, setDraft] = useState<WithdrawalDraft>({
        customer: null,
        currencyCode: defaultCurrency,
        amount: '',
        payoutMethod: '',
        payoutAccountMasked: '',
        note: '',
    });
    const [paying, setPaying] = useState<ReferralWithdrawalRecord | null>(null);
    const [externalReference, setExternalReference] = useState('');
    const [adjustAmount, setAdjustAmount] = useState('');
    const [adjustReason, setAdjustReason] = useState('');
    const requireSelectedCustomerId = () => {
        if (!draft.customer) {
            throw new Error('请先选择客户');
        }
        return draft.customer.id;
    };
    const lookup = useQuery({
        queryKey: ['referral-customer-lookup', activeChannel?.id, searchEmail],
        queryFn: () =>
            api.query<CustomerLookupResult>(referralCustomerLookupQuery, {
                options: { take: 10, filter: { emailAddress: { contains: searchEmail.trim() } } },
            }),
        enabled: false,
    });
    const customerWallets = useQuery({
        queryKey: ['referral-customer-wallets', activeChannel?.id, draft.customer?.id],
        queryFn: () =>
            api.query<{ referralCustomerWallets: ReferralCustomerWalletRecord[] }>(
                referralCustomerWalletsQuery,
                { customerId: requireSelectedCustomerId() },
            ),
        enabled: Boolean(activeChannel?.id && draft.customer?.id),
    });
    const create = useMutation({
        mutationFn: () =>
            api.mutate(createReferralWithdrawalMutation, {
                input: {
                    customerId: requireSelectedCustomerId(),
                    currencyCode: draft.currencyCode,
                    amount: toMinorAmount(draft.amount),
                    payoutMethod: draft.payoutMethod.trim(),
                    payoutAccountMasked: draft.payoutAccountMasked.trim(),
                    note: draft.note.trim() || null,
                },
            }),
        onSuccess: () => {
            toast.success('人工提款申请已创建，金额已冻结');
            setDraft({
                ...draft,
                customer: null,
                amount: '',
                payoutMethod: '',
                payoutAccountMasked: '',
                note: '',
            });
            onChanged();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const process = useMutation({
        mutationFn: ({
            id,
            status,
            externalReference: reference,
        }: {
            id: string;
            status: string;
            externalReference?: string;
        }) =>
            api.mutate(processReferralWithdrawalMutation, {
                input: { id, status, externalReference: reference ?? null },
            }),
        onSuccess: () => {
            toast.success('提款状态已更新');
            setPaying(null);
            setExternalReference('');
            void customerWallets.refetch();
            onChanged();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const adjust = useMutation({
        mutationFn: () =>
            api.mutate(adjustReferralBalanceMutation, {
                customerId: requireSelectedCustomerId(),
                currencyCode: draft.currencyCode,
                amount: toSignedMinorAmount(adjustAmount),
                reason: adjustReason.trim(),
            }),
        onSuccess: () => {
            toast.success('返利余额已调整并写入流水');
            setAdjustAmount('');
            setAdjustReason('');
            void customerWallets.refetch();
            onChanged();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const customers = lookup.data?.customers.items ?? [];
    const wallets = customerWallets.data?.referralCustomerWallets ?? [];
    const selectedWallet = wallets.find(wallet => wallet.currencyCode === draft.currencyCode);
    const requestedAmount = toMinorAmount(draft.amount);
    const availableBalance = selectedWallet?.availableBalance ?? 0;
    const validCreate = Boolean(
        draft.customer &&
        requestedAmount > 0 &&
        requestedAmount <= availableBalance &&
        draft.payoutMethod.trim() &&
        draft.payoutAccountMasked.trim() &&
        !customerWallets.isFetching,
    );
    return (
        <div className="space-y-6">
            {!canWithdraw && (
                <Alert>
                    <AlertDescription>
                        当前账号没有“管理邀请返利提款”权限，只能查看提款记录。管理员默认拥有该权限，员工需在角色权限中单独开启。
                    </AlertDescription>
                </Alert>
            )}
            {(canWithdraw || canAdjust) && (
                <div className="rounded-lg border p-4">
                    <h3 className="mt-0 text-base font-semibold">查找客户</h3>
                    <div className="flex gap-2">
                        <Input
                            value={searchEmail}
                            placeholder="输入客户邮箱"
                            onChange={event => setSearchEmail(event.target.value)}
                        />
                        <Button
                            variant="outline"
                            disabled={!searchEmail.trim() || lookup.isFetching}
                            onClick={() => void lookup.refetch()}
                        >
                            <Search className="size-4" />
                            搜索
                        </Button>
                    </div>
                    {customers.length > 0 && (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            {customers.map(customer => (
                                <button
                                    key={customer.id}
                                    type="button"
                                    className={`rounded-md border p-3 text-left ${draft.customer?.id === customer.id ? 'border-primary bg-primary/5' : ''}`}
                                    onClick={() => setDraft({ ...draft, customer, amount: '' })}
                                >
                                    <strong>
                                        {`${customer.lastName}${customer.firstName}` || customer.emailAddress}
                                    </strong>
                                    <small className="block text-muted-foreground">
                                        {customer.emailAddress}
                                        {' · '}
                                        {'ID'} {customer.id}
                                    </small>
                                </button>
                            ))}
                        </div>
                    )}
                    {draft.customer && (
                        <div className="mt-4 rounded-md border bg-muted/20 p-4">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <h4 className="m-0 text-sm font-semibold">返利账户余额</h4>
                                    <p className="mb-0 mt-1 text-xs text-muted-foreground">
                                        {draft.customer.emailAddress} · 当前渠道
                                    </p>
                                </div>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={customerWallets.isFetching}
                                    onClick={() => void customerWallets.refetch()}
                                >
                                    <RefreshCw
                                        className={`size-4 ${customerWallets.isFetching ? 'animate-spin' : ''}`}
                                    />
                                    刷新余额
                                </Button>
                            </div>
                            {customerWallets.isFetching && !customerWallets.data ? (
                                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                    <Skeleton className="h-24" />
                                    <Skeleton className="h-24" />
                                </div>
                            ) : customerWallets.isError ? (
                                <Alert variant="destructive" className="mt-3">
                                    <AlertDescription>
                                        余额读取失败：{errorMessage(customerWallets.error)}
                                    </AlertDescription>
                                </Alert>
                            ) : wallets.length ? (
                                <div className="mt-3 grid gap-3 xl:grid-cols-2">
                                    {wallets.map(wallet => (
                                        <div key={wallet.id} className="rounded-md border bg-background p-3">
                                            <div className="flex items-center justify-between gap-2">
                                                <strong>{wallet.currencyCode}</strong>
                                                <span className="text-sm font-semibold text-primary">
                                                    可用{' '}
                                                    {formatMoney(
                                                        wallet.availableBalance,
                                                        wallet.currencyCode,
                                                    )}
                                                </span>
                                            </div>
                                            <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                                                <span>
                                                    待释放
                                                    <strong className="mt-1 block text-foreground">
                                                        {formatMoney(
                                                            wallet.pendingBalance,
                                                            wallet.currencyCode,
                                                        )}
                                                    </strong>
                                                </span>
                                                <span>
                                                    已冻结
                                                    <strong className="mt-1 block text-foreground">
                                                        {formatMoney(
                                                            wallet.reservedBalance,
                                                            wallet.currencyCode,
                                                        )}
                                                    </strong>
                                                </span>
                                                <span>
                                                    账户合计
                                                    <strong className="mt-1 block text-foreground">
                                                        {formatMoney(
                                                            wallet.availableBalance +
                                                                wallet.pendingBalance +
                                                                wallet.reservedBalance,
                                                            wallet.currencyCode,
                                                        )}
                                                    </strong>
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="mb-0 mt-3 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                                    该客户当前渠道尚无返利账户记录，可用余额为 0。
                                </p>
                            )}
                        </div>
                    )}
                </div>
            )}
            {canWithdraw && (
                <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                        <h3 className="m-0 text-base font-semibold">客服代客户创建提款申请</h3>
                        <p className="mb-0 mt-1 text-sm text-muted-foreground">
                            客户不能自行提交；客服确认身份与收款信息后，由有权限的后台账号创建。
                        </p>
                    </div>
                    <Field label="已选客户">
                        <Input
                            value={draft.customer?.emailAddress ?? ''}
                            disabled
                            placeholder="请先搜索并选择客户"
                        />
                    </Field>
                    <Field label="币种">
                        <Select
                            value={draft.currencyCode}
                            onValueChange={value => value && setDraft({ ...draft, currencyCode: value })}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="CNY">{'CNY'}</SelectItem>
                                <SelectItem value="MYR">{'MYR'}</SelectItem>
                            </SelectContent>
                        </Select>
                    </Field>
                    <Field label="提款金额">
                        <Input
                            type="number"
                            min={0.01}
                            step="0.01"
                            value={draft.amount}
                            onChange={event => setDraft({ ...draft, amount: event.target.value })}
                        />
                        {draft.customer && (
                            <small className="mt-1 block text-muted-foreground">
                                当前可用：{formatMoney(availableBalance, draft.currencyCode)}
                            </small>
                        )}
                        {requestedAmount > availableBalance && requestedAmount > 0 && (
                            <small className="mt-1 block text-destructive">
                                提款金额不能超过当前可用余额
                            </small>
                        )}
                    </Field>
                    <Field label="提款方式">
                        <Input
                            value={draft.payoutMethod}
                            placeholder="例如：银行转账 / 支付宝"
                            onChange={event => setDraft({ ...draft, payoutMethod: event.target.value })}
                        />
                    </Field>
                    <Field label="脱敏收款账户">
                        <Input
                            value={draft.payoutAccountMasked}
                            placeholder="例如：尾号 1234（禁止保存完整敏感账号）"
                            onChange={event =>
                                setDraft({ ...draft, payoutAccountMasked: event.target.value })
                            }
                        />
                    </Field>
                    <Field label="客服备注">
                        <Textarea
                            value={draft.note}
                            onChange={event => setDraft({ ...draft, note: event.target.value })}
                        />
                    </Field>
                    <div className="sm:col-span-2">
                        <Button
                            disabled={!validCreate || create.isPending}
                            onClick={() => validCreate && create.mutate()}
                        >
                            <WalletCards className="size-4" />
                            创建提款申请并冻结余额
                        </Button>
                    </div>
                </div>
            )}
            {canAdjust && (
                <div className="grid gap-4 rounded-lg border border-dashed p-4 sm:grid-cols-3">
                    <div className="sm:col-span-3">
                        <h3 className="m-0 text-base font-semibold">人工余额调整</h3>
                        <p className="mb-0 mt-1 text-sm text-muted-foreground">
                            仅用于纠错或已批准的特殊补偿，支持正负金额，每次都会记录操作人和原因。
                        </p>
                    </div>
                    <Field label="调整金额（可填负数）">
                        <Input
                            type="number"
                            step="0.01"
                            value={adjustAmount}
                            onChange={event => setAdjustAmount(event.target.value)}
                        />
                    </Field>
                    <div className="sm:col-span-2">
                        <Field label="调整原因">
                            <Input
                                value={adjustReason}
                                onChange={event => setAdjustReason(event.target.value)}
                            />
                        </Field>
                    </div>
                    <div className="sm:col-span-3">
                        <Button
                            variant="outline"
                            disabled={
                                !draft.customer ||
                                !Number(adjustAmount) ||
                                !adjustReason.trim() ||
                                adjust.isPending
                            }
                            onClick={() => adjust.mutate()}
                        >
                            确认调整并写入流水
                        </Button>
                    </div>
                </div>
            )}
            <ReportShell
                loading={loading}
                empty={!items.length}
                total={total}
                skip={skip}
                onSkipChange={onSkipChange}
            >
                <table className="w-full min-w-[1180px] text-sm">
                    <thead>
                        <tr className="border-b text-left text-muted-foreground">
                            <Th>申请单</Th>
                            <Th>客户</Th>
                            <Th>金额</Th>
                            <Th>收款信息</Th>
                            <Th>状态</Th>
                            <Th>外部流水/备注</Th>
                            <Th>操作</Th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map(item => (
                            <tr key={item.id} className="border-b">
                                <Td>
                                    <strong>{item.code}</strong>
                                    <small className="block text-muted-foreground">
                                        {formatDate(item.createdAt)}
                                    </small>
                                </Td>
                                <Td>
                                    <Person name={item.customerName} email={item.customerEmail} />
                                </Td>
                                <Td>{formatMoney(item.amount, item.currencyCode)}</Td>
                                <Td>
                                    {item.payoutMethod}
                                    <small className="block text-muted-foreground">
                                        {item.payoutAccountMasked}
                                    </small>
                                </Td>
                                <Td>
                                    <StatusBadge value={item.status} />
                                </Td>
                                <Td>
                                    {item.externalReference ?? '-'}
                                    <small className="block max-w-56 truncate text-muted-foreground">
                                        {item.note ?? ''}
                                    </small>
                                </Td>
                                <Td>
                                    {canWithdraw ? (
                                        <div className="flex flex-wrap gap-1">
                                            {item.status === 'PENDING' && (
                                                <>
                                                    <Button
                                                        size="sm"
                                                        onClick={() =>
                                                            process.mutate({
                                                                id: item.id,
                                                                status: 'APPROVED',
                                                            })
                                                        }
                                                    >
                                                        批准
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() =>
                                                            process.mutate({
                                                                id: item.id,
                                                                status: 'REJECTED',
                                                            })
                                                        }
                                                    >
                                                        驳回
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={() =>
                                                            process.mutate({
                                                                id: item.id,
                                                                status: 'CANCELLED',
                                                            })
                                                        }
                                                    >
                                                        取消
                                                    </Button>
                                                </>
                                            )}
                                            {item.status === 'APPROVED' && (
                                                <>
                                                    <Button size="sm" onClick={() => setPaying(item)}>
                                                        登记已打款
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() =>
                                                            process.mutate({
                                                                id: item.id,
                                                                status: 'REJECTED',
                                                            })
                                                        }
                                                    >
                                                        驳回并退回
                                                    </Button>
                                                </>
                                            )}
                                        </div>
                                    ) : (
                                        '-'
                                    )}
                                </Td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </ReportShell>
            <Dialog open={Boolean(paying)} onOpenChange={open => !open && setPaying(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>登记人工提款已打款</DialogTitle>
                        <DialogDescription>
                            确认线下打款成功后填写银行或支付平台流水号。此操作完成后不可撤销。
                        </DialogDescription>
                    </DialogHeader>
                    <Field label="外部打款流水号">
                        <Input
                            value={externalReference}
                            onChange={event => setExternalReference(event.target.value)}
                        />
                    </Field>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setPaying(null)}>
                            取消
                        </Button>
                        <Button
                            disabled={!externalReference.trim() || process.isPending}
                            onClick={() =>
                                paying &&
                                process.mutate({
                                    id: paying.id,
                                    status: 'PAID',
                                    externalReference: externalReference.trim(),
                                })
                            }
                        >
                            确认已打款
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function ReportShell({
    loading,
    empty,
    total,
    skip = 0,
    onSkipChange,
    children,
}: {
    loading: boolean;
    empty: boolean;
    total: number;
    skip?: number;
    onSkipChange?: (skip: number) => void;
    children: ReactNode;
}) {
    if (loading)
        return (
            <div className="space-y-2">
                {Array.from({ length: 5 }, (_, index) => (
                    <Skeleton key={index} className="h-12" />
                ))}
            </div>
        );
    if (empty)
        return (
            <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
                暂无数据
            </div>
        );
    const currentPage = Math.floor(skip / REPORT_PAGE_SIZE) + 1;
    const totalPages = Math.max(1, Math.ceil(total / REPORT_PAGE_SIZE));
    return (
        <div>
            <div className="mb-2 flex items-center justify-between gap-3">
                <p className="m-0 text-sm text-muted-foreground">
                    共 {total} 条 · 第 {currentPage}/{totalPages} 页
                </p>
                {onSkipChange && (
                    <div className="flex gap-2">
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={skip <= 0}
                            onClick={() => onSkipChange(Math.max(0, skip - REPORT_PAGE_SIZE))}
                        >
                            上一页
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={skip + REPORT_PAGE_SIZE >= total}
                            onClick={() => onSkipChange(skip + REPORT_PAGE_SIZE)}
                        >
                            下一页
                        </Button>
                    </div>
                )}
            </div>
            <div className="overflow-x-auto">{children}</div>
        </div>
    );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="grid gap-2">
            <Label>{label}</Label>
            {children}
        </label>
    );
}
function Help({ children }: { children: ReactNode }) {
    return <p className="m-0 text-sm leading-5 text-muted-foreground">{children}</p>;
}
function BooleanField({
    label,
    description,
    checked,
    disabled,
    onChange,
}: {
    label: string;
    description: string;
    checked: boolean;
    disabled: boolean;
    onChange: (checked: boolean) => void;
}) {
    return (
        <div className="flex items-start justify-between gap-4 rounded-md border p-4">
            <div>
                <Label>{label}</Label>
                <Help>{description}</Help>
            </div>
            <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
        </div>
    );
}
function Person({ name, email }: { name: string; email: string }) {
    return (
        <span>
            <strong className="block">{name}</strong>
            <small className="text-muted-foreground">{email}</small>
        </span>
    );
}
function Th({ children }: { children: ReactNode }) {
    return <th className="px-3 py-3 font-medium">{children}</th>;
}
function Td({ children, className = '' }: { children: ReactNode; className?: string }) {
    return <td className={`px-3 py-3 align-top ${className}`}>{children}</td>;
}
function MoneyDelta({ value, currency }: { value: number; currency: string }) {
    return (
        <Td className={value < 0 ? 'text-destructive' : value > 0 ? 'text-emerald-600' : ''}>
            {value > 0 ? '+' : ''}
            {formatMoney(value, currency)}
        </Td>
    );
}
function StatusBadge({ value }: { value: string }) {
    const variant = ['PAID', 'AVAILABLE'].includes(value)
        ? 'default'
        : ['REJECTED', 'REVERSED', 'PARTIALLY_REVERSED'].includes(value)
          ? 'destructive'
          : 'secondary';
    return <Badge variant={variant}>{statusLabel(value)}</Badge>;
}
function QueryError({ onRetry }: { onRetry: () => void }) {
    return (
        <Alert variant="destructive">
            <AlertDescription className="flex items-center justify-between gap-3">
                <span>数据加载失败，请重试</span>
                <Button size="sm" variant="outline" onClick={onRetry}>
                    重试
                </Button>
            </AlertDescription>
        </Alert>
    );
}
function SettingsSkeleton() {
    return (
        <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 8 }, (_, index) => (
                <Skeleton key={index} className="h-24" />
            ))}
        </div>
    );
}

function programDraft(program: ReferralProgramRecord): ProgramDraft {
    return {
        expectedUpdatedAt: program.updatedAt,
        enabled: program.enabled,
        rewardRate: program.rewardRate,
        releaseDelayDays: program.releaseDelayDays,
        minimumOrderAmount: fromMinorAmount(program.minimumOrderAmount),
        maxRewardPerOrder:
            program.maxRewardPerOrder == null ? '' : fromMinorAmount(program.maxRewardPerOrder),
        allowBalanceSpend: program.allowBalanceSpend,
        attributionWindowDays: program.attributionWindowDays,
        defaultPosterTemplate: program.defaultPosterTemplate,
    };
}
function validProgramDraft(draft: ProgramDraft): boolean {
    return (
        draft.rewardRate >= 0 &&
        draft.rewardRate <= 100 &&
        Number.isInteger(draft.releaseDelayDays) &&
        draft.releaseDelayDays >= 0 &&
        draft.releaseDelayDays <= 30 &&
        Number(draft.minimumOrderAmount) >= 0 &&
        (!draft.maxRewardPerOrder || Number(draft.maxRewardPerOrder) > 0) &&
        Number.isInteger(draft.attributionWindowDays) &&
        draft.attributionWindowDays >= 1 &&
        draft.attributionWindowDays <= 365
    );
}
function toMinorAmount(value: string): number {
    return Math.round(Number(value) * 100);
}
function toSignedMinorAmount(value: string): number {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount === 0) throw new Error('调整金额无效');
    return Math.round(amount * 100);
}
function fromMinorAmount(value: number): string {
    return (value / 100).toFixed(2);
}
function formatMoney(value: number, currency: string): string {
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency, minimumFractionDigits: 2 }).format(
        value / 100,
    );
}
function formatDate(value: string): string {
    return new Intl.DateTimeFormat('zh-CN', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'Asia/Shanghai',
    }).format(new Date(value));
}
function posterLabel(value: string): string {
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
function statusLabel(value: string): string {
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
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : '操作失败，请重试';
}
