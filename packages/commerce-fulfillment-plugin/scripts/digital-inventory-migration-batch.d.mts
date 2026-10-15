import type { DigitalInventoryReviewRecord } from './digital-inventory-review.mjs';

export interface DigitalInventoryBatchRecord extends Omit<DigitalInventoryReviewRecord, 'status'> {
    status:
        | DigitalInventoryReviewRecord['status']
        | 'MIGRATED'
        | 'ACTIVE_AFTER_RECONCILIATION'
        | 'MIGRATED_REVIEW_REQUIRED'
        | 'EXECUTION_UNCONFIRMED';
    writeAcknowledged?: boolean;
    verified?: boolean;
    observedInventory?: {
        source: string;
        availableQuantity: number | null;
        reservedQuantity: number | null;
        consumedQuantity: number | null;
        observedAt: string;
    };
}
export function runDigitalInventoryMigrationBatch(input: {
    request?: (query: string, variables: Record<string, string | number>) => Promise<any>;
    channelId?: string;
    productIds?: string[];
    execute?: boolean;
    observedAt?: string;
}): Promise<{
    mode: 'EXECUTE' | 'DRY_RUN';
    status: 'COMPLETE' | 'PARTIAL' | 'DATA_MISSING';
    channelId: string | null;
    observedAt: string;
    records: DigitalInventoryBatchRecord[];
    summary: Record<string, number> | null;
    attentionRequired: boolean;
    reason?: string;
}>;
export function parseDigitalInventoryBatchArguments(args: string[]): {
    execute: boolean;
    productIds: string[];
    channelId?: string;
    endpoint?: string;
    output?: string;
    help?: boolean;
};
