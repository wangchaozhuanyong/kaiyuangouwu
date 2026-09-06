import { GlobalFlag } from '@vendure/common/lib/generated-types';
import { normalizeString } from '@vendure/common/lib/normalize-string';
import { ID } from '@vendure/common/lib/shared-types';
import {
    FacetService,
    FacetValue,
    FacetValueService,
    Product,
    ProductService,
    ProductVariant,
    ProductVariantService,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { IsNull } from 'typeorm';

import { normalizeIdentity } from './catalog-file-parser.service';
import { CatalogImportCategoryService } from './catalog-import-category.service';
import {
    dateString,
    effectiveVariantEnabled,
    facetNames,
    nullableNumber,
    shortCode,
    shouldClear,
    stringValue,
} from './catalog-import-helpers';
import { CatalogImportOptionsService } from './catalog-import-options.service';
import {
    effectiveStockLocation,
    microunits,
    money,
    productDescriptionForCreate,
    variantCustomFieldUpdates,
    variantCustomFields,
    variantDisplayName,
    variantExecutionKey,
} from './catalog-import-planning';
import { CatalogImportPreview } from './catalog-import-preview';
import { CatalogOperationsService } from './catalog-operations.service';
import { resolveImportExecutionVariantId } from './catalog-row-identity';
import { CatalogSupplierService } from './catalog-supplier.service';
import { CatalogImportJob } from './entities/catalog-import-job.entity';
import { CatalogImportRow } from './entities/catalog-import-row.entity';
import { CatalogSourceBinding } from './entities/catalog-source-binding.entity';
import { InventoryLot } from './entities/inventory-lot.entity';
import { NormalizedCatalogRow } from './types';

export class CatalogImportWriter {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly productService: ProductService,
        private readonly importOptions: CatalogImportOptionsService,
        private readonly productVariantService: ProductVariantService,
        private readonly operations: CatalogOperationsService,
        private readonly suppliers: CatalogSupplierService,
        private readonly categories: CatalogImportCategoryService,
        private readonly facetService: FacetService,
        private readonly facetValueService: FacetValueService,
        private readonly preview: CatalogImportPreview,
    ) {}

    async applyRow(
        ctx: RequestContext,
        job: CatalogImportJob,
        row: CatalogImportRow,
        productByKey: Map<string, ID>,
        variantByKey: Map<string, ID>,
        stockLocations: Array<{ id: string; name: string }>,
        multiVariantProductKeys: Set<string>,
    ): Promise<void> {
        const stockLocation = effectiveStockLocation(
            row.normalizedData.stockLocationCode,
            job.stockLocationId,
            stockLocations,
        );
        if (!stockLocation) throw new UserInputError('导入行的仓库已不属于当前门店');
        const stockLocationId = stockLocation.id as ID;
        let productId = row.targetProductId ?? productByKey.get(row.productKey) ?? null;
        let product: Product | undefined;
        let variant: ProductVariant | undefined;
        const productCreated = !productId;
        const productAlreadyHandled =
            productId != null && String(productByKey.get(row.productKey)) === String(productId);
        if (productId) {
            product =
                (await this.connection.getRepository(ctx, Product).findOne({
                    where: { id: productId, deletedAt: IsNull() },
                    relations: ['translations', 'facetValues', 'facetValues.facet'],
                })) ?? undefined;
            if (!product) throw new UserInputError('预览中的商品已不存在');
            if (
                row.expectedProductUpdatedAt &&
                !productAlreadyHandled &&
                row.resolution !== 'UPDATE_EXISTING' &&
                product.updatedAt.getTime() !== row.expectedProductUpdatedAt.getTime()
            ) {
                throw new UserInputError('商品在预览后被修改，请重新创建预览');
            }
        } else {
            const newProductFacetValueIds = await this.resolveFacetValues(ctx, row.normalizedData);
            const created = await this.productService.create(ctx, {
                enabled: row.normalizedData.enabled ?? true,
                facetValueIds: newProductFacetValueIds,
                customFields: {
                    sourceCreatedAt: row.normalizedData.sourceCreatedAt
                        ? new Date(row.normalizedData.sourceCreatedAt)
                        : null,
                },
                translations: [
                    {
                        languageCode: ctx.languageCode,
                        name: row.normalizedData.name,
                        slug: await this.uniqueSlug(ctx, row.normalizedData.name),
                        description: productDescriptionForCreate(row.normalizedData),
                    },
                ],
            });
            productId = created.id;
            product =
                (await this.connection.getRepository(ctx, Product).findOne({
                    where: { id: created.id },
                    relations: ['translations', 'facetValues', 'facetValues.facet'],
                })) ?? undefined;
            productByKey.set(row.productKey, productId);
        }
        if (!product || !productId) throw new UserInputError('无法创建或加载商品');

        const executionVariantKey = variantExecutionKey(row.normalizedData);
        const executionVariantId = resolveImportExecutionVariantId(
            row.resolution,
            row.targetVariantId,
            variantByKey.get(executionVariantKey),
            row.plannedChanges?.forceCreateNew === true,
        );
        const variantAlreadyHandled =
            executionVariantId != null &&
            String(variantByKey.get(executionVariantKey)) === String(executionVariantId);
        if (executionVariantId) {
            variant =
                (await this.connection.getRepository(ctx, ProductVariant).findOne({
                    where: { id: executionVariantId, deletedAt: IsNull() },
                    relations: ['productVariantPrices', 'translations'],
                })) ?? undefined;
            if (!variant || String(variant.productId) !== String(product.id)) {
                throw new UserInputError('预览中的 SKU 已不存在');
            }
            if (
                row.expectedVariantUpdatedAt &&
                !variantAlreadyHandled &&
                row.resolution !== 'UPDATE_EXISTING' &&
                variant.updatedAt.getTime() !== row.expectedVariantUpdatedAt.getTime()
            ) {
                throw new UserInputError('SKU 在预览后被修改，请重新创建预览');
            }
        }
        const variantCreated = !variant;

        const existingBinding = await this.connection.getRepository(ctx, CatalogSourceBinding).findOne({
            where: { channelId: ctx.channelId, sourceKey: row.sourceKey },
        });
        const before: Record<string, unknown> = {
            ...(row.beforeSnapshot ?? {
                productId: String(product.id),
                productCreated,
                variantCreated,
                productName:
                    product.translations.find(translation => translation.languageCode === ctx.languageCode)
                        ?.name ??
                    product.translations[0]?.name ??
                    '',
                productSlug:
                    product.translations.find(translation => translation.languageCode === ctx.languageCode)
                        ?.slug ??
                    product.translations[0]?.slug ??
                    '',
                productEnabled: product.enabled,
                productDescription:
                    product.translations.find(translation => translation.languageCode === ctx.languageCode)
                        ?.description ?? '',
                productFacetValueIds: product.facetValues?.map(value => String(value.id)) ?? [],
                productImportCategory: facetNames(product.facetValues, 'catalog-import-category')[0] ?? null,
                variantName:
                    variant?.translations.find(translation => translation.languageCode === ctx.languageCode)
                        ?.name ??
                    variant?.translations[0]?.name ??
                    '',
                productSourceCreatedAt: dateString(
                    ((product.customFields ?? {}) as Record<string, unknown>).sourceCreatedAt,
                ),
            }),
            sourceBinding: existingBinding
                ? {
                      productId: String(existingBinding.productId),
                      variantId: String(existingBinding.variantId),
                      lastFingerprint: existingBinding.lastFingerprint,
                      lastFileHash: existingBinding.lastFileHash,
                  }
                : null,
        };
        const shouldApplyProductField = (field: string) =>
            row.action === 'CREATE' || row.plannedChanges?.[field] != null;
        const replaceBrand =
            shouldApplyProductField('brand') &&
            (Boolean(row.normalizedData.brand) ||
                shouldClear(row.normalizedData, 'brand', job.clearBlankFields));
        const replaceTags =
            shouldApplyProductField('tags') &&
            (row.normalizedData.tags.length > 0 ||
                shouldClear(row.normalizedData, 'tags', job.clearBlankFields));
        const replaceCategory = shouldApplyProductField('category') && Boolean(row.normalizedData.category);
        const facetValueIds =
            replaceBrand || replaceTags || replaceCategory
                ? await this.resolveFacetValues(ctx, {
                      ...row.normalizedData,
                      brand: replaceBrand ? row.normalizedData.brand : '',
                      tags: replaceTags ? row.normalizedData.tags : [],
                      category: replaceCategory ? row.normalizedData.category : '',
                  })
                : [];
        const retainedFacetValueIds = (product.facetValues ?? [])
            .filter(value => {
                const code = value.facet?.code;
                return !(
                    (replaceBrand && code === 'catalog-brand') ||
                    (replaceTags && code === 'catalog-tag') ||
                    (replaceCategory && code === 'catalog-import-category')
                );
            })
            .map(value => value.id);
        const nextFacetValueIds = [...new Set([...retainedFacetValueIds, ...facetValueIds])];
        const replaceDescription =
            shouldApplyProductField('productDescription') &&
            (Boolean(row.normalizedData.description) ||
                shouldClear(row.normalizedData, 'description', job.clearBlankFields));
        const productTranslation =
            product.translations.find(item => item.languageCode === ctx.languageCode) ??
            product.translations[0];
        const replaceName =
            shouldApplyProductField('productName') &&
            Boolean(row.normalizedData.name) &&
            row.normalizedData.name !== productTranslation?.name;
        const replaceSourceCreatedAt =
            shouldApplyProductField('sourceCreatedAt') &&
            (Boolean(row.normalizedData.sourceCreatedAt) ||
                shouldClear(row.normalizedData, 'sourceCreatedAt', job.clearBlankFields));
        const replaceProductEnabled =
            shouldApplyProductField('productEnabled') && row.normalizedData.enabled != null;
        if (
            !productCreated &&
            (replaceDescription ||
                replaceName ||
                replaceSourceCreatedAt ||
                replaceProductEnabled ||
                replaceBrand ||
                replaceTags ||
                replaceCategory)
        ) {
            await this.productService.update(ctx, {
                id: product.id,
                expectedUpdatedAt: product.updatedAt,
                ...(replaceProductEnabled ? { enabled: row.normalizedData.enabled ?? undefined } : {}),
                facetValueIds: nextFacetValueIds,
                ...(replaceSourceCreatedAt
                    ? {
                          customFields: {
                              ...((product.customFields ?? {}) as Record<string, unknown>),
                              sourceCreatedAt: row.normalizedData.sourceCreatedAt
                                  ? new Date(row.normalizedData.sourceCreatedAt)
                                  : null,
                          },
                      }
                    : {}),
                ...(replaceDescription || replaceName
                    ? {
                          translations: [
                              {
                                  id: productTranslation?.id,
                                  languageCode: productTranslation?.languageCode ?? ctx.languageCode,
                                  name: replaceName
                                      ? row.normalizedData.name
                                      : (productTranslation?.name ?? row.normalizedData.name),
                                  slug:
                                      productTranslation?.slug ??
                                      (await this.uniqueSlug(ctx, row.normalizedData.name)),
                                  description: replaceDescription
                                      ? row.normalizedData.description
                                      : (productTranslation?.description ?? ''),
                              },
                          ],
                      }
                    : {}),
            });
        }

        if (!variant) {
            const sku = await this.uniqueSku(ctx, row.normalizedData.sku, row.sourceKey);
            const optionIds = await this.importOptions.ensureImportVariantOptions(
                ctx,
                product,
                row.sourceKey,
                sku,
                multiVariantProductKeys.has(row.productKey),
            );
            const created = await this.productVariantService.create(ctx, [
                {
                    productId: product.id,
                    enabled: effectiveVariantEnabled(row.normalizedData) ?? true,
                    sku,
                    optionIds,
                    price: money(row.normalizedData.sellingPrice),
                    prices: [
                        {
                            currencyCode: job.currencyCode,
                            price: money(row.normalizedData.sellingPrice),
                        },
                    ],
                    translations: [
                        {
                            languageCode: ctx.languageCode,
                            name: variantDisplayName(row.normalizedData),
                        },
                    ],
                    trackInventory: GlobalFlag.TRUE,
                    stockLevels:
                        row.normalizedData.stockOnHand == null
                            ? undefined
                            : [
                                  {
                                      stockLocationId,
                                      stockOnHand: Math.max(0, row.normalizedData.stockOnHand),
                                  },
                              ],
                    customFields: variantCustomFields(row.normalizedData),
                },
            ]);
            variant = created[0];
            if (row.normalizedData.stockOnHand != null && row.normalizedData.stockOnHand < 0) {
                await this.operations.updateVariant(
                    ctx,
                    {
                        productVariantId: variant.id,
                        stockLocationId,
                        stockOnHand: row.normalizedData.stockOnHand,
                        currencyCode: job.currencyCode,
                    },
                    row.resolution === 'APPLY',
                );
            }
        } else {
            const customFields = {
                ...((variant.customFields ?? {}) as Record<string, unknown>),
                ...variantCustomFieldUpdates(row.normalizedData, job.clearBlankFields),
            };
            const variantEnabled = effectiveVariantEnabled(row.normalizedData);
            const variantTranslation =
                variant.translations?.find(item => item.languageCode === ctx.languageCode) ??
                variant.translations?.[0];
            const clearSpecification = shouldClear(row.normalizedData, 'specification', job.clearBlankFields);
            const clearUnit = shouldClear(row.normalizedData, 'primaryUnit', job.clearBlankFields);
            const shouldUpdateVariantName = Boolean(
                row.normalizedData.name ||
                row.normalizedData.specification ||
                row.normalizedData.primaryUnit ||
                clearSpecification ||
                clearUnit,
            );
            const currentCustomFields = (variant.customFields ?? {}) as Record<string, unknown>;
            const nextVariantName = variantDisplayName({
                ...row.normalizedData,
                name:
                    row.normalizedData.name ||
                    productTranslation?.name ||
                    variantTranslation?.name ||
                    variant.sku,
                specification:
                    row.normalizedData.specification ||
                    (clearSpecification ? '' : stringValue(currentCustomFields.specification)),
                primaryUnit:
                    row.normalizedData.primaryUnit ||
                    (clearUnit ? '' : stringValue(currentCustomFields.saleUnit)),
            });
            await this.productVariantService.update(ctx, [
                {
                    id: variant.id,
                    ...(variantEnabled != null ? { enabled: variantEnabled } : {}),
                    ...(row.normalizedData.sku ? { sku: row.normalizedData.sku } : {}),
                    ...(shouldUpdateVariantName && variantTranslation?.name !== nextVariantName
                        ? {
                              translations: [
                                  {
                                      id: variantTranslation?.id,
                                      languageCode: variantTranslation?.languageCode ?? ctx.languageCode,
                                      name: nextVariantName,
                                  },
                              ],
                          }
                        : {}),
                    ...(row.normalizedData.sellingPrice != null
                        ? {
                              prices: [
                                  {
                                      currencyCode: job.currencyCode,
                                      price: money(row.normalizedData.sellingPrice),
                                  },
                              ],
                          }
                        : {}),
                    customFields,
                },
            ]);
            if (row.normalizedData.stockOnHand != null) {
                await this.operations.updateVariant(
                    ctx,
                    {
                        productVariantId: variant.id,
                        stockLocationId,
                        stockOnHand: row.normalizedData.stockOnHand,
                        currencyCode: job.currencyCode,
                    },
                    row.resolution === 'APPLY',
                );
            }
        }

        if (!variant) throw new UserInputError('无法创建或加载 SKU');
        let supplierCreated = false;
        let appliedSupplierId: ID | null = null;
        const updateSupplier =
            Boolean(row.normalizedData.supplier) ||
            shouldClear(row.normalizedData, 'supplier', job.clearBlankFields);
        if (updateSupplier) {
            const existingSupplier = row.normalizedData.supplier
                ? await this.suppliers.findByName(ctx, row.normalizedData.supplier)
                : null;
            const supplier = row.normalizedData.supplier
                ? (existingSupplier ?? (await this.suppliers.ensureByName(ctx, row.normalizedData.supplier)))
                : null;
            supplierCreated = Boolean(supplier && !existingSupplier);
            appliedSupplierId = supplier?.id ?? null;
            await this.suppliers.setVariantSupplier(ctx, variant.id, appliedSupplierId);
        }
        if (row.normalizedData.purchaseCost != null) {
            await this.operations.recordCost(
                ctx,
                variant.id,
                job.currencyCode,
                microunits(row.normalizedData.purchaseCost),
                'IMPORT',
                String(row.id),
            );
        }
        const updateMinimumStock =
            row.normalizedData.minimumStock != null ||
            shouldClear(row.normalizedData, 'minimumStock', job.clearBlankFields);
        const updateMaximumStock =
            row.normalizedData.maximumStock != null ||
            shouldClear(row.normalizedData, 'maximumStock', job.clearBlankFields);
        if (updateMinimumStock || updateMaximumStock) {
            await this.operations.savePolicy(
                ctx,
                variant.id,
                stockLocationId,
                updateMinimumStock ? row.normalizedData.minimumStock : nullableNumber(before.minimumStock),
                updateMaximumStock ? row.normalizedData.maximumStock : nullableNumber(before.maximumStock),
            );
        }
        let lotId: ID | null = null;
        if (row.normalizedData.manufacturedAt || row.normalizedData.lotCode) {
            const manufacturedAt = row.normalizedData.manufacturedAt
                ? new Date(row.normalizedData.manufacturedAt)
                : null;
            const expiresAt =
                manufacturedAt && row.normalizedData.shelfLifeDays != null
                    ? new Date(manufacturedAt.getTime() + row.normalizedData.shelfLifeDays * 86_400_000)
                    : null;
            const lotCode = row.normalizedData.lotCode || `IMPORT-${String(job.id)}-${row.rowNumber}`;
            const existingLot = await this.connection.getRepository(ctx, InventoryLot).findOne({
                where: {
                    variantId: variant.id,
                    stockLocationId,
                    lotCode,
                },
            });
            before.inventoryLot = existingLot
                ? {
                      id: String(existingLot.id),
                      lotCode: existingLot.lotCode,
                      manufacturedAt: dateString(existingLot.manufacturedAt),
                      expiresAt: dateString(existingLot.expiresAt),
                      quantityOnHand: existingLot.quantityOnHand,
                      purchaseCostMicrounits: existingLot.purchaseCostMicrounits,
                      currencyCode: existingLot.currencyCode,
                      state: existingLot.state,
                  }
                : null;
            const lot = await this.operations.saveLot(
                ctx,
                {
                    productVariantId: variant.id,
                    stockLocationId,
                    lotCode,
                    manufacturedAt,
                    expiresAt,
                    quantityOnHand: Math.max(
                        row.normalizedData.lotQuantity ?? row.normalizedData.stockOnHand ?? 0,
                        0,
                    ),
                    purchaseCostMicrounits:
                        row.normalizedData.purchaseCost == null
                            ? null
                            : microunits(row.normalizedData.purchaseCost),
                    currencyCode: job.currencyCode,
                },
                row.normalizedData.lotQuantity != null && row.normalizedData.stockOnHand == null,
            );
            lotId = lot.id;
        }
        if (replaceCategory) {
            await this.categories.moveImportedCategory(
                ctx,
                product.id,
                stringValue(before.productImportCategory),
                row.normalizedData.category,
            );
        }
        await this.connection.getRepository(ctx, CatalogSourceBinding).upsert(
            {
                channelId: ctx.channelId,
                sourceKey: row.sourceKey,
                productId: product.id,
                variantId: variant.id,
                lastFingerprint: row.rowFingerprint,
                lastFileHash: job.fileHash,
            },
            ['channelId', 'sourceKey'],
        );
        row.targetProductId = product.id;
        row.targetVariantId = variant.id;
        row.beforeSnapshot = before;
        const refreshedVariant = await this.connection.getRepository(ctx, ProductVariant).findOne({
            where: { id: variant.id, deletedAt: IsNull() },
            relations: ['productVariantPrices'],
        });
        if (!refreshedVariant) throw new UserInputError('导入后无法读取 SKU 快照');
        const afterSnapshot = await this.preview.snapshotVariant(ctx, refreshedVariant, {
            stockLocationId,
            currencyCode: job.currencyCode,
        });
        row.appliedSnapshot = {
            productId: String(product.id),
            variantId: String(variant.id),
            productCreated,
            variantCreated,
            stockLocationId: String(stockLocationId),
            lotId: lotId ? String(lotId) : null,
            supplierId: appliedSupplierId ? String(appliedSupplierId) : null,
            supplierCreated,
            importCategory: row.normalizedData.category || null,
            afterSnapshot,
        };
        row.appliedAt = new Date();
        row.message = row.action === 'CREATE' ? '新增成功' : '更新成功';
        productByKey.set(row.productKey, product.id);
        variantByKey.set(executionVariantKey, variant.id);
        await this.connection.getRepository(ctx, CatalogImportRow).save(row);
    }

    async resolveFacetValues(ctx: RequestContext, row: NormalizedCatalogRow): Promise<ID[]> {
        const values: ID[] = [];
        if (row.category) {
            values.push(
                await this.ensureFacetValue(
                    ctx,
                    'catalog-import-category',
                    '导入分类标记',
                    row.category,
                    true,
                ),
            );
        }
        if (row.brand) values.push(await this.ensureFacetValue(ctx, 'catalog-brand', '品牌', row.brand));
        for (const tag of row.tags) values.push(await this.ensureFacetValue(ctx, 'catalog-tag', '标签', tag));
        return values;
    }

    async ensureFacetValue(
        ctx: RequestContext,
        facetCode: string,
        facetName: string,
        value: string,
        isPrivate = false,
    ): Promise<ID> {
        let facet = await this.facetService.findByCode(ctx, facetCode, ctx.languageCode);
        if (!facet) {
            facet = await this.facetService.create(ctx, {
                code: facetCode,
                isPrivate,
                translations: [{ languageCode: ctx.languageCode, name: facetName }],
            });
        }
        const existing = await this.connection.getRepository(ctx, FacetValue).find({
            where: { facet: { id: facet.id } },
            relations: ['translations'],
        });
        const match = existing.find(item =>
            item.translations.some(
                translation => normalizeIdentity(translation.name) === normalizeIdentity(value),
            ),
        );
        if (match) return match.id;
        const created = await this.facetValueService.create(ctx, facet, {
            facetId: facet.id,
            code: `${facetCode}-${shortCode(value)}`,
            translations: [{ languageCode: ctx.languageCode, name: value }],
        });
        return created.id;
    }

    async uniqueSlug(ctx: RequestContext, name: string): Promise<string> {
        const base = normalizeString(name, '-').slice(0, 100) || `product-${shortCode(name)}`;
        for (let index = 0; index < 100; index++) {
            const slug = index === 0 ? base : `${base}-${index + 1}`;
            if (!(await this.productService.findOneBySlug(ctx, slug))) return slug;
        }
        return `${base}-${Date.now()}`;
    }

    async uniqueSku(ctx: RequestContext, preferred: string, sourceKey: string): Promise<string> {
        const base = preferred.trim() || `IMP-${sourceKey.slice(0, 12).toUpperCase()}`;
        for (let index = 0; index < 100; index++) {
            const sku = index === 0 ? base : `${base}-${index + 1}`;
            const exists = await this.connection.getRepository(ctx, ProductVariant).findOne({
                where: { sku, deletedAt: IsNull() },
            });
            if (!exists) return sku;
        }
        throw new UserInputError('无法生成唯一 SKU，请在文件中填写商品编码');
    }
}
