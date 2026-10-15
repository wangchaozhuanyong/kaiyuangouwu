import 'reflect-metadata';

import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
    Channel,
    Collection,
    CollectionTranslation,
    LanguageCode,
    Product,
    ProductTranslation,
    PUBLIC_PRODUCT_SUMMARY_READER,
    type Permission,
    type RequestContext,
    type TransactionalConnection,
} from '@vendure/core';
import { StoreDomain } from '@vendure/store-domain-plugin';
import type { StorefrontPageData } from '@vendure/storefront-content-plugin';
import { DataSource, EntitySchema } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { PublicProductSummaryService } from '../../../commerce-fulfillment-plugin/src/public-product-summary.service';
import { StoreProfile } from '../entities/store-profile.entity';

import { StorefrontPublicSeoService } from './storefront-public-seo.service';
import {
    defaultStorefrontSeoSettings,
    storefrontSeoSettingsIdentity,
    type StorefrontSeoIdentity,
} from './storefront-seo.contract';
import { StorefrontSeoRecord, StorefrontSeoRevision } from './storefront-seo.entity';
import { StorefrontSeoService } from './storefront-seo.service';

describe('public SEO with real isolated SQL publication and catalog membership', () => {
    let data: DataSource;
    let seo: StorefrontSeoService;
    let publicSeo: StorefrontPublicSeoService;
    let productReader: PublicProductSummaryService;
    let productListSpy: MockInstance<PublicProductSummaryService['list']>;
    let mode: 'LIVE' | 'PREVIEW' | 'CLOSED';
    const context = (id = 1, languageCode = 'en', admin = false): RequestContext =>
        ({
            channelId: id,
            channel: { id, code: `store-${id}`, availableLanguageCodes: ['zh_Hans', 'en'] },
            languageCode,
            apiType: admin ? 'admin' : 'shop',
            activeUserId: admin ? `operator-${id}` : undefined,
            userHasPermissions: (_permissions: Permission[]) => admin,
            copy: (changes: { languageCode?: string }) =>
                context(id, changes.languageCode ?? languageCode, admin),
        }) as unknown as RequestContext;

    beforeEach(async () => {
        // All persistence and joins use :memory:. No runtime database or production configuration is accessed.
        const id = { id: { type: Number, primary: true, generated: true } } as const;
        const timestamps = {
            createdAt: { type: Date, createDate: true },
            updatedAt: { type: Date, updateDate: true },
        } as const;
        const channels = { type: 'many-to-many', target: 'Channel', joinTable: true } as const;
        const translationColumns = {
            ...id,
            baseId: { type: Number },
            languageCode: { type: String },
            name: { type: String },
            description: { type: String },
        } as const;
        data = new DataSource({
            type: 'better-sqlite3',
            database: ':memory:',
            synchronize: true,
            entities: [
                new EntitySchema({ name: 'Channel', target: Channel, columns: id }),
                new EntitySchema({
                    name: 'StoreDomain',
                    target: StoreDomain,
                    columns: {
                        ...id,
                        channelId: { type: Number },
                        domain: { type: String },
                        isPrimary: { type: Boolean },
                        status: { type: String },
                        verifiedAt: { type: Date, nullable: true },
                    },
                }),
                new EntitySchema({
                    name: 'StoreProfile',
                    target: StoreProfile,
                    columns: {
                        ...id,
                        channelId: { type: Number },
                        descriptionZh: { type: String },
                        descriptionEn: { type: String },
                    },
                }),
                new EntitySchema<Product>({
                    name: 'Product',
                    target: Product,
                    columns: {
                        ...id,
                        ...timestamps,
                        enabled: { type: Boolean },
                        deletedAt: { type: Date, nullable: true },
                    },
                    relations: {
                        channels,
                        translations: {
                            type: 'one-to-many',
                            target: 'ProductTranslation',
                            inverseSide: 'base',
                        },
                    },
                }),
                new EntitySchema<ProductTranslation & { baseId: number }>({
                    name: 'ProductTranslation',
                    target: ProductTranslation,
                    columns: translationColumns,
                    relations: {
                        base: { type: 'many-to-one', target: 'Product', joinColumn: { name: 'baseId' } },
                    },
                }),
                new EntitySchema<Collection>({
                    name: 'Collection',
                    target: Collection,
                    columns: {
                        ...id,
                        ...timestamps,
                        isPrivate: { type: Boolean },
                        isRoot: { type: Boolean },
                    },
                    relations: {
                        channels,
                        translations: {
                            type: 'one-to-many',
                            target: 'CollectionTranslation',
                            inverseSide: 'base',
                        },
                    },
                }),
                new EntitySchema<CollectionTranslation & { baseId: number }>({
                    name: 'CollectionTranslation',
                    target: CollectionTranslation,
                    columns: translationColumns,
                    relations: {
                        base: { type: 'many-to-one', target: 'Collection', joinColumn: { name: 'baseId' } },
                    },
                }),
                new EntitySchema({
                    name: 'StorefrontSeoRecord',
                    target: StorefrontSeoRecord,
                    columns: {
                        ...id,
                        ...timestamps,
                        channelId: { type: Number },
                        targetType: { type: String },
                        targetId: { type: String },
                        languageCode: { type: String },
                        draftJson: { type: String },
                        publishedJson: { type: String, nullable: true },
                        version: { type: Number },
                        publishedVersion: { type: Number },
                        publishedAt: { type: Date, nullable: true },
                        publishedByUserId: { type: String, nullable: true },
                    },
                    indices: [
                        { columns: ['channelId', 'targetType', 'targetId', 'languageCode'], unique: true },
                    ],
                }),
                new EntitySchema({
                    name: 'StorefrontSeoRevision',
                    target: StorefrontSeoRevision,
                    columns: {
                        ...id,
                        ...timestamps,
                        channelId: { type: Number },
                        recordId: { type: Number },
                        version: { type: Number },
                        payloadJson: { type: String, nullable: true },
                        publishedAt: { type: Date },
                        publishedBy: { type: String },
                    },
                }),
            ],
        });
        await data.initialize();
        await data.getRepository(Channel).save([{ id: 1 }, { id: 2 }]);
        for (const store of [1, 2]) {
            await data.getRepository(StoreDomain).save({
                channelId: store,
                domain: `store-${store}.test`,
                isPrimary: true,
                status: 'ACTIVE',
                verifiedAt: new Date('2026-10-01'),
            });
            await data.getRepository(StoreProfile).save({
                channelId: store,
                descriptionZh: `店铺 ${store} 正文`,
                descriptionEn: `Store ${store} description`,
            });
            await data
                .getRepository(Product)
                .save({ id: store * 10, enabled: true, deletedAt: null, channels: [{ id: store }] });
            await data.getRepository(ProductTranslation).save([
                {
                    baseId: store * 10,
                    languageCode: LanguageCode.zh_Hans,
                    name: `商品 ${store}`,
                    description: `完整商品 ${store} 正文`,
                },
                {
                    baseId: store * 10,
                    languageCode: LanguageCode.en,
                    name: `Product ${store}`,
                    description: `Complete product ${store} description`,
                },
            ]);
        }
        const connection = {
            getRepository: (_ctx: RequestContext, target: typeof Product) => data.getRepository(target),
            withTransaction: (ctx: RequestContext, work: (ctx: RequestContext) => Promise<unknown>) =>
                work(ctx),
            findOneInChannel: (
                _ctx: RequestContext,
                target: typeof Product,
                targetId: string,
                channelId: number,
            ) =>
                data
                    .getRepository(target)
                    .createQueryBuilder('entity')
                    .innerJoin('entity.channels', 'channel', 'channel.id = :channelId', { channelId })
                    .where('entity.id = :targetId', { targetId })
                    .getOne(),
        } as unknown as TransactionalConnection;
        mode = 'LIVE';
        const activation = { getAccessMode: vi.fn(() => Promise.resolve(mode)) };
        seo = new StorefrontSeoService(
            connection,
            activation as never,
            { publish: vi.fn().mockResolvedValue(undefined) } as never,
        );
        // Keep the real anonymous context and <=100 pagination checks; summary projection is not used by SEO.
        productReader = Object.assign(Object.create(PublicProductSummaryService.prototype), {
            products: {
                findAll: async (ctx: RequestContext, options: { take: number; skip: number }) => {
                    const [items, totalItems] = await data
                        .getRepository(Product)
                        .createQueryBuilder('product')
                        .innerJoin('product.channels', 'channel', 'channel.id = :channelId', {
                            channelId: ctx.channelId,
                        })
                        .leftJoinAndSelect(
                            'product.translations',
                            'translation',
                            'translation.languageCode = :code',
                            { code: ctx.languageCode },
                        )
                        .where('product.enabled = :enabled', { enabled: true })
                        .orderBy('translation.name', 'ASC')
                        .skip(options.skip)
                        .take(options.take)
                        .getManyAndCount();
                    return { items, totalItems };
                },
            },
            project: (_ctx: RequestContext, products: Product[]) =>
                Promise.resolve(products.map(product => ({ id: String(product.id) }))),
        });
        productListSpy = vi.spyOn(productReader, 'list');
        publicSeo = new StorefrontPublicSeoService(
            seo,
            connection,
            activation as never,
            { findPublished: vi.fn().mockResolvedValue([]) } as never,
            {
                get: (token: unknown) => {
                    if (token === PUBLIC_PRODUCT_SUMMARY_READER) return productReader;
                    throw new Error('Unexpected public SEO dependency');
                },
            } as never,
        );
        for (const store of [1, 2]) {
            const settings = defaultStorefrontSeoSettings();
            settings.indexingEnabled = true;
            settings.platformBindings = [
                {
                    platform: 'GSC',
                    property: `sc-domain:store-${store}.test`,
                    status: 'UNVERIFIED',
                    verifiedAt: null,
                    note: 'private-platform-note',
                },
            ];
            await seo.saveDraft(context(store, 'en', true), {
                ...storefrontSeoSettingsIdentity,
                expectedVersion: 0,
                draft: settings,
            });
            await seo.publish(context(store, 'en', true), {
                ...storefrontSeoSettingsIdentity,
                expectedVersion: 1,
            });
        }
    });
    afterEach(async () => {
        if (data?.isInitialized) await data.destroy();
    });

    const page = (
        ctx: RequestContext,
        productId = String(Number(ctx.channelId) * 10),
        price = 1250,
    ): StorefrontPageData => ({
        schemaVersion: 1,
        version: 'fixture',
        generatedAt: 1,
        scope: {
            host: `store-${ctx.channelId}.test`,
            channelCode: ctx.channel.code,
            languageCode: ctx.languageCode,
            currencyCode: 'MYR',
            priceContext: 'public',
        },
        route: `/product?id=${productId}`,
        request: { kind: 'product', id: productId },
        failures: [],
        media: [],
        config: {
            accessMode: 'LIVE',
            customFields: {
                storefrontNameZh: `店铺 ${ctx.channelId}`,
                storefrontNameEn: `Store ${ctx.channelId}`,
            },
            description: 'Real published description',
            logoUrl: null,
        },
        product: {
            id: productId,
            name: ctx.languageCode === LanguageCode.zh_Hans ? '真实商品' : 'Actual product',
            description: 'Actual published body',
            customFields: { pricingMode: 'SALE' },
            featuredAsset: null,
            variants: [
                {
                    id: 'variant',
                    sku: 'ACTUAL',
                    currencyCode: 'MYR',
                    priceWithTax: price,
                    saleableStockLevel: 5,
                    customFields: { fulfillmentType: 'physical' },
                },
            ],
        },
    });
    const productIdentity: StorefrontSeoIdentity = {
        targetType: 'PRODUCT',
        targetId: '10',
        languageCode: 'en',
    };

    const seedSitemapProducts = async (count: number) => {
        await data.getRepository(Product).update({ id: 10 }, { enabled: false });
        const ids = Array.from({ length: count }, (_, index) => 1000 + index);
        if (ids.length) {
            await data
                .getRepository(Product)
                .save(ids.map(id => ({ id, enabled: true, deletedAt: null, channels: [{ id: 1 }] })));
            await data.getRepository(ProductTranslation).save(
                ids.flatMap((id, index) =>
                    [LanguageCode.zh_Hans, LanguageCode.en].map(languageCode => ({
                        baseId: id,
                        languageCode,
                        name: `Product ${String(index).padStart(4, '0')}`,
                        description: `Complete product ${id} description`,
                    })),
                ),
            );
        }
        return ids;
    };
    const sitemapLocations = (xml: string) =>
        Array.from(xml.matchAll(/<loc>(.*?)<\/loc>/gu), item => item[1]);
    const productLocations = (ids: number[]) =>
        ids.flatMap(id => ['zh', 'en'].map(code => `https://store-1.test/${code}/product?id=${id}`));
    const readerPages = () => productListSpy.mock.calls.map(([, input]) => input);

    it('omits a collection shard whose real SQL catalog has no indexable language entries', async () => {
        const entities = [
            { id: 101, isRoot: true, isPrivate: false, channels: [{ id: 1 }] },
            { id: 102, isRoot: false, isPrivate: false, channels: [{ id: 1 }] },
            { id: 103, isRoot: false, isPrivate: false, channels: [{ id: 1 }] },
            { id: 104, isRoot: false, isPrivate: true, channels: [{ id: 1 }] },
            { id: 105, isRoot: false, isPrivate: false, channels: [{ id: 2 }] },
        ];
        await data.getRepository(Collection).save(entities);
        await data.getRepository(CollectionTranslation).save(
            entities.flatMap(entity =>
                [LanguageCode.zh_Hans, LanguageCode.en].map(languageCode => ({
                    baseId: entity.id,
                    languageCode,
                    name: `Collection ${entity.id}`,
                    description: entity.id === 102 ? '<p> </p>' : `Complete collection ${entity.id}`,
                })),
            ),
        );
        for (const languageCode of ['zh_Hans', 'en'] as const) {
            const identity: StorefrontSeoIdentity = {
                targetType: 'COLLECTION',
                targetId: '103',
                languageCode,
            };
            await seo.saveDraft(context(1, languageCode, true), {
                ...identity,
                expectedVersion: 0,
                draft: { indexMode: 'NOINDEX' },
            });
            await seo.publish(context(1, languageCode, true), { ...identity, expectedVersion: 1 });
        }
        expect(sitemapLocations(await publicSeo.sitemap(context(), 'store-1.test', 'collections'))).toEqual(
            [],
        );
        expect(sitemapLocations(await publicSeo.sitemap(context(), 'store-1.test'))).toEqual([
            'https://store-1.test/sitemap-pages.xml',
            'https://store-1.test/sitemap-products-0.xml',
        ]);
    });

    it('keeps nonempty collection shard numbers, language filtering and primary canonical URLs', async () => {
        const ids = Array.from({ length: 1001 }, (_, index) => 1000 + index);
        await data.getRepository(Collection).save(
            ids.map(id => ({
                id,
                isRoot: false,
                isPrivate: false,
                channels: [{ id: 1 }],
            })),
        );
        await data.getRepository(CollectionTranslation).save(
            ids.flatMap(id =>
                [LanguageCode.zh_Hans, LanguageCode.en].map(languageCode => ({
                    baseId: id,
                    languageCode,
                    name: `Collection ${id}`,
                    description:
                        id === 1000 || (id === 2000 && languageCode === LanguageCode.en)
                            ? `Complete collection ${id}`
                            : '',
                })),
            ),
        );
        const identity: StorefrontSeoIdentity = {
            targetType: 'COLLECTION',
            targetId: '1000',
            languageCode: 'en',
        };
        await seo.saveDraft(context(1, 'en', true), {
            ...identity,
            expectedVersion: 0,
            draft: { indexMode: 'NOINDEX' },
        });
        await seo.publish(context(1, 'en', true), { ...identity, expectedVersion: 1 });
        expect(sitemapLocations(await publicSeo.sitemap(context(), 'alias.test'))).toEqual([
            'https://store-1.test/sitemap-pages.xml',
            'https://store-1.test/sitemap-products-0.xml',
            'https://store-1.test/sitemap-collections-0.xml',
            'https://store-1.test/sitemap-collections-2.xml',
        ]);
        const shards = await Promise.all(
            [0, 1, 2].map(shard => publicSeo.sitemap(context(), 'alias.test', 'collections', shard)),
        );
        expect(shards.map(sitemapLocations)).toEqual([
            ['https://store-1.test/zh/category?collectionId=1000'],
            [],
            ['https://store-1.test/en/category?collectionId=2000'],
        ]);
        expect(shards[0]).toContain('<lastmod>');
        expect(shards[2]).toContain('<lastmod>');
    });

    it('does not list collection shards for complete content in a disabled language', async () => {
        await data.getRepository(Collection).save({
            id: 101,
            isRoot: false,
            isPrivate: false,
            channels: [{ id: 1 }],
        });
        await data.getRepository(CollectionTranslation).save({
            baseId: 101,
            languageCode: LanguageCode.en,
            name: 'Complete English collection',
            description: 'Complete English description',
        });
        await seo.saveDraft(context(1, 'en', true), {
            ...storefrontSeoSettingsIdentity,
            expectedVersion: 2,
            draft: { indexingEnabled: true, enabledLanguages: ['zh_Hans'] },
        });
        await seo.publish(context(1, 'en', true), {
            ...storefrontSeoSettingsIdentity,
            expectedVersion: 3,
        });
        expect(await publicSeo.sitemap(context(), 'store-1.test')).not.toContain('sitemap-collections');
        expect(sitemapLocations(await publicSeo.sitemap(context(), 'store-1.test', 'collections'))).toEqual(
            [],
        );
    });

    it('rejects a collection index if its SQL-published NOINDEX changes during discovery', async () => {
        await data.getRepository(Collection).save({
            id: 101,
            isRoot: false,
            isPrivate: false,
            channels: [{ id: 1 }],
        });
        await data.getRepository(CollectionTranslation).save({
            baseId: 101,
            languageCode: LanguageCode.en,
            name: 'Complete English collection',
            description: 'Complete English description',
        });
        const listPublished = seo.listPublished.bind(seo);
        let reads = 0;
        vi.spyOn(seo, 'listPublished').mockImplementation(async (...args) => {
            if (++reads === 2) {
                const identity: StorefrontSeoIdentity = {
                    targetType: 'COLLECTION',
                    targetId: '101',
                    languageCode: 'en',
                };
                await seo.saveDraft(context(1, 'en', true), {
                    ...identity,
                    expectedVersion: 0,
                    draft: { indexMode: 'NOINDEX' },
                });
                await seo.publish(context(1, 'en', true), { ...identity, expectedVersion: 1 });
            }
            return listPublished(...args);
        });
        await expect(publicSeo.sitemap(context(), 'store-1.test')).rejects.toThrow(
            'Published discovery pages changed during read',
        );
    });

    it('keeps 500 products per sitemap shard within the real public reader pagination limit', async () => {
        const ids = await seedSitemapProducts(501);
        const index = await publicSeo.sitemap(context(), 'store-1.test');
        expect(sitemapLocations(index)).toEqual([
            'https://store-1.test/sitemap-pages.xml',
            'https://store-1.test/sitemap-products-0.xml',
            'https://store-1.test/sitemap-products-1.xml',
        ]);
        productListSpy.mockClear();
        const first = sitemapLocations(await publicSeo.sitemap(context(), 'store-1.test', 'products', 0));
        expect(first).toEqual(productLocations(ids.slice(0, 500)));
        expect(readerPages()).toEqual([0, 100, 200, 300, 400].map(skip => ({ take: 100, skip })));
        productListSpy.mockClear();
        const second = sitemapLocations(await publicSeo.sitemap(context(), 'store-1.test', 'products', 1));
        expect(second).toEqual(productLocations(ids.slice(500)));
        expect(readerPages()).toEqual([{ take: 100, skip: 500 }]);
        expect(new Set([...first, ...second]).size).toBe(1002);
    });

    it.each([0, 37, 100, 137])(
        'stops product sitemap pagination at the actual %i-product catalog',
        async count => {
            const ids = await seedSitemapProducts(count);
            const xml = await publicSeo.sitemap(context(), 'store-1.test', 'products');
            expect(sitemapLocations(xml)).toEqual(productLocations(ids));
            expect(readerPages()).toEqual(
                Array.from({ length: Math.max(1, Math.ceil(count / 100)) }, (_, pageIndex) => ({
                    take: 100,
                    skip: pageIndex * 100,
                })),
            );
        },
    );

    it('preserves language-specific NOINDEX and incomplete-body exclusions across reader and shard boundaries', async () => {
        const ids = await seedSitemapProducts(501);
        const exclusions = [
            { id: 1099, code: 'zh_Hans' },
            { id: 1100, code: 'en' },
            { id: 1499, code: 'zh_Hans' },
            { id: 1500, code: 'en' },
        ] as const;
        for (const { id, code } of exclusions) {
            const identity: StorefrontSeoIdentity = {
                targetType: 'PRODUCT',
                targetId: String(id),
                languageCode: code,
            };
            await seo.saveDraft(context(1, code, true), {
                ...identity,
                expectedVersion: 0,
                draft: { indexMode: 'NOINDEX' },
            });
            await seo.publish(context(1, code, true), { ...identity, expectedVersion: 1 });
        }
        await data
            .getRepository<ProductTranslation & { baseId: number }>(ProductTranslation)
            .update({ baseId: 1101, languageCode: LanguageCode.en }, { description: '' });
        const excluded = new Set([
            ...exclusions.map(
                ({ id, code }) => `https://store-1.test/${code === 'zh_Hans' ? 'zh' : 'en'}/product?id=${id}`,
            ),
            'https://store-1.test/en/product?id=1101',
        ]);
        const first = sitemapLocations(await publicSeo.sitemap(context(), 'store-1.test', 'products', 0));
        const second = sitemapLocations(await publicSeo.sitemap(context(), 'store-1.test', 'products', 1));
        expect(first).toEqual(productLocations(ids.slice(0, 500)).filter(url => !excluded.has(url)));
        expect(second).toEqual(['https://store-1.test/zh/product?id=1500']);
        expect(readerPages()).toEqual([
            ...[0, 100, 200, 300, 400].map(skip => ({ take: 100, skip })),
            { take: 100, skip: 500 },
        ]);
    });

    it('reads only published metadata for the right store and retains live price facts', async () => {
        await seo.saveDraft(context(1, 'en', true), {
            ...productIdentity,
            expectedVersion: 0,
            draft: { title: 'Published store one title' },
        });
        await seo.publish(context(1, 'en', true), { ...productIdentity, expectedVersion: 1 });
        await seo.saveDraft(context(1, 'en', true), {
            ...productIdentity,
            expectedVersion: 2,
            draft: { title: 'private-unpublished-title' },
        });
        const first = await publicSeo.enrich(context(), 'store-1.test', page(context()));
        expect(first.seo).toMatchObject({
            title: 'Published store one title',
            canonical: 'https://store-1.test/en/product?id=10',
            indexable: true,
        });
        expect(first.seo?.alternates.map(item => item.language)).toEqual(['zh-CN', 'en']);
        expect(JSON.stringify(first)).not.toMatch(
            /private-platform-note|private-unpublished-title|platformBindings|aiCitations/,
        );
        const updated = await publicSeo.enrich(context(), 'store-1.test', page(context(), '10', 2750));
        expect(updated.seo?.structuredData.find(item => item['@type'] === 'Product')).toMatchObject({
            offers: { price: '27.50' },
        });
        const second = await publicSeo.enrich(context(2), 'store-2.test', page(context(2)));
        expect(second.seo?.title).not.toContain('store one');
        expect(second.seo?.canonical).toBe('https://store-2.test/en/product?id=20');
        await expect(publicSeo.enrich(context(2), 'store-2.test', page(context(2), '10'))).rejects.toThrow(
            'Public product not found',
        );
    });

    it('does not let a translated SEO record invent missing underlying language content or LIVE status', async () => {
        await data
            .getRepository(ProductTranslation)
            .createQueryBuilder()
            .update()
            .set({ description: '' })
            .where('baseId = :id AND languageCode = :code', { id: 10, code: LanguageCode.en })
            .execute();
        await seo.saveDraft(context(1, 'en', true), {
            ...productIdentity,
            expectedVersion: 0,
            draft: {
                title: 'Complete-looking metadata',
                description: 'Metadata cannot replace the actual body',
            },
        });
        await seo.publish(context(1, 'en', true), { ...productIdentity, expectedVersion: 1 });
        const english = await publicSeo.enrich(context(), 'store-1.test', page(context()));
        expect(english.seo?.indexable).toBe(false);
        expect(english.seo?.reasons).toContain('LANGUAGE_CONTENT_INCOMPLETE');
        expect(english.seo?.alternates).toEqual([]);
        const chinese = await publicSeo.enrich(
            context(1, 'zh_Hans'),
            'store-1.test',
            page(context(1, 'zh_Hans')),
        );
        expect(chinese.seo?.indexable).toBe(true);
        expect(chinese.seo?.alternates.map(item => item.language)).toEqual(['zh-CN']);
        mode = 'PREVIEW';
        const preview = await publicSeo.enrich(
            context(1, 'zh_Hans'),
            'store-1.test',
            page(context(1, 'zh_Hans')),
        );
        expect(preview.seo?.robots).toBe('noindex, follow');
        expect(preview.seo?.reasons).toContain('STORE_NOT_LIVE');
    });
    it.each(['document-publish', 'document-unpublish', 'settings-publish', 'settings-unpublish'])(
        'rejects rendered output after %s changes its real SQL publication',
        async action => {
            const admin = context(1, 'en', true);
            await seo.saveDraft(admin, {
                ...productIdentity,
                expectedVersion: 0,
                draft: { title: 'Published title' },
            });
            await seo.publish(admin, { ...productIdentity, expectedVersion: 1 });
            const rendered = await publicSeo.enrich(context(), 'store-1.test', page(context()));
            await expect(publicSeo.assertOutput(context(), rendered)).resolves.toBeUndefined();
            const identity = action.startsWith('settings') ? storefrontSeoSettingsIdentity : productIdentity;
            if (action.endsWith('unpublish')) await seo.unpublish(admin, { ...identity, expectedVersion: 2 });
            else {
                await seo.saveDraft(admin, {
                    ...identity,
                    expectedVersion: 2,
                    draft:
                        identity.targetType === 'SETTINGS'
                            ? { indexingEnabled: false }
                            : { title: 'Next published title' },
                });
                await seo.publish(admin, { ...identity, expectedVersion: 3 });
            }
            await expect(publicSeo.assertOutput(context(), rendered)).rejects.toThrow(
                'Public authority changed',
            );
        },
    );
    it('does not send a previously rendered SQL-backed page after closure or primary domain withdrawal', async () => {
        const rendered = await publicSeo.enrich(context(), 'store-1.test', page(context()));
        await expect(publicSeo.assertOutput(context(), rendered)).resolves.toBeUndefined();
        mode = 'CLOSED';
        await expect(publicSeo.assertOutput(context(), rendered)).rejects.toMatchObject({
            code: 'STOREFRONT_CLOSED',
        });
        mode = 'LIVE';
        await data.getRepository(StoreDomain).update({ channelId: 1 }, { verifiedAt: null });
        await expect(publicSeo.assertOutput(context(), rendered)).rejects.toThrow('Public authority changed');
    });
    it.each(['disable', 'unassign', 'remove-language-body'])(
        'rejects default product metadata after the real SQL catalog changes: %s',
        async action => {
            const rendered = await publicSeo.enrich(context(), 'store-1.test', page(context()));
            expect(rendered.seo).toMatchObject({ indexable: true, documentVersion: 0 });
            await expect(publicSeo.assertOutput(context(), rendered)).resolves.toBeUndefined();
            if (action === 'disable')
                await data.getRepository(Product).update({ id: 10 }, { enabled: false });
            else if (action === 'unassign') await data.getRepository(Product).save({ id: 10, channels: [] });
            else
                await data
                    .getRepository(ProductTranslation)
                    .createQueryBuilder()
                    .update()
                    .set({ description: '' })
                    .where('baseId = :id AND languageCode = :code', { id: 10, code: LanguageCode.en })
                    .execute();
            await expect(publicSeo.assertOutput(context(), rendered)).rejects.toBeInstanceOf(
                action === 'remove-language-body' ? ServiceUnavailableException : NotFoundException,
            );
        },
    );
});
