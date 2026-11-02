import { emptyBlogDraft, type BlogDraft } from '@vendure/storefront-content-plugin';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import 'reflect-metadata';
import { DataSource, EntitySchema } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SafeProviderUrlService } from '../../image-generation-plugin/src/security/safe-provider-url.service';

import { BlogService } from './blog.service';
import { defaultSettings } from './content';
import { BlogRun } from './entities';
import { BlogQueueService } from './queue.service';
import { SkillDeferred } from './skill-deferral';
import { BlogSkillsCatalog } from './skills-catalog';
import { BlogSkillsHttp } from './skills-http';
import { fingerprint, type SkillEvidence } from './skills-source';
import { BlogSkillsService } from './skills.service';
vi.mock('@vendure/store-management-plugin', () => ({
    StorefrontDataChangedEvent: class {
        constructor(
            public ctx: unknown,
            public topics: unknown,
            public options: unknown,
        ) {}
    },
    StorefrontClientPluginAccessService: class {},
    StorefrontActivationService: class {},
}));
const base = {
    id: { type: Number, primary: true, generated: true as const },
    createdAt: { type: Date, createDate: true },
    updatedAt: { type: Date, updateDate: true },
    channelId: { type: Number },
};
const schemas = [
    new EntitySchema({
        name: 'BlogSource',
        tableName: 'news_blog_source',
        columns: {
            ...base,
            code: { type: String },
            enabled: { type: Boolean },
            version: { type: Number },
            status: { type: String },
            message: { type: String },
            lastCollectedAt: { type: Date, nullable: true },
            etag: { type: String, nullable: true },
            lastModified: { type: String, nullable: true },
        },
        uniques: [{ columns: ['channelId', 'code'] }],
    }),
    new EntitySchema({
        name: 'Tag',
        tableName: 'tag',
        columns: { id: { type: Number, primary: true }, value: { type: String } },
    }),
    new EntitySchema({
        name: 'BlogSourceItem',
        tableName: 'news_blog_source_item',
        columns: {
            ...base,
            sourceCode: { type: String },
            identityKey: { type: String },
            contentHash: { type: String },
            eventKey: { type: String },
            url: { type: String },
            title: { type: String },
            category: { type: String },
            body: { type: 'text' },
            metadataJson: { type: 'text', nullable: true },
            sourcePublishedAt: { type: Date },
            fetchedAt: { type: Date },
            status: { type: String },
        },
    }),

    new EntitySchema({
        name: 'BlogSettings',
        tableName: 'news_blog_settings',
        columns: {
            ...base,
            version: { type: Number },
            enabled: { type: Boolean },
            automationEnabled: { type: Boolean },
            intervalMinutes: { type: Number },
            dailyMaxArticles: { type: Number },
            settingsJson: { type: 'text' },
            lastCollectedAt: { type: Date, nullable: true },
            leaseUntil: { type: Date, nullable: true },
        },
        uniques: [{ columns: ['channelId'] }],
    }),
    new EntitySchema({
        name: 'BlogArticle',
        tableName: 'news_blog_article',
        columns: {
            ...base,
            slug: { type: String },
            eventKey: { type: String, nullable: true },
            version: { type: Number },
            state: { type: String },
            draftJson: { type: 'text' },
            publishedJson: { type: 'text', nullable: true },
            publishedAt: { type: Date, nullable: true },
            issuesJson: { type: 'text' },
            publishedTitle: { type: String, default: '' },
            publishedCategory: { type: String, default: '' },
            publishedSearchText: { type: 'text', nullable: true },
            publishedPinned: { type: Boolean, default: false },
        },
        uniques: [{ columns: ['channelId', 'slug'] }, { columns: ['channelId', 'eventKey'] }],
    }),
    new EntitySchema({
        name: 'BlogRun',
        tableName: 'news_blog_run',
        columns: {
            ...base,
            requestKey: { type: String },
            kind: { type: String },
            state: { type: String },
            budgetDate: { type: String },
            reservedMicros: { type: Number },
            chargedMicros: { type: Number },
            inputJson: { type: 'text' },
            telemetryJson: { type: 'text', nullable: true },
            message: { type: String },
            startedAt: { type: Date, nullable: true },
            completedAt: { type: Date, nullable: true },
        },
        uniques: [{ columns: ['channelId', 'requestKey'] }],
    }),
    new EntitySchema({
        name: 'BlogRevision',
        tableName: 'news_blog_revision',
        columns: {
            ...base,
            articleId: { type: Number },
            version: { type: Number },
            action: { type: String },
            actorId: { type: String },
            snapshotJson: { type: 'text', nullable: true },
        },
        uniques: [{ columns: ['channelId', 'articleId', 'version'] }],
    }),
    new EntitySchema({
        name: 'Channel',
        tableName: 'channel',
        columns: { id: { type: Number, primary: true }, code: { type: String } },
    }),
    new EntitySchema<import('@vendure/core').Asset>({
        name: 'Asset',
        tableName: 'asset',
        columns: {
            id: { type: Number, primary: true },
            source: { type: String },
            preview: { type: String },
            mimeType: { type: String },
        },
        relations: {
            channels: { type: 'many-to-many', target: 'Channel', joinTable: true },
            tags: { type: 'many-to-many', target: 'Tag', joinTable: true },
        },
    }),
];
const globalBase = {
    id: { type: Number, primary: true, generated: true as const },
    createdAt: { type: Date, createDate: true },
    updatedAt: { type: Date, updateDate: true },
};
schemas.push(
    new EntitySchema({
        name: 'BlogSkillObservation',
        tableName: 'news_blog_skill_observation',
        columns: {
            ...globalBase,
            identity: { type: String },
            stars: { type: Number },
            rankingJson: { type: 'text' },
            observedAt: { type: Date },
        },
    }),
    new EntitySchema({
        name: 'BlogSkill',
        tableName: 'news_blog_skill',
        columns: {
            ...globalBase,
            identity: { type: String, unique: true },
            repositoryId: { type: String },
            repository: { type: String },
            directory: { type: String },
            name: { type: String },
            contentHash: { type: String },
            body: { type: 'text' },
            evidenceJson: { type: 'text' },
            status: { type: String },
            message: { type: String },
            checkedAt: { type: Date },
        },
    }),
    new EntitySchema({
        name: 'BlogSkillState',
        tableName: 'news_blog_skill_state',
        columns: {
            ...globalBase,
            code: { type: String, unique: true },
            leaseUntil: { type: Date, nullable: true },
            lastCollectedAt: { type: Date, nullable: true },
            requestWindow: { type: Date, nullable: true },
            requestCount: { type: Number },
            message: { type: String },
        },
    }),
    new EntitySchema({
        name: 'BlogSkillRecommendation',
        tableName: 'news_blog_skill_recommendation',
        columns: {
            ...base,
            day: { type: String },
            identity: { type: String },
            repositoryId: { type: String },
            status: { type: String },
            message: { type: String },
            articleId: { type: String, nullable: true },
            contentHash: { type: String },
            evidenceJson: { type: 'text' },
        },
        uniques: [{ columns: ['channelId', 'day'] }, { columns: ['channelId', 'identity'] }],
    }),
);
let db: DataSource;
let service: BlogService;
let connection: any;
const contextFor = (channelId = 1) =>
    ({
        channelId,
        activeUserId: '1',
        apiType: 'admin',
        languageCode: 'zh_Hans',
        userHasPermissions: () => true,
        copy(this: { channelId: number; languageCode: string }, options: { languageCode?: string } = {}) {
            return { ...this, ...options };
        },
    }) as never;
