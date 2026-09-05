import { useQuery } from '@apollo/client/react';
import {
    ArrowDown,
    ArrowUp,
    Check,
    ChevronLeft,
    ChevronRight,
    Image as ImageIcon,
    Plus,
    Search,
    Trash2,
    UploadCloud,
    X,
} from 'lucide-react';
import { useDeferredValue, useRef, useState } from 'react';
import { uploadAdminFiles } from '../../apollo';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { CREATE_ASSETS_MULTIPART } from '../../graphql/catalog-admin.graphql';
import { GET_ASSETS, GET_COLLECTIONS, GET_PRODUCTS } from '../../graphql/catalog.graphql';
import {
    STOREFRONT_EDITOR_OPTIONS_QUERY,
    type StorefrontAssetRef,
    type StorefrontContentBlock,
    type StorefrontContentItem,
    type StorefrontLanguageCode,
    type StorefrontTargetType,
} from '../../graphql/storefront.graphql';
import { toUserFacingError } from '../../utils/user-facing-error';
import {
    blockTranslation,
    cloneContentBlock,
    fromLocalDateTime,
    itemTranslation,
    navigationTargets,
    newContentItem,
    normalizeSupportAccount,
    storefrontBlockValidation,
    supportLinkFromAccount,
    toLocalDateTime,
} from './storefront-content-utils';

interface EditorOptionsResult {
    products: {
        items: Array<{
            id: string;
            name: string;
            slug: string;
            featuredAsset: { id: string; preview: string } | null;
        }>;
        totalItems: number;
    };
}

interface AssetQueryResult {
    assets: { items: Array<StorefrontAssetRef & { type: string; mimeType: string }>; totalItems: number };
}

interface CreateAssetResult extends Partial<StorefrontAssetRef> {
    __typename: 'Asset' | 'MimeTypeError';
    message?: string;
}

interface CreateAssetsData {
    createAssets: CreateAssetResult[];
}

const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024;
const supportedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

const targetOptions: Array<[StorefrontTargetType, string]> = [
    ['NONE', '无跳转'],
    ['URL', '网址'],
    ['PRODUCT', '商品 ID'],
    ['COLLECTION', '集合 ID'],
    ['CATEGORY', '分类'],
    ['SEARCH', '搜索关键词'],
    ['PAGE', '客户端页面'],
    ['SUPPORT', '客服中心'],
    ['COUPON', '优惠券'],
];

