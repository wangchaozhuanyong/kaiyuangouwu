import { Injectable } from '@nestjs/common';
import { GlobalFlag } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import {
    EventBus,
    GlobalSettingsService,
    LanguageCode,
    Order,
    OrderLine,
    Product,
    ProductVariant,
    ProductVariantEvent,
    RequestContext,
    StockAdjustment,
    StockLevel,
    StockMovementEvent,
    TransactionalConnection,
    UserInputError,
    idsAreEqual,
} from '@vendure/core';
import { In } from 'typeorm';

import { PackagingUnpackEvent } from './entities/packaging-unpack-event.entity';
import { ProductPackagingRule } from './entities/product-packaging-rule.entity';
import { calculateAutoUnpack } from './product-packaging-calculation';
import { UpdateProductPackagingInput } from './types';

const RULE_RELATIONS = [
    'product',
    'unitVariant',
    'unitVariant.product',
    'packageVariant',
    'packageVariant.product',
];

export interface ProductPackagingStockSummary {
    unitStockOnHand: number;
    unitStockAllocated: number;
    unitStockAvailable: number;
    packageStockOnHand: number;
    packageStockAllocated: number;
    packageStockAvailable: number;
    convertibleUnitStock: number;
}

interface StockTotals {
    stockOnHand: number;
    stockAllocated: number;
}

