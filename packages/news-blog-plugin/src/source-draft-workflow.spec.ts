import { type EditorialProviderService } from '@vendure/image-generation-plugin';
import 'reflect-metadata';
import { DataSource, EntitySchema } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fixtureNewsReview } from '../test/news-review-fixture';

import { BlogService } from './blog.service';
import { defaultSettings } from './content';
import { BlogQueueService } from './queue.service';

vi.mock('@vendure/store-management-plugin', () => ({
    StorefrontDataChangedEvent: class {},
    StorefrontClientPluginAccessService: class {},
    StorefrontActivationService: class {},
}));

const common = {
    id: { type: Number, primary: true, generated: true as const },
    createdAt: { type: Date, createDate: true },
    updatedAt: { type: Date, updateDate: true },
    channelId: { type: Number },
};
const nullableDate = { type: Date, nullable: true };
const nullableText = { type: 'text' as const, nullable: true };
const schemas = [
    new EntitySchema({
        name: 'BlogSettings',
        columns: {
            ...common,
            version: { type: Number },
            enabled: { type: Boolean },
            automationEnabled: { type: Boolean },
            intervalMinutes: { type: Number },
            dailyMaxArticles: { type: Number },
            settingsJson: { type: 'text' },
            lastCollectedAt: nullableDate,
            leaseUntil: nullableDate,
        },
    }),
    new EntitySchema({
        name: 'BlogSourceItem',
        columns: {
            ...common,
            sourceCode: { type: String },
            identityKey: { type: String },
            contentHash: { type: String },
            eventKey: { type: String },
            url: { type: String },
            title: { type: String },
            category: { type: String },
            body: { type: 'text' },
            metadataJson: nullableText,
            sourcePublishedAt: { type: Date },
            fetchedAt: { type: Date },
            status: { type: String },
        },
    }),
    new EntitySchema({
        name: 'BlogArticle',
        columns: {
            ...common,
            slug: { type: String },
            eventKey: { type: String, nullable: true },
            version: { type: Number },
            state: { type: String },
            draftJson: { type: 'text' },
            publishedJson: nullableText,
            publishedAt: nullableDate,
            issuesJson: { type: 'text' },
            publishedTitle: { type: String, default: '' },
            publishedCategory: { type: String, default: '' },
            publishedSearchText: nullableText,
            publishedPinned: { type: Boolean, default: false },
        },
        uniques: [{ columns: ['channelId', 'eventKey'] }, { columns: ['channelId', 'slug'] }],
    }),
    new EntitySchema({
        name: 'BlogRevision',
        columns: {
            ...common,
            articleId: { type: Number },
            version: { type: Number },
            action: { type: String },
            actorId: { type: String },
            snapshotJson: nullableText,
        },
    }),
    new EntitySchema({
        name: 'BlogRun',
        columns: {
            ...common,
            requestKey: { type: String },
            kind: { type: String },
            state: { type: String },
            budgetDate: { type: String },
            reservedMicros: { type: Number },
            chargedMicros: { type: Number },
            inputJson: { type: 'text' },
            telemetryJson: nullableText,
            message: { type: String },
            startedAt: nullableDate,
            completedAt: nullableDate,
        },
        uniques: [{ columns: ['channelId', 'requestKey'] }],
    }),
];

