import type { ID } from '@vendure/common/lib/shared-types';
import { RequestContext, VendureEvent } from '@vendure/core';

export const storefrontRealtimeTopics = [
    'catalog',
    'content',
    'config',
    'cart',
    'customer',
    'orders',
    'coupons',
    'reviews',
    'referral',
] as const;

export type StorefrontRealtimeTopic = (typeof storefrontRealtimeTopics)[number];

export interface StorefrontDataChangedOptions {
    /** Omit to use the active RequestContext Channel. */
    channelIds?: ID[];
    /** Use for genuinely global data such as an all-store announcement. */
    allChannels?: boolean;
    /** Private events are delivered only to matching authenticated users. */
    userIds?: ID[];
    /** Anonymous cart events can be scoped to an active Order. */
    orderIds?: ID[];
    entityType?: string;
    entityIds?: ID[];
}

/**
 * A transaction-aware cache invalidation event for the public storefront.
 * EventBus subscribers only observe this event after the RequestContext transaction commits.
 */
export class StorefrontDataChangedEvent extends VendureEvent {
    constructor(
        public readonly ctx: RequestContext,
        public readonly topics: StorefrontRealtimeTopic[],
        public readonly options: StorefrontDataChangedOptions = {},
    ) {
        super();
    }
}
