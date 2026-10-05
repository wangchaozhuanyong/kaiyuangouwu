import { ID, RequestContext, VendureEvent } from '@vendure/core';

/** An order line changed without necessarily changing the aggregate order state. Contains no delivery content. */
export class OrderProcessingChangedEvent extends VendureEvent {
    constructor(
        public ctx: RequestContext,
        public orderId: ID,
    ) {
        super();
    }
}
