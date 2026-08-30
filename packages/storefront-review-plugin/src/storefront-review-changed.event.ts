import type { ID } from '@vendure/common/lib/shared-types';
import { RequestContext, VendureEvent } from '@vendure/core';

export class StorefrontReviewChangedEvent extends VendureEvent {
    readonly realtimeEventKind = 'storefront-review-changed';

    constructor(
        public readonly ctx: RequestContext,
        public readonly productId: ID,
        public readonly customerId: ID,
        public readonly reviewId: ID,
        public readonly publicListingChanged: boolean,
    ) {
        super();
    }
}
