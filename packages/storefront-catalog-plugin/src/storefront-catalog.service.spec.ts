import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

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
            columns: [{ propertyPath: 'customFields.fulfillmentType', databaseName: 'fulfillmentType' }],
        })),
        driver: { escape: (value: string) => `"${value}"` },
    };
    const connection = {
        rawConnection,
        getRepository: vi.fn(() => ({ createQueryBuilder: () => queryBuilder })),
    };
    const productService = { findByIds: vi.fn().mockResolvedValue([]) };
    return {
        service: new StorefrontCatalogService(connection as any, productService as any),
        queryBuilder,
        countBuilder,
        productService,
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
    const context = { channelId: 'channel-1', languageCode: 'zh_Hans' } as any;

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
        expect(queryBuilder.andWhere).toHaveBeenCalledWith('si.inStock = :catalogInStock', {
            catalogInStock: true,
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
});
