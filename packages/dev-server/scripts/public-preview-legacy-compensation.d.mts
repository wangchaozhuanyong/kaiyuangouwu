import type {
    HistoryService,
    ID,
    OrderService,
    Permission,
    RequestContext,
    StockLocationService,
    StockMovementService,
    TransactionalConnection,
} from '@vendure/core';
import type { StoreCouponLifecycleService } from '@vendure/store-management-plugin';
import type { StorefrontCartService } from '@vendure/storefront-cart-plugin';

export interface LegacyCompensationSnapshot {
    order: { id: string; salesChannelId: string; state: string; updatedAt?: string; fingerprint?: string };
    lines: Array<{
        id: string;
        productVariantId: string;
        quantity: number;
        fulfillmentType: string | null;
        fingerprint?: string;
    }>;
    payments: Array<Record<string, unknown>>;
    movements: Array<Record<string, unknown>>;
    locations: Array<Record<string, unknown>>;
    stockLevels: Array<Record<string, unknown>>;
    coupons: Array<Record<string, unknown>>;
    allocations: Array<Record<string, unknown>>;
    ledger: Array<Record<string, unknown>>;
    fulfillments: Array<Record<string, unknown>>;
    carts: Array<Record<string, unknown>>;
    risks: Record<string, Array<Record<string, unknown>>>;
}

export interface LegacyCompensationEntry {
    snapshot: LegacyCompensationSnapshot;
    fingerprint: string;
}

export interface LegacyCompensationManifest {
    version: string;
    authorization: string;
    sourceSnapshotSha256: string;
    capturedAt: string;
    orders: LegacyCompensationEntry[];
}

export interface LegacyCompensationRuntimeProof {
    status: 'VERIFIED';
    runtimeSha: string;
    releaseSha: string;
    protectionsFingerprint: string;
    sourceHashesVerified: true;
    nativeFundingGuardsVerified: true;
    testOrderDeliveryGuardsVerified: true;
}

export interface LegacyCompensationProviders {
    connection: TransactionalConnection;
    orders: Pick<OrderService, 'withOrderMutationTransaction' | 'lockOrderForRefund'>;
    carts: Pick<StorefrontCartService, 'lockForOrder'>;
    stockMovements: Pick<StockMovementService, 'createReleasesForOrderLines'>;
    stockLocations: Pick<StockLocationService, 'getReleaseLocations'>;
    coupons: Pick<StoreCouponLifecycleService, 'lockCouponForRepair' | 'publishCustomerCouponChanged'>;
    history: Pick<HistoryService, 'createHistoryEntryForOrder'>;
    entities: Record<string, object>;
    superAdminPermission: Permission;
    isolatedTest?: boolean;
    clock?: () => Date;
    verifyProductionRuntimeProtections?: () => Promise<LegacyCompensationRuntimeProof | null>;
}

export interface LegacyCompensationResult extends Record<string, unknown> {
    status: 'PREVIEW_ONLY' | 'APPLIED' | 'ALREADY_APPLIED';
    orderId: string;
    changedQuantity?: number;
    correctedCoupons?: number;
    releaseIds?: string[];
    ledgerIds?: string[];
}

export interface LegacyCompensationExecutor {
    capture(ctx: RequestContext, orderId: ID): Promise<LegacyCompensationEntry>;
    execute(
        ctx: RequestContext,
        options: { manifest: LegacyCompensationManifest; orderId: ID; apply?: boolean },
    ): Promise<LegacyCompensationResult>;
}

export declare const LEGACY_COMPENSATION_VERSION: 'public-preview-legacy-compensation-v1';
export declare const LEGACY_COMPENSATION_AUTHORIZATION: 'ORIGINAL_SIX_20261007';
export declare const LEGACY_COMPENSATION_SCOPE: Readonly<
    Record<
        string,
        { channelId: string; lines: Readonly<Record<string, number>>; couponIds?: readonly string[] }
    >
>;
export declare const LEGACY_COMPENSATION_RISK_TABLES: readonly string[];
export declare const LEGACY_COMPENSATION_LINE_RISK_TABLES: readonly string[];
export declare function canonicalCompensationJson(value: unknown): string;
export declare function compensationFingerprint(value: unknown): string;
export declare function validateLegacyCompensationSnapshot(
    snapshot: LegacyCompensationSnapshot,
    now?: Date,
): Array<{ orderLineId: string; productVariantId: string; stockLocationId: string; quantity: number }>;
export declare function createLegacyCompensationExecutor(
    providers: LegacyCompensationProviders,
): LegacyCompensationExecutor;
