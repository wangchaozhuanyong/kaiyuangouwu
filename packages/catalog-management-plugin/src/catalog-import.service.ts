import { Injectable } from '@nestjs/common';
import { CurrencyCode, GlobalFlag } from '@vendure/common/lib/generated-types';
import { normalizeString } from '@vendure/common/lib/normalize-string';
import { ID } from '@vendure/common/lib/shared-types';
import {
    Collection,
    CollectionService,
    FacetService,
    FacetValue,
    FacetValueService,
    Product,
    ProductService,
    ProductVariant,
    ProductVariantService,
    RequestContext,
    SearchService,
    StockLevel,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { In, IsNull, Not } from 'typeorm';

import {
    CatalogFileParserService,
    catalogProductKey,
    catalogRowFingerprint,
    catalogSourceKey,
    normalizeIdentity,
} from './catalog-file-parser.service';
import { CatalogOperationsService } from './catalog-operations.service';
import { CatalogImportJob } from './entities/catalog-import-job.entity';
import { CatalogImportRow } from './entities/catalog-import-row.entity';
import { CatalogSourceBinding } from './entities/catalog-source-binding.entity';
import { InventoryLot } from './entities/inventory-lot.entity';
import { InventoryPolicy } from './entities/inventory-policy.entity';
import { VariantCostRecord } from './entities/variant-cost-record.entity';
import {
    CatalogImportAction,
    CatalogImportContextInput,
    NormalizedCatalogRow,
    ResolveCatalogImportRowInput,
    UploadedCatalogFile,
} from './types';

interface CatalogIndexProduct {
    product: Product;
    productKeyNames: Set<string>;
    categories: Set<string>;
}

interface PlannedRow {
    action: CatalogImportAction;
    targetProductId: ID | null;
    targetVariantId: ID | null;
    expectedProductUpdatedAt: Date | null;
    expectedVariantUpdatedAt: Date | null;
    beforeSnapshot: Record<string, unknown> | null;
    plannedChanges: Record<string, unknown> | null;
    message: string | null;
}

@Injectable()
export class CatalogImportService {
    private enqueue?: (jobId: ID) => Promise<void>;

    constructor(
        private readonly connection: TransactionalConnection,
        private readonly parser: CatalogFileParserService,
        private readonly operations: CatalogOperationsService,
        private readonly productService: ProductService,
        private readonly productVariantService: ProductVariantService,
        private readonly collectionService: CollectionService,
        private readonly facetService: FacetService,
        private readonly facetValueService: FacetValueService,
        private readonly searchService: SearchService,
    ) {}

    registerEnqueuer(enqueue: (jobId: ID) => Promise<void>): void {
        this.enqueue = enqueue;
    }

    async createPreview(
        ctx: RequestContext,
        file: Promise<UploadedCatalogFile>,
        input: CatalogImportContextInput,
    ): Promise<CatalogImportJob> {
        this.assertContext(ctx, input);
        const targetStockLocation = await this.operations.requireStockLocation(ctx, input.stockLocationId);
        const parsed = await this.parser.parseUpload(file);
        const fileInfo = await file;
        const repository = this.connection.getRepository(ctx, CatalogImportJob);
        const existing = await repository.findOne({
            where: {
                channelId: ctx.channelId,
                stockLocationId: input.stockLocationId,
                currencyCode: input.currencyCode,
                clearBlankFields: Boolean(input.clearBlankFields),
                fileHash: parsed.fileHash,
                state: Not('ROLLED_BACK'),
            },
            order: { createdAt: 'DESC' },
        });
        if (existing) return this.findJob(ctx, existing.id);

        const job = await repository.save(
            new CatalogImportJob({
                channelId: ctx.channelId,
                stockLocationId: input.stockLocationId,
                currencyCode: input.currencyCode,
                clearBlankFields: Boolean(input.clearBlankFields),
                originalFilename: fileInfo.filename.replace(/[\\/\0]/g, '_').slice(0, 255),
                mimeType: fileInfo.mimetype || 'application/octet-stream',
                byteSize: parsed.byteSize,
                fileHash: parsed.fileHash,
                sheetName: parsed.sheetName.slice(0, 255),
                detectedHeaders: parsed.headers,
                fieldMapping: parsed.fieldMapping,
                state: 'PREVIEW_READY',
                actorId: ctx.activeUserId ? String(ctx.activeUserId) : null,
                totalRows: parsed.rows.length + parsed.errors.length,
                progress: 0,
            }),
        );
        try {
            const [catalogIndex, bindings] = await Promise.all([
                this.buildCatalogIndex(ctx),
                this.connection.getRepository(ctx, CatalogSourceBinding).find({
                    where: {
                        channelId: ctx.channelId,
                        sourceKey: In([...new Set(parsed.rows.map(catalogSourceKey))]),
                    },
                }),
            ]);
            const bindingMap = new Map(bindings.map(binding => [binding.sourceKey, binding]));
            const duplicateGroups = groupRows(parsed.rows);
            const importRows: CatalogImportRow[] = [];
            for (const row of parsed.rows) {
                const sourceKey = catalogSourceKey(row);
                const duplicateRows = duplicateGroups.get(sourceKey) ?? [];
                const fingerprints = new Set(duplicateRows.map(catalogRowFingerprint));
                let plan: PlannedRow;
                const scopeError = importScopeError(row, ctx, input, targetStockLocation);
                if (scopeError) {
                    plan = { ...emptyPlan('ERROR'), message: scopeError };
                } else if (fingerprints.size > 1) {
                    plan = conflictPlan('同一商品、分类、规格和单位在文件中出现不同数值，请人工确认');
                } else if (duplicateRows[0]?.rowNumber !== row.rowNumber) {
                    plan = {
                        ...emptyPlan('SKIP_UNCHANGED'),
                        message: `与第 ${duplicateRows[0]?.rowNumber ?? row.rowNumber} 行完全重复，已跳过`,
                    };
                } else {
                    plan = await this.planRow(ctx, row, input, catalogIndex, bindingMap.get(sourceKey));
                }
                importRows.push(
                    new CatalogImportRow({
                        jobId: job.id,
                        rowNumber: row.rowNumber,
                        productKey: catalogProductKey(row),
                        sourceKey,
                        rowFingerprint: catalogRowFingerprint(row),
                        action: plan.action,
                        resolution: null,
                        targetProductId: plan.targetProductId,
                        targetVariantId: plan.targetVariantId,
                        expectedProductUpdatedAt: plan.expectedProductUpdatedAt,
                        expectedVariantUpdatedAt: plan.expectedVariantUpdatedAt,
                        normalizedData: row,
                        beforeSnapshot: plan.beforeSnapshot as any,
                        plannedChanges: plan.plannedChanges as any,
                        appliedSnapshot: null,
                        message: plan.message,
                        appliedAt: null,
                    }),
                );
            }
            for (const error of parsed.errors) {
                importRows.push(
                    new CatalogImportRow({
                        jobId: job.id,
                        rowNumber: error.rowNumber,
                        productKey: error.errorKey,
                        sourceKey: error.errorKey,
                        rowFingerprint: error.errorKey,
                        action: 'ERROR',
                        resolution: null,
                        targetProductId: null,
                        targetVariantId: null,
                        expectedProductUpdatedAt: null,
                        expectedVariantUpdatedAt: null,
                        normalizedData: error.normalizedData,
                        beforeSnapshot: null,
                        plannedChanges: null,
                        appliedSnapshot: null,
                        message: error.message,
                        appliedAt: null,
                    }),
                );
            }
            importRows.sort((left, right) => left.rowNumber - right.rowNumber);
            for (let index = 0; index < importRows.length; index += 250) {
                await this.connection
                    .getRepository(ctx, CatalogImportRow)
                    .save(importRows.slice(index, index + 250));
            }
            await this.refreshCounts(ctx, job.id);
            return this.findJob(ctx, job.id);
        } catch (error) {
            await repository.update(job.id, {
                state: 'FAILED',
                errorMessage: safeMessage(error),
                completedAt: new Date(),
            });
            throw error;
        }
    }

    async findJob(ctx: RequestContext, id: ID): Promise<CatalogImportJob> {
        const job = await this.connection.getRepository(ctx, CatalogImportJob).findOne({
            where: { id, channelId: ctx.channelId },
            relations: ['stockLocation'],
        });
        if (!job) throw new UserInputError('导入任务不存在或不属于当前门店');
        return job;
    }

    async findJobs(ctx: RequestContext, skip = 0, take = 20) {
        const safeTake = Math.min(Math.max(take, 1), 100);
        const [items, totalItems] = await this.connection.getRepository(ctx, CatalogImportJob).findAndCount({
            where: { channelId: ctx.channelId },
            relations: ['stockLocation'],
            order: { createdAt: 'DESC' },
            skip: Math.max(skip, 0),
            take: safeTake,
        });
        return { items, totalItems };
    }

    async findRows(ctx: RequestContext, jobId: ID, action?: CatalogImportAction | null) {
        await this.findJob(ctx, jobId);
        return this.connection.getRepository(ctx, CatalogImportRow).find({
            where: { jobId, ...(action ? { action } : {}) },
            order: { rowNumber: 'ASC' },
            take: 20_000,
        });
    }

    async resolveRow(ctx: RequestContext, input: ResolveCatalogImportRowInput): Promise<CatalogImportRow> {
        const repository = this.connection.getRepository(ctx, CatalogImportRow);
        const row = await repository.findOne({ where: { id: input.rowId }, relations: ['job'] });
        if (!row || String(row.job.channelId) !== String(ctx.channelId)) {
            throw new UserInputError('导入行不存在或不属于当前门店');
        }
        if (row.job.state !== 'PREVIEW_READY') throw new UserInputError('只有预览中的任务可以处理冲突');
        if (!['CONFLICT', 'WARNING', 'ERROR'].includes(row.action)) {
            throw new UserInputError('这一行不需要人工处理');
        }
        if (input.resolution === 'SKIP') {
            row.action = 'SKIP_UNCHANGED';
            row.resolution = 'SKIP';
            row.message = '管理员选择跳过';
        } else if (input.resolution === 'APPLY') {
            const safeActionValue = row.plannedChanges?.safeAction;
            const safeAction = typeof safeActionValue === 'string' ? safeActionValue : '';
            if (row.action !== 'WARNING' || !['CREATE', 'UPDATE'].includes(safeAction)) {
                throw new UserInputError('只有警告行可以选择继续应用');
            }
            row.action = safeAction as CatalogImportAction;
            row.resolution = 'APPLY';
            row.message = '管理员已确认警告并允许执行';
        } else if (input.resolution === 'CREATE_NEW') {
            row.action = 'CREATE';
            row.resolution = 'CREATE_NEW';
            row.targetProductId = null;
            row.targetVariantId = null;
            row.expectedProductUpdatedAt = null;
            row.expectedVariantUpdatedAt = null;
            row.plannedChanges = { ...(row.plannedChanges ?? {}), safeAction: 'CREATE' };
            row.message = '管理员选择新建商品或 SKU';
        } else {
            if (!input.targetVariantId) throw new UserInputError('请选择要更新的 SKU');
            const variant = await this.connection.getEntityOrThrow(
                ctx,
                ProductVariant,
                input.targetVariantId,
                {
                    channelId: ctx.channelId,
                },
            );
            const snapshot = await this.snapshotVariant(ctx, variant, row.job);
            row.action = 'UPDATE';
            row.resolution = 'UPDATE_EXISTING';
            row.targetProductId = variant.productId;
            row.targetVariantId = variant.id;
            row.expectedProductUpdatedAt = null;
            row.expectedVariantUpdatedAt = variant.updatedAt;
            row.beforeSnapshot = snapshot;
            row.plannedChanges = this.diffRow(
                row.normalizedData,
                snapshot,
                row.job.currencyCode,
                row.job.clearBlankFields,
            );
            row.message = '管理员已指定要更新的 SKU';
        }
        const saved = await repository.save(row);
        await this.refreshCounts(ctx, row.jobId);
        return saved;
    }

    async queueExecution(ctx: RequestContext, id: ID): Promise<CatalogImportJob> {
        const job = await this.findJob(ctx, id);
        if (job.state !== 'PREVIEW_READY' && job.state !== 'FAILED') {
            throw new UserInputError('当前任务状态不能执行');
        }
        const unresolved = await this.connection.getRepository(ctx, CatalogImportRow).count({
            where: { jobId: id, action: In(['CONFLICT', 'WARNING']) },
        });
        if (unresolved > 0) throw new UserInputError(`还有 ${unresolved} 行冲突或警告未处理`);
        job.state = 'QUEUED';
        job.errorMessage = null;
        job.progress = 0;
        const saved = await this.connection.getRepository(ctx, CatalogImportJob).save(job);
        if (!this.enqueue) throw new UserInputError('导入队列尚未就绪，请稍后重试');
        await this.enqueue(job.id);
        return saved;
    }

    async executeJob(ctx: RequestContext, id: ID, onProgress: (progress: number) => void): Promise<void> {
        const repository = this.connection.getRepository(ctx, CatalogImportJob);
        const claimed = await repository.update(
            { id, state: 'QUEUED' },
            {
                state: 'RUNNING',
                startedAt: new Date(),
                errorMessage: null,
            },
        );
        if (claimed.affected !== 1) return;
        const job = await this.findJob(ctx, id);
        const rows = await this.findRows(ctx, id);
        const productByKey = new Map<string, ID>();
        for (const applied of rows.filter(row => row.appliedAt && row.targetProductId)) {
            productByKey.set(applied.productKey, applied.targetProductId as ID);
        }
        let processed = 0;
        for (const row of rows) {
            try {
                if (row.appliedAt || row.action === 'SKIP_UNCHANGED' || row.action === 'ERROR') {
                    processed++;
                    continue;
                }
                if (row.action !== 'CREATE' && row.action !== 'UPDATE') {
                    throw new UserInputError('存在未解决的冲突或警告');
                }
                await this.connection.withTransaction(ctx, async txCtx => {
                    await this.applyRow(txCtx, job, row, productByKey);
                });
            } catch (error) {
                row.action = 'ERROR';
                row.message = safeMessage(error);
                await this.connection.getRepository(ctx, CatalogImportRow).save(row);
            }
            processed++;
            const progress = Math.round((processed / Math.max(rows.length, 1)) * 100);
            await repository.update(id, { progress });
            onProgress(progress);
        }
        const errorCount = await this.connection.getRepository(ctx, CatalogImportRow).count({
            where: { jobId: id, action: In(['ERROR', 'CONFLICT', 'WARNING']) },
        });
        await this.refreshCounts(ctx, id);
        await repository.update(id, {
            state: errorCount > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED',
            progress: 100,
            completedAt: new Date(),
            errorMessage: errorCount > 0 ? `${errorCount} 行未执行，请查看报告` : null,
        });
        await this.searchService.reindex(ctx);
    }

    async rollback(ctx: RequestContext, id: ID): Promise<CatalogImportJob> {
        const job = await this.findJob(ctx, id);
        if (!['COMPLETED', 'COMPLETED_WITH_ERRORS'].includes(job.state)) {
            throw new UserInputError('只有已完成的任务可以回滚');
        }
        const rows = (await this.findRows(ctx, id)).filter(row => row.appliedAt).reverse();
        for (const row of rows) {
            await this.connection.withTransaction(ctx, async txCtx => this.rollbackRow(txCtx, job, row));
        }
        job.state = 'ROLLED_BACK';
        job.rolledBackAt = new Date();
        job.progress = 100;
        await this.connection.getRepository(ctx, CatalogImportJob).save(job);
        await this.searchService.reindex(ctx);
        return this.findJob(ctx, id);
    }

    standardTemplate(): string {
        return [
            [
                '名称（必填）',
                '分类（必填）',
                '门店编码',
                '仓库编码',
                '币种',
                'SKU',
                '条码',
                '规格',
                '主单位',
                '库存量',
                '进货价（必填）',
                '销售价（必填）',
                '库存上限',
                '库存下限',
                '品牌',
                '生产日期',
                '保质期',
                '批次号',
                '商品状态',
                '商品描述',
                '标签',
                '创建日期',
            ],
            [
                '示例商品',
                '示例分类',
                '',
                '',
                '',
                '',
                '',
                '500ml',
                '瓶',
                '10',
                '3.125',
                '5.00',
                '100',
                '10',
                '',
                '',
                '365',
                '',
                '启用',
                '',
                '',
                '',
            ],
        ]
            .map(row => row.map(csvCell).join(','))
            .join('\r\n');
    }

    async report(ctx: RequestContext, id: ID): Promise<string> {
        const job = await this.findJob(ctx, id);
        const rows = await this.findRows(ctx, id);
        return [
            [
                '行号',
                '结果',
                '处理选择',
                '商品名称',
                '分类',
                'SKU',
                '规格',
                '单位',
                '目标商品ID',
                '目标SKU ID',
                '说明',
                '应用时间',
                '文件摘要',
            ],
            ...rows.map(row => [
                String(row.rowNumber),
                row.action,
                row.resolution ?? '',
                row.normalizedData.name,
                row.normalizedData.category,
                row.normalizedData.sku,
                row.normalizedData.specification,
                row.normalizedData.primaryUnit,
                row.targetProductId ? String(row.targetProductId) : '',
                row.targetVariantId ? String(row.targetVariantId) : '',
                row.message ?? '',
                row.appliedAt?.toISOString() ?? '',
                job.fileHash,
            ]),
        ]
            .map(values => values.map(csvCell).join(','))
            .join('\r\n');
    }

    private async planRow(
        ctx: RequestContext,
        row: NormalizedCatalogRow,
        input: CatalogImportContextInput,
        catalogIndex: CatalogIndexProduct[],
        binding?: CatalogSourceBinding,
    ): Promise<PlannedRow> {
        const warnings = [validationWarning(row)];
        const categoryExists = catalogIndex.some(item =>
            item.categories.has(normalizeIdentity(row.category)),
        );
        if (!categoryExists) warnings.push('分类不存在，确认后将创建新分类');
        const warning = warnings.filter((value): value is string => Boolean(value)).join('；') || null;
        let targetProduct: Product | undefined;
        let targetVariant: ProductVariant | undefined;
        if (binding) {
            targetProduct = catalogIndex.find(
                item => String(item.product.id) === String(binding.productId),
            )?.product;
            targetVariant = targetProduct?.variants.find(
                variant => String(variant.id) === String(binding.variantId),
            );
            if (!targetProduct || !targetVariant) return conflictPlan('历史来源绑定指向的商品已经不存在');
        } else if (row.sku) {
            const variants = catalogIndex
                .flatMap(item => item.product.variants)
                .filter(variant => variant.sku === row.sku);
            if (variants.length > 1) return conflictPlan('SKU 匹配到多个商品，请先清理重复 SKU');
            targetVariant = variants[0];
            targetProduct = targetVariant
                ? catalogIndex.find(item => String(item.product.id) === String(targetVariant?.productId))
                      ?.product
                : undefined;
        } else {
            const name = normalizeIdentity(row.name);
            const category = normalizeIdentity(row.category);
            const products = catalogIndex.filter(
                item => item.productKeyNames.has(name) && item.categories.has(category),
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
                          productEnabled: targetProduct.enabled,
                          productDescription:
                              targetProduct.translations.find(
                                  translation => translation.languageCode === ctx.languageCode,
                              )?.description ?? '',
                          productFacetValueIds:
                              targetProduct.facetValues?.map(value => String(value.id)) ?? [],
                      }
                    : null,
                plannedChanges: { safeAction: 'CREATE', ...createChanges(row, input.currencyCode) },
                message: targetProduct ? '将在现有商品下创建新 SKU' : '将创建商品和 SKU',
            };
            return warning ? warningPlan(createPlan, warning) : createPlan;
        }
        const snapshot = await this.snapshotVariant(ctx, targetVariant, {
            channelId: ctx.channelId,
            stockLocationId: input.stockLocationId,
            currencyCode: input.currencyCode,
        } as CatalogImportJob);
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
        return warning ? warningPlan(plan, warning) : plan;
    }

    private async snapshotVariant(
        ctx: RequestContext,
        variant: ProductVariant,
        job: Pick<CatalogImportJob, 'stockLocationId' | 'currencyCode'>,
    ): Promise<Record<string, unknown>> {
        const [product, stock, cost, policy] = await Promise.all([
            this.connection.getRepository(ctx, Product).findOne({
                where: { id: variant.productId },
                relations: ['translations', 'facetValues', 'facetValues.facet'],
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
        ]);
        const customFields = (variant.customFields ?? {}) as Record<string, unknown>;
        const price = variant.productVariantPrices?.find(
            item =>
                String(item.channelId) === String(ctx.channelId) && item.currencyCode === job.currencyCode,
        );
        return {
            productId: String(variant.productId),
            variantId: String(variant.id),
            productUpdatedAt: product?.updatedAt.toISOString() ?? null,
            variantUpdatedAt: variant.updatedAt.toISOString(),
            productEnabled: product?.enabled ?? true,
            productDescription:
                product?.translations.find(t => t.languageCode === ctx.languageCode)?.description ?? '',
            productFacetValueIds: product?.facetValues?.map(value => String(value.id)) ?? [],
            productBrand: facetNames(product?.facetValues, 'catalog-brand')[0] ?? null,
            productTags: facetNames(product?.facetValues, 'catalog-tag'),
            sku: variant.sku,
            variantEnabled: variant.enabled,
            barcode: stringValue(customFields.barcode),
            specification: stringValue(customFields.specification),
            saleUnit: stringValue(customFields.saleUnit),
            purchaseUnit: stringValue(customFields.purchaseUnit),
            packageQuantity: numberValue(customFields.packageQuantity) ?? 1,
            shelfLifeDays: numberValue(customFields.shelfLifeDays),
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

    private diffRow(
        row: NormalizedCatalogRow,
        snapshot: Record<string, unknown>,
        currencyCode: CurrencyCode,
        clearBlankFields: boolean,
    ): Record<string, unknown> {
        const changes: Record<string, unknown> = {};
        changed(changes, 'productEnabled', row.enabled, snapshot.productEnabled);
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
            changedOptional(changes, 'purchaseUnit', row.primaryUnit, snapshot.purchaseUnit, true);
        }
        changedOptional(
            changes,
            'shelfLifeDays',
            row.shelfLifeDays,
            snapshot.shelfLifeDays,
            shouldClear(row, 'shelfLifeDays', clearBlankFields),
        );
        changed(changes, 'sellingPrice', money(row.sellingPrice), snapshot.sellingPrice);
        changed(
            changes,
            'purchaseCostMicrounits',
            microunits(row.purchaseCost),
            snapshot.purchaseCostMicrounits,
        );
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
        if (row.manufacturedAt || row.lotCode) changes.inventoryLot = { from: null, to: true };
        changes.currencyCode = currencyCode;
        if (Object.keys(changes).length === 1) return {};
        return changes;
    }

    private async applyRow(
        ctx: RequestContext,
        job: CatalogImportJob,
        row: CatalogImportRow,
        productByKey: Map<string, ID>,
    ): Promise<void> {
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
                translations: [
                    {
                        languageCode: ctx.languageCode,
                        name: row.normalizedData.name,
                        slug: await this.uniqueSlug(ctx, row.normalizedData.name),
                        description: row.normalizedData.description,
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

        if (row.targetVariantId) {
            variant =
                (await this.connection.getRepository(ctx, ProductVariant).findOne({
                    where: { id: row.targetVariantId, deletedAt: IsNull() },
                    relations: ['productVariantPrices'],
                })) ?? undefined;
            if (!variant || String(variant.productId) !== String(product.id)) {
                throw new UserInputError('预览中的 SKU 已不存在');
            }
            if (
                row.expectedVariantUpdatedAt &&
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
                productEnabled: product.enabled,
                productDescription:
                    product.translations.find(translation => translation.languageCode === ctx.languageCode)
                        ?.description ?? '',
                productFacetValueIds: product.facetValues?.map(value => String(value.id)) ?? [],
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
        const facetValueIds = await this.resolveFacetValues(ctx, row.normalizedData);
        const replaceBrand =
            Boolean(row.normalizedData.brand) ||
            shouldClear(row.normalizedData, 'brand', job.clearBlankFields);
        const replaceTags =
            row.normalizedData.tags.length > 0 ||
            shouldClear(row.normalizedData, 'tags', job.clearBlankFields);
        const retainedFacetValueIds = (product.facetValues ?? [])
            .filter(value => {
                const code = value.facet?.code;
                return !(
                    (replaceBrand && code === 'catalog-brand') ||
                    (replaceTags && code === 'catalog-tag')
                );
            })
            .map(value => value.id);
        const nextFacetValueIds = [...new Set([...retainedFacetValueIds, ...facetValueIds])];
        const replaceDescription =
            Boolean(row.normalizedData.description) ||
            shouldClear(row.normalizedData, 'description', job.clearBlankFields);
        if (
            !productCreated &&
            (replaceDescription || row.normalizedData.enabled != null || replaceBrand || replaceTags)
        ) {
            const translation =
                product.translations.find(item => item.languageCode === ctx.languageCode) ??
                product.translations[0];
            await this.productService.update(ctx, {
                id: product.id,
                expectedUpdatedAt: product.updatedAt,
                ...(row.normalizedData.enabled != null ? { enabled: row.normalizedData.enabled } : {}),
                facetValueIds: nextFacetValueIds,
                ...(replaceDescription
                    ? {
                          translations: [
                              {
                                  id: translation?.id,
                                  languageCode: translation?.languageCode ?? ctx.languageCode,
                                  name: translation?.name ?? row.normalizedData.name,
                                  slug:
                                      translation?.slug ??
                                      (await this.uniqueSlug(ctx, row.normalizedData.name)),
                                  description: row.normalizedData.description,
                              },
                          ],
                      }
                    : {}),
            });
        }

        if (!variant) {
            const sku = await this.uniqueSku(ctx, row.normalizedData.sku, row.sourceKey);
            const created = await this.productVariantService.create(ctx, [
                {
                    productId: product.id,
                    enabled: row.normalizedData.enabled ?? true,
                    sku,
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
                                      stockLocationId: job.stockLocationId,
                                      stockOnHand: row.normalizedData.stockOnHand,
                                  },
                              ],
                    customFields: variantCustomFields(row.normalizedData),
                },
            ]);
            variant = created[0];
        } else {
            const customFields = {
                ...((variant.customFields ?? {}) as Record<string, unknown>),
                ...variantCustomFieldUpdates(row.normalizedData, job.clearBlankFields),
            };
            await this.productVariantService.update(ctx, [
                {
                    id: variant.id,
                    ...(row.normalizedData.enabled != null ? { enabled: row.normalizedData.enabled } : {}),
                    ...(row.normalizedData.sku ? { sku: row.normalizedData.sku } : {}),
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
                await this.operations.updateVariant(ctx, {
                    productVariantId: variant.id,
                    stockLocationId: job.stockLocationId,
                    stockOnHand: row.normalizedData.stockOnHand,
                    currencyCode: job.currencyCode,
                });
            }
        }

        if (!variant) throw new UserInputError('无法创建或加载 SKU');
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
                job.stockLocationId,
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
            const lot = await this.operations.saveLot(
                ctx,
                {
                    productVariantId: variant.id,
                    stockLocationId: job.stockLocationId,
                    lotCode: row.normalizedData.lotCode || `IMPORT-${String(job.id)}-${row.rowNumber}`,
                    manufacturedAt,
                    expiresAt,
                    quantityOnHand: Math.max(row.normalizedData.stockOnHand ?? 0, 0),
                    purchaseCostMicrounits: microunits(row.normalizedData.purchaseCost),
                    currencyCode: job.currencyCode,
                },
                false,
            );
            lotId = lot.id;
        }
        await this.assignCategory(ctx, product.id, row.normalizedData.category);
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
        row.appliedSnapshot = {
            productId: String(product.id),
            variantId: String(variant.id),
            productCreated,
            variantCreated,
            lotId: lotId ? String(lotId) : null,
        };
        row.appliedAt = new Date();
        row.message = row.action === 'CREATE' ? '新增成功' : '更新成功';
        productByKey.set(row.productKey, product.id);
        await this.connection.getRepository(ctx, CatalogImportRow).save(row);
    }

    private async rollbackRow(
        ctx: RequestContext,
        job: CatalogImportJob,
        row: CatalogImportRow,
    ): Promise<void> {
        const before = row.beforeSnapshot ?? {};
        const applied = row.appliedSnapshot ?? {};
        const variantId = row.targetVariantId;
        const productId = row.targetProductId;
        if (!variantId || !productId) return;
        const variant = await this.connection.getRepository(ctx, ProductVariant).findOne({
            where: { id: variantId, deletedAt: IsNull() },
        });
        const product = await this.connection.getRepository(ctx, Product).findOne({
            where: { id: productId, deletedAt: IsNull() },
            relations: ['translations', 'facetValues'],
        });
        if (variant) {
            if (Boolean(applied.variantCreated) || Boolean(before.variantCreated)) {
                await this.productVariantService.update(ctx, [{ id: variant.id, enabled: false }]);
            } else {
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
                            ...((variant.customFields ?? {}) as Record<string, unknown>),
                            barcode: before.barcode ?? null,
                            specification: before.specification ?? null,
                            saleUnit: before.saleUnit ?? null,
                            purchaseUnit: before.purchaseUnit ?? null,
                            packageQuantity: before.packageQuantity ?? 1,
                            shelfLifeDays: before.shelfLifeDays ?? null,
                        },
                    },
                ]);
                await this.operations.updateVariant(ctx, {
                    productVariantId: variant.id,
                    stockLocationId: job.stockLocationId,
                    stockOnHand: Number(before.stockOnHand ?? 0),
                    minimumStock: nullableNumber(before.minimumStock),
                    maximumStock: nullableNumber(before.maximumStock),
                    currencyCode: job.currencyCode,
                });
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
                    ...(translation
                        ? {
                              translations: [
                                  {
                                      id: translation.id,
                                      languageCode: translation.languageCode,
                                      name: translation.name,
                                      slug: translation.slug,
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
        }
        if (applied.lotId) {
            await this.connection.getRepository(ctx, InventoryLot).update(applied.lotId, {
                quantityOnHand: 0,
                state: 'VOID',
            });
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

    private async buildCatalogIndex(ctx: RequestContext): Promise<CatalogIndexProduct[]> {
        const products = await this.connection
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
            .innerJoin('product.channels', 'channel', 'channel.id = :channelId', { channelId: ctx.channelId })
            .where('product.deletedAt IS NULL')
            .getMany();
        return products.map(product => ({
            product,
            productKeyNames: new Set(
                product.translations.map(translation => normalizeIdentity(translation.name)),
            ),
            categories: new Set(
                product.variants.flatMap(variant =>
                    variant.collections.flatMap(collection =>
                        collection.translations.map(translation => normalizeIdentity(translation.name)),
                    ),
                ),
            ),
        }));
    }

    private async resolveFacetValues(ctx: RequestContext, row: NormalizedCatalogRow): Promise<ID[]> {
        const values: ID[] = [];
        if (row.brand) values.push(await this.ensureFacetValue(ctx, 'catalog-brand', '品牌', row.brand));
        for (const tag of row.tags) values.push(await this.ensureFacetValue(ctx, 'catalog-tag', '标签', tag));
        return values;
    }

    private async ensureFacetValue(
        ctx: RequestContext,
        facetCode: string,
        facetName: string,
        value: string,
    ): Promise<ID> {
        let facet = await this.facetService.findByCode(ctx, facetCode, ctx.languageCode);
        if (!facet) {
            facet = await this.facetService.create(ctx, {
                code: facetCode,
                isPrivate: false,
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

    private async assignCategory(ctx: RequestContext, productId: ID, category: string): Promise<void> {
        const collections = await this.connection
            .getRepository(ctx, Collection)
            .createQueryBuilder('collection')
            .leftJoinAndSelect('collection.translations', 'translation')
            .innerJoin('collection.channels', 'channel', 'channel.id = :channelId', {
                channelId: ctx.channelId,
            })
            .where('collection.isRoot = :isRoot', { isRoot: false })
            .getMany();
        let collection = collections.find(item =>
            item.translations.some(
                translation => normalizeIdentity(translation.name) === normalizeIdentity(category),
            ),
        );
        if (!collection) {
            collection = await this.collectionService.create(ctx, {
                inheritFilters: true,
                filters: [manualProductFilter([String(productId)])],
                translations: [
                    {
                        languageCode: ctx.languageCode,
                        name: category,
                        slug: await this.uniqueCollectionSlug(ctx, category),
                        description: '',
                    },
                ],
            });
            return;
        }
        const filters = collection.filters.map(filter => ({
            code: filter.code,
            arguments: filter.args.map(argument => ({ name: argument.name, value: argument.value })),
        }));
        const manual = filters.find(filter => filter.code === 'product-id-filter');
        if (manual) {
            const argument = manual.arguments.find(item => item.name === 'productIds');
            const ids = parseIdList(argument?.value);
            if (ids.includes(String(productId))) return;
            if (argument) argument.value = JSON.stringify([...ids, String(productId)]);
        } else {
            filters.push(manualProductFilter([String(productId)], filters.length > 0));
        }
        await this.collectionService.update(ctx, { id: collection.id, filters });
    }

    private async uniqueSlug(ctx: RequestContext, name: string): Promise<string> {
        const base = normalizeString(name, '-').slice(0, 100) || `product-${shortCode(name)}`;
        for (let index = 0; index < 100; index++) {
            const slug = index === 0 ? base : `${base}-${index + 1}`;
            if (!(await this.productService.findOneBySlug(ctx, slug))) return slug;
        }
        return `${base}-${Date.now()}`;
    }

    private async uniqueCollectionSlug(ctx: RequestContext, name: string): Promise<string> {
        const base = normalizeString(name, '-').slice(0, 100) || `category-${shortCode(name)}`;
        for (let index = 0; index < 100; index++) {
            const slug = index === 0 ? base : `${base}-${index + 1}`;
            if (!(await this.collectionService.findOneBySlug(ctx, slug))) return slug;
        }
        return `${base}-${Date.now()}`;
    }

    private async uniqueSku(ctx: RequestContext, preferred: string, sourceKey: string): Promise<string> {
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

    private async refreshCounts(ctx: RequestContext, jobId: ID): Promise<void> {
        const rows = await this.connection.getRepository(ctx, CatalogImportRow).find({ where: { jobId } });
        const count = (action: CatalogImportAction) => rows.filter(row => row.action === action).length;
        await this.connection.getRepository(ctx, CatalogImportJob).update(jobId, {
            totalRows: rows.length,
            createdCount: count('CREATE'),
            updatedCount: count('UPDATE'),
            skippedCount: count('SKIP_UNCHANGED'),
            conflictCount: count('CONFLICT'),
            warningCount: count('WARNING'),
            errorCount: count('ERROR'),
        });
    }

    private assertContext(ctx: RequestContext, input: CatalogImportContextInput): void {
        if (String(input.channelId) !== String(ctx.channelId)) {
            throw new UserInputError('目标门店必须与 Dashboard 当前选择的门店一致');
        }
        if (!ctx.channel.availableCurrencyCodes.includes(input.currencyCode)) {
            throw new UserInputError('目标币种不属于当前门店');
        }
    }
}

function emptyPlan(action: CatalogImportAction): PlannedRow {
    return {
        action,
        targetProductId: null,
        targetVariantId: null,
        expectedProductUpdatedAt: null,
        expectedVariantUpdatedAt: null,
        beforeSnapshot: null,
        plannedChanges: null,
        message: null,
    };
}

function conflictPlan(message: string): PlannedRow {
    return { ...emptyPlan('CONFLICT'), message };
}

function warningPlan(plan: PlannedRow, message: string): PlannedRow {
    return {
        ...plan,
        action: 'WARNING',
        plannedChanges: { ...(plan.plannedChanges ?? {}), safeAction: plan.action },
        message,
    };
}

function validationWarning(row: NormalizedCatalogRow): string | null {
    if (row.stockOnHand != null && row.stockOnHand < 0) return '库存为负数，默认不执行';
    if (row.purchaseCost != null && row.sellingPrice != null && row.sellingPrice < row.purchaseCost) {
        return '销售价低于进货价，默认不执行';
    }
    if (row.minimumStock != null && row.maximumStock != null && row.maximumStock < row.minimumStock) {
        return '库存上限小于库存下限，默认不执行';
    }
    if (row.reportedMargin != null && row.sellingPrice && row.purchaseCost != null) {
        const calculated = (row.sellingPrice - row.purchaseCost) / row.sellingPrice;
        if (Math.abs(calculated - row.reportedMargin) > 0.0002) return '文件毛利率与成本、售价计算结果不一致';
    }
    return null;
}

function importScopeError(
    row: NormalizedCatalogRow,
    ctx: RequestContext,
    input: CatalogImportContextInput,
    stockLocation: { id: ID; name: string },
): string | null {
    if (
        row.channelCode &&
        ![String(ctx.channelId), normalizeIdentity(ctx.channel.code)].includes(
            normalizeIdentity(row.channelCode),
        )
    ) {
        return '文件门店与当前选择的门店不一致，默认不执行';
    }
    if (
        row.stockLocationCode &&
        ![String(stockLocation.id), normalizeIdentity(stockLocation.name)].includes(
            normalizeIdentity(row.stockLocationCode),
        )
    ) {
        return '文件仓库与当前选择的仓库不一致，默认不执行';
    }
    if (row.currencyCode && row.currencyCode !== String(input.currencyCode)) {
        return '文件币种与当前选择的币种不一致，默认不执行';
    }
    return null;
}

function groupRows(rows: NormalizedCatalogRow[]): Map<string, NormalizedCatalogRow[]> {
    const groups = new Map<string, NormalizedCatalogRow[]>();
    for (const row of rows)
        groups.set(catalogSourceKey(row), [...(groups.get(catalogSourceKey(row)) ?? []), row]);
    return groups;
}

function variantMatches(variant: ProductVariant, row: NormalizedCatalogRow): boolean {
    const fields = (variant.customFields ?? {}) as Record<string, unknown>;
    const specification = normalizeIdentity(stringValue(fields.specification));
    const unit = normalizeIdentity(stringValue(fields.saleUnit));
    if (!row.specification && !row.primaryUnit) return specification === '' && unit === '';
    return (
        specification === normalizeIdentity(row.specification) && unit === normalizeIdentity(row.primaryUnit)
    );
}

function createChanges(row: NormalizedCatalogRow, currencyCode: CurrencyCode): Record<string, unknown> {
    return {
        name: row.name,
        category: row.category,
        specification: row.specification,
        saleUnit: row.primaryUnit,
        sku: row.sku || '系统自动生成',
        sellingPrice: money(row.sellingPrice),
        purchaseCostMicrounits: microunits(row.purchaseCost),
        stockOnHand: row.stockOnHand,
        currencyCode,
    };
}

function changed(target: Record<string, unknown>, key: string, next: unknown, previous: unknown): void {
    if (next === null || next === undefined || next === '') return;
    if (!sameValue(next, previous)) target[key] = { from: previous ?? null, to: next };
}

function changedOptional(
    target: Record<string, unknown>,
    key: string,
    next: unknown,
    previous: unknown,
    clear: boolean,
    clearedValue: unknown = null,
): void {
    if (!isBlankValue(next)) {
        if (!sameValue(next, previous)) target[key] = { from: previous ?? null, to: next };
        return;
    }
    if (clear && !isBlankValue(previous)) {
        target[key] = { from: previous, to: clearedValue };
    }
}

function money(value: number | null): number {
    return Math.round((value ?? 0) * 100);
}

function microunits(value: number | null): number {
    return Math.round((value ?? 0) * 1_000);
}

function variantDisplayName(row: NormalizedCatalogRow): string {
    const detail = [row.specification, row.primaryUnit].filter(Boolean).join(' / ');
    return detail ? `${row.name} · ${detail}` : row.name;
}

function variantCustomFields(row: NormalizedCatalogRow): Record<string, unknown> {
    return {
        barcode: row.barcode || null,
        specification: row.specification || null,
        saleUnit: row.primaryUnit || null,
        purchaseUnit: row.primaryUnit || null,
        packageQuantity: 1,
        shelfLifeDays: row.shelfLifeDays,
    };
}

function variantCustomFieldUpdates(
    row: NormalizedCatalogRow,
    clearBlankFields: boolean,
): Record<string, unknown> {
    const updates: Record<string, unknown> = {};
    optionalUpdate(updates, 'barcode', row.barcode, shouldClear(row, 'barcode', clearBlankFields));
    optionalUpdate(
        updates,
        'specification',
        row.specification,
        shouldClear(row, 'specification', clearBlankFields),
    );
    const clearUnit = shouldClear(row, 'primaryUnit', clearBlankFields);
    optionalUpdate(updates, 'saleUnit', row.primaryUnit, clearUnit);
    optionalUpdate(updates, 'purchaseUnit', row.primaryUnit, clearUnit);
    optionalUpdate(
        updates,
        'shelfLifeDays',
        row.shelfLifeDays,
        shouldClear(row, 'shelfLifeDays', clearBlankFields),
    );
    return updates;
}

function optionalUpdate(target: Record<string, unknown>, key: string, value: unknown, clear: boolean): void {
    if (!isBlankValue(value)) target[key] = value;
    else if (clear) target[key] = null;
}

export function shouldClear(
    row: NormalizedCatalogRow,
    field: keyof NormalizedCatalogRow,
    clearBlankFields: boolean,
): boolean {
    if (!clearBlankFields || !Object.prototype.hasOwnProperty.call(row.raw, field)) return false;
    return isBlankValue(row.raw[String(field)]);
}

export function clearsVariantIdentity(row: NormalizedCatalogRow, clearBlankFields: boolean): boolean {
    return (
        shouldClear(row, 'specification', clearBlankFields) ||
        shouldClear(row, 'primaryUnit', clearBlankFields)
    );
}

function isBlankValue(value: unknown): boolean {
    return (
        value === null ||
        value === undefined ||
        (typeof value === 'string' && value.trim() === '') ||
        (Array.isArray(value) && value.length === 0)
    );
}

function sameValue(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function facetNames(values: FacetValue[] | undefined, facetCode: string): string[] {
    return (values ?? [])
        .filter(value => value.facet?.code === facetCode)
        .map(value => value.translations[0]?.name ?? value.code)
        .sort((left, right) => left.localeCompare(right, 'zh-Hans'));
}

function manualProductFilter(productIds: string[], combineWithAnd = true) {
    return {
        code: 'product-id-filter',
        arguments: [
            { name: 'productIds', value: JSON.stringify(productIds) },
            { name: 'combineWithAnd', value: String(combineWithAnd) },
        ],
    };
}

function parseIdList(value?: string): string[] {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value) as unknown;
        return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
        return [];
    }
}

function shortCode(value: string): string {
    const normalized = normalizeString(value, '-').replace(/^-|-$/g, '');
    if (normalized) return normalized.slice(0, 64);
    return Buffer.from(value).toString('hex').slice(0, 32);
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nullableNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map(String) : [];
}

function recordValue(value: unknown): Record<string, unknown> | null {
    return value != null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function safeMessage(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function csvCell(value: string): string {
    const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
}