export function StorefrontBlockEditor({
    value,
    saving,
    onClose,
    onSave,
}: {
    value: StorefrontContentBlock;
    saving: boolean;
    onClose: () => void;
    onSave: (value: StorefrontContentBlock) => Promise<void>;
}) {
    const [draft, setDraft] = useState(() => cloneContentBlock(value));
    const [language, setLanguage] = useState<StorefrontLanguageCode>('zh_Hans');
    const [showProducts, setShowProducts] = useState(false);
    const [productSearch, setProductSearch] = useState('');
    const [productPage, setProductPage] = useState(0);
    const deferredProductSearch = useDeferredValue(productSearch.trim());
    const options = useQuery<EditorOptionsResult>(STOREFRONT_EDITOR_OPTIONS_QUERY, {
        variables: {
            productOptions: {
                skip: productPage * 30,
                take: 30,
                sort: { name: 'ASC' },
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
                                    <Field label="背景色">
                                        <ColorInput
                                            value={draft.backgroundColor ?? '#ffffff'}
                                            onChange={value => setDraft({ ...draft, backgroundColor: value })}
                                        />
                                    </Field>
                                    {!isSupport && (
                                        <>
                                            <Field label="文字色">
                                                <ColorInput
                                                    value={draft.textColor ?? '#0f172a'}
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
                                    {showProducts && productSettingKey && (
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
                                                page={productPage}
                                                pageSize={30}
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

function ItemEditor({
    item,
    index,
    count,
    language,
    blockType,
    onChange,
    onMove,
    onRemove,
}: {
    item: StorefrontContentItem;
    index: number;
    count: number;
    language: StorefrontLanguageCode;
    blockType: StorefrontContentBlock['type'];
    onChange: (value: StorefrontContentItem) => void;
    onMove: (direction: -1 | 1) => void;
    onRemove: () => void;
}) {
    const translation = itemTranslation(item, language);
    const updateTranslation = (patch: Partial<typeof translation>) =>
        onChange({
            ...item,
            translations: item.translations.map(value =>
                value.languageCode === language ? { ...value, ...patch } : value,
            ),
        });
    const navigation = blockType === 'NAVIGATION';
    const support = blockType === 'SUPPORT';
    const supportChannel =
        typeof item.settings?.supportChannel === 'string' ? item.settings.supportChannel : '';
    const wechatSupport = support && supportChannel === 'WECHAT';
    const automaticSupportLink = ['QQ', 'WHATSAPP', 'TELEGRAM'].includes(supportChannel);
    const supportAccount = stringSetting(item.settings?.supportAccount, '');
    const generatedSupportLink = supportLinkFromAccount(supportChannel, supportAccount);
    const accountCopy = supportAccountCopy(supportChannel, automaticSupportLink);
    const coreCategories = blockType === 'CORE_CATEGORIES';
    const updateLocalizedSetting = (field: 'badgeLabel' | 'ctaLabel', value: string) =>
        onChange({
            ...item,
            settings: {
                ...(item.settings ?? {}),
                [localizedItemSettingKey(field, language)]: value,
            },
        });
    return (
        <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                    <input
                        type="checkbox"
                        checked={item.enabled}
                        onChange={event => onChange({ ...item, enabled: event.target.checked })}
                    />
                    {support ? '客服渠道' : '子项'} {index + 1}
                </label>
                <div className="flex gap-1">
                    <IconButton
                        label="上移"
                        disabled={index === 0}
                        onClick={() => onMove(-1)}
                        icon={ArrowUp}
                    />
                    <IconButton
                        label="下移"
                        disabled={index === count - 1}
                        onClick={() => onMove(1)}
                        icon={ArrowDown}
                    />
                    <IconButton
                        label="删除"
                        disabled={navigation && count <= 1}
                        onClick={onRemove}
                        icon={Trash2}
                        danger
                    />
                </div>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label={`${language === 'zh_Hans' ? '中文' : '英文'}名称 *`}>
                    <input
                        value={translation.label}
                        onChange={event => updateTranslation({ label: event.target.value })}
                        className={inputClass}
                    />
                </Field>
                <Field label="说明">
                    <input
                        value={translation.description}
                        onChange={event => updateTranslation({ description: event.target.value })}
                        className={inputClass}
                    />
                </Field>
                {coreCategories && (
                    <>
                        <Field label={`${language === 'zh_Hans' ? '中文' : '英文'}角标文案`}>
                            <input
                                value={stringSetting(
                                    item.settings?.[localizedItemSettingKey('badgeLabel', language)],
                                    '',
                                )}
                                onChange={event => updateLocalizedSetting('badgeLabel', event.target.value)}
                                className={inputClass}
                            />
                        </Field>
                        <Field label={`${language === 'zh_Hans' ? '中文' : '英文'}卡片按钮文案`}>
                            <input
                                value={stringSetting(
                                    item.settings?.[localizedItemSettingKey('ctaLabel', language)],
                                    '',
                                )}
                                onChange={event => updateLocalizedSetting('ctaLabel', event.target.value)}
                                className={inputClass}
                            />
                        </Field>
                    </>
                )}
                {support && (
                    <Field label="客服渠道">
                        <select
                            value={supportChannel}
                            onChange={event => {
                                const nextChannel = event.target.value;
                                const nextAccount = nextChannel === supportChannel ? supportAccount : '';
                                const generatedTarget = supportLinkFromAccount(nextChannel, nextAccount);
                                onChange({
                                    ...item,
                                    targetType: nextChannel === 'WECHAT' ? 'NONE' : 'URL',
                                    targetValue:
                                        nextChannel === 'WECHAT'
                                            ? null
                                            : (generatedTarget ?? item.targetValue),
                                    settings: {
                                        ...(item.settings ?? {}),
                                        supportChannel: nextChannel,
                                        supportAccount: nextAccount,
                                    },
                                });
                            }}
                            className={inputClass}
                        >
                            <option value="">请选择</option>
                            <option value="WECHAT">微信客服</option>
                            <option value="QQ">QQ 客服</option>
                            <option value="WHATSAPP">WhatsApp</option>
                            <option value="TELEGRAM">Telegram</option>
                            <option value="QQ_GROUP">QQ 群</option>
                        </select>
                    </Field>
                )}
                {support && supportChannel && (
                    <Field label={accountCopy.label}>
                        <input
                            value={supportAccount}
                            onChange={event => {
                                const nextAccount = normalizeSupportAccount(
                                    supportChannel,
                                    event.target.value,
                                );
                                const generatedTarget = supportLinkFromAccount(supportChannel, nextAccount);
                                onChange({
                                    ...item,
                                    targetType: wechatSupport ? 'NONE' : 'URL',
                                    targetValue: automaticSupportLink ? generatedTarget : item.targetValue,
                                    settings: {
                                        ...(item.settings ?? {}),
                                        supportAccount: nextAccount,
                                    },
                                });
                            }}
                            className={inputClass}
                            placeholder={accountCopy.placeholder}
                        />
                    </Field>
                )}
                {support && automaticSupportLink && (
                    <Field label="系统生成跳转地址">
                        <input
                            value={generatedSupportLink ?? ''}
                            readOnly
                            className={`${inputClass} bg-slate-100 text-slate-500`}
                            placeholder="填写账号后自动生成"
                        />
                    </Field>
                )}
                {!support && (
                    <Field label="跳转类型">
                        <select
                            value={navigation ? 'PAGE' : item.targetType}
                            disabled={navigation}
                            onChange={event =>
                                onChange({
                                    ...item,
                                    targetType: event.target.value as StorefrontTargetType,
                                    targetValue: event.target.value === 'NONE' ? null : item.targetValue,
                                })
                            }
                            className={`${inputClass} disabled:bg-slate-100`}
                        >
                            {targetOptions.map(([value, label]) => (
                                <option key={value} value={value}>
                                    {label}
                                </option>
                            ))}
                        </select>
                    </Field>
                )}
                {!support && (
                    <Field label="跳转目标">
                        <TargetValueInput
                            type={navigation ? 'PAGE' : item.targetType}
                            value={item.targetValue ?? ''}
                            onChange={value =>
                                onChange({
                                    ...item,
                                    targetType: navigation ? 'PAGE' : item.targetType,
                                    targetValue: value || null,
                                })
                            }
                        />
                    </Field>
                )}
                {support && supportChannel && !wechatSupport && !automaticSupportLink && (
                    <Field label={supportChannel === 'QQ_GROUP' ? 'QQ群邀请链接 *' : '客服链接 *'}>
                        <input
                            value={item.targetValue ?? ''}
                            onChange={event =>
                                onChange({
                                    ...item,
                                    targetType: 'URL',
                                    targetValue: event.target.value || null,
                                })
                            }
                            className={inputClass}
                            placeholder="https://..."
                        />
                    </Field>
                )}
                {wechatSupport && (
                    <div className="sm:col-span-2">
                        <AssetPicker
                            label="微信客服二维码 *"
                            value={item.imageAsset}
                            fallbackUrl={item.imageUrl}
                            onChange={asset =>
                                onChange({
                                    ...item,
                                    imageAsset: asset,
                                    imageAssetId: asset?.id ?? null,
                                    imageUrl: asset?.preview ?? null,
                                    targetType: 'NONE',
                                    targetValue: null,
                                })
                            }
                            compact
                        />
                    </div>
                )}
                {!navigation && !support && (
                    <div className="sm:col-span-2">
                        <AssetPicker
                            label="子项图片"
                            value={item.imageAsset}
                            fallbackUrl={item.imageUrl}
                            onChange={asset =>
                                onChange({
                                    ...item,
                                    imageAsset: asset,
                                    imageAssetId: asset?.id ?? null,
                                    imageUrl: asset?.preview ?? null,
                                })
                            }
                            compact
                        />
                    </div>
                )}
            </div>
        </article>
    );
}

function supportAccountCopy(channel: string, required: boolean): { label: string; placeholder: string } {
    const suffix = required ? ' *' : '（选填）';
    if (channel === 'QQ') return { label: `QQ 号${suffix}`, placeholder: '例如 123456789' };
    if (channel === 'WHATSAPP') {
        return {
            label: `WhatsApp 手机号${suffix}`,
            placeholder: '例如 60123456789（国际格式，不含 +）',
        };
    }
    if (channel === 'TELEGRAM') {
        return {
            label: `Telegram 用户名${suffix}`,
            placeholder: '例如 flashcast_support（不含 @）',
        };
    }
    if (channel === 'QQ_GROUP') return { label: `QQ群号${suffix}`, placeholder: '用于前台显示群号' };
    return { label: `微信号${suffix}`, placeholder: '用于前台显示微信号' };
}

function InlinePager({
    page,
    pageSize,
    totalItems,
    onPageChange,
}: {
    page: number;
    pageSize: number;
    totalItems: number;
    onPageChange: (page: number) => void;
}) {
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    return (
        <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-[10px] text-slate-400">
            <span>
                共 {totalItems} 条 · {Math.min(page + 1, totalPages)} / {totalPages} 页
            </span>
            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={() => onPageChange(Math.max(0, page - 1))}
                    disabled={page === 0}
                    className="rounded-lg border border-slate-200 p-1.5 disabled:opacity-30"
                    aria-label="上一页"
                >
                    <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button
                    type="button"
                    onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
                    disabled={page >= totalPages - 1}
                    className="rounded-lg border border-slate-200 p-1.5 disabled:opacity-30"
                    aria-label="下一页"
                >
                    <ChevronRight className="h-3.5 w-3.5" />
                </button>
            </div>
        </div>
    );
}

function AssetPicker({
    label,
    value,
    fallbackUrl,
    onChange,
    compact = false,
}: {
    label: string;
    value: StorefrontAssetRef | null;
    fallbackUrl: string | null;
    onChange: (asset: StorefrontAssetRef | null) => void;
    compact?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(0);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState('');
    const uploadInputRef = useRef<HTMLInputElement>(null);
    const deferredSearch = useDeferredValue(search.trim());
    const assets = useQuery<AssetQueryResult>(GET_ASSETS, {
        variables: {
            options: {
                skip: page * 40,
                take: 40,
                sort: { updatedAt: 'DESC' },
                filter: {
                    type: { eq: 'IMAGE' },
                    ...(deferredSearch ? { name: { contains: deferredSearch } } : {}),
                },
            },
        },
        skip: !open,
        fetchPolicy: 'cache-first',
    });
    const items = assets.data?.assets.items ?? [];
    const totalItems = assets.data?.assets.totalItems ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / 40));
    const preview = value?.preview ?? fallbackUrl;
    const uploadImage = async (file: File) => {
        if (!supportedImageTypes.has(file.type)) {
            setUploadError('仅支持 JPG、PNG 或 WebP 图片');
            return;
        }
        if (file.size > MAX_IMAGE_SIZE_BYTES) {
            setUploadError('图片不能超过 20 MB');
            return;
        }

        setUploading(true);
        setUploadError('');
        try {
            const result = await uploadAdminFiles<CreateAssetsData>(
                CREATE_ASSETS_MULTIPART,
                [file],
                ([filePlaceholder]) => ({
                    input: [{ file: filePlaceholder, tags: ['后台上传'] }],
                }),
            );
            const uploaded = result.createAssets[0];
            if (
                uploaded?.__typename !== 'Asset' ||
                !uploaded.id ||
                !uploaded.name ||
                !uploaded.preview ||
                !uploaded.source
            ) {
                throw new Error(uploaded?.message || 'Vendure 未返回有效的图片素材');
            }
            onChange({
                id: uploaded.id,
                name: uploaded.name,
                preview: uploaded.preview,
                source: uploaded.source,
            });
            setSearch('');
            setPage(0);
            void assets.refetch().catch(() => undefined);
        } catch (error) {
            setUploadError(toUserFacingError(error, '图片上传失败，请稍后重试'));
        } finally {
            setUploading(false);
        }
    };
    return (
        <div>
            <div className="mb-1 text-xs font-bold text-slate-700">{label}</div>
            <div className="flex items-center gap-3 rounded-lg border border-slate-200 p-2">
                {preview ? (
                    <img
                        src={preview}
                        alt={value?.name || '已选素材'}
                        className={`${compact ? 'h-12 w-12' : 'h-20 w-24'} rounded-md border border-slate-200 object-cover`}
                    />
                ) : (
                    <div
                        className={`${compact ? 'h-12 w-12' : 'h-20 w-24'} flex items-center justify-center rounded-md bg-slate-100 text-slate-400`}
                    >
                        <ImageIcon className="h-5 w-5" />
                    </div>
                )}
                <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-bold text-slate-800">
                        {value?.name ?? (preview ? '外部图片' : '未选择素材')}
                    </div>
                    <div className="mt-2 flex gap-2">
                        <input
                            ref={uploadInputRef}
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            disabled={uploading}
                            className="sr-only"
                            aria-label={`上传${label}`}
                            onChange={event => {
                                const file = event.currentTarget.files?.[0];
                                event.currentTarget.value = '';
                                if (file) void uploadImage(file);
                            }}
                        />
                        <button
                            type="button"
                            onClick={() => uploadInputRef.current?.click()}
                            disabled={uploading}
                            className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                            <UploadCloud className={`h-3.5 w-3.5 ${uploading ? 'animate-pulse' : ''}`} />
                            {uploading ? '上传中…' : '上传图片'}
                        </button>
                        <button
                            type="button"
                            onClick={() => setOpen(true)}
                            className="rounded-lg bg-blue-50 px-3 py-1.5 text-[11px] font-bold text-blue-700 hover:bg-blue-100"
                        >
                            从素材库选择
                        </button>
                        {preview && (
                            <button
                                type="button"
                                onClick={() => onChange(null)}
                                className="rounded-lg px-2 py-1.5 text-[11px] text-rose-600 hover:bg-rose-50"
                            >
                                清除
                            </button>
                        )}
                    </div>
                </div>
            </div>
            {uploadError && (
                <p className="mt-1.5 text-[11px] text-rose-600" role="alert">
                    {uploadError}
                </p>
            )}
            {open && (
                <div
                    className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4"
                    onMouseDown={event => {
                        if (event.target === event.currentTarget) setOpen(false);
                    }}
                >
                    <AccessibleDialogSurface
                        accessibleName="选择图片素材"
                        onRequestClose={() => setOpen(false)}
                        className="w-full max-w-3xl rounded-2xl bg-white p-5 shadow-2xl"
                    >
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="flex items-center gap-2 font-bold text-slate-900">
                                    选择图片素材
                                    <FeatureHelpButton
                                        topic="storefront.block-visuals"
                                        title="选择图片素材"
                                    />
                                </h3>
                                <p className="mt-1 text-xs text-slate-400">读取商品管理中的真实素材库</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                className="p-2 text-slate-400"
                                aria-label="关闭"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="relative mt-4">
                            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                            <input
                                value={search}
                                onChange={event => {
                                    setSearch(event.target.value);
                                    setPage(0);
                                }}
                                aria-label="搜索素材"
                                placeholder="搜索素材名称"
                                className={`${inputClass} pl-9`}
                            />
                        </div>
                        <div className="mt-4 grid max-h-[55vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-4">
                            {assets.loading && !assets.data
                                ? Array.from({ length: 8 }, (_, index) => (
                                      <div
                                          key={index}
                                          className="aspect-square animate-pulse rounded-xl bg-slate-100"
                                      />
                                  ))
                                : items.map(asset => (
                                      <button
                                          key={asset.id}
                                          type="button"
                                          onClick={() => {
                                              onChange(asset);
                                              setOpen(false);
                                          }}
                                          className="overflow-hidden rounded-xl border border-slate-200 text-left hover:border-blue-500"
                                      >
                                          <img
                                              src={asset.preview}
                                              alt={asset.name}
                                              className="aspect-square w-full object-cover"
                                          />
                                          <div className="truncate p-2 text-[11px] font-bold text-slate-700">
                                              {asset.name}
                                          </div>
                                      </button>
                                  ))}
                            {!assets.loading && !items.length && (
                                <div className="col-span-full py-12 text-center text-xs text-slate-400">
                                    {assets.error
                                        ? toUserFacingError(assets.error, '图片素材读取失败，请稍后重试')
                                        : '没有匹配的图片素材'}
                                </div>
                            )}
                        </div>
                        <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-[10px] text-slate-400">
                            <span>
                                共 {totalItems} 张图片 · {Math.min(page + 1, totalPages)} / {totalPages} 页
                            </span>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setPage(current => Math.max(0, current - 1))}
                                    disabled={page === 0 || assets.loading}
                                    className="rounded-lg border border-slate-200 p-1.5 disabled:opacity-30"
                                    aria-label="上一页"
                                >
                                    <ChevronLeft className="h-3.5 w-3.5" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPage(current => Math.min(totalPages - 1, current + 1))}
                                    disabled={page >= totalPages - 1 || assets.loading}
                                    className="rounded-lg border border-slate-200 p-1.5 disabled:opacity-30"
                                    aria-label="下一页"
                                >
                                    <ChevronRight className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        </div>
                    </AccessibleDialogSurface>
                </div>
            )}
        </div>
    );
}

function TargetValueInput({
    type,
    value,
    onChange,
}: {
    type: StorefrontTargetType;
    value: string;
    onChange: (value: string) => void;
}) {
    const [lookupSearch, setLookupSearch] = useState('');
    const deferredLookupSearch = useDeferredValue(lookupSearch.trim());
    const productLookup = useQuery<{
        products: { items: Array<{ id: string; name: string }>; totalItems: number };
    }>(GET_PRODUCTS, {
        variables: {
            options: {
                take: 20,
                sort: { name: 'ASC' },
                filter: deferredLookupSearch ? { name: { contains: deferredLookupSearch } } : {},
            },
        },
        skip: type !== 'PRODUCT',
        fetchPolicy: 'cache-first',
    });
    const collectionLookup = useQuery<{
        collections: { items: Array<{ id: string; name: string }>; totalItems: number };
    }>(GET_COLLECTIONS, {
        variables: {
            options: {
                topLevelOnly: false,
                take: 20,
                sort: { name: 'ASC' },
                filter: deferredLookupSearch ? { name: { contains: deferredLookupSearch } } : {},
            },
        },
        skip: type !== 'COLLECTION',
        fetchPolicy: 'cache-first',
    });
    if (type === 'NONE')
        return <input value="" disabled className={`${inputClass} bg-slate-100`} placeholder="无需填写" />;
    if (type === 'PAGE')
        return (
            <select value={value} onChange={event => onChange(event.target.value)} className={inputClass}>
                <option value="">请选择页面</option>
                {navigationTargets.map(([path, label]) => (
                    <option key={path} value={path}>
                        {label} · {path}
                    </option>
                ))}
            </select>
        );
    if (type === 'PRODUCT' || type === 'COLLECTION') {
        const query = type === 'PRODUCT' ? productLookup : collectionLookup;
        const items =
            type === 'PRODUCT'
                ? (productLookup.data?.products.items ?? [])
                : (collectionLookup.data?.collections.items ?? []);
        const totalItems =
            type === 'PRODUCT'
                ? (productLookup.data?.products.totalItems ?? 0)
                : (collectionLookup.data?.collections.totalItems ?? 0);
        return (
            <div className="space-y-2">
                <div className="relative">
                    <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                    <input
                        value={lookupSearch}
                        onChange={event => setLookupSearch(event.target.value)}
                        className={`${inputClass} pl-8`}
                        placeholder={`搜索${type === 'PRODUCT' ? '商品' : '分类专辑'}名称`}
                    />
                </div>
                <select value={value} onChange={event => onChange(event.target.value)} className={inputClass}>
                    <option value="">
                        {query.loading ? '正在查询…' : `请选择（匹配 ${totalItems} 条）`}
                    </option>
                    {value && !items.some(item => item.id === value) && (
                        <option value={value}>已选目标 · {value}</option>
                    )}
                    {items.map(item => (
                        <option key={item.id} value={item.id}>
                            {item.name}
                        </option>
                    ))}
                </select>
                {query.error && (
                    <p className="text-[10px] text-rose-600">目标列表读取失败，可保留原选择后重试</p>
                )}
            </div>
        );
    }
    return (
        <input
            value={value}
            onChange={event => onChange(event.target.value)}
            className={inputClass}
            placeholder={type === 'URL' ? 'https://...' : '请填写目标值'}
        />
    );
}

function BlockPreview({
    block,
    language,
}: {
    block: StorefrontContentBlock;
    language: StorefrontLanguageCode;
}) {
    const translation = blockTranslation(block, language);
    const image = block.imageAsset?.preview ?? block.imageUrl;
    if (block.type === 'SUPPORT') {
        const isZh = language === 'zh_Hans';
        const days = stringSetting(
            isZh ? block.settings?.serviceDaysZh : block.settings?.serviceDaysEn,
            isZh ? '每日' : 'Daily',
        );
        const startTime = stringSetting(block.settings?.serviceStartTime, '09:00');
        const endTime = stringSetting(block.settings?.serviceEndTime, '18:00');
        const channels = block.items.filter(item => item.enabled);
        return (
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                    <h3 className="text-xs font-bold text-slate-900">
                        简易前台预览
                        <FeatureHelpButton topic="storefront.safe-preview" title="简易前台预览" />
                    </h3>
                    <span className="rounded bg-slate-100 px-2 py-1 font-mono text-[10px] text-slate-500">
                        SUPPORT
                    </span>
                </div>
                <div className="p-4" style={{ backgroundColor: block.backgroundColor ?? '#f8fafc' }}>
                    <h4 className="text-base font-bold text-slate-900">
                        {translation.title || (isZh ? '客服中心' : 'Customer support')}
                    </h4>
                    {translation.subtitle && (
                        <p className="mt-1 text-xs leading-5 text-slate-500">{translation.subtitle}</p>
                    )}
                    <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                        <div className="flex items-center justify-between gap-3 text-[11px]">
                            <strong className="text-slate-800">
                                {isZh ? '客服服务时间' : 'Customer-service hours'}
                            </strong>
                            <span className="rounded bg-blue-50 px-2 py-1 font-bold text-blue-700">
                                {days}
                            </span>
                        </div>
                        <div className="mt-2 font-mono text-xl font-bold text-slate-900">
                            {startTime}–{endTime}
                        </div>
                        {translation.body && (
                            <p className="mt-2 whitespace-pre-wrap text-[10px] leading-4 text-slate-500">
                                {translation.body}
                            </p>
                        )}
                    </div>
                    <div className="mt-3 space-y-2">
                        {channels.map((item, index) => {
                            const channel = stringSetting(item.settings?.supportChannel, '');
                            const qrImage = item.imageAsset?.preview ?? item.imageUrl;
                            return (
                                <div
                                    key={item.id ?? index}
                                    className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2"
                                >
                                    {channel === 'WECHAT' && qrImage ? (
                                        <img src={qrImage} alt="" className="h-8 w-8 rounded object-cover" />
                                    ) : (
                                        <div className="h-8 w-8 rounded bg-slate-100" />
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <strong className="block truncate text-[11px] text-slate-800">
                                            {itemTranslation(item, language).label || `客服渠道 ${index + 1}`}
                                        </strong>
                                        <span className="block truncate text-[10px] text-slate-400">
                                            {channel === 'WECHAT'
                                                ? isZh
                                                    ? '扫码联系'
                                                    : 'Scan QR code'
                                                : stringSetting(
                                                      item.settings?.supportAccount,
                                                      item.targetValue ?? '',
                                                  )}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                        {!channels.length && (
                            <p className="rounded-lg bg-white py-5 text-center text-[11px] text-slate-400">
                                {isZh ? '尚未启用客服渠道' : 'No support channel enabled'}
                            </p>
                        )}
                    </div>
                </div>
            </section>
        );
    }
    return (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <h3 className="flex items-center gap-2 text-xs font-bold text-slate-900">
                    简易前台预览
                    <FeatureHelpButton topic="storefront.structure-preview" title="简易前台预览" />
                </h3>
                <span className="rounded bg-slate-100 px-2 py-1 font-mono text-[10px] text-slate-500">
                    {block.type}
                </span>
            </div>
            <div className="p-4">
                <div
                    className="overflow-hidden rounded-xl p-5"
                    style={{
                        backgroundColor: block.backgroundColor ?? '#f1f5f9',
                        color: block.textColor ?? '#0f172a',
                    }}
                >
                    {image && (
                        <img
                            src={image}
                            alt={translation.title || block.internalName}
                            className="mb-4 aspect-[16/8] w-full rounded-lg object-cover"
                        />
                    )}
                    <h4 className="text-lg font-bold leading-tight">{translation.title || '未填写标题'}</h4>
                    {translation.subtitle && (
                        <p className="mt-2 text-xs opacity-75">{translation.subtitle}</p>
                    )}
                    {translation.body && (
                        <p className="mt-3 whitespace-pre-wrap text-xs leading-5 opacity-80">
                            {translation.body}
                        </p>
                    )}
                    {translation.ctaLabel && (
                        <span className="mt-4 inline-flex rounded-md bg-white/85 px-3 py-1.5 text-[11px] font-bold text-slate-900">
                            {translation.ctaLabel}
                        </span>
                    )}
                    {block.items.length > 0 && (
                        <div className="mt-4 grid grid-cols-2 gap-2">
                            {block.items
                                .filter(item => item.enabled)
                                .slice(0, 6)
                                .map((item, index) => (
                                    <div
                                        key={item.id ?? index}
                                        className="rounded-lg bg-white/75 p-2 text-slate-900"
                                    >
                                        <div className="text-[11px] font-bold">
                                            {itemTranslation(item, language).label || `子项 ${index + 1}`}
                                        </div>
                                        <div className="mt-1 line-clamp-2 text-[10px] text-slate-500">
                                            {itemTranslation(item, language).description}
                                        </div>
                                    </div>
                                ))}
                        </div>
                    )}
                </div>
            </div>
        </section>
    );
}

function LanguageSwitch({
    value,
    onChange,
}: {
    value: StorefrontLanguageCode;
    onChange: (value: StorefrontLanguageCode) => void;
}) {
    return (
        <div className="flex rounded-lg bg-slate-100 p-1 text-[11px] font-bold">
            <button
                type="button"
                onClick={() => onChange('zh_Hans')}
                className={`rounded-md px-3 py-1.5 ${value === 'zh_Hans' ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-500'}`}
            >
                中文
            </button>
            <button
                type="button"
                onClick={() => onChange('en')}
                className={`rounded-md px-3 py-1.5 ${value === 'en' ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-500'}`}
            >
                English
            </button>
        </div>
    );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block text-xs font-bold text-slate-700">
            <span className="mb-1.5 block">{label}</span>
            {children}
        </label>
    );
}
function ColorInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    return (
        <div className="flex gap-2">
            <input
                type="color"
                value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'}
                onChange={event => onChange(event.target.value)}
                className="h-9 w-11 rounded border border-slate-300 bg-white p-1"
            />
            <input
                value={value}
                onChange={event => onChange(event.target.value)}
                className={`${inputClass} font-mono`}
            />
        </div>
    );
}
function IconButton({
    label,
    disabled,
    onClick,
    icon: Icon,
    danger = false,
}: {
    label: string;
    disabled: boolean;
    onClick: () => void;
    icon: typeof ArrowUp;
    danger?: boolean;
}) {
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
            className={`rounded-md p-1.5 disabled:opacity-30 ${danger ? 'text-rose-500 hover:bg-rose-50' : 'text-slate-500 hover:bg-white'}`}
        >
            <Icon className="h-3.5 w-3.5" />
        </button>
    );
}

function moveItem(items: StorefrontContentItem[], from: number, to: number) {
    if (to < 0 || to >= items.length) return items;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next.map((item, position) => ({ ...item, position }));
}
function stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
function numberSetting(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function stringSetting(value: unknown, fallback: string): string {
    return typeof value === 'string' ? value : fallback;
}
function localizedItemSettingKey(field: 'badgeLabel' | 'ctaLabel', language: StorefrontLanguageCode): string {
    return `${field}${language === 'zh_Hans' ? 'Zh' : 'En'}`;
}
function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
function moduleHasSettings(type: StorefrontContentBlock['type']) {
    return [
        'NOTICE',
        'CATEGORY_AD',
        'FEATURED_COLLECTION',
        'BEST_SELLERS',
        'RECOMMENDATIONS',
        'SUPPORT',
    ].includes(type);
}
function moduleUsesItems(type: StorefrontContentBlock['type']) {
    return [
        'HERO',
        'NOTICE',
        'QUICK_LINKS',
        'CORE_CATEGORIES',
        'COUPONS',
        'TRUST_BAR',
        'LEGAL',
        'SUPPORT',
        'NAVIGATION',
        'CUSTOM',
    ].includes(type);
}
const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-normal text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100';
