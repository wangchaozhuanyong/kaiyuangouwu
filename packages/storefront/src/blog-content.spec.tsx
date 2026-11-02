import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
    emptyBlogDraft,
    type BlogPublicPage,
    type BlogPublishedArticle,
} from '../../storefront-content-plugin/src/shared/news-blog';

import { BlogContent } from './pages/blog-content';
const article: BlogPublishedArticle = {
    ...emptyBlogDraft(),
    id: '1',
    slug: 'official-update',
    version: 2,
    title: '本地合成验收文章',
    summary: '仅用于验证页面。',
    body: '## 更新内容\n<script>alert(1)</script>\n## 使用限制\n依据官方资料核对。',
    category: 'chatgpt',
    publishedAt: '2026-11-01T00:00:00Z',
    reviewedAt: '2026-11-01T00:00:00Z',
    reviewerName: '本地验收编辑',
    readingMinutes: 1,
    sources: [{ label: '官方来源', url: 'https://openai.com/news/', accessedAt: '2026-11-01T00:00:00Z' }],
};
const page: BlogPublicPage = {
    title: 'AI 最新资讯与实用指南',
    description: '本地合成验收',
    items: [article],
    totalItems: 1,
    featured: article,
    article: null,
    relatedArticles: [],
};
describe('news blog server-renderable content', () => {
    it('renders real article links and a GET search form before JavaScript', () => {
        const html = renderToStaticMarkup(<BlogContent page={page} />);
        expect(html).toContain('/zh/blog/official-update');
        expect(html).toContain('method="get"');
        expect(html).toContain('name="term"');
        expect(html).toContain('aria-label="文章分类"');
    });
    it('renders reviewed content, sources and directory while escaping markup', () => {
        const html = renderToStaticMarkup(<BlogContent page={{ ...page, article }} />);
        expect(html).toContain('href="#section-1"');
        expect(html).toContain('本地验收编辑');
        expect(html).toContain('https://openai.com/news/');
        expect(html).toContain('&lt;script&gt;');
        expect(html).not.toContain('<script>alert(1)</script>');
    });
    it('renders a resolved empty result with an actionable search state', () => {
        const html = renderToStaticMarkup(
            <BlogContent
                page={{ ...page, items: [], totalItems: 0, featured: null }}
                input={{ term: '找不到' }}
            />,
        );
        expect(html).toContain('没有找到相关文章');
        expect(html).toContain('浏览全部文章');
        expect(html).not.toContain('aria-busy="true"');
    });
    it('identifies original source images and credits their article without an AI label', () => {
        const sourceArticle: BlogPublishedArticle = {
            ...article,
            cover: {
                assetId: '1',
                url: '/assets/original.webp',
                alt: '官方原文配图',
                generated: false,
                kind: 'SOURCE',
                sourcePageUrl: 'https://openai.com/news/',
                originalUrl: 'https://images.openai.com/original.png',
                credit: 'OpenAI',
                rightsConfirmed: true,
            },
        };
        const list = renderToStaticMarkup(
            <BlogContent page={{ ...page, items: [sourceArticle], featured: sourceArticle }} />,
        );
        expect(list).toContain('data-image-kind="SOURCE"');
        const detail = renderToStaticMarkup(<BlogContent page={{ ...page, article: sourceArticle }} />);
        expect(detail).toContain('原文配图');
        expect(detail).toContain(' · OpenAI');
        expect(detail).toContain('href="https://openai.com/news/"');
        expect(detail).not.toContain('AI 示意图');
    });
    it('shows the featured article once without turning the remaining list into an empty state', () => {
        const html = renderToStaticMarkup(<BlogContent page={page} />);
        expect(html.match(/<article /g)).toHaveLength(1);
        expect(html).toContain('blog-feature');
        expect(html).not.toContain('文章正在整理中');
        expect(html).toContain('<h1 class="sr-only">');
    });
    it('keeps categories, search and pagination as usable native URLs', () => {
        const html = renderToStaticMarkup(
            <BlogContent
                page={{ ...page, totalItems: 30 }}
                input={{ category: 'chatgpt', term: '更新', skip: 12 }}
            />,
        );
        expect(html).not.toContain('class="blog-feature"');
        expect(html).toContain('href="/zh/blog?term=%E6%9B%B4%E6%96%B0&amp;category=chatgpt&amp;page=3"');
        expect(html).toContain('href="/zh/blog?category=chatgpt"');
        expect(html).toContain('type="hidden" name="category" value="chatgpt"');
        expect(html).toContain('第 2 / 3 页');
    });
    it('shows a Skill GitHub action and automated attribution without inventing a reviewer', () => {
        const skillArticle: BlogPublishedArticle = {
            ...article,
            category: 'skills',
            format: 'SKILL',
            publicationMode: 'AUTOMATIC',
            reviewedAt: null,
            reviewerName: null,
            skill: {
                identity: 'skill-1',
                name: 'document-helper',
                repository: 'owner/repo',
                repositoryId: '10',
                repositoryUrl: 'https://github.com/owner/repo',
                directoryUrl: 'https://github.com/owner/repo/tree/main/skills/document-helper',
                stars: 2300,
                trend: 'RECENT',
                rankingUrl: 'https://www.skills.sh/trending',
                rankingLabel: 'Trending',
                rank: 3,
                observedAt: article.publishedAt,
                sourceCommit: 'a'.repeat(40),
            },
        };
        const list = renderToStaticMarkup(
            <BlogContent page={{ ...page, items: [skillArticle], featured: null }} />,
        );
        expect(list).toContain('热门 Skill');
        expect(list).toContain('href="https://github.com/owner/repo"');
        expect(list).toContain('查看 GitHub 仓库');
        expect(list).toContain('noopener noreferrer');
        const detail = renderToStaticMarkup(<BlogContent page={{ ...page, article: skillArticle }} />);
        expect(detail).toContain('自动整理');
        expect(detail).not.toContain('null 审核');
        expect(detail).not.toContain('本地验收编辑');
        expect(detail).toContain('查看 Skill 目录');
    });
});
