import { RequestContext, VendureEvent } from '@vendure/core';

export class ManualDigitalDeliveryReadyEvent extends VendureEvent {
    constructor(
        public readonly ctx: RequestContext,
        public readonly deliveryId: string,
    ) {
        super();
    }
}
