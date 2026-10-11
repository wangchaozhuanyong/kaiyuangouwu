import 'reflect-metadata';

import { LanguageCode } from '@vendure/common/lib/generated-types';
import { Channel, Product, ProductVariant, SearchIndexItem } from '@vendure/core';
import { createRequire } from 'node:module';
import { DataSource, EntitySchema, In } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

// The workspace's Node type declarations predate node:sqlite, while CI runs Node 24.
const { DatabaseSync } = createRequire(`${process.cwd()}/package.json`)('node:sqlite') as {
    DatabaseSync: new (filename: string) => {
        exec(sql: string): void;
        prepare(sql: string): { get(params: Record<string, unknown>): unknown };
        close(): void;
    };
};

import {
    normalizeCatalogInput,
    STOREFRONT_CATALOG_DEFAULT_TAKE,
    STOREFRONT_CATALOG_MAX_TAKE,
    StorefrontCatalogService,
} from './storefront-catalog.service';

function fluentQueryBuilder() {
    const queryBuilder: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of [
        'select',
        'addSelect',
        'from',
        'where',
        'andWhere',
        'innerJoin',
        'leftJoin',
        'groupBy',
        'addGroupBy',
        'having',
        'andHaving',
        'addOrderBy',
        'offset',
        'limit',
        'setParameters',
        'orderBy',
    ]) {
        queryBuilder[method] = vi.fn(() => queryBuilder);
    }
    queryBuilder.getQuery = vi.fn(() => 'SELECT productId FROM candidates');
    queryBuilder.getParameters = vi.fn(() => ({ channel: 'channel-1' }));
    queryBuilder.clone = vi.fn(() => queryBuilder);
    queryBuilder.getRawMany = vi.fn().mockResolvedValue([]);
    queryBuilder.getRawOne = vi.fn().mockResolvedValue({ totalItems: 0 });
    return queryBuilder;
}

function createCatalogService(queryBuilder = fluentQueryBuilder()) {
    const countBuilder = fluentQueryBuilder();
    const rawConnection = {
        createQueryBuilder: vi.fn(() => countBuilder),
        getMetadata: vi.fn(() => ({
            columns: [
                { propertyPath: 'customFields.fulfillmentType', databaseName: 'fulfillmentType' },
                { propertyPath: 'customFields.digitalDeliveryMode', databaseName: 'digitalDeliveryMode' },
            ],
        })),
        driver: { escape: (value: string) => `"${value}"` },
    };
    const connection = {
        rawConnection,
        getRepository: vi.fn(() => ({ createQueryBuilder: () => queryBuilder })),
    };
    const productService = { findByIds: vi.fn().mockResolvedValue([]) };
    const variantService = { findByIds: vi.fn().mockResolvedValue([]) };
    return {
        service: new StorefrontCatalogService(
            connection as any,
            productService as any,
            variantService as any,
        ),
        queryBuilder,
        countBuilder,
        productService,
        variantService,
    };
}

describe('normalizeCatalogInput', () => {
    it('applies bounded paging defaults and trims the search term', () => {
        expect(normalizeCatalogInput({ term: '  tea  ', take: 500, skip: -10 })).toMatchObject({
            term: 'tea',
            take: STOREFRONT_CATALOG_MAX_TAKE,
            skip: 0,
            sort: 'RECOMMENDED',
            inStockOnly: false,
        });
        expect(normalizeCatalogInput({}).take).toBe(STOREFRONT_CATALOG_DEFAULT_TAKE);
    });

    it('uses integer minor currency units and rejects an inverted range', () => {
        expect(normalizeCatalogInput({ minPriceWithTax: 100.9 }).minPriceWithTax).toBe(100);
        expect(() => normalizeCatalogInput({ minPriceWithTax: 200, maxPriceWithTax: 100 })).toThrow(
            /最低价格/,
        );
        expect(() => normalizeCatalogInput({ minPriceWithTax: -1 })).toThrow(/非负整数/);
    });
});

