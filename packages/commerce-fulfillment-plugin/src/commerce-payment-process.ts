import {
    isGraphQlErrorResult,
    Order,
    orderItemsAreDelivered,
    orderItemsArePartiallyDelivered,
    OrderService,
    PaymentProcess,
    TransactionalConnection,
} from '@vendure/core';

import { digitalFulfillmentHandler } from './digital-fulfillment-handler';
import { summarizeOrderFulfillment } from './fulfillment-classification';

let connection: TransactionalConnection;
let orderService: OrderService;

/**
 * Completes digital fulfillment only after the default payment process has
 * finished moving the Order into a paid state. Doing this in the Order process
 * itself is too early: the outer Order transition performs a final save which
 * can overwrite the state change triggered by the Fulfillment process.
 */
export const commercePaymentProcess: PaymentProcess<string> = {
    init(injector) {
        connection = injector.get(TransactionalConnection);
        orderService = injector.get(OrderService);
    },

    async onTransitionEnd(_fromState, toState, { ctx, order }) {
        if (toState !== 'Authorized' && toState !== 'Settled') {
            return;
        }

        let currentOrder = await findOrderWithFulfillments(ctx, order.id);
        if (currentOrder.state !== 'PaymentAuthorized' && currentOrder.state !== 'PaymentSettled') {
            return;
        }

        const summary = summarizeOrderFulfillment(currentOrder);
        if (!summary.containsDigitalProducts) {
            return;
        }

        const pendingDigitalFulfillments = currentOrder.fulfillments.filter(
            fulfillment =>
                fulfillment.handlerCode === digitalFulfillmentHandler.code && fulfillment.state === 'Pending',
        );
        for (const fulfillment of pendingDigitalFulfillments) {
            const result = await orderService.transitionFulfillmentToState(ctx, fulfillment.id, 'Delivered');
            if (isGraphQlErrorResult(result)) {
                throw new Error(result.message);
            }
        }

        // A previously-authorized payment may settle after its digital
        // fulfillment was already delivered. No Fulfillment transition occurs
        // in that request, so explicitly reconcile the paid Order state.
        if (toState !== 'Settled') {
            return;
        }
        currentOrder = await findOrderWithFulfillments(ctx, order.id);
        if (currentOrder.state !== 'PaymentSettled') {
            return;
        }

        const targetState = summary.containsPhysicalProducts
            ? orderItemsArePartiallyDelivered(currentOrder)
                ? 'PartiallyDelivered'
                : undefined
            : orderItemsAreDelivered(currentOrder)
              ? 'Delivered'
              : undefined;
        if (!targetState || !orderService.getNextOrderStates(currentOrder).includes(targetState)) {
            return;
        }

        const result = await orderService.transitionToState(ctx, currentOrder.id, targetState);
        if (isGraphQlErrorResult(result)) {
            throw new Error(result.message);
        }
    },
};

function findOrderWithFulfillments(
    ctx: Parameters<TransactionalConnection['getEntityOrThrow']>[0],
    id: Order['id'],
) {
    return connection.getEntityOrThrow(ctx, Order, id, {
        relations: [
            'lines',
            'lines.productVariant',
            'fulfillments',
            'fulfillments.lines',
            'fulfillments.lines.fulfillment',
        ],
    });
}
