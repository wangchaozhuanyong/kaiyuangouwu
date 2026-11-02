import { AssetServerPlugin, SharpAssetPreviewStrategy } from '@vendure/asset-server-plugin';
import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import {
    Administrator,
    AutoIncrementIdStrategy,
    Channel,
    ConfigService,
    DefaultJobQueuePlugin,
    LanguageCode,
    Logger,
    mergeConfig,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import { EditorialProviderService, ImageGenerationPlugin } from '@vendure/image-generation-plugin';
import {
    BlogArticle,
    BlogRun,
    BlogService,
    BlogSkill,
    BlogSkillObservation,
    BlogSkillRecommendation,
    BlogSkillsService,
    BlogSourceItem,
    NewsBlogPlugin,
} from '@vendure/news-blog-plugin';
import { OperationsDashboardPlugin } from '@vendure/operations-dashboard-plugin';
import { StoreDomain, StoreDomainPlugin } from '@vendure/store-domain-plugin';
import { StoreManagementPlugin } from '@vendure/store-management-plugin';
import { StorefrontCartPlugin } from '@vendure/storefront-cart-plugin';
import {
    emptyBlogDraft,
    StorefrontContentPlugin,
    StorefrontContentService,
    type BlogDraft,
} from '@vendure/storefront-content-plugin';
import {
    createTestEnvironment,
    MysqlInitializer,
    registerInitializer,
    SimpleGraphQLClient,
    testConfig,
} from '@vendure/testing';
import { load } from 'cheerio';
import gql from 'graphql-tag';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import 'reflect-metadata';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { createCatalogImageTransformStrategies } from '../catalog-asset-access-strategy';
import { AddNewsBlog1793491200000 } from '../migrations/1793491200000-add-news-blog';
import { AddBlogSkills1793577600000 } from '../migrations/1793577600000-add-blog-skills';
import { AddBlogSourceMetadata1793577660000 } from '../migrations/1793577660000-add-blog-source-metadata';
import { storefrontAssetPresets } from '../storefront-asset-presets';

// Use the same CommonJS constructors as the running plugin, not a second Vite module instance.
const requireBuilt = createRequire(__filename);
const storeBuild = path.dirname(requireBuilt.resolve('@vendure/store-management-plugin'));
const { BlogSourceHttp } = requireBuilt(
    path.join(path.dirname(requireBuilt.resolve('@vendure/news-blog-plugin')), 'source-http.js'),
) as typeof import('../../news-blog-plugin/dist/source-http');
const { StoreProfile } = requireBuilt(
    path.join(storeBuild, 'entities/store-profile.entity.js'),
) as typeof import('../../store-management-plugin/dist/entities/store-profile.entity');
const { StorefrontSeoHtmlService } = requireBuilt(
    path.join(storeBuild, 'seo/storefront-seo-html.service.js'),
) as typeof import('../../store-management-plugin/dist/seo/storefront-seo-html.service');

// Only the explicitly supplied, disposable local MySQL container may run this suite.
const mysqlPort = Number(process.env.E2E_MYSQL_PORT);
if (process.env.CI !== '1' || !Number.isInteger(mysqlPort) || mysqlPort < 1024)
    throw new Error('News blog rehearsal requires an explicit isolated local MySQL test port');
const docker = ['--host', 'unix:///var/run/docker.sock'];
const containers = execFileSync(
    'docker',
    [...docker, 'ps', '--filter', 'label=codex.project=vendure-news-blog', '--format', '{{.ID}}'],
    { encoding: 'utf8' },
)
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
const ownsPort = containers.some(id => {
    const ports = JSON.parse(
        execFileSync('docker', [...docker, 'inspect', '--format', '{{json .NetworkSettings.Ports}}', id], {
            encoding: 'utf8',
        }),
    );
    return ports?.['3306/tcp']?.some(
        (binding: { HostIp: string; HostPort: string }) =>
            binding.HostIp === '127.0.0.1' && Number(binding.HostPort) === mysqlPort,
    );
});
if (!ownsPort)
    throw new Error(
        'Refusing MySQL rehearsal: port is not owned by a labelled local news-blog test container',
    );
const runtimeRoot = path.resolve(__dirname, '../../../.runtime/news-blog/mysql-qa');
mkdirSync(runtimeRoot, { recursive: true });
registerInitializer('mysql', new MysqlInitializer());
const config = mergeConfig(testConfig, {
    apiOptions: { port: 3279 },
    defaultLanguageCode: LanguageCode.zh_Hans,
    authOptions: {
        requireVerification: false,
        superadminCredentials: {
            identifier: 'news-blog-qa@example.invalid',
            password: randomBytes(24).toString('base64url'),
        },
    },
    entityOptions: { entityIdStrategy: new AutoIncrementIdStrategy() },
    // Match the existing host application's branding fields used by the media manifest.
    customFields: {
        Channel: [
            { name: 'storefrontNameZh', type: 'string', defaultValue: '本地合成店铺' },
            { name: 'storefrontNameEn', type: 'string', defaultValue: 'Synthetic local store' },
        ],
    },
    dbConnectionOptions: {
        type: 'mysql',
        host: '127.0.0.1',
        port: mysqlPort,
        username: 'root',
        password: '',
        charset: 'utf8mb4',
        synchronize: true,
        logging: false,
    },
    plugins: [
        AssetServerPlugin.init({
            route: 'assets',
            assetUploadDir: path.join(runtimeRoot, 'public-assets'),
            previewStrategy: new SharpAssetPreviewStrategy(),
            presets: storefrontAssetPresets,
            cacheHeader: 'private, no-store',
            imageTransformStrategy: createCatalogImageTransformStrategies(false),
        }),
        OperationsDashboardPlugin,
        StoreDomainPlugin,
        StorefrontCartPlugin,
        StorefrontContentPlugin,
        ContentTranslationPlugin.init({
            provider: {
                name: 'news-blog-local-qa',
                isConfigured: () => false,
                translate: () => {
                    return Promise.reject(new Error('No external translation in news blog rehearsal'));
                },
            },
        }),
        StoreManagementPlugin.init({ enabled: false, signingSecret: randomBytes(32).toString('hex') }),
        ImageGenerationPlugin.init({
            storageRoot: runtimeRoot,
            downloadSigningSecret: randomBytes(32).toString('hex'),
            production: false,
        }),
        NewsBlogPlugin,
        DefaultJobQueuePlugin.init({ pollInterval: 50, concurrency: 1 }),
    ],
});
const { server, adminClient, shopClient } = createTestEnvironment(config);
const language = { languageCode: LanguageCode.zh_Hans };
const tables = [
    'settings',
    'article',
    'revision',
    'source',
    'source_item',
    'run',
    'skill',
    'skill_observation',
    'skill_state',
    'skill_recommendation',
].map(name => `news_blog_${name}`);
let connection: TransactionalConnection;
let contexts: RequestContextService;
let blog: BlogService;
let first: { id: string; token: string; ctx: RequestContext };
let second: typeof first;
let textCalls = 0;
const evidenceUrl = 'https://openai.com/news/synthetic-news-blog-rehearsal';
const evidence =
    '这是本地合成的官方格式资讯，仅用于验证采集、去重、编辑与审核流程，不代表真实产品更新。'.repeat(12);
const generated: BlogDraft = {
    ...emptyBlogDraft(),
    title: 'ChatGPT 更新解读：本地审核流程演练',
    summary: '这是本地合成资讯的摘要。'.repeat(8),
    body:
        '## 发生了什么\n' +
        evidence +
        '\n## 用户影响\n本条内容只用于开发验证，公开内容必须由后台管理员审核。',
    category: 'chatgpt',
    candidateTitles: [
        'ChatGPT 更新解读：本地审核流程演练',
        'ChatGPT 本地演练：来源与事实如何核对',
        'ChatGPT 资讯草稿：从采集到人工审核',
    ],
    facts: [
        {
            text: '这是本地合成的官方格式资讯，仅用于验证采集、去重、编辑与审核流程，不代表真实产品更新。',
            sourceUrl: evidenceUrl,
        },
    ],
};
const fields = gql`
    fragment NewsBlogQaArticle on NewsBlogArticleAdmin {
        id
        slug
        version
        state
        draft
        published
        issues
    }
`;
const getArticle = async (id: string) =>
    (
        await adminClient.query(
            gql`
                query ($id: ID!) {
                    newsBlogArticle(id: $id) {
                        ...NewsBlogQaArticle
                    }
                }
                ${fields}
            `,
            { id },
            language,
        )
    ).newsBlogArticle as {
        id: string;
        slug: string;
        version: number;
        state: string;
        draft: BlogDraft;
        published: { title: string; body: string } | null;
        issues: string[];
    };
const list = async () =>
    (
        await shopClient.query(
            gql`
                query {
                    newsBlogArticles {
                        totalItems
                        items {
                            id
                            slug
                            title
                            body
                        }
                    }
                }
            `,
            {},
            language,
        )
    ).newsBlogArticles;
const detail = async (slug: string) =>
    (
        await shopClient.query(
            gql`
                query ($slug: String!) {
                    newsBlogArticle(slug: $slug) {
                        id
                        title
                        body
                        cover
                        sources
                    }
                }
            `,
            { slug },
            language,
        )
    ).newsBlogArticle;
const publish = async (id: string, version: number) =>
    (
        await adminClient.query(
            gql`
                mutation ($id: ID!, $version: Int!) {
                    publishNewsBlogArticle(id: $id, expectedVersion: $version, acceptIssues: true) {
                        ...NewsBlogQaArticle
                    }
                }
                ${fields}
            `,
            { id, version },
            language,
        )
    ).publishNewsBlogArticle;
const request = async (kind: string) =>
    (
        await adminClient.query(
            gql`
                mutation ($input: RequestNewsBlogTaskInput!) {
                    requestNewsBlogTask(input: $input) {
                        id
                        state
                    }
                }
            `,
            { input: { kind, requestKey: randomUUID() } },
            language,
        )
    ).requestNewsBlogTask;
async function enable(store: typeof first, automation: boolean) {
    adminClient.setChannelToken(store.token);
    const current = (
        await adminClient.query(
            gql`
                query {
                    newsBlogSettings
                }
            `,
            {},
            language,
        )
    ).newsBlogSettings;
    expect(current.enabled).toBe(false);
    await adminClient.query(
        gql`
            mutation ($settings: JSON!, $version: Int!) {
                saveNewsBlogSettings(settings: $settings, expectedVersion: $version)
            }
        `,
        {
            settings: {
                ...current,
                enabled: true,
                automationEnabled: automation,
                textProviderCode: 'synthetic-editorial-boundary',
                textModel: 'synthetic-text',
                dailyBudgetMicros: 2000000,
                textReserveMicros: 400000,
            },
            version: current.version,
        },
        language,
    );
    await server.app.get(StorefrontContentService).create(store.ctx, {
        code: 'storefront-client-plugins',
        type: 'CLIENT_PLUGINS',
        position: 0,
        enabled: true,
        translations: [{ languageCode: LanguageCode.zh_Hans, title: '本地新闻博客验收' }],
        items: [
            {
                enabled: true,
                position: 0,
                targetType: 'NONE',
                settings: { pluginCode: 'news-blog-entry', placement: 'BUSINESS_SERVICES_MAIN' },
                translations: [{ languageCode: LanguageCode.zh_Hans, label: '新闻博客' }],
            },
        ],
    });
}

beforeAll(async () => {
    await server.init({
        initialData: { ...initialData, defaultLanguage: LanguageCode.zh_Hans, collections: [] },
        customerCount: 0,
    });
    connection = server.app.get(TransactionalConnection);
    contexts = server.app.get(RequestContextService);
    blog = server.app.get(BlogService);
    // Empty blog tables created by the synthetic bootstrap are replaced by the real migration.
    const runner = connection.rawConnection.createQueryRunner();
    try {
        const before = await runner.query('SELECT id, code FROM channel ORDER BY id');
        for (const name of tables) {
            expect(Number((await runner.query(`SELECT COUNT(*) AS n FROM ${name}`))[0].n)).toBe(0);
            await runner.dropTable(name);
        }
        const migration = new AddNewsBlog1793491200000();
        await migration.up(runner);
        await migration.up(runner);
        const metadataMigration = new AddBlogSourceMetadata1793577660000();
        await metadataMigration.up(runner);
        await metadataMigration.up(runner);
        const skillsMigration = new AddBlogSkills1793577600000();
        await skillsMigration.up(runner);
        await skillsMigration.up(runner);
        expect(await runner.query('SELECT id, code FROM channel ORDER BY id')).toEqual(before);
        for (const name of tables) expect(await runner.hasTable(name)).toBe(true);
        const drift = (await connection.rawConnection.driver.createSchemaBuilder().log()).upQueries.filter(
            query => /news_blog_/u.test(query.query),
        );
        expect(drift.map(query => query.query)).toEqual([]);
    } finally {
        await runner.release();
    }
    await adminClient.asSuperAdmin().catch(() => {
        throw new Error('Synthetic admin login failed; credentials omitted');
    });
    const credentials = config.authOptions.superadminCredentials;
    if (!credentials) throw new Error('Synthetic admin credentials missing');
    adminClient.setRequestHeader('x-vendure-sensitive-action-password', credentials.password);
    const admin = await connection.rawConnection.getRepository(Administrator).findOneOrFail({
        where: { emailAddress: credentials.identifier },
        relations: ['user'],
    });
    const zones = (
        await adminClient.query(gql`
            query {
                zones {
                    items {
                        id
                    }
                }
            }
        `)
    ).zones.items;
    async function createStore(code: string) {
        const token = `${code}-${randomUUID()}`;
        const channel = (
            await adminClient.query(
                gql`
                    mutation ($input: CreateChannelInput!) {
                        createChannel(input: $input) {
                            ... on Channel {
                                id
                            }
                            ... on ErrorResult {
                                message
                            }
                        }
                    }
                `,
                {
                    input: {
                        code,
                        token,
                        defaultLanguageCode: 'zh_Hans',
                        currencyCode: 'MYR',
                        defaultTaxZoneId: zones[0].id,
                        defaultShippingZoneId: zones[0].id,
                        pricesIncludeTax: false,
                    },
                },
            )
        ).createChannel;
        expect(channel.id, channel.message).toBeTruthy();
        const entity = await connection.rawConnection
            .getRepository(Channel)
            .findOneByOrFail({ id: channel.id });
        const ctx = await contexts.create({
            apiType: 'admin',
            channelOrToken: entity,
            user: admin.user,
            languageCode: LanguageCode.zh_Hans,
        });
        await connection.getRepository(ctx, StoreProfile).save(
            new StoreProfile({
                channelId: ctx.channelId,
                status: 'ACTIVE',
                isPublished: true,
                descriptionZh: '本地合成店铺',
                descriptionEn: 'Synthetic local store',
            }),
        );
        // Verified-domain fixture only: no DNS records or external provisioning are changed.
        await connection.getRepository(ctx, StoreDomain).save(
            new StoreDomain({
                channel: entity,
                channelId: entity.id,
                primaryChannelId: entity.id,
                domain: `${code}.example.invalid`,
                isPrimary: true,
                status: 'ACTIVE',
                verifiedAt: new Date(),
                verificationToken: randomUUID(),
            }),
        );
        return { id: String(entity.id), token, ctx };
    }
    first = await createStore('news-blog-qa-a');
    second = await createStore('news-blog-qa-b');
    vi.spyOn(server.app.get(BlogSourceHttp), 'read').mockImplementation((code, url) => {
        if (url === evidenceUrl)
            return Promise.resolve({
                body: `<main><article>${evidence}</article></main>`,
                status: 200,
                etag: null,
                lastModified: null,
            });
        if (code === 'openai')
            return Promise.resolve({
                body: `<rss><channel>${[0, 1]
                    .map(() =>
                        [
                            '<item><title>ChatGPT synthetic news rehearsal</title><link>',
                            `${evidenceUrl}`,
                            '</link><pubDate>',
                            `${new Date().toUTCString()}`,
                            '</pubDate></item>',
                        ].join(''),
                    )
                    .join('')}</channel></rss>`,
                status: 200,
                etag: null,
                lastModified: null,
            });
        return Promise.resolve({
            body: '<main>Local fixture: no dated entries</main>',
            status: 200,
            etag: null,
            lastModified: null,
        });
    });
    vi.spyOn(server.app.get(EditorialProviderService), 'text').mockImplementation(() => {
        textCalls++;
        return Promise.resolve({
            text: JSON.stringify(generated),
            telemetry: {
                costCurrency: 'USD',
                actualCostMicrounits: 1000,
                providerRequestId: 'synthetic-local-call',
            },
        });
    });
    vi.spyOn(server.app.get(EditorialProviderService), 'image').mockImplementation(() => {
        return Promise.reject(new Error('No external image calls in this rehearsal'));
    });
    await enable(first, true);
    await enable(second, false);
    adminClient.setChannelToken(first.token);
    shopClient.setChannelToken(first.token);
}, 120000);

afterAll(async () => {
    vi.restoreAllMocks();
    await server.destroy();
});

it('uses migrated MySQL tables for collection, deduplicated generation, manual publication, SSR data, revisions and withdrawal', async () => {
    expect((await list()).totalItems).toBe(0);
    const collected = await request('COLLECT');
    let articleId = '';
    await vi.waitFor(
        async () => {
            const collectRun = await connection
                .getRepository(first.ctx, BlogRun)
                .findOneByOrFail({ id: collected.id });
            expect(collectRun.state).toBe('SUCCEEDED');
            const articles = await connection
                .getRepository(first.ctx, BlogArticle)
                .find({ where: { channelId: first.id } });
            expect(articles).toHaveLength(1);
            articleId = String(articles[0].id);
            expect(JSON.parse(articles[0].draftJson).cover?.assetId).toBeTruthy();
        },
        { timeout: 15000, interval: 100 },
    );
    expect(
        await connection.getRepository(first.ctx, BlogSourceItem).count({ where: { channelId: first.id } }),
    ).toBe(1);
    expect(textCalls).toBe(1);
    const sourceId = String(
        (await connection.getRepository(first.ctx, BlogSourceItem).findOneByOrFail({ channelId: first.id }))
            .id,
    );
    await adminClient.query(
        gql`
            mutation ($input: RequestNewsBlogTaskInput!) {
                requestNewsBlogTask(input: $input) {
                    id
                }
            }
        `,
        { input: { kind: 'GENERATE', requestKey: randomUUID(), sourceIds: [sourceId] } },
        language,
    );
    expect(textCalls).toBe(1);
    let article = await getArticle(articleId);
    expect(article.state).toBe('PENDING_REVIEW');
    expect((await list()).totalItems).toBe(0);
    await expect(detail(article.slug)).rejects.toThrow();
    const anonymousAdmin = new SimpleGraphQLClient(
        config,
        `http://127.0.0.1:${config.apiOptions.port}/admin-api`,
    );
    anonymousAdmin.setChannelToken(first.token);
    await expect(
        anonymousAdmin.query(gql`
            query {
                newsBlogArticles {
                    id
                }
            }
        `),
    ).rejects.toThrow();
    await expect(
        shopClient.query(gql`
            query {
                newsBlogRuns {
                    id
                }
            }
        `),
    ).rejects.toThrow();
    const asset = article.draft.cover;
    if (!asset) throw new Error('Expected article cover');
    const imageUrl = new URL(asset.url, `http://127.0.0.1:${config.apiOptions.port}`).href;
    const readImage = (token: string) => fetch(imageUrl, { headers: { 'vendure-token': token } });
    expect((await readImage(first.token)).status).toBeGreaterThanOrEqual(400);
    article = await publish(article.id, article.version);
    expect((await list()).totalItems).toBe(1);
    expect((await list()).items[0].body).toBe('');
    expect((await detail(article.slug)).body).toBe(generated.body);
    const rawAsset = await connection.rawConnection
        .getRepository('Asset')
        .findOneByOrFail({ id: asset.assetId });
    const publicCtx = await contexts.create({
        apiType: 'shop',
        channelOrToken: first.token,
        languageCode: LanguageCode.en,
    });
    expect(await blog.isAssetPublic(publicCtx, rawAsset.preview)).toBe(true);
    const imageErrors = vi.spyOn(Logger, 'error');
    const publishedImage = await readImage(first.token);
    expect(publishedImage.status, imageErrors.mock.calls.map(([message]) => message).join('\n')).toBe(200);
    imageErrors.mockRestore();
    expect(publishedImage.headers.get('content-type')).toContain('image/');
    expect((await publishedImage.arrayBuffer()).byteLength).toBeGreaterThan(100);
    const exposed = await blog.read(
        await contexts.create({
            apiType: 'shop',
            channelOrToken: first.token,
            languageCode: LanguageCode.zh_Hans,
        }),
        {},
        article.slug,
    );
    expect(exposed.article?.facts).toEqual([]);
    expect(exposed.article?.candidateTitles).toEqual([]);
    expect(
        (
            await blog.sitemap(
                await contexts.create({
                    apiType: 'shop',
                    channelOrToken: first.token,
                    languageCode: LanguageCode.zh_Hans,
                }),
            )
        ).map(item => item.slug),
    ).toContain(article.slug);
    const params = new URLSearchParams({ kind: 'blog', id: article.slug, languageCode: 'zh_Hans' });
    const response = await fetch(
        `http://127.0.0.1:${config.apiOptions.port}/storefront/page-data?${params.toString()}`,
        { headers: { Host: 'localhost', 'vendure-token': first.token } },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const page = await response.json();
    expect(page.blog.article.body).toBe(generated.body);
    expect(page.seo.title).toContain(generated.title);
    expect(page.seo.indexable).toBe(false);
    expect(page.seo.structuredData.some((item: { '@type': string }) => item['@type'] === 'BlogPosting')).toBe(
        true,
    );
    expect(JSON.stringify(page)).not.toContain('synthetic-editorial-boundary');
    const html = await server.app.get(StorefrontSeoHtmlService).render(page);
    const dom = load(html);
    expect(dom('#root').text()).toContain(generated.title);
    expect(dom('#root').text()).toContain('本条内容只用于开发验证');
    expect(dom('link[rel="stylesheet"][href^="/assets/blog-"]')).toHaveLength(1);
    expect(dom('script[type="application/ld+json"]').text()).toContain('BlogPosting');
    expect((await readImage(second.token)).status).toBeGreaterThanOrEqual(400);
    shopClient.setChannelToken(second.token);
    adminClient.setChannelToken(second.token);
    expect((await list()).totalItems).toBe(0);
    await expect(detail(article.slug)).rejects.toThrow();
    await expect(getArticle(article.id)).rejects.toThrow();
    expect(
        await blog.isAssetPublic(
            await contexts.create({
                apiType: 'shop',
                channelOrToken: second.token,
                languageCode: LanguageCode.zh_Hans,
            }),
            rawAsset.preview,
        ),
    ).toBe(false);
    shopClient.setChannelToken(first.token);
    adminClient.setChannelToken(first.token);
    const oldVersion = article.version;
    article = (
        await adminClient.query(
            gql`
                mutation ($input: SaveNewsBlogArticleInput!) {
                    saveNewsBlogArticle(input: $input) {
                        ...NewsBlogQaArticle
                    }
                }
                ${fields}
            `,
            {
                input: {
                    id: article.id,
                    slug: article.slug,
                    expectedVersion: article.version,
                    draft: { ...article.draft, title: '人工修改后等待再次审核的标题' },
                },
            },
            language,
        )
    ).saveNewsBlogArticle;
    expect((await detail(article.slug)).title).toBe(generated.title);
    await expect(publish(article.id, oldVersion)).rejects.toThrow();
    article = await publish(article.id, article.version);
    expect((await detail(article.slug)).title).toBe('人工修改后等待再次审核的标题');
    await adminClient.query(
        gql`
            mutation ($id: ID!, $version: Int!) {
                withdrawNewsBlogArticle(id: $id, expectedVersion: $version) {
                    id
                }
            }
        `,
        { id: article.id, version: article.version },
        language,
    );
    expect((await list()).totalItems).toBe(0);
    await expect(detail(article.slug)).rejects.toThrow();
    expect((await readImage(first.token)).status).toBeGreaterThanOrEqual(400);
    expect(await blog.isAssetPublic(publicCtx, rawAsset.preview)).toBe(false);
    expect(
        await blog.sitemap(
            await contexts.create({
                apiType: 'shop',
                channelOrToken: first.token,
                languageCode: LanguageCode.zh_Hans,
            }),
        ),
    ).toEqual([]);
    const history = (
        await adminClient.query(
            gql`
                query ($id: ID!) {
                    newsBlogHistory(id: $id) {
                        action
                        actorId
                        version
                    }
                }
            `,
            { id: article.id },
            language,
        )
    ).newsBlogHistory;
    expect(history.map((row: { action: string }) => row.action)).toEqual(['WITHDRAW', 'PUBLISH', 'PUBLISH']);
    expect(history.every((row: { actorId: string }) => row.actorId)).toBe(true);
    const runs = await connection.getRepository(first.ctx, BlogRun).find({ where: { channelId: first.id } });
    expect(runs.filter(run => run.kind === 'GENERATE')).toHaveLength(1);
    expect(runs.find(run => run.kind === 'GENERATE')?.chargedMicros).toBe(1000);
    expect(server.app.get(ConfigService).jobQueueOptions.jobQueueStrategy.constructor.name).toBe(
        'SqlJobQueueStrategy',
    );
}, 60000);

it('deduplicates concurrent write requests under the real MySQL budget lock', async () => {
    adminClient.setChannelToken(first.token);
    const callsBefore = textCalls;
    const runsBefore = await connection
        .getRepository(first.ctx, BlogRun)
        .find({ where: { channelId: first.id, kind: 'GENERATE' } });
    const reservedBefore = runsBefore.reduce((total, run) => total + run.reservedMicros, 0);
    const chargedBefore = runsBefore.reduce((total, run) => total + run.chargedMicros, 0);

    const source = await connection.getRepository(first.ctx, BlogSourceItem).save(
        new BlogSourceItem({
            channelId: first.id,
            sourceCode: 'openai',
            identityKey: 'synthetic-concurrent-request',
            eventKey: 'synthetic-concurrent-event',
            contentHash: 'synthetic-concurrent-evidence',
            url: evidenceUrl,
            title: 'Concurrent synthetic editorial event',
            body: evidence,
            sourcePublishedAt: new Date(),
            fetchedAt: new Date(),
            status: 'READY',
            category: 'chatgpt',
        }),
    );
    const operation = gql`
        mutation ($input: RequestNewsBlogTaskInput!) {
            requestNewsBlogTask(input: $input) {
                id
            }
        }
    `;
    const responses = await Promise.all(
        Array.from({ length: 3 }, () =>
            adminClient.query(
                operation,
                { input: { kind: 'GENERATE', requestKey: randomUUID(), sourceIds: [String(source.id)] } },
                language,
            ),
        ),
    );
    const runId = responses[0].requestNewsBlogTask.id;
    expect(new Set(responses.map(response => response.requestNewsBlogTask.id)).size).toBe(1);
    await vi.waitFor(
        async () => {
            expect(
                (await connection.getRepository(first.ctx, BlogRun).findOneByOrFail({ id: runId })).state,
            ).toBe('SUCCEEDED');
            const active = await connection
                .getRepository(first.ctx, BlogRun)
                .count({ where: { channelId: first.id, state: 'RUNNING' } });
            expect(active).toBe(0);
        },
        { timeout: 15000, interval: 100 },
    );
    expect(textCalls).toBe(callsBefore + 1);
    const runs = await connection
        .getRepository(first.ctx, BlogRun)
        .find({ where: { channelId: first.id, kind: 'GENERATE' } });
    expect(runs).toHaveLength(runsBefore.length + 1);
    expect(runs.reduce((total, run) => total + run.reservedMicros, 0)).toBe(reservedBefore + 400000);
    expect(runs.reduce((total, run) => total + run.chargedMicros, 0)).toBe(chargedBefore + 1000);
}, 30000);

it('collects public Skill rankings, deduplicates daily work and automatically publishes with real MySQL and HTTP boundaries', async () => {
    adminClient.setChannelToken(first.token);
    shopClient.setChannelToken(first.token);
    const newsBuild = path.dirname(requireBuilt.resolve('@vendure/news-blog-plugin'));
    const { BlogSkillsCatalog } = requireBuilt(
        path.join(newsBuild, 'skills-catalog.js'),
    ) as typeof import('../../news-blog-plugin/dist/skills-catalog');
    const { BlogSkillsHttp } = requireBuilt(
        path.join(newsBuild, 'skills-http.js'),
    ) as typeof import('../../news-blog-plugin/dist/skills-http');
    const body =
        '---\nname: synthetic-document-helper\ndescription: Summarize supplied documents and preserve sources.\n---\n# Document helper\n' +
        'Read supplied documents and retain their original sources. '.repeat(15);
    const sha = 'a'.repeat(40);
    const treeSha = 'b'.repeat(40);
    const fileSha = 'c'.repeat(40);
    const row =
        '<a href="/skill-local/synthetic-repo/synthetic-document-helper"><div><span>2</span></div><div><h3>synthetic-document-helper</h3></div><div>2K</div></a>';
    vi.spyOn(server.app.get(BlogSkillsHttp), 'read').mockImplementation(url => {
        if (url.endsWith('/robots.txt')) return Promise.resolve('User-agent: *\nAllow: /\nDisallow: /api/');
        if (url.includes('skills.sh')) return Promise.resolve(row);
        const u = new URL(url);
        if (u.pathname === '/repos/skill-local/synthetic-repo')
            return Promise.resolve(
                JSON.stringify({
                    id: 987654,
                    full_name: 'skill-local/synthetic-repo',
                    archived: false,
                    disabled: false,
                    fork: false,
                    stargazers_count: 3000,
                    default_branch: 'main',
                }),
            );
        if (u.pathname.endsWith('/commits/main'))
            return Promise.resolve(JSON.stringify({ sha, commit: { tree: { sha: treeSha } } }));
        if (u.pathname.endsWith('/git/trees/' + treeSha))
            return Promise.resolve(
                JSON.stringify({
                    truncated: false,
                    tree: [
                        {
                            path: 'skills/synthetic-document-helper/SKILL.md',
                            type: 'blob',
                            mode: '100644',
                            sha: fileSha,
                            size: body.length,
                        },
                    ],
                }),
            );
        if (
            u.pathname.endsWith('/git/blobs/' + fileSha) ||
            u.pathname.endsWith('/contents/skills/synthetic-document-helper/SKILL.md')
        )
            return Promise.resolve(
                JSON.stringify({ encoding: 'base64', content: Buffer.from(body).toString('base64') }),
            );
        throw new Error('Unexpected synthetic GitHub request');
    });
    await server.app.get(BlogSkillsCatalog).refresh();
    expect(await connection.rawConnection.getRepository(BlogSkill).count()).toBe(1);
    expect(await connection.rawConnection.getRepository(BlogSkillObservation).count()).toBe(1);
    const settings = await blog.settingsView(first.ctx);
    await adminClient.query(
        gql`
            mutation ($settings: JSON!, $version: Int!) {
                saveNewsBlogSettings(settings: $settings, expectedVersion: $version)
            }
        `,
        { settings: { ...settings, skillEnabled: true }, version: settings.version },
        language,
    );
    vi.spyOn(server.app.get(EditorialProviderService), 'text').mockImplementation(
        (_ctx, _provider, _model, _system, payload) => {
            textCalls++;
            const data = JSON.parse(payload);
            if (data.article)
                return Promise.resolve({
                    text: JSON.stringify({
                        supported: true,
                        coverageComplete: true,
                        claims: data.article.facts.map((_: unknown, index: number) => ({
                            index,
                            supported: true,
                        })),
                    }),
                    telemetry: { costCurrency: 'USD', actualCostMicrounits: 500 },
                });
            const { sourceUrl } = data;
            return Promise.resolve({
                text: JSON.stringify({
                    title: 'synthetic-document-helper：整理原始文档',
                    summary: '本地合成 Skill 介绍，只用于验证自动推荐。',
                    body:
                        '## 它能做什么\n' +
                        'Read supplied documents and retain their original sources. '.repeat(12),
                    candidateTitles: ['文档整理用途', '原始资料核对', '文档技能介绍'],
                    facts: [
                        {
                            text: 'Read supplied documents',
                            sourceUrl,
                            quote: 'Read supplied documents and retain their original sources.',
                        },
                    ],
                    tags: [],
                    seoDescription: '本地合成 Skill 介绍',
                }),
                telemetry: { costCurrency: 'USD', actualCostMicrounits: 1000 },
            });
        },
    );
    const callsBefore = textCalls;
    await Promise.all(Array.from({ length: 3 }, () => server.app.get(BlogSkillsService).schedule(first.ctx)));
    await vi.waitFor(
        async () => {
            const rec = await connection
                .getRepository(first.ctx, BlogSkillRecommendation)
                .findOneByOrFail({ channelId: first.id });
            expect(rec.status).toBe('PUBLISHED');
        },
        { timeout: 15000, interval: 100 },
    );
    expect(textCalls).toBe(callsBefore + 2);
    expect(
        await connection
            .getRepository(first.ctx, BlogSkillRecommendation)
            .count({ where: { channelId: first.id } }),
    ).toBe(1);
    const article = await connection
        .getRepository(first.ctx, BlogArticle)
        .findOneByOrFail({ channelId: first.id, publishedCategory: 'skills' });
    if (!article.publishedJson) throw new Error('Expected published Skill snapshot');
    const snapshot = JSON.parse(article.publishedJson);
    expect(snapshot).toMatchObject({
        publicationMode: 'AUTOMATIC',
        reviewedAt: null,
        reviewerName: null,
        skill: { repositoryUrl: 'https://github.com/skill-local/synthetic-repo', stars: 3000 },
    });
    const publicDetail = (
        await shopClient.query(
            gql`
                query ($slug: String!) {
                    newsBlogArticle(slug: $slug) {
                        title
                        publicationMode
                        reviewerName
                        reviewedAt
                        skill
                    }
                }
            `,
            { slug: article.slug },
            language,
        )
    ).newsBlogArticle;
    expect(publicDetail.publicationMode).toBe('AUTOMATIC');
    expect(publicDetail.reviewerName).toBeNull();
    const response = await fetch(
        `http://127.0.0.1:${config.apiOptions.port}/storefront/page-data?kind=blog&id=${article.slug}&languageCode=zh_Hans`,
        { headers: { Host: 'localhost', 'vendure-token': first.token } },
    );
    expect(response.status).toBe(200);
    const page = await response.json();
    const html = await server.app.get(StorefrontSeoHtmlService).render(page);
    const dom = load(html);
    expect(dom('a[href="https://github.com/skill-local/synthetic-repo"]').text()).toContain(
        '查看 GitHub 仓库',
    );
    expect(dom('#root').text()).toContain('自动整理');
    expect(dom('script[type="application/ld+json"]').text()).not.toContain('reviewedBy');
    const imageUrl = new URL(snapshot.cover.url, `http://127.0.0.1:${config.apiOptions.port}`);
    expect((await fetch(imageUrl, { headers: { 'vendure-token': first.token } })).status).toBe(200);
    expect(
        (await fetch(imageUrl, { headers: { 'vendure-token': second.token } })).status,
    ).toBeGreaterThanOrEqual(400);
    await blog.publish(first.ctx, String(article.id), article.version, true);
    expect(
        (await fetch(imageUrl, { headers: { 'vendure-token': first.token } })).status,
    ).toBeGreaterThanOrEqual(400);
    await server.app.get(BlogSkillsService).schedule(first.ctx);
    expect(textCalls).toBe(callsBefore + 2);
}, 30000);

it('imports original article images privately, requires use confirmation and publishes only selected media', async () => {
    adminClient.setChannelToken(first.token);
    shopClient.setChannelToken(first.token);
    const nativeUrl = 'https://openai.com/index/synthetic-original-image-rehearsal/';
    const imageUrl = 'https://images.openai.com/synthetic-chart.png';
    const sourceHttp = server.app.get(BlogSourceHttp);
    vi.spyOn(sourceHttp, 'read').mockImplementation((code, url) =>
        Promise.resolve({
            status: 200,
            etag: null,
            lastModified: null,
            body:
                url === nativeUrl
                    ? `<meta property="og:image" content="${imageUrl}"><article><h1>独立的原图采集验收场景</h1>${evidence}</article>`
                    : code === 'openai'
                      ? [
                            '<rss><item><title>ChatGPT synthetic original image rehearsal</title><link>',
                            `${nativeUrl}`,
                            '</link><pubDate>',
                            `${new Date().toUTCString()}`,
                            '</pubDate></item></rss>',
                        ].join('')
                      : '<main>No dated entries</main>',
        }),
    );
    vi.spyOn(sourceHttp, 'imageVersion').mockResolvedValue('synthetic-image-v1');
    const sharp = requireBuilt('sharp') as typeof import('sharp');
    const bytes = await sharp({ create: { width: 1200, height: 600, channels: 3, background: 'white' } })
        .png()
        .toBuffer();
    vi.spyOn(sourceHttp, 'image').mockResolvedValue(bytes);
    const { BlogMediaService } = requireBuilt(
        path.join(path.dirname(requireBuilt.resolve('@vendure/news-blog-plugin')), 'media.js'),
    ) as typeof import('../../news-blog-plugin/dist/media');
    const imported = await Promise.all(
        Array.from({ length: 3 }, () =>
            server.app.get(BlogMediaService).importSource(first.ctx, {
                key: 'native',
                sourceCode: 'openai',
                sourcePageUrl: nativeUrl,
                url: imageUrl,
                alt: '合成来源图',
                caption: '合成验收图',
                credit: '本地验收',
            }),
        ),
    );
    expect(new Set(imported.map(x => x.assetId)).size).toBe(1);
    vi.spyOn(server.app.get(EditorialProviderService), 'text').mockImplementation(() =>
        Promise.resolve({
            text: JSON.stringify({
                ...generated,
                facts: generated.facts.map(x => ({ ...x, sourceUrl: nativeUrl, quote: x.text })),
            }),
            telemetry: { costCurrency: 'USD', actualCostMicrounits: 1000 },
        }),
    );
    const settings = await blog.settings(first.ctx);
    await blog.saveSettings(
        first.ctx,
        { ...blog.config(settings), enabled: true, automationEnabled: true, dailyBudgetMicros: 10000000 },
        settings.version,
    );
    await request('COLLECT');
    let id = '';
    await vi.waitFor(
        async () => {
            const item = await connection
                .getRepository(first.ctx, BlogSourceItem)
                .findOneByOrFail({ channelId: first.id, url: nativeUrl });
            if (!item.metadataJson) throw new Error('Expected source metadata');
            expect(JSON.parse(item.metadataJson).images[0].url).toBe(imageUrl);
            const row = await connection
                .getRepository(first.ctx, BlogArticle)
                .findOneByOrFail({ channelId: first.id, eventKey: item.eventKey });
            expect(JSON.parse(row.draftJson).cover?.kind).toBe('SOURCE');
            id = String(row.id);
        },
        { timeout: 15000, interval: 100 },
    );
    let article = await getArticle(id);
    const cover = article.draft.cover;
    if (!cover) throw new Error('Expected source image cover');
    const address = new URL(cover.url, `http://127.0.0.1:${config.apiOptions.port}`);
    expect((await fetch(address, { headers: { 'vendure-token': first.token } })).status).toBe(400);
    await expect(blog.publish(first.ctx, id, article.version, false, true)).rejects.toThrow('使用依据');
    article = await blog.save(first.ctx, {
        id,
        slug: article.slug,
        expectedVersion: article.version,
        draft: { ...article.draft, cover: { ...cover, rightsConfirmed: true } },
    });
    await blog.publish(first.ctx, id, article.version, false, true);
    expect((await fetch(address, { headers: { 'vendure-token': first.token } })).status).toBe(200);
    expect((await fetch(address, { headers: { 'vendure-token': second.token } })).status).toBe(400);
    const exposed = await blog.read(
        await contexts.create({
            apiType: 'shop',
            channelOrToken: first.token,
            languageCode: LanguageCode.zh_Hans,
        }),
        {},
        article.slug,
    );
    expect(exposed.article?.sourceImages).toBeUndefined();
    expect(exposed.article?.cover).toMatchObject({
        kind: 'SOURCE',
        generated: false,
        sourcePageUrl: nativeUrl,
    });
    const fresh = await blog.get(first.ctx, id);
    await blog.publish(first.ctx, id, fresh.version, true);
    expect((await fetch(address, { headers: { 'vendure-token': first.token } })).status).toBe(400);
});
