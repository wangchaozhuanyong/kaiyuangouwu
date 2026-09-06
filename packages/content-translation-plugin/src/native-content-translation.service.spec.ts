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

    it('queues English without calling an unconfigured provider', async () => {
        const source = {
            languageCode: 'zh_Hans',
            name: '测试商品',
            slug: 'ce-shi-shang-pin',
            description: '<p>商品详情</p>',
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
                    getOne: vi.fn(() => Promise.resolve(languageCode === 'zh_Hans' ? source : null)),
                };
                return builder;
            }),
            create: vi.fn((value: any) => value),
            save: vi.fn((value: any) => Promise.resolve(value)),
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
            findStates: vi.fn().mockResolvedValue([]),
            isConfigured: vi.fn(() => false),
            translate: vi.fn(),
            recordState: vi.fn().mockResolvedValue(undefined),
        };
        const service = new NativeContentTranslationService(
            {} as any,
            connection as any,
            translations as any,
        );

        await expect(
            service.translateEntity({ channelId: 'channel-1' } as any, new Product({ id: 'product-1' }), {
                translations: [source],
            }),
        ).resolves.toBe(true);

        expect(translations.translate).not.toHaveBeenCalled();
        expect(repository.create).toHaveBeenCalled();
        expect(repository.save).toHaveBeenCalled();
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
                    getOne: vi.fn(() => Promise.resolve(languageCode === 'zh_Hans' ? source : target)),
                };
                return builder;
            }),
            create: vi.fn((value: any) => value),
            save: vi.fn((value: any) => Promise.resolve(value)),
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
            findStates: vi.fn().mockResolvedValue([]),
            isConfigured: vi.fn(() => true),
            providerName: vi.fn(() => 'test'),
            translate: vi.fn(({ segments }: any) =>
                Promise.resolve({
                    provider: 'test',
                    translations: segments.map((segment: any) => ({
                        key: segment.key,
                        text: segment.key === 'description' ? '<p>Product details</p>' : 'Test product',
                    })),
                }),
            ),
            recordState: vi.fn().mockResolvedValue(undefined),
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
                name: '',
                slug: 'product-product-1',
                description: '',
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
                    getOne: vi.fn(() => Promise.resolve(languageCode === 'zh_Hans' ? source : target)),
                };
                return builder;
            }),
            create: vi.fn((value: any) => value),
            save: vi.fn((value: any) => Promise.resolve(value)),
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
            findStates: vi.fn().mockResolvedValue([]),
            isConfigured: vi.fn(() => true),
            providerName: vi.fn(() => 'test'),
            translate: vi.fn(({ segments }: any) =>
                Promise.resolve({
                    provider: 'test',
                    translations: segments.map((segment: any) => ({
                        key: segment.key,
                        text: segment.key === 'description' ? '<p>Legacy details</p>' : 'Legacy product',
                    })),
                }),
            ),
            recordState: vi.fn().mockResolvedValue(undefined),
        };
        const service = new NativeContentTranslationService(
            {} as any,
            connection as any,
            translations as any,
        );

        await service.translateEntity({ channelId: 'channel-1' } as any, new Product({ id: 'product-1' }), {
            translations: [source],
        });

        expect(translations.translate).not.toHaveBeenCalled();
        expect(repository.save).toHaveBeenCalledWith(
            expect.objectContaining({
                name: '',
                slug: 'product-product-1',
                description: '',
            }),
            { reload: false },
        );
        expect(translations.recordState).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ status: 'PENDING', locked: false }),
        );
    });

    it('replaces legacy Chinese text even when it differs from the current Chinese source', async () => {
        const source = {
            languageCode: 'zh_Hans',
            name: 'Codex Plus',
            slug: 'codex-plus',
            description: '<p>ChatGPT Plus 官方渠道服务</p>',
        };
        const target = {
            languageCode: 'en',
            name: 'Codex Plus',
            slug: 'codex-plus',
            description: '<p>ChatGPT Plus 为官方渠道服务</p>',
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
                    getOne: vi.fn(() => Promise.resolve(languageCode === 'zh_Hans' ? source : target)),
                };
                return builder;
            }),
            save: vi.fn((value: any) => Promise.resolve(value)),
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
            findStates: vi.fn().mockResolvedValue([]),
            isConfigured: vi.fn(() => true),
            providerName: vi.fn(() => 'test'),
            translate: vi.fn(({ segments }: any) =>
                Promise.resolve({
                    provider: 'test',
                    translations: segments.map((segment: any) => ({
                        key: segment.key,
                        text:
                            segment.key === 'description'
                                ? '<p>Official ChatGPT Plus channel service</p>'
                                : 'Codex Plus',
                    })),
                }),
            ),
            recordState: vi.fn().mockResolvedValue(undefined),
        };
        const service = new NativeContentTranslationService(
            {} as any,
            connection as any,
            translations as any,
        );

        await service.translateEntity({ channelId: 'channel-1' } as any, new Product({ id: 'product-1' }), {
            translations: [source],
        });

        expect(repository.save).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'Codex Plus',
                slug: 'codex-plus',
                description: '',
            }),
            { reload: false },
        );
        expect(translations.recordState).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                fieldPath: 'description',
                status: 'PENDING',
                locked: false,
            }),
        );
    });

    it.each(['channel-1', 'channel-2'])(
        'does not call the provider again for a current automatic translation owned by %s',
        async channelId => {
            const source = { languageCode: 'zh_Hans', name: '测试规格' };
            const target = { languageCode: 'en', name: 'Test option' };
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
                        getOne: vi.fn(() => Promise.resolve(languageCode === 'zh_Hans' ? source : target)),
                    };
                    return builder;
                }),
                save: vi.fn((value: any) => Promise.resolve(value)),
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
                findStates: vi.fn().mockResolvedValue([
                    {
                        channelId,
                        fieldPath: 'name',
                        sourceHash: contentTranslationInternals.hash(source.name),
                        translatedHash: contentTranslationInternals.hash(target.name),
                        status: 'AUTO_TRANSLATED',
                        locked: false,
                    },
                ]),
                isConfigured: vi.fn(() => true),
                providerName: vi.fn(() => 'test'),
                translate: vi.fn(),
                recordState: vi.fn().mockResolvedValue(undefined),
            };
            const service = new NativeContentTranslationService(
                {} as any,
                connection as any,
                translations as any,
            );

            await service.translateEntity(
                { channelId: 'channel-1' } as any,
                new ProductVariant({ id: 'variant-1' }),
                { translations: [source] },
            );

            expect(translations.translate).not.toHaveBeenCalled();
            expect(repository.save).toHaveBeenCalledWith(target, { reload: false });
            expect(translations.recordState).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ status: 'AUTO_TRANSLATED', locked: false }),
            );
        },
    );

    it.each(['channel-1', 'channel-2'])(
        'keeps manually edited English content and marks it stale when Chinese changes owned by %s',
        async channelId => {
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
                        getOne: vi.fn(() => Promise.resolve(languageCode === 'zh_Hans' ? source : target)),
                    };
                    return builder;
                }),
                save: vi.fn((value: any) => Promise.resolve(value)),
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
                            channelId,
                            fieldPath: 'name',
                            sourceHash: contentTranslationInternals.hash('旧商品名称'),
                            translatedHash: contentTranslationInternals.hash(target.name),
                            status: 'MANUAL_LOCKED',
                            locked: true,
                        },
                    ])
                    .mockResolvedValueOnce([
                        {
                            channelId,
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
                recordState: vi.fn().mockResolvedValue(undefined),
            };
            const service = new NativeContentTranslationService(
                {} as any,
                connection as any,
                translations as any,
            );
            const entity = new ProductVariant({ id: 'variant-1' });
            const ctx = { channelId: 'channel-1' } as any;

            await expect(service.translateEntity(ctx, entity, { translations: [source] })).resolves.toBe(
                false,
            );
            await expect(service.translateEntity(ctx, entity, { translations: [source] })).resolves.toBe(
                false,
            );

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
        },
    );

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
                    getOne: vi.fn(() => Promise.resolve(languageCode === 'zh_Hans' ? source : target)),
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
        const translations = { recordState: vi.fn().mockResolvedValue(undefined) };
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

    it('regenerates rather than locking an English-only edit which still contains Chinese', async () => {
        const source = { languageCode: 'zh_Hans', name: '测试规格' };
        const target = { languageCode: 'en', name: '测试规格' };
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
                    getOne: vi.fn(() => Promise.resolve(languageCode === 'zh_Hans' ? source : target)),
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
                            inverseEntityMetadata: { target: class ProductVariantTranslation {} },
                        },
                    ],
                })),
            },
            getRepository: vi.fn(() => repository),
        };
        const translations = { recordState: vi.fn().mockResolvedValue(undefined) };
        const service = new NativeContentTranslationService(
            {} as any,
            connection as any,
            translations as any,
        );
        const entity = new ProductVariant({ id: 'variant-1' });
        const ctx = { channelId: 'channel-1' } as any;
        const translateEntity = vi.spyOn(service, 'translateEntity').mockResolvedValue(false);

        await service.lockManualTranslation(ctx, entity, { translations: [target] });

        expect(translateEntity).toHaveBeenCalledWith(ctx, entity, { translations: [source] });
        expect(translations.recordState).not.toHaveBeenCalled();
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
            count: vi.fn().mockResolvedValue(3),
            find: vi.fn().mockResolvedValue(entities),
        };
        const service = new NativeContentTranslationService(
            { publish: vi.fn().mockResolvedValue(undefined) } as any,
            {
                getRepository: vi.fn(() => repository),
                rawConnection: { getMetadata: () => ({ relations: [] }) },
                withTransaction: (ctx: any, work: any) => work(ctx),
            } as any,
            {} as any,
        );
        vi.spyOn(service, 'translateEntity').mockResolvedValue(false);

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

    it('reports records that cannot be translated because the Chinese source is missing', async () => {
        const repository = {
            count: vi.fn().mockResolvedValue(1),
            find: vi
                .fn()
                .mockResolvedValue([new Product({ id: 'product-without-source', translations: [] })]),
        };
        const service = new NativeContentTranslationService(
            { publish: vi.fn().mockResolvedValue(undefined) } as any,
            {
                getRepository: vi.fn(() => repository),
                rawConnection: { getMetadata: () => ({ relations: [] }) },
                withTransaction: (ctx: any, work: any) => work(ctx),
            } as any,
            {} as any,
        );
        const translateEntity = vi.spyOn(service, 'translateEntity');

        await expect(service.backfill({} as any, 'Product', 100, 0)).resolves.toMatchObject({
            total: 1,
            scanned: 1,
            processed: 0,
            skipped: 1,
            failed: 0,
            skippedRecords: ['Product#product-without-source: Simplified Chinese content is missing'],
        });
        expect(translateEntity).not.toHaveBeenCalled();
    });

    it('excludes the internal root collection from customer-content backfill', async () => {
        const repository = {
            count: vi.fn().mockResolvedValue(1),
            find: vi.fn().mockResolvedValue([
                new Collection({
                    id: 'visible-collection',
                    isRoot: false,
                    translations: [
                        {
                            languageCode: 'zh_Hans',
                            name: '客户分类',
                            slug: 'ke-hu-fen-lei',
                            description: '',
                        } as any,
                    ],
                }),
            ]),
        };
        const service = new NativeContentTranslationService(
            { publish: vi.fn().mockResolvedValue(undefined) } as any,
            {
                getRepository: vi.fn(() => repository),
                rawConnection: { getMetadata: () => ({ relations: [] }) },
                withTransaction: (ctx: any, work: any) => work(ctx),
            } as any,
            {} as any,
        );
        vi.spyOn(service, 'translateEntity').mockResolvedValue(false);

        await expect(service.backfill({} as any, 'Collection', 100, 0)).resolves.toMatchObject({
            total: 1,
            scanned: 1,
            processed: 1,
            skipped: 0,
            failed: 0,
        });
        expect(repository.count).toHaveBeenCalledWith({ where: { isRoot: false } });
        expect(repository.find).toHaveBeenCalledWith(expect.objectContaining({ where: { isRoot: false } }));
    });

    it('bounds each historical scan to one page', async () => {
        const ctx = { channelId: 'channel-1' } as any;
        const requestContextService = { create: vi.fn().mockResolvedValue(ctx) };
        const service = new NativeContentTranslationService(
            {} as any,
            {} as any,
            { isConfigured: vi.fn(() => true) } as any,
            { isServer: true } as any,
            requestContextService as any,
        );
        const backfill = vi
            .spyOn(service, 'backfill')
            .mockResolvedValueOnce({
                total: 150,
                scanned: 100,
                processed: 99,
                queued: 0,
                skipped: 0,
                failed: 1,
                nextOffset: 100,
                hasMore: true,
                skippedRecords: [],
                errors: ['Product#1: temporary failure'],
            })
            .mockResolvedValueOnce({
                total: 150,
                scanned: 50,
                processed: 50,
                queued: 0,
                skipped: 0,
                failed: 0,
                nextOffset: 150,
                hasMore: false,
                skippedRecords: [],
                errors: [],
            });

        await expect(service.repairHistoricalTranslations()).resolves.toMatchObject({
            total: 150,
            scanned: 100,
            processed: 99,
            failed: 1,
            nextOffset: 100,
            hasMore: true,
            errors: ['Product#1: temporary failure'],
        });
        expect(backfill).toHaveBeenNthCalledWith(1, ctx, null, 100, 0);
        expect(backfill).toHaveBeenCalledTimes(1);
    });
});