const draft = (): BlogDraft => ({
    ...emptyBlogDraft(),
    title: '官方更新解读',
    summary: '来源清楚的新闻摘要',
    body: '## 官方变化\n' + '只根据官方公告整理的已核对资讯。'.repeat(20),
    category: 'chatgpt',
    sources: [
        { label: '官方公告', url: 'https://openai.com/news/official', accessedAt: new Date().toISOString() },
    ],
    cover: { assetId: '1', url: '/assets/preview/cover.webp', alt: '示意图', generated: true },
});
beforeEach(async () => {
    db = await new DataSource({ type: 'sqljs', entities: schemas, synchronize: true }).initialize();
    await db.getRepository('Channel').save([
        { id: 1, code: 'a' },
        { id: 2, code: 'b' },
    ]);
    await db.getRepository('Asset').save({
        id: 1,
        source: 'source/cover.webp',
        preview: 'preview/cover.webp',
        mimeType: 'image/webp',
        channels: [{ id: 1 }],
    });
    connection = {
        rawConnection: { getRepository: (type: any) => db.getRepository(type.name) },
        getRepository: (c: any, t: any) => (c.manager ?? db.manager).getRepository(t.name),
        withTransaction: (c: any, fn: any) => db.transaction(manager => fn({ ...c, manager })),
    };
    service = new BlogService(
        connection as never,
        { findOneByUserId: () => Promise.resolve({ firstName: '真实', lastName: '编辑' }) } as never,
        { publish: vi.fn() } as never,
        {
            isEnabled: (context: { languageCode: string }) =>
                Promise.resolve(context.languageCode === 'zh_Hans'),
        } as never,
        { getAccessMode: () => Promise.resolve('LIVE') } as never,
    );
    await db.getRepository('BlogSourceItem').save(
        [1, 2].map(id => ({
            id,
            channelId: 1,
            sourceCode: 'openai',
            identityKey: `item-${id}`,
            contentHash: `hash-${id}`,
            eventKey: `event-${id}`,
            url: `https://openai.com/news/fixture-${id}`,
            title: `Official fixture ${id}`,
            category: 'chatgpt',
            body: 'Only synthetic test evidence. '.repeat(30),
            sourcePublishedAt: new Date(),
            fetchedAt: new Date(),
            status: 'READY',
        })),
    );
    const settings = await service.settings(contextFor());
    await db.getRepository('BlogSettings').update(settings.id, {
        enabled: true,
        settingsJson: JSON.stringify({
            ...defaultSettings,
            textProviderCode: 'configured',
            textModel: 'text-model',
            dailyBudgetMicros: 1000000,
            textReserveMicros: 600000,
        }),
    });
    return Promise.resolve();
});
afterEach(async () => {
    await db.destroy();
});
describe('channel publication and budget boundaries', () => {
    it('keeps unpublished edits private and retains the reviewed snapshot until publication', async () => {
        const saved = await service.save(contextFor(), {
            slug: 'official-update',
            expectedVersion: 0,
            draft: draft(),
        });
        await expect(service.read(contextFor(), {}, saved.slug)).rejects.toThrow();
        const published = await service.publish(contextFor(), saved.id, saved.version, false, true);
        expect((await service.read(contextFor(), {}, saved.slug)).article?.reviewerName).toBe('真实 编辑');
        const edited = await service.save(contextFor(), {
            id: saved.id,
            slug: saved.slug,
            expectedVersion: published.version,
            draft: { ...draft(), title: '尚未审核的新标题' },
        });
        expect((await service.read(contextFor(), {}, saved.slug)).article?.title).toBe('官方更新解读');
        await expect(service.publish(contextFor(), saved.id, published.version, false, true)).rejects.toThrow(
            '版本',
        );
        await service.publish(contextFor(), saved.id, edited.version, true);
        await expect(service.read(contextFor(), {}, saved.slug)).rejects.toThrow();
    });
    it('denies another channel article IDs, draft media and published media after withdrawal', async () => {
        const saved = await service.save(contextFor(), {
            slug: 'channel-isolation',
            expectedVersion: 0,
            draft: draft(),
        });
        expect(await service.isAssetPublic(contextFor(), 'preview/cover.webp')).toBe(false);
        await expect(service.get(contextFor(2), saved.id)).rejects.toThrow();
        await expect(
            service.save(contextFor(2), { slug: 'wrong-asset', expectedVersion: 0, draft: draft() }),
        ).rejects.toThrow('当前店铺');
        const published = await service.publish(contextFor(), saved.id, saved.version, false, true);
        expect(await service.isAssetPublic(contextFor(), 'preview/cover.webp')).toBe(true);
        expect(
            await service.isAssetPublic(
                { ...(contextFor() as object), languageCode: 'en' },
                'preview/cover.webp',
            ),
        ).toBe(true);
        expect(await service.isAssetPublic(contextFor(2), 'preview/cover.webp')).toBe(false);
        const page = await service.read(contextFor(), {}, saved.slug);
        await service.publish(contextFor(), saved.id, published.version, true);
        expect(await service.isAssetPublic(contextFor(), 'preview/cover.webp')).toBe(false);
        await expect(service.assertCurrent(contextFor(), page)).rejects.toThrow();
    });
    it('reserves the budget before a paid job and makes duplicate request keys idempotent', async () => {
        const first = await service.request(contextFor(), 'GENERATE', 'same-request-key', {
            sourceIds: ['1'],
        });
        const duplicate = await service.request(contextFor(), 'GENERATE', 'same-request-key', {
            sourceIds: ['1'],
        });
        expect(duplicate.id).toBe(first.id);
        expect(
            (await service.request(contextFor(), 'GENERATE', 'different-click-key', { sourceIds: ['1'] })).id,
        ).toBe(first.id);
        expect(await db.getRepository('BlogRun').count()).toBe(1);
        await expect(
            service.request(contextFor(), 'GENERATE', 'second-request-key', { sourceIds: ['2'] }),
        ).rejects.toThrow('预算不足');
        expect((await db.getRepository('BlogRun').find())[0].reservedMicros).toBe(600000);
    });
    it('does not enable paid writing with no budget and uses a zero-cost template cover', async () => {
        await db
            .getRepository('BlogSettings')
            .update({ channelId: 1 }, { settingsJson: JSON.stringify(defaultSettings) });
        await expect(
            service.request(contextFor(), 'GENERATE', 'unconfigured-request', { sourceIds: ['1'] }),
        ).rejects.toThrow('配置');
        const saved = await service.save(contextFor(), {
            slug: 'template-cover',
            expectedVersion: 0,
            draft: { ...draft(), cover: null },
        });
        const run = await db.getRepository('BlogRun').findOneByOrFail({ kind: 'MEDIA' });
        expect(run.reservedMicros).toBe(0);
        expect(JSON.parse(run.inputJson).articleId).toBe(saved.id);
    });
});

