import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import {
    Product,
    ProductService,
    ProductVariant,
    ProductVariantService,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { In, IsNull } from 'typeorm';

import { CatalogImportCategoryService } from './catalog-import-category.service';
import {
    dateString,
    dateValue,
    nullableNumber,
    numberValue,
    recordValue,
    stringArray,
    stringOrNumberValue,
    stringValue,
} from './catalog-import-helpers';
import { CatalogOperationsService } from './catalog-operations.service';
import { CatalogSupplierService } from './catalog-supplier.service';
import { CatalogImportJob } from './entities/catalog-import-job.entity';
import { CatalogImportRow } from './entities/catalog-import-row.entity';
import { CatalogSourceBinding } from './entities/catalog-source-binding.entity';
import { InventoryLot } from './entities/inventory-lot.entity';
import { VariantCostRecord } from './entities/variant-cost-record.entity';

export class CatalogImportRollback {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly operations: CatalogOperationsService,
        private readonly productVariantService: ProductVariantService,
        private readonly suppliers: CatalogSupplierService,
        private readonly productService: ProductService,
        private readonly categories: CatalogImportCategoryService,
    ) {}

    async assertRollbackSafe(ctx: RequestContext, rows: CatalogImportRow[]): Promise<void> {
        const latestProductRows = new Map<string, CatalogImportRow>();
        const latestVariantRows = new Map<string, CatalogImportRow>();
        for (const row of rows) {
            if (row.targetProductId && !latestProductRows.has(String(row.targetProductId))) {
                latestProductRows.set(String(row.targetProductId), row);
            }
            if (row.targetVariantId && !latestVariantRows.has(String(row.targetVariantId))) {
                latestVariantRows.set(String(row.targetVariantId), row);
            }
        }

        const productIds = [...latestProductRows.keys()] as ID[];
        const variantIds = [...latestVariantRows.keys()] as ID[];
        const products = productIds.length
            ? await this.connection.getRepository(ctx, Product).find({
                  where: { id: In(productIds), deletedAt: IsNull() },
              })
            : [];
        const variants = variantIds.length
            ? await this.connection.getRepository(ctx, ProductVariant).find({
                  where: { id: In(variantIds), deletedAt: IsNull() },
              })
            : [];
        const productById = new Map(products.map(product => [String(product.id), product]));
        const variantById = new Map(variants.map(variant => [String(variant.id), variant]));
        const conflicts: number[] = [];

        for (const [productId, row] of latestProductRows) {
            const product = productById.get(productId);
            const after = recordValue(row.appliedSnapshot?.afterSnapshot);
            if (!product || !after || dateString(product.updatedAt) !== stringValue(after.productUpdatedAt)) {
                conflicts.push(row.rowNumber);
            }
        }
        for (const [variantId, row] of latestVariantRows) {
            const variant = variantById.get(variantId);
            const after = recordValue(row.appliedSnapshot?.afterSnapshot);
            if (!variant || !after || dateString(variant.updatedAt) !== stringValue(after.variantUpdatedAt)) {
                conflicts.push(row.rowNumber);
            }
        }

        const uniqueConflicts = [...new Set(conflicts)].sort((left, right) => left - right);
        if (uniqueConflicts.length > 0) {
            const preview = uniqueConflicts.slice(0, 10).join('、');
            const suffix = uniqueConflicts.length > 10 ? `等 ${uniqueConflicts.length} 行` : '';
            throw new UserInputError(
                `导入完成后商品或 SKU 已被修改，或该历史任务缺少安全快照；为避免覆盖后续数据，已停止回滚（第 ${preview}${suffix} 行）`,
            );
        }
    }

    async rollbackRow(ctx: RequestContext, job: CatalogImportJob, row: CatalogImportRow): Promise<void> {
        const before = row.beforeSnapshot ?? {};
        const applied = row.appliedSnapshot ?? {};
        const appliedStockLocationId = stringValue(applied.stockLocationId) || job.stockLocationId;
        const variantId = row.targetVariantId;
        const productId = row.targetProductId;
        if (!variantId || !productId) return;
        const variant = await this.connection.getRepository(ctx, ProductVariant).findOne({
            where: { id: variantId, deletedAt: IsNull() },
            relations: ['translations'],
        });
        const product = await this.connection.getRepository(ctx, Product).findOne({
            where: { id: productId, deletedAt: IsNull() },
            relations: ['translations', 'facetValues'],
        });
        if (variant) {
            if (Boolean(applied.variantCreated) || Boolean(before.variantCreated)) {
                await this.operations.updateVariant(
                    ctx,
                    {
                        productVariantId: variant.id,
                        stockLocationId: appliedStockLocationId,
                        stockOnHand: Number(before.stockOnHand ?? 0),
                        currencyCode: job.currencyCode,
                    },
                    true,
                );
                await this.productVariantService.update(ctx, [{ id: variant.id, enabled: false }]);
            } else {
                const variantTranslation =
                    variant.translations?.find(item => item.languageCode === ctx.languageCode) ??
                    variant.translations?.[0];
                await this.productVariantService.update(ctx, [
                    {
                        id: variant.id,
                        enabled: Boolean(before.variantEnabled),
                        sku: stringValue(before.sku) || variant.sku,
                        prices:
                            before.sellingPrice == null
                                ? undefined
                                : [
                                      {
                                          currencyCode: job.currencyCode,
                                          price: Number(before.sellingPrice),
                                      },
                                  ],
                        customFields: {
                            ...((variant.customFields ?? {}) as unknown as Record<string, unknown>),
                            barcode: before.barcode ?? null,
                            specification: before.specification ?? null,
                            saleUnit: before.saleUnit ?? null,
                            purchaseUnit: before.purchaseUnit ?? null,
                            packageQuantity: before.packageQuantity ?? 1,
                            shelfLifeDays: before.shelfLifeDays ?? null,
                        },
                        ...(variantTranslation && typeof before.variantName === 'string'
                            ? {
                                  translations: [
                                      {
                                          id: variantTranslation.id,
                                          languageCode: variantTranslation.languageCode,
                                          name: before.variantName,
                                      },
                                  ],
                              }
                            : {}),
                    },
                ]);
                await this.operations.updateVariant(
                    ctx,
                    {
                        productVariantId: variant.id,
                        stockLocationId: appliedStockLocationId,
                        stockOnHand: Number(before.stockOnHand ?? 0),
                        minimumStock: nullableNumber(before.minimumStock),
                        maximumStock: nullableNumber(before.maximumStock),
                        currencyCode: job.currencyCode,
                    },
                    true,
                );
                await this.connection.getRepository(ctx, VariantCostRecord).delete({
                    variantId: variant.id,
                    channelId: ctx.channelId,
                    currencyCode: job.currencyCode,
                    source: 'IMPORT',
                    sourceReference: String(row.id),
                });
                if (before.purchaseCostMicrounits != null) {
                    await this.operations.recordCost(
                        ctx,
                        variant.id,
                        job.currencyCode,
                        Number(before.purchaseCostMicrounits),
                        'ROLLBACK',
                        String(job.id),
                    );
                }
            }
            const priorSupplierId = stringValue(before.supplierId);
            await this.suppliers.setVariantSupplier(ctx, variant.id, priorSupplierId || null);
        }
        if (product) {
            if (Boolean(before.productCreated)) {
                await this.productService.update(ctx, {
                    id: product.id,
                    expectedUpdatedAt: product.updatedAt,
                    enabled: false,
                });
            } else {
                const translation =
                    product.translations.find(item => item.languageCode === ctx.languageCode) ??
                    product.translations[0];
                await this.productService.update(ctx, {
                    id: product.id,
                    expectedUpdatedAt: product.updatedAt,
                    enabled:
                        typeof before.productEnabled === 'boolean' ? before.productEnabled : product.enabled,
                    facetValueIds: stringArray(before.productFacetValueIds).map(value => value as ID),
                    customFields: {
                        ...((product.customFields ?? {}) as unknown as Record<string, unknown>),
                        ...(before.productFulfillmentType
                            ? { fulfillmentType: before.productFulfillmentType }
                            : {}),
                        sourceCreatedAt: dateValue(before.productSourceCreatedAt),
                    },
                    ...(translation
                        ? {
                              translations: [
                                  {
                                      id: translation.id,
                                      languageCode: translation.languageCode,
                                      name:
                                          typeof before.productName === 'string'
                                              ? before.productName
                                              : translation.name,
                                      slug:
                                          typeof before.productSlug === 'string' && before.productSlug
                                              ? before.productSlug
                                              : translation.slug,
                                      description:
                                          typeof before.productDescription === 'string'
                                              ? before.productDescription
                                              : translation.description,
                                  },
                              ],
                          }
                        : {}),
                });
            }
            await this.categories.moveImportedCategory(
                ctx,
                product.id,
                stringValue(applied.importCategory),
                stringValue(before.productImportCategory),
            );
        }
        if (applied.lotId) {
            const previousLot = recordValue(before.inventoryLot);
            if (previousLot) {
                await this.connection.getRepository(ctx, InventoryLot).update(applied.lotId, {
                    lotCode: stringValue(previousLot.lotCode),
                    manufacturedAt: dateValue(previousLot.manufacturedAt),
                    expiresAt: dateValue(previousLot.expiresAt),
                    quantityOnHand: numberValue(previousLot.quantityOnHand) ?? 0,
                    purchaseCostMicrounits:
                        previousLot.purchaseCostMicrounits == null
                            ? null
                            : stringOrNumberValue(previousLot.purchaseCostMicrounits) || null,
                    currencyCode: (stringValue(previousLot.currencyCode) || job.currencyCode) as CurrencyCode,
                    state: stringValue(previousLot.state) || 'ACTIVE',
                });
            } else {
                await this.connection.getRepository(ctx, InventoryLot).update(applied.lotId, {
                    quantityOnHand: 0,
                    state: 'VOID',
                });
            }
        }
        const appliedSupplierId = stringValue(applied.supplierId);
        if (Boolean(applied.supplierCreated) && appliedSupplierId) {
            await this.suppliers.disableIfUnused(ctx, appliedSupplierId);
        }
        const priorBinding = recordValue(before.sourceBinding);
        if (priorBinding) {
            await this.connection.getRepository(ctx, CatalogSourceBinding).upsert(
                {
                    channelId: ctx.channelId,
                    sourceKey: row.sourceKey,
                    productId: String(priorBinding.productId) as ID,
                    variantId: String(priorBinding.variantId) as ID,
                    lastFingerprint: String(priorBinding.lastFingerprint),
                    lastFileHash: String(priorBinding.lastFileHash),
                },
                ['channelId', 'sourceKey'],
            );
        } else {
            await this.connection.getRepository(ctx, CatalogSourceBinding).delete({
                channelId: ctx.channelId,
                sourceKey: row.sourceKey,
                lastFileHash: job.fileHash,
            });
        }
        row.message = '已安全回滚；导入创建且已有引用的商品仅被禁用';
        await this.connection.getRepository(ctx, CatalogImportRow).save(row);
    }
}
