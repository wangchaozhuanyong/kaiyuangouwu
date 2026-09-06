import { useMutation, useQuery } from '@apollo/client/react';
import {
    AlertCircle,
    CheckCircle2,
    ChevronDown,
    CircleDollarSign,
    KeyRound,
    LoaderCircle,
    PackageCheck,
    Plus,
    RefreshCw,
    Trash2,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FeatureHelpButton } from '../../components/FeatureHelp';

import {
    IMPORT_AUTO_CARD_ITEMS_MUTATION,
    PREVIEW_AUTO_CARD_IMPORT_MUTATION,
    PRODUCT_AUTO_CARD_DELIVERIES_QUERY,
    PRODUCT_AUTO_CARD_SETUP_QUERY,
    UPDATE_AUTO_CARD_CONFIG_MUTATION,
    type AutoCardConfigRecord,
    type AutoCardDeliveryRecord,
    type AutoCardImportPreviewResult,
    type ProductAutoCardDeliveriesResult,
    type ProductAutoCardSetupResult,
} from '../../graphql/fulfillment.graphql';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { toUserFacingError } from '../../utils/user-facing-error';
import { autoCardReadiness, inferAutoCardFormatPreset, type AutoCardFormatPreset } from './auto-card-setup';
import type { ProductVariantState } from './product-editor-types';

type AutoCardFieldDraft = AutoCardConfigRecord['fields'][number];

interface AutoCardVariantEntry {
    key: string;
    variant: ProductVariantState;
}

interface AutoCardSetupPanelProps {
    variants: ProductVariantState[];
    productIsDirty: boolean;
    productSaving: boolean;
    onSaveProduct: () => Promise<void>;
    onRefreshProduct: () => Promise<unknown>;
}

const ACCOUNT_PASSWORD_FIELDS: AutoCardFieldDraft[] = [
    { key: 'account', label: '账号', labelEn: 'Account', secret: false },
    { key: 'password', label: '密码', labelEn: 'Password', secret: true },
];
const SINGLE_CODE_FIELDS: AutoCardFieldDraft[] = [
    { key: 'code', label: '卡密', labelEn: 'Code', secret: true },
];

const DEFAULT_INSTRUCTIONS_ZH = '请妥善保管卡密，并按商品说明完成兑换。';
const DEFAULT_INSTRUCTIONS_EN = 'Keep your credentials safe and follow the product instructions.';

