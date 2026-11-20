import { ArrowRight, ArrowUpRight, BookOpen, Search } from 'lucide-react';
import { type FormEvent, type MouseEvent, type ReactNode } from 'react';

import {
    blogBodySections,
    blogCategories,
    type BlogCitation,
    type BlogCover,
    type BlogListInput,
    type BlogPublicPage,
    type BlogPublishedArticle,
} from '../../../storefront-content-plugin/src/shared/news-blog';
import { publicLocalizedHref } from '../../../storefront-content-plugin/src/shared/public-page-data';
import { PageBackLink } from '../components/common/page-back-link';
import { interceptContentNavigation } from '../content-target-href';
import { languageCodeFor } from '../i18n';
import { SafeImage } from '../safe-image';
import { routeHref } from '../storefront-router';
import { SubHeader, SubpageBody } from '../storefront-ui/page-shell';
import '../styles/blog.css';
import { type StorefrontLanguage } from '../types';

import { blogLabels } from './blog-labels';
import { BlogSkillSections } from './blog-skill-sections';
import { BlogTheme, BlogThemeLibrary } from './blog-theme';

export const blogListBackRoute = (language: StorefrontLanguage) =>
    ({ name: 'services', publicLanguage: language }) as const;

function dateLabel(value: string, language: StorefrontLanguage) {
    return new Date(value).toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US', {
        timeZone: 'Asia/Kuala_Lumpur',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
}
function DateLine({
    article,
    language,
    detail = false,
}: {
    article: BlogPublishedArticle;
    language: StorefrontLanguage;
    detail?: boolean;
}) {
    const t = blogLabels[language];
    const sourceDate = article.category === 'skills' ? null : article.sourcePublishedAt;
    const date = sourceDate ?? article.publishedAt;
    return (
        <p className="blog-meta type-meta">
            <span>
                {sourceDate ? t.newsDate : article.category === 'skills' ? '' : t.published}
                <time dateTime={date}>{dateLabel(date, language)}</time>
            </span>
            {detail && sourceDate && (
                <span>
                    {t.published}
                    <time dateTime={article.publishedAt}>{dateLabel(article.publishedAt, language)}</time>
                </span>
            )}
            <span>{t.readTime(article.readingMinutes)}</span>
        </p>
    );
}
function ArticleLabels({
    article,
    language,
    featured = false,
}: {
    article: BlogPublishedArticle;
    language: StorefrontLanguage;
    featured?: boolean;
}) {
    const t = blogLabels[language];
    return (
        <div className="blog-labels">
            <span className="blog-category-tag type-helper">{t.categories[article.category]}</span>
            {article.skillProfile && (
                <span className="blog-category-tag type-helper">
                    {t.domains[article.skillProfile.domain]}
                </span>
            )}
            <span className="blog-muted type-helper">
                {article.skillProfile
                    ? article.tags
                          .filter(
                              tag =>
                                  tag !== article.skill?.name &&
                                  tag !== t.domains[article.skillProfile?.domain ?? 'general'],
                          )
                          .slice(0, 2)
                          .join(' · ') || t.formats.SKILL
                    : featured
                      ? t.featured
                      : t.formats[article.format]}
            </span>
        </div>
    );
}
function isWebSource(url: string) {
    try {
        const value = new URL(url);
        return (
            (value.protocol === 'https:' || value.protocol === 'http:') && !value.username && !value.password
        );
    } catch {
        return false;
    }
}

function sourceParagraph(line: string, sources: BlogCitation[]) {
    const match = /^\[([^\]\n]+)\]\((\S+)\)$/u.exec(line.trim());
    return match && sources.find(source => source.url === match[2]);
}

