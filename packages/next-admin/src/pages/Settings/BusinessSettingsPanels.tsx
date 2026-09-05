import { useMutation, useQuery } from '@apollo/client/react';
import { Languages, MapPin, Pencil, ReceiptText, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { useConfirmDialog } from '../../components/confirm-dialog-context';
import { DynamicCustomFieldsForm } from '../../custom-fields/DynamicCustomFieldsForm';
import type { CustomFieldValueMap } from '../../custom-fields/custom-field-types';
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
import { toUserFacingError } from '../../utils/user-facing-error';
import { MultiValueChoiceField } from './BusinessSettingsChoices';
import {
    BUSINESS_CURRENCY_CHOICES,
    BUSINESS_LANGUAGE_CHOICES,
    COUNTRY_PRESETS,
    TAX_CATEGORY_PRESETS,
    businessChoiceLabel,
} from './business-settings-choice-data';
import {
    ErrorState,
    Field,
    LoadingState,
    errorText,
    inputClass,
    mergeById,
    primaryButton,
    secondaryButton,
} from './settings-ui';

export function BusinessBasicsPanel({
    onChanged,
    onError,
}: {
    onChanged: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const loadingAllBusinessSettingsRef = useRef(false);
    const channelCustomFieldDefinitions = useCustomFieldDefinitions('Channel');
    const businessSettingsDocument = useMemo(
        () =>
            addCustomFieldsToDocument(BUSINESS_SETTINGS_QUERY, 'Channel', channelCustomFieldDefinitions, [
                'activeChannel',
            ]),
        [channelCustomFieldDefinitions],
    );
    const query = useQuery<BusinessSettingsResult>(businessSettingsDocument, {
        variables: {
            zoneOptions: { skip: 0, take: 100, sort: { name: 'ASC' } },
            countryOptions: { skip: 0, take: 100, sort: { name: 'ASC' } },
            taxCategoryOptions: { skip: 0, take: 100, sort: { name: 'ASC' } },
            taxRateOptions: { skip: 0, take: 100, sort: { name: 'ASC' } },
        },
        fetchPolicy: 'cache-and-network',
    });
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
        const zoneCount = data.zones.items.length;
        const countryCount = data.countries.items.length;
        const categoryCount = data.taxCategories.items.length;
        const rateCount = data.taxRates.items.length;
        if (
            zoneCount >= data.zones.totalItems &&
            countryCount >= data.countries.totalItems &&
            categoryCount >= data.taxCategories.totalItems &&
            rateCount >= data.taxRates.totalItems
        )
            return;
        loadingAllBusinessSettingsRef.current = true;
        void fetchMoreBusinessSettings({
            variables: {
                zoneOptions: { skip: zoneCount, take: 100, sort: { name: 'ASC' } },
                countryOptions: { skip: countryCount, take: 100, sort: { name: 'ASC' } },
                taxCategoryOptions: { skip: categoryCount, take: 100, sort: { name: 'ASC' } },
                taxRateOptions: { skip: rateCount, take: 100, sort: { name: 'ASC' } },
            },
            updateQuery: (previous, { fetchMoreResult }) => ({
                ...previous,
                zones: {
                    ...fetchMoreResult.zones,
                    items: mergeById(previous.zones.items, fetchMoreResult.zones.items),
                },
                countries: {
                    ...fetchMoreResult.countries,
                    items: mergeById(previous.countries.items, fetchMoreResult.countries.items),
                },
                taxCategories: {
                    ...fetchMoreResult.taxCategories,
                    items: mergeById(previous.taxCategories.items, fetchMoreResult.taxCategories.items),
                },
                taxRates: {
                    ...fetchMoreResult.taxRates,
                    items: mergeById(previous.taxRates.items, fetchMoreResult.taxRates.items),
                },
            }),
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
    if (query.error || !query.data)
        return (
            <ErrorState
                message={query.error?.message ?? '业务基础配置读取失败'}
                onRetry={() => void query.refetch()}
            />
        );
    const refresh = async (message: string) => {
        await query.refetch();
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
            <GlobalBusinessSettings
                settings={query.data.globalSettings}
                onChanged={refresh}
                onError={onError}
            />
            <ChannelBusinessSettings
                channel={query.data.activeChannel}
                zones={query.data.zones.items}
                platformLanguages={query.data.globalSettings.availableLanguages}
                customFieldDefinitions={channelCustomFieldDefinitions}
                onChanged={refresh}
                onError={onError}
            />
            <div className="grid gap-4 xl:grid-cols-2">
                <TaxBusinessSettings
                    categories={query.data.taxCategories.items}
                    rates={query.data.taxRates.items}
                    zones={query.data.zones.items}
                    onChanged={refresh}
                    onError={onError}
                />
                <ZoneBusinessSettings
                    zones={query.data.zones.items}
                    countries={query.data.countries.items}
                    languageCode={query.data.activeChannel.defaultLanguageCode}
                    onChanged={refresh}
                    onError={onError}
                />
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
    onChanged: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const [languages, setLanguages] = useState([...settings.availableLanguages]);
    const [trackInventory, setTrackInventory] = useState(settings.trackInventory);
    const [outOfStockThreshold, setOutOfStockThreshold] = useState(String(settings.outOfStockThreshold));
    const [update, state] = useMutation<{
        updateGlobalSettings: {
            __typename: 'GlobalSettings' | 'ChannelDefaultLanguageError';
            message?: string;
        };
    }>(UPDATE_GLOBAL_SETTINGS_MUTATION);
    const submit = async () => {
        const availableLanguages = languages;
        const threshold = Number(outOfStockThreshold);
        if (!availableLanguages.length) return onError('至少保留一种平台可用语言');
        if (!Number.isInteger(threshold) || threshold < 0) return onError('全局缺货阈值必须为非负整数');
        try {
            const response = await update({
                variables: {
                    input: {
                        availableLanguages,
                        trackInventory,
                        outOfStockThreshold: threshold,
                    },
                },
            });
            if (response.data?.updateGlobalSettings.__typename !== 'GlobalSettings')
                throw new Error(response.data?.updateGlobalSettings.message || '全局设置更新被拒绝');
            await onChanged('平台全局语言和库存默认值已更新');
        } catch (error) {
            onError(errorText(error));
        }
    };
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                    <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                        平台全局设置
                        <FeatureHelpButton topic="settings.store-profile" title="平台全局设置" />
                    </h2>
                    <p className="mt-1 text-xs text-slate-400">影响所有 Channel 可选语言和库存默认行为</p>
                </div>
                <button
                    type="button"
                    onClick={() => void submit()}
                    disabled={state.loading}
                    className={primaryButton}
                >
                    {state.loading ? '保存中…' : '保存全局设置'}
                </button>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <MultiValueChoiceField
                    label="平台可用语言"
                    description="从列表添加后台允许店铺使用的内容语言。"
                    values={languages}
                    choices={BUSINESS_LANGUAGE_CHOICES}
                    addLabel="选择要添加的语言"
                    onChange={setLanguages}
                    disabled={state.loading}
                />
                <Field label="全局缺货阈值">
                    <input
                        type="number"
                        min="0"
                        value={outOfStockThreshold}
                        onChange={event => setOutOfStockThreshold(event.target.value)}
                        className={inputClass}
                    />
                </Field>
                <label className="flex items-center gap-2 pt-7 text-xs text-slate-700">
                    <input
                        type="checkbox"
                        checked={trackInventory}
                        onChange={event => setTrackInventory(event.target.checked)}
                    />
                    默认跟踪库存
                </label>
            </div>
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
    onChanged: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const [languages, setLanguages] = useState([...channel.availableLanguageCodes]);
    const [currencies, setCurrencies] = useState([...channel.availableCurrencyCodes]);
    const [defaultLanguage, setDefaultLanguage] = useState(channel.defaultLanguageCode);
    const [defaultCurrency, setDefaultCurrency] = useState(channel.defaultCurrencyCode);
    const [taxZoneId, setTaxZoneId] = useState(channel.defaultTaxZone?.id ?? '');
    const [shippingZoneId, setShippingZoneId] = useState(channel.defaultShippingZone?.id ?? '');
    const [pricesIncludeTax, setPricesIncludeTax] = useState(channel.pricesIncludeTax);
    const [trackInventory, setTrackInventory] = useState(channel.trackInventory ?? true);
    const [outOfStockThreshold, setOutOfStockThreshold] = useState(String(channel.outOfStockThreshold ?? 0));
    const [customFieldValues, setCustomFieldValues] = useState<CustomFieldValueMap>(() =>
        customFieldValuesFromEntity(customFieldDefinitions, channel.customFields),
    );
    const [update, state] = useMutation<{
        updateChannel: { __typename: 'Channel' | 'LanguageNotAvailableError'; message?: string };
    }>(UPDATE_BUSINESS_CHANNEL_MUTATION);
    /* oxlint-disable react/set-state-in-effect */
    useEffect(() => {
        setCustomFieldValues(customFieldValuesFromEntity(customFieldDefinitions, channel.customFields));
    }, [channel.customFields, channel.id, customFieldDefinitions]);
    /* oxlint-enable react/set-state-in-effect */
    const submit = async () => {
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
        try {
            const response = await update({
                variables: {
                    input: {
                        id: channel.id,
                        availableLanguageCodes,
                        defaultLanguageCode: defaultLanguage,
                        availableCurrencyCodes,
                        defaultCurrencyCode: defaultCurrency,
                        defaultTaxZoneId: taxZoneId || undefined,
                        defaultShippingZoneId: shippingZoneId || undefined,
                        pricesIncludeTax,
                        trackInventory,
                        outOfStockThreshold: threshold,
                        customFields: customFieldInputFromValues(customFieldDefinitions, customFieldValues),
                    },
                },
            });
            if (response.data?.updateChannel.__typename !== 'Channel')
                throw new Error(response.data?.updateChannel.message || '后端拒绝更新渠道配置');
            await onChanged('当前店铺的语言、币种和业务参数已更新');
        } catch (error) {
            onError(errorText(error));
        }
    };
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
                <div>
                    <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                        <Languages className="h-4 w-4 text-blue-600" />
                        当前店铺语言与币种
                        <FeatureHelpButton topic="settings.store-profile" title="当前店铺语言与币种" />
                    </h2>
                    <p className="mt-1 text-xs text-slate-400">{channel.code} · 直接选择店铺要使用的选项</p>
                </div>
                <button
                    type="button"
                    onClick={() => void submit()}
                    disabled={state.loading}
                    className={primaryButton}
                >
                    {state.loading ? '保存中…' : '保存基础参数'}
                </button>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
                    disabled={state.loading}
                />
                <Field label="默认语言">
                    <select
                        value={defaultLanguage}
                        onChange={event => setDefaultLanguage(event.target.value)}
                        className={inputClass}
                    >
                        {languages.map(language => (
                            <option key={language} value={language}>
                                {businessChoiceLabel(language, BUSINESS_LANGUAGE_CHOICES)}
                            </option>
                        ))}
                    </select>
                </Field>
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
                    disabled={state.loading}
                />
                <Field label="默认币种">
                    <select
                        value={defaultCurrency}
                        onChange={event => setDefaultCurrency(event.target.value)}
                        className={inputClass}
                    >
                        {currencies.map(currency => (
                            <option key={currency} value={currency}>
                                {businessChoiceLabel(currency, BUSINESS_CURRENCY_CHOICES)}
                            </option>
                        ))}
                    </select>
                </Field>
                <Field label="默认计税区域">
                    <select
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
                    </select>
                </Field>
                <Field label="默认配送区域">
                    <select
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
                    </select>
                </Field>
                <Field label="缺货阈值">
                    <input
                        type="number"
                        min="0"
                        value={outOfStockThreshold}
                        onChange={event => setOutOfStockThreshold(event.target.value)}
                        className={inputClass}
                    />
                </Field>
                <div className="space-y-2 pt-1">
                    <label className="flex items-center gap-2 text-xs text-slate-700">
                        <input
                            type="checkbox"
                            checked={pricesIncludeTax}
                            onChange={event => setPricesIncludeTax(event.target.checked)}
                        />
                        商品价格已含税
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-700">
                        <input
                            type="checkbox"
                            checked={trackInventory}
                            onChange={event => setTrackInventory(event.target.checked)}
                        />
                        默认跟踪库存
                    </label>
                </div>
            </div>
            <div className="mt-4">
                <DynamicCustomFieldsForm
                    helpTopic="settings.store-profile"
                    fields={customFieldDefinitions}
                    values={customFieldValues}
                    onChange={setCustomFieldValues}
                    disabled={state.loading}
                    title="当前店铺扩展参数"
                />
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
        const confirmed = await requestConfirmation({
            title: `删除税类“${name}”？`,
            description: '有关联税率或商品时，后端会拒绝不安全的删除。',
            confirmLabel: '确认删除',
            tone: 'danger',
        });
        if (!confirmed) return;
        try {
            const response = await deleteCategory({ variables: { id } });
            if (response.data?.deleteTaxCategory.result !== 'DELETED')
                throw new Error(response.data?.deleteTaxCategory.message || '税类未删除');
            await onChanged('税类已删除');
        } catch (error) {
            onError(errorText(error));
        }
    };
    const removeRate = async (id: string, name: string) => {
        const confirmed = await requestConfirmation({
            title: `删除税率“${name}”？`,
            description: '删除后新订单不再使用该税率，历史订单数据不会改写。',
            confirmLabel: '确认删除',
            tone: 'danger',
        });
        if (!confirmed) return;
        try {
            const response = await deleteRate({ variables: { id } });
            if (response.data?.deleteTaxRate.result !== 'DELETED')
                throw new Error(response.data?.deleteTaxRate.message || '税率未删除');
            await onChanged('税率已删除');
        } catch (error) {
            onError(errorText(error));
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
                    <FeatureHelpButton topic="settings.finance" title="税类与税率" />
                </h2>
                <p className="mt-1 text-xs text-slate-400">税率按“税类 + 区域”匹配订单</p>
            </div>
            <div className="space-y-4 p-5">
                <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={editingCategoryId ? '税类名称' : '选择税类用途'}>
                        {editingCategoryId ? (
                            <input
                                value={categoryName}
                                onChange={event => setCategoryName(event.target.value)}
                                placeholder="税类名称"
                                className={inputClass}
                            />
                        ) : (
                            <select
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
                            </select>
                        )}
                    </Field>
                    {categoryPreset === '__custom__' && !editingCategoryId && (
                        <Field label="自定义税类名称">
                            <input
                                value={categoryName}
                                onChange={event => setCategoryName(event.target.value)}
                                placeholder="例如：特殊服务"
                                className={inputClass}
                            />
                        </Field>
                    )}
                    <label className="flex items-center gap-2 px-2 text-xs text-slate-600">
                        <input
                            type="checkbox"
                            checked={categoryDefault}
                            onChange={event => setCategoryDefault(event.target.checked)}
                        />
                        默认税类
                    </label>
                </div>
                <p className="text-[11px] leading-4 text-slate-400">
                    税类用于给商品分组；实际收取多少税，请在下方选择税类和业务区域后设置。
                </p>
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={() => void addCategory()}
                        disabled={busy || !categoryName.trim()}
                        className={secondaryButton}
                    >
                        {editingCategoryId ? '保存税类' : '新增税类'}
                    </button>
                    {editingCategoryId && (
                        <button
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
                        </button>
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
                            <button
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
                            </button>
                            <button
                                type="button"
                                onClick={() => void removeCategory(category.id, category.name)}
                                className="text-rose-600"
                                aria-label={`删除税类${category.name}`}
                            >
                                <Trash2 className="h-3 w-3" />
                            </button>
                        </span>
                    ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                    {editingRateId && (
                        <Field label="税率名称">
                            <input
                                value={rateName}
                                onChange={event => setRateName(event.target.value)}
                                placeholder="税率名称"
                                className={inputClass}
                            />
                        </Field>
                    )}
                    <Field label="税率百分比">
                        <input
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
                        <select
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
                        </select>
                    </Field>
                    <Field label="适用哪个业务区域">
                        <select
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
                        </select>
                    </Field>
                </div>
                {!editingRateId && categoryId && zoneId && rateValue && (
                    <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                        创建后自动命名：
                        {`${categories.find(category => category.id === categoryId)?.name ?? '税类'} · ${zones.find(zone => zone.id === zoneId)?.name ?? '业务区域'}`}
                    </p>
                )}
                <button
                    type="button"
                    onClick={() => void addRate()}
                    disabled={busy || !rateValue.trim() || !categoryId || !zoneId}
                    className={primaryButton}
                >
                    {editingRateId ? '保存税率' : '创建税率'}
                </button>
                {editingRateId && (
                    <button
                        type="button"
                        onClick={() => {
                            setEditingRateId('');
                            setRateName('');
                            setRateValue('');
                        }}
                        className={secondaryButton}
                    >
                        取消编辑
                    </button>
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
                                <input
                                    type="checkbox"
                                    checked={rate.enabled}
                                    onChange={event => void toggleRate(rate.id, event.target.checked)}
                                    disabled={busy}
                                />
                                {rate.enabled ? '已启用' : '已停用'}
                            </label>
                            <button
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
                            </button>
                            <button
                                type="button"
                                onClick={() => void removeRate(rate.id, rate.name)}
                                className="rounded p-1 text-rose-600"
                                aria-label={`删除税率${rate.name}`}
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
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
    languageCode,
    onChanged,
    onError,
}: {
    zones: BusinessSettingsResult['zones']['items'];
    countries: BusinessSettingsResult['countries']['items'];
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
        const confirmed = await requestConfirmation({
            title: `删除区域“${zoneName}”？`,
            description: '被 Channel、配送方式或税率引用时，后端会拒绝删除。',
            confirmLabel: '确认删除',
            tone: 'danger',
        });
        if (!confirmed) return;
        try {
            const response = await deleteZone({ variables: { id } });
            if (response.data?.deleteZone.result !== 'DELETED')
                throw new Error(response.data?.deleteZone.message || '区域未删除');
            await onChanged('区域已删除');
        } catch (error) {
            onError(errorText(error));
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
        const confirmed = await requestConfirmation({
            title: `删除国家/地区“${displayName}”？`,
            description: '被业务区域或历史地址引用时，后端会拒绝不安全的删除。',
            confirmLabel: '确认删除',
            tone: 'danger',
        });
        if (!confirmed) return;
        try {
            const response = await deleteCountry({ variables: { id } });
            if (response.data?.deleteCountry.result !== 'DELETED')
                throw new Error(response.data?.deleteCountry.message || '国家/地区未删除');
            await onChanged('国家/地区已删除');
        } catch (error) {
            onError(errorText(error));
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
                    <FeatureHelpButton topic="settings.store-profile" title="国家与业务区域" />
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                    业务区域是计税和配送范围，不是店铺名称；选择国家后系统会自动命名。
                </p>
            </div>
            <div className="space-y-3 p-5">
                {!editingZoneId && (
                    <Field label="选择要创建的业务区域">
                        <select
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
                        </select>
                    </Field>
                )}
                {(editingZoneId || zonePresetCountryId === '__custom__') && (
                    <Field label="业务区域名称">
                        <input
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
                                    <input
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
                <button
                    type="button"
                    onClick={() => void submit()}
                    disabled={busy || !name.trim() || memberIds.length === 0}
                    className={primaryButton}
                >
                    {editingZoneId ? '保存业务区域' : '创建业务区域'}
                </button>
                {editingZoneId && (
                    <button
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
                    </button>
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
                            <button
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
                            </button>
                            <button
                                type="button"
                                onClick={() => void removeZone(zone.id, zone.name)}
                                className="rounded p-1 text-rose-600"
                                aria-label={`删除区域${zone.name}`}
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
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
                        <FeatureHelpButton topic="settings.store-profile" title="添加国家/地区" />
                    </h3>
                    <p className="mt-1 text-[11px] text-slate-400">
                        常用国家直接选择，代码和名称会自动填写。
                    </p>
                </div>
                <Field label={editingCountryId ? '正在编辑' : '选择国家/地区'}>
                    <select
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
                    </select>
                </Field>
                {(editingCountryId || countryPresetCode === '__custom__') && (
                    <div className="grid gap-2 sm:grid-cols-2">
                        <Field label="两位国家代码">
                            <input
                                value={countryCode}
                                onChange={event => setCountryCode(event.target.value)}
                                placeholder="例如：NZ"
                                maxLength={2}
                                className={inputClass}
                            />
                        </Field>
                        <Field label="中文显示名称">
                            <input
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
                        <input
                            type="checkbox"
                            checked={countryEnabled}
                            onChange={event => setCountryEnabled(event.target.checked)}
                        />
                        启用
                    </label>
                    <button
                        type="button"
                        disabled={busy || !countryCode || !countryName}
                        onClick={() => void submitCountry()}
                        className={secondaryButton}
                    >
                        {editingCountryId ? '保存国家/地区' : '新增国家/地区'}
                    </button>
                    {editingCountryId && (
                        <button
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
                        </button>
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
                                <input
                                    type="checkbox"
                                    checked={country.enabled}
                                    onChange={event => void toggleCountry(country.id, event.target.checked)}
                                    aria-label={`${country.name}启用状态`}
                                />
                                <button
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
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void removeCountry(country.id, country.name)}
                                    className="rounded p-1 text-rose-600"
                                    aria-label={`删除${country.name}`}
                                >
                                    <Trash2 className="h-3 w-3" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
