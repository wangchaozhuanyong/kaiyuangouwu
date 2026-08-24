import { RequestContext, VendureEvent } from '@vendure/core';

export class AutoCardDeliveryReadyEvent extends VendureEvent {
    constructor(
        public readonly ctx: RequestContext,
        public readonly deliveryId: string,
    ) {
        super();
    }
}
