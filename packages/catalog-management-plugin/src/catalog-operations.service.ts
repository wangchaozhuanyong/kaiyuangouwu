import { Injectable } from '@nestjs/common';
import {
    ConfigurableOperation,
    CurrencyCode,
    GlobalFlag,
    LanguageCode,
    Permission,
    SortOrder,
} from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import {
    Collection,
    CollectionModificationEvent,
    EventBus,
    ForbiddenError,
    Product,
    ProductService,
    ProductVariant,
    ProductVariantService,
    RequestContext,
    StockLevel,
    StockLocation,
    StockMovementService,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { In } from 'typeorm';

import { CatalogSupplierService } from './catalog-supplier.service';
import { manageCatalogImportPermission, manageCatalogOperationsPermission } from './constants';
import { InventoryLot } from './entities/inventory-lot.entity';
import { InventoryPolicy } from './entities/inventory-policy.entity';
import { VariantCostRecord } from './entities/variant-cost-record.entity';
import {
    CatalogProductListOptions,
    CatalogProductSummaryFilterInput,
    CreateCatalogProductInput,
    CreateCatalogProductVariantInput,
    SaveCatalogProductInput,
    SaveInventoryLotInput,
    UpdateCatalogVariantOperationsInput,
} from './types';

@Injectable()
export class CatalogOperationsService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly productService: ProductService,
        private readonly productVariantService: ProductVariantService,
        private readonly stockMovementService: StockMovementService,
        private readonly suppliers: CatalogSupplierService,
        private readonly eventBus: EventBus,
    ) {}

    async creationContext(ctx: RequestContext) {
        return {
            currencyCode: ctx.channel.defaultCurrencyCode,
            stockLocations: await this.stockLocations(ctx),
        };
    }

    async integritySummary(ctx: RequestContext) {
        const productPage = await this.productService.findAll(ctx, { skip: 0, take: 1 });
        const productIdsWithVariants = new Set<string>();
        let totalVariants = 0;
        let variantsWithoutCategory = 0;
        let variantsWithoutCost = 0;
        let skip = 0;
        do {
            const page = await this.exportRows(ctx, skip, 500);
            totalVariants = page.totalItems;
            for (const row of page.items) {
                productIdsWithVariants.add(row.productId);
                if (row.categories.length === 0) variantsWithoutCategory += 1;
                if (row.purchaseCostMicrounits == null) variantsWithoutCost += 1;
            }
            const scannedItems = page.scannedItems ?? page.items.length;
            if (scannedItems === 0) break;
            skip += scannedItems;
        } while (skip < totalVariants);
        return {
            totalProducts: productPage.totalItems,
            totalVariants,
            productsWithoutVariants: Math.max(productPage.totalItems - productIdsWithVariants.size, 0),
            variantsWithoutCategory,
            variantsWithoutCost,
        };
    }

    async createProduct(ctx: RequestContext, input: CreateCatalogProductInput) {
        const canCreateProduct = ctx.userHasPermissions([Permission.CreateProduct, Permission.CreateCatalog]);
        const canMaintainOperations = ctx.userHasPermissions([
            manageCatalogOperationsPermission.Update,
            manageCatalogImportPermission.Update,
        ]);
        if (!canCreateProduct || !canMaintainOperations) throw new ForbiddenError();
        validateInitialProductInput(input);

        return this.connection.withTransaction(ctx, async txCtx => {
            await this.requireStockLocation(txCtx, input.variant.stockLocationId);
            const product = await this.productService.create(txCtx, input.product);
            const variant = await this.createInitialVariant(txCtx, product, input);
            await this.assignInitialCollections(txCtx, product.id, variant.id, input.collectionIds);
            return product;
        });
    }

    async saveProduct(ctx: RequestContext, input: SaveCatalogProductInput) {
        const canMaintainProduct = ctx.userHasPermissions([
            Permission.UpdateProduct,
            Permission.UpdateCatalog,
        ]);
        const canMaintainOperations =
            input.variants.length === 0 ||
            ctx.userHasPermissions([
                manageCatalogOperationsPermission.Update,
                manageCatalogImportPermission.Update,
            ]);
        if (!canMaintainProduct || !canMaintainOperations) throw new ForbiddenError();
        if (input.variants.length > 1_000) throw new UserInputError('单次最多保存 1,000 个 SKU');

        return this.connection.withTransaction(ctx, async txCtx => {
            const product = await this.productService.update(txCtx, input.product);
            const productVariants = await this.productVariantService.getVariantsByProductId(
                txCtx,
                product.id,
                { take: 1_000 },
            );
            const productVariantIds = new Set(productVariants.items.map(variant => String(variant.id)));
            for (const variant of input.variants) {
                if (!productVariantIds.has(String(variant.productVariantId))) {
                    throw new UserInputError('SKU 不属于当前商品');
                }
                await this.updateVariant(txCtx, variant, false, false);
            }
            return product;
        });
    }

    async createVariant(ctx: RequestContext, input: CreateCatalogProductVariantInput) {
        const canCreateProduct = ctx.userHasPermissions([Permission.CreateProduct, Permission.CreateCatalog]);
        const canMaintainOperations = ctx.userHasPermissions([
            manageCatalogOperationsPermission.Update,
            manageCatalogImportPermission.Update,
        ]);
        if (!canCreateProduct || !canMaintainOperations) throw new ForbiddenError();
        validateCreateVariantInput(input);

        return this.connection.withTransaction(ctx, async txCtx => {
            await this.requireStockLocation(txCtx, input.stockLocationId);
            const product = await this.connection.getEntityOrThrow(txCtx, Product, input.productId, {
                channelId: txCtx.channelId,
                relations: ['optionGroups', 'optionGroups.options', 'variants', 'variants.options'],
            });
            validateVariantOptions(product, input.optionIds);
            const [variant] = await this.productVariantService.create(txCtx, [
                {
                    productId: product.id,
                    enabled: input.enabled ?? true,
                    sku: input.sku.trim(),
                    prices: [{ currencyCode: input.currencyCode, price: input.sellingPrice }],
                    translations: [
                        {
                            languageCode: txCtx.languageCode,
                            name: input.name.trim(),
                        },
                    ],
                    optionIds: input.optionIds,
                    stockLevels: [
                        {
                            stockLocationId: input.stockLocationId,
                            stockOnHand: input.stockOnHand,
                        },
                    ],
                    trackInventory: GlobalFlag.INHERIT,
                    customFields: {
                        barcode: blankToNull(input.barcode),
                        specification: blankToNull(input.specification),
                        saleUnit: blankToNull(input.saleUnit),
                        purchaseUnit: blankToNull(input.purchaseUnit),
                        packageQuantity: input.packageQuantity,
                        shelfLifeDays: input.shelfLifeDays ?? null,
                    },
                },
            ]);
            await this.savePolicy(
                txCtx,
                variant.id,
                input.stockLocationId,
                input.minimumStock ?? null,
                input.maximumStock ?? null,
            );
            if (input.purchaseCostMicrounits != null) {
                await this.recordCost(
                    txCtx,
                    variant.id,
                    input.currencyCode,
                    input.purchaseCostMicrounits,
                    'MANUAL',
                    null,
                );
            }
            return this.workspace(txCtx, product.id);
        });
    }

    private async createInitialVariant(
        ctx: RequestContext,
        product: Product,
        input: CreateCatalogProductInput,
    ): Promise<ProductVariant> {
        const variantInput = input.variant;
        const [variant] = await this.productVariantService.create(ctx, [
            {
                productId: product.id,
                enabled: variantInput.enabled ?? true,
                sku: variantInput.sku.trim(),
                prices: [
                    {
                        currencyCode: ctx.channel.defaultCurrencyCode,
                        price: variantInput.sellingPrice,
                    },
                ],
                translations: [
                    {
                        languageCode: ctx.languageCode,
                        name: product.name,
                    },
                ],
                optionIds: [],
                stockLevels: [
                    {
                        stockLocationId: variantInput.stockLocationId,
                        stockOnHand: variantInput.stockOnHand,
                    },
                ],
                trackInventory: GlobalFlag.INHERIT,
                customFields: {
                    barcode: blankToNull(variantInput.barcode),
                    specification: blankToNull(variantInput.specification),
                    saleUnit: blankToNull(variantInput.saleUnit),
                    purchaseUnit: blankToNull(variantInput.purchaseUnit),
                    packageQuantity: variantInput.packageQuantity,
                    shelfLifeDays: variantInput.shelfLifeDays ?? null,
                },
            },
        ]);
        await this.savePolicy(
            ctx,
            variant.id,
            variantInput.stockLocationId,
            variantInput.minimumStock ?? null,
            variantInput.maximumStock ?? null,
        );
        await this.recordCost(
            ctx,
            variant.id,
            ctx.channel.defaultCurrencyCode,
            variantInput.purchaseCostMicrounits,
            'MANUAL',
            null,
        );
        return variant;
    }

    private async assignInitialCollections(
        ctx: RequestContext,
        productId: ID,
        variantId: ID,
        collectionIds: ID[],
    ): Promise<void> {
        const uniqueCollectionIds = [...new Set(collectionIds.map(String))];
        const repository = this.connection.getRepository(ctx, Collection);
        for (const collectionId of uniqueCollectionIds) {
            const collection = await this.connection.getEntityOrThrow(ctx, Collection, collectionId, {
                channelId: ctx.channelId,
            });
            collection.filters = withDirectProductAssignment(collection.filters ?? [], productId);
            await repository.save(collection);
            await repository
                .createQueryBuilder()
                .relation(Collection, 'productVariants')
                .of(collection.id)
                .add(variantId);
            await this.eventBus.publish(new CollectionModificationEvent(ctx, collection, [variantId]));
        }
    }

    async workspace(ctx: RequestContext, productId: ID) {
        const variants = await this.productVariantService.getVariantsByProductId(
            ctx,
            productId,
            { take: 1_000 },
            ['stockLevels', 'stockLevels.stockLocation', 'productVariantPrices', 'options'],
        );
        const stockLocations = await this.stockLocations(ctx);
        const allowedStockLocationIds = new Set(stockLocations.map(location => location.id));
        const variantIds = variants.items.map(variant => variant.id);
        const [costs, policies, lots, supplierBindings] = variantIds.length
            ? await Promise.all([
                  this.connection.getRepository(ctx, VariantCostRecord).find({
                      where: { variantId: In(variantIds), channelId: ctx.channelId },
                      order: { effectiveAt: 'DESC', id: 'DESC' },
                  }),
                  this.connection.getRepository(ctx, InventoryPolicy).find({
                      where: { variantId: In(variantIds) },
                  }),
                  this.connection.getRepository(ctx, InventoryLot).find({
                      where: { variantId: In(variantIds) },
                      order: { expiresAt: 'ASC', manufacturedAt: 'ASC', createdAt: 'ASC' },
                  }),
                  this.suppliers.associations(ctx, variantIds),
              ])
            : [[], [], [], []];
        const supplierByVariant = new Map(
            supplierBindings.map(binding => [String(binding.variantId), binding.supplier]),
        );
        const latestCost = new Map<string, VariantCostRecord>();
        for (const cost of costs) {
            const key = `${String(cost.variantId)}:${cost.currencyCode}`;
            if (!latestCost.has(key)) latestCost.set(key, cost);
        }

        return {
            productId: String(productId),
            channelId: String(ctx.channelId),
            currencyCode: ctx.channel.defaultCurrencyCode,
            stockLocations,
            variants: variants.items.map(variant => {
                const customFields = (variant.customFields ?? {}) as Record<string, unknown>;
                const cost = latestCost.get(`${String(variant.id)}:${variant.currencyCode}`);
                const costMicrounits = cost ? Number(cost.costMicrounits) : null;
                const margin = calculateMargin(variant.price, costMicrounits);
                const supplier = supplierByVariant.get(String(variant.id));
                return {
                    id: String(variant.id),
                    name: variant.name,
                    enabled: variant.enabled,
                    sku: variant.sku,
                    barcode: stringOrEmpty(customFields.barcode),
                    specification: stringOrEmpty(customFields.specification),
                    saleUnit: stringOrEmpty(customFields.saleUnit),
                    purchaseUnit: stringOrEmpty(customFields.purchaseUnit),
                    packageQuantity: numberOrDefault(customFields.packageQuantity, 1),
                    shelfLifeDays: nullableNumber(customFields.shelfLifeDays),
                    supplier: supplier ? { ...supplier, linkedVariantCount: 0 } : null,
                    sellingPrice: variant.price,
                    currencyCode: variant.currencyCode,
                    purchaseCostMicrounits: costMicrounits,
                    grossProfitMicrounits:
                        costMicrounits == null ? null : variant.price * 10 - costMicrounits,
                    margin,
                    stockLevels: variant.stockLevels
                        .filter(level => allowedStockLocationIds.has(String(level.stockLocationId)))
                        .map(level => ({
                            stockLocationId: String(level.stockLocationId),
                            stockLocationName: level.stockLocation.name,
                            stockOnHand: level.stockOnHand,
                            stockAllocated: level.stockAllocated,
                            stockAvailable: level.stockOnHand - level.stockAllocated,
                            minimumStock:
                                policies.find(
                                    policy =>
                                        String(policy.variantId) === String(variant.id) &&
                                        String(policy.stockLocationId) === String(level.stockLocationId),
                                )?.minimumStock ?? null,
                            maximumStock:
                                policies.find(
                                    policy =>
                                        String(policy.variantId) === String(variant.id) &&
                                        String(policy.stockLocationId) === String(level.stockLocationId),
                                )?.maximumStock ?? null,
                        })),
                    lots: lots
                        .filter(
                            lot =>
                                String(lot.variantId) === String(variant.id) &&
                                allowedStockLocationIds.has(String(lot.stockLocationId)),
                        )
                        .map(toLotView),
                };
            }),
        };
    }

    async exportRows(ctx: RequestContext, skip = 0, take = 500) {
        const safeTake = Math.min(Math.max(take, 1), 500);
        const allowedStockLocationIds = new Set(
            (await this.stockLocations(ctx)).map(location => location.id),
        );
        const page = await this.productVariantService.findAll(ctx, {
            skip: Math.max(skip, 0),
            take: safeTake,
            sort: { updatedAt: 'DESC' },
        });
        const variantIds = page.items.map(variant => variant.id);
        if (variantIds.length === 0) {
            return { items: [], totalItems: page.totalItems, scannedItems: page.items.length };
        }

        const [hydrated, costs, policies, lots, supplierBindings] = await Promise.all([
            this.connection.getRepository(ctx, ProductVariant).find({
                where: { id: In(variantIds) },
                relations: [
                    'product',
                    'product.translations',
                    'product.facetValues',
                    'product.facetValues.facet',
                    'product.facetValues.translations',
                    'collections',
                    'collections.translations',
                    'stockLevels',
                    'stockLevels.stockLocation',
                ],
            }),
            this.connection.getRepository(ctx, VariantCostRecord).find({
                where: { variantId: In(variantIds), channelId: ctx.channelId },
                order: { effectiveAt: 'DESC', id: 'DESC' },
            }),
            this.connection.getRepository(ctx, InventoryPolicy).find({
                where: { variantId: In(variantIds) },
            }),
            this.connection.getRepository(ctx, InventoryLot).find({
                where: { variantId: In(variantIds) },
                relations: ['stockLocation'],
                order: { expiresAt: 'ASC', manufacturedAt: 'ASC', createdAt: 'ASC' },
            }),
            this.suppliers.associations(ctx, variantIds),
        ]);
        const supplierByVariant = new Map(
            supplierBindings.map(binding => [String(binding.variantId), binding.supplier]),
        );
        const hydratedById = new Map(hydrated.map(variant => [String(variant.id), variant]));
        const latestCost = new Map<string, VariantCostRecord>();
        for (const cost of costs) {
            const key = `${String(cost.variantId)}:${cost.currencyCode}`;
            if (!latestCost.has(key)) latestCost.set(key, cost);
        }
        return {
            totalItems: page.totalItems,
            scannedItems: page.items.length,
            items: page.items.flatMap(variant => {
                const data = hydratedById.get(String(variant.id));
                if (!data?.product) return [];
                const product = data.product;
                const translation =
                    product.translations.find(item => item.languageCode === ctx.languageCode) ??
                    product.translations[0];
                const fields = (data.customFields ?? {}) as Record<string, unknown>;
                const productFields = (product.customFields ?? {}) as Record<string, unknown>;
                const cost = latestCost.get(`${String(variant.id)}:${variant.currencyCode}`);
                const costMicrounits = cost ? Number(cost.costMicrounits) : null;
                return [
                    {
                        productId: String(product.id),
                        variantId: String(variant.id),
                        productName: translation?.name ?? variant.name,
                        description: translation?.description ?? '',
                        categories: uniqueNames([
                            ...facetValueNames(product, 'catalog-import-category', ctx.languageCode),
                            ...data.collections.map(
                                collection =>
                                    collection.translations.find(
                                        item => item.languageCode === ctx.languageCode,
                                    )?.name ??
                                    collection.translations[0]?.name ??
                                    '',
                            ),
                        ]),
                        brand: facetValueNames(product, 'catalog-brand', ctx.languageCode)[0] ?? null,
                        tags: facetValueNames(product, 'catalog-tag', ctx.languageCode),
                        productEnabled: product.enabled,
                        variantEnabled: variant.enabled,
                        systemCreatedAt: product.createdAt,
                        sourceCreatedAt: nullableDateValue(productFields.sourceCreatedAt),
                        supplierName: supplierByVariant.get(String(variant.id))?.name ?? null,
                        sku: variant.sku,
                        barcode: stringOrEmpty(fields.barcode),
                        specification: stringOrEmpty(fields.specification),
                        saleUnit: stringOrEmpty(fields.saleUnit),
                        purchaseUnit: stringOrEmpty(fields.purchaseUnit),
                        packageQuantity: numberOrDefault(fields.packageQuantity, 1),
                        shelfLifeDays: nullableNumber(fields.shelfLifeDays),
                        sellingPrice: variant.price,
                        purchaseCostMicrounits: costMicrounits,
                        margin: calculateMargin(variant.price, costMicrounits),
                        currencyCode: variant.currencyCode,
                        stockLevels: data.stockLevels
                            .filter(level => allowedStockLocationIds.has(String(level.stockLocationId)))
                            .map(level => ({
                                stockLocationId: String(level.stockLocationId),
                                stockLocationName: level.stockLocation.name,
                                stockOnHand: level.stockOnHand,
                                stockAllocated: level.stockAllocated,
                                stockAvailable: level.stockOnHand - level.stockAllocated,
                                minimumStock:
                                    policies.find(
                                        policy =>
                                            String(policy.variantId) === String(variant.id) &&
                                            String(policy.stockLocationId) === String(level.stockLocationId),
                                    )?.minimumStock ?? null,
                                maximumStock:
                                    policies.find(
                                        policy =>
                                            String(policy.variantId) === String(variant.id) &&
                                            String(policy.stockLocationId) === String(level.stockLocationId),
                                    )?.maximumStock ?? null,
                            })),
                        lots: lots
                            .filter(
                                lot =>
                                    String(lot.variantId) === String(variant.id) &&
                                    allowedStockLocationIds.has(String(lot.stockLocationId)),
                            )
                            .map(lot => ({
                                id: String(lot.id),
                                stockLocationId: String(lot.stockLocationId),
                                stockLocationName: lot.stockLocation.name,
                                lotCode: lot.lotCode,
                                manufacturedAt: lot.manufacturedAt,
                                expiresAt: lot.expiresAt,
                                quantityOnHand: lot.quantityOnHand,
                                purchaseCostMicrounits:
                                    lot.purchaseCostMicrounits == null
                                        ? null
                                        : Number(lot.purchaseCostMicrounits),
                                currencyCode: lot.currencyCode,
                                state: lot.state,
                            })),
                    },
                ];
            }),
        };
    }

    async matchingProductIds(ctx: RequestContext, filter: CatalogProductSummaryFilterInput) {
        validateSummaryFilter(filter);
        const matchingProductIds = new Set<string>();
        let skip = 0;
        let totalItems = 0;
        do {
            const page = await this.exportRows(ctx, skip, 500);
            totalItems = page.totalItems;
            if (totalItems > 20_000) {
                throw new UserInputError('高级筛选最多处理 20,000 个 SKU，请先收窄门店范围');
            }
            for (const row of page.items) {
                if (matchesSummaryFilter(row, filter)) matchingProductIds.add(row.productId);
            }
            skip += page.scannedItems ?? page.items.length;
            if ((page.scannedItems ?? page.items.length) === 0) break;
        } while (skip < totalItems);
        return [...matchingProductIds];
    }

    async productSummaries(
        ctx: RequestContext,
        filter: CatalogProductSummaryFilterInput,
        skip = 0,
        take = 100,
    ) {
        const productIds = await this.matchingProductIds(ctx, filter);
        const safeSkip = Math.max(skip, 0);
        const safeTake = Math.min(Math.max(take, 1), 500);
        return {
            items: productIds.slice(safeSkip, safeSkip + safeTake).map(productId => ({ productId })),
            totalItems: productIds.length,
        };
    }

    /**
     * Returns the regular ProductList shape without sending every matching ID through GraphQL.
     * Matching IDs stay on the server and are applied in bounded chunks, then the final page is
     * sorted and sliced in memory. This also avoids database driver parameter limits for large
     * catalog filters while preserving the Dashboard's ordinary name/facet filters.
     */
    async filteredProducts(
        ctx: RequestContext,
        filter: CatalogProductSummaryFilterInput,
        options: CatalogProductListOptions,
    ) {
        const matchingProductIds = await this.matchingProductIds(ctx, filter);
        if (matchingProductIds.length === 0) return { items: [], totalItems: 0 };

        const products = new Map<string, Product>();
        const normalFilter = options.filter ?? {};
        for (const ids of chunks(matchingProductIds, 100)) {
            const page = await this.productService.findAll(ctx, {
                ...options,
                skip: 0,
                take: ids.length,
                sort: undefined,
                filter: {
                    _and: [normalFilter, { id: { in: ids } }],
                },
            });
            for (const product of page.items) products.set(String(product.id), product);
        }

        const sorted = [...products.values()].sort((left, right) =>
            compareProducts(left, right, options.sort),
        );
        const skip = Math.max(0, options.skip ?? 0);
        const take = Math.min(Math.max(options.take ?? 10, 1), 100);
        return {
            items: sorted.slice(skip, skip + take),
            totalItems: sorted.length,
        };
    }

    async updateVariant(
        ctx: RequestContext,
        input: UpdateCatalogVariantOperationsInput,
        allowConfirmedNegativeStock = false,
        returnWorkspace = true,
    ) {
        await this.requireStockLocation(ctx, input.stockLocationId);
        validatePolicy(input.minimumStock, input.maximumStock);
        if (!allowConfirmedNegativeStock && input.stockOnHand != null && input.stockOnHand < 0) {
            throw new UserInputError('库存不能为负数');
        }
        if (input.purchaseCostMicrounits != null && input.purchaseCostMicrounits < 0) {
            throw new UserInputError('进货价不能为负数');
        }
        if (input.sellingPrice != null && input.sellingPrice < 0) {
            throw new UserInputError('销售价不能为负数');
        }
        if (input.packageQuantity != null && input.packageQuantity <= 0) {
            throw new UserInputError('包装换算数量必须大于 0');
        }
        if (input.shelfLifeDays != null && input.shelfLifeDays < 0) {
            throw new UserInputError('保质期不能为负数');
        }

        const variant = await this.connection.getEntityOrThrow(ctx, ProductVariant, input.productVariantId, {
            channelId: ctx.channelId,
        });
        const currentFields = (variant.customFields ?? {}) as Record<string, unknown>;
        const customFields = {
            ...currentFields,
            ...(input.barcode !== undefined ? { barcode: blankToNull(input.barcode) } : {}),
            ...(input.specification !== undefined ? { specification: blankToNull(input.specification) } : {}),
            ...(input.saleUnit !== undefined ? { saleUnit: blankToNull(input.saleUnit) } : {}),
            ...(input.purchaseUnit !== undefined ? { purchaseUnit: blankToNull(input.purchaseUnit) } : {}),
            ...(input.packageQuantity !== undefined ? { packageQuantity: input.packageQuantity } : {}),
            ...(input.shelfLifeDays !== undefined ? { shelfLifeDays: input.shelfLifeDays } : {}),
        };
        await this.productVariantService.update(ctx, [
            {
                id: variant.id,
                ...(input.sku !== undefined ? { sku: input.sku?.trim() } : {}),
                ...(input.enabled !== undefined && input.enabled !== null ? { enabled: input.enabled } : {}),
                ...(input.sellingPrice != null
                    ? {
                          prices: [
                              {
                                  currencyCode: input.currencyCode,
                                  price: input.sellingPrice,
                              },
                          ],
                      }
                    : {}),
                customFields,
            },
        ]);
        if (input.stockOnHand != null) {
            await this.stockMovementService.adjustProductVariantStock(ctx, variant.id, [
                { stockLocationId: input.stockLocationId, stockOnHand: input.stockOnHand },
            ]);
        }
        if (input.minimumStock !== undefined || input.maximumStock !== undefined) {
            await this.savePolicy(
                ctx,
                variant.id,
                input.stockLocationId,
                input.minimumStock ?? null,
                input.maximumStock ?? null,
            );
        }
        if (input.purchaseCostMicrounits != null) {
            await this.recordCost(
                ctx,
                variant.id,
                input.currencyCode,
                input.purchaseCostMicrounits,
                'MANUAL',
                null,
            );
        }
        if (input.supplierId !== undefined) {
            await this.suppliers.setVariantSupplier(ctx, variant.id, input.supplierId ?? null);
        }
        return returnWorkspace ? this.workspace(ctx, variant.productId) : null;
    }

    async saveLot(ctx: RequestContext, input: SaveInventoryLotInput, adjustStock = true) {
        await this.requireStockLocation(ctx, input.stockLocationId);
        if (!input.lotCode.trim()) throw new UserInputError('批次号不能为空');
        if (input.quantityOnHand < 0 || !Number.isInteger(input.quantityOnHand)) {
            throw new UserInputError('批次数量必须是非负整数');
        }
        const manufacturedAt = nullableDate(input.manufacturedAt, '生产日期');
        const expiresAt = nullableDate(input.expiresAt, '到期日期');
        if (manufacturedAt && expiresAt && expiresAt < manufacturedAt) {
            throw new UserInputError('到期日期不能早于生产日期');
        }
        const variant = await this.connection.getEntityOrThrow(ctx, ProductVariant, input.productVariantId, {
            channelId: ctx.channelId,
        });
        const repository = this.connection.getRepository(ctx, InventoryLot);
        const existing = input.id
            ? await repository.findOne({ where: { id: input.id, variantId: variant.id } })
            : await repository.findOne({
                  where: {
                      variantId: variant.id,
                      stockLocationId: input.stockLocationId,
                      lotCode: input.lotCode.trim(),
                  },
              });
        const previousQuantity = existing?.quantityOnHand ?? 0;
        const lot = existing ?? new InventoryLot();
        lot.variantId = variant.id;
        lot.stockLocationId = input.stockLocationId;
        lot.lotCode = input.lotCode.trim();
        lot.manufacturedAt = manufacturedAt;
        lot.expiresAt = expiresAt;
        lot.quantityOnHand = input.quantityOnHand;
        lot.purchaseCostMicrounits =
            input.purchaseCostMicrounits == null ? null : String(input.purchaseCostMicrounits);
        lot.currencyCode = input.currencyCode;
        lot.state =
            input.quantityOnHand === 0
                ? 'DEPLETED'
                : expiresAt && expiresAt < new Date()
                  ? 'EXPIRED'
                  : 'ACTIVE';
        const saved = await repository.save(lot);

        if (adjustStock && previousQuantity !== input.quantityOnHand) {
            const stockLevel = await this.connection.getRepository(ctx, StockLevel).findOne({
                where: { productVariantId: variant.id, stockLocationId: input.stockLocationId },
            });
            const current = stockLevel?.stockOnHand ?? 0;
            await this.stockMovementService.adjustProductVariantStock(ctx, variant.id, [
                {
                    stockLocationId: input.stockLocationId,
                    stockOnHand: current + input.quantityOnHand - previousQuantity,
                },
            ]);
        }
        return toLotView(saved);
    }

    async recordCost(
        ctx: RequestContext,
        variantId: ID,
        currencyCode: CurrencyCode,
        costMicrounits: number,
        source: string,
        sourceReference: string | null,
    ): Promise<VariantCostRecord | null> {
        if (!Number.isInteger(costMicrounits) || costMicrounits < 0) {
            throw new UserInputError('进货价精度必须是千分之一货币单位');
        }
        const repository = this.connection.getRepository(ctx, VariantCostRecord);
        const latest = await repository.findOne({
            where: { variantId, channelId: ctx.channelId, currencyCode },
            order: { effectiveAt: 'DESC', id: 'DESC' },
        });
        if (latest && Number(latest.costMicrounits) === costMicrounits) return null;
        return repository.save(
            new VariantCostRecord({
                variantId,
                channelId: ctx.channelId,
                currencyCode,
                costMicrounits: String(costMicrounits),
                effectiveAt: new Date(),
                source,
                sourceReference,
                actorId: ctx.activeUserId ? String(ctx.activeUserId) : null,
            }),
        );
    }

    async savePolicy(
        ctx: RequestContext,
        variantId: ID,
        stockLocationId: ID,
        minimumStock: number | null,
        maximumStock: number | null,
    ): Promise<InventoryPolicy> {
        validatePolicy(minimumStock, maximumStock);
        const repository = this.connection.getRepository(ctx, InventoryPolicy);
        const policy =
            (await repository.findOne({ where: { variantId, stockLocationId } })) ??
            new InventoryPolicy({ variantId, stockLocationId });
        policy.minimumStock = minimumStock;
        policy.maximumStock = maximumStock;
        return repository.save(policy);
    }

    async stockLocations(ctx: RequestContext): Promise<Array<{ id: string; name: string }>> {
        const locations = await this.connection
            .getRepository(ctx, StockLocation)
            .createQueryBuilder('location')
            .innerJoin('location.channels', 'channel', 'channel.id = :channelId', {
                channelId: ctx.channelId,
            })
            .orderBy('location.name', 'ASC')
            .getMany();
        return locations.map(location => ({ id: String(location.id), name: location.name }));
    }

    async requireStockLocation(ctx: RequestContext, stockLocationId: ID): Promise<StockLocation> {
        const found = await this.connection
            .getRepository(ctx, StockLocation)
            .createQueryBuilder('location')
            .innerJoin('location.channels', 'channel', 'channel.id = :channelId', {
                channelId: ctx.channelId,
            })
            .where('location.id = :stockLocationId', { stockLocationId })
            .getOne();
        if (!found) throw new UserInputError('所选仓库不属于当前门店');
        return found;
    }
}

