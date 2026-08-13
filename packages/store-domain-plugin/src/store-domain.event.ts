import { RequestContext, VendureEvent } from '@vendure/core';

export class StoreDomainChangedEvent extends VendureEvent {
    constructor(
        public readonly ctx: RequestContext,
        public readonly domain: string,
    ) {
        super();
    }
}
