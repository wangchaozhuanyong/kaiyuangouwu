import { useMutation } from '@apollo/client/react';
import { Languages, MapPin, Pencil, ReceiptText, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { sensitiveActionContext } from '../../apollo';
import { AdminButton, AdminInput, AdminSelect } from '../../components/AdminControls';
import { DraftUpdateNotice } from '../../components/DraftUpdateNotice';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { useConfirmDialog } from '../../components/confirm-dialog-context';
import { DynamicCustomFieldsForm } from '../../custom-fields/DynamicCustomFieldsForm';
import {
    addCustomFieldsToDocument,
    customFieldInputFromValues,
    customFieldValuesFromEntity,
    validateCustomFieldValues,
} from '../../custom-fields/custom-field-utils';
import { useCustomFieldDefinitions } from '../../custom-fields/custom-fields-context';
import {
    ADD_BUSINESS_ZONE_MEMBERS_MUTATION,
    BUSINESS_SETTINGS_QUERY,
    CREATE_BUSINESS_COUNTRY_MUTATION,
    CREATE_BUSINESS_TAX_CATEGORY_MUTATION,
    CREATE_BUSINESS_TAX_RATE_MUTATION,
    CREATE_BUSINESS_ZONE_MUTATION,
    DELETE_BUSINESS_COUNTRY_MUTATION,
    DELETE_BUSINESS_TAX_CATEGORY_MUTATION,
    DELETE_BUSINESS_TAX_RATE_MUTATION,
    DELETE_BUSINESS_ZONE_MUTATION,
    REMOVE_BUSINESS_ZONE_MEMBERS_MUTATION,
    UPDATE_BUSINESS_CHANNEL_MUTATION,
    UPDATE_BUSINESS_COUNTRY_MUTATION,
    UPDATE_BUSINESS_TAX_CATEGORY_MUTATION,
    UPDATE_BUSINESS_TAX_RATE_MUTATION,
    UPDATE_BUSINESS_ZONE_MUTATION,
    UPDATE_GLOBAL_SETTINGS_MUTATION,
    type BusinessSettingsResult,
} from '../../graphql/management.graphql';
import { useAdminQuery as useQuery } from '../../hooks/use-admin-query';
import { useServerDraft } from '../../hooks/use-server-draft';
import { useStandaloneAdminPage } from '../../hooks/use-standalone-admin-page';
import { getChannelDisplayName } from '../../utils/channel-display';
import { mergeQueryLists } from '../../utils/merge-query-lists';
import { selectQueryFields } from '../../utils/select-query-fields';
import { toUserFacingError } from '../../utils/user-facing-error';
import { runVerifiedMutation } from '../../utils/verified-mutation';
import { MultiValueChoiceField } from './BusinessSettingsChoices';
import {
    BUSINESS_CURRENCY_CHOICES,
    BUSINESS_LANGUAGE_CHOICES,
    COUNTRY_PRESETS,
    TAX_CATEGORY_PRESETS,
    businessChoiceLabel,
} from './business-settings-choice-data';
import {
    CheckboxControl,
    CheckboxField,
    ErrorState,
    Field,
    FieldGroup,
    LoadingState,
    SettingsFormGrid,
    errorText,
    inputClass,
    primaryButton,
    secondaryButton,
} from './settings-ui';

interface GlobalSettingsExpectation {
    availableLanguages: string[];
    trackInventory: boolean;
    outOfStockThreshold: number;
}

interface ChannelSettingsExpectation {
    availableLanguageCodes: string[];
    defaultLanguageCode: string;
    availableCurrencyCodes: string[];
    defaultCurrencyCode: string;
    defaultTaxZoneId: string | null;
    defaultShippingZoneId: string | null;
    pricesIncludeTax: boolean;
    trackInventory: boolean;
    outOfStockThreshold: number;
}

interface PersistedChannelSettings {
    availableLanguageCodes: string[];
    defaultLanguageCode: string;
    availableCurrencyCodes: string[];
    defaultCurrencyCode: string;
    defaultTaxZone: { id: string } | null;
    defaultShippingZone: { id: string } | null;
    pricesIncludeTax: boolean;
    trackInventory: boolean | null;
    outOfStockThreshold: number | null;
}

function sameStringValues(actual: string[], expected: string[]) {
    return [...actual].sort().join('\u0000') === [...expected].sort().join('\u0000');
}

function assertGlobalSettingsPersisted(
    actual: GlobalSettingsExpectation,
    expected: GlobalSettingsExpectation,
) {
    const mismatches: string[] = [];
    if (!sameStringValues(actual.availableLanguages, expected.availableLanguages))
        mismatches.push('平台可用语言');
    if (actual.trackInventory !== expected.trackInventory) mismatches.push('默认跟踪库存');
    if (actual.outOfStockThreshold !== expected.outOfStockThreshold) mismatches.push('全局缺货阈值');
    if (mismatches.length > 0) {
        throw new Error(`设置未真正保存，服务端回读仍是旧值：${mismatches.join('、')}`);
    }
}

function assertChannelSettingsPersisted(
    actual: PersistedChannelSettings,
    expected: ChannelSettingsExpectation,
) {
    const mismatches: string[] = [];
    if (!sameStringValues(actual.availableLanguageCodes, expected.availableLanguageCodes))
        mismatches.push('店铺内容语言');
    if (actual.defaultLanguageCode !== expected.defaultLanguageCode) mismatches.push('默认语言');
    if (!sameStringValues(actual.availableCurrencyCodes, expected.availableCurrencyCodes))
        mismatches.push('店铺结算币种');
    if (actual.defaultCurrencyCode !== expected.defaultCurrencyCode) mismatches.push('默认币种');
    if ((actual.defaultTaxZone?.id ?? null) !== expected.defaultTaxZoneId) mismatches.push('默认计税区域');
    if ((actual.defaultShippingZone?.id ?? null) !== expected.defaultShippingZoneId)
        mismatches.push('默认配送区域');
    if (actual.pricesIncludeTax !== expected.pricesIncludeTax) mismatches.push('商品价格已含税');
    if (actual.trackInventory !== expected.trackInventory) mismatches.push('默认跟踪库存');
    if (actual.outOfStockThreshold !== expected.outOfStockThreshold) mismatches.push('缺货阈值');
    if (mismatches.length > 0) {
        throw new Error(`设置未真正保存，服务端回读仍是旧值：${mismatches.join('、')}`);
    }
}

export function BusinessBasicsPanel({
    onChanged,
    onError,
    storeScoped = false,
}: {
    storeScoped?: boolean;
    onChanged: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const standalonePage = useStandaloneAdminPage();
    const loadingAllBusinessSettingsRef = useRef(false);
    const channelCustomFieldDefinitions = useCustomFieldDefinitions('Channel');
    const businessSettingsDocument = useMemo(
        () =>
            addCustomFieldsToDocument(BUSINESS_SETTINGS_QUERY, 'Channel', channelCustomFieldDefinitions, [
                'activeChannel',
            ]),
        [channelCustomFieldDefinitions],
    );
    const query = useQuery<BusinessSettingsResult>(
        standalonePage
            ? selectQueryFields(
                  businessSettingsDocument,
                  standalonePage.detail === 'global'
                      ? ['globalSettings', 'activeChannel']
                      : standalonePage.detail === 'language'
                        ? ['activeChannel', 'channels', 'globalSettings', 'zones']
                        : standalonePage.detail === 'taxes'
                          ? ['taxCategories', 'taxRates', 'zones', 'activeChannel']
                          : ['countries', 'zones', 'channels', 'activeChannel', 'taxRates'],
              )
            : businessSettingsDocument,
        {
            variables: {
                zoneOptions: { skip: 0, take: 100, sort: { name: 'ASC', id: 'ASC' } },
                countryOptions: { skip: 0, take: 100, sort: { name: 'ASC', id: 'ASC' } },
                taxCategoryOptions: { skip: 0, take: 100, sort: { name: 'ASC', id: 'ASC' } },
                taxRateOptions: { skip: 0, take: 100, sort: { name: 'ASC', id: 'ASC' } },
            },
        },
    );
    const {
        data: businessSettingsData,
        error: businessSettingsError,
        fetchMore: fetchMoreBusinessSettings,
        loading: businessSettingsLoading,
    } = query;
    useEffect(() => {
        const data = businessSettingsData;
        if (
            !data ||
            businessSettingsLoading ||
            businessSettingsError ||
            loadingAllBusinessSettingsRef.current
        )
            return;
        const zoneCount = data.zones?.items.length ?? 0;
        const countryCount = data.countries?.items.length ?? 0;
        const categoryCount = data.taxCategories?.items.length ?? 0;
        const rateCount = data.taxRates?.items.length ?? 0;
        if (
            zoneCount >= (data.zones?.totalItems ?? 0) &&
            countryCount >= (data.countries?.totalItems ?? 0) &&
            categoryCount >= (data.taxCategories?.totalItems ?? 0) &&
            rateCount >= (data.taxRates?.totalItems ?? 0)
        )
            return;
        loadingAllBusinessSettingsRef.current = true;
        void fetchMoreBusinessSettings({
            variables: {
                zoneOptions: { skip: zoneCount, take: 100, sort: { name: 'ASC', id: 'ASC' } },
                countryOptions: { skip: countryCount, take: 100, sort: { name: 'ASC', id: 'ASC' } },
                taxCategoryOptions: { skip: categoryCount, take: 100, sort: { name: 'ASC', id: 'ASC' } },
                taxRateOptions: { skip: rateCount, take: 100, sort: { name: 'ASC', id: 'ASC' } },
            },
            updateQuery: (previous, { fetchMoreResult }) =>
                mergeQueryLists(previous, fetchMoreResult, [
                    'zones',
                    'countries',
                    'taxCategories',
                    'taxRates',
                ]),
        })
            .catch(fetchError => {
                onError(toUserFacingError(fetchError, '区域、国家或税率数据未能全部加载'));
            })
            .finally(() => {
                loadingAllBusinessSettingsRef.current = false;
            });
    }, [
        businessSettingsData,
        businessSettingsError,
        businessSettingsLoading,
        fetchMoreBusinessSettings,
        onError,
    ]);
    if (query.loading && !query.data) return <LoadingState />;
    if ((query.error && !query.data) || !query.data)
        return (
            <ErrorState
                message={
                    query.error
                        ? toUserFacingError(query.error, '业务基础配置读取失败')
                        : '业务基础配置读取失败'
                }
                onRetry={() => void query.refetch()}
            />
        );
    const refresh = async (message: string) => {
        await query.refetch();
        await onChanged(message);
    };
    const verifyGlobalRefresh = async (message: string, expected: GlobalSettingsExpectation) => {
        const refreshed = await query.refetch();
        if (!refreshed.data) throw new Error('设置保存后无法从服务端回读校验');
        assertGlobalSettingsPersisted(refreshed.data.globalSettings, expected);
        await onChanged(message);
    };
    const verifyChannelRefresh = async (message: string, expected: ChannelSettingsExpectation) => {
        const refreshed = await query.refetch();
        if (!refreshed.data) throw new Error('设置保存后无法从服务端回读校验');
        assertChannelSettingsPersisted(refreshed.data.activeChannel, expected);
        await onChanged(message);
    };
    return (
        <div className="space-y-4">
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs leading-5 text-blue-800">
                <strong className="block text-sm">按业务选项配置，不需要记代码</strong>
                <span className="mt-1 block">
                    建议顺序：先选择语言和币种，再从国家列表创建业务区域，最后按“税类 +
                    区域”设置税率。只有自定义项目才需要手工命名。
                </span>
            </div>
            {!storeScoped &&
                (!standalonePage || ['global', 'language'].includes(standalonePage.detail ?? '')) && (
                    <GlobalBusinessSettings
                        settings={query.data.globalSettings}
                        onChanged={verifyGlobalRefresh}
                        onError={onError}
                    />
                )}
            {
                <ChannelBusinessSettings
                    channel={query.data.activeChannel}
                    zones={query.data.zones?.items ?? []}
                    platformLanguages={
                        query.data.globalSettings?.availableLanguages ??
                        query.data.activeChannel.availableLanguageCodes
                    }
                    customFieldDefinitions={channelCustomFieldDefinitions}
                    onChanged={verifyChannelRefresh}
                    onError={onError}
                />
            }
            <div className="space-y-4">
                {(!standalonePage || standalonePage.detail === 'taxes') && (
                    <TaxBusinessSettings
                        categories={query.data.taxCategories?.items ?? []}
                        rates={query.data.taxRates?.items ?? []}
                        zones={query.data.zones?.items}
                        onChanged={refresh}
                        onError={onError}
                    />
                )}
                {(!standalonePage || standalonePage.detail === 'regions') && (
                    <ZoneBusinessSettings
                        zones={query.data.zones?.items}
                        countries={query.data.countries?.items ?? []}
                        channels={query.data.channels.items}
                        taxRates={query.data.taxRates?.items ?? []}
                        languageCode={query.data.activeChannel.defaultLanguageCode}
                        onChanged={refresh}
                        onError={onError}
                    />
                )}
            </div>
        </div>
    );
}

function GlobalBusinessSettings({
    settings,
    onChanged,
    onError,
}: {
    settings: BusinessSettingsResult['globalSettings'];
    onChanged: (message: string, expected: GlobalSettingsExpectation) => Promise<void>;
    onError: (message: string) => void;
}) {
    const page = useStandaloneAdminPage();
    const languagePage = page?.detail === 'language';
    const source = {
        languages: [...settings.availableLanguages],
        trackInventory: settings.trackInventory,
        outOfStockThreshold: String(settings.outOfStockThreshold),
    };
    const draftOwner = useServerDraft('global-settings', JSON.stringify(source), source);
    const draft = draftOwner.draft ?? source;
    const { languages, trackInventory, outOfStockThreshold } = draft;
    const setLanguages = (value: string[]) =>
        draftOwner.setDraft(current => ({ ...(current ?? draft), languages: value }));
    const setTrackInventory = (value: boolean) =>
        draftOwner.setDraft(current => ({ ...(current ?? draft), trackInventory: value }));
    const setOutOfStockThreshold = (value: string) =>
        draftOwner.setDraft(current => ({ ...(current ?? draft), outOfStockThreshold: value }));
    const [update, state] = useMutation<{
        updateGlobalSettings:
            | ({ __typename: 'GlobalSettings' } & GlobalSettingsExpectation)
            | { __typename: 'ChannelDefaultLanguageError'; message?: string };
    }>(UPDATE_GLOBAL_SETTINGS_MUTATION);
    const submit = async () => {
        if (draftOwner.sourceChanged) return;
        const availableLanguages = languages;
        const threshold = Number(outOfStockThreshold);
        if (!availableLanguages.length) return onError('至少保留一种平台可用语言');
        if (!Number.isInteger(threshold) || threshold < 0) return onError('全局缺货阈值必须为非负整数');
        const expected: GlobalSettingsExpectation = {
            availableLanguages,
            trackInventory,
            outOfStockThreshold: threshold,
        };
        try {
            await runVerifiedMutation({
                action: '保存',
                successMessage: '平台全局设置已从服务端回读确认',
                failureMessage: '平台全局设置保存失败',
                mutate: () =>
                    update({
                        variables: {
                            input: !page
                                ? expected
                                : languagePage
                                  ? { availableLanguages }
                                  : { trackInventory, outOfStockThreshold: threshold },
                        },
                        context: { adminFeedback: false },
                    }),
                verify: async response => {
                    const result = response.data?.updateGlobalSettings;
                    if (result?.__typename !== 'GlobalSettings') {
                        throw new Error(result?.message || '全局设置更新被拒绝');
                    }
                    assertGlobalSettingsPersisted(result, expected);
                    draftOwner.accept(draft);
                    await onChanged('平台全局语言和库存默认值已更新', expected);
                },
            });
        } catch (error) {
            onError(errorText(error));
        }
    };
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
            {draftOwner.sourceChanged && <DraftUpdateNotice onReload={draftOwner.reload} />}
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                    <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                        平台全局设置
                        <FeatureHelpButton
                            topic="settings.store-profile"
                            title="平台全局设置"
                            description={'影响所有 Channel 可选语言和库存默认行为'}
                        />
                    </h2>
                </div>
                <AdminButton
                    type="button"
                    onClick={() => void submit()}
                    disabled={state.loading || draftOwner.sourceChanged}
                    className={primaryButton}
                >
                    {state.loading ? '保存中…' : '保存全局设置'}
                </AdminButton>
            </div>
            <SettingsFormGrid columns={3} className="mt-4">
                {(!page || languagePage) && (
                    <MultiValueChoiceField
                        label="平台可用语言"
                        description="从列表添加后台允许店铺使用的内容语言。"
                        values={languages}
                        choices={BUSINESS_LANGUAGE_CHOICES}
                        addLabel="选择要添加的语言"
                        onChange={setLanguages}
                        disabled={state.loading || draftOwner.sourceChanged}
                    />
                )}
                {!languagePage && (
                    <Field label="全局缺货阈值" description="为使用全局规则的 SKU 设置库存可售边界。">
                        <AdminInput
                            type="number"
                            min="0"
                            value={outOfStockThreshold}
                            onChange={event => setOutOfStockThreshold(event.target.value)}
                            className={inputClass}
                        />
                    </Field>
                )}
                {!languagePage && (
                    <CheckboxField
                        label="库存跟踪"
                        description="作为新建 SKU 的平台默认库存行为。"
                        checkboxLabel="默认跟踪库存"
                        checked={trackInventory}
                        onChange={event => setTrackInventory(event.target.checked)}
                        disabled={state.loading || draftOwner.sourceChanged}
                    />
                )}
            </SettingsFormGrid>
        </section>
    );
}

function ChannelBusinessSettings({
    channel,
    zones,
    platformLanguages,
    customFieldDefinitions,
    onChanged,
    onError,
}: {
    channel: BusinessSettingsResult['activeChannel'];
    zones: BusinessSettingsResult['zones']['items'];
    platformLanguages: string[];
    customFieldDefinitions: ReturnType<typeof useCustomFieldDefinitions>;
    onChanged: (message: string, expected: ChannelSettingsExpectation) => Promise<void>;
    onError: (message: string) => void;
}) {
    const page = useStandaloneAdminPage();
    const view = page?.detail;
    const source = {
        languages: [...channel.availableLanguageCodes],
        currencies: [...channel.availableCurrencyCodes],
        defaultLanguage: channel.defaultLanguageCode,
        defaultCurrency: channel.defaultCurrencyCode,
        taxZoneId: channel.defaultTaxZone?.id ?? '',
        shippingZoneId: channel.defaultShippingZone?.id ?? '',
        pricesIncludeTax: channel.pricesIncludeTax,
        trackInventory: channel.trackInventory ?? true,
        outOfStockThreshold: String(channel.outOfStockThreshold ?? 0),
        customFieldValues: customFieldValuesFromEntity(customFieldDefinitions, channel.customFields),
    };
    const draftOwner = useServerDraft(channel.id, JSON.stringify(source), source);
    const draft = draftOwner.draft ?? source;
    const {
        languages,
        currencies,
        defaultLanguage,
        defaultCurrency,
        taxZoneId,
        shippingZoneId,
        pricesIncludeTax,
        trackInventory,
        outOfStockThreshold,
        customFieldValues,
    } = draft;
    const setField = <K extends keyof typeof draft>(field: K, value: (typeof draft)[K]) =>
        draftOwner.setDraft(current => ({ ...(current ?? draft), [field]: value }));
    const setLanguages = (value: typeof draft.languages) => setField('languages', value);
    const setCurrencies = (value: typeof draft.currencies) => setField('currencies', value);
    const setDefaultLanguage = (value: typeof draft.defaultLanguage) => setField('defaultLanguage', value);
    const setDefaultCurrency = (value: typeof draft.defaultCurrency) => setField('defaultCurrency', value);
    const setTaxZoneId = (value: typeof draft.taxZoneId) => setField('taxZoneId', value);
    const setShippingZoneId = (value: typeof draft.shippingZoneId) => setField('shippingZoneId', value);
    const setPricesIncludeTax = (value: typeof draft.pricesIncludeTax) => setField('pricesIncludeTax', value);
    const setTrackInventory = (value: typeof draft.trackInventory) => setField('trackInventory', value);
    const setOutOfStockThreshold = (value: typeof draft.outOfStockThreshold) =>
        setField('outOfStockThreshold', value);
    const setCustomFieldValues = (value: typeof draft.customFieldValues) =>
        setField('customFieldValues', value);
    const [update, state] = useMutation<{
        updateChannel:
            | ({ __typename: 'Channel'; id: string; code: string } & PersistedChannelSettings)
            | { __typename: 'LanguageNotAvailableError'; message?: string };
    }>(UPDATE_BUSINESS_CHANNEL_MUTATION);
    const submit = async () => {
        if (draftOwner.sourceChanged) return;
        const availableLanguageCodes = languages;
        const availableCurrencyCodes = currencies;
        if (!availableLanguageCodes.includes(defaultLanguage)) return onError('默认语言必须包含在可用语言中');
        if (!availableCurrencyCodes.includes(defaultCurrency)) return onError('默认币种必须包含在可用币种中');
        const threshold = Number(outOfStockThreshold);
        if (!Number.isInteger(threshold) || threshold < 0) return onError('缺货阈值必须为非负整数');
        const customFieldErrors = validateCustomFieldValues(customFieldDefinitions, customFieldValues);
        if (Object.keys(customFieldErrors).length > 0) {
            return onError(Object.values(customFieldErrors)[0] ?? '店铺扩展字段校验失败');
        }
        const expected: ChannelSettingsExpectation = {
            availableLanguageCodes,
            defaultLanguageCode: defaultLanguage,
            availableCurrencyCodes,
            defaultCurrencyCode: defaultCurrency,
            defaultTaxZoneId: taxZoneId || null,
            defaultShippingZoneId: shippingZoneId || null,
            pricesIncludeTax,
            trackInventory,
            outOfStockThreshold: threshold,
        };
        try {
            await runVerifiedMutation({
                action: '保存',
                successMessage: '店铺基础设置已从服务端回读确认',
                failureMessage: '店铺基础设置保存失败',
                mutate: () =>
                    update({
                        variables: {
                            input: {
                                id: channel.id,
                                ...(!view
                                    ? expected
                                    : view === 'language'
                                      ? { availableLanguageCodes, defaultLanguageCode: defaultLanguage }
                                      : view === 'currency'
                                        ? { availableCurrencyCodes, defaultCurrencyCode: defaultCurrency }
                                        : view === 'taxes'
                                          ? { defaultTaxZoneId: taxZoneId || null }
                                          : view === 'regions'
                                            ? { defaultShippingZoneId: shippingZoneId || null }
                                            : {
                                                  pricesIncludeTax,
                                                  trackInventory,
                                                  outOfStockThreshold: threshold,
                                                  customFields: customFieldInputFromValues(
                                                      customFieldDefinitions,
                                                      customFieldValues,
                                                  ),
                                              }),
                            },
                        },
                        context: { adminFeedback: false },
                    }),
                verify: async response => {
                    const result = response.data?.updateChannel;
                    if (result?.__typename !== 'Channel') {
                        throw new Error(result?.message || '后端拒绝更新渠道配置');
                    }
                    assertChannelSettingsPersisted(result, expected);
                    draftOwner.accept(draft);
                    await onChanged('当前店铺的语言、币种和业务参数已更新', expected);
                },
            });
        } catch (error) {
            onError(errorText(error));
        }
    };
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
            {draftOwner.sourceChanged && <DraftUpdateNotice onReload={draftOwner.reload} />}
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
                <div>
                    <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                        <Languages className="h-4 w-4 text-blue-600" />
                        {page?.title ?? '当前店铺语言与币种'}
                        <FeatureHelpButton topic="settings.store-profile" title="当前店铺语言与币种" />
                    </h2>
                    <p className="mt-1 text-xs text-slate-400">
                        {getChannelDisplayName(channel)} · 直接选择店铺要使用的选项
                    </p>
                </div>
                <AdminButton
                    type="button"
                    onClick={() => void submit()}
                    disabled={state.loading || draftOwner.sourceChanged}
                    className={primaryButton}
                >
                    {state.loading ? '保存中…' : '保存基础参数'}
                </AdminButton>
            </div>
            <SettingsFormGrid columns={4} className="mt-4">
                {(!view || view === 'language') && (
                    <MultiValueChoiceField
                        label="店铺内容语言"
                        description="顾客在前台可切换的语言。"
                        values={languages}
                        choices={BUSINESS_LANGUAGE_CHOICES.filter(
                            choice =>
                                platformLanguages.includes(choice.value) || languages.includes(choice.value),
                        )}
                        addLabel="选择要添加的语言"
                        onChange={nextLanguages => {
                            setLanguages(nextLanguages);
                            if (!nextLanguages.includes(defaultLanguage))
                                setDefaultLanguage(nextLanguages[0] ?? '');
                        }}
                        disabled={state.loading || draftOwner.sourceChanged}
                    />
                )}
                {(!view || view === 'language') && (
                    <Field label="默认语言" description="新内容优先采用的语言。">
                        <AdminSelect
                            value={defaultLanguage}
                            onChange={event => setDefaultLanguage(event.target.value)}
                            className={inputClass}
                        >
                            {languages.map(language => (
                                <option key={language} value={language}>
                                    {businessChoiceLabel(language, BUSINESS_LANGUAGE_CHOICES)}
                                </option>
                            ))}
                        </AdminSelect>
                    </Field>
                )}
                {(!view || view === 'currency') && (
                    <MultiValueChoiceField
                        label="店铺结算币种"
                        description="选择商品定价和顾客结算可使用的币种。"
                        values={currencies}
                        choices={BUSINESS_CURRENCY_CHOICES}
                        addLabel="选择要添加的币种"
                        onChange={nextCurrencies => {
                            setCurrencies(nextCurrencies);
                            if (!nextCurrencies.includes(defaultCurrency))
                                setDefaultCurrency(nextCurrencies[0] ?? '');
                        }}
                        disabled={state.loading || draftOwner.sourceChanged}
                    />
                )}
                {(!view || view === 'currency') && (
                    <Field label="默认币种" description="商品定价和订单结算的默认币种。">
                        <AdminSelect
                            value={defaultCurrency}
                            onChange={event => setDefaultCurrency(event.target.value)}
                            className={inputClass}
                        >
                            {currencies.map(currency => (
                                <option key={currency} value={currency}>
                                    {businessChoiceLabel(currency, BUSINESS_CURRENCY_CHOICES)}
                                </option>
                            ))}
                        </AdminSelect>
                    </Field>
                )}
                {(!view || view === 'taxes') && (
                    <Field label="默认计税区域" description="没有单独指定时使用的税务区域。">
                        <AdminSelect
                            value={taxZoneId}
                            onChange={event => setTaxZoneId(event.target.value)}
                            className={inputClass}
                        >
                            <option value="">未设置</option>
                            {zones.map(zone => (
                                <option key={zone.id} value={zone.id}>
                                    {zone.name}
                                </option>
                            ))}
                        </AdminSelect>
                    </Field>
                )}
                {(!view || view === 'regions') && (
                    <Field label="默认配送区域" description="没有单独指定时使用的配送区域。">
                        <AdminSelect
                            value={shippingZoneId}
                            onChange={event => setShippingZoneId(event.target.value)}
                            className={inputClass}
                        >
                            <option value="">未设置</option>
                            {zones.map(zone => (
                                <option key={zone.id} value={zone.id}>
                                    {zone.name}
                                </option>
                            ))}
                        </AdminSelect>
                    </Field>
                )}
                {(!view || view === 'global') && (
                    <Field label="缺货阈值" description="当前店铺用于判断可售库存的安全边界。">
                        <AdminInput
                            type="number"
                            min="0"
                            value={outOfStockThreshold}
                            onChange={event => setOutOfStockThreshold(event.target.value)}
                            className={inputClass}
                        />
                    </Field>
                )}
                {(!view || view === 'global') && (
                    <FieldGroup label="业务规则" description="控制当前店铺的计价和库存默认行为。">
                        <div className="grid gap-2">
                            <CheckboxControl
                                label="商品价格已含税"
                                checked={pricesIncludeTax}
                                onChange={event => setPricesIncludeTax(event.target.checked)}
                                disabled={state.loading || draftOwner.sourceChanged}
                            />
                            <CheckboxControl
                                label="默认跟踪库存"
                                checked={trackInventory}
                                onChange={event => setTrackInventory(event.target.checked)}
                                disabled={state.loading || draftOwner.sourceChanged}
                            />
                        </div>
                    </FieldGroup>
                )}
            </SettingsFormGrid>
            <div className="mt-4">
                {(!view || view === 'global') && (
                    <DynamicCustomFieldsForm
                        helpTopic="settings.store-profile"
                        fields={customFieldDefinitions}
                        values={customFieldValues}
                        onChange={setCustomFieldValues}
                        disabled={state.loading || draftOwner.sourceChanged}
                        title="当前店铺扩展参数"
                    />
                )}
            </div>
        </section>
    );
}

