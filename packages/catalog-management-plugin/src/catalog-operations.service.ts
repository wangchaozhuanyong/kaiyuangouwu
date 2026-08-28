import { Injectable } from '@nestjs/common';
import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import {
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

import { InventoryLot } from './entities/inventory-lot.entity';
import { InventoryPolicy } from './entities/inventory-policy.entity';
import { VariantCostRecord } from './entities/variant-cost-record.entity';
import { SaveInventoryLotInput, UpdateCatalogVariantOperationsInput } from './types';

@Injectable()
export class CatalogOperationsService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly productVariantService: ProductVariantService,
        private readonly stockMovementService: StockMovementService,
    ) {}

    async workspace(ctx: RequestContext, productId: ID) {
        const variants = await this.productVariantService.getVariantsByProductId(
            ctx,
            productId,
            { take: 1_000 },
            ['stockLevels', 'stockLevels.stockLocation', 'productVariantPrices', 'options'],
        );
        const stockLocations = await this.stockLocations(ctx);
        const variantIds = variants.items.map(variant => variant.id);
        const [costs, policies, lots] = variantIds.length
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
              ])
            : [[], [], []];
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
                    sellingPrice: variant.price,
                    currencyCode: variant.currencyCode,
                    purchaseCostMicrounits: costMicrounits,
                    grossProfitMicrounits:
                        costMicrounits == null ? null : variant.price * 10 - costMicrounits,
                    margin,
                    stockLevels: variant.stockLevels.map(level => ({
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
                    lots: lots.filter(lot => String(lot.variantId) === String(variant.id)).map(toLotView),
                };
            }),
        };
    }

    async updateVariant(ctx: RequestContext, input: UpdateCatalogVariantOperationsInput) {
        await this.requireStockLocation(ctx, input.stockLocationId);
        validatePolicy(input.minimumStock, input.maximumStock);
        if (input.stockOnHand != null && input.stockOnHand < 0) {
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
        return this.workspace(ctx, variant.productId);
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