function validatePolicy(minimumStock?: number | null, maximumStock?: number | null): void {
    if (minimumStock != null && (!Number.isInteger(minimumStock) || minimumStock < 0)) {
        throw new UserInputError('库存下限必须是非负整数');
    }
    if (maximumStock != null && (!Number.isInteger(maximumStock) || maximumStock < 0)) {
        throw new UserInputError('库存上限必须是非负整数');
    }
    if (minimumStock != null && maximumStock != null && maximumStock < minimumStock) {
        throw new UserInputError('库存上限不能小于库存下限');
    }
}

function validateInitialProductInput(input: CreateCatalogProductInput): void {
    if (input.collectionIds.length === 0) throw new UserInputError('新增商品必须选择至少一个分类');
    if (input.collectionIds.length > 100) throw new UserInputError('单个商品最多选择 100 个分类');
    const variant = input.variant;
    if (!variant.sku.trim()) throw new UserInputError('SKU 编码不能为空');
    if (!Number.isInteger(variant.sellingPrice) || variant.sellingPrice < 0) {
        throw new UserInputError('销售价必须是非负整数货币单位');
    }
    if (!Number.isInteger(variant.purchaseCostMicrounits) || variant.purchaseCostMicrounits < 0) {
        throw new UserInputError('进货价精度必须是千分之一货币单位');
    }
    if (!Number.isInteger(variant.stockOnHand) || variant.stockOnHand < 0) {
        throw new UserInputError('库存必须是非负整数');
    }
    if (!Number.isFinite(variant.packageQuantity) || variant.packageQuantity <= 0) {
        throw new UserInputError('包装换算数量必须大于 0');
    }
    if (
        variant.shelfLifeDays != null &&
        (!Number.isInteger(variant.shelfLifeDays) || variant.shelfLifeDays < 0)
    ) {
        throw new UserInputError('保质期必须是非负整数');
    }
    validatePolicy(variant.minimumStock, variant.maximumStock);
}