describe('collected news to editorial draft', () => {
    const context = {
        channelId: 1,
        activeUserId: '1',
        apiType: 'admin',
        languageCode: 'zh_Hans',
        copy(this: Record<string, unknown>, options: { languageCode?: string }) {
            return { ...this, ...options };
        },
    };
    const ctx = context as never;
    const source = {
        id: 1,
        channelId: 1,
        sourceCode: 'openai',
        identityKey: 'original',
        contentHash: 'original-content',
        eventKey: '1'.repeat(64),
        url: 'https://openai.com/news/unreviewed-editorial-fixture',
        title: 'Synthetic official news for editorial testing',
        category: 'chatgpt',
        body: 'This is a collected article with sufficient material for the editor to check. '.repeat(4),
        sourcePublishedAt: new Date('2026-11-04T08:00:00.000Z'),
        fetchedAt: new Date('2026-11-06T08:00:00.000Z'),
        status: 'READY',
    };
    let db: DataSource;
    let service: BlogService;
    let queue: BlogQueueService;
    const provider = {
        text: vi.fn(() => {
            throw new Error('No provider may run in this test');
        }),
    };

    beforeEach(async () => {
        provider.text.mockClear();
        db = await new DataSource({ type: 'sqljs', entities: schemas, synchronize: true }).initialize();
        const connection = {
            getRepository: (_ctx: unknown, entity: { name: string }) => db.getRepository(entity.name),
            withTransaction: (requestContext: unknown, handler: (transaction: unknown) => unknown) =>
                handler(requestContext),
            rawConnection: db,
        } as never;
        service = new BlogService(
            connection,
            { findOneByUserId: () => Promise.resolve({ firstName: 'Test', lastName: 'Editor' }) } as never,
            { publish: vi.fn() } as never,
            { isEnabled: () => Promise.resolve(true) } as never,
            {} as never,
        );
        queue = new BlogQueueService(
            {} as never,
            { create: () => Promise.resolve(ctx) } as never,
            connection,
            service,
            {} as never,
            provider as unknown as EditorialProviderService,
            {} as never,
        );
        await db.getRepository('BlogSettings').save({
            channelId: 1,
            enabled: true,
            automationEnabled: false,
            intervalMinutes: 30,
            dailyMaxArticles: 1,
            version: 1,
            settingsJson: JSON.stringify({ ...defaultSettings, freeMode: true, freeAutoPublish: true }),
        });
        await db.getRepository('BlogSourceItem').save([
            source,
            { ...source, id: 2, identityKey: 'mirror', url: 'https://openai.com/news/mirror-fixture' },
            {
                ...source,
                id: 3,
                identityKey: 'other',
                eventKey: '2'.repeat(64),
                contentHash: 'other-content',
            },
            { ...source, id: 4, channelId: 2 },
        ]);
    });
    afterEach(async () => db.destroy());

    it('opens one draft for a shared event and exposes its state without publishing or changing the source date', async () => {
        expect((await service.sourceItems(ctx)).find(item => item.id === 1)?.articleId).toBeNull();
        await expect(service.openSourceDraft(ctx, '4')).rejects.toThrow('未找到当前店铺');
        const [first, second] = await Promise.all([
            service.openSourceDraft(ctx, '1'),
            service.openSourceDraft(ctx, '1'),
        ]);
        expect(second.id).toBe(first.id);
        expect((await service.openSourceDraft(ctx, '2')).id).toBe(first.id);
        expect(first).toMatchObject({
            slug: 'chatgpt-2026-11-04-1111111111',
            state: 'DRAFT',
            published: null,
            draft: { title: '', category: 'chatgpt', sources: [{ url: source.url }] },
        });
        expect(await db.getRepository('BlogArticle').count()).toBe(1);
        expect(await db.getRepository('BlogArticle').findOneByOrFail({ id: Number(first.id) })).toMatchObject(
            {
                eventKey: source.eventKey,
                publishedAt: null,
            },
        );
        expect((await service.sourceItems(ctx)).filter(item => item.articleId === first.id)).toMatchObject([
            { articleState: 'DRAFT', sourcePublishedAt: source.sourcePublishedAt },
            { articleState: 'DRAFT', sourcePublishedAt: source.sourcePublishedAt },
        ]);
        const edition = fixtureNewsReview('https://openai.com/news/synthetic-fixture');
        if (!edition) throw new Error('Missing bilingual fixture');
        const edited = await service.save(ctx, {
            id: first.id,
            slug: first.slug,
            expectedVersion: first.version,
            draft: { ...first.draft, ...edition.zh, translations: { en: edition.en } },
        });
        await service.publish(ctx, edited.id, edited.version, false, true);
        const english = context.copy({ languageCode: 'en' });
        expect((await service.read(english, {}, first.slug)).article).toMatchObject({
            title: edition.en.title,
            sourcePublishedAt: source.sourcePublishedAt.toISOString(),
        });
        expect(await service.openSourceDraft(ctx, '2')).toMatchObject({ id: first.id, state: 'PUBLISHED' });
    });

    it.each([false, true])(
        'credits an empty free run back and queues AI once after switching modes (legacy=%s)',
        async legacy => {
            const previous = await service.request(ctx, 'GENERATE', 'free-generation', { sourceIds: ['1'] });
            // Process uses the real queue worker and in-memory database, with no network or supplier.
            const requestContext = queue as unknown as {
                contextForChannel(channelId: string): Promise<never>;
            };
            vi.spyOn(requestContext, 'contextForChannel').mockResolvedValue(ctx);
            await queue.process('1', String(previous.id));
            const runs = db.getRepository('BlogRun');
            const completed = await runs.findOneByOrFail({ id: previous.id });
            expect(completed).toMatchObject({
                state: 'WAITING_EDITORIAL',
                message: expect.stringContaining('等待双语编辑'),
                chargedMicros: 0,
            });
            expect(await db.getRepository('BlogArticle').count()).toBe(0);
            if (legacy) await runs.update(previous.id, { state: 'SUCCEEDED' });
            const next = await service.request(ctx, 'GENERATE', 'other-free-generation', {
                sourceIds: ['3'],
            });
            expect(next.state).toBe('QUEUED'); // daily quota is one
            await queue.process('1', String(next.id));
            await db.getRepository('BlogSettings').update(
                { channelId: 1 },
                {
                    version: 2,
                    settingsJson: JSON.stringify({
                        ...defaultSettings,
                        textProviderCode: 'local-provider',
                        textModel: 'local-model',
                        dailyBudgetMicros: 100,
                        textReserveMicros: 10,
                    }),
                },
            );
            const paid = await service.request(ctx, 'GENERATE', 'started-ai-generation', {
                sourceIds: ['1'],
            });
            expect(paid.id).not.toBe(previous.id);
            expect(paid).toMatchObject({ state: 'QUEUED', reservedMicros: 10 });
            expect(
                (await service.request(ctx, 'GENERATE', 'repeat-ai-generation', { sourceIds: ['1'] })).id,
            ).toBe(paid.id);
            await runs.update(paid.id, { state: 'SUCCEEDED' });
            await service.openSourceDraft(ctx, '1');
            expect(
                (await service.request(ctx, 'GENERATE', 'repeat-after-success', { sourceIds: ['1'] })).id,
            ).toBe(paid.id);
            expect(provider.text).not.toHaveBeenCalled();
        },
    );
});
