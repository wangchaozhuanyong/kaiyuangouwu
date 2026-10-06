import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import { In } from 'typeorm';

import { RequestContext } from '../../api/common/request-context';
import { RequestContextCacheService } from '../../cache/request-context-cache.service';
import { UserInputError } from '../../common/error/errors';
import { Instrument } from '../../common/instrument-decorator';
import { AvailableStock } from '../../config/catalog/stock-location-strategy';
import { ConfigService } from '../../config/config.service';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';
import { StockLevel } from '../../entity/stock-level/stock-level.entity';

import { StockLocationService } from './stock-location.service';

/**
 * @description
 * The StockLevelService is responsible for managing the stock levels of ProductVariants.
 * Whenever you need to adjust the `stockOnHand` or `stockAllocated` for a ProductVariant,
 * you should use this service.
 *
 * @docsCategory services
 * @since 2.0.0
 */
@Injectable()
@Instrument()
export class StockLevelService {
    constructor(
        private connection: TransactionalConnection,
        private stockLocationService: StockLocationService,
        private configService: ConfigService,
        private requestCache: RequestContextCacheService = new RequestContextCacheService(),
    ) {}

    /**
     * @description
     * Returns the StockLevel for the given {@link ProductVariant} and {@link StockLocation}.
     */
    async getStockLevel(ctx: RequestContext, productVariantId: ID, stockLocationId: ID): Promise<StockLevel> {
        await this.assertStockLocations(ctx, productVariantId);
        const stockLevel = await this.connection.getRepository(ctx, StockLevel).findOne({
            where: {
                productVariantId,
                stockLocationId,
            },
        });
        if (stockLevel) {
            return stockLevel;
        }
        await this.assertStockLocations(ctx, productVariantId, 'create');
        return this.connection.getRepository(ctx, StockLevel).save(
            new StockLevel({
                productVariantId,
                stockLocationId,
                stockOnHand: 0,
                stockAllocated: 0,
            }),
        );
    }

    private async assertStockLocations(
        ctx: RequestContext,
        productVariantId: ID,
        operation: 'flow' | 'create' = 'flow',
    ): Promise<void> {
        const variant = await this.connection.getEntityOrThrow(ctx, ProductVariant, productVariantId);
        if (!(await this.stockLocationService.supportsStockLocations(ctx, variant, operation))) {
            throw new UserInputError('该商品不使用仓库库存，请在数字交付中管理可售份数');
        }
    }

    async getStockLevelsForVariant(ctx: RequestContext, productVariantId: ID): Promise<StockLevel[]> {
        return this.connection
            .getRepository(ctx, StockLevel)
            .createQueryBuilder('stockLevel')
            .leftJoinAndSelect('stockLevel.stockLocation', 'stockLocation')
            .leftJoin('stockLocation.channels', 'channel')
            .where('stockLevel.productVariantId = :productVariantId', { productVariantId })
            .andWhere('channel.id = :channelId', { channelId: ctx.channelId })
            .getMany();
    }

    /**
     * @description
     * Returns the available stock (on hand and allocated) for the given {@link ProductVariant}. This is determined
     * by the configured {@link StockLocationStrategy}.
     */
    async getAvailableStock(ctx: RequestContext, productVariantId: ID): Promise<AvailableStock> {
        const { stockLocationStrategy } = this.configService.catalogOptions;
        const stockLevels = await this.connection.getRepository(ctx, StockLevel).find({
            where: {
                productVariantId,
            },
        });
        return stockLocationStrategy.getAvailableStock(ctx, productVariantId, stockLevels);
    }

    async getAvailableStockForDisplay(ctx: RequestContext, productVariantId: ID): Promise<AvailableStock> {
        const { stockLocationStrategy } = this.configService.catalogOptions;
        const stockLevels = await this.requestCache.load(
            ctx,
            `display-stock-levels:${ctx.channelId}`,
            productVariantId,
            async ids => {
                const levels = await this.connection.getRepository(ctx, StockLevel).find({
                    where: { productVariantId: In([...ids]) },
                });
                const grouped = new Map<string, StockLevel[]>();
                for (const level of levels) {
                    const key = String(level.productVariantId);
                    const group = grouped.get(key) ?? [];
                    group.push(level);
                    grouped.set(key, group);
                }
                return ids.map(id => grouped.get(id) ?? []);
            },
        );
        return stockLocationStrategy.getAvailableStockForDisplay
            ? stockLocationStrategy.getAvailableStockForDisplay(ctx, productVariantId, stockLevels)
            : stockLocationStrategy.getAvailableStock(ctx, productVariantId, stockLevels);
    }

    /**
     * @description
     * Updates the `stockOnHand` for the given {@link ProductVariant} and {@link StockLocation}.
     */
    async updateStockOnHandForLocation(
        ctx: RequestContext,
        productVariantId: ID,
        stockLocationId: ID,
        change: number,
    ) {
        await this.assertStockLocations(ctx, productVariantId);
        const repository = this.connection.getRepository(ctx, StockLevel);
        const result = await repository.increment(
            { productVariantId, stockLocationId },
            'stockOnHand',
            change,
        );
        if (!result.affected) {
            await this.assertStockLocations(ctx, productVariantId, 'create');
            await repository.save(
                new StockLevel({
                    productVariantId,
                    stockLocationId,
                    stockOnHand: change,
                    stockAllocated: 0,
                }),
            );
        }
    }

    /**
     * @description
     * Updates the `stockAllocated` for the given {@link ProductVariant} and {@link StockLocation}.
     */
    async updateStockAllocatedForLocation(
        ctx: RequestContext,
        productVariantId: ID,
        stockLocationId: ID,
        change: number,
    ) {
        await this.assertStockLocations(ctx, productVariantId);
        await this.connection
            .getRepository(ctx, StockLevel)
            .increment({ productVariantId, stockLocationId }, 'stockAllocated', change);
    }
}