@Injectable()
export class ProductPackagingService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly globalSettingsService: GlobalSettingsService,
        private readonly eventBus: EventBus,
    ) {}

    configForProduct(ctx: RequestContext, productId: ID): Promise<ProductPackagingRule | null> {
        return this.connection.getRepository(ctx, ProductPackagingRule).findOne({
            where: { channelId: ctx.channelId, productId },
            relations: RULE_RELATIONS,
        });
    }

    async updateConfig(
        ctx: RequestContext,
        input: UpdateProductPackagingInput,
    ): Promise<ProductPackagingRule> {
        const unitLabel = input.unitLabel.trim();
        const packageLabel = input.packageLabel.trim();
        if (!unitLabel || unitLabel.length > 32 || !packageLabel || packageLabel.length > 32) {
            throw new UserInputError('Packaging unit labels must contain between 1 and 32 characters.');
        }
        if (
            !Number.isInteger(input.unitsPerPackage) ||
            input.unitsPerPackage < 2 ||
            input.unitsPerPackage > 1_000_000
        ) {
            throw new UserInputError('Units per package must be an integer between 2 and 1000000.');
        }
        if (idsAreEqual(input.unitVariantId, input.packageVariantId)) {
            throw new UserInputError('The loose-unit and package variants must be different.');
        }

        const product = await this.connection.getEntityOrThrow(ctx, Product, input.productId, {
            relations: ['channels'],
        });
        if (!product.channels.some(channel => idsAreEqual(channel.id, ctx.channelId))) {
            throw new UserInputError('The product is not assigned to the active channel.');
        }
        const variants = await this.connection.getRepository(ctx, ProductVariant).find({
            where: { id: In([input.unitVariantId, input.packageVariantId]) },
            relations: ['product'],
        });
        const unitVariant = variants.find(variant => idsAreEqual(variant.id, input.unitVariantId));
        const packageVariant = variants.find(variant => idsAreEqual(variant.id, input.packageVariantId));
        if (!unitVariant || !packageVariant) {
            throw new UserInputError('Both packaging variants must exist.');
        }
        if (
            !idsAreEqual(unitVariant.productId, product.id) ||
            !idsAreEqual(packageVariant.productId, product.id)
        ) {
            throw new UserInputError('Both packaging variants must belong to the selected product.');
        }
        if (
            unitVariant.customFields.fulfillmentType === 'digital' ||
            packageVariant.customFields.fulfillmentType === 'digital'
        ) {
            throw new UserInputError('Automatic unpacking is only available for physical products.');
        }
        const settings = await this.globalSettingsService.getSettings(ctx);
        const inventoryDisabled = (variant: ProductVariant) =>
            variant.trackInventory === GlobalFlag.FALSE ||
            (variant.trackInventory === GlobalFlag.INHERIT && settings.trackInventory === false);
        if (inventoryDisabled(unitVariant) || inventoryDisabled(packageVariant)) {
            throw new UserInputError('Both packaging variants must track inventory.');
        }

        const repository = this.connection.getRepository(ctx, ProductPackagingRule);
        const existing = await repository.findOne({
            where: { channelId: ctx.channelId, productId: product.id },
        });
        const rule = repository.create({
            ...(existing ?? {}),
            channelId: ctx.channelId,
            productId: product.id,
            unitVariantId: unitVariant.id,
            packageVariantId: packageVariant.id,
            unitLabel,
            packageLabel,
            unitsPerPackage: input.unitsPerPackage,
            enabled: input.enabled,
            autoUnpack: input.autoUnpack,
        });
        const saved = await repository.save(rule);
        const hydrated = await this.configForProduct(ctx, saved.productId);
        if (!hydrated) {
            throw new Error('Could not reload the saved packaging rule.');
        }
        await this.ensureStockLevelPairs(ctx, [hydrated]);
        await this.eventBus.publish(
            new ProductVariantEvent(ctx, [hydrated.unitVariant, hydrated.packageVariant], 'updated'),
        );
        return hydrated;
    }

    async stockSummary(ctx: RequestContext, productId: ID): Promise<ProductPackagingStockSummary | null> {
        const rule = await this.configForProduct(ctx, productId);
        if (!rule) {
            return null;
        }
        const settings = await this.globalSettingsService.getSettings(ctx);
        const [unit, packageStock] = await Promise.all([
            this.ownStockTotals(ctx, rule.unitVariantId),
            this.ownStockTotals(ctx, rule.packageVariantId),
        ]);
        const unitThreshold = this.outOfStockThreshold(rule.unitVariant, settings.outOfStockThreshold);
        const packageThreshold = Math.max(
            this.outOfStockThreshold(rule.packageVariant, settings.outOfStockThreshold),
            0,
        );
        const unitStockAvailable = Math.max(unit.stockOnHand - unit.stockAllocated - unitThreshold, 0);
        const packageStockAvailable = Math.max(
            packageStock.stockOnHand - packageStock.stockAllocated - packageThreshold,
            0,
        );
        return {
            unitStockOnHand: unit.stockOnHand,
            unitStockAllocated: unit.stockAllocated,
            unitStockAvailable,
            packageStockOnHand: packageStock.stockOnHand,
            packageStockAllocated: packageStock.stockAllocated,
            packageStockAvailable,
            convertibleUnitStock: Math.max(
                unit.stockOnHand -
                    unit.stockAllocated -
                    unitThreshold +
                    (rule.enabled && rule.autoUnpack ? packageStockAvailable * rule.unitsPerPackage : 0),
                0,
            ),
        };
    }

    async unpackEvents(ctx: RequestContext, productId: ID, take = 20): Promise<PackagingUnpackEvent[]> {
        const rule = await this.configForProduct(ctx, productId);
        if (!rule) {
            return [];
        }
        return this.connection.getRepository(ctx, PackagingUnpackEvent).find({
            where: { ruleId: rule.id, channelId: ctx.channelId },
            relations: ['stockLocation', 'order'],
            order: { createdAt: 'DESC' },
            take: Math.min(Math.max(take, 1), 100),
        });
    }

    async rulesForVariantIds(ctx: RequestContext, variantIds: ID[]): Promise<ProductPackagingRule[]> {
        if (variantIds.length === 0) {
            return [];
        }
        return this.connection.getRepository(ctx, ProductPackagingRule).find({
            where: [
                { channelId: ctx.channelId, enabled: true, unitVariantId: In(variantIds) },
                { channelId: ctx.channelId, enabled: true, packageVariantId: In(variantIds) },
            ],
            relations: RULE_RELATIONS,
        });
    }

    variantIdsForLock(orderVariantIds: ID[], rules: ProductPackagingRule[]): ID[] {
        return [
            ...new Set(
                [
                    ...orderVariantIds,
                    ...rules.flatMap(rule => [rule.unitVariantId, rule.packageVariantId]),
                ].map(String),
            ),
        ].sort();
    }

    async ensureStockLevelPairs(ctx: RequestContext, rules: ProductPackagingRule[]): Promise<void> {
        const repository = this.connection.getRepository(ctx, StockLevel);
        for (const rule of rules) {
            const rows = await repository
                .createQueryBuilder('stock')
                .leftJoinAndSelect('stock.stockLocation', 'stockLocation')
                .leftJoinAndSelect('stockLocation.channels', 'channel')
                .where('stock.productVariantId IN (:...variantIds)', {
                    variantIds: [rule.unitVariantId, rule.packageVariantId],
                })
                .andWhere('channel.id = :channelId', { channelId: ctx.channelId })
                .getMany();
            const locationIds = [...new Set(rows.map(row => String(row.stockLocationId)))];
            const existingKeys = new Set(
                rows.map(row => `${String(row.productVariantId)}:${String(row.stockLocationId)}`),
            );
            const missingRows = locationIds.flatMap(stockLocationId =>
                [rule.unitVariantId, rule.packageVariantId]
                    .filter(variantId => !existingKeys.has(`${String(variantId)}:${stockLocationId}`))
                    .map(
                        productVariantId =>
                            new StockLevel({
                                productVariantId,
                                stockLocationId,
                                stockOnHand: 0,
                                stockAllocated: 0,
                            }),
                    ),
            );
            if (missingRows.length > 0) {
                await repository.save(missingRows);
            }
        }
    }

    async autoUnpackForOrder(
        ctx: RequestContext,
        order: Order,
        orderLines: OrderLine[],
        rules: ProductPackagingRule[],
        lockedStockLevels: StockLevel[],
    ): Promise<string | undefined> {
        const settings = await this.globalSettingsService.getSettings(ctx);
        for (const rule of rules.filter(item => item.autoUnpack)) {
            const unitDemand = orderLines
                .filter(line => idsAreEqual(line.productVariantId, rule.unitVariantId))
                .reduce((total, line) => total + line.quantity, 0);
            if (unitDemand === 0) {
                continue;
            }
            const packageDemand = orderLines
                .filter(line => idsAreEqual(line.productVariantId, rule.packageVariantId))
                .reduce((total, line) => total + line.quantity, 0);
            const unitRows = this.activeChannelRows(ctx, lockedStockLevels, rule.unitVariantId);
            const packageRows = this.activeChannelRows(ctx, lockedStockLevels, rule.packageVariantId);
            const unitTotals = this.sumRows(unitRows);
            const packageTotals = this.sumRows(packageRows);
            const calculation = calculateAutoUnpack({
                unitDemand,
                packageDemand,
                unitStockOnHand: unitTotals.stockOnHand,
                unitStockAllocated: unitTotals.stockAllocated,
                unitOutOfStockThreshold: this.outOfStockThreshold(
                    rule.unitVariant,
                    settings.outOfStockThreshold,
                ),
                packageStockOnHand: packageTotals.stockOnHand,
                packageStockAllocated: packageTotals.stockAllocated,
                packageOutOfStockThreshold: Math.max(
                    this.outOfStockThreshold(rule.packageVariant, settings.outOfStockThreshold),
                    0,
                ),
                unitsPerPackage: rule.unitsPerPackage,
            });
            if (!calculation.sufficient) {
                return ctx.languageCode === LanguageCode.zh_Hans
                    ? `${rule.unitVariant.name}散件库存不足，且可拆整箱库存不足`
                    : `Insufficient loose and unpackable stock for ${rule.unitVariant.name}`;
            }
            if (calculation.packagesToOpen === 0) {
                continue;
            }

            let remaining = calculation.packagesToOpen;
            for (const packageRow of packageRows) {
                if (remaining === 0) {
                    break;
                }
                const availableAtLocation = Math.max(packageRow.stockOnHand - packageRow.stockAllocated, 0);
                const packagesOpened = Math.min(remaining, availableAtLocation);
                if (packagesOpened === 0) {
                    continue;
                }
                const unitRow = unitRows.find(row =>
                    idsAreEqual(row.stockLocationId, packageRow.stockLocationId),
                );
                if (!unitRow) {
                    throw new Error(
                        `Missing loose-unit stock row for location ${String(packageRow.stockLocationId)}`,
                    );
                }
                const packageStockBefore = packageRow.stockOnHand;
                const unitStockBefore = unitRow.stockOnHand;
                const unitsCreated = packagesOpened * rule.unitsPerPackage;
                packageRow.stockOnHand -= packagesOpened;
                unitRow.stockOnHand += unitsCreated;
                await this.connection.getRepository(ctx, StockLevel).save([packageRow, unitRow]);
                const stockAdjustments = await this.connection.getRepository(ctx, StockAdjustment).save([
                    new StockAdjustment({
                        quantity: -packagesOpened,
                        stockLocation: { id: packageRow.stockLocationId },
                        productVariant: { id: rule.packageVariantId },
                    }),
                    new StockAdjustment({
                        quantity: unitsCreated,
                        stockLocation: { id: packageRow.stockLocationId },
                        productVariant: { id: rule.unitVariantId },
                    }),
                ]);
                await this.connection.getRepository(ctx, PackagingUnpackEvent).save(
                    new PackagingUnpackEvent({
                        ruleId: rule.id,
                        channelId: ctx.channelId,
                        stockLocationId: packageRow.stockLocationId,
                        orderId: order.id,
                        reason: 'ORDER_AUTO',
                        packagesOpened,
                        unitsCreated,
                        packageStockBefore,
                        packageStockAfter: packageRow.stockOnHand,
                        unitStockBefore,
                        unitStockAfter: unitRow.stockOnHand,
                    }),
                );
                await this.eventBus.publish(new StockMovementEvent(ctx, stockAdjustments));
                remaining -= packagesOpened;
            }
            if (remaining !== 0) {
                throw new Error(
                    'Locked packaging stock rows did not contain the calculated package quantity.',
                );
            }
        }
        return undefined;
    }

    private activeChannelRows(ctx: RequestContext, rows: StockLevel[], productVariantId: ID): StockLevel[] {
        return rows.filter(
            row =>
                idsAreEqual(row.productVariantId, productVariantId) &&
                row.stockLocation?.channels?.some(channel => idsAreEqual(channel.id, ctx.channelId)),
        );
    }

    private async ownStockTotals(ctx: RequestContext, productVariantId: ID): Promise<StockTotals> {
        const rows = await this.connection
            .getRepository(ctx, StockLevel)
            .createQueryBuilder('stock')
            .leftJoin('stock.stockLocation', 'stockLocation')
            .leftJoin('stockLocation.channels', 'channel')
            .where('stock.productVariantId = :productVariantId', { productVariantId })
            .andWhere('channel.id = :channelId', { channelId: ctx.channelId })
            .getMany();
        return this.sumRows(rows);
    }

    private sumRows(rows: StockLevel[]): StockTotals {
        return rows.reduce(
            (total, row) => ({
                stockOnHand: total.stockOnHand + row.stockOnHand,
                stockAllocated: total.stockAllocated + row.stockAllocated,
            }),
            { stockOnHand: 0, stockAllocated: 0 },
        );
    }

    private outOfStockThreshold(variant: ProductVariant, globalThreshold: number): number {
        return variant.useGlobalOutOfStockThreshold ? globalThreshold : variant.outOfStockThreshold;
    }
}
