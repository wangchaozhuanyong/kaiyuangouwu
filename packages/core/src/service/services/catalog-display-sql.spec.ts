import 'reflect-metadata';
import { DataSource, EntitySchema } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { RequestContext } from '../../api/common/request-context';
import { RequestContextCacheService } from '../../cache/request-context-cache.service';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';

import { CollectionService } from './collection.service';
import { ProductVariantService } from './product-variant.service';

// A real SQL driver verifies the batching joins/association reconstruction without
// booting a server, touching a store database, or depending on production secrets.
const id = { type: String, primary: true } as const;
const channel = new EntitySchema({ name: 'DisplayChannel', columns: { id } });
const product = new EntitySchema({ name: 'DisplayProduct', columns: { id } });
const tax = new EntitySchema({ name: 'DisplayTax', columns: { id } });
const variant = new EntitySchema<any>({
    name: 'DisplayVariant',
    columns: {
        id,
        productId: { type: String },
        taxCategoryId: { type: String },
        enabled: { type: Boolean },
        deletedAt: { type: Date, nullable: true },
    },
    relations: {
        product: { type: 'many-to-one', target: 'DisplayProduct', joinColumn: { name: 'productId' } },
        taxCategory: { type: 'many-to-one', target: 'DisplayTax', joinColumn: { name: 'taxCategoryId' } },
        channels: { type: 'many-to-many', target: 'DisplayChannel', joinTable: true },
        collections: {
            type: 'many-to-many',
            target: 'DisplayCollection',
            inverseSide: 'productVariants',
            joinTable: true,
        },
    },
});
const collection = new EntitySchema<any>({
    name: 'DisplayCollection',
    columns: { id, isPrivate: { type: Boolean } },
    relations: {
        channels: { type: 'many-to-many', target: 'DisplayChannel', joinTable: true },
        productVariants: { type: 'many-to-many', target: 'DisplayVariant', inverseSide: 'collections' },
        translations: { type: 'one-to-many', target: 'DisplayTranslation', inverseSide: 'base' },
    },
});
const translation = new EntitySchema<any>({
    name: 'DisplayTranslation',
    columns: { id, name: { type: String } },
    relations: { base: { type: 'many-to-one', target: 'DisplayCollection', joinColumn: true } },
});