function withDirectProductAssignment(
    filters: ConfigurableOperation[],
    productId: ID,
): ConfigurableOperation[] {
    const normalizedProductId = String(productId);
    const existingIndex = filters.findIndex(filter => {
        if (filter.code !== 'product-id-filter') return false;
        return parseProductIds(filter).includes(normalizedProductId);
    });
    if (existingIndex >= 0) return filters;

    const reusableIndex = filters.findIndex(filter => {
        if (filter.code !== 'product-id-filter') return false;
        if (!filter.args.some(argument => argument.name === 'productIds')) return false;
        const combineWithAnd = filter.args.find(argument => argument.name === 'combineWithAnd')?.value;
        return combineWithAnd === 'false' || filters.length === 1;
    });
    if (reusableIndex >= 0) {
        return filters.map((filter, index) => {
            if (index !== reusableIndex) return filter;
            const productIds = [...new Set([...parseProductIds(filter), normalizedProductId])];
            return {
                ...filter,
                args: filter.args.map(argument =>
                    argument.name === 'productIds'
                        ? { ...argument, value: JSON.stringify(productIds) }
                        : argument,
                ),
            };
        });
    }

    return [
        ...filters,
        {
            code: 'product-id-filter',
            args: [
                { name: 'productIds', value: JSON.stringify([normalizedProductId]) },
                { name: 'combineWithAnd', value: filters.length > 0 ? 'false' : 'true' },
            ],
        },
    ];
}

