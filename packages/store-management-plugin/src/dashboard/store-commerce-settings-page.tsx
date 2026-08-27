import { useLingui } from '@lingui/react';
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
    Textarea,
    UnsavedChangesConfirmation,
    api,
    toast,
    useChannel,
    useMutation,
    useQuery,
} from '@vendure/dashboard';
import { LoaderCircle, RefreshCw, Save, Truck } from 'lucide-react';
import { ReactNode, useEffect, useState } from 'react';

import {
    MyStoreCommerceConfigurationResult,
    StoreCommerceConfigurationRecord,
    StoreCountryRecord,
    UpdateMyStoreCommerceConfigurationResult,
    myStoreCommerceConfigurationQuery,
    updateMyStoreCommerceConfigurationMutation,
} from './store-commerce.graphql';

interface CommerceDraft {
    expectedUpdatedAt: string;
    pricesIncludeTax: boolean;
    countryCode: string;
    taxRate: number;
    shippingMethodNameZh: string;
    shippingMethodNameEn: string;
    shippingDescriptionZh: string;
    shippingDescriptionEn: string;
    baseRate: number;
    freeShippingThreshold: number;
    shippingTaxRate: number;
    shippingPriceIncludesTax: boolean;
    estimateMinDays: number;
    estimateMaxDays: number;
    blockedPostalPrefixes: string;
}

const zhCopy = {
    title: '税务与配送',
    save: '保存配置',
    saving: '正在保存',
    saved: '税务与配送配置已保存',
    retry: '重试',
    loadError: '配置加载失败',
    tax: '税务设置',
    taxDescription: '当前店铺的默认税务地区、商品价格和基准税率。',
    country: '经营主体及默认配送国家',
    countryHelp:
        '用于建立默认税区和实物配送区，不会限制数字商品面向其他国家销售。全球实物配送请另行配置业务区域和配送方式。',
    selectCountry: '选择国家',
    taxRate: '商品税率（%）',
    pricesIncludeTax: '商品价格已含税',
    shipping: '标准配送',
    shippingDescription: '实物商品使用的运费、范围和预计时效；中文内容保存时自动生成英文。',
    nameZh: '配送名称',
    nameEn: '英文配送名称（人工覆盖）',
    descriptionZh: '配送说明',
    descriptionEn: '英文配送说明（人工覆盖）',
    commonMode: '常用模式',
    englishReview: '英文校对',
    translationHelp: '通常只需填写中文配送信息；仅在需要人工修改英文译文时展开校对。',
    baseRate: '基础运费',
    freeThreshold: '免邮门槛',
    shippingTaxRate: '运费税率（%）',
    shippingIncludesTax: '运费已含税',
    minDays: '最短配送天数',
    maxDays: '最长配送天数',
    blockedPostalPrefixes: '不配送的邮编前缀',
    blockedPostalPlaceholder: '例如 999, POBOX',
    status: '配置状态',
    ready: '已配置',
    pending: '待配置',
    store: '店铺编码',
    currency: '结算币种',
    taxZone: '税区',
    shippingZone: '配送区',
    notCreated: '首次保存后创建',
    invalid: '请检查国家、税率、金额、配送名称和时效设置',
};

const enCopy: typeof zhCopy = {
    title: 'Tax and shipping',
    save: 'Save configuration',
    saving: 'Saving',
    saved: 'Tax and shipping configuration saved',
    retry: 'Retry',
    loadError: 'Could not load the configuration',
    tax: 'Tax settings',
    taxDescription: 'Default tax jurisdiction, product pricing, and baseline tax rate for the active store.',
    country: 'Business and default delivery country',
    countryHelp:
        'Creates the default tax and physical-delivery zones. It does not restrict digital-product ' +
        'sales to other countries. Configure business zones and shipping methods separately for global physical delivery.',
    selectCountry: 'Select a country',
    taxRate: 'Product tax rate (%)',
    pricesIncludeTax: 'Product prices include tax',
    shipping: 'Standard delivery',
    shippingDescription: 'Rates, coverage, and estimates; English is generated from the Chinese content.',
    nameZh: 'Delivery name (Chinese source)',
    nameEn: 'English delivery name (manual override)',
    descriptionZh: 'Delivery description (Chinese source)',
    descriptionEn: 'English delivery description (manual override)',
    commonMode: 'Common mode',
    englishReview: 'Review English',
    translationHelp: 'Usually you only need Chinese. Open English review only to override the translation.',
    baseRate: 'Base shipping rate',
    freeThreshold: 'Free shipping threshold',
    shippingTaxRate: 'Shipping tax rate (%)',
    shippingIncludesTax: 'Shipping rate includes tax',
    minDays: 'Minimum delivery days',
    maxDays: 'Maximum delivery days',
    blockedPostalPrefixes: 'Blocked postal-code prefixes',
    blockedPostalPlaceholder: 'For example 999, POBOX',
    status: 'Configuration status',
    ready: 'Configured',
    pending: 'Pending',
    store: 'Store code',
    currency: 'Currency',
    taxZone: 'Tax zone',
    shippingZone: 'Shipping zone',
    notCreated: 'Created on first save',
    invalid: 'Check the country, rates, amounts, delivery names, and estimates',
};