describe('StorefrontCatalogService query construction', () => {
    const context = {
        channelId: 'channel-1',
        languageCode: 'zh_Hans',
        currencyCode: 'CNY',
        channel: { defaultCurrencyCode: 'CNY', customFields: {} },
    } as any;

    it('filters tax-exclusive converted request prices before computing the total and page', async () => {
        const { service, queryBuilder, variantService, productService } = createCatalogService();
        queryBuilder.getRawMany
            .mockResolvedValueOnce([{ productId: 'p1' }, { productId: 'p2' }])
            .mockResolvedValueOnce([
                { variantId: 'v1', productId: 'p1' },
                { variantId: 'v2', productId: 'p2' },
            ]);
        variantService.findByIds.mockResolvedValue([
            { id: 'v1', productId: 'p1', priceWithTax: 100 },
            { id: 'v2', productId: 'p2', priceWithTax: 200 },
        ]);
        productService.findByIds.mockResolvedValue([{ id: 'p1' }]);
        const ctx = {
            ...context,
            currencyCode: 'MYR',
            channel: {
                ...context.channel,
                pricesIncludeTax: false,
                defaultTaxZone: { id: 'tax-zone' },
                customFields: { cnyToMyrRate: 0.53, currencyRoundingMode: 'WHOLE' },
            },
        };
        const result = await service.find(ctx, { maxPriceWithTax: 100, take: 1, sort: 'PRICE_ASC' });
        expect(result).toEqual({ totalItems: 1, items: [{ id: 'p1' }] });
        expect(variantService.findByIds).toHaveBeenCalledWith(ctx, ['v1', 'v2']);
        expect(queryBuilder.having).not.toHaveBeenCalled();
        expect(queryBuilder.limit).not.toHaveBeenCalled();
        expect(productService.findByIds).toHaveBeenCalledWith(ctx, ['p1']);
    });

    it('applies Channel, language, collection, fulfillment, stock and price filters on the server', () => {
        const { service, queryBuilder } = createCatalogService();
        (service as any).createCandidateQuery(
            context,
            normalizeCatalogInput({
                term: 'tea',
                collectionId: 'collection-1',
                fulfillmentType: 'DIGITAL',
                inStockOnly: true,
                minPriceWithTax: 100,
                maxPriceWithTax: 500,
                sort: 'NAME',
            }),
        );

        expect(queryBuilder.where).toHaveBeenCalledWith('si.channelId = :catalogChannelId', {
            catalogChannelId: 'channel-1',
        });
        expect(queryBuilder.andWhere).toHaveBeenCalledWith('si.languageCode = :catalogLanguageCode', {
            catalogLanguageCode: 'zh_Hans',
        });
        const stockCondition = queryBuilder.andWhere.mock.calls.find(
            ([condition]) => typeof condition === 'string' && condition.startsWith('CASE WHEN'),
        );
        expect(stockCondition).toBeDefined();
        expect(stockCondition?.[0]).toContain('catalog_variant."digitalDeliveryMode" = :catalogAutoCardMode');
        expect(stockCondition?.[0]).toContain('catalog_card_item.state = :catalogAvailableCardState');
        expect(stockCondition?.[0]).toContain('ELSE si.inStock END');
        expect(stockCondition?.[1]).toMatchObject({
            catalogAutoCardMode: 'auto_card',
            catalogAvailableCardState: 'AVAILABLE',
        });
        expect(queryBuilder.innerJoin).toHaveBeenCalledWith(
            'catalog_variant.collections',
            'catalog_collection',
            'catalog_collection.id = :catalogCollectionId',
            { catalogCollectionId: 'collection-1' },
        );
        expect(queryBuilder.andWhere).toHaveBeenCalledWith(
            'catalog_variant."fulfillmentType" = :catalogFulfillmentType',
            { catalogFulfillmentType: 'digital' },
        );
        expect(queryBuilder.having).toHaveBeenCalledWith('MIN(si.priceWithTax) >= :catalogMinPriceWithTax', {
            catalogMinPriceWithTax: 100,
        });
        expect(queryBuilder.andHaving).toHaveBeenCalledWith(
            'MIN(si.priceWithTax) <= :catalogMaxPriceWithTax',
            { catalogMaxPriceWithTax: 500 },
        );
    });

    it.each([
        ['RECOMMENDED', 'catalogProductName', 'ASC'],
        ['NAME', 'catalogProductName', 'ASC'],
        ['NEWEST', 'catalog_product.createdAt', 'DESC'],
        ['PRICE_ASC', 'minimumPriceWithTax', 'ASC'],
        ['PRICE_DESC', 'minimumPriceWithTax', 'DESC'],
    ] as const)('uses stable %s ordering', (sort, expression, direction) => {
        const { service, queryBuilder } = createCatalogService();
        (service as any).createCandidateQuery(context, normalizeCatalogInput({ sort }));

        expect(queryBuilder.addOrderBy).toHaveBeenCalledWith(expression, direction);
        expect(queryBuilder.addOrderBy).toHaveBeenLastCalledWith('si.productId', 'ASC');
    });

    it('uses live channel-scoped card stock while retaining indexed stock for other delivery modes', () => {
        const { service, queryBuilder } = createCatalogService();
        (service as any).createCandidateQuery(context, normalizeCatalogInput({ inStockOnly: true }));
        const [condition, values] =
            queryBuilder.andWhere.mock.calls.find(
                ([clause]) => typeof clause === 'string' && clause.startsWith('CASE WHEN'),
            ) ?? [];
        expect(condition).toBeDefined();

        const db = new DatabaseSync(':memory:');
        try {
            db.exec(`
                CREATE TABLE auto_card_config (id INTEGER, channelId TEXT, productVariantId TEXT, enabled INTEGER);
                CREATE TABLE auto_card_pool_item (configId INTEGER, state TEXT);
            `);
            const query = db.prepare(`
                SELECT ${condition} AS included
                FROM (SELECT :searchInStock AS inStock, :variantId AS productVariantId) si
                CROSS JOIN (
                    SELECT :fulfillmentType AS fulfillmentType, :deliveryMode AS digitalDeliveryMode
                ) catalog_variant
            `);
            const included = (
                options: {
                    channelId?: string;
                    deliveryMode?: string | null;
                    fulfillmentType?: string | null;
                    searchInStock?: number;
                } = {},
            ) =>
                Number(
                    (
                        query.get({
                            ...values,
                            catalogCardConfigEnabled: 1,
                            catalogChannelId: options.channelId ?? 'channel-1',
                            searchInStock: options.searchInStock ?? 1,
                            variantId: 'variant-1',
                            fulfillmentType: options.fulfillmentType ?? 'digital',
                            deliveryMode:
                                options.deliveryMode === undefined ? 'auto_card' : options.deliveryMode,
                        }) as { included: number }
                    ).included,
                );

            expect(included()).toBe(0);
            expect(included({ deliveryMode: 'manual_service' })).toBe(1);
            expect(included({ deliveryMode: null })).toBe(1);
            expect(included({ deliveryMode: 'manual_service', searchInStock: 0 })).toBe(0);

            db.exec(`
                INSERT INTO auto_card_config VALUES (1, 'channel-1', 'variant-1', 1);
                INSERT INTO auto_card_pool_item VALUES (1, 'AVAILABLE');
            `);
            expect(included()).toBe(1);
            expect(included({ channelId: 'channel-2' })).toBe(0);
            db.exec(`UPDATE auto_card_pool_item SET state = 'ASSIGNED' WHERE configId = 1`);
            expect(included()).toBe(0);
        } finally {
            db.close();
        }
    });

    it('limits sales to placed, non-cancelled orders in the current Channel with stable fallbacks', () => {
        const { service, queryBuilder } = createCatalogService();
        (service as any).createCandidateQuery(context, normalizeCatalogInput({ sort: 'SALES' }));

        expect(queryBuilder.leftJoin).toHaveBeenCalledWith(
            'catalog_sales_order.channels',
            'catalog_sales_channel',
            'catalog_sales_channel.id = :catalogSalesChannelId',
            { catalogSalesChannelId: 'channel-1' },
        );
        expect(queryBuilder.leftJoin).toHaveBeenCalledWith(
            'catalog_sales_line.order',
            'catalog_sales_order',
            'catalog_sales_order.orderPlacedAt IS NOT NULL AND catalog_sales_order.state != :catalogCancelledState',
            { catalogCancelledState: 'Cancelled' },
        );
        expect(queryBuilder.addOrderBy).toHaveBeenCalledWith('catalog_product.createdAt', 'DESC');
        expect(queryBuilder.addOrderBy).toHaveBeenLastCalledWith('si.productId', 'ASC');
    });

    it('paginates candidates, reports the full total and restores server order after hydration', async () => {
        const candidates = fluentQueryBuilder();
        candidates.getRawMany.mockResolvedValue([{ productId: '2' }, { productId: '1' }]);
        const { service, countBuilder, productService } = createCatalogService(candidates);
        countBuilder.getRawOne.mockResolvedValue({ totalItems: '9' });
        productService.findByIds.mockResolvedValue([{ id: '1' }, { id: '2' }]);
        vi.spyOn(service as any, 'createCandidateQuery').mockReturnValue(candidates);

        await expect(service.find(context, { skip: 3, take: 2, sort: 'NEWEST' })).resolves.toEqual({
            items: [{ id: '2' }, { id: '1' }],
            totalItems: 9,
        });
        expect(candidates.offset).toHaveBeenCalledWith(3);
        expect(candidates.limit).toHaveBeenCalledWith(2);
        expect(productService.findByIds).toHaveBeenCalledWith(context, ['2', '1']);
    });

    it('does not hydrate an empty result set', async () => {
        const candidates = fluentQueryBuilder();
        const { service, countBuilder, productService } = createCatalogService(candidates);
        countBuilder.getRawOne.mockResolvedValue({ totalItems: '0' });
        vi.spyOn(service as any, 'createCandidateQuery').mockReturnValue(candidates);

        await expect(
            service.find(context, {
                collectionId: 'collection-1',
                fulfillmentType: 'DIGITAL',
            }),
        ).resolves.toEqual({ items: [], totalItems: 0 });
        expect(productService.findByIds).not.toHaveBeenCalled();
    });
});

