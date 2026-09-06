import { describe, expect, it, vi } from 'vitest';

import {
    contentTranslationInternals,
    ContentTranslationService,
    isUsableEnglishTranslation,
} from './content-translation.service.js';
import { TranslationProviderError } from './translation-provider-error.js';

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
    it('saves Chinese and preserves old English when the translation exceeds the field limit', async () => {
        const service = new ContentTranslationService({} as any, {
            provider: {
                name: 'test',
                isConfigured: () => true,
                translate: vi.fn().mockResolvedValue({
                    translations: [
                        {
                            key: 'storefrontName',
                            text: 'A very long automatically translated store name',
                        },
                    ],
                }),
            },
            glossary: {},
            sourceLanguageCode: 'zh_Hans',
            targetLanguageCode: 'en',
        });
        expect(
            await service.prepareLocalizedFields([
                {
                    path: 'storefrontName',
                    sourceText: '商业服务商城',
                    existingSourceText: '旧商城',
                    existingTargetText: 'Old shop',
                    maxTargetLength: 32,
                },
            ]),
        ).toEqual([
            expect.objectContaining({
                sourceText: '商业服务商城',
                translatedText: 'Old shop',
                status: 'PENDING',
                locked: false,
                error: expect.stringContaining('长度限制'),
            }),
        ]);
    });
    it.each(['RATE_LIMIT', 'QUOTA', 'UNAVAILABLE', 'CONFIGURATION'] as const)(
        'preserves Chinese and existing English on %s',
        async code => {
            const service = new ContentTranslationService({} as any, {
                provider: {
                    name: 'test',
                    isConfigured: () => true,
                    translate: vi.fn().mockRejectedValue(new TranslationProviderError(code)),
                },
                glossary: {},
                sourceLanguageCode: 'zh_Hans',
                targetLanguageCode: 'en',
            });
            await expect(
                service.prepareLocalizedFields([
                    {
                        path: 'label',
                        sourceText: '商业服务',
                        targetText: 'AI services',
                        existingSourceText: 'AI服务',
                        existingTargetText: 'AI services',
                        required: true,
                    },
                    { path: 'newLabel', sourceText: '新名称', required: true },
                    { path: 'reviewed', sourceText: '已核对', targetText: 'Reviewed', manualLock: true },
                ]),
            ).resolves.toEqual([
                expect.objectContaining({
                    sourceText: '商业服务',
                    translatedText: 'AI services',
                    status: 'PENDING',
                    locked: false,
                }),
                expect.objectContaining({
                    sourceText: '新名称',
                    translatedText: '',
                    status: 'PENDING',
                    locked: false,
                }),
                expect.objectContaining({
                    translatedText: 'Reviewed',
                    status: 'MANUAL_LOCKED',
                    locked: true,
                }),
            ]);
        },
    );

    it('does not hide programming errors as pending translations', async () => {
        const service = new ContentTranslationService({} as any, {
            provider: {
                name: 'test',
                isConfigured: () => true,
                translate: vi.fn().mockRejectedValue(new TypeError('bug')),
            },
            glossary: {},
            sourceLanguageCode: 'zh_Hans',
            targetLanguageCode: 'en',
        });
        await expect(service.prepareLocalizedFields([{ path: 'label', sourceText: '名称' }])).rejects.toThrow(
            'bug',
        );
    });

    it('keeps an unchanged pending record pending when the form is saved again', async () => {
        const repository = {
            findOne: vi.fn().mockResolvedValue({
                status: 'PENDING',
                origin: 'AUTO',
                locked: false,
                sourceHash: contentTranslationInternals.hash('商业服务'),
                translatedHash: contentTranslationInternals.hash('AI services'),
                error: '限流',
            }),
        };
        const service = new ContentTranslationService({ getRepository: () => repository } as any, {
            provider: { name: 'test', isConfigured: () => true, translate: vi.fn() },
            glossary: {},
            sourceLanguageCode: 'zh_Hans',
            targetLanguageCode: 'en',
        });
        const record = vi.spyOn(service, 'recordState').mockResolvedValue({} as any);
        const fields = await service.prepareLocalizedFields([
            {
                path: 'label',
                sourceText: '商业服务',
                targetText: 'AI services',
                existingSourceText: '商业服务',
                existingTargetText: 'AI services',
            },
        ]);
        await service.recordPreparedFields(
            {} as any,
            { channelId: '1', entityType: 'StorefrontContentItem', entityId: '1' },
            fields,
        );
        expect(record).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ status: 'PENDING', origin: 'AUTO', locked: false }),
        );
    });
    it('generates missing English while preserving an explicitly edited target', async () => {
        const provider = {
            name: 'test',
            isConfigured: () => true,
            translate: (request: any) =>
                Promise.resolve({
                    provider: 'test',
                    translations: request.segments.map((segment: any) => ({
                        key: segment.key,
                        text: 'Translated title',
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
            expect.objectContaining({ path: 'title', translatedText: 'Translated title', origin: 'AUTO' }),
            expect.objectContaining({ path: 'body', translatedText: 'Reviewed body', origin: 'MANUAL' }),
        ]);
    });

    it('regenerates an unchanged submitted English value when the Chinese source changed', async () => {
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

        expect(field).toMatchObject({ translatedText: 'New title', origin: 'AUTO', locked: false });
    });

    it('regenerates an English field whose existing value still contains Chinese', async () => {
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

        expect(translate).toHaveBeenCalledOnce();
        expect(field).toMatchObject({
            translatedText: 'Official channel service',
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

    it('regenerates English when a manual lock is explicitly removed', async () => {
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

        expect(translate).toHaveBeenCalledOnce();
        expect(field).toMatchObject({
            translatedText: 'Fresh automatic translation',
            status: 'AUTO_TRANSLATED',
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

    it('counts the complete audit set while limiting returned detail rows', async () => {
        const allStatuses = Array.from({ length: 1_001 }, (_, index) => ({
            status: index === 1_000 ? 'MANUAL_LOCKED' : 'AUTO_TRANSLATED',
        }));
        const repository = {
            find: vi.fn((options: any) =>
                Promise.resolve(options.take ? allStatuses.slice(0, options.take) : allStatuses),
            ),
        };
        const service = new ContentTranslationService({ getRepository: vi.fn(() => repository) } as any, {
            provider: { name: 'test', isConfigured: () => true, translate: vi.fn() },
            glossary: {},
            sourceLanguageCode: 'zh_Hans',
            targetLanguageCode: 'en',
        });

        await expect(service.audit({} as any)).resolves.toMatchObject({
            total: 1_001,
            states: { length: 1_000 },
            counts: expect.arrayContaining([
                { status: 'AUTO_TRANSLATED', count: 1_000 },
                { status: 'MANUAL_LOCKED', count: 1 },
            ]),
        });
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
                    status: expect.objectContaining({ value: ['STALE', 'PENDING', 'TRANSLATING', 'FAILED'] }),
                },
                {
                    channelId: expect.anything(),
                    status: expect.objectContaining({ value: ['STALE', 'PENDING', 'TRANSLATING', 'FAILED'] }),
                },
            ],
        });
    });

    it('audits the active channel together with global translation records', async () => {
        const repository = { find: vi.fn().mockResolvedValue([]) };
        const service = new ContentTranslationService({ getRepository: vi.fn(() => repository) } as any, {
            provider: { name: 'test', isConfigured: () => true, translate: vi.fn() },
            glossary: {},
            sourceLanguageCode: 'zh_Hans',
            targetLanguageCode: 'en',
        });

        await service.audit({} as any, 'channel-1');

        expect(repository.find).toHaveBeenCalledTimes(2);
        expect(repository.find).toHaveBeenCalledWith(
            expect.objectContaining({
                where: [{ channelId: 'channel-1' }, { channelId: expect.anything() }],
            }),
        );
    });
});