describe('paid worker recovery', () => {
    function queue(provider: unknown, media: unknown = {}, http: unknown = {}) {
        return new BlogQueueService(
            {} as never,
            {
                create: ({ channelOrToken }: any) => Promise.resolve(contextFor(Number(channelOrToken.id))),
            } as never,
            connection,
            service,
            http as never,
            provider as never,
            media as never,
        );
    }
    it('records failed source reads without fabricating articles or calling a model', async () => {
        const provider = { text: vi.fn() };
        const http = { read: vi.fn().mockRejectedValue(new Error('unavailable')) };
        const run = await service.request(contextFor(), 'COLLECT', 'source-failure-test');
        await queue(provider, {}, http).process('1', String(run.id));
        expect(await db.getRepository('BlogArticle').count()).toBe(0);
        expect(provider.text).not.toHaveBeenCalled();
        expect(await db.getRepository('BlogSource').countBy({ status: 'FAILED' })).toBe(4);
    });
    it('queues changed evidence for an older published event without replacing its public snapshot', async () => {
        const saved = await service.save(contextFor(), {
            slug: 'older-published-event',
            expectedVersion: 0,
            draft: draft(),
        });
        const published = await service.publish(contextFor(), saved.id, saved.version, false, true);
        await db.getRepository('BlogArticle').update(saved.id, { eventKey: 'event-1' });
        await db.getRepository('BlogSourceItem').update(1, {
            sourcePublishedAt: new Date(Date.now() - 5 * 86400000),
            contentHash: 'updated-evidence-for-existing-story',
            fetchedAt: new Date(),
        });
        await db.getRepository('BlogSourceItem').update(2, { status: 'INSUFFICIENT', body: '' });
        await db.getRepository('BlogSettings').update({ channelId: 1 }, { automationEnabled: true });
        const http = {
            read: vi.fn().mockResolvedValue({ status: 304, body: '', etag: null, lastModified: null }),
        };
        const run = await service.request(contextFor(), 'COLLECT', 'changed-existing-story');
        await queue({}, {}, http).process('1', String(run.id));
        const updates = await db.getRepository('BlogRun').findBy({ kind: 'GENERATE' });
        expect(updates).toHaveLength(1);
        expect(JSON.parse(updates[0].inputJson)).toMatchObject({
            articleId: saved.id,
            expectedVersion: published.version,
            sourceIds: ['1'],
        });
        expect((await service.read(contextFor(), {}, saved.slug)).article?.title).toBe(saved.draft.title);
    });
    it('never replays an ambiguous paid call and requires recorded reconciliation before retry', async () => {
        const run = await service.request(contextFor(), 'GENERATE', 'ambiguous-request', {
            sourceIds: ['1'],
        });
        const provider = {
            text: vi.fn().mockRejectedValue(new Error('upstream secret must never be logged')),
        };
        const worker = queue(provider);
        await worker.process('1', String(run.id));
        await worker.process('1', String(run.id));
        expect(provider.text).toHaveBeenCalledTimes(1);
        const unknown = await db.getRepository('BlogRun').findOneByOrFail({ id: run.id });
        expect(unknown.state).toBe('UNKNOWN');
        expect(unknown.reservedMicros).toBe(600000);
        expect(unknown.message).not.toContain('secret');
        await expect(service.retry(contextFor(), String(run.id), 'retry-before-check')).rejects.toThrow(
            '核对',
        );
        await service.reconcile(contextFor(), String(run.id), 100000);
        const retry = await service.retry(contextFor(), String(run.id), 'retry-after-check');
        expect(retry.id).not.toBe(run.id);
        expect(retry.state).toBe('QUEUED');
        expect((await service.retry(contextFor(), String(run.id), 'repeat-retry-click')).id).toBe(retry.id);
    });
    it('falls back to a template without charging a customer or publishing the article', async () => {
        await db.getRepository('BlogSettings').update(
            { channelId: 1 },
            {
                settingsJson: JSON.stringify({
                    ...defaultSettings,
                    imageProviderCode: 'configured',
                    imageModel: 'image-model',
                    dailyBudgetMicros: 1000000,
                    imageReserveMicros: 200000,
                }),
            },
        );
        const saved = await service.save(contextFor(), {
            slug: 'fallback-image',
            expectedVersion: 0,
            draft: { ...draft(), cover: null },
        });
        const run = await db.getRepository('BlogRun').findOneByOrFail({ kind: 'MEDIA' });
        const provider = { image: vi.fn().mockRejectedValue(new Error('timeout')) };
        const media = {
            createCover: vi.fn().mockResolvedValue(draft().cover),
            createIllustrations: vi.fn().mockResolvedValue([]),
        };
        const worker = queue(provider, media);
        await worker.process('1', String(run.id));
        await worker.process('1', String(run.id));
        expect(provider.image).toHaveBeenCalledTimes(1);
        expect(media.createCover).toHaveBeenCalledTimes(1);
        expect((await service.get(contextFor(), saved.id)).publishedJson).toBeNull();
        const result = await db.getRepository('BlogRun').findOneByOrFail({ id: run.id });
        expect(result.state).toBe('UNKNOWN');
        expect(result.reservedMicros).toBe(200000);
        expect(result.message).toContain('模板');
    });
    it('does not call a supplier or overwrite a newer manual edit', async () => {
        const saved = await service.save(contextFor(), {
            slug: 'edit-during-media',
            expectedVersion: 0,
            draft: { ...draft(), cover: null },
        });
        const run = await db.getRepository('BlogRun').findOneByOrFail({ kind: 'MEDIA' });
        await service.save(contextFor(), {
            id: saved.id,
            slug: saved.slug,
            expectedVersion: saved.version,
            draft: { ...draft(), title: '人工保存的新标题' },
        });
        const provider = { image: vi.fn() };
        await queue(provider).process('1', String(run.id));
        expect(provider.image).not.toHaveBeenCalled();
        expect(JSON.parse((await service.get(contextFor(), saved.id)).draftJson).title).toBe(
            '人工保存的新标题',
        );
        expect((await db.getRepository('BlogRun').findOneByOrFail({ id: run.id })).state).toBe('FAILED');
    });
});

describe('public GitHub request admission', () => {
    it('keeps multibyte documents within the database byte limit', async () => {
        const http = new BlogSkillsHttp({} as never, connection);
        vi.spyOn(http, 'read').mockResolvedValue('汉'.repeat(20000));
        await expect(
            http.document('owner/repo', 'a'.repeat(40), 'skills/source-test/SKILL.md'),
        ).rejects.toThrow('原文过长');
    });

    it('renews an expired anonymous window before catalog admission, without paid publication traffic', async () => {
        const http = new BlogSkillsHttp({ safeUrls: {} } as never, connection);
        const state = await http.state();
        await db
            .getRepository('BlogSkillState')
            .update(state.id, { requestCount: 40, requestWindow: new Date(Date.now() - 1000) });
        await Promise.all([http.state(), http.state()]);
        const renewed = await http.state();
        expect(renewed.requestCount).toBe(0);
        expect(renewed.requestWindow?.getTime()).toBeGreaterThan(Date.now());
        await db.getRepository('BlogSkillState').update(state.id, { requestCount: 7 });
        expect((await http.state()).requestCount).toBe(7);
    });

    it('enforces a shared forty-request window before DNS and rejects unconfigured hosts', async () => {
        const resolveForRequest = vi.fn().mockRejectedValue(new Error('Synthetic network boundary'));
        const http = new BlogSkillsHttp({ safeUrls: { resolveForRequest } } as never, connection);
        await expect(http.read('http://127.0.0.1/private')).rejects.toThrow('白名单');
        await Promise.allSettled(
            Array.from({ length: 45 }, () => http.read('https://api.github.com/repos/test/skill')),
        );
        expect(resolveForRequest).toHaveBeenCalledTimes(40);
        expect((await http.state()).requestCount).toBe(40);
        await expect(http.read('https://api.github.com/repos/test/skill')).rejects.toThrow(
            '等待请求窗口恢复',
        );
        expect(resolveForRequest).toHaveBeenCalledTimes(40);
    });
});

describe('discovery headroom', () => {
    it('reserves the last eight public requests for publication verification', async () => {
        const resolveForRequest = vi.fn().mockRejectedValue(new Error('No network in this test'));
        const http = new BlogSkillsHttp({ safeUrls: { resolveForRequest } } as never, connection);
        for (let i = 0; i < 32; i++)
            await expect(
                http.read('https://api.github.com/repos/test/skill', 0, 'discovery'),
            ).rejects.toThrow();
        await expect(
            http.read('https://api.github.com/repos/test/skill', 0, 'discovery'),
        ).rejects.toBeInstanceOf(SkillDeferred);
        expect(resolveForRequest).toHaveBeenCalledTimes(32);
        await expect(http.read('https://api.github.com/repos/test/skill')).rejects.toThrow();
        expect(resolveForRequest).toHaveBeenCalledTimes(33);
    });
});