function parseProductIds(filter: ConfigurableOperation): string[] {
    const value = filter.args.find(argument => argument.name === 'productIds')?.value;
    if (!value) return [];
    try {
        const parsed = JSON.parse(value) as unknown;
        return Array.isArray(parsed) && parsed.every(id => typeof id === 'string')
            ? [...new Set(parsed)]
            : [];
    } catch {
        return [];
    }
}

function validateCreateVariantInput(input: CreateCatalogProductVariantInput): void {
    if (!input.name.trim()) throw new UserInputError('SKU 名称不能为空');
    if (!input.sku.trim()) throw new UserInputError('SKU 编码不能为空');
    if (!Number.isInteger(input.sellingPrice) || input.sellingPrice < 0) {
        throw new UserInputError('销售价必须是非负整数货币单位');
    }
    if (!Number.isInteger(input.stockOnHand) || input.stockOnHand < 0) {
        throw new UserInputError('库存必须是非负整数');
    }
    if (!Number.isFinite(input.packageQuantity) || input.packageQuantity <= 0) {
        throw new UserInputError('包装换算数量必须大于 0');
    }
    if (input.shelfLifeDays != null && (!Number.isInteger(input.shelfLifeDays) || input.shelfLifeDays < 0)) {
        throw new UserInputError('保质期必须是非负整数');
    }
    if (
        input.purchaseCostMicrounits != null &&
        (!Number.isInteger(input.purchaseCostMicrounits) || input.purchaseCostMicrounits < 0)
    ) {
        throw new UserInputError('进货价精度必须是千分之一货币单位');
    }
    validatePolicy(input.minimumStock, input.maximumStock);
}

