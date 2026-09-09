import { DataSource, EntitySchema } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
    contentTranslationInternals,
    ContentTranslationService,
    isUsableEnglishTranslation,
} from './content-translation.service.js';

describe('translation audit database pagination', () => {
    // A disposable SQL database verifies actual filter grouping and LIKE escaping.
    const schema = new EntitySchema({
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
    const database = new DataSource({ type: 'sqljs', entities: [schema], synchronize: true });
    let service: ContentTranslationService;
    beforeAll(async () => {
        await database.initialize();
        const repository = database.getRepository(schema);
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

    it('preserves the legacy limit while reporting complete counts', async () => {
        const result = await service.audit({} as any, 'channel-a');
        expect(result.total).toBe(1106);
        expect(result.filteredTotal).toBe(1106);
        expect(result.states).toHaveLength(1000);
        expect(result.counts).toContainEqual({ status: 'AUTO_TRANSLATED', count: 1104 });
        expect(result.states.some(state => state.channelId === 'channel-b')).toBe(false);
    });

    it('can reach records beyond 1000 with stable ordering for equal timestamps', async () => {
        const first = await service.audit({} as any, 'channel-a', { skip: 1000, take: 100 });
        const last = await service.audit({} as any, 'channel-a', { skip: 1100, take: 100 });
        expect(first.states).toHaveLength(100);
        expect(last.states).toHaveLength(6);
        expect(last.states.at(-1)?.entityId).toBe('old-target');
        expect(new Set([...first.states, ...last.states].map(state => state.id)).size).toBe(106);
    });

    it('searches older records on the server and keeps channel and global conditions grouped', async () => {
        const result = await service.audit({} as any, 'channel-a', {
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
        const result = await service.audit({} as any, 'channel-a', { search: '100!%_\\done' });
        expect(result.filteredTotal).toBe(1);
        expect(result.states[0].entityId).toBe('old-target');
        expect((await service.audit({} as any, 'channel-a', { search: 'not-found' })).filteredTotal).toBe(0);
    });

    it('supports global-only scope, empty pages and bounded page sizes', async () => {
        expect((await service.audit({} as any, null, {})).states.map(state => state.entityId)).toEqual([
            'global-record',
        ]);
        const emptyPage = await service.audit({} as any, 'channel-a', { skip: 2000, take: 20 });
        expect(emptyPage.states).toEqual([]);
        expect(emptyPage.filteredTotal).toBe(1106);
        expect((await service.audit({} as any, 'channel-a', { skip: -20, take: 9999 })).states).toHaveLength(
            100,
        );
    });
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

    it('counts stale translations in the active channel', async () => {
        const repository = {
            count: vi.fn().mockResolvedValue(3),
        };
        const service = new ContentTranslationService({ getRepository: vi.fn(() => repository) } as any, {
            provider: { name: 'test', isConfigured: () => true, translate: vi.fn() },
            glossary: {},
            sourceLanguageCode: 'zh_Hans',
            targetLanguageCode: 'en',
        });

        await expect(service.countStale({ channelId: 'channel-1' } as any)).resolves.toBe(3);
        expect(repository.count).toHaveBeenCalledWith({
            where: [
                {
                    channelId: 'channel-1',
                    status: expect.objectContaining({
                        _value: expect.arrayContaining(['STALE', 'PENDING', 'NOTIFY_PENDING', 'FAILED']),
                    }),
                },
                { channelId: expect.anything(), status: expect.anything() },
            ],
        });
    });
});
