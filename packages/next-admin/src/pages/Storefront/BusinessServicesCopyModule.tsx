import { useMutation } from '@apollo/client/react';
import { ExternalLink, RefreshCw, RotateCcw, Save, Sparkles } from 'lucide-react';
import { useLayoutEffect, useState, type ReactNode } from 'react';
import { imageReplacements } from '../../../../storefront-content-plugin/src/image-replacement-policy';
import { channelRequestContext, getActiveChannelToken } from '../../apollo';
import { AdminButton, AdminInput, AdminSelect, AdminTextArea } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { useAdminQuery as useQuery } from '../../hooks/use-admin-query';
import { AssetPicker } from './storefront-asset-picker';
import { StorefrontMobileViewSwitch, type StorefrontMobileView } from './StorefrontMobileViewSwitch';

import { DraftUpdateNotice } from '../../components/DraftUpdateNotice';
import {
    CREATE_STOREFRONT_BLOCK_MUTATION,
    STOREFRONT_CONTENT_QUERY,
    UPDATE_STOREFRONT_BLOCK_MUTATION,
    type StorefrontContentBlock,
    type StorefrontContentResult,
} from '../../graphql/storefront.graphql';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { useServerDraft } from '../../hooks/use-server-draft';
import { getChannelDisplayName } from '../../utils/channel-display';
import { toUserFacingError } from '../../utils/user-facing-error';
import {
    businessServicesLinkIsValid,
    businessServicesLinkValue,
    updateBusinessServicesLink,
} from './business-services-link';
import { storefrontBlockInput } from './storefront-content-utils';
import { verifyContentChannel, verifySavedBlock } from './storefront-save-verification';

const BLOCK_CODE = 'storefront-client-plugins';
const COPY_VERSION = 1;
type Language = 'zh_Hans' | 'en';

const defaults: Record<Language, { title: string; body: string; subtitle?: string; ctaLabel?: string }> = {
    zh_Hans: {
        title: '发现更多商业能力',
        body: '这里展示店铺为你开放的工具、服务和专属权益。',
    },
    en: {
        title: 'Discover more business capabilities',
        body: 'Explore tools, services, and benefits enabled by this store.',
    },
};