function validateVariantOptions(product: Product, optionIds: ID[]): void {
    if (product.optionGroups.length === 0) {
        throw new UserInputError('当前商品没有规格模板，不能新增多个 SKU');
    }
    if (new Set(optionIds.map(String)).size !== optionIds.length) {
        throw new UserInputError('同一规格值不能重复选择');
    }
    const selectedIds = new Set(optionIds.map(String));
    for (const group of product.optionGroups) {
        const selectedCount = group.options.filter(option => selectedIds.has(String(option.id))).length;
        if (selectedCount !== 1) throw new UserInputError(`规格“${group.name}”必须选择一个值`);
    }
    if (selectedIds.size !== product.optionGroups.length) {
        throw new UserInputError('包含不属于当前商品规格模板的规格值');
    }
    const selectedKey = [...selectedIds].sort().join(':');
    const duplicate = product.variants.some(
        variant =>
            variant.options
                .map(option => String(option.id))
                .sort()
                .join(':') === selectedKey,
    );
    if (duplicate) throw new UserInputError('当前规格组合已存在，请直接编辑已有 SKU');
}

function chunks<T>(values: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let index = 0; index < values.length; index += size) {
        result.push(values.slice(index, index + size));
    }
    return result;
}

function compareProducts(left: Product, right: Product, sort: CatalogProductListOptions['sort']): number {
    const entries = Object.entries(sort ?? {});
    for (const [field, direction] of entries) {
        const compared = compareProductValue(
            (left as unknown as Record<string, unknown>)[field],
            (right as unknown as Record<string, unknown>)[field],
        );
        if (compared !== 0) return direction === SortOrder.DESC ? -compared : compared;
    }
    return compareProductValue(String(left.id), String(right.id));
}

