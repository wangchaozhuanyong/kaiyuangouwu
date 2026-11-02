import { useMutation } from '@apollo/client/react';
import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { serviceMessageDisplay } from '../../../../common/src/display-localization';
import { blogCategoryLabels } from '../../../../storefront-content-plugin/src/shared/news-blog';
import { getAdminQueryScope } from '../../apollo';
import { AdminButton, AdminSelect } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { SearchInput } from '../../components/SearchInput';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { useAdminQuery } from '../../hooks/use-admin-query';
import { toUserFacingError } from '../../utils/user-facing-error';
import { NewsBlogArticleEditor } from './NewsBlogArticleEditor';
import { NewsBlogRunRecovery } from './NewsBlogRunRecovery';
import { NewsBlogSettings } from './NewsBlogSettings';
import {
    type BlogAdminArticle,
    type BlogAdminItem,
    type BlogAdminRun,
    type BlogAdminSettings,
    type BlogAdminSource,
} from './news-blog-types';
import * as G from './news-blog.graphql';
const labels: Record<string, string> = {
    DRAFT: '草稿',
    PENDING_REVIEW: '待审核',
    PUBLISHED: '已发布',
    WITHDRAWN: '已撤稿',
};
const statusLabels: Record<string, string> = {
    NOT_COLLECTED: '未采集',
    OK: '正常',
    NO_DATED_ENTRIES: '暂无近期资讯',
    READY: '可生成',
    INSUFFICIENT: '资料不足',
    FAILED: '失败',
    QUEUED: '等待执行',
    RUNNING: '执行中',
    SUCCEEDED: '已完成',
    DEFERRED: '等待来源恢复',
    UNKNOWN: '需要核对',
};
const kindLabels: Record<string, string> = {
    COLLECT: '资讯采集',
    GENERATE: '文章生成',
    SECTION: '段落重写',
    MEDIA: '自动配图',
    SKILL: 'Skill 介绍与更新',
    SKILL_REVIEW: 'Skill 事实复核',
    SKILL_STATUS: 'Skill 选题检查',
};
const statusLabel = (status: string) => statusLabels[status] ?? '未知状态';
const kindLabel = (kind: string) => kindLabels[kind] ?? '其他任务';
const tabs = [
    ['articles', '文章管理'],
    ['sources', '资讯来源'],
    ['settings', '自动化设置'],
    ['runs', '运行记录'],
] as const;
export function NewsBlogModule() {
    const [params, setParams] = useSearchParams(),
        tab = params.get('tab') ?? 'articles',
        id = params.get('article'),
        scope = getAdminQueryScope();
    const { hasAnyPermission } = useAdminPermissions(),
        isAdmin = hasAnyPermission(['SuperAdmin']);
    const query = useAdminQuery<{
        newsBlogSettings: BlogAdminSettings;
        newsBlogArticleList: { items: BlogAdminArticle[]; totalItems: number };
    }>(G.NEWS_BLOG_WORKSPACE, {
        variables: {
            input: {
                term: params.get('term') || undefined,
                state: params.get('state') || undefined,
                skip: (Math.max(1, Number(params.get('page')) || 1) - 1) * 25,
                take: 25,
            },
        },
    });
    const sources = useAdminQuery<{
        newsBlogSources: BlogAdminSource[];
        newsBlogSourceItems: BlogAdminItem[];
    }>(G.NEWS_BLOG_SOURCES, { skip: tab !== 'sources' });
    const runs = useAdminQuery<{ newsBlogRuns: BlogAdminRun[] }>(G.NEWS_BLOG_RUNS, {
        skip: tab !== 'runs',
        pollInterval: 15000,
    });
    const [sourceWrite, sourceState] = useMutation(G.SAVE_NEWS_BLOG_SOURCE),
        [request, requestState] = useMutation(G.REQUEST_NEWS_BLOG_TASK);
    const [retry, retryState] = useMutation(G.RETRY_NEWS_BLOG_TASK);
    const [feedback, setFeedback] = useState({ scope, message: '', failed: false }),
        pending = useRef(false),
        busy = sourceState.loading || requestState.loading || retryState.loading;
    const change = (patch: Record<string, string | undefined>) =>
        setParams(old => {
            const next = new URLSearchParams(old);
            if ('term' in patch || 'state' in patch) next.delete('page');
            for (const [k, v] of Object.entries(patch))
                if (v) next.set(k, v);
                else next.delete(k);
            return next;
        });
    const execute = async (action: () => Promise<unknown>, message: string) => {
        if (pending.current) return;
        pending.current = true;
        setFeedback({ scope, message: '', failed: false });
        try {
            await action();
            if (getAdminQueryScope() !== scope) return;
            setFeedback({ scope, message, failed: false });
            try {
                await query.refetch();
                if (tab === 'sources') await sources.refetch();
                if (tab === 'runs') await runs.refetch();
            } catch {
                if (getAdminQueryScope() === scope)
                    setFeedback({
                        scope,
                        message: `${message} 最新状态读取失败，请重新读取核对，勿重复提交。`,
                        failed: true,
                    });
            }
        } catch (error) {
            if (getAdminQueryScope() === scope)
                setFeedback({ scope, message: toUserFacingError(error), failed: true });
        } finally {
            pending.current = false;
        }
    };
    const task = (kind: string, extra: Record<string, unknown> = {}) =>
        execute(
            () => request({ variables: { input: { kind, requestKey: crypto.randomUUID(), ...extra } } }),
            '请求已受理，可在运行记录查看任务状态；文章需人工审核发布。',
        );
    const articles = query.data?.newsBlogArticleList.items ?? [];
    const pageNumber = Math.max(1, Number(params.get('page')) || 1);
    const totalItems = query.data?.newsBlogArticleList.totalItems ?? 0;
    return (
        <section className="space-y-5" data-admin-page="news-blog">
            <header className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold">
                        新闻博客
                        <FeatureHelpButton title="新闻博客" topic="news-blog.overview" />
                    </h1>
                    <p className="mt-1 text-sm text-slate-500">
                        新闻审核后发布；热门 Skill 按已启用的自动化设置每日更新。
                    </p>
                </div>
                <AdminButton refreshPage disabled={query.loading} onClick={() => void query.refetch()}>
                    重新读取
                </AdminButton>
            </header>
            <nav className="flex flex-wrap gap-2" aria-label="博客工作区">
                {tabs
                    .filter(([key]) => key !== 'settings' || isAdmin)
                    .map(([key, label]) => (
                        <AdminButton
                            key={key}
                            aria-current={tab === key ? 'page' : undefined}
                            className={tab === key ? 'bg-slate-900 text-white' : ''}
                            onClick={() => change({ tab: key })}
                        >
                            {label}
                        </AdminButton>
                    ))}
            </nav>
            {query.loading && !query.data && <p role="status">正在读取博客…</p>}
            {query.error && (
                <p role="alert" className="admin-page-status" data-failed>
                    博客读取失败，已有内容及草稿会保留，请重新读取。
                </p>
            )}
            {feedback.scope === scope && feedback.message && (
                <p
                    className="admin-page-status"
                    role={feedback.failed ? 'alert' : 'status'}
                    data-failed={feedback.failed || undefined}
                >
                    {feedback.message}
                </p>
            )}
            {tab === 'articles' && (
                <>
                    <div className="flex flex-wrap items-end gap-3">
                        <AdminField label="搜索文章">
                            <SearchInput
                                value={params.get('term') ?? ''}
                                onValueChange={term => change({ term })}
                            />
                        </AdminField>
                        <AdminField label="文章状态">
                            <AdminSelect
                                value={params.get('state') ?? ''}
                                onChange={e => change({ state: e.target.value })}
                            >
                                <option value="">全部</option>
                                {Object.entries(labels).map(([key, label]) => (
                                    <option key={key} value={key}>
                                        {label}
                                    </option>
                                ))}
                            </AdminSelect>
                        </AdminField>
                        <AdminButton
                            className="bg-slate-900 text-white"
                            disabled={busy}
                            onClick={() => change({ article: 'new' })}
                        >
                            新建文章
                        </AdminButton>
                    </div>
                    <div className="admin-comparison-scroll">
                        <table className="w-full admin-mobile-record-table">
                            <thead>
                                <tr>
                                    <th>标题</th>
                                    <th>分类</th>
                                    <th>状态</th>
                                    <th>版本</th>
                                    <th>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {articles.map(article => (
                                    <tr key={article.id}>
                                        <td data-label="标题">{article.draft.title || '未命名文章'}</td>
                                        <td data-label="分类">
                                            {blogCategoryLabels[article.draft.category]}
                                        </td>
                                        <td data-label="状态">
                                            {labels[article.state] ?? '未知状态'}
                                            {article.published && article.state !== 'PUBLISHED'
                                                ? ' · 线上保留已发布版本'
                                                : ''}
                                        </td>
                                        <td data-label="版本">{article.version}</td>
                                        <td data-label="操作">
                                            <AdminButton onClick={() => change({ article: article.id })}>
                                                编辑与审核
                                            </AdminButton>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {query.data && articles.length === 0 && (
                        <p role="status">没有符合条件的文章，可调整筛选、采集资讯或新建文章。</p>
                    )}
                    <nav className="flex flex-wrap items-center gap-3" aria-label="文章分页">
                        <AdminButton
                            disabled={query.loading || pageNumber === 1}
                            onClick={() => change({ page: String(pageNumber - 1) })}
                        >
                            上一页
                        </AdminButton>
                        <span>
                            第 {pageNumber} 页 · 共 {totalItems} 篇
                        </span>
                        <AdminButton
                            disabled={query.loading || pageNumber * 25 >= totalItems}
                            onClick={() => change({ page: String(pageNumber + 1) })}
                        >
                            下一页
                        </AdminButton>
                    </nav>
                    {id && (
                        <NewsBlogArticleEditor
                            key={`${scope}:${id}`}
                            id={id}
                            execute={execute}
                            onSaved={article => change({ article })}
                            onClose={() => change({ article: undefined })}
                        />
                    )}
                </>
            )}
            {tab === 'sources' && (
                <section className="space-y-5">
                    <AdminButton
                        disabled={busy || !query.data?.newsBlogSettings.enabled}
                        onClick={() => void task('COLLECT')}
                    >
                        立即采集官方资讯
                    </AdminButton>
                    {query.data?.newsBlogSettings.skillEnabled && (
                        <section className="space-y-3">
                            <h2 className="text-lg font-semibold">
                                热门 Skill 候选
                                <FeatureHelpButton title="热门 Skill 候选" topic="news-blog.candidates" />
                            </h2>
                            <p className="text-sm text-slate-500">
                                {serviceMessageDisplay(
                                    query.data.newsBlogSettings.skillStatus || '候选资料尚在采集中。',
                                )}{' '}
                                相似条目不会自动推荐。
                            </p>
                            {query.data.newsBlogSettings.skillCandidates?.map(item => (
                                <div className="border-b py-3" key={`${item.repository}:${item.name}`}>
                                    <a
                                        href={`https://github.com/${item.repository}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="font-semibold"
                                    >
                                        {item.name} ↗
                                    </a>
                                    <p className="text-sm text-slate-500">
                                        {item.repository} · 仓库 {item.stars.toLocaleString()} 次 GitHub 收藏
                                        · {item.status === 'READY' ? '可参与选题' : '暂停自动推荐'}{' '}
                                        {item.message}
                                    </p>
                                </div>
                            ))}
                        </section>
                    )}
                    {sources.loading && !sources.data && <p role="status">正在读取来源…</p>}
                    {sources.error && <p role="alert">来源读取失败，请重新读取。</p>}
                    {sources.data?.newsBlogSources.map(source => (
                        <div
                            className="flex flex-wrap items-center justify-between gap-3 border-b py-3"
                            key={source.id}
                        >
                            <div>
                                <a
                                    href={source.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-semibold"
                                >
                                    {source.name} ↗
                                </a>
                                <p className="text-sm text-slate-500">
                                    {statusLabel(source.status)} · {source.message}
                                </p>
                            </div>
                            <AdminButton
                                disabled={busy}
                                onClick={() =>
                                    void execute(
                                        () =>
                                            sourceWrite({
                                                variables: {
                                                    code: source.code,
                                                    enabled: !source.enabled,
                                                    expectedVersion: source.version,
                                                },
                                            }),
                                        '来源配置已保存。',
                                    )
                                }
                            >
                                {source.enabled ? '暂停来源' : '启用来源'}
                            </AdminButton>
                        </div>
                    ))}
                    <h2 className="text-lg font-semibold">
                        最近采集资讯
                        <FeatureHelpButton title="最近采集资讯" topic="news-blog.sources" />
                    </h2>
                    {sources.data?.newsBlogSourceItems.length === 0 && (
                        <p role="status">尚无采集记录，可点击立即采集。</p>
                    )}
                    {sources.data?.newsBlogSourceItems.map(item => (
                        <article className="space-y-2 border-b py-3" key={item.id}>
                            <a
                                href={item.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-semibold"
                            >
                                {item.title} ↗
                            </a>
                            <p className="text-sm text-slate-500">
                                {item.sourcePublishedAt} · {statusLabel(item.status)}
                            </p>
                            <details>
                                <summary>核对采集原文</summary>
                                <p className="whitespace-pre-wrap break-words">{item.body}</p>
                            </details>
                            <AdminButton
                                disabled={busy || item.status !== 'READY'}
                                onClick={() => void task('GENERATE', { sourceIds: [item.id] })}
                            >
                                生成待审图文
                            </AdminButton>
                        </article>
                    ))}
                </section>
            )}
            {tab === 'settings' && isAdmin && query.data && (
                <NewsBlogSettings source={query.data.newsBlogSettings} execute={execute} />
            )}
            {tab === 'runs' && (
                <section className="space-y-3">
                    {runs.loading && !runs.data && <p role="status">正在读取任务…</p>}
                    {runs.error && <p role="alert">运行记录读取失败，请重新读取。</p>}
                    {runs.data?.newsBlogRuns.length === 0 && <p role="status">暂无运行记录。</p>}
                    {runs.data?.newsBlogRuns.map(run => (
                        <article className="space-y-1 border-b py-3" key={run.id}>
                            <h2 className="font-semibold">
                                {kindLabel(run.kind)} · {statusLabel(run.state)}
                            </h2>
                            <p className="text-sm">{run.message}</p>
                            <p className="text-sm text-slate-500">
                                {run.createdAt} · 预留 ${(run.reservedMicros / 1000000).toFixed(4)} ·
                                已报告费用{' '}
                                {run.chargedMicros
                                    ? `$${(run.chargedMicros / 1000000).toFixed(4)}`
                                    : '未报告'}
                            </p>
                            {isAdmin && run.state === 'UNKNOWN' && (
                                <NewsBlogRunRecovery id={run.id} execute={execute} />
                            )}
                            {run.state === 'FAILED' && run.reservedMicros === 0 && (
                                <AdminButton
                                    disabled={busy}
                                    onClick={() =>
                                        void execute(
                                            () =>
                                                retry({
                                                    variables: {
                                                        id: run.id,
                                                        requestKey: crypto.randomUUID(),
                                                    },
                                                }),
                                            '已重新排队失败的任务。',
                                        )
                                    }
                                >
                                    重试此任务
                                </AdminButton>
                            )}
                            {run.telemetryJson && (
                                <details>
                                    <summary>调用用量</summary>
                                    <pre className="whitespace-pre-wrap break-words text-sm">
                                        {run.telemetryJson}
                                    </pre>
                                </details>
                            )}
                        </article>
                    ))}
                </section>
            )}
        </section>
    );
}
