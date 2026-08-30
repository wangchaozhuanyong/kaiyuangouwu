import type { ID } from '@vendure/common/lib/shared-types';
import { RequestContext, VendureEvent } from '@vendure/core';

/** Emitted after storefront-managed content or layout settings change. */
export class StorefrontContentChangedEvent extends VendureEvent {
    readonly realtimeEventKind = 'storefront-content-changed';

    constructor(
        public readonly ctx: RequestContext,
        public readonly entityIds: ID[] = [],
    ) {
        super();
    }
}
