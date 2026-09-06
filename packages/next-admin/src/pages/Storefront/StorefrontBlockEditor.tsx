import { useQuery } from '@apollo/client/react';
import { Check, Plus, Search, X } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import {
    heroThemePresets,
    homepageVisualStyles,
    normalizedHeroThemePreset,
    normalizedHomepageVisualStyle,
} from '../../../../storefront-content-plugin/src/content-visuals';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import {
    STOREFRONT_EDITOR_OPTIONS_QUERY,
    type StorefrontContentBlock,
    type StorefrontLanguageCode,
    type StorefrontTargetType,
} from '../../graphql/storefront.graphql';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { usePageSize } from '../../hooks/use-page-size';
import { toUserFacingError } from '../../utils/user-facing-error';
import { AssetPicker } from './storefront-asset-picker';
import { BlockPreview } from './storefront-block-preview';
import {
    blockTranslation,
    cloneContentBlock,
    fromLocalDateTime,
    newContentItem,
    storefrontBlockValidation,
    toLocalDateTime,
} from './storefront-content-utils';
import { ColorInput, Field, InlinePager, LanguageSwitch } from './storefront-editor-controls';
import {
    clamp,
    EditorOptionsResult,
    inputClass,
    moduleHasSettings,
    moduleUsesItems,
    moveItem,
    numberSetting,
    stringArray,
    stringSetting,
    targetOptions,
} from './storefront-editor-model';
import { ItemEditor } from './storefront-item-editor';
import { TargetValueInput } from './storefront-target-input';

