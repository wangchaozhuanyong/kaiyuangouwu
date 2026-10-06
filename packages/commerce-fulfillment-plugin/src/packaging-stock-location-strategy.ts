import { InventoryLot, planFefoAllocation } from '@vendure/catalog-management-plugin';
import { GlobalFlag } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import {
    AvailableStock,
    idsAreEqual,
    LocationWithQuantity,
    MultiChannelStockLocationStrategy,
    OrderLine,
    Product,
    ProductVariant,
    RequestContext,
    StockLevel,
    StockLocation,
    UserInputError,
} from '@vendure/core';
import { In } from 'typeorm';

import { DigitalVariantConfig } from './entities/digital-product.entity';
import { PhysicalReturnReceipt } from './entities/physical-return-receipt.entity';
import { ProductPackagingRule } from './entities/product-packaging-rule.entity';
import { getOrderLineFulfillmentType } from './fulfillment-classification';

/**
 * Keeps Vendure's normal multi-channel stock routing while allowing a loose-unit
 * variant to advertise stock that can be produced from unopened packages.
 * The physical stock transfer itself happens only during payment confirmation.
 */
export class PackagingStockLocationStrategy extends MultiChannelStockLocationStrategy {
    async supportsStockLocationsForDisplay(ctx: RequestContext, variant: ProductVariant): Promise<boolean> {
        if (variant.product?.customFields.fulfillmentType === 'physical') return true;
        return this.requestContextCache.load(
            ctx,
            `display-warehouse-capability:${ctx.channelId}`,
            variant.id,
            async ids => {
                const variants = await this.connection.getRepository(ctx, ProductVariant).find({
                    where: { id: In([...ids]) },
                    relations: ['product'],
                    loadEagerRelations: false,
                });
                const digitalIds = variants
                    .filter(item => item.product.customFields.fulfillmentType === 'digital')
                    .map(item => item.id);
                const [migrated, stocks] = digitalIds.length
                    ? await Promise.all([
                          this.connection.getRepository(ctx, DigitalVariantConfig).find({
                              where: {
                                  channelId: ctx.channelId,
                                  productVariantId: In(digitalIds),
                                  migrationState: 'ACTIVE',
                              },
                          }),
                          this.connection
                              .getRepository(ctx, StockLevel)
                              .find({ where: { productVariantId: In(digitalIds) } }),
                      ])
                    : [[], []];
                const migratedIds = new Set(migrated.map(item => String(item.productVariantId)));
                const legacyStocks = new Set(
                    stocks
                        .filter(item => item.stockOnHand !== 0 || item.stockAllocated !== 0)
                        .map(item => String(item.productVariantId)),
                );
                const byId = new Map(variants.map(item => [String(item.id), item]));
                return ids.map(id => {
                    const item = byId.get(id);
                    if (!item) throw new UserInputError('商品规格不存在');
                    return (
                        item.product.customFields.fulfillmentType !== 'digital' ||
                        (!migratedIds.has(id) && legacyStocks.has(id))
                    );
                });
            },
        );
    }

    async supportsStockLocations(
        ctx: RequestContext,
        variant: ProductVariant,
        operation: 'flow' | 'create' | 'adjust' = 'flow',
    ): Promise<boolean> {
        const product = await this.connection.getEntityOrThrow(ctx, Product, variant.productId);
        if (product.customFields.fulfillmentType !== 'digital') return true;
        if (operation !== 'flow') return false;
        const migrated = await this.connection.getRepository(ctx, DigitalVariantConfig).exists({
            where: { channelId: ctx.channelId, productVariantId: variant.id, migrationState: 'ACTIVE' },
        });
        if (migrated) return false;
        // Existing stores retain their recorded quantities until an explicit, audited cutover.
        const oldStocks = await this.connection
            .getRepository(ctx, StockLevel)
            .find({ where: { productVariantId: variant.id } });
        return oldStocks.some(stock => stock.stockOnHand !== 0 || stock.stockAllocated !== 0);
    }

    private async digitalWithoutWarehouse(ctx: RequestContext, line: OrderLine): Promise<boolean> {
        if (getOrderLineFulfillmentType(line) !== 'digital') return false;
        const variant = await this.connection.getEntityOrThrow(ctx, ProductVariant, line.productVariantId);
        return !(await this.supportsStockLocations(ctx, variant));
    }

