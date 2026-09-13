import 'reflect-metadata';

import { SortOrder } from '@vendure/common/lib/generated-types';
import { DataSource, EntitySchema } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ListQueryOptions } from '../../../common/types/common-types';
import { ConfigService } from '../../../config/config.service';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { VendureEntity } from '../../../entity/base/base.entity';

import { ListQueryBuilder } from './list-query-builder';

class CatalogProduct extends VendureEntity {
    name: string;
    enabled: boolean;
    variants: CatalogVariant[];
    channels: CatalogChannel[];
}
class CatalogVariant extends VendureEntity {
    sku: string;
    product: CatalogProduct;
    collections: CatalogCollection[];
}
class CatalogCollection extends VendureEntity {
    code: string;
    variants: CatalogVariant[];
}
class CatalogChannel extends VendureEntity {}

const idColumn = { type: Number, primary: true } as const;
const entities = [
    new EntitySchema<CatalogProduct>({
        name: 'CatalogProduct',
        target: CatalogProduct,
        columns: { id: idColumn, name: { type: String }, enabled: { type: Boolean } },
        relations: {
            variants: { type: 'one-to-many', target: 'CatalogVariant', inverseSide: 'product' },
            channels: { type: 'many-to-many', target: 'CatalogChannel', joinTable: true },
        },
    }),
    new EntitySchema<CatalogVariant>({
        name: 'CatalogVariant',
        target: CatalogVariant,
        columns: { id: idColumn, sku: { type: String } },
        relations: {
            product: { type: 'many-to-one', target: 'CatalogProduct', inverseSide: 'variants' },
            collections: {
                type: 'many-to-many',
                target: 'CatalogCollection',
                inverseSide: 'variants',
                joinTable: true,
            },
        },
    }),
    new EntitySchema<CatalogCollection>({
        name: 'CatalogCollection',
        target: CatalogCollection,
        columns: { id: idColumn, code: { type: String, name: 'catalog_code' } },
        relations: {
            variants: { type: 'many-to-many', target: 'CatalogVariant', inverseSide: 'collections' },
        },
    }),
    new EntitySchema<CatalogChannel>({
        name: 'CatalogChannel',
        target: CatalogChannel,
        columns: { id: idColumn },
    }),
];

describe('ListQueryBuilder nested catalog filters (real database)', () => {
    const db = new DataSource({ type: 'sqljs', entities, synchronize: true });
    let builder: ListQueryBuilder;

    beforeAll(async () => {
        await db.initialize();
        builder = new ListQueryBuilder(
            { rawConnection: db } as TransactionalConnection,
            {
                customFields: {},
                apiOptions: { shopListQueryLimit: 100, adminListQueryLimit: 100 },
            } as ConfigService,
        );
        await db.getRepository(CatalogChannel).save([{ id: 1 }, { id: 2 }]);
        await db.getRepository(CatalogCollection).save([
            { id: 10, code: 'A' },
            { id: 20, code: 'B' },
            { id: 30, code: 'empty' },
        ]);
        await db.getRepository(CatalogProduct).save([
            { id: 1, name: 'shared', enabled: true, channels: [{ id: 1 }] },
            { id: 2, name: 'only A', enabled: false, channels: [{ id: 1 }] },
            { id: 3, name: 'other store', enabled: true, channels: [{ id: 2 }] },
        ]);
        await db.getRepository(CatalogVariant).save([
            { id: 101, sku: 'A-1', product: { id: 1 }, collections: [{ id: 10 }] },
            { id: 102, sku: 'A-2', product: { id: 1 }, collections: [{ id: 10 }] },
            { id: 103, sku: 'B-1', product: { id: 1 }, collections: [{ id: 20 }] },
            { id: 201, sku: 'A-3', product: { id: 2 }, collections: [{ id: 10 }] },
            { id: 301, sku: 'B-2', product: { id: 3 }, collections: [{ id: 20 }] },
        ]);
    });

    afterAll(async () => {
        if (db.isInitialized) await db.destroy();
    });

    async function products(
        filter: object,
        options: { skip?: number; take?: number; channelId?: number } = {},
    ) {
        const [items, totalItems] = await builder
            .build(
                CatalogProduct,
                {
                    filter,
                    skip: options.skip,
                    take: options.take,
                    sort: { id: SortOrder.ASC },
                },
                {
                    channelId: options.channelId,
                    customPropertyMap: {
                        collectionId: 'variants.collections.id',
                        collectionCode: 'variants.collections.code',
                        sku: 'variants.sku',
                    },
                },
            )
            .getManyAndCount();
        return { ids: items.map(item => item.id), totalItems };
    }

    // Production acceptance: selecting a category must execute SQL instead of treating "collections" as a column.
    it('filters through variant collection membership and counts products once', async () => {
        expect(await products({ collectionId: { eq: 10 } })).toEqual({ ids: [1, 2], totalItems: 2 });
    });

    it('keeps pagination stable when multiple variants match the same category', async () => {
        expect(await products({ collectionId: { eq: 10 } }, { skip: 1, take: 1 })).toEqual({
            ids: [2],
            totalItems: 2,
        });
    });

    it('matches AND conditions satisfied by different variants of one product', async () => {
        expect(
            await products({ _and: [{ collectionId: { eq: 10 } }, { collectionId: { eq: 20 } }] }),
        ).toEqual({ ids: [1], totalItems: 1 });
    });

    it('combines nested OR category filters with product status', async () => {
        expect(
            await products({
                enabled: { eq: true },
                _or: [{ collectionId: { eq: 10 } }, { collectionId: { eq: 20 } }],
            }),
        ).toEqual({ ids: [1, 3], totalItems: 2 });
    });

    it('returns a real empty result for an empty category', async () => {
        expect(await products({ collectionId: { eq: 30 } })).toEqual({ ids: [], totalItems: 0 });
    });

    it('preserves the outer channel restriction', async () => {
        expect(await products({ collectionId: { eq: 20 } }, { channelId: 2 })).toEqual({
            ids: [3],
            totalItems: 1,
        });
    });

    it('resolves the terminal column using its database name', async () => {
        expect(await products({ collectionCode: { eq: 'B' } })).toEqual({ ids: [1, 3], totalItems: 2 });
    });

    it('handles an inverse many-to-many relation followed by a many-to-one relation', async () => {
        const [items, totalItems] = await builder
            .build(
                CatalogCollection,
                {
                    filter: { productId: { eq: 1 } },
                    sort: { id: SortOrder.ASC },
                } as ListQueryOptions<CatalogCollection>,
                { customPropertyMap: { productId: 'variants.product.id' } },
            )
            .getManyAndCount();
        expect(items.map(item => item.id)).toEqual([10, 20]);
        expect(totalItems).toBe(2);
    });

    it('keeps direct SKU filtering working', async () => {
        expect(await products({ sku: { eq: 'A-1' } })).toEqual({ ids: [1], totalItems: 1 });
    });
});
