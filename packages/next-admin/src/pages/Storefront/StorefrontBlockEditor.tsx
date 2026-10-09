import { AdminButton, AdminInput, AdminSelect, AdminTextArea } from '../../components/AdminControls';
import { useAdminQuery as useQuery } from '../../hooks/use-admin-query';

import { Check, Plus, Search, X } from 'lucide-react';
import { useDeferredValue, useLayoutEffect, useRef, useState } from 'react';
import { storefrontAssetUrl } from '../../../../storefront-content-plugin/src/content-image';
import {
    heroThemePresets,
    homepageVisualStyles,
    normalizedHeroThemePreset,
    normalizedHomepageVisualStyle,
} from '../../../../storefront-content-plugin/src/content-visuals';
import {
    dualCardTemplateId,
    dualCardTemplates,
} from '../../../../storefront-content-plugin/src/dual-card-template-options';
import { imageReplacements } from '../../../../storefront-content-plugin/src/image-replacement-policy';
import {
    mobileHeroTranslation,
    type MobileHeroTranslation,
} from '../../../../storefront-content-plugin/src/shared/hero-image';
import { resolveHeroArtworkLayout } from '../../../../storefront-content-plugin/src/shared/hero-scene';
import { authHeroCopyPosition } from '../../../../storefront/src/auth-visual';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { AdminOverlayPortal } from '../../components/AdminOverlayHost';
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
import { SupportFaqEditor } from './SupportFaqEditor';

