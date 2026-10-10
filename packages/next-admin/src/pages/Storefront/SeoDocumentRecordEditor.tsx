import type { ApolloCache, DocumentNode } from '@apollo/client';
import { useMutation } from '@apollo/client/react';
import { Save, Send } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
    StorefrontSeoDocument,
    StorefrontSeoIdentity,
    StorefrontSeoSettings,
} from '../../../../store-management-plugin/src/seo/storefront-seo.contract';
import { channelRequestContext, getAdminQueryScope } from '../../apollo';
import { AdminButton } from '../../components/AdminControls';
import { DraftUpdateNotice } from '../../components/DraftUpdateNotice';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import {
    PUBLISH_STOREFRONT_SEO_RECORD,
    RESTORE_STOREFRONT_SEO_REVISION,
    SAVE_STOREFRONT_SEO_DRAFT,
    STOREFRONT_SEO_HISTORY,
    UNPUBLISH_STOREFRONT_SEO_RECORD,
    type StorefrontSeoRecord,
    type StorefrontSeoRevision,
} from '../../graphql/storefront-seo.graphql';
import { useAdminQuery } from '../../hooks/use-admin-query';
import { useServerDraft } from '../../hooks/use-server-draft';
import { refreshAfterAdminWrite } from '../../utils/admin-write-readback';
import { toUserFacingError } from '../../utils/user-facing-error';
import { SeoDocumentFields, SeoPublishedPreview } from './SeoDocumentFields';
import { normalizeSeoDraft, seoDate, seoIdentityKey } from './storefront-seo-utils';

