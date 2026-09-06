import { Injectable } from '@nestjs/common';
import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import {
    FacetService,
    FacetValueService,
    ProductService,
    ProductVariant,
    ProductVariantService,
    RequestContext,
    SearchService,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { In } from 'typeorm';

import {
    CatalogFileParserService,
    catalogExactRowFingerprint,
    catalogProductKey,
    catalogRowFingerprint,
    catalogSourceKey,
} from './catalog-file-parser.service';
import { CatalogImportCategoryService } from './catalog-import-category.service';
import {
    clearsVariantIdentity,
    safeImportFilename,
    safeImportText,
    safeMessage,
    sanitizeCatalogRow,
    sanitizeFieldMapping,
    shouldClear,
    validateImportSource,
} from './catalog-import-helpers';
import { CatalogImportOptionsService } from './catalog-import-options.service';
import {
    type PlannedRow,
    assertCatalogImportContext,
    conflictPlan,
    effectiveStockLocation,
    emptyPlan,
    firstExactRowNumbers,
    groupProductRows,
    groupRows,
    importScopeError,
    isCatalogImportResolutionState,
    productFieldFingerprint,
    reusableCatalogImportStates,
    validationWarning,
    variantExecutionKey,
    withRiskConfirmation,
} from './catalog-import-planning';
import { CatalogImportPreview, type CatalogIndexProduct } from './catalog-import-preview';
import { CatalogImportRollback } from './catalog-import-rollback';
import { CatalogImportWriter } from './catalog-import-writer';
import { CatalogOperationsService } from './catalog-operations.service';
import { catalogCreateNewSourceRecordKey } from './catalog-row-identity';
import { CatalogSupplierService } from './catalog-supplier.service';
import { CatalogImportJob } from './entities/catalog-import-job.entity';
import { CatalogImportRow } from './entities/catalog-import-row.entity';
import { CatalogSourceBinding } from './entities/catalog-source-binding.entity';
import { CatalogSupplier } from './entities/catalog-supplier.entity';
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

export { clearsVariantIdentity, shouldClear };

@Injectable()
export class CatalogImportService {
    private readonly preview: CatalogImportPreview;
    private readonly writer: CatalogImportWriter;
    private readonly rollbackExecutor: CatalogImportRollback;

    private enqueue?: (jobId: ID) => Promise<void>;

    constructor(
        private readonly connection: TransactionalConnection,
        private readonly parser: CatalogFileParserService,
        private readonly operations: CatalogOperationsService,
        private readonly productService: ProductService,
        private readonly productVariantService: ProductVariantService,
        private readonly importOptions: CatalogImportOptionsService,
        private readonly categories: CatalogImportCategoryService,
        private readonly facetService: FacetService,
        private readonly facetValueService: FacetValueService,
        private readonly searchService: SearchService,
        private readonly suppliers: CatalogSupplierService,
    ) {
        this.preview = new CatalogImportPreview(this.connection, this.suppliers);
        this.writer = new CatalogImportWriter(
            this.connection,
            this.productService,
            this.importOptions,
            this.productVariantService,
            this.operations,
            this.suppliers,
            this.categories,
            this.facetService,
            this.facetValueService,
            this.preview,
        );
        this.rollbackExecutor = new CatalogImportRollback(
            this.connection,
            this.operations,
            this.productVariantService,
            this.suppliers,
            this.productService,
            this.categories,
        );
    }

    registerEnqueuer(enqueue: (jobId: ID) => Promise<void>): void {
        this.enqueue = enqueue;
    }

    async beginImport(ctx: RequestContext, input: BeginCatalogImportInput): Promise<CatalogImportJob> {
        assertCatalogImportContext(ctx, input.context);
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
                state: In(reusableCatalogImportStates),
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

        const [catalogIndex, bindings, stockLocations, suppliersByName] = await Promise.all([
            this.buildCatalogIndex(ctx),
            this.connection.getRepository(ctx, CatalogSourceBinding).find({
                where: {
                    channelId: ctx.channelId,
                    sourceKey: In([...new Set(rows.map(row => row.sourceKey))]),
                },
            }),
            this.operations.stockLocations(ctx),
            this.suppliers.findByNames(
                ctx,
                rows.map(item => item.normalizedData.supplier),
            ),
        ]);
        const bindingMap = new Map(bindings.map(binding => [binding.sourceKey, binding]));
        const duplicateGroups = groupRows(rows.map(row => row.normalizedData));
        const productDuplicateGroups = groupProductRows(rows.map(row => row.normalizedData));
        const firstExactRows = firstExactRowNumbers(rows.map(row => row.normalizedData));
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
                const matchingProductRows =
                    row.name && row.category
                        ? (productDuplicateGroups.get(catalogProductKey(row)) ?? [])
                        : [row];
                const productFingerprints = new Set(matchingProductRows.map(productFieldFingerprint));
                const scopeError = targetStockLocation
                    ? importScopeError(row, ctx, context, targetStockLocation)
                    : `文件仓库“${row.stockLocationCode}”不属于当前门店`;
                let plan: PlannedRow;
                if (scopeError) {
                    plan = { ...emptyPlan('ERROR'), message: scopeError };
                } else if (firstExactRows.get(catalogExactRowFingerprint(row)) !== row.rowNumber) {
                    plan = {
                        ...emptyPlan('SKIP_UNCHANGED'),
                        message: `与第 ${firstExactRows.get(catalogExactRowFingerprint(row)) ?? row.rowNumber} 行完全重复，已跳过`,
                    };
                } else if (productFingerprints.size > 1) {
                    plan = conflictPlan('同一商品的名称、分类、商品状态、商品描述或标签不一致');
                } else if (fingerprints.size > 1) {
                    plan = conflictPlan('同一 SKU 或条码在文件中出现不同数值，请人工确认');
                } else {
                    plan = await this.planRow(
                        ctx,
                        row,
                        context,
                        catalogIndex,
                        bindingMap.get(entity.sourceKey),
                        suppliersByName,
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
        assertCatalogImportContext(ctx, input);
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
                state: In(reusableCatalogImportStates),
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
            const [catalogIndex, bindings, suppliersByName] = await Promise.all([
                this.buildCatalogIndex(ctx),
                this.connection.getRepository(ctx, CatalogSourceBinding).find({
                    where: {
                        channelId: ctx.channelId,
                        sourceKey: In([...new Set(parsed.rows.map(catalogSourceKey))]),
                    },
                }),
                this.suppliers.findByNames(
                    ctx,
                    parsed.rows.map(row => row.supplier),
                ),
            ]);
            const bindingMap = new Map(bindings.map(binding => [binding.sourceKey, binding]));
            const duplicateGroups = groupRows(parsed.rows);
            const productDuplicateGroups = groupProductRows(parsed.rows);
            const firstExactRows = firstExactRowNumbers(parsed.rows);
            const importRows: CatalogImportRow[] = [];
            for (const row of parsed.rows) {
                const sourceKey = catalogSourceKey(row);
                const duplicateRows = duplicateGroups.get(sourceKey) ?? [];
                const fingerprints = new Set(duplicateRows.map(catalogRowFingerprint));
                const matchingProductRows =
                    row.name && row.category
                        ? (productDuplicateGroups.get(catalogProductKey(row)) ?? [])
                        : [row];
                const productFingerprints = new Set(matchingProductRows.map(productFieldFingerprint));
                let plan: PlannedRow;
                const scopeError = importScopeError(row, ctx, input, targetStockLocation);
                if (scopeError) {
                    plan = { ...emptyPlan('ERROR'), message: scopeError };
                } else if (firstExactRows.get(catalogExactRowFingerprint(row)) !== row.rowNumber) {
                    plan = {
                        ...emptyPlan('SKIP_UNCHANGED'),
                        message: `与第 ${firstExactRows.get(catalogExactRowFingerprint(row)) ?? row.rowNumber} 行完全重复，已跳过`,
                    };
                } else if (productFingerprints.size > 1) {
                    plan = conflictPlan('同一商品的名称、分类、商品状态、商品描述或标签不一致');
                } else if (fingerprints.size > 1) {
                    plan = conflictPlan('同一 SKU 或条码在文件中出现不同数值，请人工确认');
                } else {
                    plan = await this.planRow(
                        ctx,
                        row,
                        input,
                        catalogIndex,
                        bindingMap.get(sourceKey),
                        suppliersByName,
                    );
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
        await this.attachReceivedRows(ctx, [job]);
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
        await this.attachReceivedRows(ctx, items);
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

    async findRowPage(
        ctx: RequestContext,
        jobId: ID,
        action?: CatalogImportAction | null,
        skip = 0,
        take = 100,
    ) {
        await this.findJob(ctx, jobId);
        const safeSkip = Math.max(0, Number.isInteger(skip) ? skip : 0);
        const safeTake = Math.min(500, Math.max(1, Number.isInteger(take) ? take : 100));
        const [items, totalItems] = await this.connection.getRepository(ctx, CatalogImportRow).findAndCount({
            where: { jobId, ...(action ? { action } : {}) },
            order: { rowNumber: 'ASC' },
            skip: safeSkip,
            take: safeTake,
        });
        return { items, totalItems };
    }

    async resolveRow(ctx: RequestContext, input: ResolveCatalogImportRowInput): Promise<CatalogImportRow> {
        const repository = this.connection.getRepository(ctx, CatalogImportRow);
        const row = await repository.findOne({ where: { id: input.rowId }, relations: ['job'] });
        if (!row || String(row.job.channelId) !== String(ctx.channelId)) {
            throw new UserInputError('导入行不存在或不属于当前门店');
        }
        if (!isCatalogImportResolutionState(row.job.state)) {
            throw new UserInputError('只有预览中、失败待重试或部分完成的任务可以处理待办行');
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
            row.plannedChanges = withRiskConfirmation(row.plannedChanges, ctx);
            row.message = '管理员已确认警告并允许执行';
        } else if (input.resolution === 'CREATE_NEW') {
            const warning = validationWarning(row.normalizedData);
            if (row.plannedChanges?.forceCreateNew !== true) {
                const sourceRecordKey = catalogCreateNewSourceRecordKey(
                    row.normalizedData.sourceRecordKey ?? `legacy-source-key\u001f${row.sourceKey}`,
                    row.rowNumber,
                );
                row.normalizedData = { ...row.normalizedData, sourceRecordKey };
                row.sourceKey = catalogSourceKey(row.normalizedData);
            }
            row.action = warning ? 'WARNING' : 'CREATE';
            row.resolution = 'CREATE_NEW';
            row.targetVariantId = null;
            row.expectedVariantUpdatedAt = null;
            row.plannedChanges = {
                ...(row.plannedChanges ?? {}),
                safeAction: 'CREATE',
                forceCreateNew: true,
                sourceRecordKey: row.normalizedData.sourceRecordKey,
            };
            const createMessage = row.targetProductId
                ? '管理员选择在现有商品下新建 SKU'
                : '管理员选择新建商品和 SKU';
            row.message = warning ? `${createMessage}；${warning}，请再次确认` : createMessage;
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
            if (!isCatalogImportResolutionState(row.job.state)) {
                throw new UserInputError('只有预览中、失败待重试或部分完成的任务可以批量处理');
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
                row.plannedChanges = withRiskConfirmation(row.plannedChanges, ctx);
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
        if (!isCatalogImportResolutionState(job.state)) {
            throw new UserInputError('当前任务状态不能执行');
        }
        const unresolved = await this.connection.getRepository(ctx, CatalogImportRow).count({
            where: { jobId: id, action: In(['CONFLICT', 'WARNING', 'ERROR']) },
        });
        if (unresolved > 0) throw new UserInputError(`还有 ${unresolved} 行冲突、警告或错误未处理`);
        job.state = 'QUEUED';
        job.errorMessage = null;
        job.progress = 0;
        job.completedAt = null;
        await this.connection.getRepository(ctx, CatalogImportJob).save(job);
        if (!this.enqueue) throw new UserInputError('导入队列尚未就绪，请稍后重试');
        await this.enqueue(job.id);
        return this.findJob(ctx, job.id);
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
        const productSourceKeys = new Map<string, Set<string>>();
        for (const row of rows.filter(item => item.action !== 'SKIP_UNCHANGED')) {
            const keys = productSourceKeys.get(row.productKey) ?? new Set<string>();
            keys.add(row.sourceKey);
            productSourceKeys.set(row.productKey, keys);
        }
        const multiVariantProductKeys = new Set(
            [...productSourceKeys.entries()].filter(([, keys]) => keys.size > 1).map(([key]) => key),
        );
        for (const applied of rows.filter(row => row.appliedAt && row.targetProductId)) {
            productByKey.set(applied.productKey, applied.targetProductId as ID);
            if (applied.targetVariantId) {
                variantByKey.set(variantExecutionKey(applied.normalizedData), applied.targetVariantId);
            }
        }
        await this.categories.withDeferredFilters(ctx, async () => {
            let processed = 0;
            let lastProgress = -1;
            for (const row of rows) {
                const previousRowState = { ...row };
                try {
                    if (row.appliedAt || row.action === 'SKIP_UNCHANGED' || row.action === 'ERROR') {
                        processed++;
                        continue;
                    }
                    if (row.action !== 'CREATE' && row.action !== 'UPDATE') {
                        throw new UserInputError('存在未解决的冲突或警告');
                    }
                    await this.connection.withTransaction(ctx, async txCtx => {
                        await this.applyRow(
                            txCtx,
                            job,
                            row,
                            productByKey,
                            variantByKey,
                            stockLocations,
                            multiVariantProductKeys,
                        );
                    });
                    if (row.targetProductId) productByKey.set(row.productKey, row.targetProductId);
                    if (row.targetVariantId)
                        variantByKey.set(variantExecutionKey(row.normalizedData), row.targetVariantId);
                } catch (error) {
                    Object.assign(row, previousRowState);
                    row.action = 'ERROR';
                    row.message = safeMessage(error);
                    await this.connection.getRepository(ctx, CatalogImportRow).save(row);
                }
                processed++;
                const progress = Math.round((processed / Math.max(rows.length, 1)) * 100);
                if (progress !== lastProgress) {
                    await repository.update(id, { progress });
                    onProgress(progress);
                    lastProgress = progress;
                }
            }
        });
        const errorCount = await this.connection.getRepository(ctx, CatalogImportRow).count({
            where: { jobId: id, action: In(['ERROR', 'CONFLICT', 'WARNING']) },
        });
        await this.refreshCounts(ctx, id);
        await this.searchService.reindex(ctx);
        await repository.update(id, {
            state: errorCount > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED',
            progress: 100,
            completedAt: new Date(),
            errorMessage: errorCount > 0 ? `${errorCount} 行未执行，请查看报告` : null,
        });
    }

    async rollback(ctx: RequestContext, id: ID): Promise<CatalogImportJob> {
        const job = await this.findJob(ctx, id);
        if (!['COMPLETED', 'COMPLETED_WITH_ERRORS'].includes(job.state)) {
            throw new UserInputError('只有已完成的任务可以回滚');
        }
        const rows = (await this.findRows(ctx, id)).filter(row => row.appliedAt).reverse();
        await this.assertRollbackSafe(ctx, rows);
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

    private async assertRollbackSafe(ctx: RequestContext, rows: CatalogImportRow[]): Promise<void> {
        return this.rollbackExecutor.assertRollbackSafe(ctx, rows);
    }

    private async planRow(
        ctx: RequestContext,
        row: NormalizedCatalogRow,
        input: CatalogImportContextInput,
        catalogIndex: CatalogIndexProduct[],
        binding?: CatalogSourceBinding,
        suppliersByName: Map<string, CatalogSupplier> = new Map(),
    ): Promise<PlannedRow> {
        return this.preview.planRow(ctx, row, input, catalogIndex, binding, suppliersByName);
    }

    private async snapshotVariant(
        ctx: RequestContext,
        variant: ProductVariant,
        job: Pick<CatalogImportJob, 'stockLocationId' | 'currencyCode'>,
    ): Promise<Record<string, unknown>> {
        return this.preview.snapshotVariant(ctx, variant, job);
    }

    private diffRow(
        row: NormalizedCatalogRow,
        snapshot: Record<string, unknown>,
        currencyCode: CurrencyCode,
        clearBlankFields: boolean,
    ): Record<string, unknown> {
        return this.preview.diffRow(row, snapshot, currencyCode, clearBlankFields);
    }

    private async applyRow(
        ctx: RequestContext,
        job: CatalogImportJob,
        row: CatalogImportRow,
        productByKey: Map<string, ID>,
        variantByKey: Map<string, ID>,
        stockLocations: Array<{ id: string; name: string }>,
        multiVariantProductKeys: Set<string>,
    ): Promise<void> {
        return this.writer.applyRow(
            ctx,
            job,
            row,
            productByKey,
            variantByKey,
            stockLocations,
            multiVariantProductKeys,
        );
    }

    private async rollbackRow(
        ctx: RequestContext,
        job: CatalogImportJob,
        row: CatalogImportRow,
    ): Promise<void> {
        return this.rollbackExecutor.rollbackRow(ctx, job, row);
    }

    private async buildCatalogIndex(ctx: RequestContext): Promise<CatalogIndexProduct[]> {
        return this.preview.buildCatalogIndex(ctx);
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

    private async attachReceivedRows(ctx: RequestContext, jobs: CatalogImportJob[]): Promise<void> {
        if (jobs.length === 0) return;
        const counts = await this.connection
            .getRepository(ctx, CatalogImportRow)
            .createQueryBuilder('row')
            .select('row.jobId', 'jobId')
            .addSelect('COUNT(row.id)', 'count')
            .where('row.jobId IN (:...jobIds)', { jobIds: jobs.map(job => job.id) })
            .groupBy('row.jobId')
            .getRawMany<{ jobId: string; count: string }>();
        const countByJobId = new Map(counts.map(item => [String(item.jobId), Number(item.count)]));
        for (const job of jobs) job.receivedRows = countByJobId.get(String(job.id)) ?? 0;
    }
}
