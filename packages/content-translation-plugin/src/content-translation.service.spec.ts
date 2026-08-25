import { describe, expect, it, vi } from 'vitest';

import { contentTranslationInternals, ContentTranslationService } from './content-translation.service.js';

describe('content translation hashing', () => {
    it('is deterministic and detects source changes', () => {
        expect(contentTranslationInternals.hash('商品')).toBe(contentTranslationInternals.hash('商品'));
        expect(contentTranslationInternals.hash('商品')).not.toBe(contentTranslationInternals.hash('新商品'));
    });
});

describe('ContentTranslationService localized fields', () => {
    it('generates missing English while preserving an explicitly edited target', async () => {
        const provider = {
            name: 'test',
            isConfigured: () => true,
            translate: async (request: any) => ({
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
            expect.objectContaining({ path: 'title', translatedText: 'EN:标题', origin: 'AUTO' }),
            expect.objectContaining({ path: 'body', translatedText: 'Reviewed body', origin: 'MANUAL' }),
        ]);
    });

    it('regenerates an unchanged submitted English value when the Chinese source changed', async () => {
        const service = new ContentTranslationService({} as any, {
            provider: {
                name: 'test',
                isConfigured: () => true,
                translate: async () => ({
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

    it('counts the complete audit set while limiting returned detail rows', async () => {
        const allStatuses = Array.from({ length: 1_001 }, (_, index) => ({
            status: index === 1_000 ? 'MANUAL_LOCKED' : 'AUTO_TRANSLATED',
        }));
        const repository = {
            find: vi.fn(async (options: any) =>
                options.take ? allStatuses.slice(0, options.take) : allStatuses,
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
});
