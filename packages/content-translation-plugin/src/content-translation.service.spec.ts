import { DataSource, EntitySchema, SelectQueryBuilder } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
    contentTranslationInternals,
    ContentTranslationService,
    isUsableEnglishTranslation,
} from './content-translation.service.js';
import { ContentTranslationState } from './entities/content-translation-state.entity.js';
import { TranslationContentAdapter } from './translation-content-adapter.js';

describe('translation audit database pagination', () => {
    // A disposable SQL database verifies actual filter grouping and LIKE escaping.
    const schema = new EntitySchema<{
        id: number;
        channelId: string | null;
        entityType: string;
        entityId: string;
        fieldPath: string;
        status: string;
        error: string | null;
        updatedAt: Date;
    }>({
        name: 'AuditState',
        columns: {
            id: { type: Number, primary: true, generated: true },
            channelId: { type: String, nullable: true },
            entityType: { type: String },
            entityId: { type: String },
            fieldPath: { type: String },
            status: { type: String },
            error: { type: String, nullable: true },
            updatedAt: { type: Date },
        },
    });
    const channelSchema = new EntitySchema({
        name: 'Channel',
        columns: { id: { type: String, primary: true } },
    });
    const productSchema = new EntitySchema({
        name: 'Product',
        columns: { id: { type: String, primary: true } },
        relations: {
            channels: { type: 'many-to-many', target: 'Channel', joinTable: true },
        },
    });
    const database = new DataSource({
        type: 'sqljs',
        entities: [schema, channelSchema, productSchema],
        synchronize: true,
    });
    let service: ContentTranslationService;
    beforeAll(async () => {
        await database.initialize();
        const repository = database.getRepository(schema);
        const productIds = Array.from({ length: 1105 }, (_, i) => (i === 0 ? 'old-target' : `item-${i}`));
        await database.getRepository(channelSchema).insert([{ id: 'channel-a' }, { id: 'channel-b' }]);
        await database.getRepository(productSchema).insert(productIds.map(id => ({ id })));
        await database
            .createQueryBuilder()
            .relation(productSchema, 'channels')
            .of(productIds)
            .add('channel-a');
        await repository.insert([
            ...Array.from({ length: 1105 }, (_, i) => ({
                channelId: 'channel-a',
                entityType: 'Product',
                entityId: i === 0 ? 'old-target' : `item-${i}`,
                fieldPath: 'name',
                status: i === 0 ? 'FAILED' : 'AUTO_TRANSLATED',
                error: i === 0 ? 'literal 100!%_\\done' : null,
                updatedAt: new Date('2026-01-01'),
            })),
            {
                channelId: 'channel-b',
                entityType: 'Product',
                entityId: 'old-target',
                fieldPath: 'name',
                status: 'FAILED',
                error: null,
                updatedAt: new Date('2026-02-01'),
            },
            {
                channelId: null,
                entityType: 'Collection',
                entityId: 'global-record',
                fieldPath: 'name',
                status: 'REVIEWED',
                error: null,
                updatedAt: new Date('2026-01-01'),
            },
        ]);
        service = new ContentTranslationService({ getRepository: () => repository } as any, {
            provider: { name: 'test', isConfigured: () => true, translate: vi.fn() },
            glossary: {},
            sourceLanguageCode: 'zh_Hans',
            targetLanguageCode: 'en',
        });
    });
    afterAll(async () => {
        if (database.isInitialized) await database.destroy();
    });

    it('keeps store audit local even for SuperAdmin and rejects global or other-store requests', async () => {
        const ctx = {
            channelId: 'channel-a',
            channel: { code: 'channel-a' },
            userHasPermissions: () => true,
        } as any;
        const result = await service.audit(ctx, 'channel-a');
        expect(result.total).toBe(1105);
        expect(result.states.every(state => state.channelId === 'channel-a')).toBe(true);
        await expect(service.audit(ctx, null)).rejects.toThrow('跨店或平台翻译审计');
        await expect(service.audit(ctx, 'channel-b')).rejects.toThrow('跨店或平台翻译审计');
    });

    it('preserves the legacy limit while reporting complete counts', async () => {
        const result = await service.audit({ channel: { code: '__default_channel__' } } as any, 'channel-a');
        expect(result.total).toBe(1106);
        expect(result.filteredTotal).toBe(1106);
        expect(result.states).toHaveLength(1000);
        expect(result.counts).toContainEqual({ status: 'AUTO_TRANSLATED', count: 1104 });
        expect(result.states.some(state => state.channelId === 'channel-b')).toBe(false);
    });

    it('can reach records beyond 1000 with stable ordering for equal timestamps', async () => {
        const first = await service.audit({ channel: { code: '__default_channel__' } } as any, 'channel-a', {
            skip: 1000,
            take: 100,
        });
        const last = await service.audit({ channel: { code: '__default_channel__' } } as any, 'channel-a', {
            skip: 1100,
            take: 100,
        });
        expect(first.states).toHaveLength(100);
        expect(last.states).toHaveLength(6);
        expect(last.states.at(-1)?.entityId).toBe('old-target');
        expect(new Set([...first.states, ...last.states].map(state => state.id)).size).toBe(106);
    });

    it('searches older records on the server and keeps channel and global conditions grouped', async () => {
        const result = await service.audit({ channel: { code: '__default_channel__' } } as any, 'channel-a', {
            search: 'OLD-TARGET',
            status: 'FAILED',
            entityType: 'Product',
        });
        expect(result.filteredTotal).toBe(1);
        expect(result.states).toHaveLength(1);
        expect(result.states[0].channelId).toBe('channel-a');
        expect(result.total).toBe(1106);
        expect(result.counts).toContainEqual({ status: 'REVIEWED', count: 1 });
    });

    it('treats percent, underscore, escape marker and backslash as literal search text', async () => {
        const result = await service.audit({ channel: { code: '__default_channel__' } } as any, 'channel-a', {
            search: '100!%_\\done',
        });
        expect(result.filteredTotal).toBe(1);
        expect(result.states[0].entityId).toBe('old-target');
        expect(
            (
                await service.audit({ channel: { code: '__default_channel__' } } as any, 'channel-a', {
                    search: 'not-found',
                })
            ).filteredTotal,
        ).toBe(0);
    });

    it('supports global-only scope, empty pages and bounded page sizes', async () => {
        expect(
            (await service.audit({ channel: { code: '__default_channel__' } } as any, null, {})).states.map(
                state => state.entityId,
            ),
        ).toEqual(['global-record']);
        const emptyPage = await service.audit(
            { channel: { code: '__default_channel__' } } as any,
            'channel-a',
            { skip: 2000, take: 20 },
        );
        expect(emptyPage.states).toEqual([]);
        expect(emptyPage.filteredTotal).toBe(1106);
        expect(
            (
                await service.audit({ channel: { code: '__default_channel__' } } as any, 'channel-a', {
                    skip: -20,
                    take: 9999,
                })
            ).states,
        ).toHaveLength(100);
    });
});

