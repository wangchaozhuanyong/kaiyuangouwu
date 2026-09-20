import { CurrencyCode } from '@vendure/common/lib/generated-types';
import {
    Collection,
    Product,
    ProductVariant,
    RequestContext,
    StockLevel,
    TransactionalConnection,
} from '@vendure/core';
import { IsNull } from 'typeorm';

import { normalizeIdentity } from './catalog-file-parser.service';
import {
    catalogCategoryPath,
    catalogCollectionPath,
    catalogImportTypeError,
    preferredCatalogCategoryPath,
    splitCatalogCategoryPath,
} from './catalog-import-classification';
import {
    clearsVariantIdentity,
    dateString,
    effectiveVariantEnabled,
    facetNames,
    numberValue,
    shouldClear,
    stringArray,
    stringValue,
} from './catalog-import-helpers';
import {
    type PlannedRow,
    changed,
    changedOptional,
    conflictPlan,
    createChanges,
    emptyPlan,
    microunits,
    money,
    validationWarning,
    variantMatches,
    warningPlan,
} from './catalog-import-planning';
import { CatalogSupplierService, normalizeSupplierName } from './catalog-supplier.service';
import { CatalogImportJob } from './entities/catalog-import-job.entity';
import { CatalogSourceBinding } from './entities/catalog-source-binding.entity';
import { CatalogSupplier } from './entities/catalog-supplier.entity';
import { InventoryPolicy } from './entities/inventory-policy.entity';
import { VariantCostRecord } from './entities/variant-cost-record.entity';
import { CatalogImportContextInput, NormalizedCatalogRow } from './types';
export interface CatalogIndexProduct {
    product: Product;
    productKeyNames: Set<string>;
    categories: Set<string>;
}

export interface CatalogIndex {
    products: CatalogIndexProduct[];
    categoryPaths: Set<string>;
    childCategoryParents: Map<string, Set<string>>;
}