function ImageCaption({ image, language }: { image: BlogCover; language: StorefrontLanguage }) {
    const t = blogLabels[language];
    return image.kind === 'SOURCE' && image.sourcePageUrl && isWebSource(image.sourcePageUrl) ? (
        <span>
            {t.source}
            <a href={image.sourcePageUrl} target="_blank" rel="noopener noreferrer">
                {t.sourceImage} ↗
            </a>
            {image.credit ? ` · ${image.credit}` : ''}
        </span>
    ) : (
        <span>{image.kind === 'TEMPLATE' ? t.cover : image.generated ? t.generatedImage : t.image}</span>
    );
}
function ArticleDirectory({
    headings,
    className,
    language,
}: {
    headings: ReadonlyArray<{ id: string; title: string }>;
    className: string;
    language: StorefrontLanguage;
}) {
    const t = blogLabels[language];
    if (headings.length <= 3) return null;
    return (
        <details className={`blog-toc ${className}`}>
            <summary className="type-label">
                {t.contents} <span className="blog-muted type-meta">{t.sections(headings.length)}</span>
            </summary>
            <nav aria-label={t.contents}>
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
    );
}
export function BlogContent({
    page,
    input = {},
    language = 'zh',
    onNavigate,
    onBackToServices,
}: {
    page: BlogPublicPage;
    input?: BlogListInput;
    language?: StorefrontLanguage;
    onNavigate?: (url: string) => void;
    onBackToServices?: () => void;
}) {
    const t = blogLabels[language];
    const locale = language === 'zh' ? 'zh-CN' : 'en-US';
    const href = (slug?: string) =>
        publicLocalizedHref(slug ? `/blog/${encodeURIComponent(slug)}` : '/blog', languageCodeFor(language));
    const link = (url: string, action = onNavigate && (() => onNavigate(url))) => ({
        href: url,
        onClick: action
            ? (event: MouseEvent<HTMLAnchorElement>) => interceptContentNavigation(event, action)
            : undefined,
    });
    function renderPage(content: ReactNode) {
        const article = page.article;
        const backHref = article
            ? href() + `?category=${article.category}`
            : routeHref(blogListBackRoute(language));
        const backLabel = article ? t.backToBlog : t.backToServices;
        return (
            <main
                className={article ? 'page subpage blog-page blog-detail-page' : 'page subpage blog-page'}
                aria-label={article?.title ?? page.title}
            >
                <SubHeader
                    title={article ? (article.skill ? t.skill : t.article) : t.blog}
                    language={language}
                    back={
                        <PageBackLink
                            {...link(backHref, article ? undefined : onBackToServices)}
                            label={backLabel}
                        />
                    }
                    backLabel={backLabel}
                />
                <SubpageBody>{content}</SubpageBody>
            </main>
        );
    }
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
                aria-label={t.readLabel + article.title}
            >
                <BlogTheme language={language} article={article} featured={isFeatured} />
            </a>
            <div className="blog-card-copy">
                <ArticleLabels language={language} article={article} featured={isFeatured} />
                <h2 className={isFeatured ? 'type-page' : 'type-section'}>
                    <a {...link(href(article.slug))}>{article.skillProfile?.displayName ?? article.title}</a>
                </h2>
                {article.skill && <p className="blog-skill-name type-meta">{article.skill.name}</p>}
                <p className="blog-card-summary type-body">
                    {article.skillProfile?.purpose ?? article.summary}
                </p>
                {article.skillProfile && (
                    <p className="blog-muted type-helper">
                        {t.audience}
                        {article.skillProfile.audience}
                    </p>
                )}
                {article.skill && (
                    <p className="blog-skill-metric type-helper">
                        <span aria-hidden="true">★</span> {t.repository}{' '}
                        {article.skill.stars.toLocaleString(locale)} {language === 'zh' ? 'Star' : 'stars'}{' '}
                        <span className="blog-muted">
                            {article.skill.trend === 'RECENT' ? t.recent : t.evergreen}
                        </span>
                    </p>
                )}
                <div className={`blog-card-footer${article.skill ? ' blog-card-footer-skill' : ''}`}>
                    <DateLine language={language} article={article} />
                    <div className="blog-card-actions">
                        <a className="blog-read-link type-action" {...link(href(article.slug))}>
                            {article.skill ? t.use : t.read} <ArrowRight aria-hidden="true" />
                        </a>
                        {article.skill && (
                            <a
                                className="blog-primary-link type-action"
                                href={article.skill.repositoryUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                {t.github} <ArrowUpRight aria-hidden="true" />
                            </a>
                        )}
                    </div>
                </div>
            </div>
        </article>
    );
    if (page.article) {
        const article = page.article;
        const sources = article.sources.filter(source => isWebSource(source.url));
        const sections = blogBodySections(article.body).filter(
            section =>
                !(
                    /^(?:参考来源|来源|sources|references)$/iu.test(section.title.trim()) &&
                    section.paragraphs.every(line => sourceParagraph(line, sources))
                ),
        );
        const isSkill = article.category === 'skills';
        const overviewLines = isSkill
            ? sections.find(
                  section => section.title === (language === 'zh' ? '解决什么问题' : 'What it solves'),
              )?.paragraphs
            : undefined;
        const showAudience =
            article.skillProfile && !overviewLines?.includes(t.audience + article.skillProfile.audience);
        const summaryInBody = isSkill
            ? overviewLines?.includes(article.summary)
            : sections[0]?.paragraphs[0]?.trim() === article.summary.trim();
        const headings = sections.filter(section => section.title);
        const updatedAt = article.updatedAt ?? article.reviewedAt ?? article.publishedAt;
        return renderPage(
            <>
                <BlogThemeLibrary language={language} />
                <article className="blog-article" data-skill-guide={isSkill || undefined}>
                    <header className="blog-article-header">
                        <ArticleLabels language={language} article={article} />
                        <h1 className="type-page">{article.skillProfile?.displayName ?? article.title}</h1>
                        {article.skill && <p className="blog-skill-name type-helper">{article.skill.name}</p>}
                        {!summaryInBody && (
                            <p className="blog-article-summary type-reading">{article.summary}</p>
                        )}
                        {article.skillProfile &&
                            (showAudience || article.skillProfile.industries.length > 0) && (
                                <p className="blog-profile-audience type-body">
                                    {showAudience && (
                                        <>
                                            <strong>{t.audienceTitle}</strong>
                                            {article.skillProfile.audience}
                                        </>
                                    )}
                                    {article.skillProfile.industries.length > 0 && (
                                        <span>
                                            {showAudience && ' · '}
                                            {t.industries}
                                            {article.skillProfile.industries.join(
                                                language === 'zh' ? '、' : ', ',
                                            )}
                                        </span>
                                    )}
                                </p>
                            )}
                        <DateLine language={language} article={article} detail />
                        {article.skill && (
                            <a
                                className="blog-detail-github blog-primary-link type-action"
                                href={article.skill.repositoryUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                {t.github} <ArrowUpRight aria-hidden="true" />
                            </a>
                        )}
                        <p className="blog-attribution type-helper">
                            {article.publicationMode === 'AUTOMATIC'
                                ? article.skillProfile
                                    ? t.editorial
                                    : t.automatic
                                : t.reviewed(article.reviewerName)}
                            <span>
                                {t.updated} <time dateTime={updatedAt}>{dateLabel(updatedAt, language)}</time>
                            </span>
                        </p>
                    </header>
                    <ArticleDirectory language={language} headings={headings} className="blog-toc-inline" />
                    <div className="blog-article-cover">
                        <BlogTheme language={language} article={article} />
                    </div>
                    <aside className="blog-sidebar">
                        {article.skill && (
                            <section className="blog-skill-info" aria-label={t.skillInfo}>
                                <span className="blog-muted type-helper">
                                    {article.skill.trend === 'RECENT'
                                        ? t.recent + ' Skill'
                                        : t.evergreen + ' Skill'}
                                </span>
                                <p className="blog-muted type-body">{article.skill.repository}</p>
                                <p className="blog-muted type-helper">
                                    {language === 'zh' ? 'GitHub 仓库' : 'GitHub repository'}{' '}
                                    {article.skill.stars.toLocaleString(locale)}{' '}
                                    {language === 'zh' ? 'Star' : 'stars'}
                                </p>
                                <a
                                    className="blog-primary-link type-action"
                                    href={article.skill.repositoryUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    {t.github} <ArrowUpRight aria-hidden="true" />
                                </a>
                                <a
                                    className="blog-read-link type-label"
                                    href={article.skill.directoryUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    {t.directory} <ArrowUpRight aria-hidden="true" />
                                </a>
                                <p className="blog-skill-evidence type-helper">
                                    <a
                                        href={article.skill.rankingUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        {t.ranking(article.skill.rankingLabel, article.skill.rank)} ↗
                                    </a>
                                    <span className="blog-muted">
                                        {t.collected}{' '}
                                        <time dateTime={article.skill.observedAt}>
                                            {dateLabel(article.skill.observedAt, language)}
                                        </time>
                                    </span>
                                </p>
                            </section>
                        )}
                        <ArticleDirectory
                            language={language}
                            headings={headings}
                            className="blog-toc-sidebar"
                        />
                    </aside>
                    <div className="blog-reading-body">
                        {isSkill ? (
                            <BlogSkillSections sections={sections} />
                        ) : (
                            sections.map(section => (
                                <section key={section.id} id={section.id}>
                                    {section.title && <h2 className="type-section">{section.title}</h2>}
                                    {section.paragraphs.map((paragraph, index) => {
                                        const source = sourceParagraph(paragraph, sources);
                                        return (
                                            <p className="type-reading" key={index}>
                                                {source ? (
                                                    <a
                                                        href={source.url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                    >
                                                        {source.label}
                                                    </a>
                                                ) : (
                                                    paragraph
                                                )}
                                            </p>
                                        );
                                    })}
                                </section>
                            ))
                        )}
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
                                    {image.caption} <ImageCaption language={language} image={image} />
                                </figcaption>
                            </figure>
                        ))}
                        {article.tags.length > 0 && (
                            <div className="blog-tags" aria-label={t.tags}>
                                {article.tags.map(tag => (
                                    <span className="type-helper" key={tag}>
                                        #{tag}
                                    </span>
                                ))}
                            </div>
                        )}
                        {sources.length > 0 && (
                            <section className="blog-sources">
                                <h2 className="type-section">{t.sources}</h2>
                                <ol>
                                    {sources.map(source => (
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
                        )}
                        {article.relatedProductIds.length > 0 && (
                            <section className="blog-related-services">
                                <h2 className="type-section">{t.services}</h2>
                                {article.relatedProductIds.map(id => (
                                    <a
                                        className="blog-read-link type-action"
                                        key={id}
                                        {...link(
                                            publicLocalizedHref(
                                                `/product?id=${encodeURIComponent(id)}`,
                                                languageCodeFor(language),
                                            ),
                                        )}
                                    >
                                        {t.viewService} <ArrowRight aria-hidden="true" />
                                    </a>
                                ))}
                            </section>
                        )}
                        <a
                            className="blog-back-link type-action"
                            {...link(href() + `?category=${article.category}`)}
                        >
                            {t.moreCategory(t.categories[article.category])} <ArrowRight aria-hidden="true" />
                        </a>
                    </div>
                </article>
                {page.relatedArticles.length > 0 && (
                    <section className="blog-results" aria-labelledby="blog-related-title">
                        <div className="blog-section-heading">
                            <h2 className="type-section" id="blog-related-title">
                                {t.keepReading}
                            </h2>
                            <a className="blog-read-link type-label" {...link(href())}>
                                {t.allArticles} <ArrowRight aria-hidden="true" />
                            </a>
                        </div>
                        <div className="blog-grid">{page.relatedArticles.map(x => card(x))}</div>
                    </section>
                )}
            </>,
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
    const categoryLabel = t.categories[input.category as keyof typeof t.categories];
    const resultTitle = input.term ? t.results(input.term) : (categoryLabel ?? t.latest);
    const currentPage = Math.floor((input.skip ?? 0) / 12) + 1;
    const totalPages = Math.max(1, Math.ceil(page.totalItems / 12));
    return renderPage(
        <>
            {(featured || items.length > 0) && <BlogThemeLibrary language={language} />}
            <h1 className="sr-only">{page.title}</h1>
            <div className="blog-toolbar">
                <nav className="blog-categories" aria-label={t.categoryNav}>
                    {['', ...blogCategories].map(category => (
                        <a
                            className="type-label"
                            key={category}
                            aria-current={(input.category ?? '') === category ? 'page' : undefined}
                            {...link(listUrl({ category, skip: 0 }))}
                        >
                            {category ? t.categories[category as keyof typeof t.categories] : t.all}
                        </a>
                    ))}
                </nav>
                <form
                    className="blog-search"
                    action={href()}
                    method="get"
                    role="search"
                    aria-label={t.searchLabel}
                    onSubmit={submit}
                >
                    <label className="sr-only" htmlFor="blog-search">
                        {t.searchLabel}
                    </label>
                    <Search aria-hidden="true" />
                    <input
                        id="blog-search"
                        className="type-input"
                        name="term"
                        type="search"
                        placeholder={t.placeholder}
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
                            {t.clear}
                        </a>
                    )}
                    <button className="type-label" type="submit">
                        {t.search}
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
                                    ? t.notFound
                                    : input.category === 'skills'
                                      ? t.pendingSkills
                                      : t.pendingNews}
                            </h3>
                            <p className="blog-muted type-body">{input.term ? t.trySearch : t.tryArticles}</p>
                            <a className="blog-primary-link type-action" {...link(href())}>
                                {t.browse} <ArrowRight aria-hidden="true" />
                            </a>
                        </div>
                    )}
                </section>
            )}
            {totalPages > 1 && (
                <nav className="blog-pagination" aria-label={t.pagination}>
                    {(input.skip ?? 0) > 0 ? (
                        <a
                            className="blog-page-link type-action"
                            {...link(listUrl({ skip: Math.max(0, (input.skip ?? 0) - 12) }))}
                        >
                            ← {t.previous}
                        </a>
                    ) : (
                        <span className="blog-page-link type-action" aria-disabled="true">
                            ← {t.previous}
                        </span>
                    )}
                    <span className="blog-muted type-helper">{t.pageNumber(currentPage, totalPages)}</span>
                    {(input.skip ?? 0) + 12 < page.totalItems ? (
                        <a
                            className="blog-page-link type-action"
                            {...link(listUrl({ skip: (input.skip ?? 0) + 12 }))}
                        >
                            {t.next} →
                        </a>
                    ) : (
                        <span className="blog-page-link type-action" aria-disabled="true">
                            {t.next} →
                        </span>
                    )}
                </nav>
            )}
        </>,
    );
}
