import {
    Alert,
    AlertDescription,
    Badge,
    Button,
    DashboardRouteDefinition,
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
    UnsavedChangesConfirmation,
    api,
    toast,
    useChannel,
    useMutation,
    useQuery,
} from '@vendure/dashboard';
import { CircleDollarSign, LoaderCircle, RefreshCw, Save } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
    CurrencyRateMode,
    CurrencyRoundingMode,
    MyStoreCurrencyConfigurationResult,
    RefreshStoreExchangeRateResult,
    RefreshStoreUsdtRateResult,
    StoreCurrencyConfigurationRecord,
    StorePaymentDetailRecord,
    StorePaymentStatsRecord,
    StoreUsdtPaymentIntentRecord,
    StoreUsdtPaymentStatsRecord,
    SubmitMyStoreUsdtWalletResult,
    UpdateStoreCurrencyConfigurationResult,
    UsdtRateScheduleMode,
    myStoreCurrencyConfigurationQuery,
    refreshMyStoreExchangeRateMutation,
    refreshMyStoreUsdtRateMutation,
    submitMyStoreUsdtWalletMutation,
    updateMyStoreCurrencyConfigurationMutation,
} from './store-currency.graphql';
import { UsdtManualRefundDialog, UsdtManualRefundList } from './usdt-manual-refund-dialog';

type SupportedCurrency = 'CNY' | 'MYR';

interface CurrencyDraft {
    expectedUpdatedAt: string;
    defaultCurrencyCode: SupportedCurrency;
    availableCurrencyCodes: SupportedCurrency[];
    selectorEnabled: boolean;
    rateMode: CurrencyRateMode;
    cnyToMyrRate: number;
    markupPercent: number;
    roundingMode: CurrencyRoundingMode;
    usdtDisplayEnabled: boolean;
    usdtMarkupPercent: number;
    usdtRateScheduleMode: UsdtRateScheduleMode;
    usdtRateIntervalMinutes: number;
    usdtRateDailyTime: string;
}

const USDT_INTERVAL_OPTIONS = [5, 10, 15, 30, 60] as const;

export const storeCurrencySettingsRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'settings',
        id: 'store-currency-settings',
        url: '/store-currency-settings',
        title: '币种与汇率',
        icon: CircleDollarSign,
        order: 19,
        requiresPermission: ['ReadStoreProfile'],
    },
    path: '/store-currency-settings',
    loader: () => ({ breadcrumb: () => '币种与汇率' }),
    component: () => <StoreCurrencySettingsPage />,
};

