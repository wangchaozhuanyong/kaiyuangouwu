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
import { CommerceModeService } from './commerce-mode.service';
import { digitalFulfillmentHandler } from './digital-fulfillment-handler';
import {
    getOrderLineFulfillmentType,
    hasCompleteShippingAddress,
    isFileDownloadOrderLine,
    summarizeOrderFulfillment,
} from './fulfillment-classification';
import { ManualDigitalDeliveryService } from './manual-digital-delivery.service';
import { ProductPackagingService } from './product-packaging.service';

let orderService: OrderService;
let productVariantService: ProductVariantService;
let stockMovementService: StockMovementService;
let connection: TransactionalConnection;
let configService: ConfigService;
let globalSettingsService: GlobalSettingsService;
let autoCardService: AutoCardService;
let productPackagingService: ProductPackagingService;
let commerceModeService: CommerceModeService;
let manualDigitalDeliveryService: ManualDigitalDeliveryService;

export const commerceOrderProcess: OrderProcess<string> = {
    init(injector) {
        orderService = injector.get(OrderService);
        productVariantService = injector.get(ProductVariantService);
        stockMovementService = injector.get(StockMovementService);
        connection = injector.get(TransactionalConnection);
        configService = injector.get(ConfigService);
        globalSettingsService = injector.get(GlobalSettingsService);
        autoCardService = injector.get(AutoCardService);
        productPackagingService = injector.get(ProductPackagingService);
        commerceModeService = injector.get(CommerceModeService);
        manualDigitalDeliveryService = injector.get(ManualDigitalDeliveryService);
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
        const commerceMode = await commerceModeService.activeMode(ctx);
        for (const line of order.lines) {
            commerceModeService.assertProductTypeAllowed(commerceMode, getOrderLineFulfillmentType(line));
        }
        if (entersPayment) {
            const autoCardError = await autoCardService.availabilityError(ctx, order);
            if (autoCardError) {
                return autoCardError;
            }
            if (summary.containsDigitalProducts && !isValidDeliveryEmail(order.customFields?.deliveryEmail)) {
                return '虚拟商品订单必须填写有效的交付邮箱';
            }
        }

        if (entersPayment && summary.containsPhysicalProducts) {
            if (!hasCompleteShippingAddress(ctx, order.shippingAddress)) {
                return ctx.translate('message.commerce-physical-order-requires-complete-address');
            }
            if (!order.shippingLines?.length) {
                return ctx.translate('message.commerce-physical-order-requires-shipping-method');
            }
        }

        const physicalLines = order.lines.filter(line => getOrderLineFulfillmentType(line) === 'physical');
        const stockManagedLines = order.lines.filter(line => requiresStockAllocation(line));
        let lockedStockLevels: StockLevel[] | undefined;
        const packagingRules =
            confirmsPayment && physicalLines.length
                ? await productPackagingService.rulesForVariantIds(
                      ctx,
                      physicalLines.map(line => line.productVariantId),
                  )
                : [];
        if (confirmsPayment && stockManagedLines.length) {
            await productPackagingService.ensureStockLevelPairs(ctx, packagingRules);
            const variantIds = productPackagingService.variantIdsForLock(
                stockManagedLines.map(line => line.productVariantId),
                packagingRules,
            );
            const stockQuery = () =>
                connection
                    .getRepository(ctx, StockLevel)
                    .createQueryBuilder('stock')
                    .leftJoinAndSelect('stock.stockLocation', 'stockLocation')
                    .leftJoinAndSelect('stockLocation.channels', 'channel')
                    .where('stock.productVariantId IN (:...variantIds)', { variantIds })
                    .orderBy('stock.productVariantId', 'ASC')
                    .addOrderBy('stock.stockLocationId', 'ASC');
            try {
                lockedStockLevels = await stockQuery().setLock('pessimistic_write').getMany();
            } catch (error) {
                if (!(error instanceof LockNotSupportedOnGivenDriverError)) {
                    throw error;
                }
                lockedStockLevels = await stockQuery().getMany();
            }
            const unpackError = await productPackagingService.autoUnpackForOrder(
                ctx,
                order,
                physicalLines,
                packagingRules,
                lockedStockLevels,
            );
            if (unpackError) {
                return unpackError;
            }
        }

        for (const line of stockManagedLines) {
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
        if (toState === 'Cancelled') {
            await manualDigitalDeliveryService.cancelOrder(ctx, order.id);
        }
        if (
            fromState === 'ArrangingPayment' &&
            (toState === 'PaymentAuthorized' || toState === 'PaymentSettled')
        ) {
            const stockManagedLines = order.lines.filter(line => requiresStockAllocation(line));
            if (stockManagedLines.length) {
                await stockMovementService.createAllocationsForOrderLines(
                    ctx,
                    stockManagedLines.map(line => ({ orderLineId: line.id, quantity: line.quantity })),
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
        await manualDigitalDeliveryService.createSettledOrderTasks(ctx, settledOrder);

        const fileDownloadLines = settledOrder.lines.filter(line => isFileDownloadOrderLine(line));
        if (fileDownloadLines.length) {
            const fulfillment = await orderService.createFulfillment(ctx, {
                lines: fileDownloadLines.map(line => ({
                    orderLineId: line.id,
                    quantity: line.quantity,
                })),
                handler: { code: digitalFulfillmentHandler.code, arguments: [] },
            });
            if (isGraphQlErrorResult(fulfillment)) {
                throw new Error(fulfillment.message);
            }
        }
    },
};

function requiresStockAllocation(line: Order['lines'][number]): boolean {
    if (getOrderLineFulfillmentType(line) === 'physical') {
        return true;
    }
    if (line.customFields?.digitalDeliveryModeSnapshot === 'auto_card') {
        return false;
    }
    return line.productVariant.customFields?.digitalStockPolicy === 'limited';
}

function isValidDeliveryEmail(value: string | null | undefined): boolean {
    const email = value?.trim() ?? '';
    return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email);
}

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