function compareProductValue(left: unknown, right: unknown): number {
    const leftDate = left instanceof Date ? left.getTime() : null;
    const rightDate = right instanceof Date ? right.getTime() : null;
    if (leftDate != null && rightDate != null) return leftDate - rightDate;
    if (typeof left === 'number' && typeof right === 'number') return left - right;
    if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right);
    return comparableProductText(left).localeCompare(comparableProductText(right), 'zh-Hans', {
        numeric: true,
        sensitivity: 'base',
    });
}

function comparableProductText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
        return String(value);
    }
    return '';
}

interface CatalogSummarySourceRow {
    productId: string;
    productName: string;
    categories: string[];
    brand: string | null;
    productEnabled: boolean;
    sku: string;
    barcode: string;
    sellingPrice: number;
    purchaseCostMicrounits: number | null;
    margin: number | null;
    stockLevels: Array<{
        stockAvailable: number;
        minimumStock: number | null;
    }>;
    lots: Array<{
        expiresAt: Date | string | null;
        quantityOnHand: number;
    }>;
}

function validateSummaryFilter(filter: CatalogProductSummaryFilterInput): void {
    for (const [value, label] of [
        [filter.minimumSellingPrice, '最低售价'],
        [filter.maximumSellingPrice, '最高售价'],
        [filter.minimumPurchaseCostMicrounits, '最低成本'],
        [filter.maximumPurchaseCostMicrounits, '最高成本'],
    ] as const) {
        if (value != null && (!Number.isFinite(value) || value < 0)) {
            throw new UserInputError(`${label}必须是非负数`);
        }
    }
    for (const [minimum, maximum, label] of [
        [filter.minimumSellingPrice, filter.maximumSellingPrice, '售价'],
        [filter.minimumPurchaseCostMicrounits, filter.maximumPurchaseCostMicrounits, '成本'],
        [filter.minimumMargin, filter.maximumMargin, '毛利率'],
        [filter.minimumAvailableStock, filter.maximumAvailableStock, '可用库存'],
    ] as const) {
        if (minimum != null && maximum != null && minimum > maximum) {
            throw new UserInputError(`${label}上限不能小于下限`);
        }
    }
    if (
        filter.expiringWithinDays != null &&
        (!Number.isInteger(filter.expiringWithinDays) ||
            filter.expiringWithinDays < 0 ||
            filter.expiringWithinDays > 3_650)
    ) {
        throw new UserInputError('临期天数必须是 0 至 3650 的整数');
    }
}