function TaxBusinessSettings({
    categories,
    rates,
    zones,
    onChanged,
    onError,
}: {
    categories: BusinessSettingsResult['taxCategories']['items'];
    rates: BusinessSettingsResult['taxRates']['items'];
    zones: BusinessSettingsResult['zones']['items'];
    onChanged: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const requestConfirmation = useConfirmDialog();
    const [editingCategoryId, setEditingCategoryId] = useState('');
    const [categoryPreset, setCategoryPreset] = useState('');
    const [categoryName, setCategoryName] = useState('');
    const [categoryDefault, setCategoryDefault] = useState(false);
    const [editingRateId, setEditingRateId] = useState('');
    const [rateName, setRateName] = useState('');
    const [rateValue, setRateValue] = useState('');
    const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
    const [zoneId, setZoneId] = useState(zones[0]?.id ?? '');
    const [createCategory, categoryState] = useMutation(CREATE_BUSINESS_TAX_CATEGORY_MUTATION);
    const [updateCategory, updateCategoryState] = useMutation(UPDATE_BUSINESS_TAX_CATEGORY_MUTATION);
    const [deleteCategory, deleteCategoryState] = useMutation<{
        deleteTaxCategory: { result: string; message?: string | null };
    }>(DELETE_BUSINESS_TAX_CATEGORY_MUTATION);
    const [createRate, rateState] = useMutation(CREATE_BUSINESS_TAX_RATE_MUTATION);
    const [updateRate, updateState] = useMutation(UPDATE_BUSINESS_TAX_RATE_MUTATION);
    const [deleteRate, deleteRateState] = useMutation<{
        deleteTaxRate: { result: string; message?: string | null };
    }>(DELETE_BUSINESS_TAX_RATE_MUTATION);
    const addCategory = async () => {
        if (!categoryName.trim()) return onError('请先选择税类用途或填写自定义税类名称');
        try {
            if (editingCategoryId) {
                await updateCategory({
                    variables: {
                        input: {
                            id: editingCategoryId,
                            name: categoryName.trim(),
                            isDefault: categoryDefault,
                        },
                    },
                });
            } else {
                await createCategory({
                    variables: { input: { name: categoryName.trim(), isDefault: categoryDefault } },
                });
            }
            setEditingCategoryId('');
            setCategoryPreset('');
            setCategoryName('');
            setCategoryDefault(false);
            await onChanged(editingCategoryId ? '税类已更新' : '税类已创建');
        } catch (error) {
            onError(errorText(error));
        }
    };
    const addRate = async () => {
        const value = Number(rateValue);
        if (!rateValue.trim() || !categoryId || !zoneId || !Number.isFinite(value) || value < 0)
            return onError('请选择税类和业务区域，并填写非负税率');
        try {
            const selectedCategory = categories.find(category => category.id === categoryId);
            const selectedZone = zones.find(zone => zone.id === zoneId);
            const generatedName = `${selectedCategory?.name ?? '税率'} · ${selectedZone?.name ?? '业务区域'}`;
            const input = {
                name: rateName.trim() || generatedName,
                value,
                categoryId,
                zoneId,
                enabled: true,
            };
            if (editingRateId) await updateRate({ variables: { input: { id: editingRateId, ...input } } });
            else await createRate({ variables: { input } });
            setEditingRateId('');
            setRateName('');
            setRateValue('');
            await onChanged(editingRateId ? '税率已更新' : '税率已创建');
        } catch (error) {
            onError(errorText(error));
        }
    };
    const toggleRate = async (id: string, enabled: boolean) => {
        try {
            await updateRate({ variables: { input: { id, enabled } } });
            await onChanged(`税率已${enabled ? '启用' : '停用'}`);
        } catch (error) {
            onError(errorText(error));
        }
    };
    const removeCategory = async (id: string, name: string) => {
        const confirmation = await requestConfirmation({
            title: `删除税类“${name}”？`,
            description: '有关联税率或商品时，后端会拒绝不安全的删除。',
            confirmLabel: '验证并删除',
            tone: 'danger',
            requireCurrentPassword: true,
        });
        if (!confirmation) return;
        try {
            const response = await deleteCategory({
                variables: { id },
                context: {
                    ...sensitiveActionContext(confirmation.currentPassword ?? ''),
                    adminFeedback: {
                        target: `税务分类“${name}”`,
                        resolution: ['先删除或改绑引用该分类的税率，再重新删除税务分类'],
                    },
                },
            });
            if (response.data?.deleteTaxCategory.result !== 'DELETED') return;
            await onChanged('税类已删除');
        } catch {
            // Apollo 全局反馈已显示失败原因，避免页面再出现第二条重复错误。
        }
    };
    const removeRate = async (id: string, name: string) => {
        const confirmation = await requestConfirmation({
            title: `删除税率“${name}”？`,
            description: '删除后新订单不再使用该税率，历史订单数据不会改写。',
            confirmLabel: '验证并删除',
            tone: 'danger',
            requireCurrentPassword: true,
        });
        if (!confirmation) return;
        try {
            const response = await deleteRate({
                variables: { id },
                context: {
                    ...sensitiveActionContext(confirmation.currentPassword ?? ''),
                    adminFeedback: {
                        target: `税率“${name}”`,
                        resolution: ['刷新税务配置确认最新状态后，再重新删除税率'],
                    },
                },
            });
            if (response.data?.deleteTaxRate.result !== 'DELETED') return;
            await onChanged('税率已删除');
        } catch {
            // Apollo 全局反馈已显示失败原因，避免页面再出现第二条重复错误。
        }
    };
    const busy =
        categoryState.loading ||
        updateCategoryState.loading ||
        deleteCategoryState.loading ||
        rateState.loading ||
        updateState.loading ||
        deleteRateState.loading;
    return (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 p-5">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    <ReceiptText className="h-4 w-4 text-blue-600" />
                    税类与税率
                    <FeatureHelpButton
                        topic="settings.finance"
                        title="税类与税率"
                        description={'税率按“税类 + 区域”匹配订单'}
                    />
                </h2>
            </div>
            <div className="space-y-4 p-5">
                <SettingsFormGrid columns={2}>
                    <Field
                        label={editingCategoryId ? '税类名称' : '选择税类用途'}
                        description="为商品选择对应的税务规则分组。"
                    >
                        {editingCategoryId ? (
                            <AdminInput
                                value={categoryName}
                                onChange={event => setCategoryName(event.target.value)}
                                placeholder="税类名称"
                                className={inputClass}
                            />
                        ) : (
                            <AdminSelect
                                value={categoryPreset}
                                onChange={event => {
                                    const value = event.target.value;
                                    setCategoryPreset(value);
                                    setCategoryName(value === '__custom__' ? '' : value);
                                }}
                                className={inputClass}
                            >
                                <option value="">请选择要创建的税类</option>
                                {TAX_CATEGORY_PRESETS.map(preset => (
                                    <option
                                        key={preset.value}
                                        value={preset.value}
                                        disabled={categories.some(category => category.name === preset.value)}
                                    >
                                        {preset.label}
                                        {categories.some(category => category.name === preset.value)
                                            ? ' · 已创建'
                                            : ''}
                                    </option>
                                ))}
                                <option value="__custom__">自定义税类</option>
                            </AdminSelect>
                        )}
                    </Field>
                    {categoryPreset === '__custom__' && !editingCategoryId && (
                        <Field label="自定义税类名称" description="仅用于预设列表以外的业务场景。">
                            <AdminInput
                                value={categoryName}
                                onChange={event => setCategoryName(event.target.value)}
                                placeholder="例如：特殊服务"
                                className={inputClass}
                            />
                        </Field>
                    )}
                    <CheckboxField
                        label="默认设置"
                        description="新商品优先采用该税类。"
                        checkboxLabel="设为默认税类"
                        checked={categoryDefault}
                        onChange={event => setCategoryDefault(event.target.checked)}
                        disabled={busy}
                    />
                </SettingsFormGrid>
                <div className="flex flex-wrap gap-2">
                    <AdminButton
                        type="button"
                        onClick={() => void addCategory()}
                        disabled={busy || !categoryName.trim()}
                        className={secondaryButton}
                    >
                        {editingCategoryId ? '保存税类' : '新增税类'}
                    </AdminButton>
                    {editingCategoryId && (
                        <AdminButton
                            type="button"
                            onClick={() => {
                                setEditingCategoryId('');
                                setCategoryPreset('');
                                setCategoryName('');
                                setCategoryDefault(false);
                            }}
                            className={secondaryButton}
                        >
                            取消
                        </AdminButton>
                    )}
                </div>
                <div className="flex flex-wrap gap-2">
                    {categories.map(category => (
                        <span
                            key={category.id}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[10px] text-slate-700"
                        >
                            {category.name}
                            {category.isDefault && <strong className="text-blue-600">默认</strong>}
                            <AdminButton
                                type="button"
                                onClick={() => {
                                    setEditingCategoryId(category.id);
                                    setCategoryPreset(
                                        TAX_CATEGORY_PRESETS.some(preset => preset.value === category.name)
                                            ? category.name
                                            : '__custom__',
                                    );
                                    setCategoryName(category.name);
                                    setCategoryDefault(category.isDefault);
                                }}
                                className="ml-1 text-blue-600"
                                aria-label={`编辑税类${category.name}`}
                            >
                                <Pencil className="h-3 w-3" />
                            </AdminButton>
                            <AdminButton
                                type="button"
                                onClick={() => void removeCategory(category.id, category.name)}
                                className="text-rose-600"
                                aria-label={`删除税类${category.name}`}
                            >
                                <Trash2 className="h-3 w-3" />
                            </AdminButton>
                        </span>
                    ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                    {editingRateId && (
                        <Field label="税率名称">
                            <AdminInput
                                value={rateName}
                                onChange={event => setRateName(event.target.value)}
                                placeholder="税率名称"
                                className={inputClass}
                            />
                        </Field>
                    )}
                    <Field label="税率百分比">
                        <AdminInput
                            type="number"
                            min="0"
                            step="0.01"
                            value={rateValue}
                            onChange={event => setRateValue(event.target.value)}
                            placeholder="例如：6；免税填 0"
                            className={inputClass}
                        />
                    </Field>
                    <Field label="应用到哪个税类">
                        <AdminSelect
                            value={categoryId}
                            onChange={event => setCategoryId(event.target.value)}
                            className={inputClass}
                        >
                            <option value="">请选择税类</option>
                            {categories.map(category => (
                                <option key={category.id} value={category.id}>
                                    {category.name}
                                </option>
                            ))}
                        </AdminSelect>
                    </Field>
                    <Field label="适用哪个业务区域">
                        <AdminSelect
                            value={zoneId}
                            onChange={event => setZoneId(event.target.value)}
                            className={inputClass}
                        >
                            <option value="">请选择业务区域</option>
                            {zones.map(zone => (
                                <option key={zone.id} value={zone.id}>
                                    {zone.name}
                                </option>
                            ))}
                        </AdminSelect>
                    </Field>
                </div>
                {!editingRateId && categoryId && zoneId && rateValue && (
                    <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                        创建后自动命名：
                        {`${categories.find(category => category.id === categoryId)?.name ?? '税类'} · ${zones.find(zone => zone.id === zoneId)?.name ?? '业务区域'}`}
                    </p>
                )}
                <AdminButton
                    type="button"
                    onClick={() => void addRate()}
                    disabled={busy || !rateValue.trim() || !categoryId || !zoneId}
                    className={primaryButton}
                >
                    {editingRateId ? '保存税率' : '创建税率'}
                </AdminButton>
                {editingRateId && (
                    <AdminButton
                        type="button"
                        onClick={() => {
                            setEditingRateId('');
                            setRateName('');
                            setRateValue('');
                        }}
                        className={secondaryButton}
                    >
                        取消编辑
                    </AdminButton>
                )}
            </div>
            <div className="divide-y divide-slate-100 border-t border-slate-100">
                {rates.map(rate => (
                    <div key={rate.id} className="flex items-center justify-between gap-3 p-4">
                        <div>
                            <strong className="text-xs text-slate-900">
                                {rate.name} · {rate.value}%
                            </strong>
                            <p className="mt-1 text-[10px] text-slate-400">
                                {rate.category.name} / {rate.zone.name}
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <label className="flex items-center gap-2 text-[10px] font-bold text-slate-500">
                                <AdminInput
                                    type="checkbox"
                                    checked={rate.enabled}
                                    onChange={event => void toggleRate(rate.id, event.target.checked)}
                                    disabled={busy}
                                />
                                {rate.enabled ? '已启用' : '已停用'}
                            </label>
                            <AdminButton
                                type="button"
                                onClick={() => {
                                    setEditingRateId(rate.id);
                                    setRateName(rate.name);
                                    setRateValue(String(rate.value));
                                    setCategoryId(rate.category.id);
                                    setZoneId(rate.zone.id);
                                }}
                                className="rounded p-1 text-blue-600"
                                aria-label={`编辑税率${rate.name}`}
                            >
                                <Pencil className="h-3.5 w-3.5" />
                            </AdminButton>
                            <AdminButton
                                type="button"
                                onClick={() => void removeRate(rate.id, rate.name)}
                                className="rounded p-1 text-rose-600"
                                aria-label={`删除税率${rate.name}`}
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </AdminButton>
                        </div>
                    </div>
                ))}
                {!rates.length && <div className="p-8 text-center text-xs text-slate-400">尚未配置税率</div>}
            </div>
        </section>
    );
}

function ZoneBusinessSettings({
    zones,
    countries,
    channels,
    taxRates,
    languageCode,
    onChanged,
    onError,
}: {
    zones: BusinessSettingsResult['zones']['items'];
    countries: BusinessSettingsResult['countries']['items'];
    channels: BusinessSettingsResult['channels']['items'];
    taxRates: BusinessSettingsResult['taxRates']['items'];
    languageCode: string;
    onChanged: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const requestConfirmation = useConfirmDialog();
    const [editingZoneId, setEditingZoneId] = useState('');
    const [zonePresetCountryId, setZonePresetCountryId] = useState('');
    const [name, setName] = useState('');
    const [memberIds, setMemberIds] = useState<string[]>([]);
    const [create, state] = useMutation(CREATE_BUSINESS_ZONE_MUTATION);
    const [updateZone, updateZoneState] = useMutation(UPDATE_BUSINESS_ZONE_MUTATION);
    const [addMembers, addMembersState] = useMutation(ADD_BUSINESS_ZONE_MEMBERS_MUTATION);
    const [removeMembers, removeMembersState] = useMutation(REMOVE_BUSINESS_ZONE_MEMBERS_MUTATION);
    const [deleteZone, deleteZoneState] = useMutation<{
        deleteZone: { result: string; message?: string | null };
    }>(DELETE_BUSINESS_ZONE_MUTATION);
    const [editingCountryId, setEditingCountryId] = useState('');
    const [countryPresetCode, setCountryPresetCode] = useState('');
    const [countryCode, setCountryCode] = useState('');
    const [countryName, setCountryName] = useState('');
    const [countryEnabled, setCountryEnabled] = useState(true);
    const [createCountry, createCountryState] = useMutation(CREATE_BUSINESS_COUNTRY_MUTATION);
    const [updateCountry, updateCountryState] = useMutation(UPDATE_BUSINESS_COUNTRY_MUTATION);
    const [deleteCountry, deleteCountryState] = useMutation<{
        deleteCountry: { result: string; message?: string | null };
    }>(DELETE_BUSINESS_COUNTRY_MUTATION);
    const submit = async () => {
        if (!name.trim() || memberIds.length === 0) return onError('请填写区域名称并选择至少一个国家/地区');
        try {
            if (editingZoneId) {
                const existing = zones.find(zone => zone.id === editingZoneId);
                await updateZone({ variables: { input: { id: editingZoneId, name: name.trim() } } });
                const existingIds = existing?.members.map(member => member.id) ?? [];
                const toAdd = memberIds.filter(id => !existingIds.includes(id));
                const toRemove = existingIds.filter(id => !memberIds.includes(id));
                if (toAdd.length)
                    await addMembers({ variables: { zoneId: editingZoneId, memberIds: toAdd } });
                if (toRemove.length)
                    await removeMembers({ variables: { zoneId: editingZoneId, memberIds: toRemove } });
            } else {
                await create({ variables: { input: { name: name.trim(), memberIds } } });
            }
            const wasEditing = Boolean(editingZoneId);
            setEditingZoneId('');
            setZonePresetCountryId('');
            setName('');
            setMemberIds([]);
            await onChanged(wasEditing ? '国家/地区区域已更新' : '国家/地区区域已创建');
        } catch (error) {
            onError(errorText(error));
        }
    };
    const removeZone = async (id: string, zoneName: string) => {
        const channelUsages = channels
            .filter(channel => channel.defaultTaxZone?.id === id || channel.defaultShippingZone?.id === id)
            .map(channel => {
                const roles = [
                    channel.defaultTaxZone?.id === id ? '默认税务区域' : '',
                    channel.defaultShippingZone?.id === id ? '默认配送区域' : '',
                ].filter(Boolean);
                return `店铺“${getChannelDisplayName(channel)}”（${roles.join('、')}）`;
            });
        const taxRateUsages = taxRates.filter(rate => rate.zone.id === id).map(rate => `税率“${rate.name}”`);
        const usages = [...channelUsages, ...taxRateUsages];
        if (usages.length) {
            onError(
                `无法删除业务区域“${zoneName}”，正在占用的对象：${usages.join('、')}。处理方法：先把这些店铺的默认区域和税率改绑到其他业务区域，再重新删除。`,
            );
            return;
        }
        const confirmation = await requestConfirmation({
            title: `删除区域“${zoneName}”？`,
            description: '被 Channel、配送方式或税率引用时，后端会拒绝删除。',
            confirmLabel: '验证并删除',
            tone: 'danger',
            requireCurrentPassword: true,
        });
        if (!confirmation) return;
        try {
            const response = await deleteZone({
                variables: { id },
                context: {
                    ...sensitiveActionContext(confirmation.currentPassword ?? ''),
                    adminFeedback: {
                        target: `业务区域“${zoneName}”`,
                        resolution: [
                            '检查将该区域设为默认区域的店铺 Channel，以及引用它的税率',
                            '先改绑这些配置，再重新删除业务区域',
                        ],
                    },
                },
            });
            if (response.data?.deleteZone.result !== 'DELETED') return;
            await onChanged('区域已删除');
        } catch {
            // Apollo 全局反馈已显示失败原因，避免页面再出现第二条重复错误。
        }
    };
    const submitCountry = async () => {
        if (!countryCode.trim() || !countryName.trim()) return onError('请填写国家代码和名称');
        if (!/^[A-Za-z]{2}$/.test(countryCode.trim())) return onError('国家代码必须是两位英文字母');
        try {
            const input = {
                code: countryCode.trim().toUpperCase(),
                enabled: countryEnabled,
                translations: [{ languageCode, name: countryName.trim() }],
            };
            if (editingCountryId)
                await updateCountry({ variables: { input: { id: editingCountryId, ...input } } });
            else await createCountry({ variables: { input } });
            const wasEditing = Boolean(editingCountryId);
            setEditingCountryId('');
            setCountryPresetCode('');
            setCountryCode('');
            setCountryName('');
            setCountryEnabled(true);
            await onChanged(wasEditing ? '国家/地区已更新' : '国家/地区已创建');
        } catch (error) {
            onError(errorText(error));
        }
    };
    const toggleCountry = async (id: string, enabled: boolean) => {
        try {
            await updateCountry({ variables: { input: { id, enabled } } });
            await onChanged(`国家/地区已${enabled ? '启用' : '停用'}`);
        } catch (error) {
            onError(errorText(error));
        }
    };
    const removeCountry = async (id: string, displayName: string) => {
        const confirmation = await requestConfirmation({
            title: `删除国家/地区“${displayName}”？`,
            description: '被业务区域或历史地址引用时，后端会拒绝不安全的删除。',
            confirmLabel: '验证并删除',
            tone: 'danger',
            requireCurrentPassword: true,
        });
        if (!confirmation) return;
        try {
            const response = await deleteCountry({
                variables: { id },
                context: {
                    ...sensitiveActionContext(confirmation.currentPassword ?? ''),
                    adminFeedback: {
                        target: `国家或地区“${displayName}”`,
                        resolution: [
                            '检查引用该国家或地区的业务区域和客户地址',
                            '先解除关联，再重新删除国家或地区',
                        ],
                    },
                },
            });
            if (response.data?.deleteCountry.result !== 'DELETED') return;
            await onChanged('国家/地区已删除');
        } catch {
            // Apollo 全局反馈已显示失败原因，避免页面再出现第二条重复错误。
        }
    };
    const busy =
        state.loading ||
        updateZoneState.loading ||
        addMembersState.loading ||
        removeMembersState.loading ||
        deleteZoneState.loading ||
        createCountryState.loading ||
        updateCountryState.loading ||
        deleteCountryState.loading;
    return (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 p-5">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    <MapPin className="h-4 w-4 text-blue-600" />
                    国家与业务区域
                    <FeatureHelpButton
                        topic="settings.store-profile"
                        title="国家与业务区域"
                        description={'业务区域是计税和配送范围，不是店铺名称；选择国家后系统会自动命名。'}
                    />
                </h2>
            </div>
            <div className="space-y-3 p-5">
                {!editingZoneId && (
                    <Field label="选择要创建的业务区域">
                        <AdminSelect
                            value={zonePresetCountryId}
                            onChange={event => {
                                const countryId = event.target.value;
                                setZonePresetCountryId(countryId);
                                if (countryId === '__custom__' || !countryId) {
                                    setName('');
                                    setMemberIds([]);
                                    return;
                                }
                                const country = countries.find(item => item.id === countryId);
                                setName(country ? `${country.name}区域` : '');
                                setMemberIds(country ? [country.id] : []);
                            }}
                            className={inputClass}
                        >
                            <option value="">请选择国家/地区</option>
                            {countries
                                .filter(country => country.enabled)
                                .map(country => (
                                    <option key={country.id} value={country.id}>
                                        {country.name}（用于该国计税与配送）
                                    </option>
                                ))}
                            <option value="__custom__">自定义多个国家/地区组合</option>
                        </AdminSelect>
                    </Field>
                )}
                {(editingZoneId || zonePresetCountryId === '__custom__') && (
                    <Field label="业务区域名称">
                        <AdminInput
                            value={name}
                            onChange={event => setName(event.target.value)}
                            placeholder="例如：东南亚区域"
                            className={inputClass}
                        />
                    </Field>
                )}
                {(editingZoneId || zonePresetCountryId === '__custom__') && (
                    <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 p-2">
                        <p className="px-2 pb-2 text-[11px] font-bold text-slate-600">选择包含的国家/地区</p>
                        <div className="grid gap-1 sm:grid-cols-2">
                            {countries.map(country => (
                                <label
                                    key={country.id}
                                    className="flex items-center gap-2 rounded px-2 py-1.5 text-[11px] hover:bg-slate-50"
                                >
                                    <AdminInput
                                        type="checkbox"
                                        checked={memberIds.includes(country.id)}
                                        onChange={event =>
                                            setMemberIds(previous =>
                                                event.target.checked
                                                    ? [...previous, country.id]
                                                    : previous.filter(id => id !== country.id),
                                            )
                                        }
                                    />
                                    <span className="truncate">
                                        {country.name} ({country.code})
                                    </span>
                                </label>
                            ))}
                        </div>
                        {!countries.length && (
                            <p className="py-6 text-center text-xs text-slate-400">请先在下方添加国家/地区</p>
                        )}
                    </div>
                )}
                {!editingZoneId && zonePresetCountryId && zonePresetCountryId !== '__custom__' && (
                    <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                        将创建“{name}”，包含{' '}
                        {countries.find(country => country.id === zonePresetCountryId)?.name}。
                    </p>
                )}
                <AdminButton
                    type="button"
                    onClick={() => void submit()}
                    disabled={busy || !name.trim() || memberIds.length === 0}
                    className={primaryButton}
                >
                    {editingZoneId ? '保存业务区域' : '创建业务区域'}
                </AdminButton>
                {editingZoneId && (
                    <AdminButton
                        type="button"
                        onClick={() => {
                            setEditingZoneId('');
                            setZonePresetCountryId('');
                            setName('');
                            setMemberIds([]);
                        }}
                        className={secondaryButton}
                    >
                        取消编辑
                    </AdminButton>
                )}
            </div>
            <div className="divide-y divide-slate-100 border-t border-slate-100">
                {zones.map(zone => (
                    <div key={zone.id} className="flex items-start justify-between gap-3 p-4">
                        <div>
                            <strong className="text-xs text-slate-900">{zone.name}</strong>
                            <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-400">
                                {zone.members.map(member => member.name).join('、') || '尚无成员'}
                            </p>
                        </div>
                        <div className="flex gap-1">
                            <AdminButton
                                type="button"
                                onClick={() => {
                                    setEditingZoneId(zone.id);
                                    setZonePresetCountryId('__custom__');
                                    setName(zone.name);
                                    setMemberIds(zone.members.map(member => member.id));
                                }}
                                className="rounded p-1 text-blue-600"
                                aria-label={`编辑区域${zone.name}`}
                            >
                                <Pencil className="h-3.5 w-3.5" />
                            </AdminButton>
                            <AdminButton
                                type="button"
                                onClick={() => void removeZone(zone.id, zone.name)}
                                className="rounded p-1 text-rose-600"
                                aria-label={`删除区域${zone.name}`}
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </AdminButton>
                        </div>
                    </div>
                ))}
                {!zones.length && (
                    <div className="p-8 text-center text-xs text-slate-400">尚未创建业务区域</div>
                )}
            </div>
            <div className="space-y-3 border-t border-slate-100 p-5">
                <div>
                    <h3 className="flex items-center gap-2 text-xs font-bold text-slate-800">
                        添加国家/地区
                        <FeatureHelpButton
                            topic="settings.store-profile"
                            title="添加国家/地区"
                            description={'常用国家直接选择，代码和名称会自动填写。'}
                        />
                    </h3>
                </div>
                <Field label={editingCountryId ? '正在编辑' : '选择国家/地区'}>
                    <AdminSelect
                        value={countryPresetCode}
                        onChange={event => {
                            const code = event.target.value;
                            setCountryPresetCode(code);
                            if (code === '__custom__' || !code) {
                                setCountryCode('');
                                setCountryName('');
                                return;
                            }
                            const preset = COUNTRY_PRESETS.find(item => item.code === code);
                            setCountryCode(preset?.code ?? '');
                            setCountryName(preset?.name ?? '');
                        }}
                        disabled={Boolean(editingCountryId)}
                        className={inputClass}
                    >
                        <option value="">请选择要添加的国家/地区</option>
                        {COUNTRY_PRESETS.map(preset => {
                            const exists = countries.some(country => country.code === preset.code);
                            return (
                                <option key={preset.code} value={preset.code} disabled={exists}>
                                    {preset.name}（{preset.code}）{exists ? ' · 已添加' : ''}
                                </option>
                            );
                        })}
                        <option value="__custom__">其他国家/地区（自定义）</option>
                    </AdminSelect>
                </Field>
                {(editingCountryId || countryPresetCode === '__custom__') && (
                    <div className="grid gap-2 sm:grid-cols-2">
                        <Field label="两位国家代码">
                            <AdminInput
                                value={countryCode}
                                onChange={event => setCountryCode(event.target.value)}
                                placeholder="例如：NZ"
                                maxLength={2}
                                className={inputClass}
                            />
                        </Field>
                        <Field label="中文显示名称">
                            <AdminInput
                                value={countryName}
                                onChange={event => setCountryName(event.target.value)}
                                placeholder="例如：新西兰"
                                className={inputClass}
                            />
                        </Field>
                    </div>
                )}
                {!editingCountryId && countryPresetCode && countryPresetCode !== '__custom__' && (
                    <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                        将添加：{countryName}（{countryCode}）
                    </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 text-xs text-slate-600">
                        <AdminInput
                            type="checkbox"
                            checked={countryEnabled}
                            onChange={event => setCountryEnabled(event.target.checked)}
                        />
                        启用
                    </label>
                    <AdminButton
                        type="button"
                        disabled={busy || !countryCode || !countryName}
                        onClick={() => void submitCountry()}
                        className={secondaryButton}
                    >
                        {editingCountryId ? '保存国家/地区' : '新增国家/地区'}
                    </AdminButton>
                    {editingCountryId && (
                        <AdminButton
                            type="button"
                            onClick={() => {
                                setEditingCountryId('');
                                setCountryPresetCode('');
                                setCountryCode('');
                                setCountryName('');
                                setCountryEnabled(true);
                            }}
                            className={secondaryButton}
                        >
                            取消
                        </AdminButton>
                    )}
                </div>
                <div className="max-h-52 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                    {countries.map(country => (
                        <div
                            key={country.id}
                            className="flex items-center justify-between gap-2 p-2.5 text-[10px]"
                        >
                            <span className="truncate">
                                {country.name} ({country.code})
                            </span>
                            <div className="flex items-center gap-1">
                                <AdminInput
                                    type="checkbox"
                                    checked={country.enabled}
                                    onChange={event => void toggleCountry(country.id, event.target.checked)}
                                    aria-label={`${country.name}启用状态`}
                                />
                                <AdminButton
                                    type="button"
                                    onClick={() => {
                                        setEditingCountryId(country.id);
                                        setCountryPresetCode(
                                            COUNTRY_PRESETS.some(preset => preset.code === country.code)
                                                ? country.code
                                                : '__custom__',
                                        );
                                        setCountryCode(country.code);
                                        setCountryName(country.name);
                                        setCountryEnabled(country.enabled);
                                    }}
                                    className="rounded p-1 text-blue-600"
                                    aria-label={`编辑${country.name}`}
                                >
                                    <Pencil className="h-3 w-3" />
                                </AdminButton>
                                <AdminButton
                                    type="button"
                                    onClick={() => void removeCountry(country.id, country.name)}
                                    className="rounded p-1 text-rose-600"
                                    aria-label={`删除${country.name}`}
                                >
                                    <Trash2 className="h-3 w-3" />
                                </AdminButton>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
