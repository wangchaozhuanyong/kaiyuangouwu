import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { syntheticPage } from '../seo-public/fixtures.mjs';
import { startSeoFixtureServer } from '../seo-public/preview-server.mjs';
const visualPreset = process.argv[3] === 'neo-minimalist' ? 'neo-minimalist' : 'classic';
const dist = fileURLToPath(new URL('../../dist/', import.meta.url));
const titles = [
    'ChatGPT 更新解读：如何核对官方资讯',
    'Claude 新功能：从公告到实际使用',
    'Gemini 更新：重点信息与适用条件',
];
const articles = Array.from({ length: 16 }, (_, index) => ({
    id: String(index + 1),
    slug: `local-qa-${index + 1}`,
    version: 1,
    title: titles[index % 3] + `（本地验收示例 ${index + 1}）`,
    summary: '这是合成的本地验收内容，用于检查新闻博客排版、搜索、分类和页面切换，不代表真实新闻或产品承诺。',
    body: '## 发生了什么\n这是本地合成数据，用于验证文章正文在关闭 JavaScript 时仍可阅读。\n## 关键变化\n页面展示明确的来源，保留更新时间与实际审核人。\n## 用户影响\n审核后才能公开；草稿不会修改已发布文章。\n## 使用条件与限制\n信息应核对官方来源，演示内容不能当作产品说明。',
    category: ['chatgpt', 'claude', 'gemini'][index % 3],
    format: 'NEWS',
    tags: ['本地验收'],
    candidateTitles: [],
    facts: [],
    sources: [
        {
            label: '官方资讯入口（本地验收链接）',
            url: 'https://openai.com/news/',
            accessedAt: '2026-11-01T00:00:00Z',
        },
    ],
    relatedProductIds: [],
    illustrations: [],
    seoDescription: '本地合成博客验收',
    pinned: index === 0,
    cover: {
        assetId: 'qa-cover',
        url: '/qa/news-cover.webp',
        alt: '本地合成博客封面',
        generated: false,
        kind: 'TEMPLATE',
    },
    publishedAt: '2026-11-01T00:00:00Z',
    reviewedAt: '2026-11-01T00:00:00Z',
    reviewerName: '本地验收编辑',
    readingMinutes: 2,
}));
articles.unshift({
    ...articles[0],
    id: 'source-image-qa',
    slug: 'local-source-image-qa',
    category: 'claude',
    sources: [
        {
            label: '出处入口（本地合成验收链接）',
            url: 'https://www.anthropic.com/news/ai-for-science-expands-foundations-research-institutions',
            accessedAt: '2026-11-02T00:00:00Z',
        },
    ],
    title: '资讯配图与出处展示（本地合成验收）',
    summary:
        '本页使用自制合成图片验证完整显示与出处入口。图片与正文均为本地验收素材，不作为官方配图或正式资讯发布。',
    body: '## 来源图片\n合成图片仅验证完整画面与出处展示；正式采集图片仍需经过来源校验及使用依据审核。\n## 审核与发布\n正式文章需要在后台核对所选图片的来源、署名与使用依据。\n## 本地验收边界\n此页只演示图片展示方式，不代表这篇文章已在正式网站发布。',
    cover: {
        assetId: 'qa-source-cover',
        url: '/qa/source-cover.webp',
        alt: '本地自制合成配图，用于完整画面验收',
        generated: false,
        kind: 'SOURCE',
        sourcePageUrl:
            'https://www.anthropic.com/news/ai-for-science-expands-foundations-research-institutions',
        originalUrl: 'https://www-cdn.anthropic.com/images/synthetic-original-image-qa.png',
        credit: '本地合成素材 · 链接仅用于验收',
        rightsConfirmed: false,
    },
});
articles.unshift({
    ...articles[0],
    id: 'skill-qa-1',
    slug: 'local-skill-qa',
    title: 'Frontend Design：把网页想法整理成可实现的界面（本地验收示例）',
    category: 'skills',
    format: 'SKILL',
    summary:
        '本地合成的热门 Skill 推荐，用于验收用途介绍、热度标注和 GitHub 按钮。展示的热度数字仅为测试数据。',
    body: [
        '## 它能做什么',
        '这是合成的 Skill 介绍，仅用于验收。正式内容将依据 SKILL.md 与仓库说明自动整理。',
        '## 适合谁',
        '希望了解 AI Agent Skill 的读者。',
        '## 典型用法',
        '查看作者仓库中的原始说明。',
        '## 依赖与限制',
        '本站只介绍用途，不自动安装或执行 Skill。热度指标为本地测试数据。',
    ].join('\n'),
    cover: {
        assetId: 'synthetic-skill-cover',
        url: '/qa/skill-cover.webp',
        alt: '热门 Skill 本地模板封面',
        generated: false,
        kind: 'TEMPLATE',
    },
    sources: [
        {
            label: '原始 Skill 仓库（本地验收链接）',
            url: 'https://github.com/anthropics/skills/tree/main/skills/frontend-design',
            accessedAt: '2026-11-02T01:00:00Z',
        },
    ],
    reviewerName: null,
    reviewedAt: null,
    updatedAt: '2026-11-02T01:00:00Z',
    publicationMode: 'AUTOMATIC',
    skill: {
        identity: 'synthetic-skill-qa',
        name: 'frontend-design',
        repository: 'anthropics/skills',
        repositoryId: 'synthetic',
        repositoryUrl: 'https://github.com/anthropics/skills',
        directoryUrl: 'https://github.com/anthropics/skills/tree/main/skills/frontend-design',
        stars: 20000,
        trend: 'RECENT',
        rankingUrl: 'https://www.skills.sh/trending',
        rankingLabel: 'Trending（合成验收）',
        rank: 3,
        observedAt: '2026-11-02T01:00:00Z',
        sourceCommit: 'synthetic',
    },
});
export function newsBlogFixture(url, host) {
    const page = syntheticPage('synthetic-a', 'zh_Hans', 'home', { host, origin: `http://${host}` });
    page.visualPreset = { presetId: visualPreset };
    const slug =
        url.pathname.match(/\/blog\/([^/]+)/u)?.[1] ||
        (url.searchParams.get('kind') === 'blog' ? url.searchParams.get('id') : undefined);
    const input = url.searchParams.get('input')
        ? JSON.parse(url.searchParams.get('input'))
        : {
              term: url.searchParams.get('term') || undefined,
              category: url.searchParams.get('category') || undefined,
              skip: (Number(url.searchParams.get('page') || 1) - 1) * 12,
              take: 12,
          };
    const filtered = articles.filter(
        x =>
            (!input.category || x.category === input.category) &&
            (!input.term || x.title.includes(input.term)),
    );
    page.request = {
        kind: 'blog',
        ...(slug ? { id: slug } : {}),
        input: slug ? { skip: 0, take: 12 } : { ...input, skip: input.skip ?? 0, take: 12 },
    };
    page.requestKey = JSON.stringify(page.request);
    page.route = slug ? `/blog/${slug}` : '/blog';
    page.blog = {
        title: 'AI 最新资讯与实用指南',
        description: '本地合成验收页面：关注 ChatGPT、Claude、Gemini 的产品更新与使用方法。',
        items: filtered.slice(input.skip ?? 0, (input.skip ?? 0) + 12),
        totalItems: filtered.length,
        featured: filtered[0] ?? null,
        article: slug ? (articles.find(x => x.slug === slug) ?? null) : null,
        relatedArticles: slug ? articles.filter(x => x.slug !== slug).slice(0, 3) : [],
    };
    page.seo = {
        ...page.seo,
        title: page.blog.article?.title ?? page.blog.title,
        description: page.blog.description,
        requestKey: page.requestKey,
        canonical: `http://${host}/zh${page.route}`,
        structuredData: page.blog.article
            ? [
                  {
                      '@context': 'https://schema.org',
                      '@type': 'BlogPosting',
                      headline: page.blog.article.title,
                  },
              ]
            : [],
    };
    return page;
}
const server = await startSeoFixtureServer(Number(process.argv[2] ?? 0), {
    pageFactory: newsBlogFixture,
    listenHost: '127.0.0.1',
    transformGraphQlData(data, { operation }) {
        if (operation.query?.includes('query StorefrontProductsByIds')) {
            const ids = operation.variables?.options?.filter?.id?.in ?? [];
            const items = data.products.items.filter(product => ids.includes(product.id));
            data.products = { items, totalItems: items.length };
        }
    },
    async transformHtml() {
        const html = await readFile(path.join(dist, 'index.html'), 'utf8');
        const styles = (await readdir(path.join(dist, 'assets')))
            .filter(x => x.startsWith('blog-') && x.endsWith('.css'))
            .map(x => `<link rel="stylesheet" href="/assets/${x}">`)
            .join('');
        return html.replace('</head>', styles + '</head>');
    },
    async serveAssets(req, res) {
        if (req.url?.startsWith('/qa/source-cover.webp')) {
            res.writeHead(200, { 'content-type': 'image/webp' });
            res.end(await readFile(new URL('./source-cover.webp', import.meta.url)));
            return true;
        }
        if (req.url?.startsWith('/qa/news-cover.webp') || req.url?.startsWith('/qa/skill-cover.webp')) {
            res.writeHead(200, { 'content-type': 'image/webp' });
            res.end(
                await readFile(
                    new URL(
                        req.url.startsWith('/qa/skill-') ? './skill-cover.webp' : './cover.webp',
                        import.meta.url,
                    ),
                ),
            );
            return true;
        }
        return false;
    },
});
process.stdout.write(
    JSON.stringify({ url: `http://127.0.0.1:${server.port}/zh/blog`, source: 'synthetic local QA only' }) +
        '\n',
);
process.on('SIGTERM', async () => {
    await server.close();
    process.exit(0);
});