describe('catalog display SQL batches', () => {
    it.each([
        'customFields.cfRelatedProducts.featuredAsset',
        'product.customFields.cfRelatedProducts.featuredAsset',
    ])('hydrates relation-only embedded custom fields and nested assets for %s', async relationPath => {
        const relatedAsset = new EntitySchema({ name: 'RelationAsset', columns: { id } });
        const relatedProduct = new EntitySchema({
            name: 'RelationRelatedProduct',
            columns: { id, featuredAssetId: { type: String } },
            relations: {
                featuredAsset: {
                    type: 'many-to-one',
                    target: 'RelationAsset',
                    joinColumn: { name: 'featuredAssetId' },
                },
            },
        });
        const relatedProducts = {
            type: 'many-to-many',
            target: 'RelationRelatedProduct',
            joinTable: true,
        } as const;
        const productFields = new EntitySchema({
            name: 'RelationProductFields',
            columns: {},
            relations: { cfRelatedProducts: relatedProducts },
        });
        const variantFields = new EntitySchema({
            name: 'RelationVariantFields',
            columns: {},
            relations: { cfRelatedProducts: relatedProducts },
        });
        const relationProduct = new EntitySchema({
            name: 'RelationProduct',
            columns: { id },
            embeddeds: { customFields: { schema: productFields } },
        });
        const relationVariant = new EntitySchema({
            name: 'RelationVariant',
            columns: {
                id,
                productId: { type: String },
                taxCategoryId: { type: String },
                enabled: { type: Boolean },
                deletedAt: { type: Date, nullable: true },
            },
            embeddeds: { customFields: { schema: variantFields } },
            relations: {
                product: {
                    type: 'many-to-one',
                    target: 'RelationProduct',
                    joinColumn: { name: 'productId' },
                },
                taxCategory: {
                    type: 'many-to-one',
                    target: 'DisplayTax',
                    joinColumn: { name: 'taxCategoryId' },
                },
                channels: { type: 'many-to-many', target: 'DisplayChannel', joinTable: true },
            },
        });
        const db = await new DataSource({
            type: 'sqljs',
            entities: [channel, tax, relatedAsset, relatedProduct, relationProduct, relationVariant],
            synchronize: true,
        }).initialize();
        try {
            await db.getRepository(channel).insert([{ id: 'A' }, { id: 'B' }]);
            await db.getRepository(tax).insert({ id: 'tax' });
            await db.getRepository(relatedAsset).insert({ id: 'asset' });
            await db.getRepository(relatedProduct).insert({ id: 'related', featuredAssetId: 'asset' });
            await db.getRepository(relationProduct).insert([{ id: 'p1' }, { id: 'p2' }]);
            await db.getRepository(relationVariant).insert([
                { id: 'v2', productId: 'p1', taxCategoryId: 'tax', enabled: true },
                { id: 'v1', productId: 'p1', taxCategoryId: 'tax', enabled: true },
                { id: 'v3', productId: 'p2', taxCategoryId: 'tax', enabled: true },
            ]);
            for (const variantId of ['v1', 'v2', 'v3']) {
                await db
                    .createQueryBuilder()
                    .relation(relationVariant, 'channels')
                    .of(variantId)
                    .add(variantId === 'v3' ? 'B' : 'A');
                await db
                    .createQueryBuilder()
                    .relation(relationVariant, 'customFields.cfRelatedProducts')
                    .of(variantId)
                    .add('related');
            }
            for (const productId of ['p1', 'p2']) {
                await db
                    .createQueryBuilder()
                    .relation(relationProduct, 'customFields.cfRelatedProducts')
                    .of(productId)
                    .add('related');
            }
            const service = Object.assign(Object.create(ProductVariantService.prototype), {
                connection: { getRepository: () => db.getRepository(relationVariant) },
                requestCache: new RequestContextCacheService(),
                configService: { apiOptions: { shopListQueryLimit: 100, adminListQueryLimit: 1000 } },
                applyChannelPriceAndTax: (value: ProductVariant) => Promise.resolve(value),
                translator: { translate: (value: unknown) => value },
            }) as ProductVariantService;
            const ctx = {
                apiType: 'shop',
                channelId: 'A',
                languageCode: 'en',
                currencyCode: 'USD',
            } as RequestContext;
            const [visible, foreign] = await Promise.all([
                service.getVariantsForProduct(ctx, 'p1', [relationPath]),
                service.getVariantsForProduct(ctx, 'p2', [relationPath]),
            ]);
            expect(visible.map(value => value.id)).toEqual(['v1', 'v2']);
            expect(foreign).toEqual([]);
            const customFields = { cfRelatedProducts: [{ id: 'related', featuredAsset: { id: 'asset' } }] };
            for (const row of visible) {
                expect(row).toMatchObject(
                    relationPath.startsWith('product.') ? { product: { customFields } } : { customFields },
                );
            }
        } finally {
            await db.destroy();
        }
    });

    it('12 and 48 products with three variants use equal SELECT counts and return only the active public collections', async () => {
        const queries: string[] = [];
        const db = await new DataSource({
            type: 'sqljs',
            entities: [channel, product, tax, variant, collection, translation],
            synchronize: true,
            logger: {
                logQuery: query => {
                    if (query.startsWith('SELECT')) queries.push(query);
                },
                logQueryError: () => undefined,
                logQuerySlow: () => undefined,
                logSchemaBuild: () => undefined,
                logMigration: () => undefined,
                log: () => undefined,
            },
            logging: ['query'],
        }).initialize();
        try {
            const productIds = Array.from(
                { length: 48 },
                (_, index) => `p${index.toString().padStart(2, '0')}`,
            );
            const variants = productIds.flatMap(productId =>
                [0, 1, 2].map(index => ({
                    id: `${productId}v${index}`,
                    productId,
                    taxCategoryId: 'tax',
                    enabled: true,
                })),
            );
            await db.getRepository(channel).insert([{ id: 'A' }, { id: 'B' }]);
            await db.getRepository(tax).insert({ id: 'tax' });
            await db.getRepository(product).insert(productIds.map(value => ({ id: value })));
            await db.getRepository(variant).insert(variants);
            for (const row of variants)
                await db.createQueryBuilder().relation(variant, 'channels').of(row.id).add('A');
            await db.getRepository(collection).insert([
                { id: 'public-a', isPrivate: false },
                { id: 'private-a', isPrivate: true },
                { id: 'public-b', isPrivate: false },
            ]);
            for (const collectionId of ['public-a', 'private-a', 'public-b']) {
                await db
                    .createQueryBuilder()
                    .relation(collection, 'channels')
                    .of(collectionId)
                    .add(collectionId === 'public-b' ? 'B' : 'A');
                await db
                    .createQueryBuilder()
                    .relation(collection, 'productVariants')
                    .of(collectionId)
                    .add(variants.map(row => row.id));
                await db
                    .getRepository(translation)
                    .save({ id: `name-${collectionId}`, name: collectionId, base: { id: collectionId } });
            }
            const connection = {
                getRepository: (_ctx: unknown, entity: unknown) =>
                    db.getRepository(entity === ProductVariant ? variant : collection),
            };
            const cache = new RequestContextCacheService();
            const variantsService = Object.assign(Object.create(ProductVariantService.prototype), {
                connection,
                requestCache: cache,
                configService: { apiOptions: { shopListQueryLimit: 100, adminListQueryLimit: 1000 } },
                applyChannelPriceAndTax: (value: unknown) => Promise.resolve(value),
                translator: { translate: (value: unknown) => value },
            }) as ProductVariantService;
            const collectionsService = Object.assign(Object.create(CollectionService.prototype), {
                connection,
                requestCache: cache,
                translator: { translate: (value: unknown) => value },
            }) as CollectionService;
            const counts: number[] = [];
            for (const size of [12, 48]) {
                queries.length = 0;
                const ctx = {
                    apiType: 'shop',
                    channelId: 'A',
                    languageCode: 'en',
                    currencyCode: 'USD',
                } as RequestContext;
                const result = await Promise.all(
                    productIds.slice(0, size).map(async productId => ({
                        variants: await variantsService.getVariantsForProduct(ctx, productId, []),
                        collections: await collectionsService.getCollectionsByProductId(ctx, productId, true),
                    })),
                );
                expect(result.every(row => row.variants.length === 3)).toBe(true);
                expect(result.map(row => row.collections.map(item => item.id))).toEqual(
                    Array.from({ length: size }, () => ['public-a']),
                );
                counts.push(queries.length);
            }
            expect(counts[0]).toBeGreaterThan(0);
            expect(counts).toEqual([4, 4]);
            expect(counts[0]).toBeLessThanOrEqual(8);
        } finally {
            await db.destroy();
        }
    });
});
