import { useMutation } from '@apollo/client/react';
import { useState } from 'react';
import {
    blogBodySections,
    blogCategories,
    blogCategoryLabels,
    emptyBlogDraft,
    skillDomains,
    skillProfileBody,
    type BlogDraft,
    type BlogSkillProfile,
} from '../../../../storefront-content-plugin/src/shared/news-blog';
import { getAdminQueryScope } from '../../apollo';
import { AdminButton, AdminInput, AdminSelect, AdminTextArea } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { DraftUpdateNotice } from '../../components/DraftUpdateNotice';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { useAdminQuery } from '../../hooks/use-admin-query';
import { useServerDraft } from '../../hooks/use-server-draft';
import { type BlogAdminAction, type BlogAdminArticle } from './news-blog-types';
import * as G from './news-blog.graphql';

export function NewsBlogArticleEditor({
    id,
    execute,
    onSaved,
    onClose,
}: {
    id: string;
    execute: BlogAdminAction;
    onSaved: (id: string) => void;
    onClose: () => void;
}) {
    const scope = getAdminQueryScope(),
        { hasAnyPermission } = useAdminPermissions();
    const canPublish = hasAnyPermission(['PublishNewsBlog', 'SuperAdmin']);
    const query = useAdminQuery<{
        newsBlogArticle: BlogAdminArticle;
        newsBlogHistory: Array<{
            id: string;
            version: number;
            action: string;
            createdAt: string;
            snapshotJson: string | null;
        }>;
    }>(G.NEWS_BLOG_ARTICLE, { variables: { id }, skip: id === 'new' });
    const [initial] = useState<BlogAdminArticle>(() => ({
        id: '',
        slug: '',
        version: 0,
        state: 'DRAFT',
        draft: emptyBlogDraft(),
        published: null,
        issues: [],
    }));
    const source = id === 'new' ? initial : (query.data?.newsBlogArticle ?? null);
    const server = useServerDraft<BlogAdminArticle>(
        `news-blog:${scope}:${id}`,
        source ? String(source.version) : '',
        source,
    );
    const [save, saveState] = useMutation<{ saveNewsBlogArticle: BlogAdminArticle }>(
        G.SAVE_NEWS_BLOG_ARTICLE,
    );
    const [request, requestState] = useMutation(G.REQUEST_NEWS_BLOG_TASK);
    const [publish, publishState] = useMutation<{ publishNewsBlogArticle: BlogAdminArticle }>(
        G.PUBLISH_NEWS_BLOG_ARTICLE,
    );
    const [withdraw, withdrawState] = useMutation<{ withdrawNewsBlogArticle: BlogAdminArticle }>(
        G.WITHDRAW_NEWS_BLOG_ARTICLE,
    );
    const [acknowledged, setAcknowledged] = useState('');
    const current = server.draft,
        body = current?.draft,
        busy = saveState.loading || requestState.loading || publishState.loading || withdrawState.loading;
    const update = (patch: Partial<BlogDraft>) =>
        server.setDraft(value => (value ? { ...value, draft: { ...value.draft, ...patch } } : value));
    const updateProfile = (patch: Partial<BlogSkillProfile>) => {
        const profile = server.draft?.draft.skillProfile;
        if (!profile) return;
        const next = { ...profile, ...patch };
        update({
            skillProfile: next,
            title: next.displayName,
            summary: next.purpose,
            body: skillProfileBody(next),
        });
    };
    const accept = (value?: BlogAdminArticle) => {
        if (value && getAdminQueryScope() === scope) {
            server.accept(value, String(value.version));
            onSaved(value.id);
        }
    };
    const task = (kind: string, extra: Record<string, unknown> = {}) =>
        execute(
            () =>
                request({
                    variables: {
                        input: {
                            kind,
                            requestKey: crypto.randomUUID(),
                            articleId: current?.id,
                            expectedVersion: current?.version,
                            ...extra,
                        },
                    },
                }),
            '任务已排队，生成结果仍需审核。',
        );
    if (!current || !body)
        return (
            <div role={query.error ? 'alert' : 'status'}>
                {query.error ? '文章读取失败，请重新读取。' : '正在读取文章…'}
            </div>
        );
    return (
        <section className="space-y-4 rounded-xl border p-4">
            <header className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">
                    文章编辑与审核
                    <FeatureHelpButton title="文章编辑与审核" topic="news-blog.editor" />
                </h2>
                <div className="flex gap-2">
                    <AdminButton
                        disabled={query.loading || id === 'new'}
                        onClick={() => void query.refetch()}
                    >
                        重新读取文章
                    </AdminButton>
                    <AdminButton onClick={onClose}>收起编辑器</AdminButton>
                </div>
            </header>
            {query.error && <p role="alert">文章更新失败，已保留草稿。</p>}
            {server.sourceChanged && <DraftUpdateNotice onReload={server.reload} />}
            <div className="grid gap-6 xl:grid-cols-2">
                <div className="space-y-4">
                    <AdminField label="文章网址标识">
                        <AdminInput
                            value={current.slug}
                            disabled={Boolean(current.published)}
                            onChange={e => server.setDraft(x => (x ? { ...x, slug: e.target.value } : x))}
                        />
                    </AdminField>
                    <AdminField label="标题">
                        <AdminInput
                            value={body.title}
                            onChange={e =>
                                body.skillProfile
                                    ? updateProfile({ displayName: e.target.value })
                                    : update({ title: e.target.value })
                            }
                        />
                    </AdminField>
                    {body.candidateTitles.length > 0 && (
                        <AdminField label="候选标题">
                            <AdminSelect
                                value={body.candidateTitles.includes(body.title) ? body.title : ''}
                                onChange={e => {
                                    if (e.target.value) update({ title: e.target.value });
                                }}
                            >
                                <option value="">选择候选标题</option>
                                {body.candidateTitles.map(title => (
                                    <option key={title} value={title}>
                                        {title}
                                    </option>
                                ))}
                            </AdminSelect>
                        </AdminField>
                    )}
                    <AdminField label="分类">
                        <AdminSelect
                            disabled={Boolean(body.skill)}
                            value={body.category}
                            onChange={e => update({ category: e.target.value as BlogDraft['category'] })}
                        >
                            {blogCategories.map(category => (
                                <option
                                    key={category}
                                    value={category}
                                    disabled={category === 'skills' && !body.skill}
                                >
                                    {blogCategoryLabels[category]}
                                </option>
                            ))}
                        </AdminSelect>
                    </AdminField>
                    <AdminField label="文章类型">
                        <AdminSelect
                            disabled={Boolean(body.skill)}
                            value={body.format}
                            onChange={e => update({ format: e.target.value as BlogDraft['format'] })}
                        >
                            <option value="NEWS">快讯</option>
                            <option value="ANALYSIS">更新解读</option>
                            <option value="GUIDE">使用指南</option>
                            <option value="COMPARISON">对比分析</option>
                            <option value="SKILL" disabled={!body.skill}>
                                技能介绍
                            </option>
                        </AdminSelect>
                    </AdminField>
                    <AdminField label="摘要" layout="stacked">
                        <AdminTextArea
                            rows={3}
                            value={body.summary}
                            onChange={e =>
                                body.skillProfile
                                    ? updateProfile({ purpose: e.target.value })
                                    : update({ summary: e.target.value })
                            }
                        />
                    </AdminField>
                    {body.skillProfile && (
                        <section className="space-y-4" aria-label="Skill 用途资料">
                            <AdminField label="主要领域">
                                <AdminSelect
                                    value={body.skillProfile.domain}
                                    onChange={e =>
                                        updateProfile({
                                            domain: e.target.value as BlogSkillProfile['domain'],
                                        })
                                    }
                                >
                                    {Object.entries(skillDomains).map(([key, label]) => (
                                        <option key={key} value={key}>
                                            {label}
                                        </option>
                                    ))}
                                </AdminSelect>
                            </AdminField>
                            <AdminField label="适合谁">
                                <AdminInput
                                    value={body.skillProfile.audience}
                                    onChange={e => updateProfile({ audience: e.target.value })}
                                />
                            </AdminField>
                            <AdminField label="适用行业（逗号分隔）">
                                <AdminInput
                                    value={body.skillProfile.industries.join('，')}
                                    onChange={e =>
                                        updateProfile({
                                            industries: e.target.value.split(/[,，]/u).filter(Boolean),
                                        })
                                    }
                                />
                            </AdminField>
                            {(
                                [
                                    ['capabilities', '能完成的任务'],
                                    ['prerequisites', '使用前准备'],
                                    ['limitations', '条件与限制'],
                                ] as const
                            ).map(([key, label]) => (
                                <AdminField key={key} label={label + '（每行一条）'} layout="stacked">
                                    <AdminTextArea
                                        rows={3}
                                        value={body.skillProfile![key].join('\n')}
                                        onChange={e => updateProfile({ [key]: e.target.value.split('\n') })}
                                    />
                                </AdminField>
                            ))}
                            <AdminField label="示例输入" layout="stacked">
                                <AdminTextArea
                                    value={body.skillProfile.example.input}
                                    onChange={e =>
                                        updateProfile({
                                            example: { ...body.skillProfile!.example, input: e.target.value },
                                        })
                                    }
                                />
                            </AdminField>
                            <AdminField label="预期输出（非实测）" layout="stacked">
                                <AdminTextArea
                                    value={body.skillProfile.example.output}
                                    onChange={e =>
                                        updateProfile({
                                            example: {
                                                ...body.skillProfile!.example,
                                                output: e.target.value,
                                            },
                                        })
                                    }
                                />
                            </AdminField>
                            <p className="text-sm text-slate-500">
                                正文随用途资料更新，修改后需重新核对来源依据并发布。
                            </p>
                        </section>
                    )}
                    <AdminField label="正文（Markdown 标题与纯文本段落）" layout="stacked">
                        <AdminTextArea
                            rows={18}
                            readOnly={Boolean(body.skillProfile)}
                            value={body.body}
                            onChange={e => update({ body: e.target.value })}
                        />
                    </AdminField>
                    <AdminField label="标签（逗号分隔）">
                        <AdminInput
                            value={body.tags.join(',')}
                            onChange={e =>
                                update({
                                    tags: e.target.value
                                        .split(/[,，]/u)
                                        .map(x => x.trim())
                                        .filter(Boolean),
                                })
                            }
                        />
                    </AdminField>
                    <AdminField label="SEO 描述" layout="stacked">
                        <AdminTextArea
                            rows={2}
                            value={body.seoDescription}
                            onChange={e => update({ seoDescription: e.target.value })}
                        />
                    </AdminField>
                    <AdminField label="关联商品 ID（逗号分隔）">
                        <AdminInput
                            value={body.relatedProductIds.join(',')}
                            onChange={e =>
                                update({
                                    relatedProductIds: e.target.value
                                        .split(',')
                                        .map(x => x.trim())
                                        .filter(Boolean),
                                })
                            }
                        />
                    </AdminField>
                    <AdminField label="精选置顶">
                        <AdminInput
                            type="checkbox"
                            checked={body.pinned}
                            onChange={e => update({ pinned: e.target.checked })}
                        />
                    </AdminField>
                    <AdminField label="来源（每行：标题 | HTTPS 地址）" layout="stacked">
                        <AdminTextArea
                            rows={5}
                            value={body.sources.map(x => `${x.label} | ${x.url}`).join('\n')}
                            onChange={e =>
                                update({
                                    sources: e.target.value.split('\n').map(line => {
                                        const [label, url] = line.split('|');
                                        return {
                                            label: label?.trim() ?? '',
                                            url: url?.trim() ?? '',
                                            accessedAt: new Date().toISOString(),
                                        };
                                    }),
                                })
                            }
                        />
                    </AdminField>
                    {!!body.sourceImages?.length && (
                        <section className="space-y-3" aria-label="资讯原图候选">
                            <h3 className="font-semibold">
                                资讯原图候选
                                <FeatureHelpButton title="资讯原图候选" topic="news-blog.images" />
                            </h3>
                            <p className="text-sm text-slate-500">
                                历史采集素材可作为正文配图，列表封面使用分类主题。
                            </p>
                            <div className="grid gap-3 md:grid-cols-2">
                                {body.sourceImages.map(image => (
                                    <div className="space-y-2 rounded-lg bg-slate-50 p-3" key={image.key}>
                                        {image.asset ? (
                                            <img
                                                className="aspect-video w-full object-contain"
                                                src={image.asset.url}
                                                alt={image.alt}
                                            />
                                        ) : (
                                            <p>此历史图片没有本站素材，暂时无法加入正文。</p>
                                        )}
                                        <p className="text-sm">{image.caption || image.alt || '原文配图'}</p>
                                        <a
                                            className="text-sm underline"
                                            href={image.sourcePageUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            查看原文与图片出处 ↗
                                        </a>
                                        {image.credit && <p className="text-sm">{image.credit}</p>}
                                        <div className="flex flex-wrap gap-2">
                                            <AdminButton
                                                disabled={
                                                    !image.asset ||
                                                    busy ||
                                                    body.illustrations.length >= 2 ||
                                                    body.illustrations.some(
                                                        x => x.assetId === image.asset?.assetId,
                                                    )
                                                }
                                                onClick={() =>
                                                    update({
                                                        illustrations: [
                                                            ...body.illustrations,
                                                            {
                                                                ...image.asset!,
                                                                caption: image.caption || image.alt,
                                                            },
                                                        ],
                                                    })
                                                }
                                            >
                                                加入正文配图
                                            </AdminButton>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}
                    {body.cover?.kind === 'SOURCE' && (
                        <label className="flex items-start gap-2">
                            <AdminInput
                                type="checkbox"
                                checked={body.cover.rightsConfirmed === true}
                                onChange={e =>
                                    update({ cover: { ...body.cover!, rightsConfirmed: e.target.checked } })
                                }
                            />
                            已核对封面图片的来源、署名与使用依据
                        </label>
                    )}
                    {body.illustrations.map((image, index) => (
                        <div className="space-y-2" key={image.assetId}>
                            <img className="max-h-48 w-full object-contain" src={image.url} alt={image.alt} />
                            <AdminField label="正文图片说明">
                                <AdminInput
                                    value={image.caption}
                                    onChange={e =>
                                        update({
                                            illustrations: body.illustrations.map((x, i) =>
                                                i === index ? { ...x, caption: e.target.value } : x,
                                            ),
                                        })
                                    }
                                />
                            </AdminField>
                            {image.kind === 'SOURCE' && (
                                <label className="flex items-start gap-2">
                                    <AdminInput
                                        type="checkbox"
                                        checked={image.rightsConfirmed === true}
                                        onChange={e =>
                                            update({
                                                illustrations: body.illustrations.map((x, i) =>
                                                    i === index
                                                        ? { ...x, rightsConfirmed: e.target.checked }
                                                        : x,
                                                ),
                                            })
                                        }
                                    />
                                    已核对此图片的来源、署名与使用依据
                                </label>
                            )}
                            <AdminButton
                                onClick={() =>
                                    update({
                                        illustrations: body.illustrations.filter((_, i) => i !== index),
                                    })
                                }
                            >
                                移除此正文图片
                            </AdminButton>
                        </div>
                    ))}
                    <p className="text-sm text-slate-500">封面按文章分类统一渲染，无需上传或生成图片。</p>
                    <AdminButton
                        className="bg-slate-900 text-white"
                        disabled={busy || server.sourceChanged}
                        onClick={() =>
                            void execute(async () => {
                                const response = await save({
                                    variables: {
                                        input: {
                                            ...(current.id ? { id: current.id } : {}),
                                            slug: current.slug,
                                            expectedVersion: current.version,
                                            draft: body,
                                        },
                                    },
                                });
                                if (!response.data?.saveNewsBlogArticle)
                                    throw new Error('保存结果需重新读取核对');
                                accept(response.data.saveNewsBlogArticle);
                            }, '草稿已保存，尚未公开。')
                        }
                    >
                        保存草稿
                    </AdminButton>
                </div>
                <div className="min-w-0 space-y-4">
                    <h3 className="font-semibold">
                        图文预览与核对
                        <FeatureHelpButton title="图文预览与核对" topic="news-blog.preview" />
                    </h3>
                    <h2 className="break-words text-xl font-semibold">{body.title || '文章标题'}</h2>
                    <p className="text-slate-500">{body.summary}</p>
                    {blogBodySections(body.body).map((section, index) => (
                        <section className="space-y-2" key={section.id}>
                            <div className="flex justify-between gap-2">
                                <h3 className="font-semibold">{section.title}</h3>
                                {!body.skill && (
                                    <AdminButton
                                        disabled={busy || !current.id || server.dirty || server.sourceChanged}
                                        onClick={() => void task('SECTION', { sectionIndex: index })}
                                    >
                                        重写此段
                                    </AdminButton>
                                )}
                            </div>
                            {section.paragraphs.map((text, i) => (
                                <p className="whitespace-pre-wrap break-words" key={i}>
                                    {text}
                                </p>
                            ))}
                        </section>
                    ))}
                    <section className="space-y-2">
                        <h3 className="font-semibold">
                            来源依据
                            <FeatureHelpButton title="来源依据" topic="news-blog.evidence" />
                        </h3>
                        {body.sources.map((source, index) => (
                            <p key={index}>
                                <a
                                    href={/^https:\/\//u.test(source.url) ? source.url : undefined}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="underline"
                                >
                                    {source.label || source.url}
                                </a>
                            </p>
                        ))}
                        {body.facts.map((fact, index) => (
                            <p className="text-sm" key={index}>
                                {fact.text}{' '}
                                <a href={fact.sourceUrl} target="_blank" rel="noopener noreferrer">
                                    来源 ↗
                                </a>
                            </p>
                        ))}
                    </section>
                    {current.issues.length > 0 && (
                        <aside className="rounded-lg bg-amber-50 p-3" role="status">
                            <h3 className="font-semibold">
                                自动检查提示
                                <FeatureHelpButton title="自动检查提示" topic="news-blog.issues" />
                            </h3>
                            <ul>
                                {current.issues.map(issue => (
                                    <li key={issue}>{issue}</li>
                                ))}
                            </ul>
                        </aside>
                    )}
                    {canPublish && (
                        <div className="space-y-3">
                            <AdminField label="已核对来源、图片及自动检查提示">
                                <AdminInput
                                    type="checkbox"
                                    checked={acknowledged === String(current.version)}
                                    onChange={e =>
                                        setAcknowledged(e.target.checked ? String(current.version) : '')
                                    }
                                />
                            </AdminField>
                            <div className="flex flex-wrap gap-2">
                                <AdminButton
                                    disabled={
                                        busy ||
                                        !current.id ||
                                        server.dirty ||
                                        server.sourceChanged ||
                                        acknowledged !== String(current.version)
                                    }
                                    onClick={() =>
                                        void execute(
                                            async () =>
                                                accept(
                                                    (
                                                        await publish({
                                                            variables: {
                                                                id: current.id,
                                                                expectedVersion: current.version,
                                                                acceptIssues: true,
                                                            },
                                                        })
                                                    ).data?.publishNewsBlogArticle,
                                                ),
                                            '文章已审核并发布。',
                                        )
                                    }
                                >
                                    审核并发布
                                </AdminButton>
                                {Boolean(current.published) && (
                                    <AdminButton
                                        disabled={busy || server.dirty || server.sourceChanged}
                                        onClick={() =>
                                            void execute(
                                                async () =>
                                                    accept(
                                                        (
                                                            await withdraw({
                                                                variables: {
                                                                    id: current.id,
                                                                    expectedVersion: current.version,
                                                                },
                                                            })
                                                        ).data?.withdrawNewsBlogArticle,
                                                    ),
                                                '文章已撤稿，历史记录保留。',
                                            )
                                        }
                                    >
                                        撤稿
                                    </AdminButton>
                                )}
                            </div>
                        </div>
                    )}
                    {query.data?.newsBlogHistory.length ? (
                        <details>
                            <summary>发布历史版本</summary>
                            {query.data.newsBlogHistory.map(history => (
                                <details key={history.id}>
                                    <summary>
                                        版本 {history.version} · {history.action} · {history.createdAt}
                                    </summary>
                                    <pre className="overflow-auto whitespace-pre-wrap text-sm">
                                        {history.snapshotJson}
                                    </pre>
                                </details>
                            ))}
                        </details>
                    ) : null}
                </div>
            </div>
        </section>
    );
}