describe('daily Skill recommendations with real database state', () => {
    const evidence = (identity = 'skill-a', repo = '100'): SkillEvidence => ({
        repository: 'owner/repo' + repo,
        repositoryId: repo,
        directory: 'skills/document-helper',
        name: 'document-helper',
        description: 'Summarize supplied documents and preserve sources.',
        body:
            '---\nname: document-helper\ndescription: Summarize supplied documents and preserve sources.\n---\n' +
            'Read supplied documents and retain their original sources. '.repeat(20),
        readme: '',
        commit: 'a'.repeat(40),
        stars: 2500,
        rankings: [{ view: 'trending', rank: 3, url: 'https://www.skills.sh/trending', displayCount: '1K' }],
        observedAt: new Date().toISOString(),
        aliases: [identity],
    });
    async function ready(identity = 'skill-a', repo = '100') {
        const e = evidence(identity, repo);
        await db.getRepository('BlogSkill').save({
            identity,
            repositoryId: repo,
            repository: e.repository,
            directory: e.directory,
            name: e.name,
            contentHash: fingerprint(e.body),
            body: e.body,
            evidenceJson: JSON.stringify(e),
            status: 'READY',
            message: '',
            checkedAt: new Date(),
        });
        return e;
    }
    async function enable(channel = 1) {
        const row = await service.settings(contextFor(channel));
        await service.saveSettings(
            contextFor(channel),
            {
                enabled: true,
                skillEnabled: true,
                textProviderCode: 'synthetic',
                textModel: 'synthetic-model',
                textReserveMicros: 100,
                dailyBudgetMicros: 10000,
            },
            row.version,
        );
    }
    function fixture(options: { missingQuote?: boolean; verified?: boolean } = {}) {
        const provider = {
            text: vi.fn().mockImplementation((_ctx, _provider, _model, _system, payload) => {
                const input = JSON.parse(payload);
                if (input.article)
                    return Promise.resolve({
                        text: JSON.stringify({
                            supported: options.verified !== false,
                            coverageComplete: true,
                            claims: input.article.facts.map((_: unknown, index: number) => ({
                                index,
                                supported: true,
                            })),
                        }),
                        telemetry: { costCurrency: 'USD', actualCostMicrounits: 4 },
                    });
                return Promise.resolve({
                    text: JSON.stringify({
                        title: 'document-helper：整理项目文档',
                        summary: '只根据原始说明整理。',
                        body:
                            '## 它能做什么\n' +
                            'Read supplied documents and retain their original sources. '.repeat(12),
                        candidateTitles: ['文档用途介绍', '项目文档整理', '来源核对工具'],
                        facts: [
                            {
                                text: 'Read supplied documents',
                                sourceUrl: input.sourceUrl,
                                quote: options.missingQuote
                                    ? undefined
                                    : 'Read supplied documents and retain their original sources.',
                            },
                        ],
                        tags: [],
                        seoDescription: '文档技能介绍',
                    }),
                    telemetry: { costCurrency: 'USD', actualCostMicrounits: 10 },
                });
            }),
        };
        const catalog = { verify: vi.fn((e: SkillEvidence) => Promise.resolve(e)) };
        const skills = new BlogSkillsService(
            connection,
            service,
            catalog as never,
            {} as never,
            provider as never,
            { createCover: () => Promise.resolve(draft().cover) } as never,
            { publish: vi.fn() } as never,
        );
        const review = async () => {
            const run = await db.getRepository<BlogRun>('BlogRun').findOneByOrFail({ kind: 'SKILL_REVIEW' });
            await skills.process(
                contextFor(),
                run,
                JSON.parse(run.inputJson),
                () => {
                    return Promise.resolve();
                },
                () => {
                    return Promise.resolve();
                },
            );
        };
        return { skills, provider, catalog, review };
    }
    it('publishes once, preserves manual-news review, and retains identity after withdrawal', async () => {
        await enable();
        await ready();
        const { skills, provider, review } = fixture();
        await skills.schedule(contextFor());
        await skills.schedule(contextFor());
        expect(await db.getRepository('BlogSkillRecommendation').count()).toBe(1);
        const run = await db.getRepository<BlogRun>('BlogRun').findOneByOrFail({ kind: 'SKILL' });
        expect(await db.getRepository('BlogRun').count({ where: { kind: 'SKILL' } })).toBe(1);
        await skills.process(
            contextFor(),
            run,
            JSON.parse(run.inputJson),
            () => {
                return Promise.resolve();
            },
            () => {
                return Promise.resolve();
            },
        );
        expect(await db.getRepository('BlogArticle').countBy({ publishedCategory: 'skills' })).toBe(0);
        await review();
        await skills.process(
            contextFor(),
            run,
            JSON.parse(run.inputJson),
            () => {
                return Promise.resolve();
            },
            () => {
                return Promise.resolve();
            },
        );
        expect(provider.text).toHaveBeenCalledTimes(2);
        const article = await db
            .getRepository('BlogArticle')
            .findOneByOrFail({ publishedCategory: 'skills' });
        const snapshot = JSON.parse(article.publishedJson);
        expect(snapshot).toMatchObject({
            publicationMode: 'AUTOMATIC',
            reviewerName: null,
            reviewedAt: null,
            skill: { stars: 2500 },
        });
        await service.publish(contextFor(), String(article.id), article.version, true);
        await skills.schedule(contextFor(), new Date(Date.now() + 86400000));
        expect(await db.getRepository('BlogSkillRecommendation').count()).toBe(1);
        expect(await db.getRepository('BlogRevision').findOneBy({ action: 'AUTO_PUBLISH' })).toMatchObject({
            actorId: 'system:news-blog-skill',
        });
    });
    it('creates an update draft while preserving the public snapshot and subsequent human changes', async () => {
        await enable();
        await ready();
        const { skills, review } = fixture();
        await skills.schedule(contextFor());
        const initial = await db.getRepository<BlogRun>('BlogRun').findOneByOrFail({ kind: 'SKILL' });
        await skills.process(
            contextFor(),
            initial,
            JSON.parse(initial.inputJson),
            () => {
                return Promise.resolve();
            },
            () => {
                return Promise.resolve();
            },
        );
        await review();
        const row = await db.getRepository('BlogArticle').findOneByOrFail({ publishedCategory: 'skills' });
        const published = JSON.parse(row.publishedJson);
        const e = {
            ...evidence(),
            body: evidence().body + ' New documented capability.',
            observedAt: new Date(Date.now() + 1000).toISOString(),
        };
        await db
            .getRepository('BlogSkill')
            .update(
                { identity: 'skill-a' },
                { body: e.body, contentHash: fingerprint(e.body), evidenceJson: JSON.stringify(e) },
            );
        await skills.schedule(contextFor());
        const runs = await db.getRepository<BlogRun>('BlogRun').find({ where: { kind: 'SKILL' } });
        const update = runs.find(x => JSON.parse(x.inputJson).skillUpdateHash);
        if (!update) throw new Error('Expected a Skill update run');
        expect(update).toBeTruthy();
        await skills.process(
            contextFor(),
            update,
            JSON.parse(update.inputJson),
            () => {
                return Promise.resolve();
            },
            () => {
                return Promise.resolve();
            },
        );
        const updated = await db.getRepository('BlogArticle').findOneByOrFail({ id: row.id });
        expect(updated.state).toBe('PENDING_REVIEW');
        expect(JSON.parse(updated.publishedJson).body).toBe(published.body);
        const before = await db.getRepository('BlogRun').count();
        await service.save(contextFor(), {
            id: String(updated.id),
            slug: updated.slug,
            expectedVersion: updated.version,
            draft: { ...JSON.parse(updated.draftJson), title: '人工保留的修改' },
        });
        await skills.schedule(contextFor());
        expect(await db.getRepository('BlogRun').count()).toBe(before);
        expect(
            JSON.parse((await db.getRepository('BlogArticle').findOneByOrFail({ id: row.id })).draftJson)
                .title,
        ).toBe('人工保留的修改');
    });
    it('leaves candidates unpublished when budget is absent and isolates recommendations by Channel', async () => {
        await ready();
        const { skills } = fixture();
        const row = await service.settings(contextFor());
        await service.saveSettings(
            contextFor(),
            { enabled: true, skillEnabled: true, dailyBudgetMicros: 0, textReserveMicros: 0 },
            row.version,
        );
        await skills.schedule(contextFor());
        expect(await db.getRepository('BlogSkillRecommendation').count()).toBe(0);
        expect(await db.getRepository('BlogArticle').count()).toBe(0);
        await enable(1);
        await enable(2);
        await skills.schedule(contextFor(1));
        await skills.schedule(contextFor(2));
        expect(await db.getRepository('BlogSkillRecommendation').count()).toBe(2);
        const rec = await db.getRepository('BlogSkillRecommendation').findOneByOrFail({ channelId: 1 });
        await expect(
            service.request(contextFor(2), 'SKILL', 'cross-store-skill', {
                recommendationId: String(rec.id),
            }),
        ).rejects.toThrow();
    });
    it('keeps unsupported quotes and rejected independent verification pending without automatic publication', async () => {
        await enable();
        await ready();
        const { skills, provider } = fixture({ missingQuote: true });
        await skills.schedule(contextFor());
        const run = await db.getRepository<BlogRun>('BlogRun').findOneByOrFail({ kind: 'SKILL' });
        await skills.process(
            contextFor(),
            run,
            JSON.parse(run.inputJson),
            () => {
                return Promise.resolve();
            },
            () => {
                return Promise.resolve();
            },
        );
        expect(provider.text).toHaveBeenCalledTimes(1);
        expect(await db.getRepository('BlogArticle').countBy({ publishedCategory: 'skills' })).toBe(0);
        expect(
            (await db.getRepository('BlogSkillRecommendation').findOneByOrFail({ channelId: 1 })).status,
        ).toBe('REVIEW');
    });
    it('does not publish a quoted draft if the independent verifier rejects its full prose', async () => {
        await enable();
        await ready();
        const { skills, provider, review } = fixture({ verified: false });
        await skills.schedule(contextFor());
        const run = await db.getRepository<BlogRun>('BlogRun').findOneByOrFail({ kind: 'SKILL' });
        await skills.process(
            contextFor(),
            run,
            JSON.parse(run.inputJson),
            () => {
                return Promise.resolve();
            },
            () => {
                return Promise.resolve();
            },
        );
        await review();
        expect(provider.text).toHaveBeenCalledTimes(2);
        expect(await db.getRepository('BlogArticle').countBy({ publishedCategory: 'skills' })).toBe(0);
        expect(
            (await db.getRepository('BlogSkillRecommendation').findOneByOrFail({ channelId: 1 })).status,
        ).toBe('REVIEW');
    });
    it('defers source rate limits before a paid call and resumes the same run after the window', async () => {
        await enable();
        await ready();
        const { skills, provider, catalog } = fixture();
        await skills.schedule(contextFor());
        const run = await db.getRepository<BlogRun>('BlogRun').findOneByOrFail({ kind: 'SKILL' });
        catalog.verify.mockRejectedValueOnce(new SkillDeferred(new Date(Date.now() - 1000)));
        const worker = new BlogQueueService(
            {} as never,
            { create: () => Promise.resolve(contextFor()) } as never,
            connection,
            service,
            {} as never,
            provider as never,
            {} as never,
            {
                tick: () => {
                    return Promise.resolve();
                },
                process: skills.process.bind(skills),
            } as never,
        );
        const add = vi.fn();
        (worker as any).queues.set('SKILL', { add });
        await worker.process('1', String(run.id));
        expect((await db.getRepository('BlogRun').findOneByOrFail({ id: run.id })).state).toBe('DEFERRED');
        expect(provider.text).not.toHaveBeenCalled();
        await worker.tick();
        expect(add).toHaveBeenCalledTimes(1);
        expect((await db.getRepository('BlogRun').findOneByOrFail({ id: run.id })).state).toBe('QUEUED');
        return Promise.resolve();
    });
    it('does not call a model for stale evidence, missing source or an existing human edit', async () => {
        await enable();
        await ready();
        const { skills, provider, catalog } = fixture();
        await skills.schedule(contextFor());
        const run = await db.getRepository<BlogRun>('BlogRun').findOneByOrFail({ kind: 'SKILL' });
        catalog.verify.mockRejectedValue(new Error('source missing'));
        await expect(
            skills.process(
                contextFor(),
                run,
                JSON.parse(run.inputJson),
                () => {
                    return Promise.resolve();
                },
                () => {
                    return Promise.resolve();
                },
            ),
        ).rejects.toThrow();
        expect(provider.text).not.toHaveBeenCalled();
        expect(await db.getRepository('BlogArticle').count()).toBe(0);
    });
});

