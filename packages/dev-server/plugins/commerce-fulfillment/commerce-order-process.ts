import { GlobalFlag } from '@vendure/common/lib/generated-types';
import {
    isGraphQlErrorResult,
    LanguageCode,
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

        const isChinese = ctx.languageCode === LanguageCode.zh_Hans;
        if (!hasCompleteShippingAddress(ctx, order.shippingAddress)) {
            return isChinese
                ? '订单包含实物商品，请填写完整收货地址、邮编和联系电话，并确认国家与当前销售渠道一致'
                : 'This order contains physical products. Enter a complete shipping address, postcode and phone number for the active sales channel';
        }
        if (!order.shippingLines?.length) {
            return isChinese
                ? '订单包含实物商品，请先选择配送方式'
                : 'This order contains physical products. Select a shipping method before payment';
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
                return isChinese
                    ? `实物商品“${line.productVariant.name}”库存不足，请调整购买数量`
                    : `Physical product "${line.productVariant.name}" does not have enough stock`;
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