export function StorefrontBlockEditor({
    value,
    saving,
    error,
    onClose,
    onSave,
    initialLanguage = 'zh_Hans',
    reviewTarget,
}: {
    value: StorefrontContentBlock;
    saving: boolean;
    error?: string;
    onClose: () => void;
    onSave: (value: StorefrontContentBlock, allowImageReplacement?: boolean) => Promise<void>;
    initialLanguage?: StorefrontLanguageCode;
    reviewTarget?: { itemId: string | null; field: string | null };
}) {
    const { hasAnyPermission } = useAdminPermissions();
    const canReadProducts = hasAnyPermission(['ReadCatalog', 'ReadProduct']);
    const [draft, setDraft] = useState(() => cloneContentBlock(value));
    const [reviewedImages, setReviewedImages] = useState<string | null>(null);
    const [language, setLanguage] = useState<StorefrontLanguageCode>(initialLanguage);
    const contentRef = useRef<HTMLDivElement>(null);
    const reviewItemId = reviewTarget?.itemId;
    const reviewField = reviewTarget?.field;
    useLayoutEffect(() => {
        if (!reviewField || !contentRef.current) return;
        const scope = reviewItemId
            ? [...contentRef.current.querySelectorAll<HTMLElement>('[data-translation-item-id]')].find(
                  item => item.dataset.translationItemId === reviewItemId,
              )
            : contentRef.current;
        const target =
            scope &&
            [
                ...scope.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-translation-field]'),
            ].find(item => item.dataset.translationField === reviewField);
        target?.focus({ preventScroll: true });
        target?.scrollIntoView?.({ block: 'center' });
    }, [reviewItemId, reviewField]);
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
    });
    const translation = blockTranslation(draft, language);
    const validation = storefrontBlockValidation(draft);
    const imageChanges = value.id ? imageReplacements(value, draft) : [];
    const imageReviewKey = JSON.stringify(imageChanges);
    const imagesConfirmed = imageChanges.length === 0 || reviewedImages === imageReviewKey;
    /* oxlint-disable react/set-state-in-effect -- Any image edit invalidates the prior confirmation. */
    useLayoutEffect(() => setReviewedImages(null), [imageReviewKey]);
    /* oxlint-enable react/set-state-in-effect */
    const imageName = (
        binding: StorefrontContentBlock | StorefrontContentBlock['items'][number] | undefined,
    ) => binding?.imageAsset?.name || binding?.imageUrl?.split('/').pop() || '清除图片';
    const imageChangeDescriptions = imageChanges.map(change => {
        if (change.slot === 'main')
            return `${draft.type === 'HERO' ? '电脑端轮播图' : '主图'}：${imageName(value)} → ${imageName(draft)}`;
        if (change.slot === 'mobile-hero') return '手机端轮播图已替换或清除';
        if (change.slot === 'mobile-decoration') return '手机底部装饰图已替换或清除';
        const itemId = change.slot.slice('item:'.length);
        const previous = value.items.find(item => String(item.id) === itemId);
        const next = draft.items.find(item => String(item.id) === itemId);
        const label = previous?.translations.find(item => item.languageCode === 'zh_Hans')?.label || '子项';
        return `${label}：${imageName(previous)} → ${next ? imageName(next) : '移除子项图片'}`;
    });
    const isSupport = draft.type === 'SUPPORT';
    const isAuth = draft.type === 'AUTH_LOGIN' || draft.type === 'AUTH_REGISTER';
    const authLanguageSuffix = language === 'zh_Hans' ? 'Zh' : 'En';
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
    const phoneTranslation = mobileHeroTranslation(draft.settings, language);
    const editorialHero = draft.type === 'HERO' && resolveHeroArtworkLayout(draft.settings) === 'editorial';
    const phoneImageUrl = stringSetting(draft.settings?.mobileImageUrl, '').trim();
    const updatePhoneTranslation = (patch: Partial<MobileHeroTranslation>) => {
        const translations = (['zh_Hans', 'en'] as const).map(code => {
            const translation = {
                ...mobileHeroTranslation(draft.settings, code),
                ...(code === language ? patch : {}),
            };
            // Keep the draft identical to the JSON settings sent for save and readback.
            for (const field of ['title', 'subtitle', 'body', 'ctaLabel'] as const) {
                if (translation[field] === undefined) delete translation[field];
            }
            return translation;
        });
        updateSettings({ mobileHeroTranslations: translations });
    };
    const toggleProduct = (id: string) => {
        if (!productSettingKey) return;
        const next = selectedProductIds.includes(id)
            ? selectedProductIds.filter(value => value !== id)
            : [...selectedProductIds, id];
        updateSettings({ [productSettingKey]: next });
    };

    const dialog = (
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
                    <AdminButton
                        type="button"
                        onClick={onClose}
                        disabled={saving}
                        className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        aria-label="关闭编辑器"
                    >
                        <X className="h-5 w-5" />
                    </AdminButton>
                </header>

                <div ref={contentRef} className="flex-1 overflow-y-auto p-5 sm:p-7">
                    {reviewTarget && (
                        <p className="mb-4 text-xs text-blue-700" role="status">
                            已定位英文复核内容：{reviewTarget.itemId ? `子项 ${reviewTarget.itemId} · ` : ''}
                            {reviewTarget.field || '区块文案'}。修改后仍需保存。
                        </p>
                    )}
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
                            <AdminButton
                                type="button"
                                onClick={() => void options.refetch()}
                                className="self-start rounded-lg bg-amber-900 px-3 py-2 font-bold text-white sm:self-auto"
                            >
                                重新加载选项
                            </AdminButton>
                        </div>
                    )}
                    <div className="mx-auto grid max-w-6xl gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
                        <div className="min-w-0 space-y-5">
                            <section className="rounded-xl border border-slate-200 bg-white p-5">
                                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                                            基础设置
                                            <FeatureHelpButton
                                                topic="storefront.block-basic"
                                                title="楼层基础设置"
                                                description={'编码用于客户端稳定识别，创建后建议不修改'}
                                            />
                                        </h3>
                                    </div>
                                    <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                                        <AdminInput
                                            type="checkbox"
                                            checked={draft.enabled}
                                            onChange={event =>
                                                setDraft({ ...draft, enabled: event.target.checked })
                                            }
                                            className="h-4 w-4"
                                        />
                                        启用（保存后生效）
                                    </label>
                                </div>
                                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                                    <Field label="内部管理名称 *">
                                        <AdminInput
                                            value={draft.internalName}
                                            onChange={event =>
                                                setDraft({ ...draft, internalName: event.target.value })
                                            }
                                            className={inputClass}
                                        />
                                    </Field>
                                    <Field label="稳定编码 *">
                                        <AdminInput
                                            value={draft.code}
                                            onChange={event =>
                                                setDraft({ ...draft, code: event.target.value })
                                            }
                                            disabled={Boolean(draft.id)}
                                            className={`${inputClass} font-mono disabled:bg-slate-100 disabled:text-slate-400`}
                                        />
                                    </Field>
                                    <Field label="开始展示">
                                        <AdminInput
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
                                        <AdminInput
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
                                                description={'同一个区块的中英文在此集中维护'}
                                            />
                                        </h3>
                                    </div>
                                    <LanguageSwitch value={language} onChange={setLanguage} />
                                </div>
                                <div className="mt-4 space-y-4">
                                    <Field
                                        label={`${isAuth ? '电脑左侧' : ''}${language === 'zh_Hans' ? '中文' : '英文'}标题${language === 'zh_Hans' ? ' *' : ''}`}
                                    >
                                        {isAuth || draft.type === 'HERO' ? (
                                            <AdminTextArea
                                                rows={2}
                                                data-translation-field="title"
                                                value={translation.title}
                                                onChange={event =>
                                                    updateTranslation({ title: event.target.value })
                                                }
                                                className={`${inputClass} resize-y`}
                                                placeholder="可换行安排主标题层次"
                                            />
                                        ) : (
                                            <AdminInput
                                                data-translation-field="title"
                                                value={translation.title}
                                                onChange={event =>
                                                    updateTranslation({ title: event.target.value })
                                                }
                                                className={inputClass}
                                            />
                                        )}
                                    </Field>
                                    {draft.type === 'HERO' && (
                                        <p className="text-xs leading-5 text-slate-500">
                                            可换行，前台按排版完整显示。
                                        </p>
                                    )}
                                    {draft.type === 'HERO' && (
                                        <HeroCopyHint
                                            language={language}
                                            viewport="desktop"
                                            field="title"
                                            value={translation.title}
                                            editorial={editorialHero}
                                        />
                                    )}
                                    <Field label={isAuth ? '电脑左侧副标题' : '副标题'}>
                                        <AdminInput
                                            data-translation-field="subtitle"
                                            value={translation.subtitle}
                                            onChange={event =>
                                                updateTranslation({ subtitle: event.target.value })
                                            }
                                            className={inputClass}
                                        />
                                    </Field>
                                    {isAuth && (
                                        <>
                                            <Field label="表单标题（电脑与手机共用）">
                                                <AdminInput
                                                    className={inputClass}
                                                    maxLength={60}
                                                    value={stringSetting(
                                                        draft.settings?.[`formTitle${authLanguageSuffix}`],
                                                        '',
                                                    )}
                                                    placeholder={
                                                        draft.type === 'AUTH_LOGIN'
                                                            ? language === 'zh_Hans'
                                                                ? '登录账户'
                                                                : 'Sign in'
                                                            : language === 'zh_Hans'
                                                              ? '注册账户'
                                                              : 'Create account'
                                                    }
                                                    onChange={event =>
                                                        updateSettings({
                                                            [`formTitle${authLanguageSuffix}`]:
                                                                event.target.value,
                                                        })
                                                    }
                                                />
                                            </Field>
                                            <Field label="表单副标题（电脑与手机共用）">
                                                <AdminInput
                                                    className={inputClass}
                                                    maxLength={160}
                                                    value={stringSetting(
                                                        draft.settings?.[`formSubtitle${authLanguageSuffix}`],
                                                        '',
                                                    )}
                                                    placeholder={
                                                        draft.type === 'AUTH_LOGIN'
                                                            ? language === 'zh_Hans'
                                                                ? '连接本地服务'
                                                                : 'Connect with local services'
                                                            : language === 'zh_Hans'
                                                              ? '开启购物之旅'
                                                              : 'Start your shopping journey'
                                                    }
                                                    onChange={event =>
                                                        updateSettings({
                                                            [`formSubtitle${authLanguageSuffix}`]:
                                                                event.target.value,
                                                        })
                                                    }
                                                />
                                            </Field>
                                        </>
                                    )}
                                    <Field label={isSupport ? '客服说明' : '正文'}>
                                        <AdminTextArea
                                            rows={5}
                                            data-translation-field="body"
                                            value={translation.body}
                                            onChange={event =>
                                                updateTranslation({ body: event.target.value })
                                            }
                                            className={`${inputClass} resize-y leading-6`}
                                        />
                                    </Field>
                                    {draft.type === 'HERO' && (
                                        <HeroCopyHint
                                            language={language}
                                            viewport="desktop"
                                            field="body"
                                            value={translation.body}
                                            editorial={editorialHero}
                                        />
                                    )}
                                    {!isSupport && (
                                        <Field label={isAuth ? '图片上的引导短句' : '按钮文案'}>
                                            <AdminInput
                                                data-translation-field="ctaLabel"
                                                value={translation.ctaLabel}
                                                onChange={event =>
                                                    updateTranslation({ ctaLabel: event.target.value })
                                                }
                                                className={inputClass}
                                            />
                                        </Field>
                                    )}
                                    {draft.type === 'HERO' && (
                                        <>
                                            <Field
                                                label="手机标题（选填）"
                                                helpText="可换行，前台按排版完整显示；未设置沿用当前语言电脑版文案，已填写后清空则手机隐藏该文字。"
                                            >
                                                <AdminTextArea
                                                    rows={2}
                                                    value={phoneTranslation.title ?? ''}
                                                    onChange={event =>
                                                        updatePhoneTranslation({ title: event.target.value })
                                                    }
                                                    className={`${inputClass} resize-y`}
                                                />
                                            </Field>
                                            <HeroCopyHint
                                                language={language}
                                                viewport="mobile"
                                                field="title"
                                                value={phoneTranslation.title}
                                                inheritedValue={translation.title}
                                                editorial={editorialHero}
                                            />
                                            <Field label="手机副标题（选填）">
                                                <AdminInput
                                                    value={phoneTranslation.subtitle ?? ''}
                                                    onChange={event =>
                                                        updatePhoneTranslation({
                                                            subtitle: event.target.value,
                                                        })
                                                    }
                                                    className={inputClass}
                                                />
                                            </Field>
                                            <Field label="手机说明（选填）">
                                                <AdminTextArea
                                                    rows={2}
                                                    value={phoneTranslation.body ?? ''}
                                                    onChange={event =>
                                                        updatePhoneTranslation({ body: event.target.value })
                                                    }
                                                    className={`${inputClass} resize-y`}
                                                />
                                            </Field>
                                            <HeroCopyHint
                                                language={language}
                                                viewport="mobile"
                                                field="body"
                                                value={phoneTranslation.body}
                                                inheritedValue={translation.body}
                                                editorial={editorialHero}
                                            />
                                            <Field label="手机按钮文案（选填）">
                                                <AdminInput
                                                    value={phoneTranslation.ctaLabel ?? ''}
                                                    onChange={event =>
                                                        updatePhoneTranslation({
                                                            ctaLabel: event.target.value,
                                                        })
                                                    }
                                                    className={inputClass}
                                                />
                                            </Field>
                                            <div className="sm:col-span-2">
                                                <AdminButton
                                                    type="button"
                                                    onClick={() =>
                                                        updatePhoneTranslation({
                                                            title: undefined,
                                                            subtitle: undefined,
                                                            body: undefined,
                                                            ctaLabel: undefined,
                                                        })
                                                    }
                                                    className="rounded-lg px-3 py-2 text-xs text-slate-600 hover:bg-slate-100"
                                                >
                                                    恢复当前语言电脑版文案
                                                </AdminButton>
                                            </div>
                                        </>
                                    )}
                                </div>
                            </section>

                            <section className="rounded-xl border border-slate-200 bg-white p-5">
                                <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                                    {isSupport
                                        ? '客服页配色'
                                        : draft.type === 'CORE_CATEGORIES'
                                          ? '双卡配色与跳转'
                                          : '图片、配色与跳转'}
                                    {draft.type !== 'CORE_CATEGORIES' && (
                                        <FeatureHelpButton
                                            topic="storefront.block-visuals"
                                            title="图片与配色"
                                        />
                                    )}
                                </h3>
                                {isSupport && (
                                    <p className="mt-1 text-[11px] text-slate-400">
                                        页首配图用于电脑端客服页面；微信二维码请在下方客服渠道中上传
                                    </p>
                                )}
                                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                                    {draft.type !== 'CORE_CATEGORIES' && (
                                        <div className="sm:col-span-2">
                                            <AssetPicker
                                                label={
                                                    isSupport
                                                        ? '电脑端客服页首配图'
                                                        : draft.type === 'HERO'
                                                          ? '电脑端轮播图'
                                                          : '主图素材'
                                                }
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
                                            {draft.type === 'HERO' && (
                                                <p className="mt-2 text-xs leading-5 text-slate-500">
                                                    电脑端使用此图，建议比例
                                                    3:1；手机未单独设置图片时也会沿用此图。
                                                    底图不写广告标题、说明和按钮；中英文文字在前台文案中分别编辑。
                                                    切换图文布局不会替换电脑图或手机图。
                                                </p>
                                            )}
                                        </div>
                                    )}
                                    {draft.type === 'HERO' && (
                                        <div className="sm:col-span-2">
                                            <AssetPicker
                                                label="手机端轮播图（可选）"
                                                value={null}
                                                fallbackUrl={phoneImageUrl || null}
                                                onChange={asset =>
                                                    updateSettings({
                                                        mobileImageUrl: asset
                                                            ? storefrontAssetUrl(asset) || null
                                                            : null,
                                                        mobileImageAssetId: asset?.id ?? null,
                                                        mobileImageWidth: asset?.width ?? null,
                                                        mobileImageHeight: asset?.height ?? null,
                                                    })
                                                }
                                            />
                                            <p
                                                data-hero-artwork-binding="mobile"
                                                className="mt-2 text-xs leading-5 text-slate-500"
                                            >
                                                {phoneImageUrl
                                                    ? '已单独设置手机端轮播图，电脑端继续使用电脑图。'
                                                    : '未单独设置手机图，当前沿用电脑端轮播图。'}
                                                建议比例 3:2；清除手机图后恢复沿用电脑图。
                                            </p>
                                            <p className="mt-2 text-xs leading-5 text-slate-500">
                                                {editorialHero
                                                    ? '手机也采用左侧文字、右侧主体构图，底图左侧请留出文字空间，右侧保留完整主体。'
                                                    : '手机图可按手机屏幕单独构图；在右侧预览中切换“电脑 / 手机”核对各自图片。'}
                                            </p>
                                        </div>
                                    )}
                                    {['QUICK_LINKS', 'TRUST_BAR', 'CATEGORY_AD'].includes(draft.type) && (
                                        <Field label="卡片样式">
                                            <AdminSelect
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
                                            </AdminSelect>
                                        </Field>
                                    )}
                                    {draft.type === 'CORE_CATEGORIES' && (
                                        <Field
                                            label="双卡片颜色模板"
                                            helpText="双卡仅展示文案和跳转，不使用图片；暖居纯色会自动跟随当前店铺皮肤配色。"
                                        >
                                            <AdminSelect
                                                className={inputClass}
                                                value={dualCardTemplateId(draft.settings)}
                                                onChange={event =>
                                                    updateSettings({ dualCardTemplate: event.target.value })
                                                }
                                            >
                                                {dualCardTemplates.map(template => (
                                                    <option key={template.id} value={template.id}>
                                                        {template.labelZh} · {template.descriptionZh}
                                                    </option>
                                                ))}
                                            </AdminSelect>
                                        </Field>
                                    )}
                                    {draft.type === 'HERO' && (
                                        <>
                                            <Field
                                                label="轮播图文布局"
                                                helpText={
                                                    editorialHero
                                                        ? '电脑与手机均为左侧网页文字、右侧完整主体，底图左侧请留空；电脑图建议 3:1，手机图建议 3:2，可分别设置。'
                                                        : '保留现有图片上的网页文字布局；选择左右构图后，电脑与手机会使用共用的图文分离布局。'
                                                }
                                            >
                                                <AdminSelect
                                                    aria-label="轮播图文布局"
                                                    className={inputClass}
                                                    value={resolveHeroArtworkLayout(draft.settings)}
                                                    disabled={saving}
                                                    onChange={event =>
                                                        updateSettings({
                                                            heroArtworkLayout: event.target.value,
                                                        })
                                                    }
                                                >
                                                    <option value="overlay">原图文叠加</option>
                                                    <option value="editorial">无文字底图·左右构图</option>
                                                </AdminSelect>
                                            </Field>
                                            <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
                                                <AdminInput
                                                    type="checkbox"
                                                    checked={draft.settings?.mobileHeroHideStats === true}
                                                    onChange={event =>
                                                        updateSettings({
                                                            mobileHeroHideStats: event.target.checked,
                                                        })
                                                    }
                                                />
                                                手机隐藏轮播卖点（电脑端保留）
                                            </label>
                                            <Field label="手机标题文字色（选填）">
                                                <ColorInput
                                                    value={stringSetting(
                                                        draft.settings?.mobileHeroTextColor,
                                                        '',
                                                    )}
                                                    onChange={color =>
                                                        updateSettings({ mobileHeroTextColor: color })
                                                    }
                                                />
                                            </Field>
                                            <Field label="手机说明文字色（选填）">
                                                <ColorInput
                                                    value={stringSetting(
                                                        draft.settings?.mobileHeroSecondaryTextColor,
                                                        '',
                                                    )}
                                                    onChange={color =>
                                                        updateSettings({
                                                            mobileHeroSecondaryTextColor: color,
                                                        })
                                                    }
                                                />
                                            </Field>
                                            <Field label="轮播图样式">
                                                <AdminSelect
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
                                                </AdminSelect>
                                            </Field>
                                            <Field label="遮罩对比度">
                                                <AdminSelect
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
                                                </AdminSelect>
                                            </Field>
                                        </>
                                    )}
                                    {isAuth && (
                                        <>
                                            <Field label="电脑端图片上的文字位置">
                                                <AdminSelect
                                                    className={inputClass}
                                                    value={authHeroCopyPosition(draft.settings)}
                                                    onChange={event =>
                                                        updateSettings({
                                                            heroCopyPosition: event.target.value,
                                                        })
                                                    }
                                                >
                                                    <option value="center">左侧居中</option>
                                                    <option value="bottom">左侧靠下</option>
                                                </AdminSelect>
                                            </Field>
                                            <Field label="卖点呈现方式">
                                                <AdminSelect
                                                    className={inputClass}
                                                    value={
                                                        draft.settings?.heroBenefitsStyle === 'tags'
                                                            ? 'tags'
                                                            : 'icons'
                                                    }
                                                    onChange={event =>
                                                        updateSettings({
                                                            heroBenefitsStyle: event.target.value,
                                                        })
                                                    }
                                                >
                                                    <option value="icons">图标、标题与说明</option>
                                                    <option value="tags">简洁文字标签</option>
                                                </AdminSelect>
                                            </Field>
                                            <label className="flex items-center gap-2 text-sm text-slate-700">
                                                <AdminInput
                                                    type="checkbox"
                                                    checked={draft.settings?.heroLogoEnabled !== false}
                                                    onChange={event =>
                                                        updateSettings({
                                                            heroLogoEnabled: event.target.checked,
                                                        })
                                                    }
                                                />
                                                图片顶部展示店铺品牌
                                            </label>
                                            <Field label="手机底部装饰图（选填）">
                                                <AssetPicker
                                                    label="装饰图素材"
                                                    value={null}
                                                    fallbackUrl={
                                                        stringSetting(
                                                            draft.settings?.mobileDecorationImageUrl,
                                                            '',
                                                        ) || null
                                                    }
                                                    onChange={asset =>
                                                        updateSettings({
                                                            mobileDecorationImageUrl: asset?.preview ?? null,
                                                            mobileDecorationImageAssetId: asset?.id ?? null,
                                                        })
                                                    }
                                                />
                                                <p className="mt-2 text-xs text-slate-500">
                                                    建议使用浅色横向城市轮廓图；仅显示在表单下方，短屏或输入时隐藏。留空不展示。
                                                </p>
                                            </Field>
                                        </>
                                    )}
                                    {['HERO', 'AUTH_LOGIN', 'AUTH_REGISTER'].includes(draft.type) && (
                                        <Field label="强调色">
                                            <ColorInput
                                                value={stringSetting(draft.settings?.accentColor, '')}
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
                                                        '',
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
                                                        '',
                                                    )}
                                                    onChange={value =>
                                                        updateSettings({ accentSecondaryColor: value })
                                                    }
                                                />
                                            </Field>
                                            <Field label="按钮文字色">
                                                <ColorInput
                                                    value={stringSetting(draft.settings?.buttonTextColor, '')}
                                                    onChange={value =>
                                                        updateSettings({ buttonTextColor: value })
                                                    }
                                                />
                                            </Field>
                                        </>
                                    )}
                                    <Field label="背景色" helpText="留空时继承商城统一背景色">
                                        <ColorInput
                                            value={draft.backgroundColor ?? ''}
                                            placeholder="继承商城默认"
                                            onChange={value => setDraft({ ...draft, backgroundColor: value })}
                                        />
                                    </Field>
                                    {!isSupport && (
                                        <>
                                            <Field
                                                label="文字色"
                                                helpText={
                                                    draft.type === 'HERO'
                                                        ? '填写后使用设定文字色；留空时根据图片明暗选色，图片保持原色、无颜色遮罩'
                                                        : '留空时继承商城默认文字色'
                                                }
                                            >
                                                <ColorInput
                                                    value={draft.textColor ?? ''}
                                                    placeholder={
                                                        draft.type === 'HERO'
                                                            ? '自动适应图片'
                                                            : '继承商城默认'
                                                    }
                                                    onChange={value =>
                                                        setDraft({ ...draft, textColor: value })
                                                    }
                                                />
                                            </Field>
                                            <Field label="跳转类型">
                                                <AdminSelect
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
                                                </AdminSelect>
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
                                                    <AdminInput
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
                                                <Field label="英文服务日期">
                                                    <AdminInput
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
                                                    <AdminInput
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
                                                    <AdminInput
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
                                        ) : draft.type === 'CUSTOM' ? (
                                            <>
                                                <Field label="展示方式">
                                                    <AdminSelect
                                                        className={inputClass}
                                                        value={
                                                            draft.settings?.displayMode === 'scrollingAds'
                                                                ? 'scrollingAds'
                                                                : 'grid'
                                                        }
                                                        onChange={event =>
                                                            updateSettings({
                                                                displayMode: event.target.value,
                                                            })
                                                        }
                                                    >
                                                        <option value="grid">卡片网格</option>
                                                        <option value="scrollingAds">横向滚动广告</option>
                                                    </AdminSelect>
                                                </Field>
                                                {draft.settings?.displayMode === 'scrollingAds' && (
                                                    <Field label="自动滚动间隔（秒）">
                                                        <AdminInput
                                                            type="number"
                                                            min={3}
                                                            max={30}
                                                            value={numberSetting(
                                                                draft.settings?.scrollIntervalSeconds,
                                                                6,
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
                                                )}
                                                <p className="sm:col-span-2 text-[11px] leading-5 text-slate-500">
                                                    每个自定义楼层独立滚动；在下方子项中配置图片、文案和跳转。访客启用减少动态效果时暂停自动滚动。
                                                </p>
                                            </>
                                        ) : draft.type === 'NOTICE' ? (
                                            <>
                                                <Field
                                                    label="公告展示期限"
                                                    helpText="默认最近2年，可选最近30天；按上线时间（未设置则按创建时间）筛选有效公告，首页最多展示 5 条。"
                                                >
                                                    <AdminSelect
                                                        value={
                                                            draft.settings?.announcementDisplayPeriod ===
                                                            '30_DAYS'
                                                                ? '30_DAYS'
                                                                : '2_YEARS'
                                                        }
                                                        onChange={event =>
                                                            updateSettings({
                                                                announcementDisplayPeriod: event.target.value,
                                                            })
                                                        }
                                                        className={inputClass}
                                                    >
                                                        <option value="2_YEARS">最近2年</option>
                                                        <option value="30_DAYS">最近30天</option>
                                                    </AdminSelect>
                                                </Field>
                                                <Field label="公告轮播间隔（秒）">
                                                    <AdminInput
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
                                            </>
                                        ) : (
                                            <Field label="展示商品总数（非每行列数）">
                                                <AdminInput
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
                                                <AdminButton
                                                    type="button"
                                                    onClick={() => setShowProducts(!showProducts)}
                                                    className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100"
                                                >
                                                    选择商品（已选 {selectedProductIds.length} 个）
                                                </AdminButton>
                                            </div>
                                        )}
                                    </div>
                                    {showProducts && productSettingKey && !canReadProducts && (
                                        <p role="status">需要商品读取权限才能选择商品，已保留原配置。</p>
                                    )}
                                    {showProducts && productSettingKey && canReadProducts && (
                                        <div className="mt-4 rounded-xl border border-slate-200 p-3">
                                            <div className="relative">
                                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none h-4 w-4 text-slate-400" />
                                                <AdminInput
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
                                                        <AdminInput
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

                            {isSupport && (
                                <SupportFaqEditor
                                    settings={draft.settings}
                                    language={language}
                                    onChange={supportFaqs => updateSettings({ supportFaqs })}
                                />
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
                                                    description={
                                                        isSupport
                                                            ? '启用需要展示的联系方式；微信客服需上传二维码'
                                                            : draft.type === 'CORE_CATEGORIES'
                                                              ? '客户端按顺序展示前两张已启用卡片；停用的卡片不占展示名额'
                                                              : '用于轮播、入口、保障项、法律页或导航项'
                                                    }
                                                />
                                            </h3>
                                        </div>
                                        <AdminButton
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
                                        </AdminButton>
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
                                                {draft.type === 'CORE_CATEGORIES'
                                                    ? '当前没有卡片，客户端不会展示该模块；请添加并启用卡片后保存'
                                                    : '当前没有子项，该楼层可以仅展示主文案'}
                                            </p>
                                        )}
                                    </div>
                                </section>
                            )}
                        </div>

                        <aside className="min-w-0 space-y-4 xl:sticky xl:top-0 xl:self-start">
                            <BlockPreview block={draft} language={language} />
                            <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-600">
                                <div className="font-bold text-slate-900">生效方式</div>
                                <p className="mt-2 leading-5">
                                    {draft.type === 'CORE_CATEGORIES'
                                        ? '预览包含尚未保存的修改。保存并核对后，客户端按已启用子项、当前语言和店铺皮肤展示双卡；已存图片不会显示。'
                                        : '预览包含尚未保存的修改。保存并核对成功后更新当前店铺配置；客户端按启用状态、语言内容、图片与展示时间决定是否显示。'}
                                </p>
                            </div>
                        </aside>
                    </div>
                </div>

                <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-slate-200 bg-white px-5 py-3 sm:px-7">
                    <div className="min-w-0 flex-1 space-y-2">
                        <p className={`text-xs ${validation ? 'text-rose-600' : 'text-emerald-700'}`}>
                            {validation ?? '内容校验通过'}
                        </p>
                        {imageChanges.length > 0 && (
                            <div className="space-y-2 text-xs text-slate-700">
                                <p>本次将替换或清除 {imageChanges.length} 处已设置的图片：</p>
                                <ul className="max-h-24 space-y-1 overflow-auto">
                                    {imageChangeDescriptions.map((description, index) => (
                                        <li key={imageChanges[index].slot}>{description}</li>
                                    ))}
                                </ul>
                                <label className="flex items-center gap-2">
                                    <AdminInput
                                        type="checkbox"
                                        checked={imagesConfirmed}
                                        disabled={saving}
                                        onChange={event =>
                                            setReviewedImages(event.target.checked ? imageReviewKey : null)
                                        }
                                    />
                                    我确认替换或清除以上图片
                                </label>
                            </div>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <AdminButton
                            type="button"
                            onClick={onClose}
                            disabled={saving}
                            className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                        >
                            取消
                        </AdminButton>
                        <AdminButton
                            type="button"
                            onClick={() => void onSave(draft, imageChanges.length > 0 && imagesConfirmed)}
                            disabled={saving || Boolean(validation) || !imagesConfirmed}
                            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-5 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                            <Check className="h-4 w-4" />
                            {saving ? '正在保存并核对…' : '保存并核对'}
                        </AdminButton>
                    </div>
                </footer>
            </div>
        </AccessibleDialogSurface>
    );
    return <AdminOverlayPortal>{dialog}</AdminOverlayPortal>;
}

const heroCopyRecommendations = {
    zh_Hans: { desktop: { title: 20, body: 60 }, mobile: { title: 16, body: 36 } },
    en: { desktop: { title: 56, body: 130 }, mobile: { title: 36, body: 85 } },
} as const;

function HeroCopyHint({
    language,
    viewport,
    field,
    value,
    inheritedValue,
    editorial,
}: {
    language: StorefrontLanguageCode;
    viewport: 'desktop' | 'mobile';
    field: 'title' | 'body';
    value: string | undefined;
    inheritedValue?: string;
    editorial: boolean;
}) {
    const count = Array.from((value ?? inheritedValue ?? '').trim()).length;
    const recommended = heroCopyRecommendations[language][viewport][field];
    const exceedsRecommendation = editorial && count > recommended;
    const phoneState =
        viewport === 'mobile'
            ? value === undefined
                ? '未单独设置，沿用当前语言电脑版文案；'
                : value.trim() === ''
                  ? '已明确隐藏手机该文字；'
                  : ''
            : '';
    return (
        <p
            data-hero-copy-hint={`${viewport}-${field}`}
            data-copy-language={language}
            className={`text-xs leading-5 ${exceedsRecommendation ? 'text-amber-700' : 'text-slate-500'}`}
        >
            {phoneState}当前 {count} 个字符。
            {editorial && (
                <>
                    建议不超过 {recommended} 个字符；
                    {exceedsRecommendation
                        ? '文案可能超出两行，请看前台预览。'
                        : '实际行数请看前台预览，字符数不保证两行。'}
                    此提示不影响保存。
                </>
            )}
        </p>
    );
}