export const storeCommerceSettingsRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'settings',
        id: 'store-commerce-settings',
        url: '/store-commerce-settings',
        title: '税务与配送',
        icon: Truck,
        order: 20,
        requiresPermission: ['ReadStoreProfile'],
    },
    path: '/store-commerce-settings',
    loader: () => ({ breadcrumb: () => '税务与配送' }),
    component: () => <StoreCommerceSettingsPage />,
};

function StoreCommerceSettingsPage() {
    const { i18n } = useLingui();
    const text = i18n.locale.toLowerCase().startsWith('zh') ? zhCopy : enCopy;
    const { activeChannel } = useChannel();
    const [draft, setDraft] = useState<CommerceDraft | null>(null);
    const [editEnglish, setEditEnglish] = useState(false);
    const configurationQuery = useQuery({
        queryKey: ['my-store-commerce-configuration', activeChannel?.id],
        queryFn: () => api.query<MyStoreCommerceConfigurationResult>(myStoreCommerceConfigurationQuery),
        enabled: Boolean(activeChannel?.id),
    });
    const configuration = configurationQuery.data?.myStoreCommerceConfiguration;
    const countries = configurationQuery.data?.countries.items.filter(country => country.enabled) ?? [];

    useEffect(() => {
        setDraft(configuration ? toDraft(configuration) : null);
        setEditEnglish(false);
    }, [configuration, activeChannel?.id]);

    const mutation = useMutation({
        mutationFn: (value: CommerceDraft) =>
            api.mutate<UpdateMyStoreCommerceConfigurationResult>(updateMyStoreCommerceConfigurationMutation, {
                input: {
                    ...value,
                    baseRate: majorToMinor(value.baseRate, configuration?.currencyCode),
                    freeShippingThreshold: majorToMinor(
                        value.freeShippingThreshold,
                        configuration?.currencyCode,
                    ),
                },
            }),
        onSuccess: result => {
            setDraft(toDraft(result.updateMyStoreCommerceConfiguration));
            void configurationQuery.refetch();
            toast.success(text.saved);
        },
        onError: error => toast.error(errorMessage(error)),
    });

    const update = <K extends keyof CommerceDraft>(field: K, value: CommerceDraft[K]) => {
        if (draft) setDraft({ ...draft, [field]: value });
    };
    const save = () => {
        if (!draft || !validDraft(draft)) {
            toast.error(text.invalid);
            return;
        }
        mutation.mutate(draft);
    };
    const isDirty = Boolean(
        draft && configuration && JSON.stringify(draft) !== JSON.stringify(toDraft(configuration)),
    );

    return (
        <Page pageId="store-commerce-settings">
            <UnsavedChangesConfirmation when={isDirty} />
            <PageTitle>{text.title}</PageTitle>
            <PageActionBar>
                <PageActionBarRight>
                    <SaveButton draft={draft} pending={mutation.isPending} save={save} text={text} />
                </PageActionBarRight>
            </PageActionBar>
            <PageLayout>
                <PageBlock
                    column="main"
                    blockId="store-tax-settings"
                    title={text.tax}
                    description={text.taxDescription}
                >
                    <ConfigurationState query={configurationQuery} text={text}>
                        {draft && (
                            <div className="grid gap-5 sm:grid-cols-2">
                                <Field id="store-country" label={text.country} className="sm:col-span-2">
                                    <CountrySelect
                                        id="store-country"
                                        countries={countries}
                                        value={draft.countryCode}
                                        placeholder={text.selectCountry}
                                        onChange={value => update('countryCode', value)}
                                    />
                                    <p className="text-sm text-muted-foreground">{text.countryHelp}</p>
                                </Field>
                                <Field id="store-tax-rate" label={text.taxRate}>
                                    <Input
                                        id="store-tax-rate"
                                        type="number"
                                        min={0}
                                        max={100}
                                        step="0.01"
                                        value={draft.taxRate}
                                        onChange={event => update('taxRate', numberValue(event.target.value))}
                                    />
                                </Field>
                                <BooleanField
                                    id="store-prices-include-tax"
                                    label={text.pricesIncludeTax}
                                    checked={draft.pricesIncludeTax}
                                    onChange={value => update('pricesIncludeTax', value)}
                                />
                            </div>
                        )}
                    </ConfigurationState>
                </PageBlock>
                <PageBlock
                    column="main"
                    blockId="store-shipping-settings"
                    title={text.shipping}
                    description={text.shippingDescription}
                >
                    {draft ? (
                        <div className="grid gap-5 sm:grid-cols-2">
                            <div className="flex flex-col gap-3 rounded-md border bg-muted/20 p-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
                                <p className="text-xs text-muted-foreground">{text.translationHelp}</p>
                                <div className="flex shrink-0 rounded-md border bg-background p-1">
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant={editEnglish ? 'ghost' : 'secondary'}
                                        onClick={() => setEditEnglish(false)}
                                    >
                                        {text.commonMode}
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant={editEnglish ? 'secondary' : 'ghost'}
                                        onClick={() => setEditEnglish(true)}
                                    >
                                        {text.englishReview}
                                    </Button>
                                </div>
                            </div>
                            <Field
                                id="store-shipping-name-zh"
                                label={text.nameZh}
                                className={editEnglish ? undefined : 'sm:col-span-2'}
                            >
                                <Input
                                    id="store-shipping-name-zh"
                                    maxLength={80}
                                    value={draft.shippingMethodNameZh}
                                    onChange={event => update('shippingMethodNameZh', event.target.value)}
                                />
                            </Field>
                            {editEnglish ? (
                                <Field id="store-shipping-name-en" label={text.nameEn}>
                                    <Input
                                        id="store-shipping-name-en"
                                        maxLength={80}
                                        value={draft.shippingMethodNameEn}
                                        onChange={event => update('shippingMethodNameEn', event.target.value)}
                                    />
                                </Field>
                            ) : null}
                            <Field
                                id="store-shipping-description-zh"
                                label={text.descriptionZh}
                                className={editEnglish ? undefined : 'sm:col-span-2'}
                            >
                                <Textarea
                                    id="store-shipping-description-zh"
                                    rows={3}
                                    maxLength={500}
                                    value={draft.shippingDescriptionZh}
                                    onChange={event => update('shippingDescriptionZh', event.target.value)}
                                />
                            </Field>
                            {editEnglish ? (
                                <Field id="store-shipping-description-en" label={text.descriptionEn}>
                                    <Textarea
                                        id="store-shipping-description-en"
                                        rows={3}
                                        maxLength={500}
                                        value={draft.shippingDescriptionEn}
                                        onChange={event =>
                                            update('shippingDescriptionEn', event.target.value)
                                        }
                                    />
                                </Field>
                            ) : null}
                            <Field
                                id="store-shipping-base-rate"
                                label={`${text.baseRate} (${configuration?.currencyCode ?? ''})`}
                            >
                                <Input
                                    id="store-shipping-base-rate"
                                    type="number"
                                    min={0}
                                    step={currencyStep(configuration?.currencyCode)}
                                    value={draft.baseRate}
                                    onChange={event => update('baseRate', numberValue(event.target.value))}
                                />
                            </Field>
                            <Field
                                id="store-free-shipping-threshold"
                                label={`${text.freeThreshold} (${configuration?.currencyCode ?? ''})`}
                            >
                                <Input
                                    id="store-free-shipping-threshold"
                                    type="number"
                                    min={0}
                                    step={currencyStep(configuration?.currencyCode)}
                                    value={draft.freeShippingThreshold}
                                    onChange={event =>
                                        update('freeShippingThreshold', numberValue(event.target.value))
                                    }
                                />
                            </Field>
                            <Field id="store-shipping-tax-rate" label={text.shippingTaxRate}>
                                <Input
                                    id="store-shipping-tax-rate"
                                    type="number"
                                    min={0}
                                    max={100}
                                    step="0.01"
                                    value={draft.shippingTaxRate}
                                    onChange={event =>
                                        update('shippingTaxRate', numberValue(event.target.value))
                                    }
                                />
                            </Field>
                            <BooleanField
                                id="store-shipping-includes-tax"
                                label={text.shippingIncludesTax}
                                checked={draft.shippingPriceIncludesTax}
                                onChange={value => update('shippingPriceIncludesTax', value)}
                            />
                            <Field id="store-shipping-min-days" label={text.minDays}>
                                <Input
                                    id="store-shipping-min-days"
                                    type="number"
                                    min={0}
                                    max={365}
                                    step={1}
                                    value={draft.estimateMinDays}
                                    onChange={event =>
                                        update('estimateMinDays', numberValue(event.target.value))
                                    }
                                />
                            </Field>
                            <Field id="store-shipping-max-days" label={text.maxDays}>
                                <Input
                                    id="store-shipping-max-days"
                                    type="number"
                                    min={0}
                                    max={365}
                                    step={1}
                                    value={draft.estimateMaxDays}
                                    onChange={event =>
                                        update('estimateMaxDays', numberValue(event.target.value))
                                    }
                                />
                            </Field>
                            <Field
                                id="store-blocked-postal-prefixes"
                                label={text.blockedPostalPrefixes}
                                className="sm:col-span-2"
                            >
                                <Input
                                    id="store-blocked-postal-prefixes"
                                    maxLength={1050}
                                    placeholder={text.blockedPostalPlaceholder}
                                    value={draft.blockedPostalPrefixes}
                                    onChange={event =>
                                        update('blockedPostalPrefixes', event.target.value.toUpperCase())
                                    }
                                />
                            </Field>
                            <div className="border-t pt-4 sm:col-span-2 sm:hidden">
                                <SaveButton
                                    draft={draft}
                                    pending={mutation.isPending}
                                    save={save}
                                    text={text}
                                    fullWidth
                                />
                            </div>
                        </div>
                    ) : configurationQuery.isPending ? (
                        <ConfigurationSkeleton />
                    ) : null}
                </PageBlock>
                <PageBlock column="side" blockId="store-commerce-status" title={text.status}>
                    {configuration ? (
                        <dl className="divide-y text-sm">
                            <StatusRow
                                label={text.status}
                                value={
                                    <Badge variant={configuration.ready ? 'secondary' : 'outline'}>
                                        {configuration.ready ? text.ready : text.pending}
                                    </Badge>
                                }
                            />
                            <StatusRow label={text.store} value={configuration.channelCode} />
                            <StatusRow label={text.currency} value={configuration.currencyCode} />
                            <StatusRow
                                label={text.taxZone}
                                value={configuration.taxZoneName ?? text.notCreated}
                            />
                            <StatusRow
                                label={text.shippingZone}
                                value={configuration.shippingZoneName ?? text.notCreated}
                            />
                        </dl>
                    ) : (
                        <ConfigurationSkeleton />
                    )}
                </PageBlock>
            </PageLayout>
        </Page>
    );
}