describe('translation audit actionable entity visibility', () => {
    const stateSchema = new EntitySchema({
        name: 'VisibilityAuditState',
        columns: {
            id: { type: Number, primary: true, generated: true },
            channelId: { type: String, nullable: true },
            entityType: { type: String },
            entityId: { type: String },
            fieldPath: { type: String },
            status: { type: String },
            origin: { type: String },
            locked: { type: Boolean },
            revision: { type: Number },
            error: { type: String, nullable: true },
            updatedAt: { type: Date },
        },
    });
    const channelSchema = new EntitySchema({
        name: 'Channel',
        columns: { id: { type: Number, primary: true } },
    });
    const channelRelations = {
        channels: { type: 'many-to-many' as const, target: 'Channel', joinTable: true },
    };
    const productSchema = new EntitySchema({
        name: 'Product',
        columns: {
            id: { type: Number, primary: true },
            deletedAt: { type: Date, nullable: true, deleteDate: true },
        },
        relations: channelRelations,
    });
    const shippingSchema = new EntitySchema({
        name: 'ShippingMethod',
        columns: { id: { type: Number, primary: true } },
        relations: channelRelations,
    });
    const blockSchema = new EntitySchema({
        name: 'StorefrontContentBlock',
        columns: {
            id: { type: Number, primary: true },
            channelId: { type: Number },
            deletedAt: { type: Date, nullable: true },
        },
    });
    const itemSchema = new EntitySchema({
        name: 'StorefrontContentItem',
        columns: { id: { type: Number, primary: true }, blockId: { type: Number } },
        relations: {
            block: { type: 'many-to-one', target: 'StorefrontContentBlock', joinColumn: { name: 'blockId' } },
        },
    });
    const collectionSchema = new EntitySchema({
        name: 'Collection',
        columns: { id: { type: Number, primary: true }, isRoot: { type: Boolean } },
        relations: channelRelations,
    });
    // Production Country/Province share the Region table and need distinct STI parameters.
    class Region {
        id: string;
    }
    class Country extends Region {}
    class Province extends Region {}
    const regionSchema = new EntitySchema({
        name: 'Region',
        target: Region,
        columns: { id: { type: String, primary: true } },
        inheritance: { pattern: 'STI', column: { type: 'varchar', name: 'discriminator' } },
    });
    const countrySchema = new EntitySchema({
        name: 'Country',
        target: Country,
        type: 'entity-child',
        columns: {},
        discriminatorValue: 'Country',
    });
    const provinceSchema = new EntitySchema({
        name: 'Province',
        target: Province,
        type: 'entity-child',
        columns: {},
        discriminatorValue: 'Province',
    });
    const announcementSchema = new EntitySchema({
        name: 'SystemAnnouncement',
        columns: {
            id: { type: Number, primary: true },
            ownerChannelId: { type: Number, nullable: true },
            targetMode: { type: String },
        },
        relations: channelRelations,
    });
    const entities = [
        stateSchema,
        channelSchema,
        productSchema,
        shippingSchema,
        blockSchema,
        itemSchema,
        collectionSchema,
        regionSchema,
        countrySchema,
        provinceSchema,
        announcementSchema,
    ];
    const database = new DataSource({ type: 'sqljs', entities, synchronize: true });
    const ctx = { channelId: '1', channel: { code: 'merchant-one' } } as any;
    const platform = { channelId: '1', channel: { code: '__default_channel__' } } as any;
    const translationOptions = {
        provider: { name: 'test', isConfigured: () => true, translate: vi.fn() },
        glossary: {},
        sourceLanguageCode: 'zh_Hans',
        targetLanguageCode: 'en',
    };
    let service: ContentTranslationService;
    let adapter: TranslationContentAdapter;
    let historyBefore: unknown;
    let visibleIds: number[];

    beforeAll(async () => {
        await database.initialize();
        const channelRepo = database.getRepository(channelSchema);
        const [one, two] = await channelRepo.save([{ id: 1 }, { id: 2 }]);
        await database.getRepository(productSchema).save([
            { id: 1, channels: [one, two] },
            { id: 2, channels: [two] },
            { id: 3, channels: [one], deletedAt: new Date('2026-01-01') },
        ]);
        await database.getRepository(shippingSchema).save([
            { id: 8, channels: [one, two] },
            { id: 9, channels: [two] },
        ]);
        await database.getRepository(blockSchema).save([
            { id: 1, channelId: 1 },
            { id: 2, channelId: 2 },
            { id: 3, channelId: 1, deletedAt: new Date('2026-01-01') },
        ]);
        await database.getRepository(itemSchema).save([
            { id: 1, blockId: 1 },
            { id: 2, blockId: 2 },
            { id: 3, blockId: 3 },
        ]);
        await database.getRepository(collectionSchema).save([
            { id: 1, isRoot: true, channels: [one] },
            { id: 2, isRoot: false, channels: [one] },
        ]);
        await database.getRepository(countrySchema).save({ id: 'country-uuid' });
        await database.getRepository(provinceSchema).save({ id: 'province-uuid' });
        await database.getRepository(announcementSchema).save([
            { id: 1, ownerChannelId: 1, targetMode: 'SINGLE', channels: [one] },
            { id: 2, ownerChannelId: 1, targetMode: 'MULTIPLE', channels: [one, two] },
            { id: 3, ownerChannelId: null, targetMode: 'ALL', channels: [] },
            { id: 4, ownerChannelId: 2, targetMode: 'SINGLE', channels: [one] },
            { id: 5, ownerChannelId: 1, targetMode: 'SINGLE', channels: [one, two] },
        ]);
        const identities = [
            ['StorefrontContentItem', '1', 'STALE'],
            ['StorefrontContentItem', '196', 'STALE'],
            ['StorefrontContentItem', '2', 'STALE'],
            ['StorefrontContentItem', '3', 'STALE'],
            ['StorefrontContentBlock', '1', 'AUTO_TRANSLATED'],
            ['StorefrontContentBlock', '2', 'STALE'],
            ['StorefrontContentBlock', '3', 'STALE'],
            ['Product', '1', 'FAILED'],
            ['Product', '2', 'FAILED'],
            ['Product', '3', 'FAILED'],
            ['Product', 'invalid-id', 'FAILED'],
            ['ShippingMethod', '8', 'TRANSLATING'],
            ['ShippingMethod', '9', 'STALE'],
            ['Country', 'country-uuid', 'PENDING'],
            ['Collection', '1', 'STALE'],
            ['Collection', '2', 'NOTIFY_PENDING'],
            ['SystemAnnouncement', '1', 'MANUAL_LOCKED'],
            ['SystemAnnouncement', '2', 'STALE'],
            ['SystemAnnouncement', '3', 'STALE'],
            ['SystemAnnouncement', '4', 'STALE'],
            ['SystemAnnouncement', '5', 'STALE'],
            ['ImageModelConfig', 'missing-metadata', 'STALE'],
            ['UnregisteredEntity', '1', 'STALE'],
            ['Province', 'province-uuid', 'PENDING'],
            ['Country', 'province-uuid', 'PENDING'],
            ['Province', 'country-uuid', 'PENDING'],
        ];
        const rows = identities.map(([entityType, entityId, status], index) => ({
            channelId: '1',
            entityType,
            entityId,
            status,
            fieldPath: 'description',
            origin: 'MANUAL',
            locked: true,
            revision: 4,
            error: null,
            updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
        }));
        await database
            .getRepository(stateSchema)
            .insert([...rows, { ...rows[7], channelId: '2' }, { ...rows[13], channelId: null }]);
        const connection = {
            rawConnection: database,
            getRepository: () => database.getRepository(stateSchema),
        } as any;
        service = new ContentTranslationService(connection, translationOptions);
        adapter = new TranslationContentAdapter(connection);
        const history = await database.getRepository(stateSchema).find({ order: { id: 'ASC' } });
        historyBefore = structuredClone(history);
        visibleIds = [];
        for (const row of history) {
            if (
                row.channelId === '1' &&
                (await adapter.isVisibleInChannel(database.manager, row as ContentTranslationState, '1'))
            )
                visibleIds.push(Number(row.id));
        }
        expect(visibleIds).toHaveLength(8);
    });
    afterAll(async () => {
        if (database.isInitialized) await database.destroy();
    });

    it('matches actual adapter ownership before pagination and all audit counts', async () => {
        const result = await service.audit(ctx, '1', { take: 100 });
        expect(result.states.map(state => Number(state.id)).sort((a, b) => a - b)).toEqual(visibleIds);
        expect(result.total).toBe(8);
        expect(result.filteredTotal).toBe(8);
        expect(result.counts.reduce((sum, row) => sum + row.count, 0)).toBe(8);
        expect(await service.countStale(ctx)).toBe(6);
    });
    it('does not leave holes or repeats when newer historical orphan rows precede visible rows', async () => {
        const ids: number[] = [];
        for (let skip = 0; skip < 8; skip += 2) {
            const page = await service.audit(ctx, '1', { skip, take: 2 });
            expect(page.total).toBe(8);
            expect(page.filteredTotal).toBe(8);
            ids.push(...page.states.map(state => Number(state.id)));
        }
        expect(ids).toHaveLength(8);
        expect(new Set(ids).size).toBe(8);
        expect([...ids].sort((a, b) => a - b)).toEqual(visibleIds);
    });
    it('counts only visible actionable states in the merchant pending badge', async () => {
        expect(await service.countStale(ctx)).toBe(6);
    });
    it('keeps search and status filters consistent without orphan counts', async () => {
        const pending = await service.audit(ctx, '1', { status: 'STALE', take: 100 });
        expect(pending.filteredTotal).toBe(1);
        expect(pending.states.map(state => state.entityId)).toEqual(['1']);
        expect(pending.counts).toContainEqual({ status: 'STALE', count: 1 });
        expect(pending.total).toBe(8);
        const orphan = await service.audit(ctx, '1', { search: '196' });
        expect(orphan.states).toEqual([]);
        expect(orphan.filteredTotal).toBe(0);
        expect(orphan.total).toBe(8);
    });
    it('keeps Country and Province visible without accepting another Region child identity', async () => {
        const countries = await service.audit(ctx, '1', { entityType: 'Country', take: 100 });
        const provinces = await service.audit(ctx, '1', { entityType: 'Province', take: 100 });
        expect(countries.states.map(state => state.entityId)).toEqual(['country-uuid']);
        expect(provinces.states.map(state => state.entityId)).toEqual(['province-uuid']);
        for (const result of [countries, provinces]) {
            expect(result.filteredTotal).toBe(1);
            expect(result.total).toBe(8);
            expect(result.counts).toContainEqual({ status: 'PENDING', count: 2 });
        }
    });
    it('preserves complete platform history and leaves all audit rows unchanged', async () => {
        const all = await service.audit(platform, undefined, { take: 100 });
        expect(all.states).toHaveLength(28);
        expect(all.total).toBe(28);
        expect(all.states.some(state => state.entityId === '196')).toBe(true);
        expect((await service.audit(platform, '1', { take: 100 })).total).toBe(27);
        await service.countStale(ctx);
        expect(await database.getRepository(stateSchema).find({ order: { id: 'ASC' } })).toEqual(
            historyBefore,
        );
    });
    it.each(['postgres', 'mysql'] as const)(
        'binds %s visibility queries without casting historical identifiers to numbers',
        async type => {
            const driver = new DataSource({ type, database: 'offline_metadata_only', entities });
            // Build driver metadata only; no database connection is made.
            await (driver as any).buildMetadatas();
            const queries: Array<[string, unknown[]]> = [];
            const many = vi
                .spyOn(SelectQueryBuilder.prototype, 'getManyAndCount')
                .mockImplementation(function () {
                    queries.push(this.getQueryAndParameters());
                    return Promise.resolve([[], 0] as [never[], number]);
                });
            const raw = vi.spyOn(SelectQueryBuilder.prototype, 'getRawMany').mockImplementation(function () {
                queries.push(this.getQueryAndParameters());
                return Promise.resolve([]);
            });
            const count = vi.spyOn(SelectQueryBuilder.prototype, 'getCount').mockImplementation(function () {
                queries.push(this.getQueryAndParameters());
                return Promise.resolve(0);
            });
            try {
                const driverService = new ContentTranslationService(
                    {
                        rawConnection: driver,
                        getRepository: () => driver.getRepository(stateSchema),
                    } as any,
                    translationOptions,
                );
                await driverService.audit(ctx, '1', { take: 20 });
                await driverService.countStale(ctx);
                expect(queries).toHaveLength(3);
                for (const [query, parameters] of queries) {
                    expect(query).toContain('EXISTS');
                    if (type === 'postgres') {
                        expect(query).toMatch(/CAST\("audit_entity_\d+"\."id" AS TEXT\)/);
                    } else {
                        expect(query).toMatch(/CAST\(`audit_entity_\d+`\.`id` AS CHAR\)/);
                    }
                    expect(query).not.toMatch(/CAST\(["`]state["`]\.["`]entityId["`]/);
                    expect(query).toContain('COUNT(DISTINCT');
                    expect(query).not.toMatch(/:(?:\.\.\.)?[A-Za-z][A-Za-z0-9_]*/);
                    expect(parameters.filter(value => value === 'Country')).toHaveLength(2);
                    expect(parameters.filter(value => value === 'Province')).toHaveLength(2);
                }
            } finally {
                many.mockRestore();
                raw.mockRestore();
                count.mockRestore();
            }
        },
    );
});

describe('content translation hashing', () => {
    it('is deterministic and detects source changes', () => {
        expect(contentTranslationInternals.hash('商品')).toBe(contentTranslationInternals.hash('商品'));
        expect(contentTranslationInternals.hash('商品')).not.toBe(contentTranslationInternals.hash('新商品'));
    });
});

describe('English publication policy', () => {
    it('accepts non-empty English and rejects missing or Chinese content', () => {
        expect(isUsableEnglishTranslation('Official channel service')).toBe(true);
        expect(isUsableEnglishTranslation('ChatGPT Plus 为官方渠道服务')).toBe(false);
        expect(isUsableEnglishTranslation('<p>商品详情</p>')).toBe(false);
        expect(isUsableEnglishTranslation('')).toBe(false);
        expect(isUsableEnglishTranslation(null)).toBe(false);
    });
});

describe('ContentTranslationService localized fields', () => {
    it('queues missing English while preserving an explicitly edited target', async () => {
        const provider = {
            name: 'test',
            isConfigured: () => true,
            translate: (request: any) =>
                Promise.resolve({
                    provider: 'test',
                    translations: request.segments.map((segment: any) => ({
                        key: segment.key,
                        text: `EN:${segment.text}`,
                    })),
                }),
        };
        const service = new ContentTranslationService({} as any, {
            provider,
            glossary: {},
            sourceLanguageCode: 'zh_Hans',
            targetLanguageCode: 'en',
        });

        await expect(
            service.prepareLocalizedFields([
                { path: 'title', sourceText: '标题', required: true },
                { path: 'body', sourceText: '正文', targetText: 'Reviewed body' },
            ]),
        ).resolves.toEqual([
            expect.objectContaining({ path: 'title', translatedText: '', status: 'PENDING', origin: 'AUTO' }),
            expect.objectContaining({ path: 'body', translatedText: 'Reviewed body', origin: 'MANUAL' }),
        ]);
    });

    it('queues an unchanged submitted English value when the Chinese source changed', async () => {
        const service = new ContentTranslationService({} as any, {
            provider: {
                name: 'test',
                isConfigured: () => true,
                translate: () =>
                    Promise.resolve({
                        provider: 'test',
                        translations: [{ key: 'title', text: 'New title' }],
                    }),
            },
            glossary: {},
            sourceLanguageCode: 'zh_Hans',
            targetLanguageCode: 'en',
        });

        const [field] = await service.prepareLocalizedFields([
            {
                path: 'title',
                sourceText: '新标题',
                targetText: 'Old title',
                existingSourceText: '旧标题',
                existingTargetText: 'Old title',
            },
        ]);

        expect(field).toMatchObject({
            translatedText: 'Old title',
            status: 'PENDING',
            origin: 'AUTO',
            locked: false,
        });
    });

    it('queues an English field whose existing value still contains Chinese', async () => {
        const translate = vi.fn(() =>
            Promise.resolve({
                provider: 'test',
                translations: [{ key: 'description', text: 'Official channel service' }],
            }),
        );
        const service = new ContentTranslationService({} as any, {
            provider: { name: 'test', isConfigured: () => true, translate },
            glossary: {},
            sourceLanguageCode: 'zh_Hans',
            targetLanguageCode: 'en',
        });

        const [field] = await service.prepareLocalizedFields([
            {
                path: 'description',
                sourceText: '官方渠道服务',
                targetText: '官方渠道服务',
                existingSourceText: '官方渠道服务',
                existingTargetText: '官方渠道服务',
            },
        ]);

        expect(translate).not.toHaveBeenCalled();
        expect(field).toMatchObject({
            translatedText: '',
            status: 'PENDING',
            origin: 'AUTO',
            locked: false,
        });
    });

    it('keeps an unchanged automatic translation unlocked without calling the provider again', async () => {
        const translate = vi.fn();
        const service = new ContentTranslationService({} as any, {
            provider: { name: 'test', isConfigured: () => true, translate },
            glossary: {},
            sourceLanguageCode: 'zh_Hans',
            targetLanguageCode: 'en',
        });

        const [field] = await service.prepareLocalizedFields([
            {
                path: 'title',
                sourceText: '系统维护',
                targetText: 'System maintenance',
                existingSourceText: '系统维护',
                existingTargetText: 'System maintenance',
                manualLock: false,
                existingLocked: false,
            },
        ]);

        expect(translate).not.toHaveBeenCalled();
        expect(field).toMatchObject({
            translatedText: 'System maintenance',
            status: 'AUTO_TRANSLATED',
            origin: 'AUTO',
            locked: false,
        });
    });

    it('preserves manually locked English and marks it stale when only Chinese changes', async () => {
        const service = new ContentTranslationService({} as any, {
            provider: { name: 'test', isConfigured: () => true, translate: vi.fn() },
            glossary: {},
            sourceLanguageCode: 'zh_Hans',
            targetLanguageCode: 'en',
        });

        const [field] = await service.prepareLocalizedFields([
            {
                path: 'title',
                sourceText: '新的系统维护通知',
                targetText: 'System maintenance',
                existingSourceText: '系统维护',
                existingTargetText: 'System maintenance',
                manualLock: true,
                existingLocked: true,
            },
        ]);

        expect(field).toMatchObject({
            translatedText: 'System maintenance',
            status: 'STALE',
            origin: 'MANUAL',
            locked: true,
        });
    });

    it('queues English when a manual lock is explicitly removed', async () => {
        const translate = vi.fn(() =>
            Promise.resolve({
                provider: 'test',
                translations: [{ key: 'title', text: 'Fresh automatic translation' }],
            }),
        );
        const service = new ContentTranslationService({} as any, {
            provider: { name: 'test', isConfigured: () => true, translate },
            glossary: {},
            sourceLanguageCode: 'zh_Hans',
            targetLanguageCode: 'en',
        });

        const [field] = await service.prepareLocalizedFields([
            {
                path: 'title',
                sourceText: '系统维护',
                targetText: 'Reviewed maintenance',
                existingSourceText: '系统维护',
                existingTargetText: 'Reviewed maintenance',
                manualLock: false,
                existingLocked: true,
            },
        ]);

        expect(translate).not.toHaveBeenCalled();
        expect(field).toMatchObject({
            translatedText: 'Reviewed maintenance',
            status: 'PENDING',
            origin: 'AUTO',
            locked: false,
        });
    });

    it('rejects an empty English value when manual lock is requested', async () => {
        const service = new ContentTranslationService({} as any, {
            provider: { name: 'test', isConfigured: () => true, translate: vi.fn() },
            glossary: {},
            sourceLanguageCode: 'zh_Hans',
            targetLanguageCode: 'en',
        });

        await expect(
            service.prepareLocalizedFields([
                {
                    path: 'title',
                    sourceText: '系统维护',
                    targetText: '',
                    manualLock: true,
                },
            ]),
        ).rejects.toThrow('必须填写不含中文的英文内容');
    });

    it('preserves platform stale counts including global historical records', async () => {
        const repository = {
            count: vi.fn().mockResolvedValue(3),
        };
        const service = new ContentTranslationService({ getRepository: vi.fn(() => repository) } as any, {
            provider: { name: 'test', isConfigured: () => true, translate: vi.fn() },
            glossary: {},
            sourceLanguageCode: 'zh_Hans',
            targetLanguageCode: 'en',
        });

        await expect(
            service.countStale({ channelId: 'default', channel: { code: '__default_channel__' } } as any),
        ).resolves.toBe(3);
        expect(repository.count).toHaveBeenLastCalledWith({
            where: [
                { channelId: 'default', status: expect.anything() },
                { channelId: expect.anything(), status: expect.anything() },
            ],
        });
    });
});
