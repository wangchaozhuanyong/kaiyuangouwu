import 'reflect-metadata';

import { LanguageCode } from '@vendure/common/lib/generated-types';
import { ContentTranslationService } from '@vendure/content-translation-plugin';
import { Kind } from 'graphql';
import { describe, expect, it, vi } from 'vitest';

import { adminApiExtensions } from './api-extensions';
import { StorefrontContentBlock } from './entities/storefront-content-block.entity';
import { StorefrontContentItem } from './entities/storefront-content-item.entity';
import { StorefrontContentService } from './storefront-content.service';

function translationService(configured = false) {
    const translate = vi.fn().mockRejectedValue(new Error('User Rate Limit Exceeded'));
    const translations = new ContentTranslationService({} as never, {
        provider: { name: 'unavailable-test-provider', isConfigured: () => configured, translate },
        glossary: {},
        sourceLanguageCode: 'zh_Hans',
        targetLanguageCode: 'en',
    });
    const record = vi.spyOn(translations, 'recordPreparedFields').mockResolvedValue();
    return { translate, translations, record };
}

describe('reviewed storefront translations', () => {
    it.each(['block', 'item'] as const)(
        'preserves %s English on changed Chinese, repeated publish and rollback without translation',
        async kind => {
            const fields =
                kind === 'block' ? ['title', 'subtitle', 'body', 'ctaLabel'] : ['label', 'description'];
            const originalChinese = Object.fromEntries(fields.map(field => [field, '原中文']));
            const reviewedEnglish = Object.fromEntries(fields.map(field => [field, `Reviewed ${field}`]));
            let stored = [
                { languageCode: LanguageCode.zh_Hans, ...originalChinese },
                { languageCode: LanguageCode.en, ...reviewedEnglish },
            ];
            const repository = {
                find: vi.fn(() => Promise.resolve(stored)),
                delete: vi.fn().mockResolvedValue(undefined),
                save: vi.fn(values => {
                    stored = values;
                    return Promise.resolve(values);
                }),
            };
            const { translate, translations, record } = translationService();
            const service = new StorefrontContentService(
                { getRepository: () => repository } as never,
                {} as never,
                {} as never,
                translations,
            );
            const ctx = { channelId: 'reviewed-channel' } as never;
            for (const sourceText of ['新中文', '新中文', '原中文']) {
                const inputs = [
                    {
                        languageCode: LanguageCode.zh_Hans,
                        ...Object.fromEntries(fields.map(field => [field, sourceText])),
                    },
                    {
                        languageCode: LanguageCode.en,
                        ...reviewedEnglish,
                        ...Object.fromEntries(fields.map(field => [`${field}Locked`, true])),
                    },
                ];
                if (kind === 'block') {
                    await (service as any).replaceBlockTranslations(
                        ctx,
                        new StorefrontContentBlock({ id: 'block-1' }),
                        inputs,
                    );
                } else {
                    await (service as any).replaceItemTranslations(
                        ctx,
                        new StorefrontContentItem({ id: 'item-1' }),
                        inputs,
                    );
                }
                expect(stored.find(value => value.languageCode === LanguageCode.en)).toMatchObject(
                    reviewedEnglish,
                );
                expect(stored.find(value => value.languageCode === LanguageCode.zh_Hans)).toMatchObject(
                    Object.fromEntries(fields.map(field => [field, sourceText])),
                );
                expect(record).toHaveBeenLastCalledWith(
                    ctx,
                    expect.objectContaining({ channelId: 'reviewed-channel' }),
                    fields.map(field =>
                        expect.objectContaining({
                            path: field,
                            translatedText: reviewedEnglish[field],
                            origin: 'MANUAL',
                            locked: true,
                        }),
                    ),
                );
            }
            expect(repository.save).toHaveBeenCalledTimes(3);
            expect(translate).not.toHaveBeenCalled();
        },
    );

    it('clears optional fields without locking an empty English translation', async () => {
        const repository = {
            find: vi.fn().mockResolvedValue([
                { languageCode: LanguageCode.zh_Hans, title: '原标题', subtitle: '原副标题' },
                { languageCode: LanguageCode.en, title: 'Reviewed title', subtitle: 'Old subtitle' },
            ]),
            delete: vi.fn(),
            save: vi.fn(),
        };
        const { translations, translate } = translationService();
        const service = new StorefrontContentService(
            { getRepository: () => repository } as never,
            {} as never,
            {} as never,
            translations,
        );
        await (service as any).replaceBlockTranslations({}, new StorefrontContentBlock({ id: 'block-1' }), [
            { languageCode: LanguageCode.zh_Hans, title: '新标题', subtitle: '' },
            {
                languageCode: LanguageCode.en,
                title: 'Reviewed title',
                titleLocked: true,
                subtitle: '',
                subtitleLocked: false,
            },
        ]);
        expect(repository.save).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({
                    languageCode: LanguageCode.en,
                    title: 'Reviewed title',
                    subtitle: '',
                }),
            ]),
        );
        expect(translate).not.toHaveBeenCalled();
    });

    it.each([undefined, false])('queues automatic translation when the lock is %s', async locked => {
        const repository = {
            find: vi.fn().mockResolvedValue([
                { languageCode: LanguageCode.zh_Hans, label: '原中文' },
                { languageCode: LanguageCode.en, label: 'Old English' },
            ]),
            delete: vi.fn(),
            save: vi.fn(),
        };
        const { translations, translate } = translationService(true);
        const service = new StorefrontContentService(
            { getRepository: () => repository } as never,
            {} as never,
            {} as never,
            translations,
        );
        await expect(
            (service as any).replaceItemTranslations({}, new StorefrontContentItem({ id: 'item-1' }), [
                { languageCode: LanguageCode.zh_Hans, label: '新中文' },
                { languageCode: LanguageCode.en, label: 'Old English', labelLocked: locked },
            ]),
        ).resolves.toBeUndefined();
        expect(translate).not.toHaveBeenCalled();
        expect(repository.save).toHaveBeenCalled();
    });

    it('exposes optional per-field translation locks in the Admin schema', () => {
        for (const [name, fields] of [
            [
                'StorefrontContentBlockTranslationInput',
                ['titleLocked', 'subtitleLocked', 'bodyLocked', 'ctaLabelLocked'],
            ],
            ['StorefrontContentItemTranslationInput', ['labelLocked', 'descriptionLocked']],
        ] as const) {
            const definition = adminApiExtensions.definitions.find(
                value => value.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION && value.name.value === name,
            );
            if (definition?.kind !== Kind.INPUT_OBJECT_TYPE_DEFINITION) throw new Error(name);
            for (const fieldName of fields) {
                expect(definition.fields?.find(field => field.name.value === fieldName)?.type).toMatchObject({
                    kind: Kind.NAMED_TYPE,
                    name: { value: 'Boolean' },
                });
            }
        }
    });
});
