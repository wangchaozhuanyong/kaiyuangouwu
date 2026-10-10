import type { ApolloCache } from '@apollo/client';
import { useMutation } from '@apollo/client/react';
import { ExternalLink, RefreshCw, Save, Send } from 'lucide-react';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    defaultStorefrontSeoSettings,
    storefrontSeoPageKeys,
    type StorefrontSeoIdentity,
    type StorefrontSeoPayload,
    type StorefrontSeoSettings,
    type StorefrontSeoTargetType,
} from '../../../../store-management-plugin/src/seo/storefront-seo.contract';
import { channelRequestContext, getActiveChannelToken, getAdminQueryScope } from '../../apollo';
import { AdminButton, AdminInput, AdminSelect, AdminTextArea } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { DraftUpdateNotice } from '../../components/DraftUpdateNotice';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import {
    PUBLISH_STOREFRONT_SEO_RECORD,
    RESTORE_STOREFRONT_SEO_REVISION,
    SAVE_STOREFRONT_SEO_DRAFT,
    STOREFRONT_SEO_HISTORY,
    STOREFRONT_SEO_RECORD,
    STOREFRONT_SEO_WORKSPACE,
    UNPUBLISH_STOREFRONT_SEO_RECORD,
    type StorefrontSeoRecord,
    type StorefrontSeoRevision,
    type StorefrontSeoWorkspace,
} from '../../graphql/storefront-seo.graphql';
import {
    STOREFRONT_PREVIEW_DOMAINS_QUERY,
    type StorefrontPreviewDomainsResult,
} from '../../graphql/storefront.graphql';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { useAdminQuery } from '../../hooks/use-admin-query';
import { useServerDraft } from '../../hooks/use-server-draft';
import { useStandaloneAdminPage } from '../../hooks/use-standalone-admin-page';
import { refreshAfterAdminWrite } from '../../utils/admin-write-readback';
import { toUserFacingError } from '../../utils/user-facing-error';
import { SeoDocumentRecordEditor } from './SeoDocumentRecordEditor';
import {
    lines,
    normalizeSeoDraft,
    SEO_TARGET_LABELS,
    seoDate,
    seoEvidenceSummary,
    seoIdentityKey,
    seoLocalDateTime,
    seoStatusLabel,
} from './storefront-seo-utils';
import { SeoPlatformFields, SeoRedirectFields } from './StorefrontSeoEvidenceFields';

const settingsIdentity: StorefrontSeoIdentity = {
    targetType: 'SETTINGS',
    targetId: 'store',
    languageCode: 'und',
};
const acceptedTargets: StorefrontSeoTargetType[] = ['HOME', 'PRODUCT', 'COLLECTION', 'PAGE', 'ARTICLE'];

