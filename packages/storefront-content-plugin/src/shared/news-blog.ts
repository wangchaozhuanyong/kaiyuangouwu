/** Public news content. Never add drafts, credentials, costs or collection logs here. */
export const BLOG_READER = Symbol.for('vendure.news-blog.public-reader');
export const blogCategories = ['chatgpt', 'claude', 'gemini', 'industry', 'skills'] as const;
export type BlogCategory = (typeof blogCategories)[number];
export type BlogFormat = 'NEWS' | 'ANALYSIS' | 'GUIDE' | 'COMPARISON' | 'SKILL';
export interface BlogCitation {
    label: string;
    url: string;
    accessedAt: string;
}
export interface BlogFact {
    text: string;
    sourceUrl: string;
    quote?: string;
}
export interface BlogCover {
    assetId: string;
    url: string;
    alt: string;
    generated: boolean;
    kind?: 'SOURCE' | 'AI' | 'TEMPLATE' | 'MANUAL';
    sourcePageUrl?: string;
    originalUrl?: string;
    credit?: string;
    rightsConfirmed?: boolean;
}
export interface BlogSourceImage {
    key: string;
    sourceCode: string;
    sourcePageUrl: string;
    url: string;
    alt: string;
    caption: string;
    credit: string;
    version?: string;
    asset?: BlogCover;
}
export interface BlogSkillInfo {
    identity: string;
    name: string;
    repository: string;
    repositoryId: string;
    repositoryUrl: string;
    directoryUrl: string;
    stars: number;
    trend: 'RECENT' | 'EVERGREEN';
    rankingUrl: string;
    rankingLabel: string;
    rank: number;
    observedAt: string;
    sourceCommit: string;
}
export interface BlogDraft {
    skill?: BlogSkillInfo;
    sourceImages?: BlogSourceImage[];
    title: string;
    summary: string;
    body: string;
    category: BlogCategory;
    format: BlogFormat;
    tags: string[];
    candidateTitles: string[];
    sources: BlogCitation[];
    facts: BlogFact[];
    cover: BlogCover | null;
    illustrations: Array<BlogCover & { caption: string }>;
    relatedProductIds: string[];
    seoDescription: string;
    pinned: boolean;
}
export interface BlogPublishedArticle extends BlogDraft {
    id: string;
    slug: string;
    version: number;
    publishedAt: string;
    reviewedAt: string | null;
    reviewerName: string | null;
    publicationMode?: 'MANUAL' | 'AUTOMATIC';
    updatedAt?: string;
    readingMinutes: number;
}
export type BlogListInput = { term?: string; category?: string; skip?: number; take?: number };
export interface BlogPublicPage {
    title: string;
    description: string;
    items: BlogPublishedArticle[];
    totalItems: number;
    featured: BlogPublishedArticle | null;
    article: BlogPublishedArticle | null;
    relatedArticles: BlogPublishedArticle[];
}
export interface BlogPublicReader {
    read(ctx: unknown, input: BlogListInput, slug?: string): Promise<BlogPublicPage>;
    sitemap(ctx: unknown): Promise<Array<{ slug: string; updatedAt: string }>>;
    isAssetPublic(ctx: unknown, identifier: string): Promise<boolean>;
    assertCurrent(ctx: unknown, page: BlogPublicPage): Promise<void>;
}
export const blogCategoryLabels: Record<BlogCategory, string> = {
    chatgpt: 'ChatGPT',
    claude: 'Claude',
    gemini: 'Gemini',
    industry: '行业动态',
    skills: '热门 Skill',
};
export function emptyBlogDraft(): BlogDraft {
    return {
        title: '',
        summary: '',
        body: '',
        category: 'industry',
        format: 'NEWS',
        tags: [],
        candidateTitles: [],
        sources: [],
        facts: [],
        cover: null,
        illustrations: [],
        relatedProductIds: [],
        seoDescription: '',
        pinned: false,
    };
}
/** A small literal Markdown subset shared by SSR, browser and review previews; no raw HTML. */
export function blogBodySections(body: string): Array<{ id: string; title: string; paragraphs: string[] }> {
    const sections: Array<{ id: string; title: string; paragraphs: string[] }> = [];
    for (const line of body.replace(/\r/gu, '').split('\n')) {
        if (/^#{1,3}\s/u.test(line))
            sections.push({
                id: `section-${sections.length + 1}`,
                title: line.replace(/^#{1,3}\s+/u, ''),
                paragraphs: [],
            });
        else if (line.trim()) {
            if (!sections.length) sections.push({ id: 'section-1', title: '', paragraphs: [] });
            sections[sections.length - 1].paragraphs.push(line);
        }
    }
    return sections;
}
