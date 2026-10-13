import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { UserInputError } from '../../common/error/errors';
import { Injector } from '../../common/injector';
import { idsAreEqual } from '../../common/utils';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { OrderLine } from '../../entity/order-line/order-line.entity';
import { StockLevel } from '../../entity/stock-level/stock-level.entity';
import { StockLocation } from '../../entity/stock-location/stock-location.entity';
import { Allocation } from '../../entity/stock-movement/allocation.entity';
import { Cancellation } from '../../entity/stock-movement/cancellation.entity';
import { Release } from '../../entity/stock-movement/release.entity';
import { Sale } from '../../entity/stock-movement/sale.entity';

import { AvailableStock, LocationWithQuantity, StockLocationStrategy } from './stock-location-strategy';

export abstract class BaseStockLocationStrategy implements StockLocationStrategy {
    protected connection: TransactionalConnection;

    init(injector: Injector): void | Promise<void> {
        this.connection = injector.get(TransactionalConnection);
    }

    abstract getAvailableStock(
        ctx: RequestContext,
        productVariantId: ID,
        stockLevels: StockLevel[],
    ): AvailableStock | Promise<AvailableStock>;

    abstract forAllocation(
        ctx: RequestContext,
        stockLocations: StockLocation[],
        orderLine: OrderLine,
        quantity: number,
    ): LocationWithQuantity[] | Promise<LocationWithQuantity[]>;

    async forCancellation(
        ctx: RequestContext,
        stockLocations: StockLocation[],
        orderLine: OrderLine,
        quantity: number,
    ): Promise<LocationWithQuantity[]> {
        return this.getLocationsBasedOnAllocations(ctx, stockLocations, orderLine, quantity, 'cancellation');
    }

    async forRelease(
        ctx: RequestContext,
        stockLocations: StockLocation[],
        orderLine: OrderLine,
        quantity: number,
    ): Promise<LocationWithQuantity[]> {
        return this.getLocationsBasedOnAllocations(ctx, stockLocations, orderLine, quantity, 'allocation');
    }

    async forSale(
        ctx: RequestContext,
        stockLocations: StockLocation[],
        orderLine: OrderLine,
        quantity: number,
    ): Promise<LocationWithQuantity[]> {
        return this.getLocationsBasedOnAllocations(ctx, stockLocations, orderLine, quantity, 'allocation');
    }

    private async getLocationsBasedOnAllocations(
        ctx: RequestContext,
        stockLocations: StockLocation[],
        orderLine: OrderLine,
        quantity: number,
        source: 'allocation' | 'cancellation',
    ) {
        const options = {
            where: { orderLine: { id: orderLine.id } },
            order: { createdAt: 'ASC' as const, id: 'ASC' as const },
        };
        const [sales, originals, consumed] = await Promise.all([
            this.connection.getRepository(ctx, Sale).find(options),
            source === 'allocation'
                ? this.connection.getRepository(ctx, Allocation).find(options)
                : Promise.resolve([]),
            source === 'allocation'
                ? this.connection.getRepository(ctx, Release).find(options)
                : this.connection.getRepository(ctx, Cancellation).find(options),
        ]);
        const balances = new Map<string, number>();
        for (const movement of source === 'allocation' ? originals : sales) {
            const key = String(movement.stockLocationId);
            balances.set(key, (balances.get(key) ?? 0) + Math.abs(movement.quantity));
        }
        for (const movement of source === 'allocation' ? [...sales, ...consumed] : consumed) {
            const key = String(movement.stockLocationId);
            balances.set(key, (balances.get(key) ?? 0) - Math.abs(movement.quantity));
        }
        let remaining = quantity;
        const result: LocationWithQuantity[] = [];
        for (const [locationId, balance] of balances) {
            if (remaining <= 0) break;
            const location = stockLocations.find(item => idsAreEqual(item.id, locationId));
            if (!location || balance <= 0) continue;
            const allocated = Math.min(remaining, balance);
            result.push({ location, quantity: allocated });
            remaining -= allocated;
        }
        if (remaining > 0) {
            throw new UserInputError('Stock movement quantity exceeds the remaining warehouse allocation');
        }
        return result;
    }
}

/**
 * @description
 * The DefaultStockLocationStrategy was the default implementation of the {@link StockLocationStrategy}
 * prior to the introduction of the {@link MultiChannelStockLocationStrategy}.
 * It assumes only a single StockLocation and that all stock is allocated from that location. When
 * more than one StockLocation or Channel is used, it will not behave as expected.
 *
 * @docsCategory products & stock
 * @since 2.0.0
 */
export class DefaultStockLocationStrategy extends BaseStockLocationStrategy {
    init(injector: Injector) {
        return super.init(injector);
    }

    getAvailableStock(ctx: RequestContext, productVariantId: ID, stockLevels: StockLevel[]): AvailableStock {
        let stockOnHand = 0;
        let stockAllocated = 0;
        for (const stockLevel of stockLevels) {
            stockOnHand += stockLevel.stockOnHand;
            stockAllocated += stockLevel.stockAllocated;
        }
        return { stockOnHand, stockAllocated };
    }

    forAllocation(
        ctx: RequestContext,
        stockLocations: StockLocation[],
        orderLine: OrderLine,
        quantity: number,
    ): LocationWithQuantity[] | Promise<LocationWithQuantity[]> {
        return [{ location: stockLocations[0], quantity }];
    }
}