function matchesSummaryFilter(
    row: CatalogSummarySourceRow,
    filter: CatalogProductSummaryFilterInput,
): boolean {
    const text = normalizedSearch(filter.text);
    if (
        text &&
        ![row.productName, row.sku, row.barcode].some(value => normalizedSearch(value).includes(text))
    ) {
        return false;
    }
    const category = normalizedSearch(filter.category);
    if (category && !row.categories.some(value => normalizedSearch(value).includes(category))) return false;
    const brand = normalizedSearch(filter.brand);
    if (brand && !normalizedSearch(row.brand).includes(brand)) return false;
    if (filter.enabled != null && row.productEnabled !== filter.enabled) return false;
    if (filter.minimumSellingPrice != null && row.sellingPrice < filter.minimumSellingPrice) return false;
    if (filter.maximumSellingPrice != null && row.sellingPrice > filter.maximumSellingPrice) return false;
    if (
        filter.minimumPurchaseCostMicrounits != null &&
        (row.purchaseCostMicrounits == null ||
            row.purchaseCostMicrounits < filter.minimumPurchaseCostMicrounits)
    ) {
        return false;
    }
    if (
        filter.maximumPurchaseCostMicrounits != null &&
        (row.purchaseCostMicrounits == null ||
            row.purchaseCostMicrounits > filter.maximumPurchaseCostMicrounits)
    ) {
        return false;
    }
    if (filter.minimumMargin != null && (row.margin == null || row.margin < filter.minimumMargin))
        return false;
    if (filter.maximumMargin != null && (row.margin == null || row.margin > filter.maximumMargin))
        return false;
    const availableStock = row.stockLevels.reduce((total, level) => total + level.stockAvailable, 0);
    if (filter.minimumAvailableStock != null && availableStock < filter.minimumAvailableStock) return false;
    if (filter.maximumAvailableStock != null && availableStock > filter.maximumAvailableStock) return false;
    if (filter.lowStock != null) {
        const lowStock = row.stockLevels.some(
            level => level.minimumStock != null && level.stockAvailable <= level.minimumStock,
        );
        if (lowStock !== filter.lowStock) return false;
    }
    if (filter.expiringWithinDays != null) {
        const now = Date.now();
        const threshold = now + filter.expiringWithinDays * 86_400_000;
        const expiring = row.lots.some(lot => {
            if (!lot.expiresAt || lot.quantityOnHand <= 0) return false;
            const expiry = new Date(lot.expiresAt).getTime();
            return Number.isFinite(expiry) && expiry >= now && expiry <= threshold;
        });
        if (!expiring) return false;
    }
    return true;
}