export function BusinessServicesCopyModule() {
    const { hasAnyPermission } = useAdminPermissions();
    const query = useQuery<StorefrontContentResult>(STOREFRONT_CONTENT_QUERY, {});
    const source = query.data?.storefrontContentBlocks.find(
        block => block.type === 'CLIENT_PLUGINS' && block.code === BLOCK_CODE,
    );
    const channel = query.data?.activeChannel;
    const consistent = channel && (!getActiveChannelToken() || channel.token === getActiveChannelToken());
    const canEdit = Boolean(
        consistent &&
        !query.loading &&
        !query.error &&
        hasAnyPermission([source ? 'UpdateStorefrontContent' : 'CreateStorefrontContent']),
    );
    const sourceSignature = channel
        ? `${channel.id}:${source ? `${source.id}:${source.updatedAt}` : 'empty'}`
        : '';
    const serverDraft = useServerDraft<StorefrontContentBlock>(
        channel?.id ?? '',
        sourceSignature,
        sourceSignature ? copyDraft(source) : null,
    );
    const { draft, setDraft, dirty, sourceChanged, baseline: originalDraft } = serverDraft;
    const [mobileView, setMobileView] = useState<StorefrontMobileView>('edit');
    const [previewLanguage, setPreviewLanguage] = useState<Language>('zh_Hans');
    const [notice, setNotice] = useState('');
    const [error, setError] = useState('');
    const [reviewedImageKey, setReviewedImageKey] = useState<string | null>(null);
    const [create, createState] = useMutation<{ createStorefrontContentBlock: StorefrontContentBlock }>(
        CREATE_STOREFRONT_BLOCK_MUTATION,
    );
    const [update, updateState] = useMutation<{ updateStorefrontContentBlock: StorefrontContentBlock }>(
        UPDATE_STOREFRONT_BLOCK_MUTATION,
    );
    const imageChanges = source && draft ? imageReplacements(source, draft) : [];
    const imageReviewKey = `${sourceSignature}:${JSON.stringify(imageChanges)}`;
    const imagesConfirmed = imageChanges.length === 0 || reviewedImageKey === imageReviewKey;
    /* oxlint-disable react/set-state-in-effect -- A new source version or image selection requires fresh review. */
    useLayoutEffect(() => setReviewedImageKey(null), [imageReviewKey]);
    /* oxlint-enable react/set-state-in-effect */
    const linkValue = draft ? businessServicesLinkValue(draft) : '';
    const linkIsValid = businessServicesLinkIsValid(linkValue);

    const valid = Boolean(
        draft &&
        linkIsValid &&
        (['zh_Hans'] as const).every(language => {
            const translation = getTranslation(draft, language);
            return translation.title.trim() && translation.body.trim();
        }),
    );
    const [verifying, setVerifying] = useState(false);
    const pending = verifying || createState.loading || updateState.loading;

    const change = (languageCode: Language, key: 'title' | 'body', value: string) =>
        setDraft(current =>
            current
                ? {
                      ...current,
                      settings: {
                          ...(current.settings ?? {}),
                          businessServicesCopyVersion: COPY_VERSION,
                      },
                      translations: current.translations.map(translation =>
                          translation.languageCode === languageCode
                              ? { ...translation, [key]: value }
                              : translation,
                      ),
                  }
                : current,
        );

    const changeLink = (value: string) =>
        setDraft(current =>
            current
                ? updateBusinessServicesLink(
                      {
                          ...current,
                          settings: {
                              ...(current.settings ?? {}),
                              businessServicesCopyVersion: COPY_VERSION,
                          },
                      },
                      value,
                  )
                : current,
        );

    const save = async () => {
        if (!draft || !valid || !canEdit || pending || sourceChanged || !channel || !imagesConfirmed) return;
        const activeToken = getActiveChannelToken();
        const stillCurrent = () => getActiveChannelToken() === activeToken;
        const context = channelRequestContext(channel.token);
        setError('');
        setNotice('');
        setVerifying(true);
        try {
            const input = storefrontBlockInput(
                { ...draft, enabled: true },
                originalDraft ?? undefined,
                imageChanges.length > 0 && imagesConfirmed,
            );
            let saved: StorefrontContentBlock;
            if (draft.id) {
                if (!draft.updatedAt) throw new Error('缺少内容版本，请刷新后重试');
                const response = await update({
                    context,
                    variables: { input: { id: draft.id, expectedUpdatedAt: draft.updatedAt, ...input } },
                });
                saved = verifySavedBlock(response.data?.updateStorefrontContentBlock, {
                    id: draft.id,
                    ...input,
                });
            } else {
                const response = await create({ context, variables: { input } });
                saved = verifySavedBlock(response.data?.createStorefrontContentBlock, input);
            }
            if (!stillCurrent()) return;
            const refreshed = verifyContentChannel((await query.refetch()).data, channel.id);
            if (!stillCurrent()) return;
            const savedBlock = verifySavedBlock(
                refreshed.storefrontContentBlocks.find(block => block.id === saved.id),
                { id: saved.id, ...input },
                saved,
            );
            const savedDraft = copyDraft(savedBlock);
            serverDraft.accept(savedDraft, `${channel.id}:${savedBlock.id}:${savedBlock.updatedAt}`);
            setNotice('已保存到当前店铺，并重新读取核对；中文文案将按翻译设置同步。');
        } catch (cause) {
            if (!stillCurrent()) return;
            setNotice('');
            setError(toUserFacingError(cause, '商业服务页文案保存失败'));
        } finally {
            setVerifying(false);
        }
    };
    const preview = draft ? getTranslation(draft, previewLanguage) : defaults[previewLanguage];
    const previewImage = draft?.imageAsset?.preview || draft?.imageUrl;

    return (
        <div className="flex h-full flex-col bg-slate-50">
            {sourceChanged && <DraftUpdateNotice onReload={serverDraft.reload} />}
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
                <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                            <Sparkles className="h-5 w-5 text-violet-600" />
                            商业服务页文案
                            <FeatureHelpButton
                                topic="storefront.business-copy"
                                title="商业服务页文案"
                                description="编辑商业服务页顶部卡片的文案、配图与跳转链接"
                            />
                        </h1>
                        <p className="mt-1 text-xs text-slate-500">
                            当前店铺：
                            {query.data ? getChannelDisplayName(query.data.activeChannel) : '读取中'}
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <AdminButton
                            refreshPage
                            type="button"
                            onClick={() => void query.refetch()}
                            disabled={query.loading}
                            className={secondaryButton}
                        >
                            <RefreshCw
                                className={`h-4 w-4 ${query.loading && !query.data ? 'animate-spin' : ''}`}
                            />
                            刷新
                        </AdminButton>
                        {canEdit && (
                            <AdminButton
                                type="button"
                                onClick={() => void save()}
                                disabled={!dirty || !valid || pending || sourceChanged || !imagesConfirmed}
                                className={primaryButton}
                            >
                                <Save className="h-4 w-4" />
                                {pending ? '保存中…' : '保存并发布'}
                            </AdminButton>
                        )}
                    </div>
                </div>
            </header>
            <main className="mx-auto w-full max-w-none min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                {notice && <Message tone="success" message={notice} />}
                {error && <Message tone="error" message={error} />}
                {query.loading && !draft ? (
                    <State label="正在读取页面文案…" />
                ) : query.error || !draft ? (
                    <State tone="error" label="页面文案加载失败" action={() => void query.refetch()} />
                ) : (
                    <div className="grid content-start items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
                        <StorefrontMobileViewSwitch value={mobileView} onChange={setMobileView} />
                        <section
                            className={`min-w-0 space-y-3 rounded-xl border border-slate-200 bg-white p-4 ${mobileView === 'edit' ? '' : 'hidden xl:block'}`}
                        >
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <h2 className="flex items-center gap-2 text-sm font-bold">
                                        页面顶部文案
                                        <FeatureHelpButton
                                            topic="storefront.business-copy"
                                            title="页面顶部文案"
                                            description={
                                                '保留同一配置块中的客户端插件与排序，可更新页面文案、电脑端配图与跳转链接。'
                                            }
                                        />
                                    </h2>
                                </div>
                                {canEdit && (
                                    <AdminButton
                                        type="button"
                                        onClick={() =>
                                            setDraft(current =>
                                                current
                                                    ? {
                                                          ...current,
                                                          targetType: 'NONE',
                                                          targetValue: null,
                                                          translations: normalizedTranslations([]),
                                                      }
                                                    : current,
                                            )
                                        }
                                        className={`${secondaryButton} shrink-0`}
                                    >
                                        <RotateCcw className="h-3.5 w-3.5" />
                                        恢复默认
                                    </AdminButton>
                                )}
                            </div>
                            <label className="flex items-center gap-3 text-xs font-semibold text-slate-700">
                                <span className="shrink-0">编辑语言</span>
                                <AdminSelect
                                    aria-label="编辑语言"
                                    value={previewLanguage}
                                    onChange={event => setPreviewLanguage(event.target.value as Language)}
                                    className={inputClass}
                                >
                                    <option value="zh_Hans">中文</option>
                                    <option value="en">英文</option>
                                </AdminSelect>
                            </label>
                            {(['zh_Hans', 'en'] as const).map(language => {
                                const translation = getTranslation(draft, language);
                                const zh = language === 'zh_Hans';
                                return (
                                    <div
                                        key={language}
                                        hidden={language !== previewLanguage}
                                        className="space-y-3"
                                    >
                                        <strong className="text-xs">{zh ? '中文' : '英文'}</strong>
                                        <Field label={`标题 ${translation.title.length}/${zh ? 40 : 80}`}>
                                            <AdminInput
                                                value={translation.title}
                                                maxLength={zh ? 40 : 80}
                                                disabled={!canEdit}
                                                onChange={event =>
                                                    change(language, 'title', event.target.value)
                                                }
                                                className={inputClass}
                                            />
                                        </Field>
                                        <Field label={`说明 ${translation.body.length}/200`}>
                                            <AdminTextArea
                                                value={translation.body}
                                                maxLength={200}
                                                rows={2}
                                                disabled={!canEdit}
                                                onChange={event =>
                                                    change(language, 'body', event.target.value)
                                                }
                                                className={inputClass}
                                            />
                                        </Field>
                                    </div>
                                );
                            })}
                        </section>
                        <div className="min-w-0 space-y-3 lg:sticky lg:top-0">
                            <section
                                className={`min-w-0 rounded-xl border border-slate-200 bg-white p-4 ${mobileView === 'preview' ? '' : 'hidden xl:block'}`}
                            >
                                <div className="flex items-center justify-between">
                                    <h2 className="flex items-center gap-2 text-sm font-bold">
                                        前台预览
                                        <FeatureHelpButton
                                            topic="storefront.business-copy"
                                            title="商业服务页前台预览"
                                        />
                                    </h2>
                                    <AdminSelect
                                        value={previewLanguage}
                                        onChange={event => setPreviewLanguage(event.target.value as Language)}
                                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                                    >
                                        <option value="zh_Hans">中文</option>
                                        <option value="en">英文</option>
                                    </AdminSelect>
                                </div>
                                <div
                                    className={`relative isolate mt-5 grid gap-5 overflow-hidden rounded-2xl bg-gradient-to-br from-slate-950 to-violet-950 p-7 text-white shadow-lg ${previewImage ? 'sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] sm:items-center' : ''}`}
                                >
                                    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_fit-content(45%)] items-start gap-3 [overflow-wrap:anywhere]">
                                        <h3 className="text-2xl font-bold leading-tight">
                                            {preview.title || '—'}
                                        </h3>
                                        {linkValue.trim() && linkIsValid ? (
                                            <span className="col-start-2 row-start-1 inline-flex min-h-11 items-center justify-self-end gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-white">
                                                {preview.ctaLabel?.trim() ||
                                                    (previewLanguage === 'zh_Hans'
                                                        ? '打开服务网站'
                                                        : 'Open service website')}
                                                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                                            </span>
                                        ) : null}
                                        <p className="col-span-full text-sm leading-6 text-slate-300">
                                            {preview.body || '—'}
                                        </p>
                                    </div>
                                    {previewImage && (
                                        <img
                                            src={previewImage}
                                            alt="商业服务页首配图预览"
                                            className="h-40 w-full rounded-xl object-contain sm:h-[200px]"
                                        />
                                    )}
                                </div>
                            </section>
                            <section
                                className={`min-w-0 space-y-3 rounded-xl border border-slate-200 bg-white p-4 ${mobileView === 'edit' ? '' : 'hidden xl:block'}`}
                            >
                                {' '}
                                <fieldset disabled={!canEdit || pending} className="space-y-2">
                                    <AssetPicker
                                        label="电脑端商业服务页首配图"
                                        value={draft.imageAsset}
                                        fallbackUrl={draft.imageUrl}
                                        onChange={asset =>
                                            setDraft(current =>
                                                current
                                                    ? {
                                                          ...current,
                                                          imageAsset: asset,
                                                          imageAssetId: asset?.id ?? null,
                                                          imageUrl: null,
                                                      }
                                                    : current,
                                            )
                                        }
                                    />
                                    <p className="text-xs leading-5 text-slate-500">
                                        图片显示在电脑端卡片右侧，手机端沿用原布局。建议选用主体清晰的横图。
                                    </p>
                                    {imageChanges.length > 0 && (
                                        <label className="flex items-start gap-2 text-xs leading-5 text-amber-900">
                                            <AdminInput
                                                type="checkbox"
                                                checked={imagesConfirmed}
                                                onChange={event =>
                                                    setReviewedImageKey(
                                                        event.target.checked ? imageReviewKey : null,
                                                    )
                                                }
                                            />
                                            我确认将当前已设置的商业服务页配图替换或清除
                                        </label>
                                    )}
                                </fieldset>
                                <div className="space-y-2 border-t border-slate-200 pt-3">
                                    <Field label="跳转链接地址（可选）">
                                        <AdminInput
                                            type="url"
                                            inputMode="url"
                                            autoComplete="url"
                                            value={linkValue}
                                            maxLength={2048}
                                            disabled={!canEdit}
                                            placeholder="https://example.com/services"
                                            aria-invalid={!linkIsValid}
                                            onChange={event => changeLink(event.target.value)}
                                            className={inputClass}
                                        />
                                    </Field>
                                    <p className="text-xs leading-5 text-slate-500">
                                        支持站内路径（如 /promotions）或完整的 HTTP(S)
                                        网址；填写后前台卡片会显示访问入口。
                                    </p>
                                    {!linkIsValid && (
                                        <p role="alert" className="text-xs font-medium text-rose-700">
                                            请输入有效的站内路径或 HTTP(S) 网址。
                                        </p>
                                    )}
                                </div>
                            </section>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}

function copyDraft(source?: StorefrontContentBlock): StorefrontContentBlock {
    if (source) {
        return {
            ...source,
            imageAssetId: source.imageAsset?.id ?? source.imageAssetId ?? null,
            settings: { ...(source.settings ?? {}), businessServicesCopyVersion: COPY_VERSION },
            translations: normalizedTranslations(source.translations),
            items: [...source.items],
        };
    }
    return {
        code: BLOCK_CODE,
        internalName: '客户端插件配置',
        type: 'CLIENT_PLUGINS',
        layoutVariant: 'CUSTOM',
        enabled: true,
        position: 10_001,
        startsAt: null,
        endsAt: null,
        imageAsset: null,
        imageAssetId: null,
        imageUrl: null,
        backgroundColor: null,
        textColor: null,
        targetType: 'NONE',
        targetValue: null,
        settings: { version: 1, page: 'category', businessServicesCopyVersion: COPY_VERSION },
        translations: normalizedTranslations([]),
        items: [],
    };
}

function normalizedTranslations(values: StorefrontContentBlock['translations']) {
    return (['zh_Hans', 'en'] as const).map(languageCode => ({
        languageCode,
        subtitle: '',
        ctaLabel: '',
        ...defaults[languageCode],
        ...values.find(item => item.languageCode === languageCode),
    }));
}

function getTranslation(block: StorefrontContentBlock, languageCode: Language) {
    return (
        block.translations.find(item => item.languageCode === languageCode) ?? {
            languageCode,
            subtitle: '',
            ctaLabel: '',
            ...defaults[languageCode],
        }
    );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <AdminField className="block text-xs font-bold text-slate-700" label={label}>
            <span className="mt-1.5 block">{children}</span>
        </AdminField>
    );
}

function Message({ tone, message }: { tone: 'success' | 'error'; message: string }) {
    return (
        <div
            role={tone === 'error' ? 'alert' : 'status'}
            className={`rounded-lg border p-3 text-xs ${tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}
        >
            {message}
        </div>
    );
}

function State({
    label,
    tone = 'default',
    action,
}: {
    label: string;
    tone?: 'default' | 'error';
    action?: () => void;
}) {
    return (
        <div
            role={tone === 'error' ? 'alert' : 'status'}
            className={`rounded-xl border p-10 text-center text-xs ${tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-slate-200 bg-white text-slate-500'}`}
        >
            {label}
            {action && (
                <AdminButton type="button" onClick={action} className="ml-3 font-bold underline">
                    重试
                </AdminButton>
            )}
        </div>
    );
}

const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal disabled:bg-slate-50 disabled:text-slate-500';
const primaryButton =
    'inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40';
const secondaryButton =
    'inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-40';
