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
import { In, IsNull } from 'typeorm';

import {
    CatalogFileParserService,
    catalogProductKey,
    catalogRowFingerprint,
    catalogSourceKey,
    normalizeIdentity,
} from './catalog-file-parser.service';
import { CatalogOperationsService } from './catalog-operations.service';
import { MAX_CATALOG_IMPORT_BYTES, MAX_CATALOG_IMPORT_ROWS } from './constants';
import { CatalogImportJob } from './entities/catalog-import-job.entity';
import { CatalogImportRow } from './entities/catalog-import-row.entity';
import { CatalogSourceBinding } from './entities/catalog-source-binding.entity';
import { InventoryLot } from './entities/inventory-lot.entity';
import { InventoryPolicy } from './entities/inventory-policy.entity';
import { VariantCostRecord } from './entities/variant-cost-record.entity';
import {
    AppendCatalogImportRowsInput,
    BeginCatalogImportInput,
    CatalogImportAction,
    CatalogImportContextInput,
    NormalizedCatalogRow,
    ResolveCatalogImportRowInput,
    ResolveCatalogImportRowsInput,
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

    async beginImport(ctx: RequestContext, input: BeginCatalogImportInput): Promise<CatalogImportJob> {
        this.assertContext(ctx, input.context);
        await this.operations.requireStockLocation(ctx, input.context.stockLocationId);
        validateImportSource(input);

        const repository = this.connection.getRepository(ctx, CatalogImportJob);
        const existing = await repository.findOne({
            where: {
                channelId: ctx.channelId,
                stockLocationId: input.context.stockLocationId,
                currencyCode: input.context.currencyCode,
                clearBlankFields: Boolean(input.context.clearBlankFields),
                fileHash: input.source.fileHash.toLowerCase(),
                // Reuse only an in-flight/retryable task. A completed task
                // must not block a deliberate re-import of the same file.
                state: In(['RECEIVING', 'PREVIEW_READY', 'QUEUED', 'RUNNING', 'FAILED']),
            },
            order: { createdAt: 'DESC' },
        });
        if (existing) return this.findJob(ctx, existing.id);

        const job = await repository.save(
            new CatalogImportJob({
                channelId: ctx.channelId,
                stockLocationId: input.context.stockLocationId,
                currencyCode: input.context.currencyCode,
                clearBlankFields: Boolean(input.context.clearBlankFields),
                originalFilename: safeImportFilename(input.source.filename),
                mimeType: safeImportText(input.source.mimetype, 120) || 'application/octet-stream',
                byteSize: input.source.byteSize,
                fileHash: input.source.fileHash.toLowerCase(),
                sheetName: safeImportText(input.source.sheetName ?? '', 255) || null,
                detectedHeaders: input.source.detectedHeaders.map(header => safeImportText(header, 255)),
                fieldMapping: sanitizeFieldMapping(input.source.fieldMapping),
                state: 'RECEIVING',
                actorId: ctx.activeUserId ? String(ctx.activeUserId) : null,
                totalRows: input.totalRows,
                progress: 0,
                errorMessage: null,
            }),
        );
        return this.findJob(ctx, job.id);
    }

    async appendRows(ctx: RequestContext, input: AppendCatalogImportRowsInput): Promise<CatalogImportJob> {
        const job = await this.findJob(ctx, input.jobId);
        if (job.state !== 'RECEIVING') {
            if (job.state === 'PREVIEW_READY') return job;
            throw new UserInputError('当前导入任务不接收数据行');
        }
        if (input.rows.length < 1 || input.rows.length > 500) {
            throw new UserInputError('每批必须包含 1 至 500 行商品数据');
        }
        const rows = input.rows.map(row => sanitizeCatalogRow(row, job.totalRows));
        if (new Set(rows.map(row => row.rowNumber)).size !== rows.length) {
            throw new UserInputError('同一批次中存在重复行号');
        }

        const repository = this.connection.getRepository(ctx, CatalogImportRow);
        const existing = await repository.find({
            where: { jobId: job.id, rowNumber: In(rows.map(row => row.rowNumber)) },
        });
        const existingByNumber = new Map(existing.map(row => [row.rowNumber, row]));
        for (const row of rows) {
            const previous = existingByNumber.get(row.rowNumber);
            if (previous && previous.rowFingerprint !== catalogRowFingerprint(row)) {
                throw new UserInputError(
                    `第 ${row.rowNumber} 行已接收过不同数据，请重新开始导入以避免混用批次`,
                );
            }
        }
        const entities = rows.map(row => {
            const entity = existingByNumber.get(row.rowNumber) ?? new CatalogImportRow();
            entity.jobId = job.id;
            entity.rowNumber = row.rowNumber;
            entity.productKey = catalogProductKey(row);
            entity.sourceKey = catalogSourceKey(row);
            entity.rowFingerprint = catalogRowFingerprint(row);
            entity.action = 'PENDING';
            entity.resolution = null;
            entity.targetProductId = null;
            entity.targetVariantId = null;
            entity.expectedProductUpdatedAt = null;
            entity.expectedVariantUpdatedAt = null;
            entity.normalizedData = row;
            entity.beforeSnapshot = null;
            entity.plannedChanges = null;
            entity.appliedSnapshot = null;
            entity.message = null;
            entity.appliedAt = null;
            return entity;
        });
        await repository.save(entities);
        const received = await repository.count({ where: { jobId: job.id } });
        await this.connection.getRepository(ctx, CatalogImportJob).update(job.id, {
            progress: Math.min(99, Math.round((received / Math.max(job.totalRows, 1)) * 100)),
        });
        return this.findJob(ctx, job.id);
    }

    async finalizePreview(ctx: RequestContext, id: ID): Promise<CatalogImportJob> {
        const job = await this.findJob(ctx, id);
        if (job.state === 'PREVIEW_READY') return job;
        if (job.state !== 'RECEIVING') throw new UserInputError('当前导入任务不能生成预览');

        const rowRepository = this.connection.getRepository(ctx, CatalogImportRow);
        const rows = await rowRepository.find({ where: { jobId: job.id }, order: { rowNumber: 'ASC' } });
        if (rows.length !== job.totalRows) {
            throw new UserInputError(
                `导入数据不完整：应接收 ${job.totalRows} 行，实际收到 ${rows.length} 行`,
            );
        }

        const [catalogIndex, bindings, stockLocations] = await Promise.all([
            this.buildCatalogIndex(ctx),
            this.connection.getRepository(ctx, CatalogSourceBinding).find({
                where: {
                    channelId: ctx.channelId,
                    sourceKey: In([...new Set(rows.map(row => row.sourceKey))]),
                },
            }),
            this.operations.stockLocations(ctx),
        ]);
        const bindingMap = new Map(bindings.map(binding => [binding.sourceKey, binding]));
        const duplicateGroups = groupRows(rows.map(row => row.normalizedData));
        const productDuplicateGroups = groupProductRows(rows.map(row => row.normalizedData));
        const defaultContext: CatalogImportContextInput = {
            channelId: job.channelId,
            stockLocationId: job.stockLocationId,
            currencyCode: job.currencyCode,
            clearBlankFields: job.clearBlankFields,
        };

        try {
            for (const entity of rows) {
                const row = entity.normalizedData;
                const targetStockLocation = effectiveStockLocation(
                    row.stockLocationCode,
                    job.stockLocationId,
                    stockLocations,
                );
                const context = {
                    ...defaultContext,
                    stockLocationId: targetStockLocation?.id ?? job.stockLocationId,
                };
                const duplicateRows = duplicateGroups.get(entity.sourceKey) ?? [];
                const fingerprints = new Set(duplicateRows.map(catalogRowFingerprint));
                const matchingProductRows = productDuplicateGroups.get(variantExecutionKey(row)) ?? [];
                const productFingerprints = new Set(matchingProductRows.map(productFieldFingerprint));
                const scopeError = targetStockLocation
                    ? importScopeError(row, ctx, context, targetStockLocation)
                    : `文件仓库“${row.stockLocationCode}”不属于当前门店`;
                let plan: PlannedRow;
                if (scopeError) {
                    plan = { ...emptyPlan('ERROR'), message: scopeError };
                } else if (productFingerprints.size > 1) {
                    plan = conflictPlan('同一商品标识出现不同价格、成本或规格，请人工确认');
                } else if (fingerprints.size > 1) {
                    plan = conflictPlan('同一商品标识在文件中出现不同数值，请人工确认');
                } else if (duplicateRows[0]?.rowNumber !== row.rowNumber) {
                    plan = {
                        ...emptyPlan('SKIP_UNCHANGED'),
                        message: `与第 ${duplicateRows[0]?.rowNumber ?? row.rowNumber} 行完全重复，已跳过`,
                    };
                } else {
                    plan = await this.planRow(
                        ctx,
                        row,
                        context,
                        catalogIndex,
                        bindingMap.get(entity.sourceKey),
                    );
                }
                entity.action = plan.action;
                entity.resolution = null;
                entity.targetProductId = plan.targetProductId;
                entity.targetVariantId = plan.targetVariantId;
                entity.expectedProductUpdatedAt = plan.expectedProductUpdatedAt;
                entity.expectedVariantUpdatedAt = plan.expectedVariantUpdatedAt;
                entity.beforeSnapshot = plan.beforeSnapshot;
                entity.plannedChanges = plan.plannedChanges;
                entity.message = plan.message;
            }
            for (let index = 0; index < rows.length; index += 250) {
                await rowRepository.save(rows.slice(index, index + 250));
            }
            job.state = 'PREVIEW_READY';
            job.progress = 0;
            job.errorMessage = null;
            await this.connection.getRepository(ctx, CatalogImportJob).save(job);
            await this.refreshCounts(ctx, job.id);
            return this.findJob(ctx, job.id);
        } catch (error) {
            await this.connection.getRepository(ctx, CatalogImportJob).update(job.id, {
                state: 'FAILED',
                errorMessage: safeMessage(error),
                completedAt: new Date(),
            });
            throw error;
        }
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
                state: In(['RECEIVING', 'PREVIEW_READY', 'QUEUED', 'RUNNING', 'FAILED']),
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
        if (!['PREVIEW_READY', 'FAILED'].includes(row.job.state)) {
            throw new UserInputError('只有预览中或失败待重试的任务可以处理冲突');
        }
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
            if (!['WARNING', 'ERROR'].includes(row.action) || !['CREATE', 'UPDATE'].includes(safeAction)) {
                throw new UserInputError('只有警告或可重试错误行可以继续应用');
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

    async resolveRows(ctx: RequestContext, input: ResolveCatalogImportRowsInput): Promise<CatalogImportJob> {
        const rowIds = [...new Set(input.rowIds.map(String))];
        if (rowIds.length < 1 || rowIds.length > 500) {
            throw new UserInputError('每次批量处理 1 至 500 行');
        }
        if (!['APPLY', 'SKIP'].includes(input.resolution)) {
            throw new UserInputError('批量处理只支持继续应用或跳过');
        }
        const repository = this.connection.getRepository(ctx, CatalogImportRow);
        const rows = await repository.find({ where: { id: In(rowIds) }, relations: ['job'] });
        if (rows.length !== rowIds.length) throw new UserInputError('部分导入行不存在');
        const jobIds = new Set(rows.map(row => String(row.jobId)));
        if (jobIds.size !== 1) throw new UserInputError('不能跨导入任务批量处理');

        for (const row of rows) {
            if (String(row.job.channelId) !== String(ctx.channelId)) {
                throw new UserInputError('导入行不属于当前门店');
            }
            if (!['PREVIEW_READY', 'FAILED'].includes(row.job.state)) {
                throw new UserInputError('只有预览中或失败待重试的任务可以批量处理');
            }
            if (!['CONFLICT', 'WARNING', 'ERROR'].includes(row.action)) {
                throw new UserInputError(`第 ${row.rowNumber} 行不需要人工处理`);
            }
            if (input.resolution === 'APPLY') {
                const safeActionValue = row.plannedChanges?.safeAction;
                const safeAction = typeof safeActionValue === 'string' ? safeActionValue : '';
                if (
                    !['WARNING', 'ERROR'].includes(row.action) ||
                    !['CREATE', 'UPDATE'].includes(safeAction)
                ) {
                    throw new UserInputError('批量继续只能处理警告或可重试错误行');
                }
                row.action = safeAction as CatalogImportAction;
                row.resolution = 'APPLY';
                row.message = '管理员已批量确认警告并允许执行';
            } else {
                row.action = 'SKIP_UNCHANGED';
                row.resolution = 'SKIP';
                row.message = '管理员批量选择跳过';
            }
        }
        await repository.save(rows);
        const jobId = rows[0].jobId;
        await this.refreshCounts(ctx, jobId);
        return this.findJob(ctx, jobId);
    }

    async queueExecution(ctx: RequestContext, id: ID): Promise<CatalogImportJob> {
        const job = await this.findJob(ctx, id);
        if (job.state !== 'PREVIEW_READY' && job.state !== 'FAILED') {
            throw new UserInputError('当前任务状态不能执行');
        }
        const unresolved = await this.connection.getRepository(ctx, CatalogImportRow).count({
            where: { jobId: id, action: In(['CONFLICT', 'WARNING', 'ERROR']) },
        });
        if (unresolved > 0) throw new UserInputError(`还有 ${unresolved} 行冲突、警告或错误未处理`);
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
        const stockLocations = await this.operations.stockLocations(ctx);
        const productByKey = new Map<string, ID>();
        const variantByKey = new Map<string, ID>();
        for (const applied of rows.filter(row => row.appliedAt && row.targetProductId)) {
            productByKey.set(applied.productKey, applied.targetProductId as ID);
            if (applied.targetVariantId) {
                variantByKey.set(variantExecutionKey(applied.normalizedData), applied.targetVariantId);
            }
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
                    await this.applyRow(txCtx, job, row, productByKey, variantByKey, stockLocations);
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
        if (row.sku) {
            const variants = catalogIndex
                .flatMap(item => item.product.variants)
                .filter(variant => variant.sku === row.sku);
            if (variants.length > 1) return conflictPlan('SKU 匹配到多个商品，请先清理重复 SKU');
            targetVariant = variants[0];
            targetProduct = targetVariant
                ? catalogIndex.find(item => String(item.product.id) === String(targetVariant?.productId))
                      ?.product
                : undefined;
        } else if (row.barcode) {
            const variants = catalogIndex
                .flatMap(item => item.product.variants)
                .filter(
                    variant =>
                        normalizeIdentity(
                            stringValue(((variant.customFields ?? {}) as Record<string, unknown>).barcode),
                        ) === normalizeIdentity(row.barcode),
                );
            if (variants.length > 1) return conflictPlan('条码匹配到多个商品，请先清理重复条码');
            targetVariant = variants[0];
            targetProduct = targetVariant
                ? catalogIndex.find(item => String(item.product.id) === String(targetVariant?.productId))
                      ?.product
                : undefined;
        } else if (binding) {
            targetProduct = catalogIndex.find(
                item => String(item.product.id) === String(binding.productId),
            )?.product;
            targetVariant = targetProduct?.variants.find(
                variant => String(variant.id) === String(binding.variantId),
            );
            if (!targetProduct || !targetVariant) return conflictPlan('历史来源绑定指向的商品已经不存在');
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
                          productSourceCreatedAt: dateString(
                              ((targetProduct.customFields ?? {}) as Record<string, unknown>).sourceCreatedAt,
                          ),
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
        const productCustomFields = (product?.customFields ?? {}) as Record<string, unknown>;
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
            productSourceCreatedAt: dateString(productCustomFields.sourceCreatedAt),
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
        changedOptional(
            changes,
            'sourceCreatedAt',
            row.sourceCreatedAt,
            snapshot.productSourceCreatedAt,
            shouldClear(row, 'sourceCreatedAt', clearBlankFields),
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
        variantByKey: Map<string, ID>,
        stockLocations: Array<{ id: string; name: string }>,
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

        const executionVariantKey = variantExecutionKey(row.normalizedData);
        const executionVariantId = row.targetVariantId ?? variantByKey.get(executionVariantKey);
        const variantAlreadyHandled =
            executionVariantId != null &&
            String(variantByKey.get(executionVariantKey)) === String(executionVariantId);
        if (executionVariantId) {
            variant =
                (await this.connection.getRepository(ctx, ProductVariant).findOne({
                    where: { id: executionVariantId, deletedAt: IsNull() },
                    relations: ['productVariantPrices'],
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
                productEnabled: product.enabled,
                productDescription:
                    product.translations.find(translation => translation.languageCode === ctx.languageCode)
                        ?.description ?? '',
                productFacetValueIds: product.facetValues?.map(value => String(value.id)) ?? [],
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
        const replaceSourceCreatedAt =
            Boolean(row.normalizedData.sourceCreatedAt) ||
            shouldClear(row.normalizedData, 'sourceCreatedAt', job.clearBlankFields);
        if (
            !productCreated &&
            (replaceDescription ||
                replaceSourceCreatedAt ||
                row.normalizedData.enabled != null ||
                replaceBrand ||
                replaceTags)
        ) {
            const translation =
                product.translations.find(item => item.languageCode === ctx.languageCode) ??
                product.translations[0];
            await this.productService.update(ctx, {
                id: product.id,
                expectedUpdatedAt: product.updatedAt,
                ...(row.normalizedData.enabled != null ? { enabled: row.normalizedData.enabled } : {}),
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
                                      stockLocationId,
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
            if (
                row.normalizedData.lotQuantity != null &&
                row.normalizedData.stockOnHand != null &&
                row.normalizedData.lotQuantity !== row.normalizedData.stockOnHand
            ) {
                throw new UserInputError('批次数量必须与库存数量一致，请拆分批次后再导入');
            }
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
                    purchaseCostMicrounits: microunits(row.normalizedData.purchaseCost),
                    currencyCode: job.currencyCode,
                },
                row.normalizedData.lotQuantity != null && row.normalizedData.stockOnHand == null,
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
            stockLocationId: String(stockLocationId),
            lotId: lotId ? String(lotId) : null,
        };
        row.appliedAt = new Date();
        row.message = row.action === 'CREATE' ? '新增成功' : '更新成功';
        productByKey.set(row.productKey, product.id);
        variantByKey.set(executionVariantKey, variant.id);
        await this.connection.getRepository(ctx, CatalogImportRow).save(row);
    }

    private async rollbackRow(
        ctx: RequestContext,
        job: CatalogImportJob,
        row: CatalogImportRow,
    ): Promise<void> {
        const before = row.beforeSnapshot ?? {};
        const applied = row.appliedSnapshot ?? {};
        const appliedStockLocationId = stringValue(applied.stockLocationId) || job.stockLocationId;
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
                await this.operations.updateVariant(ctx, {
                    productVariantId: variant.id,
                    stockLocationId: appliedStockLocationId,
                    stockOnHand: Number(before.stockOnHand ?? 0),
                    currencyCode: job.currencyCode,
                });
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
                    stockLocationId: appliedStockLocationId,
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
                    customFields: {
                        ...((product.customFields ?? {}) as Record<string, unknown>),
                        sourceCreatedAt: dateValue(before.productSourceCreatedAt),
                    },
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

function effectiveStockLocation(
    reference: string,
    fallbackId: ID,
    locations: Array<{ id: string; name: string }>,
): { id: string; name: string } | undefined {
    if (!reference.trim()) {
        return locations.find(location => String(location.id) === String(fallbackId));
    }
    const normalized = normalizeIdentity(reference);
    return locations.find(
        location =>
            normalizeIdentity(String(location.id)) === normalized ||
            normalizeIdentity(location.name) === normalized,
    );
}

function variantExecutionKey(row: NormalizedCatalogRow): string {
    if (row.sku) return `sku\u001f${normalizeIdentity(row.sku)}`;
    if (row.barcode) return `barcode\u001f${normalizeIdentity(row.barcode)}`;
    return [row.name, row.category, row.specification, row.primaryUnit].map(normalizeIdentity).join('\u001f');
}

function groupRows(rows: NormalizedCatalogRow[]): Map<string, NormalizedCatalogRow[]> {
    const groups = new Map<string, NormalizedCatalogRow[]>();
    for (const row of rows)
        groups.set(catalogSourceKey(row), [...(groups.get(catalogSourceKey(row)) ?? []), row]);
    return groups;
}

function groupProductRows(rows: NormalizedCatalogRow[]): Map<string, NormalizedCatalogRow[]> {
    const groups = new Map<string, NormalizedCatalogRow[]>();
    for (const row of rows) {
        const key = variantExecutionKey(row);
        groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    return groups;
}

function productFieldFingerprint(row: NormalizedCatalogRow): string {
    return JSON.stringify({
        name: row.name,
        category: row.category,
        currencyCode: row.currencyCode,
        specification: row.specification,
        primaryUnit: row.primaryUnit,
        purchaseUnit: row.purchaseUnit,
        packageQuantity: row.packageQuantity,
        purchaseCost: row.purchaseCost,
        sellingPrice: row.sellingPrice,
        brand: row.brand,
        enabled: row.enabled,
        description: row.description,
        tags: row.tags,
        sourceCreatedAt: row.sourceCreatedAt,
        sku: row.sku,
        barcode: row.barcode,
    });
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
        purchaseUnit: row.purchaseUnit || row.primaryUnit,
        packageQuantity: row.packageQuantity,
        sku: row.sku || '系统自动生成',
        sellingPrice: money(row.sellingPrice),
        purchaseCostMicrounits: microunits(row.purchaseCost),
        stockOnHand: row.stockOnHand,
        sourceCreatedAt: row.sourceCreatedAt,
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
        purchaseUnit: row.purchaseUnit || row.primaryUnit || null,
        packageQuantity: row.packageQuantity,
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
    optionalUpdate(
        updates,
        'purchaseUnit',
        row.purchaseUnit,
        shouldClear(row, 'purchaseUnit', clearBlankFields),
    );
    updates.packageQuantity = row.packageQuantity;
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
    if (!clearBlankFields) return false;
    if (row.raw && Object.prototype.hasOwnProperty.call(row.raw, field)) {
        return isBlankValue(row.raw[String(field)]);
    }
    if (!row.providedFields?.includes(String(field))) return false;
    return isBlankValue(row[field]);
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

function stringOrNumberValue(value: unknown): string {
    if (typeof value === 'string') return value;
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

function numberValue(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nullableNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function dateString(value: unknown): string | null {
    return dateValue(value)?.toISOString() ?? null;
}

function dateValue(value: unknown): Date | null {
    if (value == null || value === '') return null;
    if (!(value instanceof Date) && typeof value !== 'string' && typeof value !== 'number') return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
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

function validateImportSource(input: BeginCatalogImportInput): void {
    if (
        !Number.isInteger(input.totalRows) ||
        input.totalRows < 1 ||
        input.totalRows > MAX_CATALOG_IMPORT_ROWS
    ) {
        throw new UserInputError(`单次最多导入 ${MAX_CATALOG_IMPORT_ROWS} 行商品`);
    }
    if (!Number.isInteger(input.source.byteSize) || input.source.byteSize < 1) {
        throw new UserInputError('文件大小无效');
    }
    if (input.source.byteSize > MAX_CATALOG_IMPORT_BYTES) {
        throw new UserInputError('导入文件不能超过 20MB');
    }
    if (!/^[a-f0-9]{64}$/i.test(input.source.fileHash)) {
        throw new UserInputError('文件摘要格式无效');
    }
    if (!/\.(numbers|xlsx|xls|csv)$/i.test(input.source.filename)) {
        throw new UserInputError('仅支持 .numbers、.xlsx、.xls 或 .csv 文件');
    }
    if (!/^catalog-browser-v\d+$/u.test(input.source.parserVersion)) {
        throw new UserInputError('浏览器解析器版本无效');
    }
    if (input.source.detectedHeaders.length < 1 || input.source.detectedHeaders.length > 100) {
        throw new UserInputError('表头数量无效');
    }
}

function sanitizeCatalogRow(row: NormalizedCatalogRow, expectedRows: number): NormalizedCatalogRow {
    if (!Number.isInteger(row.rowNumber) || row.rowNumber < 2 || row.rowNumber > expectedRows + 1) {
        throw new UserInputError('商品行号超出导入范围');
    }
    const name = safeRequiredRowText(row.name, 255, row.rowNumber, '名称');
    const category = safeRequiredRowText(row.category, 255, row.rowNumber, '分类');
    const purchaseCost = finiteRowNumber(row.purchaseCost, row.rowNumber, '进货价', true);
    const sellingPrice = finiteRowNumber(row.sellingPrice, row.rowNumber, '销售价', true);
    if (purchaseCost < 0) throw new UserInputError(`第 ${row.rowNumber} 行：进货价不能为负数`);
    if (sellingPrice < 0) throw new UserInputError(`第 ${row.rowNumber} 行：销售价不能为负数`);
    if (row.shelfLifeDays != null && (!Number.isInteger(row.shelfLifeDays) || row.shelfLifeDays < 0)) {
        throw new UserInputError(`第 ${row.rowNumber} 行：保质期必须是非负整数`);
    }
    if (row.lotQuantity != null && row.lotQuantity < 0) {
        throw new UserInputError(`第 ${row.rowNumber} 行：批次数量不能为负数`);
    }
    if (!Number.isFinite(row.packageQuantity) || row.packageQuantity <= 0) {
        throw new UserInputError(`第 ${row.rowNumber} 行：包装换算必须大于 0`);
    }
    for (const [value, label] of [
        [row.stockOnHand, '库存量'],
        [row.minimumStock, '库存下限'],
        [row.maximumStock, '库存上限'],
        [row.lotQuantity, '批次数量'],
    ] as const) {
        if (value != null && !Number.isInteger(value)) {
            throw new UserInputError(`第 ${row.rowNumber} 行：${label}必须是整数`);
        }
    }
    const normalizedDate = (value: string | null, label: string) => {
        if (!value) return null;
        const parsed = new Date(value);
        if (!Number.isFinite(parsed.getTime())) {
            throw new UserInputError(`第 ${row.rowNumber} 行：${label}不是有效日期`);
        }
        return parsed.toISOString();
    };
    const allowedFields = new Set([
        'name',
        'category',
        'channelCode',
        'stockLocationCode',
        'currencyCode',
        'specification',
        'primaryUnit',
        'purchaseUnit',
        'packageQuantity',
        'stockOnHand',
        'purchaseCost',
        'sellingPrice',
        'reportedMargin',
        'maximumStock',
        'minimumStock',
        'brand',
        'manufacturedAt',
        'shelfLifeDays',
        'enabled',
        'description',
        'tags',
        'sourceCreatedAt',
        'sku',
        'barcode',
        'lotCode',
        'lotQuantity',
    ]);
    const providedFields = [...new Set((row.providedFields ?? []).filter(field => allowedFields.has(field)))];
    return {
        rowNumber: row.rowNumber,
        name,
        category,
        channelCode: safeImportText(row.channelCode, 255),
        stockLocationCode: safeImportText(row.stockLocationCode, 255),
        currencyCode: safeImportText(row.currencyCode, 3).toUpperCase(),
        specification: safeImportText(row.specification, 255),
        primaryUnit: safeImportText(row.primaryUnit, 80),
        purchaseUnit: safeImportText(row.purchaseUnit, 80),
        packageQuantity: row.packageQuantity,
        stockOnHand: row.stockOnHand,
        purchaseCost,
        sellingPrice,
        reportedMargin:
            row.reportedMargin == null
                ? null
                : finiteRowNumber(row.reportedMargin, row.rowNumber, '毛利率', false),
        maximumStock: row.maximumStock,
        minimumStock: row.minimumStock,
        brand: safeImportText(row.brand, 255),
        manufacturedAt: normalizedDate(row.manufacturedAt, '生产日期'),
        shelfLifeDays: row.shelfLifeDays,
        enabled: typeof row.enabled === 'boolean' ? row.enabled : null,
        description: safeImportText(row.description, 50_000),
        tags: [...new Set((row.tags ?? []).map(tag => safeImportText(tag, 255)).filter(Boolean))].slice(
            0,
            100,
        ),
        sourceCreatedAt: normalizedDate(row.sourceCreatedAt, '创建日期'),
        sku: safeImportText(row.sku, 255),
        barcode: safeImportText(row.barcode, 255),
        lotCode: safeImportText(row.lotCode, 80),
        lotQuantity: row.lotQuantity,
        providedFields,
    };
}

function finiteRowNumber(value: number | null, rowNumber: number, label: string, required: true): number;
function finiteRowNumber(
    value: number | null,
    rowNumber: number,
    label: string,
    required: false,
): number | null;
function finiteRowNumber(
    value: number | null,
    rowNumber: number,
    label: string,
    required: boolean,
): number | null {
    if (value == null) {
        if (required) throw new UserInputError(`第 ${rowNumber} 行：${label}不能为空`);
        return null;
    }
    if (!Number.isFinite(value)) throw new UserInputError(`第 ${rowNumber} 行：${label}不是有效数字`);
    return value;
}

function safeRequiredRowText(value: string, maxLength: number, rowNumber: number, label: string): string {
    const normalized = safeImportText(value, maxLength);
    if (!normalized) throw new UserInputError(`第 ${rowNumber} 行：${label}不能为空`);
    return normalized;
}

function safeImportText(value: string, maxLength: number): string {
    return String(value ?? '')
        .normalize('NFKC')
        .replace(/\0/gu, '')
        .trim()
        .slice(0, maxLength);
}

function safeImportFilename(filename: string): string {
    return safeImportText(filename.replace(/[\\/]/gu, '_'), 255) || 'catalog-import.xlsx';
}

function sanitizeFieldMapping(value: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
        Object.entries(value ?? {})
            .slice(0, 100)
            .map(([header, field]) => [safeImportText(header, 255), safeImportText(field, 80)])
            .filter(([header, field]) => Boolean(header && field)),
    );
}
