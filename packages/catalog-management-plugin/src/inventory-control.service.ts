import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import {
    ProductVariant,
    RequestContext,
    StockLevel,
    StockMovementService,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { randomUUID } from 'node:crypto';
import { In } from 'typeorm';

import { CatalogOperationsService } from './catalog-operations.service';
import { InventoryLot } from './entities/inventory-lot.entity';
import { InventoryOperationLine } from './entities/inventory-operation-line.entity';
import { InventoryOperation, InventoryOperationType } from './entities/inventory-operation.entity';
import {
    AdjustLegacyInventoryInput,
    ResolveInventoryReconciliationInput,
    SaveManualInventoryLotInput,
    TransferInventoryLotInput,
} from './types';

@Injectable()
export class InventoryControlService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly operations: CatalogOperationsService,
        private readonly stockMovements: StockMovementService,
    ) {}

    async findOperations(ctx: RequestContext, skip = 0, take = 50) {
        const [items, totalItems] = await this.connection
            .getRepository(ctx, InventoryOperation)
            .findAndCount({
                where: { channelId: ctx.channelId },
                relations: ['lines', 'lines.variant', 'lines.stockLocation', 'lines.inventoryLot'],
                order: { createdAt: 'DESC', id: 'DESC' },
                skip: Math.max(0, skip),
                take: Math.min(Math.max(1, take), 200),
            });
        return { items, totalItems };
    }

    async saveManualLot(ctx: RequestContext, input: SaveManualInventoryLotInput) {
        const reason = requiredText(input.reason, 500, '库存调整原因');
        const key = requiredText(input.idempotencyKey, 80, '幂等键');
        return this.connection.withTransaction(ctx, async txCtx => {
            const duplicate = await this.findOperationByKey(txCtx, key);
            if (duplicate) {
                requireOperationType(duplicate, 'MANUAL_LOT_COUNT');
                return this.lotFromDuplicate(txCtx, duplicate);
            }
            const previousStock = await this.lockStockOnHand(
                txCtx,
                input.productVariantId,
                input.stockLocationId,
            );
            const repository = this.connection.getRepository(txCtx, InventoryLot);
            let existing = input.id
                ? await this.lockLot(txCtx, input.id)
                : await repository.findOne({
                      where: {
                          variantId: input.productVariantId,
                          stockLocationId: input.stockLocationId,
                          lotCode: input.lotCode.trim(),
                      },
                  });
            if (existing && !input.id) existing = await this.lockLot(txCtx, existing.id);
            if (
                existing &&
                (String(existing.variantId) !== String(input.productVariantId) ||
                    String(existing.stockLocationId) !== String(input.stockLocationId) ||
                    existing.lotCode !== input.lotCode.trim())
            ) {
                throw new UserInputError('已有批次的 SKU、仓库和批次号不能修改');
            }
            const previousLotQuantity = existing?.quantityOnHand ?? 0;
            const saved = await this.operations.saveLot(txCtx, input, true);
            const operation = await this.createOperation(
                txCtx,
                'MANUAL_LOT_COUNT',
                key,
                reason,
                input.id ? `LOT:${String(input.id)}` : `LOT:${input.lotCode.trim()}`,
            );
            await this.connection.getRepository(txCtx, InventoryOperationLine).save(
                new InventoryOperationLine({
                    operationId: operation.id,
                    variantId: input.productVariantId,
                    stockLocationId: input.stockLocationId,
                    inventoryLotId: saved.id,
                    quantityDelta: input.quantityOnHand - previousLotQuantity,
                    previousLotQuantity,
                    resultingLotQuantity: input.quantityOnHand,
                    previousStockOnHand: previousStock,
                    resultingStockOnHand: previousStock + input.quantityOnHand - previousLotQuantity,
                    reconciliationMode: null,
                }),
            );
            return saved;
        });
    }

    async adjustLegacyStock(ctx: RequestContext, input: AdjustLegacyInventoryInput) {
        return this.operations.adjustLegacyStock(ctx, input);
    }

    async transferLot(ctx: RequestContext, input: TransferInventoryLotInput) {
        validatePositiveInteger(input.quantity, '转仓数量');
        const reason = requiredText(input.reason, 500, '转仓原因');
        const key = requiredText(input.idempotencyKey, 80, '幂等键');
        return this.connection.withTransaction(ctx, async txCtx => {
            const duplicate = await this.findOperationByKey(txCtx, key);
            if (duplicate) {
                requireOperationType(duplicate, 'LOT_TRANSFER');
                return duplicate;
            }
            const sourceSnapshot = await this.connection
                .getRepository(txCtx, InventoryLot)
                .findOne({ where: { id: input.inventoryLotId } });
            if (!sourceSnapshot) throw new UserInputError('库存批次不存在');
            if (String(sourceSnapshot.stockLocationId) === String(input.targetStockLocationId)) {
                throw new UserInputError('目标仓库不能与来源仓库相同');
            }
            await this.operations.requireStockLocation(txCtx, sourceSnapshot.stockLocationId);
            await this.operations.requireStockLocation(txCtx, input.targetStockLocationId);
            const locationIds = [sourceSnapshot.stockLocationId, input.targetStockLocationId].sort(
                (left, right) => String(left).localeCompare(String(right)),
            );
            for (const locationId of locationIds) {
                await this.lockStockOnHand(txCtx, sourceSnapshot.variantId, locationId);
            }
            const source = await this.lockLot(txCtx, input.inventoryLotId);
            if (
                String(source.variantId) !== String(sourceSnapshot.variantId) ||
                String(source.stockLocationId) !== String(sourceSnapshot.stockLocationId)
            ) {
                throw new UserInputError('库存批次归属已发生变化，请刷新后重试');
            }
            if (source.quantityOnHand < input.quantity) throw new UserInputError('来源批次可用数量不足');
            await this.requireReconciledScope(txCtx, source.variantId, source.stockLocationId);
            await this.requireReconciledScope(txCtx, source.variantId, input.targetStockLocationId);
            const lotRepository = this.connection.getRepository(txCtx, InventoryLot);
            let target = await lotRepository.findOne({
                where: {
                    variantId: source.variantId,
                    stockLocationId: input.targetStockLocationId,
                    lotCode: source.lotCode,
                },
            });
            if (target) target = await this.lockLot(txCtx, target.id);
            const sourceStockBefore = await this.stockOnHand(txCtx, source.variantId, source.stockLocationId);
            const targetStockBefore = await this.stockOnHand(
                txCtx,
                source.variantId,
                input.targetStockLocationId,
            );
            const sourceSaved = await this.operations.saveLot(
                txCtx,
                lotInput(source, source.quantityOnHand - input.quantity),
                true,
            );
            const targetSaved = await this.operations.saveLot(
                txCtx,
                {
                    ...lotInput(source, (target?.quantityOnHand ?? 0) + input.quantity),
                    id: target?.id,
                    stockLocationId: input.targetStockLocationId,
                },
                true,
            );
            const operation = await this.createOperation(
                txCtx,
                'LOT_TRANSFER',
                key,
                reason,
                optionalText(input.reference, 160),
            );
            await this.connection.getRepository(txCtx, InventoryOperationLine).save([
                new InventoryOperationLine({
                    operationId: operation.id,
                    variantId: source.variantId,
                    stockLocationId: source.stockLocationId,
                    inventoryLotId: sourceSaved.id,
                    quantityDelta: -input.quantity,
                    previousLotQuantity: source.quantityOnHand,
                    resultingLotQuantity: source.quantityOnHand - input.quantity,
                    previousStockOnHand: sourceStockBefore,
                    resultingStockOnHand: sourceStockBefore - input.quantity,
                    reconciliationMode: null,
                }),
                new InventoryOperationLine({
                    operationId: operation.id,
                    variantId: source.variantId,
                    stockLocationId: input.targetStockLocationId,
                    inventoryLotId: targetSaved.id,
                    quantityDelta: input.quantity,
                    previousLotQuantity: target?.quantityOnHand ?? 0,
                    resultingLotQuantity: (target?.quantityOnHand ?? 0) + input.quantity,
                    previousStockOnHand: targetStockBefore,
                    resultingStockOnHand: targetStockBefore + input.quantity,
                    reconciliationMode: null,
                }),
            ]);
            return this.operationById(txCtx, operation.id);
        });
    }

    async reconciliationOverview(ctx: RequestContext) {
        const locations = await this.operations.stockLocations(ctx, false);
        if (!locations.length) return { items: [], totalItems: 0 };
        const rows = await this.connection
            .getRepository(ctx, InventoryLot)
            .createQueryBuilder('lot')
            .select('lot.variantId', 'variantId')
            .addSelect('lot.stockLocationId', 'stockLocationId')
            .addSelect('SUM(lot.quantityOnHand)', 'lotQuantity')
            .where('lot.stockLocationId IN (:...locationIds)', {
                locationIds: locations.map(location => location.id),
            })
            .groupBy('lot.variantId')
            .addGroupBy('lot.stockLocationId')
            .limit(5_001)
            .getRawMany<{ variantId: string; stockLocationId: string; lotQuantity: string }>();
        if (rows.length > 5_000) throw new UserInputError('批次库存对账超过 5,000 个范围，请先按门店拆分');
        const variantIds = [...new Set(rows.map(row => row.variantId))];
        const [variants, stockLevels] = variantIds.length
            ? await Promise.all([
                  this.connection.getRepository(ctx, ProductVariant).find({
                      where: { id: In(variantIds) },
                      relations: ['translations'],
                  }),
                  this.connection.getRepository(ctx, StockLevel).find({
                      where: {
                          productVariantId: In(variantIds),
                          stockLocationId: In(locations.map(location => location.id)),
                      },
                  }),
              ])
            : [[], []];
        const variantsById = new Map(variants.map(variant => [String(variant.id), variant]));
        const stockByScope = new Map(
            stockLevels.map(level => [
                `${String(level.productVariantId)}:${String(level.stockLocationId)}`,
                level,
            ]),
        );
        const locationsById = new Map(locations.map(location => [String(location.id), location.name]));
        const items = rows.flatMap(row => {
            const stockOnHand =
                stockByScope.get(`${String(row.variantId)}:${String(row.stockLocationId)}`)?.stockOnHand ?? 0;
            const lotQuantity = Number(row.lotQuantity);
            if (stockOnHand === lotQuantity) return [];
            const variant = variantsById.get(String(row.variantId));
            return [
                {
                    id: `${String(row.variantId)}:${String(row.stockLocationId)}`,
                    productVariantId: String(row.variantId),
                    variantName: variant?.name || variant?.sku || String(row.variantId),
                    sku: variant?.sku ?? '',
                    stockLocationId: String(row.stockLocationId),
                    stockLocationName:
                        locationsById.get(String(row.stockLocationId)) ?? String(row.stockLocationId),
                    lotQuantity,
                    stockOnHand,
                    difference: stockOnHand - lotQuantity,
                    canCreateBaselineLot: stockOnHand > lotQuantity,
                },
            ];
        });
        return { items, totalItems: items.length };
    }

    async resolveReconciliation(ctx: RequestContext, input: ResolveInventoryReconciliationInput) {
        const reason = requiredText(input.reason, 500, '对账处理原因');
        const key = requiredText(input.idempotencyKey, 80, '幂等键');
        if (!['ALIGN_STOCK_TO_LOTS', 'CREATE_BASELINE_LOT'].includes(input.mode)) {
            throw new UserInputError('无效对账处理方式');
        }
        return this.connection.withTransaction(ctx, async txCtx => {
            const duplicate = await this.findOperationByKey(txCtx, key);
            if (duplicate) {
                requireOperationType(duplicate, 'RECONCILIATION');
                return duplicate;
            }
            await this.operations.requireStockLocation(txCtx, input.stockLocationId);
            const stockOnHand = await this.lockStockOnHand(
                txCtx,
                input.productVariantId,
                input.stockLocationId,
            );
            const lots = await this.lockLotsInScope(txCtx, input.productVariantId, input.stockLocationId);
            if (!lots.length) throw new UserInputError('该 SKU 尚未启用批次跟踪，无需执行批次对账');
            const lotQuantity = lots.reduce((sum, lot) => sum + lot.quantityOnHand, 0);
            const difference = stockOnHand - lotQuantity;
            if (difference !== input.expectedDifference) {
                throw new UserInputError('库存差异已发生变化，请刷新后重新确认');
            }
            if (difference === 0) throw new UserInputError('当前已无库存差异');
            let inventoryLotId: ID | null = null;
            let resultingStock = stockOnHand;
            let resultingLot = lotQuantity;
            if (input.mode === 'CREATE_BASELINE_LOT') {
                if (difference <= 0) throw new UserInputError('批次总数不小于总库存，不能创建期初批次');
                const baseline = await this.operations.saveLot(
                    txCtx,
                    {
                        productVariantId: input.productVariantId,
                        stockLocationId: input.stockLocationId,
                        lotCode: `BASELINE-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomUUID().slice(0, 6).toUpperCase()}`,
                        quantityOnHand: difference,
                        currencyCode: txCtx.channel.defaultCurrencyCode,
                    },
                    false,
                );
                inventoryLotId = baseline.id;
                resultingLot = stockOnHand;
            } else {
                await this.stockMovements.adjustProductVariantStock(txCtx, input.productVariantId, [
                    { stockLocationId: input.stockLocationId, stockOnHand: lotQuantity },
                ]);
                resultingStock = lotQuantity;
            }
            const operation = await this.createOperation(
                txCtx,
                'RECONCILIATION',
                key,
                reason,
                `${String(input.productVariantId)}:${String(input.stockLocationId)}`,
            );
            await this.connection.getRepository(txCtx, InventoryOperationLine).save(
                new InventoryOperationLine({
                    operationId: operation.id,
                    variantId: input.productVariantId,
                    stockLocationId: input.stockLocationId,
                    inventoryLotId,
                    quantityDelta: input.mode === 'CREATE_BASELINE_LOT' ? difference : -difference,
                    previousLotQuantity: lotQuantity,
                    resultingLotQuantity: resultingLot,
                    previousStockOnHand: stockOnHand,
                    resultingStockOnHand: resultingStock,
                    reconciliationMode: input.mode,
                }),
            );
            return this.operationById(txCtx, operation.id);
        });
    }

    private async createOperation(
        ctx: RequestContext,
        type: InventoryOperationType,
        idempotencyKey: string,
        reason: string,
        reference: string | null,
    ) {
        return this.connection.getRepository(ctx, InventoryOperation).save(
            new InventoryOperation({
                channelId: ctx.channelId,
                code: `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomUUID().slice(0, 8).toUpperCase()}`,
                idempotencyKey,
                type,
                status: 'POSTED',
                actorUserId: ctx.activeUserId == null ? null : String(ctx.activeUserId),
                reason,
                reference,
                postedAt: new Date(),
            }),
        );
    }

    private findOperationByKey(ctx: RequestContext, idempotencyKey: string) {
        return this.connection.getRepository(ctx, InventoryOperation).findOne({
            where: { channelId: ctx.channelId, idempotencyKey },
            relations: ['lines', 'lines.inventoryLot', 'lines.variant', 'lines.stockLocation'],
        });
    }

    private operationById(ctx: RequestContext, id: ID) {
        return this.connection.getRepository(ctx, InventoryOperation).findOneOrFail({
            where: { id, channelId: ctx.channelId },
            relations: ['lines', 'lines.inventoryLot', 'lines.variant', 'lines.stockLocation'],
        });
    }

    private async lotFromDuplicate(ctx: RequestContext, operation: InventoryOperation) {
        const lotId = operation.lines?.find(line => line.inventoryLotId)?.inventoryLotId;
        if (!lotId) throw new UserInputError('重试操作缺少批次审计证据');
        const lot = await this.connection.getRepository(ctx, InventoryLot).findOne({ where: { id: lotId } });
        if (!lot) throw new UserInputError('重试操作对应的库存批次已不存在');
        return lotView(lot);
    }

    private async lockLot(ctx: RequestContext, id: ID): Promise<InventoryLot> {
        const repository = this.connection.getRepository(ctx, InventoryLot);
        const query = repository.createQueryBuilder('lot').where('lot.id = :id', { id });
        const type = String(repository.manager.connection.options.type);
        if (
            !['sqlite', 'better-sqlite3', 'sqljs'].includes(type) &&
            repository.manager.queryRunner?.isTransactionActive
        ) {
            query.setLock('pessimistic_write');
        }
        const lot = await query.getOne();
        if (!lot) throw new UserInputError('库存批次不存在');
        return lot;
    }

    private async lockLotsInScope(
        ctx: RequestContext,
        variantId: ID,
        stockLocationId: ID,
    ): Promise<InventoryLot[]> {
        const repository = this.connection.getRepository(ctx, InventoryLot);
        const query = repository
            .createQueryBuilder('lot')
            .where('lot.variantId = :variantId', { variantId })
            .andWhere('lot.stockLocationId = :stockLocationId', { stockLocationId })
            .orderBy('lot.id', 'ASC');
        const type = String(repository.manager.connection.options.type);
        if (
            !['sqlite', 'better-sqlite3', 'sqljs'].includes(type) &&
            repository.manager.queryRunner?.isTransactionActive
        ) {
            query.setLock('pessimistic_write');
        }
        return query.getMany();
    }

    private async stockOnHand(ctx: RequestContext, variantId: ID, stockLocationId: ID): Promise<number> {
        const level = await this.connection.getRepository(ctx, StockLevel).findOne({
            where: { productVariantId: variantId, stockLocationId },
        });
        return level?.stockOnHand ?? 0;
    }

    private async lockStockOnHand(ctx: RequestContext, variantId: ID, stockLocationId: ID): Promise<number> {
        const repository = this.connection.getRepository(ctx, StockLevel);
        const query = repository
            .createQueryBuilder('stock')
            .where('stock.productVariantId = :variantId', { variantId })
            .andWhere('stock.stockLocationId = :stockLocationId', { stockLocationId });
        const type = String(repository.manager.connection.options.type);
        if (
            !['sqlite', 'better-sqlite3', 'sqljs'].includes(type) &&
            repository.manager.queryRunner?.isTransactionActive
        ) {
            query.setLock('pessimistic_write');
        }
        return (await query.getOne())?.stockOnHand ?? 0;
    }

    private async requireReconciledScope(
        ctx: RequestContext,
        variantId: ID,
        stockLocationId: ID,
    ): Promise<void> {
        const [lotQuantity, stockOnHand] = await Promise.all([
            this.connection
                .getRepository(ctx, InventoryLot)
                .sum('quantityOnHand', { variantId, stockLocationId }),
            this.stockOnHand(ctx, variantId, stockLocationId),
        ]);
        if ((lotQuantity ?? 0) !== stockOnHand) {
            throw new UserInputError('该 SKU 在转仓前存在批次差异，请先在库存控制台完成对账');
        }
    }
}