export function ProductAutoCardSetupPanel({
    variants,
    productIsDirty,
    productSaving,
    onSaveProduct,
    onRefreshProduct,
}: AutoCardSetupPanelProps) {
    const entries = useMemo<AutoCardVariantEntry[]>(
        () =>
            variants
                .map((variant, index) => ({ key: variant.id || `draft-${index}`, variant }))
                .filter(entry => entry.variant.digitalDeliveryMode === 'auto_card'),
        [variants],
    );
    const [selectedKey, setSelectedKey] = useState('');
    const selected = entries.find(entry => entry.key === selectedKey) ?? entries[0] ?? null;

    if (!selected) return null;

    const needsProductSave = productIsDirty || !selected.variant.id;

    return (
        <section
            className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_45px_-36px_rgba(15,23,42,0.55)]"
            aria-labelledby="auto-card-setup-title"
        >
            <div className="border-b border-slate-200 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.09),transparent_42%)] px-5 py-5 sm:px-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                        <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold tracking-[0.16em] text-blue-700 uppercase">
                            <KeyRound className="h-3.5 w-3.5" />
                            一站式设置
                        </div>
                        <h3
                            id="auto-card-setup-title"
                            className="text-lg font-semibold tracking-tight text-slate-950"
                        >
                            自动发卡
                            <FeatureHelpButton topic="catalog.auto-card" title="自动发卡" />
                        </h3>
                        <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
                            在当前商品页完成交付方式、卡密格式、库存导入和就绪检查，无需切换到其他设置页。
                        </p>
                    </div>
                    {needsProductSave && (
                        <button
                            type="button"
                            onClick={() => void onSaveProduct()}
                            disabled={productSaving}
                            className={primaryButtonClass}
                        >
                            {productSaving ? (
                                <LoaderCircle className="h-4 w-4 animate-spin" />
                            ) : (
                                <PackageCheck className="h-4 w-4" />
                            )}
                            {selected.variant.id ? '先保存商品修改' : '保存商品并继续设置'}
                        </button>
                    )}
                </div>
                {entries.length > 1 && (
                    <div className="mt-5 flex gap-2 overflow-x-auto pb-1" aria-label="选择自动发卡 SKU">
                        {entries.map(entry => (
                            <button
                                key={entry.key}
                                type="button"
                                onClick={() => setSelectedKey(entry.key)}
                                className={`shrink-0 rounded-lg border px-3 py-2 text-left transition-colors ${
                                    entry.key === selected.key
                                        ? 'border-blue-500 bg-blue-600 text-white'
                                        : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300'
                                }`}
                            >
                                <span className="block text-xs font-semibold">
                                    {entry.variant.name || '未命名规格'}
                                </span>
                                <span className="mt-0.5 block font-mono text-[10px] opacity-75">
                                    {entry.variant.sku || '待填写 SKU'}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {needsProductSave ? (
                <div className="p-5 sm:p-6">
                    <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
                        <CircleDollarSign className="mt-0.5 h-5 w-5 shrink-0" />
                        <div>
                            <strong className="text-sm font-semibold">
                                {selected.variant.id ? '商品有尚未保存的修改' : '先生成这个 SKU'}
                            </strong>
                            <p className="mt-1 text-xs leading-5">
                                点击上方按钮后会留在当前商品页，保存完成就能继续导入卡密。
                            </p>
                        </div>
                    </div>
                </div>
            ) : (
                <PersistedAutoCardSetup
                    key={selected.variant.id}
                    variant={selected.variant}
                    onRefreshProduct={onRefreshProduct}
                />
            )}
        </section>
    );
}

function PersistedAutoCardSetup({
    variant,
    onRefreshProduct,
}: {
    variant: ProductVariantState;
    onRefreshProduct: () => Promise<unknown>;
}) {
    const { hasAnyPermission } = useAdminPermissions();
    const canEdit = hasAnyPermission(['UpdateProduct', 'UpdateCatalog']);
    const canReadOrders = hasAnyPermission(['ReadOrder']);
    const setupQuery = useQuery<ProductAutoCardSetupResult>(PRODUCT_AUTO_CARD_SETUP_QUERY, {
        variables: { productVariantId: variant.id },
        fetchPolicy: 'cache-and-network',
        skip: !variant.id,
    });
    const deliveriesQuery = useQuery<ProductAutoCardDeliveriesResult>(PRODUCT_AUTO_CARD_DELIVERIES_QUERY, {
        variables: {
            options: { productVariantId: variant.id, skip: 0, take: 5 },
        },
        fetchPolicy: 'cache-and-network',
        skip: !variant.id || !canReadOrders,
    });

    if (setupQuery.loading && !setupQuery.data) {
        return (
            <div className="flex min-h-56 items-center justify-center gap-2 text-xs text-slate-500">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                正在读取卡密设置…
            </div>
        );
    }
    if (setupQuery.error) {
        return (
            <div className="p-5 sm:p-6">
                <InlineMessage tone="error">
                    <span>{toUserFacingError(setupQuery.error, '卡密设置读取失败')}</span>
                    <button
                        type="button"
                        onClick={() => void setupQuery.refetch()}
                        className={secondaryButtonClass}
                    >
                        <RefreshCw className="h-3.5 w-3.5" />
                        重试
                    </button>
                </InlineMessage>
            </div>
        );
    }

    const config = setupQuery.data?.autoCardConfig ?? null;
    const refresh = async () => {
        await Promise.all([
            setupQuery.refetch(),
            canReadOrders ? deliveriesQuery.refetch() : Promise.resolve(),
            onRefreshProduct(),
        ]);
    };

    return (
        <AutoCardSetupEditor
            variant={variant}
            config={config}
            deliveries={deliveriesQuery.data?.autoCardDeliveries.items ?? []}
            deliveriesLoading={deliveriesQuery.loading}
            deliveriesError={Boolean(deliveriesQuery.error)}
            canEdit={canEdit}
            canReadOrders={canReadOrders}
            onRefresh={refresh}
        />
    );
}

function AutoCardSetupEditor({
    variant,
    config,
    deliveries,
    deliveriesLoading,
    deliveriesError,
    canEdit,
    canReadOrders,
    onRefresh,
}: {
    variant: ProductVariantState;
    config: AutoCardConfigRecord | null;
    deliveries: AutoCardDeliveryRecord[];
    deliveriesLoading: boolean;
    deliveriesError: boolean;
    canEdit: boolean;
    canReadOrders: boolean;
    onRefresh: () => Promise<void>;
}) {
    const [originalConfig] = useState(config);
    const initialPreset = inferAutoCardFormatPreset(config?.fields ?? ACCOUNT_PASSWORD_FIELDS);
    const [enabled, setEnabled] = useState(config?.enabled ?? true);
    const [formatPreset, setFormatPreset] = useState<AutoCardFormatPreset>(initialPreset);
    const [formatName, setFormatName] = useState(config?.formatName ?? '账号与密码');
    const [delimiter, setDelimiter] = useState(config?.delimiter ?? '----');
    const [fields, setFields] = useState<AutoCardFieldDraft[]>(
        cloneFields(config?.fields ?? ACCOUNT_PASSWORD_FIELDS),
    );
    const [instructionsZh, setInstructionsZh] = useState(config?.instructionsZh ?? DEFAULT_INSTRUCTIONS_ZH);
    const [instructionsEn, setInstructionsEn] = useState(config?.instructionsEn ?? DEFAULT_INSTRUCTIONS_EN);
    const [threshold, setThreshold] = useState(config?.lowStockThreshold ?? 10);
    const [rawText, setRawText] = useState('');
    const [previewResult, setPreviewResult] = useState<
        AutoCardImportPreviewResult['previewAutoCardPoolImport'] | null
    >(null);
    const [advancedOpen, setAdvancedOpen] = useState(initialPreset === 'custom');
    const [notice, setNotice] = useState('');
    const [error, setError] = useState('');
    const [saveConfig, saveState] = useMutation<{
        updateAutoCardConfig: { id: string };
    }>(UPDATE_AUTO_CARD_CONFIG_MUTATION);
    const [preview, previewState] = useMutation<AutoCardImportPreviewResult>(
        PREVIEW_AUTO_CARD_IMPORT_MUTATION,
    );
    const [importItems, importState] = useMutation<{
        importAutoCardPoolItems: { importedCount: number; duplicateCount: number; availableCount: number };
    }>(IMPORT_AUTO_CARD_ITEMS_MUTATION);
    const readiness = autoCardReadiness(config);
    const busy = saveState.loading || previewState.loading || importState.loading;
    const example = fields.map(field => field.label || field.key).join(delimiter);

    const applyPreset = (preset: AutoCardFormatPreset) => {
        setFormatPreset(preset);
        setPreviewResult(null);
        if (preset === 'account_password') {
            setFormatName('账号与密码');
            setDelimiter('----');
            setFields(cloneFields(ACCOUNT_PASSWORD_FIELDS));
        } else if (preset === 'single_code') {
            setFormatName('单卡密');
            setDelimiter('----');
            setFields(cloneFields(SINGLE_CODE_FIELDS));
        } else {
            setAdvancedOpen(true);
        }
    };
    const updateField = (index: number, patch: Partial<AutoCardFieldDraft>) => {
        setFormatPreset('custom');
        setFields(current =>
            current.map((field, fieldIndex) => (fieldIndex === index ? { ...field, ...patch } : field)),
        );
        setPreviewResult(null);
    };
    const validate = () => {
        if (!formatName.trim()) return '请填写卡密格式名称';
        if (!delimiter) return '请填写字段分隔符';
        if (!fields.length) return '至少需要一个卡密字段';
        if (fields.some(field => !field.key.trim() || !field.label.trim())) {
            return '请填完每个卡密字段的 key 和中文名称';
        }
        if (new Set(fields.map(field => field.key.trim())).size !== fields.length) {
            return '卡密字段 key 不能重复';
        }
        return '';
    };
    const persistConfig = async () => {
        const validationError = validate();
        if (validationError) throw new Error(validationError);
        const response = await saveConfig({
            variables: {
                input: {
                    productVariantId: variant.id,
                    enabled,
                    formatName: formatName.trim(),
                    delimiter,
                    fields: fields.map(field => ({
                        key: field.key.trim(),
                        label: field.label.trim(),
                        ...(field.labelEn.trim() !==
                        (
                            originalConfig?.fields.find(previous => previous.key === field.key)?.labelEn ?? ''
                        ).trim()
                            ? { labelEn: field.labelEn.trim() }
                            : {}),
                        secret: field.secret,
                    })),
                    instructionsZh: instructionsZh.trim() || null,
                    ...(instructionsEn.trim() !== (originalConfig?.instructionsEn ?? '').trim()
                        ? { instructionsEn: instructionsEn.trim() }
                        : {}),
                    lowStockThreshold: threshold,
                },
            },
        });
        if (!response.data?.updateAutoCardConfig?.id) throw new Error('后端未返回已保存的卡密配置');
    };
    const saveOnly = async () => {
        setError('');
        setNotice('');
        try {
            await persistConfig();
            setNotice('中文发卡文案已保存，英文待同步');
            try {
                await onRefresh();
            } catch {
                setError('设置已保存，刷新失败，请稍后刷新页面');
            }
        } catch (cause) {
            setError(toUserFacingError(cause, '自动发卡设置保存失败'));
        }
    };
    const runPreview = async () => {
        setError('');
        setNotice('');
        if (!rawText.trim()) {
            setError('请先粘贴要导入的卡密，每行一条');
            return;
        }
        try {
            await persistConfig();
            const response = await preview({
                variables: { input: { productVariantId: variant.id, rawText } },
            });
            const result = response.data?.previewAutoCardPoolImport;
            if (!result) throw new Error('后端未返回导入预览');
            setPreviewResult(result);
            setNotice(
                result.invalidCount
                    ? '发卡设置已保存，请修正下方错误后再导入'
                    : `格式检查通过，可以导入 ${result.validCount} 条卡密`,
            );
        } catch (cause) {
            setError(toUserFacingError(cause, '卡密格式检查失败'));
        }
    };
    const commitImport = async () => {
        if (!previewResult?.validCount || previewResult.invalidCount > 0) return;
        setError('');
        setNotice('');
        try {
            await persistConfig();
            const response = await importItems({
                variables: { input: { productVariantId: variant.id, rawText } },
            });
            const result = response.data?.importAutoCardPoolItems;
            if (!result) throw new Error('后端未返回导入结果');
            setRawText('');
            setPreviewResult(null);
            setNotice(
                `自动发卡已就绪：新增 ${result.importedCount} 条，跳过重复 ${result.duplicateCount} 条，当前可用 ${result.availableCount} 条`,
            );
            await onRefresh();
        } catch (cause) {
            setError(toUserFacingError(cause, '卡密导入失败，已保存的格式不会丢失'));
        }
    };

    return (
        <div className="space-y-5 p-5 sm:p-6">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_repeat(3,minmax(7rem,auto))]">
                <div className={`rounded-xl border p-4 ${readinessClasses[readiness.tone]}`}>
                    <div className="text-[10px] font-semibold tracking-wide uppercase">当前状态</div>
                    <div className="mt-1 text-base font-semibold">{readiness.label}</div>
                    <div className="mt-1 text-xs leading-5 opacity-80">{readiness.detail}</div>
                </div>
                <Metric label="可用库存" value={config?.availableCount ?? 0} />
                <Metric label="已使用" value={config?.assignedCount ?? 0} />
                <Metric label="等待库存" value={config?.waitingDeliveryCount ?? 0} alert />
            </div>

            {!canEdit && (
                <InlineMessage tone="warning">
                    当前账号可以查看发卡状态，但没有修改商品或卡密库存的权限。
                </InlineMessage>
            )}
            {notice && <InlineMessage tone="success">{notice}</InlineMessage>}
            {error && <InlineMessage tone="error">{error}</InlineMessage>}

            <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(26rem,1.35fr)]">
                <div className="space-y-4 rounded-xl bg-slate-50 p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <div className="text-xs font-semibold text-slate-900">1. 选择卡密格式</div>
                            <p className="mt-1 text-[11px] leading-5 text-slate-500">
                                常用格式会自动设置字段和分隔符。
                            </p>
                        </div>
                        <label className="flex shrink-0 items-center gap-2 text-[11px] font-medium text-slate-600">
                            <input
                                type="checkbox"
                                checked={enabled}
                                onChange={event => setEnabled(event.target.checked)}
                                disabled={!canEdit || busy}
                                className="h-4 w-4 rounded border-slate-300 text-blue-600"
                            />
                            启用自动发卡
                        </label>
                    </div>
                    <select
                        aria-label="卡密格式"
                        value={formatPreset}
                        onChange={event => applyPreset(event.target.value as AutoCardFormatPreset)}
                        disabled={!canEdit || busy}
                        className={inputClass}
                    >
                        <option value="account_password">账号 + 密码</option>
                        <option value="single_code">单卡密</option>
                        <option value="custom">自定义格式</option>
                    </select>
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-600">
                        <span className="text-slate-400">每行格式：</span>
                        <code className="ml-1 font-mono font-semibold text-slate-800">{example}</code>
                    </div>

                    <button
                        type="button"
                        onClick={() => setAdvancedOpen(value => !value)}
                        className="flex w-full items-center justify-between border-t border-slate-200 pt-3 text-left text-xs font-semibold text-slate-700"
                        aria-expanded={advancedOpen}
                    >
                        高级设置
                        <ChevronDown
                            className={`h-4 w-4 transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
                        />
                    </button>
                </div>

                <div className="rounded-xl border border-slate-200 p-4 sm:p-5">
                    <div className="text-xs font-semibold text-slate-900">2. 粘贴卡密库存</div>
                    <p className="mt-1 text-[11px] leading-5 text-slate-500">
                        每行一条。先脱敏预览，确认无误后才会加密入库。
                    </p>
                    <textarea
                        rows={8}
                        value={rawText}
                        onChange={event => {
                            setRawText(event.target.value);
                            setPreviewResult(null);
                        }}
                        disabled={!canEdit || busy}
                        placeholder={example}
                        spellCheck={false}
                        className={`${inputClass} mt-3 min-h-44 resize-y font-mono leading-6`}
                    />
                    {previewResult && <ImportPreview result={previewResult} />}
                    <div className="mt-4 flex flex-wrap justify-end gap-2">
                        {!rawText.trim() ? (
                            <button
                                type="button"
                                onClick={() => void saveOnly()}
                                disabled={!canEdit || busy}
                                className={primaryButtonClass}
                            >
                                {saveState.loading && <LoaderCircle className="h-4 w-4 animate-spin" />}
                                保存发卡设置
                            </button>
                        ) : !previewResult ? (
                            <button
                                type="button"
                                onClick={() => void runPreview()}
                                disabled={!canEdit || busy}
                                className={primaryButtonClass}
                            >
                                {(saveState.loading || previewState.loading) && (
                                    <LoaderCircle className="h-4 w-4 animate-spin" />
                                )}
                                保存设置并检查卡密
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={() => void commitImport()}
                                disabled={
                                    !canEdit ||
                                    busy ||
                                    previewResult.invalidCount > 0 ||
                                    previewResult.validCount === 0
                                }
                                className={primaryButtonClass}
                            >
                                {importState.loading && <LoaderCircle className="h-4 w-4 animate-spin" />}
                                确认导入 {previewResult.validCount} 条
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {advancedOpen && (
                <div className="space-y-5 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5">
                    <div className="grid gap-4 sm:grid-cols-3">
                        <Field label="格式名称">
                            <input
                                value={formatName}
                                onChange={event => {
                                    setFormatPreset('custom');
                                    setFormatName(event.target.value);
                                }}
                                disabled={!canEdit || busy}
                                className={inputClass}
                            />
                        </Field>
                        <Field label="字段分隔符">
                            <input
                                value={delimiter}
                                onChange={event => {
                                    setFormatPreset('custom');
                                    setDelimiter(event.target.value);
                                    setPreviewResult(null);
                                }}
                                disabled={!canEdit || busy}
                                className={`${inputClass} font-mono`}
                            />
                        </Field>
                        <Field label="低库存提醒值">
                            <input
                                type="number"
                                min={0}
                                value={threshold}
                                onChange={event => setThreshold(Math.max(0, Number(event.target.value) || 0))}
                                disabled={!canEdit || busy}
                                className={inputClass}
                            />
                        </Field>
                    </div>
                    <div>
                        <div className="mb-2 flex items-center justify-between">
                            <strong className="text-xs font-semibold text-slate-800">卡密字段</strong>
                            <button
                                type="button"
                                onClick={() => {
                                    setFormatPreset('custom');
                                    setFields(current => [
                                        ...current,
                                        { key: '', label: '', labelEn: '', secret: true },
                                    ]);
                                }}
                                disabled={!canEdit || busy}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 disabled:opacity-40"
                            >
                                <Plus className="h-3.5 w-3.5" />
                                添加字段
                            </button>
                        </div>
                        <div className="space-y-2">
                            {fields.map((field, index) => (
                                <div
                                    key={`${field.key}-${index}`}
                                    className="grid gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-[1fr_1fr_1fr_auto_auto]"
                                >
                                    <input
                                        aria-label={`第 ${index + 1} 个字段 key`}
                                        value={field.key}
                                        onChange={event => updateField(index, { key: event.target.value })}
                                        disabled={!canEdit || busy}
                                        placeholder="key"
                                        className={`${inputClass} font-mono`}
                                    />
                                    <input
                                        aria-label={`第 ${index + 1} 个字段中文名称`}
                                        value={field.label}
                                        onChange={event => updateField(index, { label: event.target.value })}
                                        disabled={!canEdit || busy}
                                        placeholder="中文名称"
                                        className={inputClass}
                                    />
                                    <input
                                        aria-label={`第 ${index + 1} 个字段英文名称`}
                                        value={field.labelEn}
                                        onChange={event =>
                                            updateField(index, { labelEn: event.target.value })
                                        }
                                        disabled={!canEdit || busy}
                                        placeholder="English label"
                                        className={inputClass}
                                    />
                                    <label className="flex items-center gap-1.5 text-[10px] text-slate-600">
                                        <input
                                            type="checkbox"
                                            checked={field.secret}
                                            onChange={event =>
                                                updateField(index, { secret: event.target.checked })
                                            }
                                            disabled={!canEdit || busy}
                                        />
                                        敏感
                                    </label>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setFormatPreset('custom');
                                            setFields(current => current.filter((_, i) => i !== index));
                                            setPreviewResult(null);
                                        }}
                                        disabled={!canEdit || busy || fields.length === 1}
                                        className="rounded-md p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30"
                                        aria-label={`移除第 ${index + 1} 个字段`}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="grid gap-4 lg:grid-cols-2">
                        <Field label="中文发货说明">
                            <textarea
                                rows={4}
                                value={instructionsZh}
                                onChange={event => setInstructionsZh(event.target.value)}
                                disabled={!canEdit || busy}
                                className={inputClass}
                            />
                        </Field>
                        <Field label="English delivery instructions">
                            <textarea
                                rows={4}
                                value={instructionsEn}
                                onChange={event => setInstructionsEn(event.target.value)}
                                disabled={!canEdit || busy}
                                className={inputClass}
                            />
                        </Field>
                    </div>
                </div>
            )}

            {canReadOrders && (
                <div className="border-t border-slate-200 pt-5">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <h4 className="text-xs font-semibold text-slate-900">
                                3. 最近发卡结果
                                <FeatureHelpButton topic="sales.card-pool" title="3. 最近发卡结果" />
                            </h4>
                            <p className="mt-1 text-[11px] text-slate-500">当前 SKU 最近 5 条交付记录。</p>
                        </div>
                        <Link
                            to="/catalog/card-pool?tab=deliveries"
                            className="text-[11px] font-semibold text-blue-700 hover:text-blue-800"
                        >
                            查看全部记录
                        </Link>
                    </div>
                    {deliveriesLoading ? (
                        <div className="flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-[11px] text-slate-500">
                            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                            正在读取发卡记录…
                        </div>
                    ) : deliveriesError ? (
                        <div className="rounded-lg bg-rose-50 p-3 text-[11px] text-rose-700">
                            发卡记录暂时无法读取，不影响保存卡密设置。
                        </div>
                    ) : deliveries.length ? (
                        <div className="overflow-x-auto rounded-xl border border-slate-200">
                            <table className="w-full min-w-[680px] text-left text-[11px]">
                                <thead className="bg-slate-50 text-slate-500">
                                    <tr>
                                        <th className="px-3 py-2 font-semibold">订单</th>
                                        <th className="px-3 py-2 font-semibold">收件邮箱</th>
                                        <th className="px-3 py-2 font-semibold">数量</th>
                                        <th className="px-3 py-2 font-semibold">状态</th>
                                        <th className="px-3 py-2 font-semibold">发送时间</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {deliveries.map(delivery => (
                                        <tr key={delivery.id}>
                                            <td className="px-3 py-2 font-mono font-semibold text-slate-800">
                                                {delivery.order.code}
                                            </td>
                                            <td className="px-3 py-2 text-slate-600">
                                                {delivery.recipientEmail}
                                            </td>
                                            <td className="px-3 py-2 font-mono">{delivery.quantity}</td>
                                            <td className="px-3 py-2">
                                                <DeliveryBadge state={delivery.state} />
                                            </td>
                                            <td className="px-3 py-2 text-slate-500">
                                                {delivery.sentAt
                                                    ? new Date(delivery.sentAt).toLocaleString('zh-CN')
                                                    : '—'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="rounded-lg bg-slate-50 p-3 text-[11px] text-slate-500">
                            尚无发卡记录。导入卡密并完成第一笔测试订单后，结果会显示在这里。
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function ImportPreview({ result }: { result: AutoCardImportPreviewResult['previewAutoCardPoolImport'] }) {
    return (
        <div
            className={`mt-3 rounded-xl border p-3 text-[11px] ${
                result.invalidCount
                    ? 'border-rose-200 bg-rose-50 text-rose-800'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-800'
            }`}
        >
            <div className="flex flex-wrap gap-4 font-semibold">
                <span>有效 {result.validCount}</span>
                <span className={result.invalidCount ? 'text-rose-700' : 'text-slate-500'}>
                    错误 {result.invalidCount}
                </span>
            </div>
            {result.rows.slice(0, 3).map(row => (
                <div key={row.lineNumber} className="mt-2 font-mono text-[10px] text-slate-600">
                    第 {row.lineNumber} 行：
                    {row.fields.map(field => `${field.label}=${field.value}`).join('；')}
                </div>
            ))}
            {result.errors.map(item => (
                <div key={item.lineNumber} className="mt-2 text-rose-700">
                    第 {item.lineNumber} 行：{item.message}
                </div>
            ))}
        </div>
    );
}

function Metric({ label, value, alert = false }: { label: string; value: number; alert?: boolean }) {
    return (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-[10px] font-medium text-slate-500">{label}</div>
            <div
                className={`mt-1 font-mono text-xl font-semibold tabular-nums ${alert && value > 0 ? 'text-rose-700' : 'text-slate-900'}`}
            >
                {value}
            </div>
        </div>
    );
}

function InlineMessage({ tone, children }: { tone: 'success' | 'warning' | 'error'; children: ReactNode }) {
    const classes = {
        success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
        warning: 'border-amber-200 bg-amber-50 text-amber-900',
        error: 'border-rose-200 bg-rose-50 text-rose-800',
    };
    const Icon = tone === 'success' ? CheckCircle2 : AlertCircle;
    return (
        <div
            className={`flex items-center gap-2 rounded-xl border p-3 text-xs ${classes[tone]}`}
            role={tone === 'error' ? 'alert' : 'status'}
        >
            <Icon className="h-4 w-4 shrink-0" />
            <div className="flex flex-1 flex-wrap items-center justify-between gap-2">{children}</div>
        </div>
    );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="block text-xs font-medium text-slate-700">
            <span className="mb-1.5 block">{label}</span>
            {children}
        </label>
    );
}

function DeliveryBadge({ state }: { state: AutoCardDeliveryRecord['state'] }) {
    const labels = {
        WAITING_STOCK: '等待库存',
        ALLOCATED: '待发送',
        RETRYING: '重试中',
        SENT: '已发送',
        MANUAL_REVIEW: '人工处理',
    };
    const classes =
        state === 'SENT'
            ? 'bg-emerald-50 text-emerald-700'
            : state === 'WAITING_STOCK' || state === 'MANUAL_REVIEW'
              ? 'bg-rose-50 text-rose-700'
              : 'bg-blue-50 text-blue-700';
    return (
        <span className={`rounded-md px-2 py-1 text-[10px] font-semibold ${classes}`}>{labels[state]}</span>
    );
}

function cloneFields(fields: readonly AutoCardFieldDraft[]) {
    return fields.map(field => ({ ...field }));
}

const readinessClasses = {
    green: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    rose: 'border-rose-200 bg-rose-50 text-rose-900',
    slate: 'border-slate-200 bg-slate-100 text-slate-800',
};
const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-normal text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400';
const primaryButtonClass =
    'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButtonClass =
    'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';
