import { GlobalFlag } from '@vendure/common/lib/generated-types';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import {
    CatalogResourceOwnership,
    ConfigService,
    FulfillmentLine,
    GlobalSettingsService,
    isGraphQlErrorResult,
    Order,
    OrderLine,
    OrderProcess,
    OrderService,
    ProductSalesAuthorization,
    ProductVariant,
    ProductVariantPrice,
    ProductVariantService,
    RequestContext,
    StockLevel,
    StockMovementService,
    TransactionalConnection,
} from '@vendure/core';
import { In, LockNotSupportedOnGivenDriverError } from 'typeorm';

import { AutoCardService } from './auto-card.service';
import { CheckoutResourcesService } from './checkout-resources.service';
import { CommerceModeService } from './commerce-mode.service';
import { DigitalDeliveryTokenService } from './digital-delivery-token.service';
import { DigitalFileService } from './digital-file.service';
import { digitalFulfillmentHandler } from './digital-fulfillment-handler';
import { digitalDeliverableQuantity } from './digital-order-entitlement';
import { DigitalProductService } from './digital-product.service';
import {
    getOrderLineFulfillmentType,
    hasCompleteShippingAddress,
    isFileDownloadOrderLine,
    summarizeOrderFulfillment,
} from './fulfillment-classification';
import { ManualDigitalDeliveryService } from './manual-digital-delivery.service';
import { ProductPackagingService } from './product-packaging.service';

let digitalTokens: DigitalDeliveryTokenService;
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
let digitalProducts: DigitalProductService;
let checkoutResources: CheckoutResourcesService;
let digitalFiles: DigitalFileService;

