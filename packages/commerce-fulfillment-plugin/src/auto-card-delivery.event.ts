import { RequestContext, VendureEvent } from '@vendure/core';

export class AutoCardDeliveryReadyEvent extends VendureEvent {
    constructor(
        public readonly ctx: RequestContext,
        public readonly deliveryId: string,
    ) {
        super();
    }
}

/** Non-blocking subscribers receive this only after the maintenance transaction commits. */
export class AutoCardPoolEnabledEvent extends VendureEvent {
    constructor(
        public readonly ctx: RequestContext,
        public readonly productVariantId: string,
    ) {
        super();
    }
}