describe('source tracking and admin pagination regressions', () => {
    it('records unavailable new articles and recovers after a feed 304 without losing last valid evidence', async () => {
        await service.sources(contextFor());
        await db
            .getRepository('BlogSource')
            .createQueryBuilder()
            .update()
            .set({ enabled: false })
            .where("code != 'openai'")
            .execute();
        const url = 'https://openai.com/index/fetch-recovery/';
        let feedChanged = true;
        let unavailable = true;
        const body = 'Official source evidence remains available after a transient read failure. '.repeat(8);
        const read = vi.fn((_code: string, target: string) => {
            if (target.endsWith('rss.xml'))
                return Promise.resolve({
                    status: feedChanged ? 200 : 304,
                    body: `<rss><item><title>Recovery update</title><link>${url}</link><pubDate>${new Date().toISOString()}</pubDate></item></rss>`,
                    etag: 'index',
                    lastModified: null,
                });
            if (unavailable) return Promise.reject(new Error('synthetic HTTP 403'));
            return Promise.resolve({
                status: 200,
                body: `<article>${body}</article>`,
                etag: 'article',
                lastModified: null,
            });
        });
        const worker = new BlogQueueService(
            {} as never,
            { create: () => Promise.resolve(contextFor()) } as never,
            connection,
            service,
            { read } as never,
            {} as never,
            {} as never,
        );
        const collect = async (key: string) => {
            const run = await service.request(contextFor(), 'COLLECT', key);
            await worker.process('1', String(run.id));
        };
        const records = db.getRepository('BlogSourceItem');
        await collect('unavailable-new');
        const missing = await records.findOneByOrFail({ url });
        expect(missing.status).toBe('INSUFFICIENT');
        expect(missing.body).toBe('');
        expect((await db.getRepository('BlogSource').findOneByOrFail({ code: 'openai' })).status).toBe(
            'FAILED',
        );
        expect(read.mock.calls.filter(x => x[1] === url)).toHaveLength(1);
        await records.update(missing.id, { fetchedAt: new Date(0) });
        feedChanged = false;
        unavailable = false;
        await collect('recovered-new');
        const recovered = await records.findOneByOrFail({ url });
        expect(recovered.id).toBe(missing.id);
        expect(recovered.status).toBe('READY');
        expect(recovered.body).toBe(body.trim());
        expect((await db.getRepository('BlogSource').findOneByOrFail({ code: 'openai' })).status).toBe('OK');
        feedChanged = true;
        unavailable = true;
        await collect('unavailable-existing');
        expect((await records.findOneByOrFail({ url })).body).toBe(recovered.body);
        expect(JSON.parse((await records.findOneByOrFail({ url })).metadataJson).readFailure).toBe(true);
        await records.update(missing.id, { fetchedAt: new Date(0) });
        feedChanged = false;
        unavailable = false;
        await collect('recovered-existing');
        expect(JSON.parse((await records.findOneByOrFail({ url })).metadataJson).readFailure).not.toBe(true);
        expect(await records.count({ where: { url } })).toBe(1);
        expect(await db.getRepository('BlogArticle').count()).toBe(0);
    });
    it('searches older records outside the former 200-row limit with channel-scoped paging', async () => {
        await db.getRepository('BlogArticle').save(
            Array.from({ length: 205 }, (_, i) => ({
                channelId: 1,
                slug: `page-${i}`,
                eventKey: null,
                version: 1,
                state: 'DRAFT',
                draftJson: JSON.stringify({
                    ...draft(),
                    title: i === 0 ? '最早的指定文章' : `Article ${i}`,
                }),
                publishedJson: null,
                publishedAt: null,
                issuesJson: '[]',
            })),
        );
        expect((await service.articleList(contextFor(), { skip: 200, take: 25 })).items).toHaveLength(5);
        expect((await service.articleList(contextFor(), { term: '最早的指定文章' })).totalItems).toBe(1);
        expect((await service.articleList(contextFor(2), { take: 25 })).totalItems).toBe(0);
    });
    it('tracks an eight-day-old published article even when the feed is 304, including media-only updates', async () => {
        const saved = await service.save(contextFor(), {
            slug: 'tracked-old',
            expectedVersion: 0,
            draft: draft(),
        });
        await service.publish(contextFor(), saved.id, saved.version, false, true);
        await service.sources(contextFor());
        const url = draft().sources[0].url;
        await db.getRepository('BlogSourceItem').update(1, {
            url,
            sourcePublishedAt: new Date(Date.now() - 8 * 86400000),
            fetchedAt: new Date(0),
            metadataJson: JSON.stringify({ images: [] }),
        });
        await db
            .getRepository('BlogSource')
            .createQueryBuilder()
            .update()
            .set({ enabled: false })
            .where("code != 'openai'")
            .execute();
        let version = 'v1';
        const read = vi.fn((_code: string, target: string) =>
            Promise.resolve(
                target.endsWith('rss.xml')
                    ? { status: 304, body: '', etag: 'index' }
                    : {
                          status: 200,
                          body:
                              '<meta property="og:image" content="https://images.openai.com/chart.png"><article>' +
                              'Updated official source details. '.repeat(20) +
                              '</article>',
                          etag: 'article',
                      },
            ),
        );
        const worker = new BlogQueueService(
            {} as never,
            { create: () => Promise.resolve(contextFor()) } as never,
            connection,
            service,
            { read, imageVersion: () => Promise.resolve(version) } as never,
            {} as never,
            {} as never,
        );
        const first = await service.request(contextFor(), 'COLLECT', 'track-old-one');
        await worker.process('1', String(first.id));
        const before = await db.getRepository('BlogSourceItem').findOneByOrFail({ id: 1 });
        expect(before.body).toContain('Updated official');
        expect(read.mock.calls.some(x => x[1] === url)).toBe(true);
        await db.getRepository('BlogSourceItem').update(1, { fetchedAt: new Date(0) });
        version = 'v2';
        const second = await service.request(contextFor(), 'COLLECT', 'track-old-two');
        await worker.process('1', String(second.id));
        expect((await db.getRepository('BlogSourceItem').findOneByOrFail({ id: 1 })).contentHash).not.toBe(
            before.contentHash,
        );
        expect((await service.read(contextFor(), {}, saved.slug)).article?.body).toBe(draft().body);
        return Promise.resolve();
    });
});