function ConfigurationState({
    query,
    text,
    children,
}: Readonly<{
    query: { isPending: boolean; isError: boolean; refetch: () => unknown };
    text: typeof zhCopy;
    children: ReactNode;
}>) {
    if (query.isPending) return <ConfigurationSkeleton />;
    if (query.isError) {
        return (
            <Alert variant="destructive">
                <AlertDescription className="flex items-center justify-between gap-3">
                    <span>{text.loadError}</span>
                    <Button type="button" size="sm" variant="outline" onClick={() => query.refetch()}>
                        <RefreshCw className="size-4" aria-hidden="true" />
                        {text.retry}
                    </Button>
                </AlertDescription>
            </Alert>
        );
    }
    return children;
}

function CountrySelect({
    id,
    countries,
    value,
    placeholder,
    onChange,
}: Readonly<{
    id: string;
    countries: StoreCountryRecord[];
    value: string;
    placeholder: string;
    onChange: (value: string) => void;
}>) {
    return (
        <Select
            value={value || undefined}
            onValueChange={selectedValue => selectedValue && onChange(selectedValue)}
        >
            <SelectTrigger id={id} className="w-full">
                <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
                {countries.map(country => (
                    <SelectItem key={country.id} value={country.code}>
                        {country.name} ({country.code})
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

function Field({
    id,
    label,
    className,
    children,
}: Readonly<{ id: string; label: string; className?: string; children: ReactNode }>) {
    return (
        <div className={`space-y-2 ${className ?? ''}`}>
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
}: Readonly<{ id: string; label: string; checked: boolean; onChange: (value: boolean) => void }>) {
    return (
        <div className="flex min-w-0 items-center justify-between gap-4 border-t py-3 sm:border-t-0 sm:py-0">
            <Label htmlFor={id}>{label}</Label>
            <Switch id={id} className="shrink-0" checked={checked} onCheckedChange={onChange} />
        </div>
    );
}

function SaveButton({
    draft,
    pending,
    save,
    text,
    fullWidth = false,
}: Readonly<{
    draft: CommerceDraft | null;
    pending: boolean;
    save: () => void;
    text: typeof zhCopy;
    fullWidth?: boolean;
}>) {
    return (
        <Button
            type="button"
            className={fullWidth ? 'w-full' : undefined}
            onClick={save}
            disabled={!draft || pending}
        >
            {pending ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
                <Save className="size-4" aria-hidden="true" />
            )}
            {pending ? text.saving : text.save}
        </Button>
    );
}

function StatusRow({ label, value }: Readonly<{ label: string; value: ReactNode }>) {
    return (
        <div className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words text-right font-medium">{value}</dd>
        </div>
    );
}

function ConfigurationSkeleton() {
    return (
        <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-2/3" />
        </div>
    );
}

function toDraft(configuration: StoreCommerceConfigurationRecord): CommerceDraft {
    return {
        expectedUpdatedAt: configuration.updatedAt,
        pricesIncludeTax: configuration.pricesIncludeTax,
        countryCode: configuration.countryCode ?? '',
        taxRate: configuration.taxRate,
        shippingMethodNameZh: configuration.shippingMethodNameZh,
        shippingMethodNameEn: configuration.shippingMethodNameEn,
        shippingDescriptionZh: configuration.shippingDescriptionZh,
        shippingDescriptionEn: configuration.shippingDescriptionEn,
        baseRate: minorToMajor(configuration.baseRate, configuration.currencyCode),
        freeShippingThreshold: minorToMajor(configuration.freeShippingThreshold, configuration.currencyCode),
        shippingTaxRate: configuration.shippingTaxRate,
        shippingPriceIncludesTax: configuration.shippingPriceIncludesTax,
        estimateMinDays: configuration.estimateMinDays,
        estimateMaxDays: configuration.estimateMaxDays,
        blockedPostalPrefixes: configuration.blockedPostalPrefixes,
    };
}

function validDraft(draft: CommerceDraft): boolean {
    return (
        /^[A-Z]{2}$/u.test(draft.countryCode) &&
        draft.shippingMethodNameZh.trim().length > 0 &&
        inRange(draft.taxRate, 0, 100) &&
        inRange(draft.shippingTaxRate, 0, 100) &&
        inRange(draft.baseRate, 0, Number.MAX_SAFE_INTEGER) &&
        inRange(draft.freeShippingThreshold, 0, Number.MAX_SAFE_INTEGER) &&
        Number.isInteger(draft.estimateMinDays) &&
        Number.isInteger(draft.estimateMaxDays) &&
        inRange(draft.estimateMinDays, 0, 365) &&
        inRange(draft.estimateMaxDays, draft.estimateMinDays, 365)
    );
}

function inRange(value: number, min: number, max: number): boolean {
    return Number.isFinite(value) && value >= min && value <= max;
}

function numberValue(value: string): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function currencyDigits(currencyCode?: string): number {
    if (!currencyCode) return 2;
    try {
        return (
            new Intl.NumberFormat('en', { style: 'currency', currency: currencyCode }).resolvedOptions()
                .maximumFractionDigits ?? 2
        );
    } catch {
        return 2;
    }
}

function minorToMajor(value: number, currencyCode?: string): number {
    return value / 10 ** currencyDigits(currencyCode);
}

function majorToMinor(value: number, currencyCode?: string): number {
    return Math.round(value * 10 ** currencyDigits(currencyCode));
}

function currencyStep(currencyCode?: string): number {
    return 1 / 10 ** currencyDigits(currencyCode);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