export const commerceOrderProcess: OrderProcess<string> = {
    transitions: { Delivered: { to: ['Modifying'], mergeStrategy: 'merge' } },
    init(injector) {
        digitalTokens = injector.get(DigitalDeliveryTokenService);
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
        digitalProducts = injector.get(DigitalProductService);
        checkoutResources = injector.get(CheckoutResourcesService);
        digitalFiles = injector.get(DigitalFileService);
    },

    async onTransitionStart(fromState, toState, { ctx, order }) {
        if (toState === 'Cancelled') {
            try {
                await checkoutResources.assertCancellationAllowed(ctx, order.id);
            } catch (error) {
                return error instanceof Error ? error.message : '付款结果尚待核验';
            }
        }
        const entersPayment = toState === 'ArrangingPayment';
        if (entersPayment && ctx.channel?.code === DEFAULT_CHANNEL_CODE) {
            return '平台管理中心不经营，请到经营店铺购买';
        }
        const confirmsPayment =
            fromState === 'ArrangingPayment' &&
            (toState === 'PaymentAuthorized' || toState === 'PaymentSettled');
        if (!entersPayment && !confirmsPayment) {
            return;
        }

        if (order.lines.length) {
            const variants = await connection.getRepository(ctx, ProductVariant).find({
                where: { id: In(order.lines.map(line => line.productVariantId)) },
                relations: ['product'],
            });
            if (variants.some(variant => variant.product?.customFields?.pricingMode === 'QUOTE_ONLY')) {
                return '询价展示商品不能下单，请联系客服获取报价';
            }
        }

        if (entersPayment) {
            for (const line of order.lines) {
                const variant = await connection.getRepository(ctx, ProductVariant).findOne({
                    where: { id: line.productVariantId, channels: { id: ctx.channelId } },
                    relations: ['product', 'product.channels'],
                });
                if (!variant || variant.deletedAt || !variant.enabled || !variant.product.enabled)
                    return '商品已不可销售，请刷新购物车';
                const owner = await connection
                    .getRepository(ctx, CatalogResourceOwnership)
                    .findOne({ where: { resourceType: 'Product', resourceId: variant.productId } });
                const grant = await connection
                    .getRepository(ctx, ProductSalesAuthorization)
                    .findOne({ where: { productId: variant.productId, channelId: ctx.channelId } });
                const operating = variant.product.channels.filter(c => c.code !== DEFAULT_CHANNEL_CODE);
                const legacyOwned =
                    !owner && operating.length === 1 && String(operating[0].id) === String(ctx.channelId);
                if (
                    (!owner && !legacyOwned) ||
                    (grant
                        ? grant.state !== 'ACTIVE' ||
                          !grant.variantIds.includes(String(variant.id)) ||
                          grant.pendingVariantIds?.includes(String(variant.id))
                        : !legacyOwned && String(owner?.ownerChannelId) !== String(ctx.channelId))
                )
                    return '本店销售授权未启用，请刷新购物车';
                const price = await connection.getRepository(ctx, ProductVariantPrice).findOne({
                    where: {
                        variant: { id: variant.id },
                        channelId: ctx.channelId,
                        currencyCode: ctx.currencyCode,
                    },
                });
                if (!price) return '本店售价未配置，请刷新购物车';
                if (isFileDownloadOrderLine(line)) {
                    const reservation = await digitalProducts.reservation(ctx, line.id);
                    const config = await digitalProducts.config(ctx, variant.id);
                    const versionId = reservation?.fileVersionId ?? config?.fileVersionId;
                    const resource = versionId
                        ? await digitalFiles.resource(ctx.channelId, versionId)
                        : digitalTokens.resourceForSku(String(ctx.channelId), variant.sku);
                    if (!resource) return '本店下载文件未配置，请联系店铺';
                }
            }
        }

        if (confirmsPayment && (await checkoutResources.hold(ctx, order.id))?.state === 'RELEASED') {
            await checkoutResources.markReview(
                ctx,
                order,
                '付款已记录，但占用已过期释放；请补货后重试交付或退款',
            );
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
            if (!hasCompleteShippingAddress(order.shippingAddress)) {
                return ctx.translate('message.commerce-physical-order-requires-complete-address');
            }
            if (!order.shippingLines?.length) {
                return ctx.translate('message.commerce-physical-order-requires-shipping-method');
            }
        }

        const physicalLines = order.lines.filter(line => getOrderLineFulfillmentType(line) === 'physical');
        const stockManagedLines = await stockLines(ctx, order.lines);
        let lockedStockLevels: StockLevel[] | undefined;
        const packagingRules =
            (entersPayment || confirmsPayment) && physicalLines.length
                ? await productPackagingService.rulesForVariantIds(
                      ctx,
                      physicalLines.map(line => line.productVariantId),
                  )
                : [];
        if ((entersPayment || confirmsPayment) && stockManagedLines.length) {
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
                const driver = connection.getRepository(ctx, StockLevel).manager.connection.options.type;
                lockedStockLevels = await (
                    ['sqljs', 'sqlite', 'better-sqlite3'].includes(driver)
                        ? stockQuery()
                        : stockQuery().setLock('pessimistic_write')
                ).getMany();
            } catch (error) {
                if (!(error instanceof LockNotSupportedOnGivenDriverError)) {
                    throw error;
                }
                lockedStockLevels = await stockQuery().getMany();
            }
            const unpackError = entersPayment
                ? await productPackagingService.autoUnpackForOrder(
                      ctx,
                      order,
                      physicalLines,
                      packagingRules,
                      lockedStockLevels,
                  )
                : undefined;
            if (unpackError) {
                if (confirmsPayment) {
                    await checkoutResources.markReview(ctx, order, unpackError);
                    return;
                }
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
            const ownAllocation = await checkoutResources.outstandingAllocation(ctx, line.id);
            if (
                line.productVariant.trackInventory !== GlobalFlag.FALSE &&
                line.quantity > availableStock + ownAllocation
            ) {
                const message = ctx.translate('message.commerce-physical-product-insufficient-stock', {
                    productVariantName: line.productVariant.name,
                });
                if (confirmsPayment) {
                    await checkoutResources.markReview(ctx, order, message);
                    return;
                }
                return message;
            }
        }
    },

    async onTransitionEnd(fromState, toState, { ctx, order }) {
        if (toState === 'Cancelled') {
            await manualDigitalDeliveryService.cancelOrder(ctx, order.id);
            await checkoutResources.release(ctx, order);
        }
        if (toState === 'ArrangingPayment')
            await checkoutResources.reserve(ctx, order, await stockLines(ctx, order.lines));
        if (
            fromState === 'ArrangingPayment' &&
            (toState === 'PaymentAuthorized' || toState === 'PaymentSettled')
        ) {
            await checkoutResources.confirm(ctx, order);
            const stockManagedLines = await stockLines(ctx, order.lines);
            if (stockManagedLines.length && !(await checkoutResources.hold(ctx, order.id))) {
                await stockMovementService.createAllocationsForOrderLines(
                    ctx,
                    stockManagedLines.map(line => ({ orderLineId: line.id, quantity: line.quantity })),
                );
            }
        }

        // Payment-process completion runs after the core has persisted the
        // placed order. Delivering here observes the pre-placement order and
        // its final save can overwrite the resulting fulfillment state.
        if (
            ['Modifying', 'ArrangingAdditionalPayment'].includes(fromState) &&
            ['PaymentSettled', 'PartiallyDelivered', 'PartiallyShipped', 'Shipped'].includes(toState)
        ) {
            const current = await connection.getEntityOrThrow(ctx, Order, order.id, {
                relations: ['payments', 'lines'],
            });
            const paid = current.payments
                .filter(
                    payment =>
                        payment.state === 'Settled' &&
                        !payment.metadata?.public?.testPayment &&
                        !payment.method.startsWith('controlled-test-payment'),
                )
                .reduce((sum, payment) => sum + payment.amount, 0);
            if (paid >= current.totalWithTax) {
                for (const line of current.lines)
                    await connection.getRepository(ctx, OrderLine).update(line.id, {
                        orderPlacedQuantity: Math.max(line.orderPlacedQuantity, line.quantity),
                    });
                await fulfillDigitalOrder(ctx, order.id);
                order.state = (await connection.getEntityOrThrow(ctx, Order, order.id)).state;
            }
        }
    },
};

