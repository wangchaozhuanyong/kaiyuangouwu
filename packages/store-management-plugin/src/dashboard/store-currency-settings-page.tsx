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
    api,
    toast,
    useChannel,
    useMutation,
    useQuery,
} from '@vendure/dashboard';
import { CircleDollarSign, LoaderCircle, RefreshCw, Save, WandSparkles } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
    CurrencyRateMode,
    CurrencyRoundingMode,
    MyStoreCurrencyConfigurationResult,
    RefreshStoreExchangeRateResult,
    RefreshStoreUsdtRateResult,
    StoreCurrencyConfigurationRecord,
    SyncStoreCurrencyPricesResult,
    UpdateStoreCurrencyConfigurationResult,
    myStoreCurrencyConfigurationQuery,
    refreshMyStoreExchangeRateMutation,
    refreshMyStoreUsdtRateMutation,
    syncMyStoreCurrencyPricesMutation,
    updateMyStoreCurrencyConfigurationMutation,
} from './store-currency.graphql';

type SupportedCurrency = 'CNY' | 'MYR';

interface CurrencyDraft {
    defaultCurrencyCode: SupportedCurrency;
    availableCurrencyCodes: SupportedCurrency[];
    selectorEnabled: boolean;
    rateMode: CurrencyRateMode;
    cnyToMyrRate: number;
    markupPercent: number;
    roundingMode: CurrencyRoundingMode;
    usdtDisplayEnabled: boolean;
    usdtMarkupPercent: number;
}

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
    const query = useQuery({
        queryKey: ['my-store-currency-configuration', activeChannel?.id],
        queryFn: () => api.query<MyStoreCurrencyConfigurationResult>(myStoreCurrencyConfigurationQuery),
        enabled: Boolean(activeChannel?.id),
    });
    const configuration = query.data?.myStoreCurrencyConfiguration;
    const paymentIntents = query.data?.myStoreUsdtPaymentIntents ?? [];

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
    const syncMutation = useMutation({
        mutationFn: () => api.mutate<SyncStoreCurrencyPricesResult>(syncMyStoreCurrencyPricesMutation, {}),
        onSuccess: result => {
            setDraft(toDraft(result.syncMyStoreCurrencyPrices));
            void query.refetch();
            toast.success(`副币价格已同步，更新 ${result.syncMyStoreCurrencyPrices.syncedPriceCount} 条`);
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const refreshUsdtMutation = useMutation({
        mutationFn: () => api.mutate<RefreshStoreUsdtRateResult>(refreshMyStoreUsdtRateMutation, {}),
        onSuccess: result => {
            setDraft(toDraft(result.refreshMyStoreUsdtRate));
            void query.refetch();
            toast.success('已更新 Binance 与 OKX P2P 商家 USDT 中位报价');
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
            toast.error('请检查主币、可用币种、汇率和加价设置');
            return;
        }
        saveMutation.mutate(draft);
    };

    return (
        <Page pageId="store-currency-settings">
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
                    column="main"
                    blockId="store-currency-basics"
                    title="结算币种"
                    description="商品、客户和库存保持共用；客户只是切换价格显示和订单结算币种。"
                >
                    <ConfigurationState query={query}>
                        {draft ? (
                            <div className="grid gap-5 sm:grid-cols-2">
                                <Field id="store-default-currency" label="网站主币种">
                                    <Select
                                        value={draft.defaultCurrencyCode}
                                        onValueChange={value => value && setDefaultCurrency(value)}
                                    >
                                        <SelectTrigger id="store-default-currency">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="CNY">人民币（CNY）</SelectItem>
                                            <SelectItem value="MYR">马来西亚林吉特（MYR）</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <p className="text-sm text-muted-foreground">
                                        新访客默认看到该币种，也是后台手工录入商品价格的基准币种。
                                    </p>
                                </Field>
                                <BooleanField
                                    id="store-currency-selector"
                                    label="客户端显示币种切换"
                                    checked={draft.selectorEnabled}
                                    onChange={value => update('selectorEnabled', value)}
                                />
                                <div className="rounded-md border p-4 sm:col-span-2">
                                    <Label className="mb-3 block">客户可选币种</Label>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        {(['CNY', 'MYR'] as const).map(currency => (
                                            <div
                                                className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-3"
                                                key={currency}
                                            >
                                                <span>
                                                    {currency === 'CNY' ? '人民币' : '马来西亚林吉特'}
                                                    <Badge variant="outline" className="ml-2">
                                                        {currency}
                                                    </Badge>
                                                </span>
                                                <Switch
                                                    checked={draft.availableCurrencyCodes.includes(currency)}
                                                    disabled={currency === draft.defaultCurrencyCode}
                                                    onCheckedChange={checked =>
                                                        toggleCurrency(currency, checked)
                                                    }
                                                    aria-label={`${currency} 可用`}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ) : null}
                    </ConfigurationState>
                </PageBlock>

                <PageBlock
                    column="main"
                    blockId="store-usdt-payment-monitor"
                    title="USDT 到账记录"
                    description="只读监控最近 50 笔 TRC20 付款报价；钱包地址不能在这里修改。"
                >
                    {query.isLoading ? (
                        <Skeleton className="h-28 w-full" />
                    ) : paymentIntents.length ? (
                        <div className="grid gap-3">
                            {paymentIntents.map(intent => (
                                <div
                                    key={intent.id}
                                    className="grid gap-3 rounded-md border p-4 sm:grid-cols-[1fr_auto]"
                                >
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <strong>订单 {intent.orderCode}</strong>
                                            <Badge
                                                variant={intent.status === 'SETTLED' ? 'default' : 'outline'}
                                            >
                                                {usdtPaymentStatusLabel(intent.status)}
                                            </Badge>
                                        </div>
                                        <p className="mb-0 mt-2 break-all text-sm text-muted-foreground">
                                            {intent.transactionId
                                                ? `交易：${intent.transactionId}`
                                                : `报价有效至：${formatDate(intent.expiresAt)}`}
                                        </p>
                                        {intent.failureReason ? (
                                            <p className="mb-0 mt-1 text-sm font-semibold text-destructive">
                                                {intent.failureReason}
                                            </p>
                                        ) : null}
                                    </div>
                                    <div className="text-left sm:text-right">
                                        <span className="block text-sm text-muted-foreground">
                                            {intent.network}
                                        </span>
                                        <strong className="text-lg">
                                            ₮{intent.expectedUsdtAmount.toFixed(6)}
                                        </strong>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="mb-0 text-sm text-muted-foreground">当前店铺还没有 USDT 付款报价。</p>
                    )}
                </PageBlock>

                <PageBlock
                    column="main"
                    blockId="store-usdt-display"
                    title="USDT 展示价格"
                    description="USDT 只用于客户端参考价格和后续支付报价；订单账务仍使用 CNY 或 MYR。"
                >
                    {draft ? (
                        <div className="grid gap-5 sm:grid-cols-2">
                            <BooleanField
                                id="store-usdt-display-enabled"
                                label="允许客户切换查看 USDT 价格"
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
                                <p className="text-sm text-muted-foreground">
                                    仅影响客户看到的 USDT 数量，用于覆盖 OTC 波动和收款成本。
                                </p>
                            </Field>
                            <div className="rounded-md border p-4 sm:col-span-2">
                                <div className="grid gap-3 sm:grid-cols-3">
                                    <div>
                                        <span className="text-sm text-muted-foreground">{'CNY/USDT'}</span>
                                        <strong className="mt-1 block text-lg">
                                            {configuration?.cnyPerUsdtRate?.toFixed(4) ?? '暂无'}
                                        </strong>
                                    </div>
                                    <div>
                                        <span className="text-sm text-muted-foreground">{'MYR/USDT'}</span>
                                        <strong className="mt-1 block text-lg">
                                            {configuration?.myrPerUsdtRate?.toFixed(4) ?? '暂无'}
                                        </strong>
                                    </div>
                                    <div>
                                        <span className="text-sm text-muted-foreground">报价状态</span>
                                        <strong className="mt-1 block text-lg">
                                            {configuration?.usdtRateAvailable ? '可用' : '待更新'}
                                        </strong>
                                    </div>
                                </div>
                                <p className="mb-0 mt-3 text-sm text-muted-foreground">
                                    来源：{configuration?.usdtRateSource ?? '尚未采集'}；更新时间：
                                    {formatDate(configuration?.usdtRateUpdatedAt)}。系统每 5 分钟刷新，超过 15
                                    分钟的报价不会在客户端使用。
                                </p>
                            </div>
                            <Alert className="sm:col-span-2">
                                <AlertDescription>
                                    当前自动报价分别计算 Binance 与 OKX P2P 合格商家出售 USDT
                                    的中位价，再按平台等权合并。单一来源故障时自动降级；两边偏差超过 5%
                                    时拒绝更新。
                                </AlertDescription>
                            </Alert>
                            <div className="rounded-md border p-4 sm:col-span-2">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                        <strong className="block">TRC20 自动收款</strong>
                                        <span className="text-sm text-muted-foreground">
                                            收款地址只从服务器环境变量读取，后台没有修改接口。
                                        </span>
                                    </div>
                                    <Badge
                                        variant={
                                            configuration?.usdtPaymentConfigured ? 'default' : 'destructive'
                                        }
                                    >
                                        {configuration?.usdtPaymentConfigured ? '已安全配置' : '尚未配置'}
                                    </Badge>
                                </div>
                                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                                    <div>
                                        <dt className="text-muted-foreground">网络</dt>
                                        <dd className="font-semibold">
                                            {configuration?.usdtPaymentNetwork ?? 'TRC20'}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className="text-muted-foreground">脱敏地址</dt>
                                        <dd className="font-mono font-semibold">
                                            {configuration?.usdtReceivingAddressMasked ?? '未配置'}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className="text-muted-foreground">钱包校验码</dt>
                                        <dd className="break-all font-mono font-semibold">
                                            {configuration?.usdtReceivingAddressFingerprint?.slice(0, 16) ??
                                                '未配置'}
                                        </dd>
                                    </div>
                                </dl>
                            </div>
                            <div className="sm:col-span-2">
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
                                    立即更新 USDT 报价
                                </Button>
                            </div>
                        </div>
                    ) : null}
                </PageBlock>

                <PageBlock
                    column="main"
                    blockId="store-exchange-rate"
                    title="汇率与换算价格"
                    description="系统保存每个币种的实际商品价格；客户下单时使用选中币种的价格，不在浏览器临时乘汇率。"
                >
                    {draft ? (
                        <div className="grid gap-5 sm:grid-cols-2">
                            <Field id="store-rate-mode" label="汇率模式">
                                <Select
                                    value={draft.rateMode}
                                    onValueChange={value => value && update('rateMode', value)}
                                >
                                    <SelectTrigger id="store-rate-mode">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="AUTO">自动（每天北京时间 10:00 更新）</SelectItem>
                                        <SelectItem value="MANUAL">手动汇率</SelectItem>
                                    </SelectContent>
                                </Select>
                                <p className="text-sm text-muted-foreground">
                                    自动模式每天北京时间 10:00 更新；手动点击同步时也会先读取最新官方汇率。
                                </p>
                            </Field>
                            <Field id="store-cny-myr-rate" label="1 CNY 兑换 MYR">
                                <Input
                                    id="store-cny-myr-rate"
                                    type="number"
                                    min={0.000001}
                                    step="0.0001"
                                    value={draft.cnyToMyrRate}
                                    disabled={draft.rateMode === 'AUTO'}
                                    onChange={event => update('cnyToMyrRate', Number(event.target.value))}
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
                                    onChange={event => update('markupPercent', Number(event.target.value))}
                                />
                                <p className="text-sm text-muted-foreground">
                                    用于覆盖汇率波动或跨境收款成本，0 表示不加价。
                                </p>
                            </Field>
                            <Field id="store-rounding-mode" label="换算后取整">
                                <Select
                                    value={draft.roundingMode}
                                    onValueChange={value => value && update('roundingMode', value)}
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
                            <Alert className="sm:col-span-2">
                                <AlertDescription>
                                    数据来源：{configuration?.rateSource ?? '尚未获取'}；汇率更新：
                                    {formatDate(configuration?.rateUpdatedAt)}；价格同步：
                                    {formatDate(configuration?.pricesUpdatedAt)}。
                                </AlertDescription>
                            </Alert>
                            <div className="flex flex-wrap gap-3 sm:col-span-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={refreshMutation.isPending}
                                    onClick={() => refreshMutation.mutate()}
                                >
                                    <RefreshCw
                                        className={`mr-2 h-4 w-4${refreshMutation.isPending ? ' animate-spin' : ''}`}
                                    />
                                    立即刷新汇率
                                </Button>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    disabled={syncMutation.isPending || saveMutation.isPending}
                                    onClick={() => syncMutation.mutate()}
                                >
                                    {syncMutation.isPending ? (
                                        <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                                    ) : (
                                        <WandSparkles className="mr-2 h-4 w-4" />
                                    )}
                                    按汇率同步副币价格
                                </Button>
                            </div>
                            <p className="text-sm text-muted-foreground sm:col-span-2">
                                同步会以主币价格为准更新另一币种，最近一次实际更新{' '}
                                {configuration?.syncedPriceCount ?? 0} 条。请先保存配置，再执行同步。
                            </p>
                        </div>
                    ) : null}
                </PageBlock>
            </PageLayout>
        </Page>
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
                <Skeleton className="h-24" />
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
    checked,
    onChange,
}: {
    id: string;
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
}) {
    return (
        <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-3">
            <Label htmlFor={id}>{label}</Label>
            <Switch id={id} checked={checked} onCheckedChange={onChange} />
        </div>
    );
}

function toDraft(configuration: StoreCurrencyConfigurationRecord): CurrencyDraft {
    return {
        defaultCurrencyCode: configuration.defaultCurrencyCode,
        availableCurrencyCodes: [...configuration.availableCurrencyCodes],
        selectorEnabled: configuration.selectorEnabled,
        rateMode: configuration.rateMode,
        cnyToMyrRate: configuration.cnyToMyrRate,
        markupPercent: configuration.markupPercent,
        roundingMode: configuration.roundingMode,
        usdtDisplayEnabled: configuration.usdtDisplayEnabled,
        usdtMarkupPercent: configuration.usdtMarkupPercent,
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
        draft.usdtMarkupPercent <= 20
    );
}

function formatDate(value: string | null | undefined): string {
    if (!value) return '尚未执行';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '尚未执行' : date.toLocaleString('zh-CN');
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

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : '请求失败，请稍后重试';
}