    async forSale(ctx: RequestContext, locations: StockLocation[], line: OrderLine, quantity: number) {
        return (await this.digitalWithoutWarehouse(ctx, line))
            ? []
            : super.forSale(ctx, locations, line, quantity);
    }
    async forRelease(ctx: RequestContext, locations: StockLocation[], line: OrderLine, quantity: number) {
        return (await this.digitalWithoutWarehouse(ctx, line))
            ? []
            : super.forRelease(ctx, locations, line, quantity);
    }
    async forCancellation(
        ctx: RequestContext,
        locations: StockLocation[],
        line: OrderLine,
        quantity: number,
    ) {
        if (await this.digitalWithoutWarehouse(ctx, line)) return [];
        if (getOrderLineFulfillmentType(line) === 'physical') {
            const receipt = await this.connection.getRepository(ctx, PhysicalReturnReceipt).findOne({
                where: {
                    channelId: ctx.channelId,
                    orderLineId: line.id,
                    quantity,
                    quality: 'GOOD',
                    state: 'RECORDED',
                },
            });
            if (!receipt)
                throw new UserInputError('已发货实物必须先在售后工单完成退货验收，退款不会自动回库');
            const location = locations.find(item => String(item.id) === String(receipt.stockLocationId));
            if (!location) throw new UserInputError('验收仓库不属于当前店铺');
            return [{ location, quantity }];
        }
        return super.forCancellation(ctx, locations, line, quantity);
    }
    async getAvailableStock(
        ctx: RequestContext,
        productVariantId: ID,
        stockLevels: StockLevel[],
    ): Promise<AvailableStock> {
        return this.availableStock(ctx, productVariantId, stockLevels, false);
    }

    async getAvailableStockForDisplay(
        ctx: RequestContext,
        productVariantId: ID,
        stockLevels: StockLevel[],
    ): Promise<AvailableStock> {
        return this.availableStock(ctx, productVariantId, stockLevels, true);
    }

    private async availableStock(
        ctx: RequestContext,
        productVariantId: ID,
        stockLevels: StockLevel[],
        forDisplay: boolean,
    ): Promise<AvailableStock> {
        const available = forDisplay
            ? super.getChannelStockForDisplay.bind(this)
            : super.getAvailableStock.bind(this);
        const unitStock = await available(
            ctx,
            productVariantId,
            await this.effectiveStockLevels(ctx, productVariantId, stockLevels, forDisplay),
        );
        const rule = forDisplay
            ? await this.requestContextCache.load(
                  ctx,
                  `display-packaging-rule:${ctx.channelId}`,
                  productVariantId,
                  async ids => {
                      const rules = await this.connection.getRepository(ctx, ProductPackagingRule).find({
                          where: {
                              channelId: ctx.channelId,
                              unitVariantId: In([...ids]),
                              enabled: true,
                              autoUnpack: true,
                          },
                          relations: ['packageVariant'],
                      });
                      const byVariant = new Map(rules.map(item => [String(item.unitVariantId), item]));
                      return ids.map(id => byVariant.get(id) ?? null);
                  },
              )
            : await this.connection.getRepository(ctx, ProductPackagingRule).findOne({
                  where: {
                      channelId: ctx.channelId,
                      unitVariantId: productVariantId,
                      enabled: true,
                      autoUnpack: true,
                  },
                  relations: ['packageVariant'],
              });
        if (!rule) {
            return unitStock;
        }

        const packageLevels = forDisplay
            ? await this.requestContextCache.load(
                  ctx,
                  `display-stock-levels:${ctx.channelId}`,
                  rule.packageVariantId,
                  async ids => {
                      const levels = await this.connection
                          .getRepository(ctx, StockLevel)
                          .find({ where: { productVariantId: In([...ids]) } });
                      return ids.map(id => levels.filter(item => String(item.productVariantId) === id));
                  },
              )
            : await this.connection.getRepository(ctx, StockLevel).find({
                  where: { productVariantId: rule.packageVariantId },
              });
        const packageStock = await available(
            ctx,
            rule.packageVariantId,
            await this.effectiveStockLevels(ctx, rule.packageVariantId, packageLevels, forDisplay),
        );
        const settings = await this.globalSettingsService.getSettings(ctx);
        const packageThreshold = Math.max(
            rule.packageVariant.useGlobalOutOfStockThreshold
                ? settings.outOfStockThreshold
                : rule.packageVariant.outOfStockThreshold,
            0,
        );
        return {
            stockOnHand: unitStock.stockOnHand + packageStock.stockOnHand * rule.unitsPerPackage,
            stockAllocated:
                unitStock.stockAllocated +
                (packageStock.stockAllocated + packageThreshold) * rule.unitsPerPackage,
        };
    }

