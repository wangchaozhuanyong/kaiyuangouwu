export interface DigitalInventoryReviewRecord {
    productId: string;
    productVariantId?: string;
    sku?: string;
    status: 'ACTIVE' | 'READY_FOR_MIGRATION' | 'DEFERRED' | 'NEEDS_REVIEW' | 'READ_FAILED';
    reason?: string;
    availableQuantity?: number;
    reservedQuantity?: number;
    conflicts?: string[];
    confirmableStockLevels?: Array<{
        id: string;
        stockLocationId: string;
        stockOnHand: number;
        stockAllocated: number;
    }>;
}
export function classifyDigitalMigrationPreview(preview: {
    alreadyMigrated: boolean;
    conflicts: string[];
}): DigitalInventoryReviewRecord['status'];
export function generateDigitalInventoryMigrationReview(input: {
    request?: (query: string, variables: Record<string, string>) => Promise<any>;
    channelId?: string;
    productIds?: string[];
    observedAt?: string;
}): Promise<{
    status: 'COMPLETE' | 'PARTIAL' | 'DATA_MISSING';
    channelId: string | null;
    observedAt: string;
    records: DigitalInventoryReviewRecord[];
    reason?: string;
}>;