export async function fulfillDigitalOrder(ctx: RequestContext, orderId: Order['id']) {
    const settledOrder = await connection.getEntityOrThrow(ctx, Order, orderId, {
        relations: [
            'customer',
            'lines',
            'lines.productVariant',
            'payments',
            'payments.refunds',
            'payments.refunds.lines',
        ],
    });
    if (!(await checkoutResources.canDeliver(ctx, orderId))) return;
    const linesToReserve: Order['lines'] = [];
    for (const line of settledOrder.lines) {
        if (getOrderLineFulfillmentType(line) !== 'digital') continue;
        const reservation = await digitalProducts.reservation(ctx, line.id);
        const history = await connection
            .getRepository(ctx, FulfillmentLine)
            .find({ where: { orderLineId: line.id }, relations: ['fulfillment'] });
        const delivered = history
            .filter(item => item.fulfillment.state === 'Delivered')
            .reduce((sum, item) => sum + item.quantity, 0);
        if (reservation || delivered < digitalDeliverableQuantity(settledOrder, line))
            linesToReserve.push(line);
    }
    try {
        const originalLines = settledOrder.lines;
        try {
            settledOrder.lines = linesToReserve;
            await digitalProducts.reserveOrder(ctx, settledOrder);
        } finally {
            settledOrder.lines = originalLines;
        }
    } catch (error) {
        await checkoutResources.markReview(
            ctx,
            settledOrder,
            error instanceof Error ? error.message : '交付资源不足',
        );
        return;
    }
    await autoCardService.allocateSettledOrder(ctx, settledOrder);
    await manualDigitalDeliveryService.createSettledOrderTasks(ctx, settledOrder);

    await autoCardService.completeAvailableDeliveries(ctx, orderId);
    const fileDownloadLines = settledOrder.lines.filter(line => isFileDownloadOrderLine(line));
    if (fileDownloadLines.length) {
        const pending = [] as Array<{ orderLineId: Order['lines'][number]['id']; quantity: number }>;
        for (const line of fileDownloadLines) {
            const previous = await connection
                .getRepository(ctx, FulfillmentLine)
                .find({ where: { orderLineId: line.id }, relations: ['fulfillment'] });
            const quantity = Math.max(
                0,
                digitalDeliverableQuantity(settledOrder, line) -
                    previous
                        .filter(item => item.fulfillment.state !== 'Cancelled')
                        .reduce((sum, item) => sum + item.quantity, 0),
            );
            if (quantity) {
                await digitalProducts.consumeLine(ctx, line.id, quantity);
                pending.push({ orderLineId: line.id, quantity });
            }
        }
        if (!pending.length) return;
        const fulfillment = await orderService.createFulfillment(ctx, {
            lines: pending,
            handler: { code: digitalFulfillmentHandler.code, arguments: [] },
        });
        if (isGraphQlErrorResult(fulfillment)) throw new Error(fulfillment.message);
        const delivered = await orderService.transitionFulfillmentToState(ctx, fulfillment.id, 'Delivered');
        if (isGraphQlErrorResult(delivered)) throw new Error(delivered.message);
    }
    await autoCardService.completeAvailableDeliveries(ctx, orderId);
}

async function stockLines(ctx: Parameters<DigitalProductService['config']>[0], lines: Order['lines']) {
    const matches = await Promise.all(
        lines.map(
            async line =>
                requiresStockAllocation(line) &&
                !(
                    getOrderLineFulfillmentType(line) === 'digital' &&
                    (await digitalProducts.config(ctx, line.productVariantId))
                ),
        ),
    );
    return lines.filter((_line, index) => matches[index]);
}

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