describe('free source workflow', () => {
    async function enableFree() {
        const settings = await service.settings(contextFor());
        return service.saveSettings(
            contextFor(),
            {
                ...defaultSettings,
                enabled: true,
                automationEnabled: true,
                freeMode: true,
                freeAutoPublish: true,
                dailyMaxArticles: 3,
                skillEnabled: true,
            },
            settings.version,
        );
    }
    function freeWorker() {
        const provider = {
            text: vi.fn(() => {
                throw new Error('A free task must never call a provider');
            }),
            image: vi.fn(() => {
                throw new Error('A free task must never call a provider');
            }),
        };
        const media = {
            createCover: vi.fn(() => Promise.resolve(draft().cover)),
            importSource: vi.fn(),
            createIllustrations: vi.fn(),
        };
        const worker = new BlogQueueService(
            {} as never,
            {
                create: ({ channelOrToken }: any) => Promise.resolve(contextFor(Number(channelOrToken.id))),
            } as never,
            connection,
            service,
            {} as never,
            provider as never,
            media as never,
        );
        return { worker, provider, media };
    }
    it('blocks a previously cached category page before generating or publishing it', async () => {
        await enableFree();
        await db.getRepository('BlogSourceItem').update(1, {
            sourceCode: 'anthropic',
            url: 'https://www.anthropic.com/news/product',
            title: 'Product',
        });
        const { worker, provider, media } = freeWorker();
        const run = await service.request(contextFor(), 'GENERATE', 'cached-category-page', {
            sourceIds: ['1'],
        });
        await worker.process('1', String(run.id));
        const completed = await db.getRepository('BlogRun').findOneByOrFail({ id: run.id });
        expect(completed.state).toBe('FAILED');
        expect(completed.message).toBe('任务未完成，请检查来源、文章版本与配置后重试');
        expect(await db.getRepository('BlogArticle').count()).toBe(0);
        expect(provider.text).not.toHaveBeenCalled();
        expect(provider.image).not.toHaveBeenCalled();
        expect(media.createCover).not.toHaveBeenCalled();
    });
    it('publishes verified source briefs through the real database queue with zero model calls or budget', async () => {
        await enableFree();
        const { worker, provider, media } = freeWorker();
        const run = await service.request(contextFor(), 'GENERATE', 'free-end-to-end', { sourceIds: ['1'] });
        expect(run.reservedMicros).toBe(0);
        await worker.process('1', String(run.id));
        const image = await db.getRepository<BlogRun>('BlogRun').findOneByOrFail({ kind: 'MEDIA' });
        expect(JSON.parse(image.inputJson)).toMatchObject({ templateOnly: true, freeMode: true });
        expect((await service.read(contextFor(), {})).totalItems).toBe(0);
        await worker.process('1', String(image.id));
        const article = await db.getRepository('BlogArticle').findOneByOrFail({ state: 'PUBLISHED' });
        expect(JSON.parse(article.publishedJson)).toMatchObject({
            publicationMode: 'AUTOMATIC',
            reviewerName: null,
            reviewedAt: null,
        });
        expect((await service.read(contextFor(), {})).totalItems).toBe(1);
        await expect(service.read(contextFor(2), {})).rejects.toThrow('未开放');
        expect(provider.text).not.toHaveBeenCalled();
        expect(provider.image).not.toHaveBeenCalled();
        expect(media.createIllustrations).not.toHaveBeenCalled();
        expect(await db.getRepository('BlogRun').sum('chargedMicros')).toBe(0);
        await worker.process('1', String(image.id));
        expect(media.createCover).toHaveBeenCalledTimes(1);
    });
    it('collects an official feed brief on a blocked article page, while preserving strict AI admission', async () => {
        await enableFree();
        const summary =
            'Synthetic official feed summary with enough concrete evidence for a short news brief only. No invented details.';
        const http = {
            read: vi.fn((_code: string, url: string) =>
                url.endsWith('/rss.xml')
                    ? Promise.resolve({
                          status: 200,
                          body: [
                              '<rss><channel><item><title>Synthetic official release</title>',
                              '<link>https://openai.com/news/rss-fixture</link>',
                              `<pubDate>${new Date().toISOString()}</pubDate><description>${summary}</description>`,
                              '</item></channel></rss>',
                          ].join(''),
                      })
                    : Promise.reject(new Error('HTTP 403')),
            ),
        };
        const { provider, media } = freeWorker();
        const worker = new BlogQueueService(
            {} as never,
            {
                create: ({ channelOrToken }: any) => Promise.resolve(contextFor(Number(channelOrToken.id))),
            } as never,
            connection,
            service,
            http as never,
            provider as never,
            media as never,
        );
        const collection = await service.request(contextFor(), 'COLLECT', 'free-official-rss');
        await worker.process('1', String(collection.id));
        const evidence = await db
            .getRepository('BlogSourceItem')
            .findOneByOrFail({ url: 'https://openai.com/news/rss-fixture' });
        expect(evidence.body).toBe(summary);
        expect(evidence.status).toBe('READY');
        expect(JSON.parse(evidence.metadataJson).evidenceMode).toBe('OFFICIAL_RSS');
        const generation = await service.request(contextFor(), 'GENERATE', 'free-rss-generation', {
            sourceIds: [String(evidence.id)],
        });
        await worker.process('1', String(generation.id));
        const article = await db
            .getRepository('BlogArticle')
            .findOneByOrFail({ eventKey: evidence.eventKey });
        expect(JSON.parse(article.draftJson).body).toContain('全文页面暂不可读取');
        expect(JSON.parse(article.draftJson).facts[0].sourceUrl).toBe('https://openai.com/news/rss.xml');
        expect(provider.text).not.toHaveBeenCalled();
        const settings = await service.settings(contextFor());
        await service.saveSettings(contextFor(), { ...defaultSettings, enabled: true }, settings.version);
        await expect(
            service.request(contextFor(), 'GENERATE', 'paid-must-reject-summary', {
                sourceIds: [String(evidence.id)],
            }),
        ).rejects.toThrow('资料不足');
    });
    it('protects human edits and rejects forged or cross-store historical task references', async () => {
        await enableFree();
        const { worker } = freeWorker();
        const run = await service.request(contextFor(), 'GENERATE', 'free-human-edit', { sourceIds: ['1'] });
        await worker.process('1', String(run.id));
        const article = await db.getRepository('BlogArticle').findOneByOrFail({ state: 'PENDING_REVIEW' });
        await service.save(contextFor(), {
            id: String(article.id),
            slug: article.slug,
            expectedVersion: article.version,
            draft: { ...JSON.parse(article.draftJson), title: '人工修改需保留' },
        });
        const image = await db.getRepository<BlogRun>('BlogRun').findOneByOrFail({ kind: 'MEDIA' });
        await worker.process('1', String(image.id));
        expect(
            (await db.getRepository('BlogArticle').findOneByOrFail({ id: article.id })).publishedJson,
        ).toBeNull();
        expect(service.view(await service.get(contextFor(), String(article.id))).draft.title).toBe(
            '人工修改需保留',
        );
        const end = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        await expect(
            service.request(contextFor(), 'GENERATE', 'forged-history', {
                sourceIds: ['2'],
                historyDay: end,
            }),
        ).rejects.toThrow('缺少历史任务');
        const parent = await service.request(contextFor(), 'COLLECT', 'history-parent', {
            historyStart: end,
            historyEnd: end,
        });
        await expect(
            service.request(contextFor(2), 'COLLECT', 'cross-store-history', {
                historyDay: end,
                historyRunId: String(parent.id),
            }),
        ).rejects.toThrow('历史任务范围');
    });
    it('publishes a free Skill only after source recheck, without a text model', async () => {
        await enableFree();
        const evidence: SkillEvidence = {
            repository: 'owner/synthetic-skills',
            repositoryId: '123',
            directory: 'skills/source-test',
            name: 'source-test',
            description: 'Create frontend interfaces using supplied project requirements.',
            body:
                '---\nname: source-test\ndescription: Create frontend interfaces using supplied project requirements.\n---\n' +
                'Synthetic fixture instruction for database tests only. '.repeat(20),
            readme: '',
            commit: 'a'.repeat(40),
            stars: 12000,
            rankings: [{ view: 'all-time', rank: 5, url: 'https://www.skills.sh/', displayCount: '10K' }],
            observedAt: new Date().toISOString(),
            aliases: ['synthetic-identity'],
        };
        await db.getRepository('BlogSkill').save({
            identity: 'synthetic-identity',
            repositoryId: evidence.repositoryId,
            repository: evidence.repository,
            directory: evidence.directory,
            name: evidence.name,
            contentHash: fingerprint(evidence.body),
            body: evidence.body,
            evidenceJson: JSON.stringify(evidence),
            status: 'READY',
            message: '',
            checkedAt: new Date(),
        });
        const provider = {
            text: vi.fn(() => {
                throw new Error('Paid model called in free mode');
            }),
        };
        const catalog = { verifyFree: vi.fn((e: SkillEvidence) => Promise.resolve(e)) };
        const skills = new BlogSkillsService(
            connection,
            service,
            catalog as never,
            {} as never,
            provider as never,
            { createCover: () => Promise.resolve(draft().cover) } as never,
            { publish: vi.fn() } as never,
        );
        const begin = vi.fn();
        const telemetry = vi.fn();
        await skills.schedule(contextFor());
        const run = await db.getRepository<BlogRun>('BlogRun').findOneByOrFail({ kind: 'SKILL' });
        await skills.process(contextFor(), run, JSON.parse(run.inputJson), begin, telemetry);
        expect(await db.getRepository('BlogArticle').countBy({ publishedCategory: 'skills' })).toBe(0);
        const review = await db.getRepository<BlogRun>('BlogRun').findOneByOrFail({ kind: 'SKILL_REVIEW' });
        await skills.process(contextFor(), review, JSON.parse(review.inputJson), begin, telemetry);
        expect(await db.getRepository('BlogArticle').countBy({ publishedCategory: 'skills' })).toBe(1);
        expect(catalog.verifyFree).toHaveBeenCalledTimes(2);
        expect(provider.text).not.toHaveBeenCalled();
        expect(begin).not.toHaveBeenCalled();
        expect(telemetry).not.toHaveBeenCalled();
        await skills.schedule(contextFor());
        expect(await db.getRepository('BlogSkillRecommendation').count()).toBe(1);
    });
    it('keeps daily free recommendations available from the same high-star repository without repeating a Skill', async () => {
        await enableFree();
        const evidence: SkillEvidence = {
            repository: 'owner/synthetic-skills',
            repositoryId: '123',
            directory: 'skills/new-skill',
            name: 'new-skill',
            description: 'Review frontend code using supplied project instructions.',
            body: 'Independent synthetic instructions for the newly selected source document. '.repeat(20),
            readme: '',
            commit: 'a'.repeat(40),
            stars: 12000,
            rankings: [{ view: 'all-time', rank: 187, url: 'https://www.skills.sh/', displayCount: '10K' }],
            observedAt: new Date().toISOString(),
            aliases: ['new-identity'],
        };
        await db.getRepository('BlogSkill').save({
            identity: 'new-identity',
            repositoryId: '123',
            repository: evidence.repository,
            directory: evidence.directory,
            name: evidence.name,
            contentHash: fingerprint(evidence.body),
            body: evidence.body,
            evidenceJson: JSON.stringify(evidence),
            status: 'READY',
            message: '',
            checkedAt: new Date(),
        });
        const day = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
        const yesterday = new Date(Date.parse(day + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
        await db.getRepository('BlogSkillRecommendation').save({
            channelId: 1,
            day: yesterday,
            identity: 'old-identity',
            repositoryId: '123',
            status: 'PUBLISHED',
            message: '',
            articleId: null,
            contentHash: 'different-source',
            evidenceJson: JSON.stringify({ ...evidence, body: 'A distinct old source.', history: {} }),
        });
        const skills = new BlogSkillsService(
            connection,
            service,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
        );
        await skills.schedule(contextFor(), new Date(day + 'T09:01:00+08:00'));
        const selected = await db
            .getRepository('BlogSkillRecommendation')
            .findOneByOrFail({ channelId: 1, day });
        expect(selected.identity).toBe('new-identity');
        await skills.schedule(contextFor(), new Date(day + 'T09:02:00+08:00'));
        expect(await db.getRepository('BlogSkillRecommendation').count()).toBe(2);
    });
    it('defers an incomplete historical Skill pool until its public window recovers', async () => {
        await enableFree();
        const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        const parent = await service.request(contextFor(), 'COLLECT', 'history-pool-window', {
            historyStart: day,
            historyEnd: day,
        });
        const retryAfter = new Date(Date.now() + 3600000);
        const catalog = { refresh: vi.fn(() => Promise.resolve(retryAfter)) };
        const skills = new BlogSkillsService(
            connection,
            service,
            catalog as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
        );
        await expect(skills.scheduleHistory(contextFor(), String(parent.id), [day])).rejects.toBeInstanceOf(
            SkillDeferred,
        );
        expect(catalog.refresh).toHaveBeenCalledWith(expect.any(Date), true);
        expect(await db.getRepository('BlogSkillRecommendation').count()).toBe(0);
    });
    it('uses an already pinned historical candidate when another repository reaches its anonymous limit', async () => {
        await enableFree();
        const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        const parent = await service.request(contextFor(), 'COLLECT', 'history-cached-source', {
            historyStart: day,
            historyEnd: day,
        });
        const evidence = (name: string, rank: number): SkillEvidence => ({
            repository: `owner/${name}`,
            repositoryId: String(rank + 100),
            directory: 'skills/' + name,
            name,
            description: 'Review supplied frontend code using project requirements.',
            body: `Synthetic historical source ${name}. `.repeat(20),
            readme: '',
            commit: 'a'.repeat(40),
            stars: 10000,
            rankings: [{ view: 'all-time', rank, url: 'https://www.skills.sh/', displayCount: '1K' }],
            observedAt: new Date().toISOString(),
            aliases: [name],
        });
        for (const e of [evidence('waiting-source', 1), evidence('cached-source', 2)])
            await db.getRepository('BlogSkill').save({
                identity: e.name,
                repositoryId: e.repositoryId,
                repository: e.repository,
                directory: e.directory,
                name: e.name,
                contentHash: fingerprint(e.body),
                body: e.body,
                evidenceJson: JSON.stringify(e),
                status: 'READY',
                message: '',
                checkedAt: new Date(),
            });
        const retryAfter = new Date(Date.now() + 3600000);
        const catalog = {
            refresh: () => Promise.resolve(retryAfter),
            historicalEvidence: vi.fn((e: SkillEvidence) =>
                e.name === 'waiting-source'
                    ? Promise.reject(new SkillDeferred(retryAfter))
                    : Promise.resolve({ ...e, sourceSnapshotAt: '2026-09-01T00:00:00Z' }),
            ),
        };
        const skills = new BlogSkillsService(
            connection,
            service,
            catalog as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
        );
        await skills.scheduleHistory(contextFor(), String(parent.id), [day]);
        const selected = await db
            .getRepository('BlogSkillRecommendation')
            .findOneByOrFail({ channelId: 1, day });
        expect(selected.identity).toBe('cached-source');
        expect(catalog.historicalEvidence).toHaveBeenCalledTimes(2);
    });
    it('rejects automatic publication after a settings change or full-text tampering', async () => {
        const settings = await enableFree();
        const { worker } = freeWorker();
        const run = await service.request(contextFor(), 'GENERATE', 'free-guard', { sourceIds: ['1'] });
        await worker.process('1', String(run.id));
        const article = await db.getRepository('BlogArticle').findOneByOrFail({ state: 'PENDING_REVIEW' });
        const media = await db.getRepository<BlogRun>('BlogRun').findOneByOrFail({ kind: 'MEDIA' });
        const input = JSON.parse(media.inputJson);
        const changed = {
            ...JSON.parse(article.draftJson),
            body: JSON.parse(article.draftJson).body + '\n没有来源的陈述',
        };
        await db
            .getRepository('BlogArticle')
            .update(article.id, { draftJson: JSON.stringify(changed), issuesJson: '[]' });
        await expect(
            service.publishFree(
                contextFor(),
                String(article.id),
                article.version,
                input.freeDigest,
                settings.version,
            ),
        ).rejects.toThrow('版本、来源');
        await service.saveSettings(contextFor(), { ...settings, freeAutoPublish: false }, settings.version);
        await expect(
            service.publishFree(
                contextFor(),
                String(article.id),
                article.version,
                input.freeDigest,
                settings.version,
            ),
        ).rejects.toThrow('设置已变化');
    });
});

it.skipIf(!process.env.BLOG_SKILL_AUDIT_DIR)(
    'audits the real anonymous Skill catalog and historical snapshot without provider calls',
    async () => {
        const out = resolve(process.env.BLOG_SKILL_AUDIT_DIR ?? '');
        await mkdir(out, { recursive: true });
        const http = new BlogSkillsHttp({ safeUrls: new SafeProviderUrlService() } as never, connection);
        const reads: Array<Record<string, unknown>> = [];
        const actualRead = http.read.bind(http);
        vi.spyOn(http, 'read').mockImplementation(async (...args) => {
            try {
                const body = await actualRead(...args);
                const observation: Record<string, unknown> = { url: args[0], ok: true };
                if (/^https:\/\/api.github.com\/repos\/[^/]+\/[^/?]+$/u.test(args[0])) {
                    const repository = JSON.parse(body);
                    Object.assign(observation, {
                        stars: repository.stargazers_count,
                        fork: repository.fork,
                        archived: repository.archived,
                    });
                }
                reads.push(observation);
                return body;
            } catch (error) {
                reads.push({
                    url: args[0],
                    ok: false,
                    reason: error instanceof Error ? error.message : 'read failed',
                });
                throw error;
            }
        });
        const catalog = new BlogSkillsCatalog(connection, http);
        await catalog.refresh();
        const rows = await db.getRepository('BlogSkill').find({ where: { status: 'READY' } });
        const state = await http.state();
        const receipt: Record<string, unknown> = {
            observedAt: new Date().toISOString(),
            externalModelCalls: 0,
            candidates: rows.map(x => ({ identity: x.identity, ...JSON.parse(x.evidenceJson) })),
            reads,
            state,
        };
        const evergreen = rows
            .map(x => JSON.parse(x.evidenceJson) as SkillEvidence)
            .find(e => e.rankings.some(x => x.view === 'all-time'));
        if (evergreen) {
            const old = await catalog.historicalEvidence(evergreen, '2026-10-02');
            receipt.historicalSnapshot = old;
            expect(Date.parse(old.sourceSnapshotAt ?? '')).toBeLessThanOrEqual(
                Date.parse('2026-10-01T16:00:00Z'),
            );
            expect((await catalog.verifyFree(old)).commit).toBe(old.commit);
        }
        await writeFile(resolve(out, 'receipt.json'), JSON.stringify(receipt, null, 2));
        expect(rows.length).toBeGreaterThan(0);
    },
    180000,
);