    private async effectiveStockLevels(
        ctx: RequestContext,
        variantId: ID,
        levels: StockLevel[],
        forDisplay = false,
    ): Promise<StockLevel[]> {
        const repository = this.connection.getRepository(ctx, InventoryLot);
        const lots = forDisplay
            ? await this.requestContextCache.load(
                  ctx,
                  `display-inventory-lots:${ctx.channelId}`,
                  variantId,
                  async ids => {
                      const rows = await repository.find({ where: { variantId: In([...ids]) } });
                      return ids.map(id => rows.filter(item => String(item.variantId) === id));
                  },
              )
            : repository.manager?.queryRunner?.isTransactionActive &&
                !['sqljs', 'sqlite', 'better-sqlite3'].includes(repository.manager.connection.options.type)
              ? await repository
                    .createQueryBuilder('lot')
                    .where('lot.variantId = :variantId', { variantId })
                    .orderBy('lot.id', 'ASC')
                    .setLock('pessimistic_write')
                    .getMany()
              : await repository.find({ where: { variantId } });
        const now = Date.now();
        return levels.map(level => {
            const local = lots.filter(lot => String(lot.stockLocationId) === String(level.stockLocationId));
            if (!local.length) return level;
            const effective = planFefoAllocation(local, Number.MAX_SAFE_INTEGER, new Date(now)).reduce(
                (sum, item) => sum + item.quantity,
                0,
            );
            return Object.assign(new StockLevel({}), level, {
                stockOnHand: Math.min(level.stockOnHand, effective),
            });
        });
    }

    async forAllocation(
        ctx: RequestContext,
        stockLocations: StockLocation[],
        orderLine: OrderLine,
        quantity: number,
    ): Promise<LocationWithQuantity[]> {
        if (await this.digitalWithoutWarehouse(ctx, orderLine)) return [];
        const repository = this.connection.getRepository(ctx, StockLevel);
        const stockLevels =
            repository.manager?.queryRunner?.isTransactionActive &&
            !['sqljs', 'sqlite', 'better-sqlite3'].includes(repository.manager.connection.options.type)
                ? await repository
                      .createQueryBuilder('stock')
                      .where('stock.productVariantId = :id', { id: orderLine.productVariantId })
                      .orderBy('stock.stockLocationId', 'ASC')
                      .setLock('pessimistic_write')
                      .getMany()
                : await repository.find({
                      where: { productVariantId: orderLine.productVariantId },
                      loadEagerRelations: false,
                  });
        const [variant, settings] = await Promise.all([
            this.connection.getEntityOrThrow(ctx, ProductVariant, orderLine.productVariantId, {
                loadEagerRelations: false,
            }),
            this.globalSettingsService.getSettings(ctx),
        ]);
        const inventoryNotTracked =
            variant.trackInventory === GlobalFlag.FALSE ||
            (variant.trackInventory === GlobalFlag.INHERIT && settings.trackInventory === false);
        if (inventoryNotTracked) {
            return super.forAllocation(ctx, stockLocations, orderLine, quantity);
        }

        const threshold = variant.useGlobalOutOfStockThreshold
            ? settings.outOfStockThreshold
            : variant.outOfStockThreshold;
        let stockToReserve = Math.max(threshold, 0);
        let oversellAllowance = Math.max(-threshold, 0);
        let quantityRemaining = quantity;
        const locations: LocationWithQuantity[] = [];

        for (const location of stockLocations) {
            const stockLevel = stockLevels.find(row => idsAreEqual(row.stockLocationId, location.id));
            if (!stockLevel) {
                continue;
            }
            const effectiveLevels = await this.effectiveStockLevels(ctx, orderLine.productVariantId, [
                stockLevel,
            ]);
            const physicalAvailable = Math.max(effectiveLevels[0].stockOnHand - stockLevel.stockAllocated, 0);
            const reservedHere = Math.min(stockToReserve, physicalAvailable);
            stockToReserve -= reservedHere;
            let available = physicalAvailable - reservedHere;
            if (oversellAllowance > 0) {
                available += oversellAllowance;
                oversellAllowance = 0;
            }
            const quantityToAllocate = Math.min(quantityRemaining, available);
            if (quantityToAllocate > 0) {
                locations.push({ location, quantity: quantityToAllocate });
                quantityRemaining -= quantityToAllocate;
            }
            if (quantityRemaining === 0) {
                break;
            }
        }
        if (quantityRemaining > 0) throw new UserInputError('实物可售库存不足，请补货后重新交付');
        return locations;
    }
}