function normalizedSearch(value: unknown): string {
    const searchable =
        typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
            ? String(value)
            : '';
    return searchable.normalize('NFKC').trim().toLocaleLowerCase('zh-Hans');
}

function calculateMargin(sellingPrice: number, costMicrounits: number | null): number | null {
    if (costMicrounits == null || sellingPrice <= 0) return null;
    return (sellingPrice * 10 - costMicrounits) / (sellingPrice * 10);
}

function toLotView(lot: InventoryLot) {
    const now = Date.now();
    const expiry = lot.expiresAt?.getTime();
    return {
        id: String(lot.id),
        productVariantId: String(lot.variantId),
        stockLocationId: String(lot.stockLocationId),
        lotCode: lot.lotCode,
        manufacturedAt: lot.manufacturedAt,
        expiresAt: lot.expiresAt,
        quantityOnHand: lot.quantityOnHand,
        purchaseCostMicrounits:
            lot.purchaseCostMicrounits == null ? null : Number(lot.purchaseCostMicrounits),
        currencyCode: lot.currencyCode,
        state: expiry != null && expiry < now && lot.quantityOnHand > 0 ? 'EXPIRED' : lot.state,
        daysUntilExpiry: expiry == null ? null : Math.ceil((expiry - now) / 86_400_000),
    };
}

function nullableDate(value: Date | string | null | undefined, label: string): Date | null {
    if (value == null || value === '') return null;
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new UserInputError(`${label}无效`);
    return date;
}

function blankToNull(value: string | null | undefined): string | null | undefined {
    if (value === undefined) return undefined;
    return value?.trim() || null;
}

function stringOrEmpty(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function nullableNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function numberOrDefault(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function facetValueNames(product: Product, facetCode: string, languageCode: LanguageCode): string[] {
    return uniqueNames(
        (product.facetValues ?? [])
            .filter(value => value.facet?.code === facetCode)
            .map(
                value =>
                    value.translations.find(item => item.languageCode === languageCode)?.name ??
                    value.translations[0]?.name ??
                    value.code,
            ),
    );
}

function uniqueNames(values: string[]): string[] {
    return [...new Set(values.map(value => value.trim()).filter(Boolean))].sort((left, right) =>
        left.localeCompare(right, 'zh-Hans'),
    );
}

function nullableDateValue(value: unknown): Date | null {
    if (value == null || value === '') return null;
    if (!(value instanceof Date) && typeof value !== 'string' && typeof value !== 'number') return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
}
