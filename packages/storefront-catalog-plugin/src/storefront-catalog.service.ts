import { Injectable } from '@nestjs/common';
import {
    OrderLine,
    Product,
    ProductService,
    ProductVariant,
    RequestContext,
    SearchIndexItem,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { Brackets, SelectQueryBuilder } from 'typeorm';

import { NormalizedStorefrontCatalogInput, StorefrontCatalogInput, StorefrontCatalogSort } from './types';

export const STOREFRONT_CATALOG_DEFAULT_TAKE = 12;
export const STOREFRONT_CATALOG_MAX_TAKE = 48;

interface CatalogRow {
    productId: string | number;
}

export function normalizeCatalogInput(input: StorefrontCatalogInput): NormalizedStorefrontCatalogInput {
    const skip = Math.max(0, Math.trunc(input.skip ?? 0));
    const take = Math.min(
        STOREFRONT_CATALOG_MAX_TAKE,
        Math.max(1, Math.trunc(input.take ?? STOREFRONT_CATALOG_DEFAULT_TAKE)),
    );
    const minPriceWithTax = normalizePrice(input.minPriceWithTax);
    const maxPriceWithTax = normalizePrice(input.maxPriceWithTax);
    if (minPriceWithTax != null && maxPriceWithTax != null && minPriceWithTax > maxPriceWithTax) {
        throw new UserInputError('最低价格不能高于最高价格');
    }
    const term = input.term?.trim().slice(0, 200);

    return {
        ...(term ? { term } : {}),
        ...(input.collectionId != null ? { collectionId: input.collectionId } : {}),
        sort: input.sort ?? 'RECOMMENDED',
        ...(input.fulfillmentType ? { fulfillmentType: input.fulfillmentType } : {}),
        inStockOnly: input.inStockOnly === true,
        ...(minPriceWithTax != null ? { minPriceWithTax } : {}),
        ...(maxPriceWithTax != null ? { maxPriceWithTax } : {}),
        skip,
        take,
    };
}

function normalizePrice(value: number | null | undefined): number | undefined {
    if (value == null) return;
    if (!Number.isFinite(value) || value < 0) {
        throw new UserInputError('价格必须是非负整数');
    }
    return Math.trunc(value);
}

@Injectable()
export class StorefrontCatalogService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly productService: ProductService,
    ) {}

    async find(ctx: RequestContext, rawInput: StorefrontCatalogInput) {
        const input = normalizeCatalogInput(rawInput);
        const candidates = this.createCandidateQuery(ctx, input);
        const countQuery = this.connection.rawConnection
            .createQueryBuilder()
            .select('COUNT(*)', 'totalItems')
            .from(`(${candidates.getQuery()})`, 'catalog_candidates')
            .setParameters(candidates.getParameters());
        const pageQuery = candidates.clone().offset(input.skip).limit(input.take);

        const [countRow, rows] = await Promise.all([
            countQuery.getRawOne<Record<string, string | number>>(),
            pageQuery.getRawMany<CatalogRow>(),
        ]);
        const productIds = rows.map(row => row.productId);
        if (productIds.length === 0) {
            return {
                items: [],
                totalItems: Number(countRow?.totalItems ?? 0),
            };
        }
        const products = await this.productService.findByIds(ctx, productIds);
        const productsById = new Map(products.map(product => [String(product.id), product]));

        return {
            items: productIds.flatMap(id => {
                const product = productsById.get(String(id));
                return product ? [product] : [];
            }),
            totalItems: Number(countRow?.totalItems ?? 0),
        };
    }

    private createCandidateQuery(
        ctx: RequestContext,
        input: NormalizedStorefrontCatalogInput,
    ): SelectQueryBuilder<SearchIndexItem> {
        const qb = this.connection
            .getRepository(ctx, SearchIndexItem)
            .createQueryBuilder('si')
            .innerJoin(Product, 'catalog_product', 'catalog_product.id = si.productId')
            .select('si.productId', 'productId')
            .addSelect('MIN(si.priceWithTax)', 'minimumPriceWithTax')
            .addSelect('MIN(si.productName)', 'catalogProductName')
            .addSelect('catalog_product.createdAt', 'catalogCreatedAt')
            .where('si.channelId = :catalogChannelId', { catalogChannelId: ctx.channelId })
            .andWhere('si.languageCode = :catalogLanguageCode', {
                catalogLanguageCode: ctx.languageCode,
            })
            .andWhere('si.enabled = :catalogEnabled', { catalogEnabled: true })
            .andWhere('catalog_product.deletedAt IS NULL')
            .groupBy('si.productId')
            .addGroupBy('catalog_product.createdAt');

        if (input.term) {
            qb.andWhere(
                new Brackets(termQb => {
                    termQb
                        .where('LOWER(si.sku) LIKE :catalogTerm')
                        .orWhere('LOWER(si.productName) LIKE :catalogTerm')
                        .orWhere('LOWER(si.productVariantName) LIKE :catalogTerm')
                        .orWhere('LOWER(si.description) LIKE :catalogTerm');
                }),
                { catalogTerm: `%${input.term.toLocaleLowerCase()}%` },
            );
        }

        if (input.collectionId != null || input.fulfillmentType != null) {
            qb.innerJoin(ProductVariant, 'catalog_variant', 'catalog_variant.id = si.productVariantId');
        }
        if (input.collectionId != null) {
            qb.innerJoin(
                'catalog_variant.collections',
                'catalog_collection',
                'catalog_collection.id = :catalogCollectionId',
                { catalogCollectionId: input.collectionId },
            );
        }
        if (input.fulfillmentType != null) {
            const fulfillmentColumn = this.connection.rawConnection
                .getMetadata(ProductVariant)
                .columns.find(column => column.propertyPath === 'customFields.fulfillmentType');
            if (!fulfillmentColumn) {
                throw new UserInputError('商品交付类型尚未配置');
            }
            const escapedColumn = this.connection.rawConnection.driver.escape(fulfillmentColumn.databaseName);
            qb.andWhere(`catalog_variant.${escapedColumn} = :catalogFulfillmentType`, {
                catalogFulfillmentType: input.fulfillmentType.toLocaleLowerCase(),
            });
        }
        if (input.inStockOnly) {
            qb.andWhere('si.inStock = :catalogInStock', { catalogInStock: true });
        }
        if (input.minPriceWithTax != null) {
            qb.having('MIN(si.priceWithTax) >= :catalogMinPriceWithTax', {
                catalogMinPriceWithTax: input.minPriceWithTax,
            });
        }
        if (input.maxPriceWithTax != null) {
            const havingMethod = input.minPriceWithTax != null ? 'andHaving' : 'having';
            qb[havingMethod]('MIN(si.priceWithTax) <= :catalogMaxPriceWithTax', {
                catalogMaxPriceWithTax: input.maxPriceWithTax,
            });
        }

        if (input.sort === 'SALES') {
            this.addSalesSort(qb, ctx);
        } else {
            this.addStandardSort(qb, input.sort);
        }
        qb.addOrderBy('si.productId', 'ASC');
        return qb;
    }

    private addSalesSort(qb: SelectQueryBuilder<SearchIndexItem>, ctx: RequestContext): void {
        const salesExpression =
            'COALESCE(SUM(CASE WHEN catalog_sales_order.id IS NOT NULL AND catalog_sales_channel.id IS NOT NULL THEN catalog_sales_line.quantity ELSE 0 END), 0)';
        qb.leftJoin(
            OrderLine,
            'catalog_sales_line',
            'catalog_sales_line.productVariantId = si.productVariantId',
        )
            .leftJoin(
                'catalog_sales_line.order',
                'catalog_sales_order',
                'catalog_sales_order.orderPlacedAt IS NOT NULL AND catalog_sales_order.state != :catalogCancelledState',
                { catalogCancelledState: 'Cancelled' },
            )
            .leftJoin(
                'catalog_sales_order.channels',
                'catalog_sales_channel',
                'catalog_sales_channel.id = :catalogSalesChannelId',
                { catalogSalesChannelId: ctx.channelId },
            )
            .addSelect(salesExpression, 'catalogSales')
            .addOrderBy(salesExpression, 'DESC')
            .addOrderBy('catalog_product.createdAt', 'DESC');
    }

    private addStandardSort(qb: SelectQueryBuilder<SearchIndexItem>, sort: StorefrontCatalogSort): void {
        if (sort === 'NEWEST') {
            qb.addOrderBy('catalog_product.createdAt', 'DESC');
        } else if (sort === 'PRICE_ASC') {
            qb.addOrderBy('minimumPriceWithTax', 'ASC');
        } else if (sort === 'PRICE_DESC') {
            qb.addOrderBy('minimumPriceWithTax', 'DESC');
        } else {
            qb.addOrderBy('catalogProductName', 'ASC');
        }
    }
}