/** Shared entity editor; hosts supply their own authorized identity query, never the full workspace. */
export function SeoDocumentRecordEditor({
    record,
    channelToken,
    canWrite,
    sourceQuery,
    onRefresh,
    settings,
    publicOrigin,
    onDirtyChange,
}: {
    record: StorefrontSeoRecord;
    channelToken: string;
    canWrite: boolean;
    sourceQuery: DocumentNode;
    onRefresh: () => Promise<unknown>;
    settings?: StorefrontSeoSettings | null;
    publicOrigin?: string;
    onDirtyChange?: (dirty: boolean) => void;
}) {
    const identity = {
        targetType: record.targetType,
        targetId: record.targetId,
        languageCode: record.languageCode,
    } as StorefrontSeoIdentity;
    const contextKey = `${getAdminQueryScope()}:${seoIdentityKey(identity)}`;
    const currentKey = useRef(contextKey);
    useLayoutEffect(() => {
        currentKey.current = contextKey;
    }, [contextKey]);
    const draft = useServerDraft<StorefrontSeoDocument>(
        contextKey,
        String(record.version),
        record.draft as StorefrontSeoDocument,
    );
    useEffect(() => {
        onDirtyChange?.(draft.dirty);
        return () => onDirtyChange?.(false);
    }, [draft.dirty, onDirtyChange]);
    const [historyState, setHistoryState] = useState('');
    const showHistory = historyState === contextKey;
    const history = useAdminQuery<{ storefrontSeoHistory: StorefrontSeoRevision[] }>(STOREFRONT_SEO_HISTORY, {
        variables: { input: identity },
        skip: !showHistory,
        context: channelRequestContext(channelToken),
    });
    const options = { context: channelRequestContext(channelToken) };
    const [save, saveState] = useMutation<{ saveStorefrontSeoDraft: StorefrontSeoRecord }>(
        SAVE_STOREFRONT_SEO_DRAFT,
        options,
    );
    const [publish, publishState] = useMutation<{ publishStorefrontSeoRecord: StorefrontSeoRecord }>(
        PUBLISH_STOREFRONT_SEO_RECORD,
        options,
    );
    const [unpublish, unpublishState] = useMutation<{ unpublishStorefrontSeoRecord: StorefrontSeoRecord }>(
        UNPUBLISH_STOREFRONT_SEO_RECORD,
        options,
    );
    const [restore, restoreState] = useMutation<{ restoreStorefrontSeoRevision: StorefrontSeoRecord }>(
        RESTORE_STOREFRONT_SEO_REVISION,
        options,
    );
    const busy = saveState.loading || publishState.loading || unpublishState.loading || restoreState.loading;
    const editable = record.canWrite && canWrite;
    const blocked = !editable || busy || draft.sourceChanged || !draft.draft;
    const [feedback, setFeedback] = useState({ key: '', error: '', notice: '' });
    const status = feedback.key === contextKey ? feedback : { error: '', notice: '' };
    const lock = useRef(false);
    const mergeReceipt = (cache: ApolloCache, result: { data?: unknown }) => {
        if (currentKey.current !== contextKey) return;
        const receipt = Object.values((result.data ?? {}) as Record<string, unknown>)[0] as
            StorefrontSeoRecord | undefined;
        if (!receipt || receipt.channelId !== record.channelId) return;
        cache.updateQuery<{ storefrontSeoRecord: StorefrontSeoRecord }>(
            { query: sourceQuery, variables: { input: identity } },
            previous => (previous ? { ...previous, storefrontSeoRecord: receipt } : previous),
        );
    };
    const perform = async (kind: 'save' | 'publish' | 'unpublish' | 'restore', revision?: number) => {
        if (blocked || lock.current || !draft.draft) return;
        if (kind !== 'save' && draft.dirty) return;
        if (kind === 'unpublish' && !window.confirm('撤回后采用继承设置；文章会停止公开。确定撤回吗？'))
            return;
        if (kind === 'restore' && !window.confirm('历史发布内容将恢复为新草稿，仍需单独发布。继续吗？'))
            return;
        const started = contextKey;
        lock.current = true;
        setFeedback({ key: started, error: '', notice: '' });
        try {
            const input = { ...identity, expectedVersion: record.version };
            const response =
                kind === 'save'
                    ? await save({
                          variables: { input: { ...input, draft: normalizeSeoDraft(draft.draft) } },
                          update: mergeReceipt,
                      })
                    : kind === 'publish'
                      ? await publish({ variables: { input }, update: mergeReceipt })
                      : kind === 'unpublish'
                        ? await unpublish({ variables: { input }, update: mergeReceipt })
                        : await restore({
                              variables: { input: { ...input, revision } },
                              update: mergeReceipt,
                          });
            const receipt = Object.values(response.data ?? {})[0] as StorefrontSeoRecord | undefined;
            if (!receipt) throw new Error('服务端未返回页面配置。');
            if (currentKey.current !== started) return;
            draft.accept(receipt.draft as StorefrontSeoDocument, String(receipt.version));
            setFeedback({
                key: started,
                error: '',
                notice:
                    kind === 'save'
                        ? '页面草稿已保存，公开页面继续使用已发布版本。'
                        : kind === 'publish'
                          ? '页面配置已发布；实际网站上线状态以公开响应为准。'
                          : kind === 'restore'
                            ? '历史版本已恢复为草稿，尚未发布。'
                            : '页面配置已撤回。',
            });
            await refreshAfterAdminWrite(
                async () => {
                    await onRefresh();
                    if (showHistory) await history.refetch();
                },
                message => setFeedback({ key: started, error: message, notice: '' }),
                () => currentKey.current === started,
            );
        } catch (error) {
            if (currentKey.current === started)
                setFeedback({ key: started, error: toUserFacingError(error), notice: '' });
        } finally {
            lock.current = false;
        }
    };
    return (
        <div className="space-y-4" data-seo-document-editor>
            <div className="flex flex-wrap gap-3 text-sm text-slate-500">
                <span>
                    草稿版本 {record.version}
                    {draft.dirty ? ' · 未保存修改' : ''}
                </span>
                <span>公开版本 {record.publishedVersion || '无'}</span>
                <span>发布时间：{seoDate(record.publishedAt)}</span>
                {!editable && <span>只读</span>}
            </div>
            {draft.sourceChanged && <DraftUpdateNotice onReload={draft.reload} />}
            {status.error && (
                <div role="alert" className="admin-page-status" data-failed>
                    {status.error}
                </div>
            )}
            {status.notice && (
                <div role="status" className="admin-page-status">
                    {status.notice}
                </div>
            )}
            {draft.draft && (
                <SeoDocumentFields
                    value={draft.draft}
                    onChange={draft.setDraft}
                    article={record.targetType === 'ARTICLE'}
                    disabled={!editable || busy}
                />
            )}
            <div className="flex flex-wrap gap-2">
                <AdminButton
                    disabled={blocked || !draft.dirty}
                    onClick={() => void perform('save')}
                    className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium disabled:opacity-50 bg-slate-900 text-white"
                    aria-busy={saveState.loading}
                >
                    <Save size={16} />
                    保存草稿
                </AdminButton>
                <AdminButton
                    className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium disabled:opacity-50 text-slate-600 hover:bg-slate-100"
                    disabled={blocked || draft.dirty}
                    onClick={() => void perform('publish')}
                    aria-busy={publishState.loading}
                >
                    <Send size={16} />
                    发布已保存版本
                </AdminButton>
                <AdminButton
                    className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium disabled:opacity-50 text-slate-600 hover:bg-slate-100"
                    disabled={blocked || draft.dirty || !record.published}
                    onClick={() => void perform('unpublish')}
                >
                    撤回公开版本
                </AdminButton>
                <AdminButton
                    className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium disabled:opacity-50 text-slate-600 hover:bg-slate-100"
                    disabled={busy}
                    onClick={() => setHistoryState(showHistory ? '' : contextKey)}
                >
                    {showHistory ? '收起历史' : '发布历史'}
                </AdminButton>
            </div>
            <SeoPublishedPreview record={record} settings={settings} publicOrigin={publicOrigin} />
            {showHistory && (
                <div className="space-y-2">
                    <h2 className="flex items-center gap-2 font-semibold">
                        发布历史
                        <FeatureHelpButton
                            title="发布历史"
                            content={{
                                purpose: '查看本店的发布版本和时间，选择历史版本恢复到草稿。',
                                requirements: [
                                    '核对当前店铺、语言与相应权限',
                                    '使用真实内容和可追溯证据，缺项保留待核验',
                                ],
                                example: '恢复一个历史版本后核对草稿，再决定是否发布。',
                                impact: '保存草稿与发布分开；搜索收录、排名与 AI 引用以实际外部结果为准。',
                            }}
                        />
                    </h2>
                    {history.loading && !history.data && <p role="status">正在读取历史…</p>}
                    {history.error && (
                        <div role="alert" className="admin-page-status" data-failed>
                            <span>{toUserFacingError(history.error)}</span>
                            <AdminButton
                                className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium disabled:opacity-50 text-slate-600 hover:bg-slate-100"
                                onClick={() => void history.refetch()}
                            >
                                重试历史
                            </AdminButton>
                        </div>
                    )}
                    {history.data?.storefrontSeoHistory.length === 0 && (
                        <p className="text-sm text-slate-500">尚无发布历史。</p>
                    )}
                    {history.data?.storefrontSeoHistory.map(item => (
                        <div key={item.id} className="flex flex-wrap items-center gap-3 text-sm">
                            <span>
                                版本 {item.version} · {seoDate(item.publishedAt)} · {item.publishedBy}
                            </span>
                            {item.payload ? (
                                <AdminButton
                                    className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium disabled:opacity-50 text-slate-600 hover:bg-slate-100"
                                    disabled={blocked || draft.dirty}
                                    onClick={() => void perform('restore', item.version)}
                                >
                                    恢复为草稿
                                </AdminButton>
                            ) : (
                                <span>撤回记录</span>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
