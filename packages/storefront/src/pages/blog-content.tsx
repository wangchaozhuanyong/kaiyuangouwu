import { ArrowRight, ArrowUpRight, BookOpen, Search } from 'lucide-react';
import { type FormEvent, type MouseEvent } from 'react';

import {
    blogBodySections,
    blogCategories,
    blogCategoryLabels,
    skillDomains,
    type BlogCover,
    type BlogFormat,
    type BlogListInput,
    type BlogPublicPage,
    type BlogPublishedArticle,
} from '../../../storefront-content-plugin/src/shared/news-blog';
import { publicLocalizedHref } from '../../../storefront-content-plugin/src/shared/public-page-data';
import { PageBackLink } from '../components/common/page-back-link';
import { SafeImage } from '../safe-image';
import { SubHeader } from '../storefront-ui/page-shell';
import '../styles/blog.css';

import { BlogTheme, BlogThemeLibrary } from './blog-theme';

const href = (slug?: string) =>
    publicLocalizedHref(slug ? `/blog/${encodeURIComponent(slug)}` : '/blog', 'zh_Hans');
const dateLabel = (value: string) =>
    new Date(value).toLocaleDateString('zh-CN', {
        timeZone: 'Asia/Kuala_Lumpur',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
const formatLabels: Record<BlogFormat, string> = {
    NEWS: '快讯',
    ANALYSIS: '更新解读',
    GUIDE: '使用指南',
    COMPARISON: '对比分析',
    SKILL: '用途指南',
};
function DateLine({ article }: { article: BlogPublishedArticle }) {
    return (
        <p className="blog-meta type-meta">
            <time dateTime={article.publishedAt}>{dateLabel(article.publishedAt)}</time>
            <span>约 {article.readingMinutes} 分钟阅读</span>
        </p>
    );
}
function ArticleLabels({ article, featured = false }: { article: BlogPublishedArticle; featured?: boolean }) {
    return (
        <div className="blog-labels">
            <span className="blog-category-tag type-helper">{blogCategoryLabels[article.category]}</span>
            {article.skillProfile && (
                <span className="blog-category-tag type-helper">
                    {skillDomains[article.skillProfile.domain]}
                </span>
            )}
            <span className="blog-muted type-helper">
                {article.skillProfile
                    ? article.tags
                          .filter(
                              tag =>
                                  tag !== article.skill?.name &&
                                  tag !== skillDomains[article.skillProfile?.domain ?? 'general'],
                          )
                          .slice(0, 2)
                          .join(' · ') || '用途指南'
                    : featured
                      ? '本期精选'
                      : formatLabels[article.format]}
            </span>
        </div>
    );
}
function ImageCaption({ image }: { image: BlogCover }) {
    return image.kind === 'SOURCE' && image.sourcePageUrl ? (
        <span>
            来源：
            <a href={image.sourcePageUrl} target="_blank" rel="noopener noreferrer">
                原文配图 ↗
            </a>
            {image.credit ? ` · ${image.credit}` : ''}
        </span>
    ) : (
        <span>{image.kind === 'TEMPLATE' ? '主题封面' : image.generated ? 'AI 示意图' : '文章配图'}</span>
    );
}
export function BlogContent({
    page,
    input = {},
    onNavigate,
}: {
    page: BlogPublicPage;
    input?: BlogListInput;
    onNavigate?: (url: string) => void;
}) {
    const navigate = (url: string) => (event: MouseEvent<HTMLAnchorElement>) => {
        if (
            onNavigate &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.shiftKey &&
            !event.altKey &&
            event.button === 0
        ) {
            event.preventDefault();
            onNavigate(url);
        }
    };
    const link = (url: string) => ({ href: url, onClick: navigate(url) });
    const listUrl = (patch: Partial<BlogListInput>) => {
        const state = { ...input, ...patch };
        const q = new URLSearchParams();
        if (state.term) q.set('term', state.term);
        if (state.category) q.set('category', state.category);
        if (state.skip) q.set('page', String(Math.floor(state.skip / 12) + 1));
        return href() + (q.size ? `?${q}` : '');
    };
    const card = (article: BlogPublishedArticle, isFeatured = false) => (
        <article className={isFeatured ? 'blog-feature' : 'blog-card'} key={article.id}>
            <a
                {...link(href(article.slug))}
                className="blog-cover"
                data-image-kind={article.cover?.kind}
                aria-label={`阅读：${article.title}`}
            >
                <BlogTheme article={article} />
            </a>
            <div className="blog-card-copy">
                <ArticleLabels article={article} featured={isFeatured} />
                <h2 className={isFeatured ? 'type-page' : 'type-section'}>
                    <a {...link(href(article.slug))}>{article.skillProfile?.displayName ?? article.title}</a>
                </h2>
                {article.skill && <p className="blog-skill-name type-meta">{article.skill.name}</p>}
                <p className="blog-card-summary type-body">
                    {article.skillProfile?.purpose ?? article.summary}
                </p>
                {article.skillProfile && (
                    <p className="blog-muted type-helper">适合：{article.skillProfile.audience}</p>
                )}
                {article.skill && (
                    <p className="blog-skill-metric type-helper">
                        <span aria-hidden="true">★</span> 仓库 {article.skill.stars.toLocaleString('zh-CN')}{' '}
                        Star{' '}
                        <span className="blog-muted">
                            {article.skill.trend === 'RECENT' ? '近期热门' : '长期热门'}
                        </span>
                    </p>
                )}
                <div className={`blog-card-footer${article.skill ? ' blog-card-footer-skill' : ''}`}>
                    <DateLine article={article} />
                    <div className="blog-card-actions">
                        <a className="blog-read-link type-action" {...link(href(article.slug))}>
                            {article.skill ? '了解用途' : '阅读全文'} <ArrowRight aria-hidden="true" />
                        </a>
                        {article.skill && (
                            <a
                                className="blog-primary-link type-action"
                                href={article.skill.repositoryUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                查看 GitHub 仓库 <ArrowUpRight aria-hidden="true" />
                            </a>
                        )}
                    </div>
                </div>
            </div>
        </article>
    );
    if (page.article) {
        const article = page.article;
        const sections = blogBodySections(article.body);
        const headings = sections.filter(section => section.title);
        const updatedAt = article.updatedAt ?? article.reviewedAt ?? article.publishedAt;
        return (
            <main className="page subpage blog-page blog-detail-page" aria-label={article.title}>
                <BlogThemeLibrary />
                <SubHeader
                    title={article.skill ? 'Skill 介绍' : '资讯详情'}
                    language="zh"
                    back={
                        <PageBackLink
                            href={href() + `?category=${article.category}`}
                            onClick={navigate(href() + `?category=${article.category}`)}
                            label="返回新闻博客"
                        />
                    }
                    backLabel="返回新闻博客"
                />
                <nav className="blog-breadcrumb type-label" aria-label="当前位置">
                    <a {...link(href())}>← 新闻博客</a>
                    <span aria-hidden="true">/</span>
                    <a {...link(href() + `?category=${article.category}`)}>
                        {blogCategoryLabels[article.category]}
                    </a>
                    <span aria-hidden="true">/</span>
                    <span className="blog-muted">正文</span>
                </nav>
                <article className="blog-article">
                    <header className="blog-article-header">
                        <ArticleLabels article={article} />
                        <h1 className="type-page">{article.skillProfile?.displayName ?? article.title}</h1>
                        {article.skill && <p className="blog-skill-name type-helper">{article.skill.name}</p>}
                        <p className="blog-article-summary type-reading">{article.summary}</p>
                        {article.skillProfile && (
                            <p className="blog-profile-audience type-body">
                                <strong>适合谁：</strong>
                                {article.skillProfile.audience}
                                {article.skillProfile.industries.length > 0 && (
                                    <span> · 适用行业：{article.skillProfile.industries.join('、')}</span>
                                )}
                            </p>
                        )}
                        <DateLine article={article} />
                        {article.skill && (
                            <a
                                className="blog-detail-github blog-primary-link type-action"
                                href={article.skill.repositoryUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                查看 GitHub 仓库 <ArrowUpRight aria-hidden="true" />
                            </a>
                        )}
                        <p className="blog-attribution type-helper">
                            {article.publicationMode === 'AUTOMATIC'
                                ? article.skillProfile
                                    ? '中文编辑整理'
                                    : '自动整理'
                                : `AI 整理 · ${article.reviewerName ?? '编辑'} 审核`}
                            <span>
                                更新于 <time dateTime={updatedAt}>{dateLabel(updatedAt)}</time>
                            </span>
                        </p>
                    </header>
                    <div className="blog-article-cover">
                        <BlogTheme article={article} />
                    </div>
                    <aside className="blog-sidebar">
                        {article.skill && (
                            <section className="blog-skill-info" aria-label="Skill 来源与热度">
                                <span className="blog-muted type-helper">
                                    {article.skill.trend === 'RECENT' ? '近期热门 Skill' : '长期热门 Skill'}
                                </span>
                                <p className="blog-muted type-body">{article.skill.repository}</p>
                                <p className="blog-muted type-helper">
                                    GitHub 仓库 {article.skill.stars.toLocaleString('zh-CN')} Star
                                </p>
                                <a
                                    className="blog-primary-link type-action"
                                    href={article.skill.repositoryUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    查看 GitHub 仓库 <ArrowUpRight aria-hidden="true" />
                                </a>
                                <a
                                    className="blog-read-link type-label"
                                    href={article.skill.directoryUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    查看 Skill 目录 <ArrowUpRight aria-hidden="true" />
                                </a>
                                <p className="blog-skill-evidence type-helper">
                                    <a
                                        href={article.skill.rankingUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        {article.skill.rankingLabel} 榜单第 {article.skill.rank} 名 ↗
                                    </a>
                                    <span className="blog-muted">
                                        采集于{' '}
                                        <time dateTime={article.skill.observedAt}>
                                            {dateLabel(article.skill.observedAt)}
                                        </time>
                                    </span>
                                </p>
                            </section>
                        )}
                        {headings.length > 3 && (
                            <details className="blog-toc">
                                <summary className="type-label">
                                    文章目录{' '}
                                    <span className="blog-muted type-meta">{headings.length} 节</span>
                                </summary>
                                <nav aria-label="文章目录">
                                    {headings.map((section, index) => (
                                        <a className="type-label" key={section.id} href={`#${section.id}`}>
                                            <span className="blog-toc-number type-meta" aria-hidden="true">
                                                {String(index + 1).padStart(2, '0')}
                                            </span>
                                            {section.title}
                                        </a>
                                    ))}
                                </nav>
                            </details>
                        )}
                    </aside>
                    <div className="blog-reading-body">
                        {sections.map(section => (
                            <section key={section.id} id={section.id}>
                                {section.title && <h2 className="type-section">{section.title}</h2>}
                                {section.paragraphs.map((paragraph, index) => (
                                    <p className="type-reading" key={index}>
                                        {paragraph}
                                    </p>
                                ))}
                            </section>
                        ))}
                        {article.illustrations.map(image => (
                            <figure className="blog-inline-figure" key={image.assetId}>
                                <SafeImage
                                    src={image.url}
                                    alt={image.alt}
                                    loading="lazy"
                                    width={1600}
                                    height={900}
                                />
                                <figcaption className="blog-muted type-meta">
                                    {image.caption} <ImageCaption image={image} />
                                </figcaption>
                            </figure>
                        ))}
                        {article.tags.length > 0 && (
                            <div className="blog-tags" aria-label="文章标签">
                                {article.tags.map(tag => (
                                    <span className="type-helper" key={tag}>
                                        #{tag}
                                    </span>
                                ))}
                            </div>
                        )}
                        <section className="blog-sources">
                            <h2 className="type-section">参考来源</h2>
                            <ol>
                                {article.sources.map(source => (
                                    <li key={source.url}>
                                        <a
                                            className="type-body"
                                            href={source.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            {source.label} <ArrowUpRight aria-hidden="true" />
                                        </a>
                                    </li>
                                ))}
                            </ol>
                        </section>
                        {article.relatedProductIds.length > 0 && (
                            <section className="blog-related-services">
                                <h2 className="type-section">相关服务</h2>
                                {article.relatedProductIds.map(id => (
                                    <a
                                        className="blog-read-link type-action"
                                        key={id}
                                        {...link(
                                            publicLocalizedHref(
                                                `/product?id=${encodeURIComponent(id)}`,
                                                'zh_Hans',
                                            ),
                                        )}
                                    >
                                        查看相关服务 <ArrowRight aria-hidden="true" />
                                    </a>
                                ))}
                            </section>
                        )}
                        <a
                            className="blog-back-link type-action"
                            {...link(href() + `?category=${article.category}`)}
                        >
                            更多{blogCategoryLabels[article.category]} <ArrowRight aria-hidden="true" />
                        </a>
                    </div>
                </article>
                {page.relatedArticles.length > 0 && (
                    <section className="blog-results" aria-labelledby="blog-related-title">
                        <div className="blog-section-heading">
                            <h2 className="type-section" id="blog-related-title">
                                继续阅读
                            </h2>
                            <a className="blog-read-link type-label" {...link(href())}>
                                全部文章 <ArrowRight aria-hidden="true" />
                            </a>
                        </div>
                        <div className="blog-grid">{page.relatedArticles.map(x => card(x))}</div>
                    </section>
                )}
            </main>
        );
    }
    const submit = (event: FormEvent<HTMLFormElement>) => {
        if (onNavigate) {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const term = data.get('term');
            onNavigate(listUrl({ term: typeof term === 'string' ? term.trim() : '', skip: 0 }));
        }
    };
    const featured = !input.term && !input.category && !input.skip ? page.featured : null;
    // The featured item already belongs to this page; keep pagination totals intact.
    const items = page.items.filter(article => article.id !== featured?.id);
    const categoryLabel = blogCategoryLabels[input.category as keyof typeof blogCategoryLabels];
    const resultTitle = input.term ? `“${input.term}”的搜索结果` : (categoryLabel ?? '最新发布');
    const currentPage = Math.floor((input.skip ?? 0) / 12) + 1;
    const totalPages = Math.max(1, Math.ceil(page.totalItems / 12));
    return (
        <main className="page subpage blog-page" aria-label={page.title}>
            {(featured || items.length > 0) && <BlogThemeLibrary />}
            <h1 className="sr-only">{page.title}</h1>
            <SubHeader
                title="新闻博客"
                language="zh"
                back={
                    <PageBackLink
                        href={publicLocalizedHref('/', 'zh_Hans')}
                        onClick={navigate(publicLocalizedHref('/', 'zh_Hans'))}
                        label="返回首页"
                    />
                }
                backLabel="返回首页"
            />
            <div className="blog-toolbar">
                <nav className="blog-categories" aria-label="文章分类">
                    {['', ...blogCategories].map(category => (
                        <a
                            className="type-label"
                            key={category}
                            aria-current={(input.category ?? '') === category ? 'page' : undefined}
                            {...link(listUrl({ category, skip: 0 }))}
                        >
                            {category
                                ? blogCategoryLabels[category as keyof typeof blogCategoryLabels]
                                : '全部'}
                        </a>
                    ))}
                </nav>
                <form
                    className="blog-search"
                    action={href()}
                    method="get"
                    role="search"
                    aria-label="搜索文章"
                    onSubmit={submit}
                >
                    <label className="sr-only" htmlFor="blog-search">
                        搜索文章
                    </label>
                    <Search aria-hidden="true" />
                    <input
                        id="blog-search"
                        className="type-input"
                        name="term"
                        type="search"
                        placeholder="搜索文章或 Skill"
                        defaultValue={input.term ?? ''}
                        key={input.term ?? ''}
                        onKeyDown={event => {
                            if (event.key === 'Enter' && event.nativeEvent.isComposing)
                                event.preventDefault();
                        }}
                    />
                    {input.category && <input type="hidden" name="category" value={input.category} />}
                    {input.term && (
                        <a className="blog-read-link type-label" {...link(listUrl({ term: '', skip: 0 }))}>
                            清除搜索
                        </a>
                    )}
                    <button className="type-label" type="submit">
                        搜索
                    </button>
                </form>
            </div>
            {featured && card(featured, true)}
            {(items.length > 0 || !featured) && (
                <section className="blog-results" aria-label={resultTitle}>
                    {items.length ? (
                        <div className="blog-grid">{items.map(x => card(x))}</div>
                    ) : (
                        <div className="blog-empty" role="status">
                            <span className="blog-empty-icon" aria-hidden="true">
                                {input.term ? <Search /> : <BookOpen />}
                            </span>
                            <h3 className="type-section">
                                {input.term
                                    ? '没有找到相关文章'
                                    : input.category === 'skills'
                                      ? '热门 Skill 正在整理中'
                                      : '文章正在整理中'}
                            </h3>
                            <p className="blog-muted type-body">
                                {input.term
                                    ? '试试产品名称、功能或用途，也可以浏览其他分类。'
                                    : '新内容发布后会显示在这里，先看看其他文章吧。'}
                            </p>
                            <a className="blog-primary-link type-action" {...link(href())}>
                                浏览全部文章 <ArrowRight aria-hidden="true" />
                            </a>
                        </div>
                    )}
                </section>
            )}
            {totalPages > 1 && (
                <nav className="blog-pagination" aria-label="文章分页">
                    {(input.skip ?? 0) > 0 ? (
                        <a
                            className="blog-page-link type-action"
                            {...link(listUrl({ skip: Math.max(0, (input.skip ?? 0) - 12) }))}
                        >
                            ← 上一页
                        </a>
                    ) : (
                        <span className="blog-page-link type-action" aria-disabled="true">
                            ← 上一页
                        </span>
                    )}
                    <span className="blog-muted type-helper">
                        第 {currentPage} / {totalPages} 页
                    </span>
                    {(input.skip ?? 0) + 12 < page.totalItems ? (
                        <a
                            className="blog-page-link type-action"
                            {...link(listUrl({ skip: (input.skip ?? 0) + 12 }))}
                        >
                            下一页 →
                        </a>
                    ) : (
                        <span className="blog-page-link type-action" aria-disabled="true">
                            下一页 →
                        </span>
                    )}
                </nav>
            )}
        </main>
    );
}
