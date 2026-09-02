import { useMutation, useQuery } from '@apollo/client/react';
import { RefreshCw, RotateCcw, Save, Sparkles } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import {
    CREATE_STOREFRONT_BLOCK_MUTATION,
    STOREFRONT_CONTENT_QUERY,
    UPDATE_STOREFRONT_BLOCK_MUTATION,
    type StorefrontContentBlock,
    type StorefrontContentResult,
} from '../../graphql/storefront.graphql';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { getChannelDisplayName } from '../../utils/channel-display';
import { toUserFacingError } from '../../utils/user-facing-error';
import { storefrontBlockInput } from './storefront-content-utils';

const BLOCK_CODE = 'storefront-client-plugins';
const COPY_VERSION = 1;
type Language = 'zh_Hans' | 'en';

const defaults: Record<Language, { title: string; body: string }> = {
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
    const canEdit = hasAnyPermission(['UpdateStorefrontContent', 'UpdateSettings']);
    const query = useQuery<StorefrontContentResult>(STOREFRONT_CONTENT_QUERY, {
        fetchPolicy: 'cache-and-network',
    });
    const [draft, setDraft] = useState<StorefrontContentBlock | null>(null);
    const [signature, setSignature] = useState('');
    const [previewLanguage, setPreviewLanguage] = useState<Language>('zh_Hans');
    const [notice, setNotice] = useState('');
    const [error, setError] = useState('');
    const [create, createState] = useMutation(CREATE_STOREFRONT_BLOCK_MUTATION);
    const [update, updateState] = useMutation(UPDATE_STOREFRONT_BLOCK_MUTATION);
    const source = query.data?.storefrontContentBlocks.find(
        block => block.type === 'CLIENT_PLUGINS' && block.code === BLOCK_CODE,
    );
    const sourceSignature = source ? `${source.id}:${source.updatedAt}` : query.data ? 'empty' : '';

    /* oxlint-disable react/set-state-in-effect -- GraphQL result is the versioned draft source. */
    useEffect(() => {
        if (!sourceSignature || sourceSignature === signature) return;
        setDraft(copyDraft(source));
        setSignature(sourceSignature);
    }, [signature, source, sourceSignature]);
    /* oxlint-enable react/set-state-in-effect */

    const dirty = Boolean(draft && JSON.stringify(draft) !== JSON.stringify(copyDraft(source)));
    const valid = Boolean(
        draft &&
        (['zh_Hans', 'en'] as const).every(language => {
            const translation = getTranslation(draft, language);
            return translation.title.trim() && translation.body.trim();
        }),
    );
    const pending = createState.loading || updateState.loading;

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

    const save = async () => {
        if (!draft || !valid || !canEdit) return;
        setError('');
        try {
            if (draft.id) {
                if (!draft.updatedAt) throw new Error('缺少内容版本，请刷新后重试');
                await update({
                    variables: {
                        input: {
                            id: draft.id,
                            expectedUpdatedAt: draft.updatedAt,
                            ...storefrontBlockInput(draft),
                        },
                    },
                });
            } else {
                await create({ variables: { input: storefrontBlockInput(draft) } });
            }
            setNotice('商业服务页文案已保存并发布');
            await query.refetch();
        } catch (cause) {
            setNotice('');
            setError(toUserFacingError(cause, '商业服务页文案保存失败'));
        }
    };
    const preview = draft ? getTranslation(draft, previewLanguage) : defaults[previewLanguage];

    return (
        <div className="flex h-full flex-col bg-slate-50">
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
                <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                            <Sparkles className="h-5 w-5 text-violet-600" />
                            商业服务页文案
                        </h1>
                        <p className="mt-1 text-xs text-slate-500">
                            编辑商业服务页顶部卡片的中英文标题与说明 · 当前店铺{' '}
                            {query.data ? getChannelDisplayName(query.data.activeChannel.code) : '读取中'}
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => void query.refetch()}
                            disabled={query.loading}
                            className={secondaryButton}
                        >
                            <RefreshCw className={`h-4 w-4 ${query.loading ? 'animate-spin' : ''}`} />
                            刷新
                        </button>
                        {canEdit && (
                            <button
                                type="button"
                                onClick={() => void save()}
                                disabled={!dirty || !valid || pending}
                                className={primaryButton}
                            >
                                <Save className="h-4 w-4" />
                                {pending ? '保存中…' : '保存并发布'}
                            </button>
                        )}
                    </div>
                </div>
            </header>
            <main className="mx-auto w-full max-w-6xl flex-1 space-y-4 overflow-y-auto p-5 sm:p-8">
                {notice && <Message tone="success" message={notice} />}
                {error && <Message tone="error" message={error} />}
                {query.loading && !draft ? (
                    <State label="正在读取页面文案…" />
                ) : query.error || !draft ? (
                    <State tone="error" label="页面文案加载失败" action={() => void query.refetch()} />
                ) : (
                    <div className="grid gap-5 lg:grid-cols-[1fr_0.8fr]">
                        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <h2 className="text-sm font-bold">页面顶部文案</h2>
                                    <p className="mt-1 text-xs text-slate-500">
                                        保留同一配置块中的客户端插件与排序，只更新页面文案。
                                    </p>
                                </div>
                                {canEdit && (
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setDraft(current =>
                                                current
                                                    ? { ...current, translations: normalizedTranslations([]) }
                                                    : current,
                                            )
                                        }
                                        className={secondaryButton}
                                    >
                                        <RotateCcw className="h-3.5 w-3.5" />
                                        恢复默认
                                    </button>
                                )}
                            </div>
                            {(['zh_Hans', 'en'] as const).map(language => {
                                const translation = getTranslation(draft, language);
                                const zh = language === 'zh_Hans';
                                return (
                                    <div
                                        key={language}
                                        className="space-y-3 rounded-lg border border-slate-200 p-4"
                                    >
                                        <strong className="text-xs">{zh ? '中文' : 'English'}</strong>
                                        <Field label={`标题 ${translation.title.length}/${zh ? 40 : 80}`}>
                                            <input
                                                value={translation.title}
                                                maxLength={zh ? 40 : 80}
                                                disabled={!canEdit}
                                                onChange={event =>
                                                    change(language, 'title', event.target.value)
                                                }
                                                className={inputClass}
                                            />
                                        </Field>
                                        <Field label={`说明 ${translation.body.length}/${zh ? 100 : 180}`}>
                                            <textarea
                                                value={translation.body}
                                                maxLength={zh ? 100 : 180}
                                                rows={4}
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
                        <section className="rounded-xl border border-slate-200 bg-white p-5">
                            <div className="flex items-center justify-between">
                                <h2 className="text-sm font-bold">前台预览</h2>
                                <select
                                    value={previewLanguage}
                                    onChange={event => setPreviewLanguage(event.target.value as Language)}
                                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                                >
                                    <option value="zh_Hans">中文</option>
                                    <option value="en">English</option>
                                </select>
                            </div>
                            <div className="mt-5 rounded-2xl bg-gradient-to-br from-slate-950 to-violet-950 p-7 text-white shadow-lg">
                                <span className="text-[10px] font-bold uppercase tracking-[0.24em] text-violet-300">
                                    Business services
                                </span>
                                <h3 className="mt-4 text-2xl font-bold leading-tight">
                                    {preview.title || '—'}
                                </h3>
                                <p className="mt-3 text-sm leading-6 text-slate-300">{preview.body || '—'}</p>
                            </div>
                        </section>
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
        <label className="block text-xs font-bold text-slate-700">
            {label}
            <span className="mt-1.5 block">{children}</span>
        </label>
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
                <button type="button" onClick={action} className="ml-3 font-bold underline">
                    重试
                </button>
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
