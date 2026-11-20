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
    publishedAt: '2026-11-03T00:00:00Z',
    sourcePublishedAt:
        index === 0
            ? '2026-09-30T00:00:00Z'
            : new Date(Date.parse('2026-11-02T00:00:00Z') - Math.floor(index / 3) * 86400000).toISOString(),
    reviewedAt: '2026-11-03T00:00:00Z',
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
// Distinct editorial profiles. All copy and metrics below are synthetic local QA.
const profiles = [
    {
        domain: 'development',
        displayName: '为 Next.js 项目配置缓存组件',
        purpose: '帮助开发者配置缓存组件，并整理启用时需要处理的路由问题。',
        audience: 'Next.js 前端开发者',
        name: 'next-cache-components-adoption',
        repository: 'vercel/next.js',
    },
    {
        domain: 'media',
        displayName: '把视频创意制作成 HTML 动画',
        purpose: '把文字创意组织成场景、字幕和动画，检查预览后生成视频。',
        audience: '视频创作者与动画设计人员',
        name: 'hyperframes',
        repository: 'heygen-com/hyperframes',
    },
    {
        domain: 'office',
        displayName: '制作可交互的演示文稿',
        purpose: '将讲解内容组织为幻灯片，安排逐步展示、页面导航与演示结构。',
        audience: '需要制作汇报和教学演示的人',
        name: 'slideshow',
        repository: 'heygen-com/hyperframes',
    },
    {
        domain: 'design',
        displayName: '按界面问题选择动效、手势和移动端优化技能',
        purpose: '本地合成的设计分类示例，用于核对较长的标题、说明和独立封面在电脑与手机上的排版。',
        audience: '正在设计界面、开发页面或验收交互效果的使用者',
        name: 'synthetic-design-guide',
        repository: 'anthropics/skills',
    },
];
for (const [index, profile] of profiles.entries()) {
    const base = articles.find(article => article.skill);
    const skillProfile = {
        ...profile,
        industries: [],
        capabilities: ['根据输入材料整理制作步骤', '按任务要求组织可检查的结果'],
        example: { input: '以下输入与结果为合成验收示例', output: '用于检查页面排版的合成结果' },
        prerequisites: ['先阅读原始项目文档'],
        limitations: ['本地验收未运行这些第三方 Skill'],
    };
    articles.unshift({
        ...base,
        id: 'editorial-qa-' + index,
        slug: 'local-editorial-' + profile.domain,
        title: profile.displayName + '（本地合成验收）',
        summary: profile.purpose,
        cover: null,
        skillProfile: { ...skillProfile, displayName: profile.displayName + '（本地合成验收）' },
        body:
            '## 解决什么问题\n' +
            profile.purpose +
            '\n## 能完成哪些任务\n本段只验证内容结构。\n## 使用示例\n输入和预期输出均为合成验收内容。\n## 如何开始\n查看原始文档。\n## 条件与限制\n本地验收未安装、执行或测试第三方 Skill。',
        skill: {
            ...base.skill,
            name: profile.name,
            repository: profile.repository,
            repositoryUrl: 'https://github.com/' + profile.repository,
        },
        tags: [
            { development: '软件开发', media: '视频音频', office: '办公效率', design: '设计创作' }[
                profile.domain
            ],
            { development: '缓存配置', media: '视频制作', office: '演示文稿', design: '界面任务选型' }[
                profile.domain
            ],
        ],
    });
}
// Optional replay of already-public per-language snapshots for browser acceptance.
const editions = process.env.BLOG_QA_EDITIONS
    ? JSON.parse(await readFile(process.env.BLOG_QA_EDITIONS, 'utf8'))
    : null;
export function newsBlogFixture(url, host) {
    const en = url.pathname.startsWith('/en/') || url.searchParams.get('languageCode') === 'en';
    const language = en ? 'en' : 'zh_Hans';
    const prefix = en ? '/en' : '/zh';
    const rows = editions?.[language] ?? (en ? [] : articles);
    const page = syntheticPage('synthetic-a', language, 'home', { host, origin: `http://${host}` });
    page.visualPreset = { presetId: visualPreset };
    page.content.blocks.push({
        ...page.content.blocks[0],
        id: 'news-blog-services',
        code: 'storefront-client-plugins',
        type: 'CLIENT_PLUGINS',
        items: [
            {
                id: 'news-blog',
                enabled: true,
                position: 0,
                targetType: 'NONE',
                targetValue: null,
                label: en ? 'AI news' : '新闻博客',
                description: '',
                imageUrl: null,
                settings: { pluginCode: 'news-blog-entry', placement: 'BUSINESS_SERVICES_MAIN' },
            },
        ],
    });
    page.content.settings.configuredBlockTypes.push('CLIENT_PLUGINS');
    if (
        url.pathname === prefix + '/services' ||
        (url.searchParams.get('kind') === 'page' && url.searchParams.get('id') === 'services')
    ) {
        page.request = { kind: 'page', id: 'services' };
        page.requestKey = JSON.stringify(page.request);
        page.route = prefix + '/services';
        page.seo.requestKey = page.requestKey;
        page.seo.canonical = `http://${host}${page.route}`;
        return page;
    }
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
    const filtered = rows
        .filter(
            x =>
                (!input.category || x.category === input.category) &&
                (!input.term ||
                    [x.title, x.summary, ...x.tags]
                        .join(' ')
                        .toLowerCase()
                        .includes(input.term.toLowerCase())),
        )
        .sort((a, b) => {
            const date = article =>
                article.category === 'skills'
                    ? article.publishedAt
                    : (article.sourcePublishedAt ?? article.publishedAt);
            return Date.parse(date(b)) - Date.parse(date(a));
        });
    page.request = {
        kind: 'blog',
        ...(slug ? { id: slug } : {}),
        input: slug ? { skip: 0, take: 12 } : { ...input, skip: input.skip ?? 0, take: 12 },
    };
    page.requestKey = JSON.stringify(page.request);
    page.route = slug ? `/blog/${slug}` : '/blog';
    page.blog = {
        title: en ? 'AI news and practical guides' : 'AI 最新资讯与实用指南',
        description: en
            ? 'Updates and analysis from official AI sources.'
            : '关注 ChatGPT、Claude、Gemini 的产品更新与使用方法。',
        items: filtered.slice(input.skip ?? 0, (input.skip ?? 0) + 12),
        totalItems: filtered.length,
        featured: filtered.find(article => article.skillProfile?.domain === 'design') ?? filtered[0] ?? null,
        article: slug ? (rows.find(x => x.slug === slug) ?? null) : null,
        relatedArticles: slug ? rows.filter(x => x.slug !== slug).slice(0, 3) : [],
    };
    page.blog.availableLanguages = ['zh_Hans', 'en'].filter(
        code => code === language || (editions?.[code] ?? []).some(item => !slug || item.slug === slug),
    );
    page.seo = {
        ...page.seo,
        title: page.blog.article?.title ?? page.blog.title,
        description: page.blog.description,
        requestKey: page.requestKey,
        canonical: `http://${host}${prefix}${page.route}`,
        alternates: page.blog.availableLanguages.map(code => ({
            language: code === 'zh_Hans' ? 'zh-CN' : 'en',
            href: `http://${host}/${code === 'zh_Hans' ? 'zh' : 'en'}${page.route}`,
        })),
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
