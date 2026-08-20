import { Injectable } from '@nestjs/common';
import {
    isGraphQlErrorResult,
    Order,
    OrderService,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';

import { getOrderLineFulfillmentType } from './fulfillment-classification';

const CANCELLATION_REASON_MAX_LENGTH = 500;

@Injectable()
export class CustomerOrderCancellationService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly orderService: OrderService,
    ) {}

    async cancelAuthorizedPhysicalOrder(ctx: RequestContext, orderId: string, reason: string): Promise<Order> {
        const normalizedReason = reason.trim();
        if (!normalizedReason) {
            throw new UserInputError(ctx.translate('message.commerce-order-cancel-reason-required'));
        }
        if (normalizedReason.length > CANCELLATION_REASON_MAX_LENGTH) {
            throw new UserInputError(ctx.translate('message.commerce-order-cancel-reason-too-long'));
        }

        const order = await this.connection.getEntityOrThrow(ctx, Order, orderId, {
            channelId: ctx.channelId,
            relations: [
                'customer',
                'customer.user',
                'lines',
                'lines.productVariant',
                'payments',
                'fulfillments',
            ],
        });
        if (!ctx.activeUserId || String(order.customer?.user?.id) !== String(ctx.activeUserId)) {
            throw new UserInputError(ctx.translate('message.commerce-order-cancel-not-owned'));
        }
        if (order.state !== 'PaymentAuthorized') {
            throw new UserInputError(ctx.translate('message.commerce-order-cancel-not-authorized'));
        }
        if (order.lines.some(line => getOrderLineFulfillmentType(line) === 'digital')) {
            throw new UserInputError(ctx.translate('message.commerce-order-cancel-digital-not-supported'));
        }
        if (order.fulfillments?.length) {
            throw new UserInputError(ctx.translate('message.commerce-order-cancel-already-fulfilled'));
        }
        if (order.payments.some(payment => payment.state === 'Settled')) {
            throw new UserInputError(ctx.translate('message.commerce-order-cancel-payment-settled'));
        }

        const authorizedPayments = order.payments.filter(payment => payment.state === 'Authorized');
        if (!authorizedPayments.length) {
            throw new UserInputError(ctx.translate('message.commerce-order-cancel-payment-not-cancellable'));
        }
        for (const payment of authorizedPayments) {
            const paymentResult = await this.orderService.cancelPayment(ctx, payment.id);
            if (isGraphQlErrorResult(paymentResult)) {
                throw new UserInputError(paymentResult.message);
            }
        }

        const orderResult = await this.orderService.cancelOrder(ctx, {
            orderId: order.id,
            cancelShipping: true,
            reason: normalizedReason,
        });
        if (isGraphQlErrorResult(orderResult)) {
            throw new UserInputError(orderResult.message);
        }
        return orderResult;
    }
}
