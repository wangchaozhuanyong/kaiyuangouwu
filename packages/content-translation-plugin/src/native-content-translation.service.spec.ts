import { Collection, Country, Product, ProductVariant, Province } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { contentTranslationInternals } from './content-translation.service.js';
import {
    NativeContentTranslationService,
    nativeContentTranslationInternals,
} from './native-content-translation.service.js';

describe('native content translation event routing', () => {
    it('only routes mutations which contain Simplified Chinese source content', () => {
        expect(
            nativeContentTranslationInternals.containsSourceTranslation({
                translations: [{ languageCode: 'zh_Hans', name: '商品' }],
            }),
        ).toBe(true);
        expect(
            nativeContentTranslationInternals.containsSourceTranslation({
                translations: [{ languageCode: 'en', name: 'Product' }],
            }),
        ).toBe(false);
        expect(
            nativeContentTranslationInternals.containsTargetTranslation({
                translations: [{ languageCode: 'en', name: 'Product' }],
            }),
        ).toBe(true);
    });

    it('matches batched variant inputs by entity id before falling back to array order', () => {
        const inputs = [{ id: '2' }, { id: '1' }];
        expect(nativeContentTranslationInternals.findInputForEntity(inputs, '1', 0)).toEqual({ id: '1' });
    });

    it('covers customer-visible country and province names', () => {
        expect(nativeContentTranslationInternals.supportsEntityType(Country)).toBe(true);
        expect(nativeContentTranslationInternals.supportsEntityType(Province)).toBe(true);
    });

    it('allows a Simplified Chinese collection when the optional translation provider is absent', async () => {
        const source = {
            languageCode: 'zh_Hans',
            name: '测试分类',
            slug: 'ce-shi-fen-lei',
            description: '',
        };
        const repository = {
            createQueryBuilder: vi.fn(() => {
                let languageCode = '';
                const builder = {
                    leftJoinAndSelect: vi.fn(() => builder),
                    where: vi.fn(() => builder),
                    andWhere: vi.fn((_query: string, parameters: { languageCode: string }) => {
                        languageCode = parameters.languageCode;
                        return builder;
                    }),
                    getOne: vi.fn(async () => (languageCode === 'zh_Hans' ? source : null)),
                };
                return builder;
            }),
            create: vi.fn((value: any) => value),
            save: vi.fn(async (value: any) => value),
        };
        const connection = {
            rawConnection: {
                getMetadata: vi.fn(() => ({
                    relations: [
                        {
                            propertyName: 'translations',
                            inverseEntityMetadata: { target: class CollectionTranslation {} },
                        },
                    ],
                })),
            },
            getRepository: vi.fn(() => repository),
        };
        const translations = {
            findStates: vi.fn(async () => []),
            isConfigured: vi.fn(() => false),
            translate: vi.fn(),
        };
        const service = new NativeContentTranslationService(
            {} as any,
            connection as any,
            translations as any,
        );

        await expect(
            service.translateEntity(
                { channelId: 'channel-1' } as any,
                new Collection({ id: 'collection-1' }),
                { translations: [source] },
            ),
        ).resolves.toBeUndefined();

        expect(translations.translate).not.toHaveBeenCalled();
        expect(repository.create).not.toHaveBeenCalled();
        expect(repository.save).not.toHaveBeenCalled();
    });

    it('regenerates a required English translation when a submitted target was cleared', async () => {
        const source = {
            languageCode: 'zh_Hans',
            name: '测试商品',
            slug: 'ce-shi-shang-pin',
            description: '<p>商品详情</p>',
        };
        const target = {
            languageCode: 'en',
            name: '',
            slug: '',
            description: '',
        };
        const repository = {
            createQueryBuilder: vi.fn(() => {
                let languageCode = '';
                const builder = {
                    leftJoinAndSelect: vi.fn(() => builder),
                    where: vi.fn(() => builder),
                    andWhere: vi.fn((_query: string, parameters: { languageCode: string }) => {
                        languageCode = parameters.languageCode;
                        return builder;
                    }),
                    getOne: vi.fn(async () => (languageCode === 'zh_Hans' ? source : target)),
                };
                return builder;
            }),
            create: vi.fn((value: any) => value),
            save: vi.fn(async (value: any) => value),
        };
        const connection = {
            rawConnection: {
                getMetadata: vi.fn(() => ({
                    relations: [
                        {
                            propertyName: 'translations',
                            inverseEntityMetadata: { target: class ProductTranslation {} },
                        },
                    ],
                })),
            },
            getRepository: vi.fn(() => repository),
        };
        const translations = {
            findStates: vi.fn(async () => []),
            isConfigured: vi.fn(() => true),
            providerName: vi.fn(() => 'test'),
            translate: vi.fn(async ({ segments }: any) => ({
                provider: 'test',
                translations: segments.map((segment: any) => ({
                    key: segment.key,
                    text: segment.key === 'description' ? '<p>Product details</p>' : 'Test product',
                })),
            })),
            recordState: vi.fn(async () => undefined),
        };
        const service = new NativeContentTranslationService(
            {} as any,
            connection as any,
            translations as any,
        );
        const entity = new Product({ id: 'product-1' });

        await service.translateEntity({ channelId: 'channel-1' } as any, entity, {
            translations: [source, { languageCode: 'en', name: '', slug: '', description: '' }],
        });

        expect(repository.save).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'Test product',
                slug: 'test-product',
                description: '<p>Product details</p>',
            }),
            { reload: false },
        );
    });

    it('replaces a legacy English row that is an exact copy of the Chinese source', async () => {
        const source = {
            languageCode: 'zh_Hans',
            name: '历史商品',
            slug: '历史商品',
            description: '<p>历史详情</p>',
        };
        const target = {
            languageCode: 'en',
            name: '历史商品',
            slug: '历史商品',
            description: '<p>历史详情</p>',
        };
        const repository = {
            createQueryBuilder: vi.fn(() => {
                let languageCode = '';
                const builder = {
                    leftJoinAndSelect: vi.fn(() => builder),
                    where: vi.fn(() => builder),
                    andWhere: vi.fn((_query: string, parameters: { languageCode: string }) => {
                        languageCode = parameters.languageCode;
                        return builder;
                    }),
                    getOne: vi.fn(async () => (languageCode === 'zh_Hans' ? source : target)),
                };
                return builder;
            }),
            create: vi.fn((value: any) => value),
            save: vi.fn(async (value: any) => value),
        };
        const connection = {
            rawConnection: {
                getMetadata: vi.fn(() => ({
                    relations: [
                        {
                            propertyName: 'translations',
                            inverseEntityMetadata: { target: class ProductTranslation {} },
                        },
                    ],
                })),
            },
            getRepository: vi.fn(() => repository),
        };
        const translations = {
            findStates: vi.fn(async () => []),
            isConfigured: vi.fn(() => true),
            providerName: vi.fn(() => 'test'),
            translate: vi.fn(async ({ segments }: any) => ({
                provider: 'test',
                translations: segments.map((segment: any) => ({
                    key: segment.key,
                    text: segment.key === 'description' ? '<p>Legacy details</p>' : 'Legacy product',
                })),
            })),
            recordState: vi.fn(async () => undefined),
        };
        const service = new NativeContentTranslationService(
            {} as any,
            connection as any,
            translations as any,
        );

        await service.translateEntity({ channelId: 'channel-1' } as any, new Product({ id: 'product-1' }), {
            translations: [source],
        });

        expect(translations.translate).toHaveBeenCalledWith({
            segments: [
                { key: 'name', text: '历史商品', format: 'TEXT' },
                { key: 'description', text: '<p>历史详情</p>', format: 'HTML' },
            ],
        });
        expect(repository.save).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'Legacy product',
                slug: 'legacy-product',
                description: '<p>Legacy details</p>',
            }),
            { reload: false },
        );
        expect(translations.recordState).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ status: 'AUTO_TRANSLATED', locked: false }),
        );
    });

    it('keeps manually edited English content and marks it stale when Chinese changes', async () => {
        const source = {
            languageCode: 'zh_Hans',
            name: '新商品名称',
        };
        const target = {
            languageCode: 'en',
            name: 'Reviewed product name',
        };
        const repository = {
            createQueryBuilder: vi.fn(() => {
                let languageCode = '';
                const builder = {
                    leftJoinAndSelect: vi.fn(() => builder),
                    where: vi.fn(() => builder),
                    andWhere: vi.fn((_query: string, parameters: { languageCode: string }) => {
                        languageCode = parameters.languageCode;
                        return builder;
                    }),
                    getOne: vi.fn(async () => (languageCode === 'zh_Hans' ? source : target)),
                };
                return builder;
            }),
            save: vi.fn(async (value: any) => value),
        };
        const connection = {
            rawConnection: {
                getMetadata: vi.fn(() => ({
                    relations: [
                        {
                            propertyName: 'translations',
                            inverseEntityMetadata: { target: class ProductVariantTranslation {} },
                        },
                    ],
                })),
            },
            getRepository: vi.fn(() => repository),
        };
        const translations = {
            findStates: vi
                .fn()
                .mockResolvedValueOnce([
                    {
                        fieldPath: 'name',
                        sourceHash: contentTranslationInternals.hash('旧商品名称'),
                        translatedHash: contentTranslationInternals.hash(target.name),
                        status: 'MANUAL_LOCKED',
                        locked: true,
                    },
                ])
                .mockResolvedValueOnce([
                    {
                        fieldPath: 'name',
                        sourceHash: contentTranslationInternals.hash(source.name),
                        translatedHash: contentTranslationInternals.hash(target.name),
                        status: 'STALE',
                        locked: true,
                    },
                ]),
            isConfigured: vi.fn(() => true),
            providerName: vi.fn(() => 'test'),
            translate: vi.fn(),
            recordState: vi.fn(async () => undefined),
        };
        const service = new NativeContentTranslationService(
            {} as any,
            connection as any,
            translations as any,
        );
        const entity = new ProductVariant({ id: 'variant-1' });
        const ctx = { channelId: 'channel-1' } as any;

        await expect(
            service.translateEntity(ctx, entity, { translations: [source] }),
        ).resolves.toBeUndefined();
        await expect(
            service.translateEntity(ctx, entity, { translations: [source] }),
        ).resolves.toBeUndefined();

        expect(translations.translate).not.toHaveBeenCalled();
        expect(repository.save).toHaveBeenCalledTimes(2);
        expect(repository.save).toHaveBeenLastCalledWith(target, { reload: false });
        expect(translations.recordState).toHaveBeenCalledTimes(2);
        expect(translations.recordState).toHaveBeenNthCalledWith(
            1,
            ctx,
            expect.objectContaining({
                fieldPath: 'name',
                sourceText: source.name,
                translatedText: target.name,
                status: 'STALE',
                origin: 'MANUAL',
                locked: true,
            }),
        );
        expect(translations.recordState).toHaveBeenNthCalledWith(
            2,
            ctx,
            expect.objectContaining({ status: 'STALE', locked: true }),
        );
    });

    it('locks an English-only edit so later source saves do not overwrite it', async () => {
        const source = {
            languageCode: 'zh_Hans',
            name: '测试商品',
            slug: 'ce-shi-shang-pin',
            description: '<p>商品详情</p>',
        };
        const target = {
            languageCode: 'en',
            name: 'Reviewed product name',
            slug: 'reviewed-product-name',
            description: '<p>Reviewed details</p>',
        };
        const repository = {
            createQueryBuilder: vi.fn(() => {
                let languageCode = '';
                const builder = {
                    leftJoinAndSelect: vi.fn(() => builder),
                    where: vi.fn(() => builder),
                    andWhere: vi.fn((_query: string, parameters: { languageCode: string }) => {
                        languageCode = parameters.languageCode;
                        return builder;
                    }),
                    getOne: vi.fn(async () => (languageCode === 'zh_Hans' ? source : target)),
                };
                return builder;
            }),
        };
        const connection = {
            rawConnection: {
                getMetadata: vi.fn(() => ({
                    relations: [
                        {
                            propertyName: 'translations',
                            inverseEntityMetadata: { target: class ProductTranslation {} },
                        },
                    ],
                })),
            },
            getRepository: vi.fn(() => repository),
        };
        const translations = { recordState: vi.fn(async () => undefined) };
        const service = new NativeContentTranslationService(
            {} as any,
            connection as any,
            translations as any,
        );

        await service.lockManualTranslation(
            { channelId: 'channel-1' } as any,
            new Product({ id: 'product-1' }),
            { translations: [target] },
        );

        expect(translations.recordState).toHaveBeenCalledTimes(3);
        expect(translations.recordState).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                fieldPath: 'name',
                translatedText: 'Reviewed product name',
                status: 'MANUAL_LOCKED',
                origin: 'MANUAL',
                locked: true,
            }),
        );
    });

    it('advances historical backfill with a stable offset', async () => {
        const entities = ['product-2', 'product-3'].map(
            id =>
                new Product({
                    id: id as any,
                    translations: [
                        {
                            languageCode: 'zh_Hans',
                            name: `商品 ${id}`,
                            slug: id,
                            description: '<p>详情</p>',
                        } as any,
                    ],
                }),
        );
        const repository = {
            count: vi.fn(async () => 3),
            find: vi.fn(async () => entities),
        };
        const service = new NativeContentTranslationService(
            {} as any,
            { getRepository: vi.fn(() => repository) } as any,
            {} as any,
        );
        vi.spyOn(service, 'translateEntity').mockResolvedValue(undefined);

        await expect(service.backfill({} as any, 'Product', 2, 1)).resolves.toMatchObject({
            total: 3,
            scanned: 2,
            processed: 2,
            failed: 0,
            nextOffset: 3,
            hasMore: false,
        });
        expect(repository.find).toHaveBeenCalledWith(
            expect.objectContaining({ skip: 1, take: 2, order: { id: 'ASC' } }),
        );
    });
});
