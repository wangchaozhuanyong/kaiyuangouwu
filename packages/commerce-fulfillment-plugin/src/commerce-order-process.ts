import { GlobalFlag } from '@vendure/common/lib/generated-types';
import {
    ConfigService,
    GlobalSettingsService,
    isGraphQlErrorResult,
    Order,
    OrderProcess,
    OrderService,
    ProductVariantService,
    StockLevel,
    StockMovementService,
    TransactionalConnection,
} from '@vendure/core';
import { LockNotSupportedOnGivenDriverError } from 'typeorm';

import { AutoCardService } from './auto-card.service';
import { digitalFulfillmentHandler } from './digital-fulfillment-handler';
import {
    getOrderLineFulfillmentType,
    hasCompleteShippingAddress,
    isAutoCardOrderLine,
    summarizeOrderFulfillment,
} from './fulfillment-classification';

let orderService: OrderService;
let productVariantService: ProductVariantService;
let stockMovementService: StockMovementService;
let connection: TransactionalConnection;
let configService: ConfigService;
let globalSettingsService: GlobalSettingsService;
let autoCardService: AutoCardService;

export const commerceOrderProcess: OrderProcess<string> = {
    init(injector) {
        orderService = injector.get(OrderService);
        productVariantService = injector.get(ProductVariantService);
        stockMovementService = injector.get(StockMovementService);
        connection = injector.get(TransactionalConnection);
        configService = injector.get(ConfigService);
        globalSettingsService = injector.get(GlobalSettingsService);
        autoCardService = injector.get(AutoCardService);
    },

    async onTransitionStart(fromState, toState, { ctx, order }) {
        const entersPayment = toState === 'ArrangingPayment';
        const confirmsPayment =
            fromState === 'ArrangingPayment' &&
            (toState === 'PaymentAuthorized' || toState === 'PaymentSettled');
        if (!entersPayment && !confirmsPayment) {
            return;
        }

        const summary = summarizeOrderFulfillment(order);
        if (entersPayment) {
            const autoCardError = await autoCardService.availabilityError(ctx, order);
            if (autoCardError) {
                return autoCardError;
            }
        }
        if (!summary.containsPhysicalProducts) {
            return;
        }

        if (entersPayment) {
            if (!hasCompleteShippingAddress(ctx, order.shippingAddress)) {
                return ctx.translate('message.commerce-physical-order-requires-complete-address');
            }
            if (!order.shippingLines?.length) {
                return ctx.translate('message.commerce-physical-order-requires-shipping-method');
            }
        }

        const physicalLines = order.lines.filter(line => getOrderLineFulfillmentType(line) === 'physical');
        let lockedStockLevels: StockLevel[] | undefined;
        if (confirmsPayment) {
            const variantIds = [...new Set(physicalLines.map(line => String(line.productVariant.id)))].sort();
            try {
                lockedStockLevels = await connection
                    .getRepository(ctx, StockLevel)
                    .createQueryBuilder('stock')
                    .setLock('pessimistic_write')
                    .where('stock.productVariantId IN (:...variantIds)', { variantIds })
                    .orderBy('stock.productVariantId', 'ASC')
                    .addOrderBy('stock.stockLocationId', 'ASC')
                    .getMany();
            } catch (error) {
                if (!(error instanceof LockNotSupportedOnGivenDriverError)) {
                    throw error;
                }
            }
        }

        for (const line of physicalLines) {
            // Under MySQL REPEATABLE READ, a normal query after waiting for a row lock can
            // still see the transaction's older snapshot. Calculate from the locking read
            // itself so concurrent payment confirmations cannot both consume the same stock.
            const availableStock = lockedStockLevels
                ? await saleableStockFromLockedRows(ctx, line.productVariant, lockedStockLevels)
                : await productVariantService.getSaleableStockLevel(ctx, line.productVariant);
            if (line.productVariant.trackInventory !== GlobalFlag.FALSE && line.quantity > availableStock) {
                return ctx.translate('message.commerce-physical-product-insufficient-stock', {
                    productVariantName: line.productVariant.name,
                });
            }
        }
    },

    async onTransitionEnd(fromState, toState, { ctx, order }) {
        if (
            fromState === 'ArrangingPayment' &&
            (toState === 'PaymentAuthorized' || toState === 'PaymentSettled')
        ) {
            const physicalLines = order.lines.filter(
                line => getOrderLineFulfillmentType(line) === 'physical',
            );
            if (physicalLines.length) {
                await stockMovementService.createAllocationsForOrderLines(
                    ctx,
                    physicalLines.map(line => ({ orderLineId: line.id, quantity: line.quantity })),
                );
            }
        }

        if (toState !== 'PaymentSettled') {
            return;
        }

        const settledOrder = await connection.getEntityOrThrow(ctx, Order, order.id, {
            relations: ['customer', 'lines', 'lines.productVariant'],
        });
        await autoCardService.allocateSettledOrder(ctx, settledOrder);

        const digitalLines = settledOrder.lines.filter(
            line => getOrderLineFulfillmentType(line) === 'digital' && !isAutoCardOrderLine(line),
        );
        if (digitalLines.length) {
            const fulfillment = await orderService.createFulfillment(ctx, {
                lines: digitalLines.map(line => ({ orderLineId: line.id, quantity: line.quantity })),
                handler: { code: digitalFulfillmentHandler.code, arguments: [] },
            });
            if (isGraphQlErrorResult(fulfillment)) {
                throw new Error(fulfillment.message);
            }
        }
    },
};

async function saleableStockFromLockedRows(
    ctx: Parameters<typeof productVariantService.getSaleableStockLevel>[0],
    variant: Parameters<typeof productVariantService.getSaleableStockLevel>[1],
    lockedStockLevels: StockLevel[],
): Promise<number> {
    const settings = await globalSettingsService.getSettings(ctx);
    const inventoryNotTracked =
        variant.trackInventory === GlobalFlag.FALSE ||
        (variant.trackInventory === GlobalFlag.INHERIT && settings.trackInventory === false);
    if (inventoryNotTracked) {
        return Number.MAX_SAFE_INTEGER;
    }
    const stockLevels = lockedStockLevels.filter(
        stockLevel => String(stockLevel.productVariantId) === String(variant.id),
    );
    const { stockOnHand, stockAllocated } =
        await configService.catalogOptions.stockLocationStrategy.getAvailableStock(
            ctx,
            variant.id,
            stockLevels,
        );
    const threshold = variant.useGlobalOutOfStockThreshold
        ? settings.outOfStockThreshold
        : variant.outOfStockThreshold;
    return stockOnHand - stockAllocated - threshold;
}