export function StorefrontSeoModule() {
    const page = useStandaloneAdminPage();
    const section = page?.key ?? 'overview';
    const [params, setParams] = useSearchParams();
    const { hasAnyPermission } = useAdminPermissions();
    const canRead = hasAnyPermission(['ReadStorefrontContent']);
    const workspace = useAdminQuery<{
        activeChannel: { id: string; code: string; token: string };
        storefrontSeoWorkspace: StorefrontSeoWorkspace;
    }>(STOREFRONT_SEO_WORKSPACE, { skip: !canRead });
    const channel = workspace.data?.activeChannel;
    const consistent = Boolean(
        channel &&
        (!getActiveChannelToken() || channel.token === getActiveChannelToken()) &&
        workspace.data?.storefrontSeoWorkspace.channelId === channel.id,
    );
    const state = consistent ? workspace.data?.storefrontSeoWorkspace : undefined;
    const requestedType = params.get('targetType');
    const targetType = (
        acceptedTargets.includes(requestedType as StorefrontSeoTargetType)
            ? requestedType
            : section === 'geo'
              ? 'ARTICLE'
              : 'HOME'
    ) as StorefrontSeoTargetType;
    const targetId =
        params.get('targetId') ??
        (targetType === 'HOME' ? 'home' : targetType === 'PAGE' ? storefrontSeoPageKeys[0] : '');
    const languageCode = params.get('languageCode') === 'en' ? 'en' : 'zh_Hans';
    const isDocument = section === 'pages' || section === 'geo';
    const domains = useAdminQuery<StorefrontPreviewDomainsResult>(STOREFRONT_PREVIEW_DOMAINS_QUERY, {
        variables: { channelId: channel?.id ?? '' },
        skip: !consistent || !isDocument || !hasAnyPermission(['ReadStoreDomain']),
        ...(channel ? { context: channelRequestContext(channel.token) } : {}),
    });
    const primaryDomain = domains.data?.storeDomains.find(
        domain => domain.channel.id === channel?.id && domain.isPrimary && domain.status === 'ACTIVE',
    )?.domain;
    const publicOrigin =
        primaryDomain && /^[a-z0-9.-]+$/iu.test(primaryDomain) ? `https://${primaryDomain}` : undefined;
    const identity: StorefrontSeoIdentity = isDocument
        ? { targetType, targetId, languageCode }
        : settingsIdentity;
    const entityReadable =
        targetType === 'PRODUCT'
            ? hasAnyPermission(['ReadProduct', 'ReadCatalog'])
            : targetType === 'COLLECTION'
              ? hasAnyPermission(['ReadCollection'])
              : true;
    const recordQuery = useAdminQuery<{ storefrontSeoRecord: StorefrontSeoRecord }>(STOREFRONT_SEO_RECORD, {
        variables: { input: identity },
        skip: !consistent || !isDocument || !targetId || !entityReadable,
        ...(channel ? { context: channelRequestContext(channel.token) } : {}),
    });
    const record = isDocument ? recordQuery.data?.storefrontSeoRecord : state?.settings;
    const safeRecord =
        record &&
        record.channelId === channel?.id &&
        seoIdentityKey(record as StorefrontSeoIdentity) === seoIdentityKey(identity)
            ? record
            : undefined;
    const version = safeRecord ? String(safeRecord.version) : '';
    const draft = useServerDraft<StorefrontSeoPayload>(
        `${getAdminQueryScope()}:${seoIdentityKey(identity)}`,
        version,
        isDocument ? null : (safeRecord?.draft ?? null),
    );
    const [showHistory, setShowHistory] = useState(false);
    const history = useAdminQuery<{ storefrontSeoHistory: StorefrontSeoRevision[] }>(STOREFRONT_SEO_HISTORY, {
        variables: { input: identity },
        skip: !safeRecord || !showHistory || isDocument,
        ...(channel ? { context: channelRequestContext(channel.token) } : {}),
    });
    const options = channel ? { context: channelRequestContext(channel.token) } : {};
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
    const contextKey = `${getAdminQueryScope()}:${seoIdentityKey(identity)}`;
    const contextRef = useRef(contextKey);
    useLayoutEffect(() => {
        contextRef.current = contextKey;
    }, [contextKey]);
    const actionLock = useRef(false);
    const documentDirty = useRef(false);
    const trackDocumentDirty = useCallback((dirty: boolean) => {
        documentDirty.current = dirty;
    }, []);
    const [feedback, setFeedback] = useState<{ key: string; error: string; notice: string }>({
        key: '',
        error: '',
        notice: '',
    });
    const currentFeedback = feedback.key === contextKey ? feedback : { error: '', notice: '' };
    const entityWritable =
        targetType === 'PRODUCT'
            ? hasAnyPermission(['UpdateProduct', 'UpdateCatalog'])
            : targetType === 'COLLECTION'
              ? hasAnyPermission(['UpdateCollection'])
              : true;
    const editable = Boolean(
        safeRecord?.canWrite &&
        hasAnyPermission(['UpdateStorefrontContent']) &&
        (!isDocument || entityWritable),
    );
    const disabled = !editable || busy || draft.sourceChanged || !draft.draft || !safeRecord;

    const select = (updates: Record<string, string>) => {
        if (
            (draft.dirty || documentDirty.current) &&
            !window.confirm('切换页面会放弃未保存的修改，确定继续吗？')
        )
            return;
        setParams(
            current => {
                const next = new URLSearchParams(current);
                Object.entries(updates).forEach(([key, value]) =>
                    value ? next.set(key, value) : next.delete(key),
                );
                return next;
            },
            { replace: true },
        );
        setShowHistory(false);
    };
    const update = (next: StorefrontSeoPayload) => draft.setDraft(next);
    const mergeReceipt = (cache: ApolloCache, result: { data?: unknown }) => {
        const receipt = Object.values((result.data ?? {}) as Record<string, unknown>)[0] as
            StorefrontSeoRecord | undefined;
        if (!receipt || receipt.channelId !== channel?.id || contextRef.current !== contextKey) return;
        cache.updateQuery<{ storefrontSeoRecord: StorefrontSeoRecord }>(
            { query: STOREFRONT_SEO_RECORD, variables: { input: identity } },
            () => ({ storefrontSeoRecord: receipt }),
        );
        cache.updateQuery<{
            activeChannel: { id: string; code: string; token: string };
            storefrontSeoWorkspace: StorefrontSeoWorkspace;
        }>({ query: STOREFRONT_SEO_WORKSPACE }, previous => {
            if (!previous || previous.storefrontSeoWorkspace.channelId !== receipt.channelId) return previous;
            const current = previous.storefrontSeoWorkspace;
            return {
                ...previous,
                storefrontSeoWorkspace: {
                    ...current,
                    settings: receipt.targetType === 'SETTINGS' ? receipt : current.settings,
                    documents:
                        receipt.targetType === 'SETTINGS'
                            ? current.documents
                            : [
                                  ...current.documents.filter(
                                      item =>
                                          seoIdentityKey(item as StorefrontSeoIdentity) !==
                                          seoIdentityKey(receipt as StorefrontSeoIdentity),
                                  ),
                                  receipt,
                              ],
                },
            };
        });
    };
    const perform = async (kind: 'save' | 'publish' | 'unpublish' | 'restore', revision?: number) => {
        if (disabled || actionLock.current || !safeRecord || !draft.draft) return;
        if (kind !== 'save' && draft.dirty) {
            setFeedback({
                key: contextKey,
                error: '请先保存草稿，再执行发布、撤回或恢复历史版本。',
                notice: '',
            });
            return;
        }
        if (
            kind === 'unpublish' &&
            !window.confirm('撤回后公开页面将采用继承设置；文章将停止公开。确定撤回吗？')
        )
            return;
        if (
            kind === 'restore' &&
            !window.confirm('此操作把历史发布内容恢复为新草稿，确认后仍需单独发布。继续吗？')
        )
            return;
        actionLock.current = true;
        const started = contextKey;
        setFeedback({ key: started, error: '', notice: '' });
        try {
            const input = { ...identity, expectedVersion: safeRecord.version };
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
            if (!receipt) throw new Error('服务端未返回配置记录。');
            if (contextRef.current !== started) return;
            draft.accept(receipt.draft, String(receipt.version));
            setFeedback({
                key: started,
                error: '',
                notice:
                    kind === 'save'
                        ? '草稿已保存，公开页面继续使用已发布版本。'
                        : kind === 'publish'
                          ? '此版本已发布到配置；网站上线状态以实际部署与公开响应为准。'
                          : kind === 'restore'
                            ? '历史版本已恢复为草稿，尚未发布。'
                            : '已撤回该配置的公开版本。',
            });
            await refreshAfterAdminWrite(
                async () => {
                    const results = await Promise.all([
                        workspace.refetch(),
                        ...(isDocument ? [recordQuery.refetch()] : []),
                        ...(showHistory ? [history.refetch()] : []),
                    ]);
                    if (results.some(result => result.error)) throw new Error('最新配置读取失败');
                },
                message => setFeedback({ key: started, error: message, notice: '' }),
                () => contextRef.current === started,
            );
        } catch (error) {
            if (contextRef.current === started)
                setFeedback({ key: started, error: toUserFacingError(error), notice: '' });
        } finally {
            actionLock.current = false;
        }
    };
    if (!canRead)
        return (
            <div role="alert" className="admin-page-status" data-failed>
                没有读取店铺内容的权限。
            </div>
        );
    const loading = workspace.loading && !state;
    const settings = (state?.settings.draft ?? defaultStorefrontSeoSettings()) as StorefrontSeoSettings;
    const evidence = seoEvidenceSummary(settings);
    return (
        <div className="space-y-5 p-4 sm:p-6" data-storefront-seo-workspace>
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold">{page?.title ?? 'SEO / GEO'}</h1>
                    <p className="mt-1 text-sm text-slate-500">
                        按店铺独立管理草稿与公开版本。保存配置不代表 Google 已收录。
                    </p>
                </div>
                <AdminButton
                    refreshPage
                    className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium disabled:opacity-50 bg-white text-slate-600"
                >
                    <RefreshCw size={16} />
                    刷新本页
                </AdminButton>
            </header>
            {loading && (
                <div role="status" className="admin-page-status">
                    正在读取当前店铺的搜索配置…
                </div>
            )}
            {workspace.error && (
                <div role="alert" className="admin-page-status" data-failed>
                    <span>{toUserFacingError(workspace.error)}</span>
                    <AdminButton
                        className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium disabled:opacity-50 text-slate-600 hover:bg-slate-100"
                        onClick={() => void workspace.refetch()}
                    >
                        重试读取
                    </AdminButton>
                </div>
            )}
            {!loading && !state && !workspace.error && (
                <div className="admin-page-status">当前店铺搜索配置尚不可用。</div>
            )}
            {state && (
                <>
                    <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600">
                        <span>店铺：{channel?.code}</span>
                        <span>公开状态：{state.accessMode}</span>
                        <span>
                            当前收录：
                            {(state.settings.published as StorefrontSeoSettings | null)?.indexingEnabled
                                ? '已开启配置'
                                : '未开启'}
                        </span>
                        <span>收录实测：{evidence.indexing}</span>
                    </div>
                    {isDocument && (
                        <div className="grid gap-3 md:grid-cols-3">
                            <AdminField label="页面类型">
                                <AdminSelect
                                    value={targetType}
                                    onChange={event =>
                                        select({
                                            targetType: event.target.value,
                                            targetId:
                                                event.target.value === 'HOME'
                                                    ? 'home'
                                                    : event.target.value === 'PAGE'
                                                      ? storefrontSeoPageKeys[0]
                                                      : '',
                                        })
                                    }
                                >
                                    {acceptedTargets.map(type => (
                                        <option key={type} value={type}>
                                            {SEO_TARGET_LABELS[type]}
                                        </option>
                                    ))}
                                </AdminSelect>
                            </AdminField>
                            <AdminField
                                label={targetType === 'ARTICLE' ? '文章网址标识' : '目标 ID'}
                                description={
                                    targetType === 'ARTICLE'
                                        ? '使用稳定的小写英文、数字和短横线。'
                                        : '使用当前店铺真实商品或分类 ID。'
                                }
                            >
                                {targetType === 'PAGE' ? (
                                    <AdminSelect
                                        value={targetId}
                                        onChange={event => select({ targetId: event.target.value })}
                                    >
                                        {storefrontSeoPageKeys.map(key => (
                                            <option key={key} value={key}>
                                                {key}
                                            </option>
                                        ))}
                                    </AdminSelect>
                                ) : (
                                    <AdminInput
                                        key={`${targetType}:${targetId}`}
                                        defaultValue={targetId}
                                        maxLength={targetType === 'ARTICLE' ? 100 : 128}
                                        disabled={targetType === 'HOME'}
                                        onBlur={event => {
                                            if (event.target.value !== targetId)
                                                select({ targetId: event.target.value.trim() });
                                        }}
                                        onKeyDown={event => {
                                            if (event.key === 'Enter') event.currentTarget.blur();
                                        }}
                                    />
                                )}
                            </AdminField>
                            <AdminField label="语言">
                                <AdminSelect
                                    value={languageCode}
                                    onChange={event => select({ languageCode: event.target.value })}
                                >
                                    <option value="zh_Hans">简体中文</option>
                                    <option value="en">英文</option>
                                </AdminSelect>
                            </AdminField>
                        </div>
                    )}
                    {isDocument && (
                        <div className="flex flex-wrap gap-2">
                            {state.documents
                                .filter(item =>
                                    section === 'geo'
                                        ? item.targetType === 'ARTICLE'
                                        : item.targetType !== 'ARTICLE',
                                )
                                .map(item => (
                                    <AdminButton
                                        key={seoIdentityKey(item as StorefrontSeoIdentity)}
                                        className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium disabled:opacity-50 text-slate-600"
                                        onClick={() =>
                                            select({
                                                targetType: item.targetType,
                                                targetId: item.targetId,
                                                languageCode: item.languageCode,
                                            })
                                        }
                                    >
                                        {SEO_TARGET_LABELS[item.targetType]} · {item.targetId} ·{' '}
                                        {item.languageCode}
                                        {item.published ? ' · 已发布' : ' · 草稿'}
                                    </AdminButton>
                                ))}
                        </div>
                    )}
                    {isDocument && !entityReadable && (
                        <div role="alert" className="admin-page-status" data-failed>
                            没有读取此类商品或分类的权限。
                        </div>
                    )}
                    {isDocument && !targetId && (
                        <div className="admin-page-status">填写真实目标 ID 或新文章网址标识后开始编辑。</div>
                    )}
                    {recordQuery.loading && !safeRecord && isDocument && (
                        <div role="status" className="admin-page-status">
                            正在读取页面配置…
                        </div>
                    )}
                    {recordQuery.error && isDocument && (
                        <div role="alert" className="admin-page-status" data-failed>
                            <span>{toUserFacingError(recordQuery.error)}</span>
                            <AdminButton
                                className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium disabled:opacity-50 text-slate-600 hover:bg-slate-100"
                                onClick={() => void recordQuery.refetch()}
                            >
                                重试读取
                            </AdminButton>
                        </div>
                    )}
                    {draft.sourceChanged && <DraftUpdateNotice onReload={draft.reload} />}
                    {currentFeedback.error && (
                        <div role="alert" className="admin-page-status" data-failed>
                            {currentFeedback.error}
                        </div>
                    )}
                    {currentFeedback.notice && (
                        <div role="status" className="admin-page-status">
                            {currentFeedback.notice}
                        </div>
                    )}
                    {safeRecord && isDocument && channel && (
                        <SeoDocumentRecordEditor
                            record={safeRecord}
                            channelToken={channel.token}
                            canWrite={
                                entityWritable &&
                                (targetType === 'PRODUCT' ||
                                    targetType === 'COLLECTION' ||
                                    hasAnyPermission(['UpdateStorefrontContent']))
                            }
                            sourceQuery={STOREFRONT_SEO_RECORD}
                            onRefresh={async () => {
                                const results = await Promise.all([
                                    workspace.refetch(),
                                    recordQuery.refetch(),
                                ]);
                                if (results.some(result => result.error))
                                    throw new Error('最新页面配置读取失败');
                            }}
                            settings={state.settings.published as StorefrontSeoSettings | null}
                            publicOrigin={publicOrigin}
                            onDirtyChange={trackDocumentDirty}
                        />
                    )}
                    {safeRecord && draft.draft && !isDocument && (
                        <>
                            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
                                <span>
                                    草稿版本 {safeRecord.version}
                                    {draft.dirty ? ' · 未保存修改' : ''}
                                </span>
                                <span>公开版本 {safeRecord.publishedVersion || '无'}</span>
                                <span>发布时间：{seoDate(safeRecord.publishedAt)}</span>
                                {!editable && <span>只读</span>}
                            </div>
                            {section === 'overview' && (
                                <SeoSettingsFields
                                    value={draft.draft as StorefrontSeoSettings}
                                    onChange={update}
                                    disabled={!editable || busy}
                                />
                            )}
                            {section === 'redirects' && (
                                <SeoRedirectFields
                                    value={draft.draft as StorefrontSeoSettings}
                                    onChange={update}
                                    disabled={!editable || busy}
                                />
                            )}
                            {section === 'platforms' && (
                                <SeoPlatformFields
                                    value={draft.draft as StorefrontSeoSettings}
                                    onChange={update}
                                    disabled={!editable || busy}
                                />
                            )}
                            {section === 'diagnostics' && (
                                <div className="space-y-3">
                                    <p className="text-sm text-slate-500">
                                        以下为当前服务端配置诊断。抓取、实际收录和 Google
                                        平台报告需要公开环境及平台证据。
                                    </p>
                                    {state.diagnostics.length ? (
                                        state.diagnostics.map((issue, index) => (
                                            <div
                                                key={`${issue.code}:${index}`}
                                                className="admin-page-status"
                                                data-failed={issue.severity === 'ERROR' || undefined}
                                            >
                                                <span>
                                                    {seoStatusLabel(issue.severity)} · {issue.code}
                                                </span>
                                                <span>{issue.message}</span>
                                                <span>
                                                    {issue.targetType} / {issue.targetId} /{' '}
                                                    {issue.languageCode}
                                                </span>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="admin-page-status">
                                            当前配置诊断未发现问题；公开抓取及平台收录：NOT_MEASURED。
                                        </div>
                                    )}
                                    <div className="admin-page-status">
                                        平台访问：{evidence.platformAccess} · 搜索数据：{evidence.search} · AI
                                        引用：{evidence.aiCitations}
                                    </div>
                                    <a
                                        className="inline-flex items-center gap-2 text-blue-600"
                                        href="https://search.google.com/search-console"
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        打开 Search Console <ExternalLink size={16} />
                                    </a>
                                </div>
                            )}
                            {section !== 'diagnostics' && (
                                <div className="flex flex-wrap gap-2">
                                    <AdminButton
                                        disabled={disabled || !draft.dirty}
                                        onClick={() => void perform('save')}
                                        className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium disabled:opacity-50 bg-slate-900 text-white"
                                        aria-busy={saveState.loading}
                                    >
                                        <Save size={16} />
                                        保存草稿
                                    </AdminButton>
                                    <AdminButton
                                        className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium disabled:opacity-50 text-slate-600 hover:bg-slate-100"
                                        disabled={disabled || draft.dirty}
                                        onClick={() => void perform('publish')}
                                        aria-busy={publishState.loading}
                                    >
                                        <Send size={16} />
                                        发布已保存版本
                                    </AdminButton>
                                    <AdminButton
                                        className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium disabled:opacity-50 text-slate-600 hover:bg-slate-100"
                                        disabled={disabled || draft.dirty || !safeRecord.published}
                                        onClick={() => void perform('unpublish')}
                                    >
                                        撤回公开版本
                                    </AdminButton>
                                    <AdminButton
                                        className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium disabled:opacity-50 text-slate-600 hover:bg-slate-100"
                                        disabled={busy}
                                        onClick={() => setShowHistory(value => !value)}
                                    >
                                        {showHistory ? '收起历史' : '发布历史'}
                                    </AdminButton>
                                </div>
                            )}
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
                                        <div
                                            key={item.id}
                                            className="flex flex-wrap items-center gap-3 text-sm"
                                        >
                                            <span>
                                                版本 {item.version} · {seoDate(item.publishedAt)} ·{' '}
                                                {item.publishedBy}
                                            </span>
                                            {item.payload ? (
                                                <AdminButton
                                                    className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium disabled:opacity-50 text-slate-600 hover:bg-slate-100"
                                                    disabled={disabled || draft.dirty}
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
                        </>
                    )}
                </>
            )}
        </div>
    );
}

function SeoSettingsFields({
    value,
    onChange,
    disabled,
}: {
    value: StorefrontSeoSettings;
    onChange: (value: StorefrontSeoSettings) => void;
    disabled: boolean;
}) {
    const organization = value.organization;
    return (
        <div className="space-y-5">
            <AdminField
                label="允许搜索收录"
                description="只有已正式开放、已验证主域名、已发布且内容完整的公开页面才有资格收录。"
            >
                <AdminInput
                    type="checkbox"
                    checked={value.indexingEnabled}
                    disabled={disabled}
                    onChange={event => onChange({ ...value, indexingEnabled: event.target.checked })}
                />
            </AdminField>
            <div className="flex flex-wrap gap-5">
                {(['zh_Hans', 'en'] as const).map(language => (
                    <AdminField key={language} label={language === 'en' ? '英文独立网址' : '中文独立网址'}>
                        <AdminInput
                            type="checkbox"
                            checked={value.enabledLanguages.includes(language)}
                            disabled={disabled}
                            onChange={event =>
                                onChange({
                                    ...value,
                                    enabledLanguages: event.target.checked
                                        ? [...value.enabledLanguages, language]
                                        : value.enabledLanguages.filter(item => item !== language),
                                })
                            }
                        />
                    </AdminField>
                ))}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
                {(['zh_Hans', 'en'] as const).map(language => (
                    <div key={language} className="space-y-3">
                        <AdminField
                            label={`${language === 'en' ? '英文' : '中文'}标题模板`}
                            description="可用 {title} 与 {store}；不会替代原始商品标题。"
                        >
                            <AdminInput
                                disabled={disabled}
                                value={value.titleTemplates[language]}
                                onChange={event =>
                                    onChange({
                                        ...value,
                                        titleTemplates: {
                                            ...value.titleTemplates,
                                            [language]: event.target.value,
                                        },
                                    })
                                }
                            />
                        </AdminField>
                        <AdminField label="默认描述" layout="stacked">
                            <AdminTextArea
                                disabled={disabled}
                                rows={3}
                                value={value.defaultDescriptions[language]}
                                onChange={event =>
                                    onChange({
                                        ...value,
                                        defaultDescriptions: {
                                            ...value.defaultDescriptions,
                                            [language]: event.target.value,
                                        },
                                    })
                                }
                            />
                        </AdminField>
                    </div>
                ))}
            </div>
            <AdminField label="默认分享图片" description="留空时继承原始素材；不会改动现有图片绑定。">
                <AdminInput
                    disabled={disabled}
                    type="url"
                    value={value.shareImageUrl}
                    onChange={event => onChange({ ...value, shareImageUrl: event.target.value })}
                />
            </AdminField>
            <section className="space-y-3">
                <h2 className="flex items-center gap-2 font-semibold">
                    搜索与 AI 爬虫
                    <FeatureHelpButton
                        title="搜索与 AI 爬虫"
                        content={{
                            purpose: '控制本店的搜索收录配置与爬虫规则。',
                            requirements: [
                                '核对当前店铺、语言与相应权限',
                                '使用真实内容和可追溯证据，缺项保留待核验',
                            ],
                            example: '保存收录规则草稿后再发布；网站还需满足营业及语言内容条件。',
                            impact: '保存草稿与发布分开；搜索收录、排名与 AI 引用以实际外部结果为准。',
                        }}
                    />
                </h2>
                <p className="text-sm text-slate-500">
                    搜索发现与模型训练分别设置；这些是抓取规则，不能代替权限保护或保证收录。
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                    {Object.entries(value.searchCrawlers).map(([name, enabled]) => (
                        <AdminField key={name} label={`${name} 搜索`}>
                            <AdminInput
                                type="checkbox"
                                disabled={disabled}
                                checked={enabled}
                                onChange={event =>
                                    onChange({
                                        ...value,
                                        searchCrawlers: {
                                            ...value.searchCrawlers,
                                            [name]: event.target.checked,
                                        },
                                    })
                                }
                            />
                        </AdminField>
                    ))}
                    {Object.entries(value.trainingCrawlers).map(([name, enabled]) => (
                        <AdminField key={name} label={`${name} 模型训练`}>
                            <AdminInput
                                type="checkbox"
                                disabled={disabled}
                                checked={enabled}
                                onChange={event =>
                                    onChange({
                                        ...value,
                                        trainingCrawlers: {
                                            ...value.trainingCrawlers,
                                            [name]: event.target.checked,
                                        },
                                    })
                                }
                            />
                        </AdminField>
                    ))}
                </div>
                <AdminField label="提供 llms.txt" description="作为可选内容索引；没有保证排名或收录的作用。">
                    <AdminInput
                        type="checkbox"
                        disabled={disabled}
                        checked={value.llmsEnabled}
                        onChange={event => onChange({ ...value, llmsEnabled: event.target.checked })}
                    />
                </AdminField>
            </section>
            <section className="space-y-3">
                <h2 className="flex items-center gap-2 font-semibold">
                    企业事实与来源
                    <FeatureHelpButton
                        title="企业事实与来源"
                        content={{
                            purpose: '维护店铺真实的企业事实和支持它们的来源。',
                            requirements: [
                                '核对当前店铺、语言与相应权限',
                                '使用真实内容和可追溯证据，缺项保留待核验',
                            ],
                            example: '核对已有品牌资料和来源网址，审核后保存并发布。',
                            impact: '保存草稿与发布分开；搜索收录、排名与 AI 引用以实际外部结果为准。',
                        }}
                    />
                </h2>
                <AdminField label="结构化企业类型">
                    <AdminSelect
                        disabled={disabled}
                        value={organization.businessType}
                        onChange={event =>
                            onChange({
                                ...value,
                                organization: {
                                    ...organization,
                                    businessType: event.target.value as 'Organization' | 'LocalBusiness',
                                },
                            })
                        }
                    >
                        <option value="Organization">企业组织（Organization）</option>
                        <option value="LocalBusiness">LocalBusiness（需真实公开营业地址）</option>
                    </AdminSelect>
                </AdminField>
                <AdminField
                    label="公开营业地址"
                    layout="stacked"
                    description="只填写可公开、已核验的营业地点；不可用注册地址推断。"
                >
                    <AdminTextArea
                        disabled={disabled}
                        rows={2}
                        value={organization.publicAddress}
                        onChange={event =>
                            onChange({
                                ...value,
                                organization: { ...organization, publicAddress: event.target.value },
                            })
                        }
                    />
                </AdminField>
                <AdminField label="服务地区" layout="stacked" description="每行一个真实服务地区。">
                    <AdminTextArea
                        disabled={disabled}
                        rows={3}
                        value={organization.serviceAreas.join('\n')}
                        onChange={event =>
                            onChange({
                                ...value,
                                organization: { ...organization, serviceAreas: lines(event.target.value) },
                            })
                        }
                    />
                </AdminField>
                <AdminField
                    label="官方资料链接"
                    layout="stacked"
                    description="每行一个真实官方账号或企业资料的 HTTPS 地址。"
                >
                    <AdminTextArea
                        disabled={disabled}
                        rows={3}
                        value={organization.sameAs.join('\n')}
                        onChange={event =>
                            onChange({
                                ...value,
                                organization: { ...organization, sameAs: lines(event.target.value) },
                            })
                        }
                    />
                </AdminField>
                <AdminField label="核验证据地址">
                    <AdminInput
                        type="url"
                        disabled={disabled}
                        value={organization.evidenceUrl}
                        onChange={event =>
                            onChange({
                                ...value,
                                organization: { ...organization, evidenceUrl: event.target.value },
                            })
                        }
                    />
                </AdminField>
                <AdminField label="实际核验时间">
                    <AdminInput
                        type="datetime-local"
                        disabled={disabled}
                        value={seoLocalDateTime(organization.reviewedAt)}
                        onChange={event =>
                            onChange({
                                ...value,
                                organization: {
                                    ...organization,
                                    reviewedAt: event.target.value
                                        ? new Date(event.target.value).toISOString()
                                        : null,
                                },
                            })
                        }
                    />
                </AdminField>
            </section>
        </div>
    );
}
