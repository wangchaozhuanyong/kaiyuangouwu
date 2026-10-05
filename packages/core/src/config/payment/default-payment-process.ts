import { HistoryEntryType } from '@vendure/common/lib/generated-types';

import { isGraphQlErrorResult } from '../../common/error/error-result';
import { PaymentState } from '../../service/helpers/payment-state-machine/payment-state';
import { orderTotalIsCovered, totalCoveredByActualPayments } from '../../service/helpers/utils/order-utils';

import { PaymentProcess } from './payment-process';

declare module '../../service/helpers/payment-state-machine/payment-state' {
    interface PaymentStates {
        Authorized: never;
        Settled: never;
        Declined: never;
    }
}

let configService: import('../config.service').ConfigService;
let orderService: import('../../service/services/order.service').OrderService;
let historyService: import('../../service/index').HistoryService;

/**
 * @description
 * The default {@link PaymentProcess}
 *
 * @docsCategory payment
 */
export const defaultPaymentProcess: PaymentProcess<PaymentState> = {
    transitions: {
        Created: {
            to: ['Authorized', 'Settled', 'Declined', 'Error', 'Cancelled'],
        },
        Authorized: {
            to: ['Settled', 'Error', 'Cancelled'],
        },
        Settled: {
            to: [],
        },
        Declined: {
            to: ['Cancelled'],
        },
        Error: {
            to: ['Cancelled'],
        },
        Cancelled: {
            to: [],
        },
    },
    async init(injector) {
        // Lazily import these services to avoid a circular dependency error
        // due to this being used as part of the DefaultConfig
        const ConfigService = await import('../config.service.js').then(m => m.ConfigService);
        const HistoryService = await import('../../service/index.js').then(m => m.HistoryService);
        const OrderService = await import('../../service/services/order.service.js').then(
            m => m.OrderService,
        );
        configService = injector.get(ConfigService);
        historyService = injector.get(HistoryService);
        orderService = injector.get(OrderService);
    },
    async onTransitionStart(fromState, toState, data) {
        // nothing here by default
    },
    async onTransitionEnd(fromState, toState, data) {
        const { ctx, payment, order } = data;
        order.payments = await orderService.getOrderPayments(ctx, order.id);

        await historyService.createHistoryEntryForOrder({
            ctx: data.ctx,
            orderId: data.order.id,
            type: HistoryEntryType.ORDER_PAYMENT_TRANSITION,
            data: {
                paymentId: data.payment.id,
                from: fromState,
                to: toState,
            },
        });

        // Capturing an authorization after shipment must preserve the recorded fulfillment state.
        if (
            [
                'Modifying',
                'PartiallyShipped',
                'Shipped',
                'PartiallyDelivered',
                'Delivered',
                'Cancelled',
            ].includes(order.state)
        )
            return;

        // Creation hooks run before OrderService returns. The completing payment must
        // already be linked to every outstanding modification before restoring the order.
        if (order.state === 'ArrangingAdditionalPayment') {
            const modifications = await orderService.getOrderModifications(ctx, order.id);
            if (modifications.some(modification => !modification.isSettled)) return;
        }
        const covered = (states: PaymentState[]) =>
            order.orderPlacedAt || order.state === 'ArrangingAdditionalPayment'
                ? totalCoveredByActualPayments(order, states) >= order.totalWithTax
                : orderTotalIsCovered(order, states);

        if (covered(['Settled']) && order.state !== 'PaymentSettled') {
            const result = await orderService.transitionToState(ctx, order.id, 'PaymentSettled');
            if (isGraphQlErrorResult(result)) {
                throw new Error(result.transitionError);
            }
        } else if (covered(['Authorized', 'Settled']) && order.state !== 'PaymentAuthorized') {
            const result = await orderService.transitionToState(ctx, order.id, 'PaymentAuthorized');
            if (isGraphQlErrorResult(result)) {
                throw new Error(result.transitionError);
            }
        }
    },
};
