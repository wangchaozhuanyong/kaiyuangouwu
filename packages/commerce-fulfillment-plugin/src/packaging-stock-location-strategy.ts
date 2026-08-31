import { GlobalFlag } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import {
    AvailableStock,
    LocationWithQuantity,
    MultiChannelStockLocationStrategy,
    OrderLine,
    ProductVariant,
    RequestContext,
    StockLevel,
    StockLocation,
    idsAreEqual,
} from '@vendure/core';

import { ProductPackagingRule } from './entities/product-packaging-rule.entity';

/**
 * Keeps Vendure's normal multi-channel stock routing while allowing a loose-unit
 * variant to advertise stock that can be produced from unopened packages.
 * The physical stock transfer itself happens only during payment confirmation.
 */
export class PackagingStockLocationStrategy extends MultiChannelStockLocationStrategy {
    async getAvailableStock(
        ctx: RequestContext,
        productVariantId: ID,
        stockLevels: StockLevel[],
    ): Promise<AvailableStock> {
        const unitStock = await super.getAvailableStock(ctx, productVariantId, stockLevels);
        const rule = await this.connection.getRepository(ctx, ProductPackagingRule).findOne({
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

        const packageLevels = await this.connection.getRepository(ctx, StockLevel).find({
            where: { productVariantId: rule.packageVariantId },
        });
        const packageStock = await super.getAvailableStock(ctx, rule.packageVariantId, packageLevels);
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

    async forAllocation(
        ctx: RequestContext,
        stockLocations: StockLocation[],
        orderLine: OrderLine,
        quantity: number,
    ): Promise<LocationWithQuantity[]> {
        const packagingRule = await this.connection.getRepository(ctx, ProductPackagingRule).findOne({
            where: [
                {
                    channelId: ctx.channelId,
                    unitVariantId: orderLine.productVariantId,
                    enabled: true,
                    autoUnpack: true,
                },
                {
                    channelId: ctx.channelId,
                    packageVariantId: orderLine.productVariantId,
                    enabled: true,
                    autoUnpack: true,
                },
            ],
        });
        if (!packagingRule) {
            return super.forAllocation(ctx, stockLocations, orderLine, quantity);
        }

        const [variant, settings, stockLevels] = await Promise.all([
            this.connection.getEntityOrThrow(ctx, ProductVariant, orderLine.productVariantId, {
                loadEagerRelations: false,
            }),
            this.globalSettingsService.getSettings(ctx),
            this.connection.getRepository(ctx, StockLevel).find({
                where: { productVariantId: orderLine.productVariantId },
                loadEagerRelations: false,
            }),
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
            const physicalAvailable = Math.max(stockLevel.stockOnHand - stockLevel.stockAllocated, 0);
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
        return locations;
    }
}