export function StorefrontBlockEditor({
    value,
    saving,
    error,
    onClose,
    onSave,
}: {
    value: StorefrontContentBlock;
    saving: boolean;
    error?: string;
    onClose: () => void;
    onSave: (value: StorefrontContentBlock) => Promise<void>;
}) {
    const { hasAnyPermission } = useAdminPermissions();
    const canReadProducts = hasAnyPermission(['ReadCatalog', 'ReadProduct']);
    const [draft, setDraft] = useState(() => cloneContentBlock(value));
    const [language, setLanguage] = useState<StorefrontLanguageCode>('zh_Hans');
    const [showProducts, setShowProducts] = useState(false);
    const [productSearch, setProductSearch] = useState('');
    const [productPage, setProductPage] = useState(0);
    const [productPageSize, setProductPageSize] = usePageSize(setProductPage);
    const deferredProductSearch = useDeferredValue(productSearch.trim());
    const options = useQuery<EditorOptionsResult>(STOREFRONT_EDITOR_OPTIONS_QUERY, {
        skip: !canReadProducts,
        variables: {
            productOptions: {
                skip: productPage * productPageSize,
                take: productPageSize,
                sort: { name: 'ASC', id: 'ASC' },
                filter: deferredProductSearch ? { name: { contains: deferredProductSearch } } : {},
            },
        },
        fetchPolicy: 'cache-first',
    });
    const translation = blockTranslation(draft, language);
    const validation = storefrontBlockValidation(draft);
    const isSupport = draft.type === 'SUPPORT';
    const productSettingKey = ['CATEGORY_AD', 'FEATURED_COLLECTION'].includes(draft.type)
        ? 'selectedProductIds'
        : draft.type === 'BEST_SELLERS'
          ? 'pinnedProductIds'
          : null;
    const selectedProductIds = productSettingKey ? stringArray(draft.settings?.[productSettingKey]) : [];
    const visibleProducts = options.data?.products.items ?? [];

    const updateTranslation = (patch: Partial<typeof translation>) => {
        setDraft(current => ({
            ...current,
            translations: current.translations.map(item =>
                item.languageCode === language ? { ...item, ...patch } : item,
            ),
        }));
    };
    const updateSettings = (patch: Record<string, unknown>) =>
        setDraft(current => ({
            ...current,
            settings: { ...(current.settings ?? {}), ...patch },
        }));
    const toggleProduct = (id: string) => {
        if (!productSettingKey) return;
        const next = selectedProductIds.includes(id)
            ? selectedProductIds.filter(value => value !== id)
            : [...selectedProductIds, id];
        updateSettings({ [productSettingKey]: next });
    };

    return (
        <AccessibleDialogSurface
            accessibleName={`${value.id ? '编辑' : '新建'}店铺楼层区块`}
            onRequestClose={() => {
                if (!saving) {
                    onClose();
                }
            }}
            className="fixed inset-0 z-50 flex justify-end bg-slate-950/45"
        >
            <div className="flex h-full w-full max-w-5xl flex-col bg-slate-50 shadow-2xl">
                <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5 py-4 sm:px-7">
                    <div className="min-w-0">
                        <h2
                            id="storefront-editor-title"
                            className="truncate text-base font-bold text-slate-900"
                        >
                            {value.id ? '编辑' : '新建'}：{draft.internalName}
                        </h2>
                        <p className="mt-1 text-xs text-slate-500">
                            中文是前台必填内容；英文可在右侧语言切换后补充
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={saving}
                        className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        aria-label="关闭编辑器"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </header>

                <div className="flex-1 overflow-y-auto p-5 sm:p-7">
                    {error && (
                        <p
                            role="alert"
                            className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800"
                        >
                            {error}
                        </p>
                    )}
                    {options.error && (
                        <div
                            className="mx-auto mb-5 flex max-w-6xl flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 sm:flex-row sm:items-center sm:justify-between"
                            role="alert"
                        >
                            <span>
                                {toUserFacingError(
                                    options.error,
                                    '商品与集合选项读取失败，已保留当前编辑内容。',
                                )}
                            </span>
                            <button
                                type="button"
                                onClick={() => void options.refetch()}
                                className="self-start rounded-lg bg-amber-900 px-3 py-2 font-bold text-white sm:self-auto"
                            >
                                重新加载选项
                            </button>
                        </div>
                    )}
                    <div className="mx-auto grid max-w-6xl gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
                        <div className="space-y-5">
                            <section className="rounded-xl border border-slate-200 bg-white p-5">
                                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                                            基础设置
                                            <FeatureHelpButton
                                                topic="storefront.block-basic"
                                                title="楼层基础设置"
                                            />
                                        </h3>
                                        <p className="mt-1 text-[11px] text-slate-400">
                                            编码用于客户端稳定识别，创建后建议不修改
                                        </p>
                                    </div>
                                    <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                                        <input
                                            type="checkbox"
                                            checked={draft.enabled}
                                            onChange={event =>
                                                setDraft({ ...draft, enabled: event.target.checked })
                                            }
                                            className="h-4 w-4"
                                        />
                                        前台启用
                                    </label>
                                </div>
                                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                                    <Field label="内部管理名称 *">
                                        <input
                                            value={draft.internalName}
                                            onChange={event =>
                                                setDraft({ ...draft, internalName: event.target.value })
                                            }
                                            className={inputClass}
                                        />
                                    </Field>
                                    <Field label="稳定编码 *">
                                        <input
                                            value={draft.code}
                                            onChange={event =>
                                                setDraft({ ...draft, code: event.target.value })
                                            }
                                            disabled={Boolean(draft.id)}
                                            className={`${inputClass} font-mono disabled:bg-slate-100 disabled:text-slate-400`}
                                        />
                                    </Field>
                                    <Field label="开始展示">
                                        <input
                                            type="datetime-local"
                                            value={toLocalDateTime(draft.startsAt)}
                                            onChange={event =>
                                                setDraft({
                                                    ...draft,
                                                    startsAt: fromLocalDateTime(event.target.value),
                                                })
                                            }
                                            className={inputClass}
                                        />
                                    </Field>
                                    <Field label="结束展示">
                                        <input
                                            type="datetime-local"
                                            value={toLocalDateTime(draft.endsAt)}
                                            onChange={event =>
                                                setDraft({
                                                    ...draft,
                                                    endsAt: fromLocalDateTime(event.target.value),
                                                })
                                            }
                                            className={inputClass}
                                        />
                                    </Field>
                                </div>
                                <p className="mt-3 text-[11px] leading-5 text-slate-500">
                                    开始和结束时间都不填写时，将永久展示；只填写一项时，按该时间单边生效。
                                </p>
                            </section>

                            <section className="rounded-xl border border-slate-200 bg-white p-5">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                                            前台文案
                                            <FeatureHelpButton
                                                topic="storefront.block-copy"
                                                title="前台文案"
                                            />
                                        </h3>
                                        <p className="mt-1 text-[11px] text-slate-400">
                                            同一个区块的中英文在此集中维护
                                        </p>
                                    </div>
                                    <LanguageSwitch value={language} onChange={setLanguage} />
                                </div>
                                <div className="mt-4 space-y-4">
                                    <Field
                                        label={`${language === 'zh_Hans' ? '中文' : '英文'}标题${language === 'zh_Hans' ? ' *' : ''}`}
                                    >
                                        <input
                                            value={translation.title}
                                            onChange={event =>
                                                updateTranslation({ title: event.target.value })
                                            }
                                            className={inputClass}
                                        />
                                    </Field>
                                    <Field label="副标题">
                                        <input
                                            value={translation.subtitle}
                                            onChange={event =>
                                                updateTranslation({ subtitle: event.target.value })
                                            }
                                            className={inputClass}
                                        />
                                    </Field>
                                    <Field label={isSupport ? '客服说明' : '正文'}>
                                        <textarea
                                            rows={5}
                                            value={translation.body}
                                            onChange={event =>
                                                updateTranslation({ body: event.target.value })
                                            }
                                            className={`${inputClass} resize-y leading-6`}
                                        />
                                    </Field>
                                    {!isSupport && (
                                        <Field label="按钮文案">
                                            <input
                                                value={translation.ctaLabel}
                                                onChange={event =>
                                                    updateTranslation({ ctaLabel: event.target.value })
                                                }
                                                className={inputClass}
                                            />
                                        </Field>
                                    )}
                                </div>
                            </section>

                            <section className="rounded-xl border border-slate-200 bg-white p-5">
                                <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                                    {isSupport ? '客服页配色' : '图片、配色与跳转'}
                                    <FeatureHelpButton topic="storefront.block-visuals" title="图片与配色" />
                                </h3>
                                {isSupport && (
                                    <p className="mt-1 text-[11px] text-slate-400">
                                        客服页当前仅使用背景色；二维码请在下方微信客服渠道中上传
                                    </p>
                                )}
                                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                                    {!isSupport && (
                                        <div className="sm:col-span-2">
                                            <AssetPicker
                                                label="主图素材"
                                                value={draft.imageAsset}
                                                fallbackUrl={draft.imageUrl}
                                                onChange={asset =>
                                                    setDraft({
                                                        ...draft,
                                                        imageAsset: asset,
                                                        imageAssetId: asset?.id ?? null,
                                                        imageUrl: asset?.preview ?? null,
                                                    })
                                                }
                                            />
                                        </div>
                                    )}
                                    {['QUICK_LINKS', 'TRUST_BAR', 'CATEGORY_AD'].includes(draft.type) && (
                                        <Field label="卡片样式">
                                            <select
                                                className={inputClass}
                                                value={normalizedHomepageVisualStyle(
                                                    draft.settings?.visualStyle,
                                                )}
                                                onChange={event =>
                                                    updateSettings({ visualStyle: event.target.value })
                                                }
                                            >
                                                {homepageVisualStyles.map(option => (
                                                    <option key={option.value} value={option.value}>
                                                        {option.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </Field>
                                    )}
                                    {draft.type === 'HERO' && (
                                        <>
                                            <Field label="轮播图样式">
                                                <select
                                                    className={inputClass}
                                                    value={normalizedHeroThemePreset(
                                                        draft.settings?.themePreset,
                                                    )}
                                                    onChange={event =>
                                                        updateSettings({ themePreset: event.target.value })
                                                    }
                                                >
                                                    {heroThemePresets.map(option => (
                                                        <option key={option.value} value={option.value}>
                                                            {option.label}
                                                        </option>
                                                    ))}
                                                </select>
                                            </Field>
                                            <Field label="遮罩对比度">
                                                <select
                                                    className={inputClass}
                                                    value={
                                                        draft.settings?.contrastMode === 'high'
                                                            ? 'high'
                                                            : 'standard'
                                                    }
                                                    onChange={event =>
                                                        updateSettings({ contrastMode: event.target.value })
                                                    }
                                                >
                                                    <option value="standard">标准</option>
                                                    <option value="high">高对比度</option>
                                                </select>
                                            </Field>
                                        </>
                                    )}
                                    {['HERO', 'AUTH_LOGIN', 'AUTH_REGISTER'].includes(draft.type) && (
                                        <Field label="强调色">
                                            <ColorInput
                                                value={stringSetting(
                                                    draft.settings?.accentColor,
                                                    draft.type === 'AUTH_REGISTER'
                                                        ? '#8B5CF6'
                                                        : draft.type === 'AUTH_LOGIN'
                                                          ? '#22D3EE'
                                                          : normalizedHeroThemePreset(
                                                                  draft.settings?.themePreset,
                                                              ) === 'warm'
                                                            ? '#fbbf24'
                                                            : '#67e8f9',
                                                )}
                                                onChange={value => updateSettings({ accentColor: value })}
                                            />
                                        </Field>
                                    )}
                                    {draft.type === 'HERO' && (
                                        <>
                                            <Field label="正文文字色">
                                                <ColorInput
                                                    value={stringSetting(
                                                        draft.settings?.secondaryTextColor,
                                                        '#cbd5e1',
                                                    )}
                                                    onChange={value =>
                                                        updateSettings({ secondaryTextColor: value })
                                                    }
                                                />
                                            </Field>
                                            <Field label="按钮渐变色">
                                                <ColorInput
                                                    value={stringSetting(
                                                        draft.settings?.accentSecondaryColor,
                                                        normalizedHeroThemePreset(
                                                            draft.settings?.themePreset,
                                                        ) === 'warm'
                                                            ? '#b45309'
                                                            : '#0e7490',
                                                    )}
                                                    onChange={value =>
                                                        updateSettings({ accentSecondaryColor: value })
                                                    }
                                                />
                                            </Field>
                                            <Field label="按钮文字色">
                                                <ColorInput
                                                    value={stringSetting(
                                                        draft.settings?.buttonTextColor,
                                                        '#ffffff',
                                                    )}
                                                    onChange={value =>
                                                        updateSettings({ buttonTextColor: value })
                                                    }
                                                />
                                            </Field>
                                        </>
                                    )}
                                    <Field label="背景色">
                                        <ColorInput
                                            value={
                                                draft.backgroundColor ??
                                                (draft.type === 'HERO' ? '#090d16' : '#ffffff')
                                            }
                                            onChange={value => setDraft({ ...draft, backgroundColor: value })}
                                        />
                                    </Field>
                                    {!isSupport && (
                                        <>
                                            <Field label="文字色">
                                                <ColorInput
                                                    value={
                                                        draft.textColor ??
                                                        (draft.type === 'HERO' ? '#ffffff' : '#0f172a')
                                                    }
                                                    onChange={value =>
                                                        setDraft({ ...draft, textColor: value })
                                                    }
                                                />
                                            </Field>
                                            <Field label="跳转类型">
                                                <select
                                                    value={draft.targetType}
                                                    onChange={event =>
                                                        setDraft({
                                                            ...draft,
                                                            targetType: event.target
                                                                .value as StorefrontTargetType,
                                                            targetValue:
                                                                event.target.value === 'NONE'
                                                                    ? null
                                                                    : draft.targetValue,
                                                        })
                                                    }
                                                    className={inputClass}
                                                >
                                                    {targetOptions.map(([value, label]) => (
                                                        <option key={value} value={value}>
                                                            {label}
                                                        </option>
                                                    ))}
                                                </select>
                                            </Field>
                                            <Field label="跳转目标">
                                                <TargetValueInput
                                                    type={draft.targetType}
                                                    value={draft.targetValue ?? ''}
                                                    onChange={value =>
                                                        setDraft({ ...draft, targetValue: value || null })
                                                    }
                                                />
                                            </Field>
                                        </>
                                    )}
                                </div>
                            </section>

                            {moduleHasSettings(draft.type) && (
                                <section className="rounded-xl border border-slate-200 bg-white p-5">
                                    <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                                        {isSupport ? '客服服务时间' : '展示规则'}
                                        <FeatureHelpButton
                                            topic="storefront.block-rules"
                                            title="展示规则与服务时间"
                                        />
                                    </h3>
                                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                                        {draft.type === 'SUPPORT' ? (
                                            <>
                                                <Field label="中文服务日">
                                                    <input
                                                        value={stringSetting(
                                                            draft.settings?.serviceDaysZh,
                                                            '每日',
                                                        )}
                                                        onChange={event =>
                                                            updateSettings({
                                                                serviceDaysZh: event.target.value,
                                                            })
                                                        }
                                                        className={inputClass}
                                                    />
                                                </Field>
                                                <Field label="English service days">
                                                    <input
                                                        value={stringSetting(
                                                            draft.settings?.serviceDaysEn,
                                                            'Daily',
                                                        )}
                                                        onChange={event =>
                                                            updateSettings({
                                                                serviceDaysEn: event.target.value,
                                                            })
                                                        }
                                                        className={inputClass}
                                                    />
                                                </Field>
                                                <Field label="开始时间">
                                                    <input
                                                        type="time"
                                                        value={stringSetting(
                                                            draft.settings?.serviceStartTime,
                                                            '09:00',
                                                        )}
                                                        onChange={event =>
                                                            updateSettings({
                                                                serviceStartTime: event.target.value,
                                                            })
                                                        }
                                                        className={inputClass}
                                                    />
                                                </Field>
                                                <Field label="结束时间">
                                                    <input
                                                        type="time"
                                                        value={stringSetting(
                                                            draft.settings?.serviceEndTime,
                                                            '18:00',
                                                        )}
                                                        onChange={event =>
                                                            updateSettings({
                                                                serviceEndTime: event.target.value,
                                                            })
                                                        }
                                                        className={inputClass}
                                                    />
                                                </Field>
                                                <p className="sm:col-span-2 text-[11px] leading-5 text-slate-500">
                                                    客服服务时间用于前台提示；旧配置未保存时间时按每日
                                                    09:00–18:00 显示。
                                                </p>
                                            </>
                                        ) : draft.type === 'NOTICE' ? (
                                            <Field label="公告轮播间隔（秒）">
                                                <input
                                                    type="number"
                                                    min={3}
                                                    max={30}
                                                    value={numberSetting(
                                                        draft.settings?.scrollIntervalSeconds,
                                                        5,
                                                    )}
                                                    onChange={event =>
                                                        updateSettings({
                                                            scrollIntervalSeconds: clamp(
                                                                Number(event.target.value),
                                                                3,
                                                                30,
                                                            ),
                                                        })
                                                    }
                                                    className={inputClass}
                                                />
                                            </Field>
                                        ) : (
                                            <Field label="展示数量">
                                                <input
                                                    type="number"
                                                    min={1}
                                                    max={draft.type === 'CATEGORY_AD' ? 4 : 50}
                                                    value={numberSetting(
                                                        draft.settings?.displayCount,
                                                        draft.type === 'CATEGORY_AD' ? 4 : 8,
                                                    )}
                                                    onChange={event =>
                                                        updateSettings({
                                                            displayCount: clamp(
                                                                Number(event.target.value),
                                                                1,
                                                                draft.type === 'CATEGORY_AD' ? 4 : 50,
                                                            ),
                                                        })
                                                    }
                                                    className={inputClass}
                                                />
                                            </Field>
                                        )}
                                        {productSettingKey && (
                                            <div className="sm:col-span-2">
                                                <button
                                                    type="button"
                                                    onClick={() => setShowProducts(!showProducts)}
                                                    className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100"
                                                >
                                                    选择商品（已选 {selectedProductIds.length} 个）
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                    {showProducts && productSettingKey && !canReadProducts && (
                                        <p role="status">需要商品读取权限才能选择商品，已保留原配置。</p>
                                    )}
                                    {showProducts && productSettingKey && canReadProducts && (
                                        <div className="mt-4 rounded-xl border border-slate-200 p-3">
                                            <div className="relative">
                                                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                                                <input
                                                    value={productSearch}
                                                    onChange={event => {
                                                        setProductSearch(event.target.value);
                                                        setProductPage(0);
                                                    }}
                                                    aria-label="搜索商品"
                                                    placeholder="搜索商品"
                                                    className={`${inputClass} pl-9`}
                                                />
                                            </div>
                                            <div className="mt-3 grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2">
                                                {visibleProducts.map(product => (
                                                    <label
                                                        key={product.id}
                                                        className="flex cursor-pointer items-center gap-2 rounded-lg bg-slate-50 p-2 text-xs hover:bg-blue-50"
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedProductIds.includes(product.id)}
                                                            onChange={() => toggleProduct(product.id)}
                                                        />
                                                        <span className="truncate">{product.name}</span>
                                                    </label>
                                                ))}
                                                {options.loading && !options.data && (
                                                    <p className="col-span-2 py-8 text-center text-xs text-slate-400">
                                                        正在读取商品…
                                                    </p>
                                                )}
                                                {!options.loading &&
                                                    !options.error &&
                                                    !visibleProducts.length && (
                                                        <p className="col-span-2 py-8 text-center text-xs text-slate-400">
                                                            没有匹配商品
                                                        </p>
                                                    )}
                                            </div>
                                            <InlinePager
                                                loading={options.loading}
                                                page={productPage}
                                                pageSize={productPageSize}
                                                onPageSizeChange={setProductPageSize}
                                                totalItems={options.data?.products.totalItems ?? 0}
                                                onPageChange={setProductPage}
                                            />
                                        </div>
                                    )}
                                </section>
                            )}

                            {moduleUsesItems(draft.type) && (
                                <section className="rounded-xl border border-slate-200 bg-white p-5">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                                                {isSupport ? '客服渠道' : '子项内容'}
                                                <FeatureHelpButton
                                                    topic="storefront.block-copy"
                                                    title="模块子项内容"
                                                />
                                            </h3>
                                            <p className="mt-1 text-[11px] text-slate-400">
                                                {isSupport
                                                    ? '启用需要展示的联系方式；微信客服需上传二维码'
                                                    : '用于轮播、入口、保障项、法律页或导航项'}
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setDraft({
                                                    ...draft,
                                                    items: [
                                                        ...draft.items,
                                                        newContentItem(draft.items.length),
                                                    ],
                                                })
                                            }
                                            disabled={draft.type === 'NAVIGATION' && draft.items.length >= 5}
                                            className="flex items-center gap-1 rounded-lg bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 disabled:opacity-40"
                                        >
                                            <Plus className="h-3.5 w-3.5" />
                                            {isSupport ? '添加渠道' : '添加子项'}
                                        </button>
                                    </div>
                                    <div className="mt-4 space-y-3">
                                        {draft.items.map((item, index) => (
                                            <ItemEditor
                                                key={item.id ?? `new-${index}`}
                                                item={item}
                                                index={index}
                                                count={draft.items.length}
                                                language={language}
                                                blockType={draft.type}
                                                onChange={next =>
                                                    setDraft({
                                                        ...draft,
                                                        items: draft.items.map((current, currentIndex) =>
                                                            currentIndex === index ? next : current,
                                                        ),
                                                    })
                                                }
                                                onMove={direction =>
                                                    setDraft({
                                                        ...draft,
                                                        items: moveItem(
                                                            draft.items,
                                                            index,
                                                            index + direction,
                                                        ),
                                                    })
                                                }
                                                onRemove={() =>
                                                    setDraft({
                                                        ...draft,
                                                        items: draft.items
                                                            .filter(
                                                                (_, currentIndex) => currentIndex !== index,
                                                            )
                                                            .map((current, position) => ({
                                                                ...current,
                                                                position,
                                                            })),
                                                    })
                                                }
                                            />
                                        ))}
                                        {!draft.items.length && (
                                            <p className="rounded-lg bg-slate-50 py-8 text-center text-xs text-slate-400">
                                                当前没有子项，该楼层可以仅展示主文案
                                            </p>
                                        )}
                                    </div>
                                </section>
                            )}
                        </div>

                        <aside className="space-y-4 xl:sticky xl:top-0 xl:self-start">
                            <BlockPreview block={draft} language={language} />
                            <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-600">
                                <div className="font-bold text-slate-900">生效方式</div>
                                <p className="mt-2 leading-5">
                                    保存后直接更新当前店铺的前台配置。展示时间都留空时永久展示；排期未到或已过期的内容不会展示。
                                </p>
                            </div>
                        </aside>
                    </div>
                </div>

                <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-slate-200 bg-white px-5 py-3 sm:px-7">
                    <p className={`text-xs ${validation ? 'text-rose-600' : 'text-emerald-700'}`}>
                        {validation ?? '内容校验通过'}
                    </p>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={saving}
                            className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                        >
                            取消
                        </button>
                        <button
                            type="button"
                            onClick={() => void onSave(draft)}
                            disabled={saving || Boolean(validation)}
                            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-5 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                            <Check className="h-4 w-4" />
                            {saving ? '正在保存…' : '保存并生效'}
                        </button>
                    </div>
                </footer>
            </div>
        </AccessibleDialogSurface>
    );
}
