import { FulfillmentProcess } from '@vendure/core';

import { FulfillmentDeliveryService } from './fulfillment-delivery.service';

let deliveryService: FulfillmentDeliveryService;

export const fulfillmentDeliveryProcess: FulfillmentProcess<string> = {
    init(injector) {
        deliveryService = injector.get(FulfillmentDeliveryService);
    },
    onTransitionStart(_fromState, toState, { ctx, fulfillment, orders }) {
        if (toState === 'Delivered') {
            return deliveryService.guardDeliveredTransition(ctx, fulfillment, orders);
        }
    },
    async onTransitionEnd(_fromState, toState, { ctx, fulfillment, orders }) {
        if (toState === 'Shipped') {
            await deliveryService.recordShippedTransition(ctx, fulfillment, orders);
        }
        if (toState === 'Delivered') {
            await deliveryService.finalizeDeliveredTransition(ctx, fulfillment);
        }
    },
};
