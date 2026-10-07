// organize-imports-ignore: keep declaration imports in the repository ESLint order.
import type {
    LegacyCompensationProviders,
    LegacyCompensationRuntimeProof,
    LegacyCompensationSnapshot,
} from './public-preview-legacy-compensation.mjs';
import type { ManualDigitalDeliveryService } from '@vendure/commerce-fulfillment-plugin';
import type { ID, RequestContext } from '@vendure/core';
import type { IncidentResponseService } from '@vendure/operations-dashboard-plugin';

export interface LegacyDigitalSnapshot extends LegacyCompensationSnapshot {
    digital: {
        lineIdentity: { fulfillmentTypeSnapshot: string | null; digitalDeliveryModeSnapshot: string | null };
        task: Record<string, unknown> & { id: string; contentFingerprint: string };
        events: Array<Record<string, unknown>>;
        variant: Record<string, unknown>;
        globalSettings: Record<string, unknown>;
        configs: Array<Record<string, unknown>>;
        reservations: Array<Record<string, unknown>>;
        receiptAccess: Array<Record<string, unknown>>;
        fulfillmentLines: Array<Record<string, unknown>>;
        incidents: Array<Record<string, unknown>>;
        evidence: Array<Record<string, unknown>>;
        actions: Array<Record<string, unknown>>;
    };
}
export interface LegacyDigitalEntry {
    snapshot: LegacyDigitalSnapshot;
    fingerprint: string;
}
export interface LegacyDigitalReviewArtifact {
    version: 'historical-test-digital-review-v1';
    orderId: '37';
    channelId: '5';
    deliveryId: string;
    beforeFingerprint: string;
    contentFingerprint: string;
    contentClassification: 'TEST_ONLY';
    realResourceDisposition: 'NO_REAL_RESOURCE';
    attestationSource: 'HUMAN_USER_20261007';
    attestationDigest: string;
    externalDeliveryOutcome: 'NOT_VERIFIED' | 'VERIFIED_TEST_ONLY';
    reviewedAt: string;
}
export interface LegacyDigitalManifest {
    version: typeof LEGACY_DIGITAL_COMPENSATION_VERSION;
    authorization: typeof LEGACY_DIGITAL_COMPENSATION_AUTHORIZATION;
    sourceSnapshotSha256: string;
    capturedAt: string;
    entry: LegacyDigitalEntry;
}
export interface LegacyDigitalRuntimeProof extends LegacyCompensationRuntimeProof {
    /** Managed verifier binds current compiled guards/source hashes, not a human checkbox. */
    historicalDigitalCloseoutGuardsVerified: true;
}
export interface LegacyDigitalProviders extends LegacyCompensationProviders {
    verifyProductionRuntimeProtections?: () => Promise<LegacyDigitalRuntimeProof | null>;
    manualDelivery: Pick<ManualDigitalDeliveryService, 'closeHistoricalTestTask'>;
    incidents: Pick<IncidentResponseService, 'closeHistoricalTestTaskIncidents'>;
    verifyReviewedArtifact?: (
        artifact: LegacyDigitalReviewArtifact,
        entry: LegacyDigitalEntry,
    ) => Promise<boolean>;
}
export interface LegacyDigitalResult extends Record<string, unknown> {
    status: 'PREVIEW_ONLY' | 'APPLIED' | 'ALREADY_APPLIED';
    orderId: '37';
    changedQuantity?: number;
    correctedCoupons?: number;
    releaseIds?: string[];
    ledgerIds?: string[];
}
export interface LegacyDigitalExecutor {
    capture(ctx: RequestContext, orderId?: ID): Promise<LegacyDigitalEntry>;
    execute(
        ctx: RequestContext,
        options: {
            manifest: LegacyDigitalManifest;
            reviewArtifact: LegacyDigitalReviewArtifact;
            apply?: boolean;
        },
    ): Promise<LegacyDigitalResult>;
}
export declare const LEGACY_DIGITAL_COMPENSATION_VERSION: 'public-preview-legacy-digital-compensation-v1';
export declare const LEGACY_DIGITAL_COMPENSATION_AUTHORIZATION: 'ORDER_37_TEST_ONLY_20261007';
export declare const LEGACY_DIGITAL_COMPENSATION_SCOPE: Readonly<{
    orderId: '37';
    channelId: '5';
    orderLineId: '248';
    productVariantId: '1093';
    stockLocationId: '10';
    quantity: 1;
    couponId: '8';
}>;
export declare function validateLegacyDigitalReviewArtifact(
    artifact: LegacyDigitalReviewArtifact,
    entry: LegacyDigitalEntry,
    now?: Date,
): string;
export declare function validateLegacyDigitalCompensationSnapshot(
    snapshot: LegacyDigitalSnapshot,
    now?: Date,
): Array<{ orderLineId: string; productVariantId: string; stockLocationId: string; quantity: number }>;
export declare function createLegacyDigitalCompensationExecutor(
    providers: LegacyDigitalProviders,
): LegacyDigitalExecutor;