function StoreCurrencySettingsPage() {
    const { activeChannel } = useChannel();
    const [draft, setDraft] = useState<CurrencyDraft | null>(null);
    const [walletAddress, setWalletAddress] = useState('');
    const query = useQuery({
        queryKey: ['my-store-currency-configuration', activeChannel?.id],
        queryFn: () => api.query<MyStoreCurrencyConfigurationResult>(myStoreCurrencyConfigurationQuery),
        enabled: Boolean(activeChannel?.id),
    });
    const configuration = query.data?.myStoreCurrencyConfiguration;
    const paymentIntents = query.data?.myStoreUsdtPaymentIntents ?? [];
    const wallet = query.data?.myStoreUsdtWallet;
    const paymentStats = query.data?.myStoreUsdtPaymentStats;
    const storePaymentStats = query.data?.myStorePaymentStats ?? [];
    const storePaymentDetails = query.data?.myStorePaymentDetails ?? [];
    const manualRefunds = query.data?.myStoreUsdtManualRefunds ?? [];

    useEffect(() => {
        if (configuration) setDraft(toDraft(configuration));
    }, [configuration, activeChannel?.id]);

    const saveMutation = useMutation({
        mutationFn: (value: CurrencyDraft) =>
            api.mutate<UpdateStoreCurrencyConfigurationResult>(updateMyStoreCurrencyConfigurationMutation, {
                input: value,
            }),
        onSuccess: result => {
            setDraft(toDraft(result.updateMyStoreCurrencyConfiguration));
            void query.refetch();
            toast.success('币种与汇率配置已保存');
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const refreshMutation = useMutation({
        mutationFn: () => api.mutate<RefreshStoreExchangeRateResult>(refreshMyStoreExchangeRateMutation, {}),
        onSuccess: result => {
            setDraft(toDraft(result.refreshMyStoreExchangeRate));
            void query.refetch();
            toast.success('已获取马来西亚国家银行中间价');
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const refreshUsdtMutation = useMutation({
        mutationFn: () => api.mutate<RefreshStoreUsdtRateResult>(refreshMyStoreUsdtRateMutation, {}),
        onSuccess: result => {
            setDraft(toDraft(result.refreshMyStoreUsdtRate));
            void query.refetch();
            toast.success('已更新 Binance 与 OKX P2P 商家收购 USDT 中位价');
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const submitWalletMutation = useMutation({
        mutationFn: (receivingAddress: string) =>
            api.mutate<SubmitMyStoreUsdtWalletResult>(submitMyStoreUsdtWalletMutation, {
                receivingAddress,
            }),
        onSuccess: () => {
            setWalletAddress('');
            void query.refetch();
            toast.success('USDT 收款地址已提交，等待平台审核');
        },
        onError: error => toast.error(errorMessage(error)),
    });

    const update = <K extends keyof CurrencyDraft>(field: K, value: CurrencyDraft[K]) => {
        if (draft) setDraft({ ...draft, [field]: value });
    };
    const toggleCurrency = (currency: SupportedCurrency, enabled: boolean) => {
        if (!draft || currency === draft.defaultCurrencyCode) return;
        const availableCurrencyCodes = enabled
            ? Array.from(new Set([...draft.availableCurrencyCodes, currency]))
            : draft.availableCurrencyCodes.filter(code => code !== currency);
        update('availableCurrencyCodes', availableCurrencyCodes);
    };
    const setDefaultCurrency = (currency: SupportedCurrency) => {
        if (!draft) return;
        setDraft({
            ...draft,
            defaultCurrencyCode: currency,
            availableCurrencyCodes: Array.from(new Set([...draft.availableCurrencyCodes, currency])),
        });
    };
    const save = () => {
        if (!draft || !validDraft(draft)) {
            toast.error('请检查主币、可用币种、汇率、加价和采集计划');
            return;
        }
        saveMutation.mutate(draft);
    };
    const isDirty = Boolean(
        draft && configuration && JSON.stringify(draft) !== JSON.stringify(toDraft(configuration)),
    );

    return (
        <Page pageId="store-currency-settings">
            <UnsavedChangesConfirmation when={isDirty} />
            <PageTitle>币种与汇率</PageTitle>
            <PageActionBar>
                <PageActionBarRight>
                    <Button type="button" onClick={save} disabled={!draft || saveMutation.isPending}>
                        {saveMutation.isPending ? (
                            <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <Save className="mr-2 h-4 w-4" />
                        )}
                        保存配置
                    </Button>
                </PageActionBarRight>
            </PageActionBar>
            <PageLayout>
                <PageBlock
                    column="full"
                    blockId="store-currency-configuration"
                    title="币种设置"
                    description="管理网站币种、马币换算和 USDT 收购价。"
                >
                    <ConfigurationState query={query}>
                        {draft ? (
                            <Tabs defaultValue="currencies-and-myr">
                                <TabsList className="mb-6 grid h-auto w-full grid-cols-3">
                                    <TabsTrigger value="currencies-and-myr">币种与马币</TabsTrigger>
                                    <TabsTrigger value="usdt-rate">USDT 收购价</TabsTrigger>
                                    <TabsTrigger value="payments">
                                        到账记录
                                        {storePaymentDetails.length ? (
                                            <Badge variant="outline" className="ml-2 tabular-nums">
                                                {storePaymentDetails.length}
                                            </Badge>
                                        ) : null}
                                    </TabsTrigger>
                                </TabsList>

                                <TabsContent value="currencies-and-myr" className="mt-0 space-y-8">
                                    <section className="space-y-5">
                                        <SectionHeading
                                            title="网站币种"
                                            description="设置客户默认看到和可以切换的币种。"
                                        />
                                        <div className="grid gap-5 lg:grid-cols-2">
                                            <Field id="store-default-currency" label="网站主币种">
                                                <Select
                                                    value={draft.defaultCurrencyCode}
                                                    onValueChange={value =>
                                                        value && setDefaultCurrency(value)
                                                    }
                                                >
                                                    <SelectTrigger id="store-default-currency">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="CNY">人民币（CNY）</SelectItem>
                                                        <SelectItem value="MYR">
                                                            马来西亚林吉特（MYR）
                                                        </SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </Field>
                                            <BooleanField
                                                id="store-currency-selector"
                                                label="允许客户切换币种"
                                                description="关闭后，客户只看到网站主币种。"
                                                checked={draft.selectorEnabled}
                                                onChange={value => update('selectorEnabled', value)}
                                            />
                                        </div>
                                        {draft.selectorEnabled ? (
                                            <div className="grid gap-3 sm:grid-cols-2">
                                                {(['CNY', 'MYR'] as const).map(currency => (
                                                    <div
                                                        className="flex items-center justify-between rounded-lg border px-4 py-3"
                                                        key={currency}
                                                    >
                                                        <span className="font-medium">
                                                            {currency === 'CNY' ? '人民币' : '马来西亚林吉特'}
                                                            <Badge variant="outline" className="ml-2">
                                                                {currency}
                                                            </Badge>
                                                        </span>
                                                        <Switch
                                                            checked={draft.availableCurrencyCodes.includes(
                                                                currency,
                                                            )}
                                                            disabled={currency === draft.defaultCurrencyCode}
                                                            onCheckedChange={checked =>
                                                                toggleCurrency(currency, checked)
                                                            }
                                                            aria-label={`${currency} 可用`}
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        ) : null}
                                    </section>

                                    <section className="space-y-5 border-t pt-7">
                                        <SectionHeading
                                            title="马币汇率"
                                            description="商品只保存店铺主币种价格，客户端按该汇率实时换算副币价格。"
                                        />
                                        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-muted/30 p-4">
                                            <div>
                                                <span className="text-sm text-muted-foreground">
                                                    当前汇率
                                                </span>
                                                <div className="mt-1 flex flex-wrap items-center gap-2">
                                                    <strong className="text-xl tabular-nums">
                                                        1 CNY = {draft.cnyToMyrRate.toFixed(4)} MYR
                                                    </strong>
                                                    <Badge variant="outline">
                                                        {draft.rateMode === 'AUTO' ? '自动' : '手动'}
                                                    </Badge>
                                                </div>
                                                <HelpText>
                                                    {configuration?.rateSource ?? '尚未获取'} · 更新于{' '}
                                                    {formatDate(configuration?.rateUpdatedAt)} ·
                                                    换算价格实时生效
                                                </HelpText>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    disabled={refreshMutation.isPending}
                                                    onClick={() => refreshMutation.mutate()}
                                                >
                                                    <RefreshCw
                                                        className={`mr-2 h-4 w-4${refreshMutation.isPending ? ' animate-spin' : ''}`}
                                                    />
                                                    刷新汇率
                                                </Button>
                                            </div>
                                        </div>
                                        <div className="grid gap-5 lg:grid-cols-2">
                                            <Field id="store-rate-mode" label="汇率模式">
                                                <Select
                                                    value={draft.rateMode}
                                                    onValueChange={value =>
                                                        value && update('rateMode', value)
                                                    }
                                                >
                                                    <SelectTrigger id="store-rate-mode">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="AUTO">
                                                            自动（每天北京时间 10:00）
                                                        </SelectItem>
                                                        <SelectItem value="MANUAL">手动汇率</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </Field>
                                            <Field id="store-cny-myr-rate" label="1 CNY 兑换 MYR">
                                                <Input
                                                    id="store-cny-myr-rate"
                                                    type="number"
                                                    min={0.000001}
                                                    step="0.0001"
                                                    value={draft.cnyToMyrRate}
                                                    disabled={draft.rateMode === 'AUTO'}
                                                    onChange={event =>
                                                        update('cnyToMyrRate', Number(event.target.value))
                                                    }
                                                />
                                            </Field>
                                            <Field id="store-rate-markup" label="汇率加价（%）">
                                                <Input
                                                    id="store-rate-markup"
                                                    type="number"
                                                    min={-20}
                                                    max={100}
                                                    step="0.01"
                                                    value={draft.markupPercent}
                                                    onChange={event =>
                                                        update('markupPercent', Number(event.target.value))
                                                    }
                                                />
                                            </Field>
                                            <Field id="store-rounding-mode" label="换算后取整">
                                                <Select
                                                    value={draft.roundingMode}
                                                    onValueChange={value =>
                                                        value && update('roundingMode', value)
                                                    }
                                                >
                                                    <SelectTrigger id="store-rounding-mode">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="CENT">保留到分</SelectItem>
                                                        <SelectItem value="TENTH">四舍五入到 0.1</SelectItem>
                                                        <SelectItem value="WHOLE">四舍五入到整数</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </Field>
                                        </div>
                                        <HelpText>
                                            修改汇率、加价或取整规则后保存即可，无需再同步每个商品。
                                        </HelpText>
                                    </section>
                                </TabsContent>

                                <TabsContent value="usdt-rate" className="mt-0 space-y-6">
                                    <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-muted/30 p-4">
                                        <div>
                                            <span className="text-sm text-muted-foreground">
                                                认证商家收购价
                                            </span>
                                            <div className="mt-1 flex flex-wrap items-center gap-2">
                                                <strong className="text-xl tabular-nums">
                                                    ₮1 = ¥
                                                    {configuration?.cnyPerUsdtRate?.toFixed(4) ?? '暂无'}
                                                </strong>
                                                <span className="text-sm text-muted-foreground tabular-nums">
                                                    / RM {configuration?.myrPerUsdtRate?.toFixed(4) ?? '暂无'}
                                                </span>
                                                <Badge
                                                    variant={
                                                        configuration?.usdtRateAvailable
                                                            ? 'default'
                                                            : 'destructive'
                                                    }
                                                >
                                                    {configuration?.usdtRateAvailable
                                                        ? '报价可用'
                                                        : '等待更新'}
                                                </Badge>
                                            </div>
                                            <HelpText>
                                                Binance + OKX · 更新于{' '}
                                                {formatDate(configuration?.usdtRateUpdatedAt)}
                                            </HelpText>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            disabled={refreshUsdtMutation.isPending || saveMutation.isPending}
                                            onClick={() => refreshUsdtMutation.mutate()}
                                        >
                                            {refreshUsdtMutation.isPending ? (
                                                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                                            ) : (
                                                <RefreshCw className="mr-2 h-4 w-4" />
                                            )}
                                            立即采集
                                        </Button>
                                    </div>

                                    <section className="grid gap-5 lg:grid-cols-2">
                                        <BooleanField
                                            id="store-usdt-display-enabled"
                                            label="启用 USDT 展示与报价"
                                            description="允许客户查看价格并生成付款报价。"
                                            checked={draft.usdtDisplayEnabled}
                                            onChange={value => update('usdtDisplayEnabled', value)}
                                        />
                                        <Field id="store-usdt-rate-markup" label="USDT 报价加价（%）">
                                            <Input
                                                id="store-usdt-rate-markup"
                                                type="number"
                                                min={0}
                                                max={20}
                                                step="0.01"
                                                value={draft.usdtMarkupPercent}
                                                onChange={event =>
                                                    update('usdtMarkupPercent', Number(event.target.value))
                                                }
                                            />
                                        </Field>
                                        <Field id="store-usdt-schedule-mode" label="自动采集方式">
                                            <Select
                                                value={draft.usdtRateScheduleMode}
                                                onValueChange={value =>
                                                    value && update('usdtRateScheduleMode', value)
                                                }
                                            >
                                                <SelectTrigger id="store-usdt-schedule-mode">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="INTERVAL">按分钟间隔采集</SelectItem>
                                                    <SelectItem value="DAILY">每天固定时间采集</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </Field>
                                        {draft.usdtRateScheduleMode === 'INTERVAL' ? (
                                            <Field id="store-usdt-rate-interval" label="采集间隔">
                                                <Select
                                                    value={String(draft.usdtRateIntervalMinutes)}
                                                    onValueChange={value =>
                                                        value &&
                                                        update('usdtRateIntervalMinutes', Number(value))
                                                    }
                                                >
                                                    <SelectTrigger id="store-usdt-rate-interval">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {USDT_INTERVAL_OPTIONS.map(minutes => (
                                                            <SelectItem key={minutes} value={String(minutes)}>
                                                                {minutes === 60
                                                                    ? '每 1 小时'
                                                                    : `每 ${minutes} 分钟`}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </Field>
                                        ) : (
                                            <Field
                                                id="store-usdt-rate-daily-time"
                                                label="每日采集时间（北京时间）"
                                            >
                                                <Input
                                                    id="store-usdt-rate-daily-time"
                                                    type="time"
                                                    value={draft.usdtRateDailyTime}
                                                    onChange={event =>
                                                        update('usdtRateDailyTime', event.target.value)
                                                    }
                                                />
                                            </Field>
                                        )}
                                    </section>

                                    {draft.usdtRateScheduleMode === 'DAILY' ? (
                                        <Alert variant="destructive">
                                            <AlertDescription>
                                                每日模式会让收购价最长接近 24 小时不变，真实 USDT
                                                收款存在汇率波动风险。建议真实收款使用 5–15 分钟间隔。
                                            </AlertDescription>
                                        </Alert>
                                    ) : null}
                                    <div className="grid gap-3 rounded-lg border px-4 py-3 text-sm sm:grid-cols-3">
                                        <MetadataItem
                                            label="采集来源"
                                            value={configuration?.usdtRateSource ?? '尚未采集'}
                                        />
                                        <MetadataItem
                                            label="下次采集（北京时间）"
                                            value={formatDate(configuration?.usdtRateNextRunAt)}
                                        />
                                        <MetadataItem
                                            label="报价有效至"
                                            value={formatDate(configuration?.usdtRateExpiresAt)}
                                        />
                                    </div>
                                    <HelpText>
                                        采集 Binance 与 OKX P2P 认证商家收购价；两边偏差超过 5% 时不更新。
                                    </HelpText>
                                    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
                                        <div>
                                            <strong className="text-sm">TRC20 自动收款</strong>
                                            <HelpText>
                                                {configuration?.usdtPaymentNetwork} ·{' '}
                                                {configuration?.usdtReceivingAddressMasked ?? '未配置地址'}
                                            </HelpText>
                                        </div>
                                        <Badge
                                            variant={
                                                configuration?.usdtPaymentConfigured
                                                    ? 'default'
                                                    : 'destructive'
                                            }
                                        >
                                            {configuration?.usdtPaymentConfigured ? '已配置' : '未配置'}
                                        </Badge>
                                    </div>
                                    <section className="space-y-4 rounded-lg border p-4">
                                        <SectionHeading
                                            title="本网店 USDT 收款钱包"
                                            description="只填写 TRON 主网收款地址，请勿提交私钥或助记词。地址加密保存，审核通过后仅影响新订单。"
                                        />
                                        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                                            <Input
                                                value={walletAddress}
                                                placeholder="T..."
                                                autoComplete="off"
                                                spellCheck={false}
                                                onChange={event => setWalletAddress(event.target.value)}
                                            />
                                            <Button
                                                type="button"
                                                variant="secondary"
                                                disabled={
                                                    submitWalletMutation.isPending || !walletAddress.trim()
                                                }
                                                onClick={() =>
                                                    submitWalletMutation.mutate(walletAddress.trim())
                                                }
                                            >
                                                {submitWalletMutation.isPending ? '提交中' : '提交审核'}
                                            </Button>
                                        </div>
                                        <div className="grid gap-3 text-sm sm:grid-cols-3">
                                            <MetadataItem
                                                label="审核状态"
                                                value={walletReviewStatusLabel(wallet?.reviewStatus)}
                                            />
                                            <MetadataItem
                                                label="已启用地址"
                                                value={wallet?.activeReceivingAddressMasked ?? '无'}
                                            />
                                            <MetadataItem
                                                label="待审核地址"
                                                value={wallet?.pendingReceivingAddress ?? '无'}
                                            />
                                        </div>
                                        {wallet?.rejectionReason ? (
                                            <Alert variant="destructive">
                                                <AlertDescription>
                                                    驳回原因：{wallet.rejectionReason}
                                                </AlertDescription>
                                            </Alert>
                                        ) : null}
                                    </section>
                                </TabsContent>

                                <TabsContent value="payments" className="mt-0 space-y-4">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <h3 className="text-base font-semibold">全部支付方式收款</h3>
                                            <HelpText>
                                                按支付方式和订单币种统计已结算、退款与净收，明细显示最近 100
                                                笔支付。
                                            </HelpText>
                                        </div>
                                        <Badge variant="outline">{storePaymentDetails.length} 笔支付</Badge>
                                    </div>
                                    <StorePaymentStats stats={storePaymentStats} />
                                    <StorePaymentDetailList
                                        details={storePaymentDetails}
                                        onRefundRecorded={() => query.refetch()}
                                    />
                                    <section className="space-y-4 border-t pt-5">
                                        <SectionHeading
                                            title="USDT 人工退款记录"
                                            description="链上退款成功后登记的 Vendure 已结算退款；金额会自动扣减净收。"
                                        />
                                        <UsdtManualRefundList refunds={manualRefunds} />
                                    </section>
                                    <section className="space-y-4 border-t pt-5">
                                        <SectionHeading
                                            title="USDT 链上核对"
                                            description="TRC20 专属报价、链上实收金额和人工复核状态。"
                                        />
                                        <UsdtPaymentStats stats={paymentStats} />
                                        <PaymentIntentList intents={paymentIntents} />
                                    </section>
                                </TabsContent>
                            </Tabs>
                        ) : null}
                    </ConfigurationState>
                </PageBlock>
            </PageLayout>
        </Page>
    );
}

function StorePaymentStats({ stats }: { stats: StorePaymentStatsRecord[] }) {
    if (!stats.length) return <HelpText>暂无已结算的支付。</HelpText>;
    return (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {stats.map(summary => (
                <article
                    key={`${summary.paymentMethodCode}:${summary.currencyCode}`}
                    className="rounded-lg border p-4"
                >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <strong>{summary.paymentMethodCode}</strong>
                        <Badge variant="outline">
                            {summary.currencyCode} · {summary.settledCount} 笔
                        </Badge>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                        <MetadataItem
                            label="实收"
                            value={formatMoney(summary.currencyCode, summary.grossAmount)}
                        />
                        <MetadataItem
                            label={`退款（${summary.refundCount} 笔）`}
                            value={formatMoney(summary.currencyCode, summary.refundedAmount)}
                        />
                        <MetadataItem
                            label="净收"
                            value={formatMoney(summary.currencyCode, summary.netAmount)}
                        />
                    </div>
                </article>
            ))}
        </div>
    );
}

function StorePaymentDetailList({
    details,
    onRefundRecorded,
}: {
    details: StorePaymentDetailRecord[];
    onRefundRecorded: () => void | Promise<unknown>;
}) {
    if (!details.length) {
        return (
            <div className="rounded-lg bg-muted/35 px-5 py-10 text-center">
                <strong className="block text-sm">暂无支付明细</strong>
                <HelpText>客户创建支付后，记录会显示在这里。</HelpText>
            </div>
        );
    }
    return (
        <div className="grid max-h-[36rem] gap-3 overflow-y-auto pr-1">
            {details.map(detail => (
                <article
                    key={`${detail.channelId}:${detail.id}`}
                    className="grid gap-3 rounded-lg bg-muted/35 p-4 sm:grid-cols-[1fr_auto]"
                >
                    <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <strong>订单 {detail.orderCode}</strong>
                            <Badge variant={detail.paymentState === 'Settled' ? 'default' : 'outline'}>
                                {paymentStateLabel(detail.paymentState)}
                            </Badge>
                            <Badge variant="outline">{detail.paymentMethodCode}</Badge>
                        </div>
                        <p className="break-all text-sm text-muted-foreground">
                            交易号：{detail.transactionId ?? '暂无'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                            支付 ID {detail.id} · {formatDate(detail.createdAt)}
                        </p>
                    </div>
                    <div className="text-left text-sm sm:text-right">
                        <strong className="block text-lg tabular-nums">
                            {formatMoney(detail.currencyCode, detail.amount)}
                        </strong>
                        <span className="block text-muted-foreground">
                            退款 {formatMoney(detail.currencyCode, detail.refundedAmount)}
                        </span>
                        <span className="block font-medium">
                            净收 {formatMoney(detail.currencyCode, detail.netAmount)}
                        </span>
                        {detail.paymentMethodCode === 'usdt-trc20' ? (
                            <div className="mt-3">
                                <UsdtManualRefundDialog
                                    payment={detail}
                                    onRecorded={() => void onRefundRecorded()}
                                />
                            </div>
                        ) : null}
                    </div>
                </article>
            ))}
        </div>
    );
}

function UsdtPaymentStats({ stats }: { stats: StoreUsdtPaymentStatsRecord | undefined }) {
    if (!stats) return null;
    return (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetadataItem label="已到账" value={`${stats.settledCount} 笔`} />
            <MetadataItem label="实际到账 USDT" value={`₮${stats.receivedUsdtTotal.toFixed(6)}`} />
            <MetadataItem
                label="等待 / 人工复核"
                value={`${stats.pendingCount} / ${stats.manualReviewCount}`}
            />
            <MetadataItem
                label="法币成交额"
                value={
                    stats.fiatTotals.length
                        ? stats.fiatTotals
                              .map(total => `${total.currencyCode} ${(total.amount / 100).toFixed(2)}`)
                              .join(' / ')
                        : '暂无'
                }
            />
        </div>
    );
}

function ConfigurationState({
    query,
    children,
}: {
    query: { isLoading: boolean; error: unknown; refetch: () => unknown };
    children: React.ReactNode;
}) {
    if (query.isLoading) {
        return (
            <div className="grid gap-3">
                <Skeleton className="h-10" />
                <Skeleton className="h-56" />
            </div>
        );
    }
    if (query.error) {
        return (
            <Alert variant="destructive">
                <AlertDescription className="flex items-center justify-between gap-3">
                    <span>{errorMessage(query.error)}</span>
                    <Button type="button" variant="outline" size="sm" onClick={() => query.refetch()}>
                        重试
                    </Button>
                </AlertDescription>
            </Alert>
        );
    }
    return <>{children}</>;
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
    return (
        <div className="space-y-2">
            <Label htmlFor={id}>{label}</Label>
            {children}
        </div>
    );
}

function BooleanField({
    id,
    label,
    description,
    checked,
    onChange,
}: {
    id: string;
    label: string;
    description: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
}) {
    return (
        <div className="flex items-start justify-between gap-4 rounded-lg bg-muted/35 px-4 py-4">
            <div>
                <Label htmlFor={id}>{label}</Label>
                <HelpText>{description}</HelpText>
            </div>
            <Switch id={id} checked={checked} onCheckedChange={onChange} />
        </div>
    );
}

function HelpText({ children }: { children: React.ReactNode }) {
    return <p className="mb-0 mt-1 text-sm leading-5 text-muted-foreground">{children}</p>;
}

function SectionHeading({ title, description }: { title: string; description: string }) {
    return (
        <div>
            <h3 className="text-base font-semibold">{title}</h3>
            <HelpText>{description}</HelpText>
        </div>
    );
}

function MetadataItem({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0">
            <span className="block text-muted-foreground">{label}</span>
            <strong className="mt-1 block break-words font-medium">{value}</strong>
        </div>
    );
}

function PaymentIntentList({ intents }: { intents: StoreUsdtPaymentIntentRecord[] }) {
    if (!intents.length) {
        return (
            <div className="rounded-lg bg-muted/35 px-5 py-10 text-center">
                <strong className="block text-sm">暂无 USDT 付款报价</strong>
                <HelpText>客户生成 USDT 付款报价后，记录会显示在这里。</HelpText>
            </div>
        );
    }
    return (
        <div className="grid max-h-[36rem] gap-3 overflow-y-auto pr-1">
            {intents.map(intent => (
                <article
                    key={intent.id}
                    className="grid gap-3 rounded-lg bg-muted/35 p-4 sm:grid-cols-[1fr_auto]"
                >
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <strong>订单 {intent.orderCode}</strong>
                            <Badge variant={intent.status === 'SETTLED' ? 'default' : 'outline'}>
                                {usdtPaymentStatusLabel(intent.status)}
                            </Badge>
                        </div>
                        <p className="mb-0 mt-2 break-all text-sm text-muted-foreground">
                            {intent.transactionId
                                ? `交易：${intent.transactionId}`
                                : `报价有效至：${formatDate(intent.expiresAt)}`}
                        </p>
                        <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                            <span>
                                原订单金额：{intent.fiatCurrencyCode} {(intent.fiatAmount / 100).toFixed(2)}
                            </span>
                            <span>
                                汇率：{intent.fiatPerUsdtRate.toFixed(4)}（{intent.rateSource}）
                            </span>
                            <span>收款地址：{intent.receivingAddressMasked}</span>
                            <span>实际到账：{intent.receivedUsdtAmount?.toFixed(6) ?? '未到账'}</span>
                            <span>链上区块：{intent.blockNumber ?? '未确认'}</span>
                            <span>最后检查：{formatDate(intent.lastCheckedAt)}</span>
                        </div>
                        {intent.failureReason ? (
                            <p className="mb-0 mt-1 text-sm font-semibold text-destructive">
                                {intent.failureReason}
                            </p>
                        ) : null}
                    </div>
                    <div className="text-left sm:text-right">
                        <span className="block text-sm text-muted-foreground">{intent.network}</span>
                        <strong className="text-lg tabular-nums">
                            ₮{intent.expectedUsdtAmount.toFixed(6)}
                        </strong>
                    </div>
                </article>
            ))}
        </div>
    );
}

function toDraft(configuration: StoreCurrencyConfigurationRecord): CurrencyDraft {
    return {
        expectedUpdatedAt: configuration.updatedAt,
        defaultCurrencyCode: configuration.defaultCurrencyCode,
        availableCurrencyCodes: [...configuration.availableCurrencyCodes],
        selectorEnabled: configuration.selectorEnabled,
        rateMode: configuration.rateMode,
        cnyToMyrRate: configuration.cnyToMyrRate,
        markupPercent: configuration.markupPercent,
        roundingMode: configuration.roundingMode,
        usdtDisplayEnabled: configuration.usdtDisplayEnabled,
        usdtMarkupPercent: configuration.usdtMarkupPercent,
        usdtRateScheduleMode: configuration.usdtRateScheduleMode,
        usdtRateIntervalMinutes: configuration.usdtRateIntervalMinutes,
        usdtRateDailyTime: configuration.usdtRateDailyTime,
    };
}

function validDraft(draft: CurrencyDraft): boolean {
    return (
        draft.availableCurrencyCodes.includes(draft.defaultCurrencyCode) &&
        Number.isFinite(draft.cnyToMyrRate) &&
        draft.cnyToMyrRate > 0 &&
        Number.isFinite(draft.markupPercent) &&
        draft.markupPercent >= -20 &&
        draft.markupPercent <= 100 &&
        Number.isFinite(draft.usdtMarkupPercent) &&
        draft.usdtMarkupPercent >= 0 &&
        draft.usdtMarkupPercent <= 20 &&
        USDT_INTERVAL_OPTIONS.includes(
            draft.usdtRateIntervalMinutes as (typeof USDT_INTERVAL_OPTIONS)[number],
        ) &&
        /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(draft.usdtRateDailyTime)
    );
}

function formatDate(value: string | null | undefined): string {
    if (!value) return '尚未执行';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '尚未执行';
    return new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).format(date);
}

function usdtPaymentStatusLabel(status: string): string {
    return (
        {
            PENDING: '等待到账',
            SETTLED: '已确认到账',
            MANUAL_REVIEW: '需要人工复核',
            EXPIRED: '报价已过期',
        }[status] ?? status
    );
}

function walletReviewStatusLabel(status: string | undefined): string {
    return (
        {
            UNCONFIGURED: '未配置',
            PENDING: '待平台审核',
            ACTIVE: '已审核启用',
            REJECTED: '已驳回',
        }[status ?? 'UNCONFIGURED'] ??
        status ??
        '未配置'
    );
}

function paymentStateLabel(state: string): string {
    return (
        {
            Created: '已创建',
            Authorized: '已授权',
            Settled: '已结算',
            Declined: '已拒绝',
            Error: '错误',
            Cancelled: '已取消',
        }[state] ?? state
    );
}

function formatMoney(currencyCode: string, amount: number): string {
    return `${currencyCode} ${(amount / 100).toFixed(2)}`;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : '请求失败，请稍后重试';
}
