import { ID } from '@vendure/common/lib/shared-types';
import { RequestContext, VendureEvent } from '@vendure/core';

/**
 * Blocking hook for plugins which own customer data outside the core account tables.
 * Handlers must be idempotent and throw when data cannot yet be safely anonymized.
 */
export class BeforeAccountAnonymizationEvent extends VendureEvent {
    constructor(
        public readonly ctx: RequestContext,
        public readonly customerId: ID,
        public readonly reason: string,
    ) {
        super();
    }
}
