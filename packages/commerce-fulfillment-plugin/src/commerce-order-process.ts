import { GlobalFlag } from '@vendure/common/lib/generated-types';
import {
    isGraphQlErrorResult,
    OrderProcess,
    OrderService,
    ProductVariantService,
    StockMovementService,
} from '@vendure/core';

import { digitalFulfillmentHandler } from './digital-fulfillment-handler';
import {
    getOrderLineFulfillmentType,
    hasCompleteShippingAddress,
    summarizeOrderFulfillment,
} from './fulfillment-classification';

let orderService: OrderService;
let productVariantService: ProductVariantService;
let stockMovementService: StockMovementService;

export const commerceOrderProcess: OrderProcess<string> = {
    init(injector) {
        orderService = injector.get(OrderService);
        productVariantService = injector.get(ProductVariantService);
        stockMovementService = injector.get(StockMovementService);
    },

    async onTransitionStart(fromState, toState, { ctx, order }) {
        if (toState !== 'ArrangingPayment') {
            return;
        }

        const summary = summarizeOrderFulfillment(order);
        if (!summary.containsPhysicalProducts) {
            return;
        }

        if (!hasCompleteShippingAddress(ctx, order.shippingAddress)) {
            return ctx.translate('message.commerce-physical-order-requires-complete-address');
        }
        if (!order.shippingLines?.length) {
            return ctx.translate('message.commerce-physical-order-requires-shipping-method');
        }

        for (const line of order.lines) {
            if (getOrderLineFulfillmentType(line) !== 'physical') {
                continue;
            }
            const availableStock = await productVariantService.getSaleableStockLevel(
                ctx,
                line.productVariant,
            );
            if (line.productVariant.trackInventory !== GlobalFlag.FALSE && line.quantity > availableStock) {
                return ctx.translate('message.commerce-physical-product-insufficient-stock', {
                    productVariantName: line.productVariant.name,
                });
            }
        }
    },

    async onTransitionEnd(fromState, toState, { ctx, order }) {
        if (
            fromState !== 'ArrangingPayment' ||
            (toState !== 'PaymentAuthorized' && toState !== 'PaymentSettled')
        ) {
            return;
        }

        const physicalLines = order.lines.filter(line => getOrderLineFulfillmentType(line) === 'physical');
        if (physicalLines.length) {
            await stockMovementService.createAllocationsForOrderLines(
                ctx,
                physicalLines.map(line => ({ orderLineId: line.id, quantity: line.quantity })),
            );
        }

        const digitalLines = order.lines.filter(line => getOrderLineFulfillmentType(line) === 'digital');
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