export class CatalogImportPreview {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly suppliers: CatalogSupplierService,
    ) {}

    async planRow(
        ctx: RequestContext,
        row: NormalizedCatalogRow,
        input: CatalogImportContextInput,
        catalogIndex: CatalogIndex,
        binding?: CatalogSourceBinding,
        suppliersByName: Map<string, CatalogSupplier> = new Map(),
    ): Promise<PlannedRow> {
        const typeError = catalogImportTypeError(ctx, row);
        if (typeError) return { ...emptyPlan('ERROR'), message: typeError };
        const warnings = [validationWarning(row)];
        const categoryExists =
            Boolean(row.category) &&
            catalogIndex.categoryPaths.has(normalizeIdentity(catalogCategoryPath(row)));
        const supplier = suppliersByName.get(normalizeSupplierName(row.supplier));
        if (row.supplier && !supplier) warnings.push(`供货商“${row.supplier}”不存在，确认后将创建`);
        if (supplier && !supplier.enabled) warnings.push(`供货商“${supplier.name}”已停用`);
        const warningMessage = () =>
            warnings.filter((value): value is string => Boolean(value)).join('；') || null;
        let targetProduct: Product | undefined;
        let targetVariant: ProductVariant | undefined;
        if (row.sku) {
            const variants = catalogIndex.products
                .flatMap(item => item.product.variants)
                .filter(variant => variant.sku === row.sku);
            if (variants.length > 1) return conflictPlan('SKU 匹配到多个商品，请先清理重复 SKU');
            targetVariant = variants[0];
            targetProduct = targetVariant
                ? catalogIndex.products.find(
                      item => String(item.product.id) === String(targetVariant?.productId),
                  )?.product
                : undefined;
        } else if (row.barcode) {
            const variants = catalogIndex.products
                .flatMap(item => item.product.variants)
                .filter(
                    variant =>
                        normalizeIdentity(
                            stringValue(
                                ((variant.customFields ?? {}) as unknown as Record<string, unknown>).barcode,
                            ),
                        ) === normalizeIdentity(row.barcode),
                );
            if (variants.length > 1) return conflictPlan('条码匹配到多个商品，请先清理重复条码');
            targetVariant = variants[0];
            targetProduct = targetVariant
                ? catalogIndex.products.find(
                      item => String(item.product.id) === String(targetVariant?.productId),
                  )?.product
                : undefined;
        } else if (binding) {
            targetProduct = catalogIndex.products.find(
                item => String(item.product.id) === String(binding.productId),
            )?.product;
            targetVariant = targetProduct?.variants.find(
                variant => String(variant.id) === String(binding.variantId),
            );
            if (!targetProduct || !targetVariant) return conflictPlan('历史来源绑定指向的商品已经不存在');
        } else {
            const name = normalizeIdentity(row.name);
            const category = normalizeIdentity(catalogCategoryPath(row));
            const products = catalogIndex.products.filter(
                item =>
                    item.productKeyNames.has(name) &&
                    item.categories.has(category) &&
                    (!row.fulfillmentType ||
                        ((item.product.customFields as unknown as Record<string, unknown>)?.fulfillmentType ??
                            'digital') === row.fulfillmentType),
            );
            if (products.length > 1) return conflictPlan('名称和分类匹配到多个商品');
            targetProduct = products[0]?.product;
            if (targetProduct) {
                const variants = targetProduct.variants.filter(variant => variantMatches(variant, row));
                if (variants.length > 1) return conflictPlan('规格和单位匹配到多个 SKU');
                targetVariant = variants[0];
                if (!targetVariant && clearsVariantIdentity(row, Boolean(input.clearBlankFields))) {
                    if (targetProduct.variants.length > 1) {
                        return conflictPlan('清空规格或单位时无法唯一确定 SKU，请人工选择');
                    }
                    targetVariant = targetProduct.variants[0];
                }
            }
        }

        if (!targetVariant) {
            const currentCategory = targetProduct
                ? (facetNames(targetProduct.facetValues, 'catalog-import-category')[0] ?? '')
                : '';
            const createCategoryError = catalogCategoryMutationError(
                row,
                catalogIndex,
                currentCategory,
                Boolean(targetProduct),
            );
            if (createCategoryError) return conflictPlan(createCategoryError);
            if (row.category && !categoryExists && !targetProduct) {
                warnings.push('分类不存在，确认后将随新商品创建');
            }
            const missingCreateFields = [
                !row.name ? '名称' : null,
                !row.fulfillmentType ? '商品类型' : null,
                !row.category ? '分类' : null,
                row.purchaseCost == null ? '进货价' : null,
                row.sellingPrice == null ? '销售价' : null,
            ].filter((value): value is string => Boolean(value));
            if (missingCreateFields.length > 0) {
                return {
                    ...emptyPlan('ERROR'),
                    targetProductId: targetProduct?.id ?? null,
                    expectedProductUpdatedAt: targetProduct?.updatedAt ?? null,
                    message: `新建商品或 SKU 缺少必填字段：${missingCreateFields.join('、')}`,
                };
            }
            const createPlan: PlannedRow = {
                action: 'CREATE',
                targetProductId: targetProduct?.id ?? null,
                targetVariantId: null,
                expectedProductUpdatedAt: targetProduct?.updatedAt ?? null,
                expectedVariantUpdatedAt: null,
                beforeSnapshot: targetProduct
                    ? {
                          productId: String(targetProduct.id),
                          productCreated: false,
                          variantCreated: true,
                          productName:
                              targetProduct.translations.find(
                                  translation => translation.languageCode === ctx.languageCode,
                              )?.name ??
                              targetProduct.translations[0]?.name ??
                              '',
                          productSlug:
                              targetProduct.translations.find(
                                  translation => translation.languageCode === ctx.languageCode,
                              )?.slug ??
                              targetProduct.translations[0]?.slug ??
                              '',
                          productEnabled: targetProduct.enabled,
                          productFulfillmentType:
                              (targetProduct.customFields as unknown as Record<string, unknown>)
                                  ?.fulfillmentType ?? 'digital',
                          productDescription:
                              targetProduct.translations.find(
                                  translation => translation.languageCode === ctx.languageCode,
                              )?.description ?? '',
                          productFacetValueIds:
                              targetProduct.facetValues?.map(value => String(value.id)) ?? [],
                          productCategories: [
                              ...new Set(
                                  targetProduct.variants.flatMap(variant =>
                                      variant.collections.map(collection =>
                                          catalogCollectionPath(collection, String(ctx.languageCode)),
                                      ),
                                  ),
                              ),
                          ].filter(Boolean),
                          productImportCategory:
                              preferredCatalogCategoryPath(
                                  facetNames(targetProduct.facetValues, 'catalog-import-category')[0],
                                  targetProduct.variants.flatMap(variant =>
                                      variant.collections.map(collection =>
                                          catalogCollectionPath(collection, String(ctx.languageCode)),
                                      ),
                                  ),
                              ) || null,
                          productSourceCreatedAt: dateString(
                              ((targetProduct.customFields ?? {}) as unknown as Record<string, unknown>)
                                  .sourceCreatedAt,
                          ),
                      }
                    : null,
                plannedChanges: { safeAction: 'CREATE', ...createChanges(row, input.currencyCode) },
                message: targetProduct ? '将在现有商品下创建新 SKU' : '将创建商品和 SKU',
            };
            const createWarning = warningMessage();
            return createWarning ? warningPlan(createPlan, createWarning) : createPlan;
        }
        const snapshot = await this.snapshotVariant(ctx, targetVariant, {
            channelId: ctx.channelId,
            stockLocationId: input.stockLocationId,
            currencyCode: input.currencyCode,
        } as CatalogImportJob);
        const updateCategoryError = catalogCategoryMutationError(
            row,
            catalogIndex,
            stringValue(snapshot.productImportCategory),
            true,
        );
        if (updateCategoryError) return conflictPlan(updateCategoryError);
        const changes = this.diffRow(row, snapshot, input.currencyCode, Boolean(input.clearBlankFields));
        if (Object.keys(changes).filter(key => key !== 'safeAction').length === 0) {
            return {
                action: 'SKIP_UNCHANGED',
                targetProductId: targetProduct?.id ?? targetVariant.productId,
                targetVariantId: targetVariant.id,
                expectedProductUpdatedAt: targetProduct?.updatedAt ?? null,
                expectedVariantUpdatedAt: targetVariant.updatedAt,
                beforeSnapshot: snapshot,
                plannedChanges: null,
                message: '现有商品数值完全一致',
            };
        }
        const plan: PlannedRow = {
            action: 'UPDATE',
            targetProductId: targetProduct?.id ?? targetVariant.productId,
            targetVariantId: targetVariant.id,
            expectedProductUpdatedAt: targetProduct?.updatedAt ?? null,
            expectedVariantUpdatedAt: targetVariant.updatedAt,
            beforeSnapshot: snapshot,
            plannedChanges: { safeAction: 'UPDATE', ...changes },
            message: '将只更新发生变化的字段',
        };
        const updateWarning = warningMessage();
        return updateWarning ? warningPlan(plan, updateWarning) : plan;
    }

    async snapshotVariant(
        ctx: RequestContext,
        variant: ProductVariant,
        job: Pick<CatalogImportJob, 'stockLocationId' | 'currencyCode'>,
    ): Promise<Record<string, unknown>> {
        const [product, variantDetails, stock, cost, policy, supplierBinding] = await Promise.all([
            this.connection.getRepository(ctx, Product).findOne({
                where: { id: variant.productId },
                relations: ['translations', 'facetValues', 'facetValues.facet'],
            }),
            this.connection.getRepository(ctx, ProductVariant).findOne({
                where: { id: variant.id, deletedAt: IsNull() },
                relations: [
                    'translations',
                    'collections',
                    'collections.translations',
                    'collections.parent',
                    'collections.parent.translations',
                ],
            }),
            this.connection.getRepository(ctx, StockLevel).findOne({
                where: { productVariantId: variant.id, stockLocationId: job.stockLocationId },
            }),
            this.connection.getRepository(ctx, VariantCostRecord).findOne({
                where: { variantId: variant.id, channelId: ctx.channelId, currencyCode: job.currencyCode },
                order: { effectiveAt: 'DESC', id: 'DESC' },
            }),
            this.connection.getRepository(ctx, InventoryPolicy).findOne({
                where: { variantId: variant.id, stockLocationId: job.stockLocationId },
            }),
            this.suppliers.association(ctx, variant.id),
        ]);
        const customFields = (variant.customFields ?? {}) as unknown as Record<string, unknown>;
        const productCustomFields = (product?.customFields ?? {}) as unknown as Record<string, unknown>;
        const productTranslation =
            product?.translations.find(item => item.languageCode === ctx.languageCode) ??
            product?.translations[0];
        const variantTranslation =
            variantDetails?.translations.find(item => item.languageCode === ctx.languageCode) ??
            variantDetails?.translations[0];
        const productCategories = [
            ...new Set(
                (variantDetails?.collections ?? [])
                    .map(collection => catalogCollectionPath(collection, String(ctx.languageCode)))
                    .filter(Boolean),
            ),
        ].sort((left, right) => left.localeCompare(right, 'zh-Hans'));
        const productImportCategory = preferredCatalogCategoryPath(
            facetNames(product?.facetValues, 'catalog-import-category')[0],
            productCategories,
        );
        const price = variant.productVariantPrices?.find(
            item =>
                String(item.channelId) === String(ctx.channelId) && item.currencyCode === job.currencyCode,
        );
        return {
            productId: String(variant.productId),
            variantId: String(variant.id),
            productUpdatedAt: product?.updatedAt.toISOString() ?? null,
            variantUpdatedAt: variant.updatedAt.toISOString(),
            productName: productTranslation?.name ?? '',
            productSlug: productTranslation?.slug ?? '',
            productEnabled: product?.enabled ?? true,
            productFulfillmentType: productCustomFields.fulfillmentType ?? 'digital',
            productDescription: productTranslation?.description ?? '',
            productCategories,
            productImportCategory: productImportCategory || null,
            productFacetValueIds: product?.facetValues?.map(value => String(value.id)) ?? [],
            productBrand: facetNames(product?.facetValues, 'catalog-brand')[0] ?? null,
            productTags: facetNames(product?.facetValues, 'catalog-tag'),
            productSourceCreatedAt: dateString(productCustomFields.sourceCreatedAt),
            sku: variant.sku,
            variantName: variantTranslation?.name ?? '',
            variantEnabled: variant.enabled,
            barcode: stringValue(customFields.barcode),
            specification: stringValue(customFields.specification),
            saleUnit: stringValue(customFields.saleUnit),
            purchaseUnit: stringValue(customFields.purchaseUnit),
            packageQuantity: numberValue(customFields.packageQuantity) ?? 1,
            shelfLifeDays: numberValue(customFields.shelfLifeDays),
            supplierId: supplierBinding ? String(supplierBinding.supplierId) : null,
            supplierName: supplierBinding?.supplier.name ?? null,
            supplierEnabled: supplierBinding?.supplier.enabled ?? null,
            sellingPrice: price?.price ?? null,
            currencyCode: job.currencyCode,
            purchaseCostMicrounits: cost ? Number(cost.costMicrounits) : null,
            stockOnHand: stock?.stockOnHand ?? 0,
            minimumStock: policy?.minimumStock ?? null,
            maximumStock: policy?.maximumStock ?? null,
            productCreated: false,
            variantCreated: false,
        };
    }

    diffRow(
        row: NormalizedCatalogRow,
        snapshot: Record<string, unknown>,
        currencyCode: CurrencyCode,
        clearBlankFields: boolean,
    ): Record<string, unknown> {
        const changes: Record<string, unknown> = {};
        changed(changes, 'productName', row.name, snapshot.productName);
        changed(
            changes,
            'category',
            catalogCategoryPath(row),
            snapshot.productImportCategory ?? stringArray(snapshot.productCategories)[0] ?? null,
        );
        changed(changes, 'fulfillmentType', row.fulfillmentType, snapshot.productFulfillmentType);
        changed(changes, 'productEnabled', row.enabled, snapshot.productEnabled);
        changed(changes, 'variantEnabled', effectiveVariantEnabled(row), snapshot.variantEnabled);
        changedOptional(
            changes,
            'productDescription',
            row.description,
            snapshot.productDescription,
            shouldClear(row, 'description', clearBlankFields),
            '',
        );
        if (row.sku) changed(changes, 'sku', row.sku, snapshot.sku);
        changedOptional(
            changes,
            'barcode',
            row.barcode,
            snapshot.barcode,
            shouldClear(row, 'barcode', clearBlankFields),
        );
        changedOptional(
            changes,
            'specification',
            row.specification,
            snapshot.specification,
            shouldClear(row, 'specification', clearBlankFields),
        );
        if (row.primaryUnit || shouldClear(row, 'primaryUnit', clearBlankFields)) {
            changedOptional(changes, 'saleUnit', row.primaryUnit, snapshot.saleUnit, true);
        }
        if (row.purchaseUnit || shouldClear(row, 'purchaseUnit', clearBlankFields)) {
            changedOptional(changes, 'purchaseUnit', row.purchaseUnit, snapshot.purchaseUnit, true);
        }
        changed(changes, 'packageQuantity', row.packageQuantity, snapshot.packageQuantity);
        changedOptional(
            changes,
            'shelfLifeDays',
            row.shelfLifeDays,
            snapshot.shelfLifeDays,
            shouldClear(row, 'shelfLifeDays', clearBlankFields),
        );
        if (row.sellingPrice != null) {
            changed(changes, 'sellingPrice', money(row.sellingPrice), snapshot.sellingPrice);
        }
        if (row.purchaseCost != null) {
            changed(
                changes,
                'purchaseCostMicrounits',
                microunits(row.purchaseCost),
                snapshot.purchaseCostMicrounits,
            );
        }
        changed(changes, 'stockOnHand', row.stockOnHand, snapshot.stockOnHand);
        changedOptional(
            changes,
            'minimumStock',
            row.minimumStock,
            snapshot.minimumStock,
            shouldClear(row, 'minimumStock', clearBlankFields),
        );
        changedOptional(
            changes,
            'maximumStock',
            row.maximumStock,
            snapshot.maximumStock,
            shouldClear(row, 'maximumStock', clearBlankFields),
        );
        changedOptional(
            changes,
            'brand',
            row.brand || null,
            snapshot.productBrand,
            shouldClear(row, 'brand', clearBlankFields),
        );
        changedOptional(
            changes,
            'tags',
            row.tags.length > 0 ? row.tags : null,
            snapshot.productTags,
            shouldClear(row, 'tags', clearBlankFields),
            [],
        );
        changedOptional(
            changes,
            'sourceCreatedAt',
            row.sourceCreatedAt,
            snapshot.productSourceCreatedAt,
            shouldClear(row, 'sourceCreatedAt', clearBlankFields),
        );
        changedOptional(
            changes,
            'supplier',
            row.supplier || null,
            snapshot.supplierName,
            shouldClear(row, 'supplier', clearBlankFields),
        );
        if (row.manufacturedAt || row.lotCode) changes.inventoryLot = { from: null, to: true };
        changes.currencyCode = currencyCode;
        if (Object.keys(changes).length === 1) return {};
        return changes;
    }

    async buildCatalogIndex(ctx: RequestContext): Promise<CatalogIndex> {
        const productQuery = this.connection
            .getRepository(ctx, Product)
            .createQueryBuilder('product')
            .leftJoinAndSelect('product.translations', 'productTranslation')
            .leftJoinAndSelect('product.facetValues', 'productFacetValue')
            .leftJoinAndSelect('productFacetValue.facet', 'productFacet')
            .leftJoinAndSelect('product.variants', 'variant', 'variant.deletedAt IS NULL')
            .leftJoinAndSelect('variant.translations', 'variantTranslation')
            .leftJoinAndSelect('variant.productVariantPrices', 'variantPrice')
            .leftJoinAndSelect('variant.collections', 'collection')
            .leftJoinAndSelect('collection.translations', 'collectionTranslation')
            .leftJoinAndSelect('collection.parent', 'collectionParent')
            .leftJoinAndSelect('collectionParent.translations', 'collectionParentTranslation')
            .innerJoin('product.channels', 'channel', 'channel.id = :channelId', { channelId: ctx.channelId })
            .where('product.deletedAt IS NULL');
        const collectionQuery = this.connection
            .getRepository(ctx, Collection)
            .createQueryBuilder('collection')
            .leftJoinAndSelect('collection.translations', 'collectionTranslation')
            .leftJoinAndSelect('collection.parent', 'collectionParent')
            .leftJoinAndSelect('collectionParent.translations', 'collectionParentTranslation')
            .innerJoin('collection.channels', 'collectionChannel', 'collectionChannel.id = :channelId', {
                channelId: ctx.channelId,
            })
            .where('collection.isRoot = :isRoot', { isRoot: false });
        const [products, collections] = await Promise.all([
            productQuery.getMany(),
            collectionQuery.getMany(),
        ]);
        const categoryPaths = new Set<string>();
        const childCategoryParents = new Map<string, Set<string>>();
        for (const collection of collections) {
            const path = catalogCollectionPath(collection, String(ctx.languageCode));
            if (!path) continue;
            categoryPaths.add(normalizeIdentity(path));
            const { category, secondaryCategory } = splitCatalogCategoryPath(path);
            if (!secondaryCategory) {
                continue;
            }
            const key = normalizeIdentity(secondaryCategory);
            const parents = childCategoryParents.get(key) ?? new Set<string>();
            parents.add(category);
            childCategoryParents.set(key, parents);
        }
        return {
            products: products.map(product => ({
                product,
                productKeyNames: new Set(
                    product.translations.map(translation => normalizeIdentity(translation.name)),
                ),
                categories: new Set(
                    product.variants.flatMap(variant =>
                        variant.collections
                            .map(collection =>
                                normalizeIdentity(
                                    catalogCollectionPath(collection, String(ctx.languageCode)),
                                ),
                            )
                            .filter(Boolean),
                    ),
                ),
            })),
            categoryPaths,
            childCategoryParents,
        };
    }
}

function catalogCategoryMutationError(
    row: NormalizedCatalogRow,
    catalogIndex: CatalogIndex,
    currentCategory: string,
    targetsExistingProduct: boolean,
): string | null {
    const requestedCategory = catalogCategoryPath(row);
    if (!requestedCategory) return null;
    if (normalizeIdentity(requestedCategory) === normalizeIdentity(currentCategory)) return null;

    const conflictingParents = catalogIndex.childCategoryParents.get(normalizeIdentity(row.category));
    if (conflictingParents?.size) {
        return `一级分类“${row.category}”已作为“${[...conflictingParents].join('、')}”的二级分类存在，禁止提升为一级分类；请补充正确的一级分类`;
    }
    if (targetsExistingProduct && !catalogIndex.categoryPaths.has(normalizeIdentity(requestedCategory))) {
        return `已有商品的目标分类“${requestedCategory}”不存在；维护导入禁止自动创建分类，请先在分类管理中建立并复核层级`;
    }
    return null;
}