it('uses live product and SKU channel/deletion/enable SQL joins before count and paging', async () => {
    const db = await new DataSource({
        type: 'sqljs',
        synchronize: true,
        entities: [
            new EntitySchema<Channel>({
                name: 'Channel',
                target: Channel,
                columns: { id: { type: String, primary: true } },
            }),
            new EntitySchema<Product>({
                name: 'Product',
                target: Product,
                columns: {
                    id: { type: String, primary: true },
                    enabled: { type: Boolean },
                    deletedAt: { type: Date, nullable: true },
                    createdAt: { type: Date },
                },
                relations: { channels: { type: 'many-to-many', target: 'Channel', joinTable: true } },
            }),
            new EntitySchema<ProductVariant>({
                name: 'ProductVariant',
                target: ProductVariant,
                columns: {
                    id: { type: String, primary: true },
                    enabled: { type: Boolean },
                    deletedAt: { type: Date, nullable: true },
                },
                relations: { channels: { type: 'many-to-many', target: 'Channel', joinTable: true } },
            }),
            new EntitySchema<SearchIndexItem & { id: number }>({
                name: 'SearchIndexItem',
                target: SearchIndexItem,
                columns: {
                    id: { type: Number, primary: true },
                    productId: { type: String },
                    productVariantId: { type: String },
                    priceWithTax: { type: Number },
                    productName: { type: String },
                    enabled: { type: Boolean },
                    channelId: { type: String },
                    languageCode: { type: String },
                },
            }),
        ],
    }).initialize();
    try {
        await db.getRepository(Channel).save([{ id: 'a' }, { id: 'b' }]);
        const createdAt = new Date('2026-10-11T00:00:00Z');
        await db.getRepository(Product).save(
            Array.from({ length: 8 }, (_, index) => ({
                id: `p${index + 1}`,
                enabled: index !== 1,
                deletedAt: index === 2 ? createdAt : null,
                createdAt,
                channels: [{ id: index === 3 ? 'b' : 'a' }],
            })),
        );
        await db.getRepository(ProductVariant).save(
            Array.from({ length: 8 }, (_, index) => ({
                id: `v${index + 1}`,
                enabled: index !== 4,
                deletedAt: index === 5 ? createdAt : null,
                channels: [{ id: index === 6 ? 'b' : 'a' }],
            })),
        );
        await db.getRepository(SearchIndexItem).save(
            Array.from({ length: 8 }, (_, index) => ({
                id: index + 1,
                productId: `p${index + 1}`,
                productVariantId: `v${index + 1}`,
                priceWithTax: index === 0 ? 0 : 250,
                productName: index === 0 ? 'Eligible A' : index === 7 ? 'Eligible B' : `Invalid ${index}`,
                enabled: true,
                channelId: 'a',
                languageCode: LanguageCode.en,
            })),
        );
        const service = new StorefrontCatalogService(
            {
                rawConnection: db,
                getRepository: (_ctx: unknown, entity: any) => db.getRepository(entity),
            } as never,
            {
                findByIds: (_ctx: unknown, ids: string[]) =>
                    db.getRepository(Product).findBy({ id: In(ids) }),
            } as never,
            {} as never,
        );
        const context = {
            channelId: 'a',
            languageCode: 'en',
            currencyCode: 'CNY',
            channel: { defaultCurrencyCode: 'CNY', customFields: {} },
        } as never;
        const first = await service.find(context, { take: 1, sort: 'NAME' });
        expect(first.totalItems).toBe(2);
        expect(first.items.map(product => String(product.id))).toEqual(['p1']);
        const second = await service.find(context, { skip: 1, take: 1, sort: 'NAME' });
        expect(second.totalItems).toBe(2);
        expect(second.items.map(product => String(product.id))).toEqual(['p8']);
        expect(await service.recommendationProductIds(context)).toEqual(['p1', 'p8']);
        // Restoring the same identity recovers its original query eligibility without deleting associations.
        await db.getRepository(Product).update({ id: 'p3' }, { deletedAt: null });
        const restored = await service.find(context, { take: 48, sort: 'NAME' });
        expect(restored.totalItems).toBe(3);
        expect(restored.items.map(product => String(product.id))).toContain('p3');
    } finally {
        await db.destroy();
    }
});
