import { Injectable } from '@nestjs/common';
import {
    OrderLine,
    Product,
    ProductService,
    ProductVariant,
    ProductVariantService,
    RequestContext,
    SearchIndexItem,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { isManagedCurrency } from '@vendure/store-management-plugin/currency-conversion';
import { Brackets, SelectQueryBuilder } from 'typeorm';

import { catalogPriceBounds } from './catalog-price-bounds';
import { NormalizedStorefrontCatalogInput, StorefrontCatalogInput, StorefrontCatalogSort } from './types';

export const STOREFRONT_CATALOG_DEFAULT_TAKE = 12;
export const STOREFRONT_CATALOG_MAX_TAKE = 48;

interface CatalogRow {
    productId: string | number;
    catalogQuoteOnly?: number | string;
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
        private readonly productVariantService: ProductVariantService,
    ) {}

    async find(ctx: RequestContext, rawInput: StorefrontCatalogInput) {
        const input = normalizeCatalogInput(rawInput);
        const crossCurrency =
            ctx.currencyCode !== ctx.channel.defaultCurrencyCode &&
            isManagedCurrency(ctx.currencyCode) &&
            isManagedCurrency(ctx.channel.defaultCurrencyCode);
        const priceQuery =
            input.minPriceWithTax != null ||
            input.maxPriceWithTax != null ||
            input.sort === 'PRICE_ASC' ||
            input.sort === 'PRICE_DESC';
        // Tax-exclusive prices convert before tax calculation. Reuse Vendure's actual
        // applicator instead of converting rounded tax-inclusive search amounts.
        if (crossCurrency && priceQuery && ctx.channel.defaultTaxZone && !ctx.channel.pricesIncludeTax) {
            return this.findWithRequestPrices(ctx, input);
        }
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

    private async findWithRequestPrices(ctx: RequestContext, input: NormalizedStorefrontCatalogInput) {
        const candidates = this.createCandidateQuery(ctx, input, false);
        const rows = await candidates.getRawMany<CatalogRow>();
        const variantRows = await candidates
            .clone()
            .select('si.productVariantId', 'variantId')
            .addSelect('si.productId', 'productId')
            .groupBy('si.productVariantId')
            .addGroupBy('si.productId')
            .orderBy()
            .getRawMany<{ variantId: string | number; productId: string | number }>();
        const prices = new Map<string, number>();
        for (let offset = 0; offset < variantRows.length; offset += 100) {
            const variants = await this.productVariantService.findByIds(
                ctx,
                variantRows.slice(offset, offset + 100).map(row => row.variantId),
            );
            for (const variant of variants) {
                const id = String(variant.productId);
                prices.set(id, Math.min(prices.get(id) ?? Infinity, variant.priceWithTax));
            }
        }
        const matches = rows.flatMap(row => {
            const price = prices.get(String(row.productId));
            if (
                price == null ||
                (input.minPriceWithTax != null && price < input.minPriceWithTax) ||
                (input.maxPriceWithTax != null && price > input.maxPriceWithTax)
            )
                return [];
            return [{ ...row, requestPrice: price }];
        });
        if (input.sort === 'PRICE_ASC' || input.sort === 'PRICE_DESC') {
            const direction = input.sort === 'PRICE_ASC' ? 1 : -1;
            matches.sort(
                (left, right) =>
                    Number(left.catalogQuoteOnly ?? 0) - Number(right.catalogQuoteOnly ?? 0) ||
                    direction * (left.requestPrice - right.requestPrice),
            );
        }
        const ids = matches.slice(input.skip, input.skip + input.take).map(row => row.productId);
        const products = ids.length ? await this.productService.findByIds(ctx, ids) : [];
        const byId = new Map(products.map(product => [String(product.id), product]));
        return {
            totalItems: matches.length,
            items: ids.flatMap(id => {
                const product = byId.get(String(id));
                return product ? [product] : [];
            }),
        };
    }

    async recommendationProductIds(ctx: RequestContext): Promise<string[]> {
        const rows = await this.createCandidateQuery(ctx, normalizeCatalogInput({}))
            .andWhere('catalog_product.enabled = :recommendationsEnabled', { recommendationsEnabled: true })
            .getRawMany<CatalogRow>();
        return rows.map(row => String(row.productId));
    }

    private createCandidateQuery(
        ctx: RequestContext,
        input: NormalizedStorefrontCatalogInput,
        applyPriceBounds = true,
    ): SelectQueryBuilder<SearchIndexItem> {
        const convertCurrency =
            isManagedCurrency(ctx.channel.defaultCurrencyCode) && isManagedCurrency(ctx.currencyCode);
        const indexedCurrency = convertCurrency ? ctx.channel.defaultCurrencyCode : ctx.currencyCode;
        const prices =
            convertCurrency && applyPriceBounds
                ? catalogPriceBounds(ctx, input.minPriceWithTax, input.maxPriceWithTax)
                : { min: input.minPriceWithTax, max: input.maxPriceWithTax };
        const qb = this.connection
            .getRepository(ctx, SearchIndexItem)
            .createQueryBuilder('si')
            .innerJoin(Product, 'catalog_product', 'catalog_product.id = si.productId')
            .innerJoin(
                'catalog_product.channels',
                'catalog_product_channel',
                'catalog_product_channel.id = :catalogChannelId',
            )
            .innerJoin(ProductVariant, 'catalog_variant', 'catalog_variant.id = si.productVariantId')
            .innerJoin(
                'catalog_variant.channels',
                'catalog_variant_channel',
                'catalog_variant_channel.id = :catalogChannelId',
            )
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
            .andWhere('catalog_product.enabled = :catalogEnabled')
            .andWhere('catalog_variant.deletedAt IS NULL')
            .andWhere('catalog_variant.enabled = :catalogEnabled')
            .groupBy('si.productId')
            .addGroupBy('catalog_product.createdAt');
        if (
            this.connection.rawConnection
                .getMetadata(SearchIndexItem)
                .columns.some(column => column.propertyName === 'currencyCode')
        ) {
            qb.andWhere('si.currencyCode = :catalogCurrencyCode', { catalogCurrencyCode: indexedCurrency });
        }
        const pricingColumn = this.connection.rawConnection
            .getMetadata(Product)
            .columns.find(column => column.propertyPath === 'customFields.pricingMode');
        if (pricingColumn) {
            const escaped = this.connection.rawConnection.driver.escape(pricingColumn.databaseName);
            qb.addSelect(
                `MAX(CASE WHEN catalog_product.${escaped} = :catalogQuoteOnlyMode THEN 1 ELSE 0 END)`,
                'catalogQuoteOnly',
            ).setParameters({ catalogQuoteOnlyMode: 'QUOTE_ONLY' });
            if (input.minPriceWithTax != null || input.maxPriceWithTax != null) {
                qb.andWhere(`COALESCE(catalog_product.${escaped}, 'FIXED') != :catalogQuoteOnlyMode`);
            }
        }

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
            const variantColumns = this.connection.rawConnection.getMetadata(ProductVariant).columns;
            const fulfillmentColumn = variantColumns.find(
                column => column.propertyPath === 'customFields.fulfillmentType',
            );
            const deliveryModeColumn = variantColumns.find(
                column => column.propertyPath === 'customFields.digitalDeliveryMode',
            );
            if (!fulfillmentColumn || !deliveryModeColumn) {
                throw new UserInputError('商品库存规则尚未配置');
            }
            const escape = this.connection.rawConnection.driver.escape.bind(
                this.connection.rawConnection.driver,
            );
            const autoCardVariant =
                `catalog_variant.${escape(fulfillmentColumn.databaseName)} = :catalogDigitalFulfillment ` +
                `AND catalog_variant.${escape(deliveryModeColumn.databaseName)} = :catalogAutoCardMode`;
            // Auto-card saleability comes from the enabled card pool, not Vendure's search index.
            // Keep this condition in the candidate query so totalItems and pagination stay accurate.
            const availableCard =
                `EXISTS (SELECT 1 FROM ${escape('auto_card_config')} catalog_card_config ` +
                `INNER JOIN ${escape('auto_card_pool_item')} catalog_card_item ` +
                `ON catalog_card_item.${escape('configId')} = catalog_card_config.id ` +
                `AND catalog_card_item.state = :catalogAvailableCardState ` +
                `WHERE catalog_card_config.${escape('channelId')} = :catalogChannelId ` +
                `AND catalog_card_config.${escape('productVariantId')} = si.productVariantId ` +
                `AND catalog_card_config.enabled = :catalogCardConfigEnabled)`;
            qb.andWhere(`CASE WHEN ${autoCardVariant} THEN ${availableCard} ELSE si.inStock END`, {
                catalogDigitalFulfillment: 'digital',
                catalogAutoCardMode: 'auto_card',
                catalogAvailableCardState: 'AVAILABLE',
                catalogCardConfigEnabled: true,
            });
        }
        if (applyPriceBounds && input.minPriceWithTax != null) {
            qb.having('MIN(si.priceWithTax) >= :catalogMinPriceWithTax', {
                catalogMinPriceWithTax: prices.min,
            });
        }
        if (applyPriceBounds && input.maxPriceWithTax != null) {
            const havingMethod = input.minPriceWithTax != null ? 'andHaving' : 'having';
            qb[havingMethod]('MIN(si.priceWithTax) <= :catalogMaxPriceWithTax', {
                catalogMaxPriceWithTax: prices.max,
            });
        }

        if (input.sort === 'SALES') {
            this.addSalesSort(qb, ctx);
        } else {
            this.addStandardSort(qb, input.sort, Boolean(pricingColumn));
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

    private addStandardSort(
        qb: SelectQueryBuilder<SearchIndexItem>,
        sort: StorefrontCatalogSort,
        hasPricingMode: boolean,
    ): void {
        if (hasPricingMode && (sort === 'PRICE_ASC' || sort === 'PRICE_DESC')) {
            qb.addOrderBy('catalogQuoteOnly', 'ASC');
        }
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