function lotInput(lot: InventoryLot, quantityOnHand: number) {
    return {
        id: lot.id,
        productVariantId: lot.variantId,
        stockLocationId: lot.stockLocationId,
        lotCode: lot.lotCode,
        manufacturedAt: lot.manufacturedAt,
        expiresAt: lot.expiresAt,
        quantityOnHand,
        purchaseCostMicrounits:
            lot.purchaseCostMicrounits == null ? null : Number(lot.purchaseCostMicrounits),
        currencyCode: lot.currencyCode,
    };
}

function lotView(lot: InventoryLot) {
    return {
        ...lot,
        productVariantId: String(lot.variantId),
        purchaseCostMicrounits:
            lot.purchaseCostMicrounits == null ? null : Number(lot.purchaseCostMicrounits),
        daysUntilExpiry: lot.expiresAt
            ? Math.ceil((lot.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1_000))
            : null,
    };
}

function requiredText(value: unknown, max: number, label: string): string {
    const text = optionalText(value, max);
    if (!text) throw new UserInputError(`${label}不能为空`);
    return text;
}

function optionalText(value: unknown, max: number): string | null {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    return text ? text.slice(0, max) : null;
}

function validatePositiveInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) throw new UserInputError(`${label}必须是正整数`);
}

function requireOperationType(operation: InventoryOperation, expected: InventoryOperationType): void {
    if (operation.type !== expected) {
        throw new UserInputError('幂等键已被其他库存操作使用');
    }
}
