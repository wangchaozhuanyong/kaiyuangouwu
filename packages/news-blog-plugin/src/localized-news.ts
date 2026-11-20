import type {
    BlogCover,
    BlogDraft,
    BlogNewsEdition,
    BlogPublishedArticle,
} from '@vendure/storefront-content-plugin';

import { reviewedNewsForSource } from './reviewed-news';

/** Match the old automatic brief only. Manual articles can cite exactly the same official URL. */
export function reviewedLegacyNews(article: BlogPublishedArticle) {
    if (
        article.publicationMode !== 'AUTOMATIC' ||
        article.category === 'skills' ||
        article.format !== 'NEWS' ||
        article.translations?.en ||
        !article.tags.includes('来源快讯') ||
        !article.title.includes(' 官方动态：') ||
        !article.summary.includes('本条快讯保留可核对的原文要点与来源入口') ||
        !article.body.includes('本文根据官方来源整理，原文入口见文末。')
    )
        return undefined;
    const evidence = [article.title, article.body, ...article.facts.map(fact => fact.quote ?? '')].join('\n');
    for (const source of article.sources) {
        const edition = reviewedNewsForSource(source.url, evidence);
        if (edition) return edition;
    }
    return undefined;
}

export function editionText(article: BlogNewsEdition): string {
    return [article.title, article.summary, ...article.tags].join(' ').toLowerCase();
}
export function englishNewsEdition(article: BlogPublishedArticle): BlogNewsEdition | undefined {
    if (article.category === 'skills') return;
    return article.translations?.en ?? reviewedLegacyNews(article)?.en;
}

export function changedNewsCopy(previous: BlogDraft, next: BlogDraft): boolean {
    return (
        previous.title !== next.title ||
        previous.summary !== next.summary ||
        previous.body !== next.body ||
        previous.seoDescription !== next.seoDescription ||
        JSON.stringify(previous.tags) !== JSON.stringify(next.tags) ||
        JSON.stringify(previous.sources.map(s => s.url)) !== JSON.stringify(next.sources.map(s => s.url))
    );
}

export function editableBlogSnapshots(
    draft: BlogDraft,
    published: BlogPublishedArticle | null,
    state: string,
) {
    const reviewed = published && reviewedLegacyNews(published);
    if (!published || !reviewed) return { draft, published };
    // Keep editorial evidence, media, ownership and version metadata on their own snapshots.
    const copy = { ...reviewed.zh, candidateTitles: [reviewed.zh.title], translations: { en: reviewed.en } };
    const untouched =
        state === 'PUBLISHED' &&
        !draft.translations &&
        draft.category === published.category &&
        draft.format === published.format &&
        !changedNewsCopy(draft, published) &&
        JSON.stringify(draft.sources) === JSON.stringify(published.sources) &&
        JSON.stringify(draft.facts) === JSON.stringify(published.facts) &&
        JSON.stringify(draft.candidateTitles) === JSON.stringify(published.candidateTitles);
    return { draft: untouched ? { ...draft, ...copy } : draft, published: { ...published, ...copy } };
}

const chinese = /[\u3400-\u9fff]/u;
function englishMedia<T extends BlogCover>(image: T): T {
    return chinese.test(image.alt) ? { ...image, alt: 'Article illustration' } : image;
}

export function projectBlogArticle(
    article: BlogPublishedArticle,
    english: boolean,
    detail: boolean,
): BlogPublishedArticle | undefined {
    const { sourceImages: _privateImages, translations: _editions, ...published } = article;
    const edition = english ? englishNewsEdition(article) : reviewedLegacyNews(article)?.zh;
    if (english && !edition) return undefined;
    // Only reader-visible fields from the requested edition leave the server.
    const selected = {
        ...published,
        ...(edition
            ? {
                  title: edition.title,
                  summary: edition.summary,
                  body: edition.body,
                  seoDescription: edition.seoDescription,
                  tags: edition.tags,
                  readingMinutes: Math.max(
                      1,
                      Math.ceil(
                          english
                              ? edition.body.split(/\s+/u).length / 220
                              : Array.from(edition.body).length / 450,
                      ),
                  ),
              }
            : {}),
        candidateTitles: [],
        facts: [],
    };
    if (english && selected.cover) selected.cover = englishMedia(selected.cover);
    if (!detail) return { ...selected, body: '', sources: [], illustrations: [], relatedProductIds: [] };
    if (english) {
        selected.sources = selected.sources.map(source => ({
            ...source,
            label: chinese.test(source.label) ? new URL(source.url).hostname : source.label,
        }));
        selected.illustrations = selected.illustrations.map(image => ({
            ...englishMedia(image),
            caption: chinese.test(image.caption) ? '' : image.caption,
        }));
    }
    return selected;
}
