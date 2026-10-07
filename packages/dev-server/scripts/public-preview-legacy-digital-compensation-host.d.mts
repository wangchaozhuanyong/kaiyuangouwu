// organize-imports-ignore: keep declaration imports in the repository ESLint order.
import type {
    LegacyDigitalExecutor,
    LegacyDigitalProviders,
    LegacyDigitalRuntimeProof,
} from './public-preview-legacy-digital-compensation.mjs';
import type { ConfigService } from '@vendure/core';
import type { DataSource } from 'typeorm';

export declare function createNoLifecycleLegacyDigitalCompensationHost(options: {
    dataSource: DataSource;
    configService: ConfigService;
    runtime: Record<string, unknown>;
    entities: Record<string, object>;
    clock?: () => Date;
    isolatedTest?: boolean;
    verifyProductionRuntimeProtections?: () => Promise<LegacyDigitalRuntimeProof | null>;
    verifyReviewedArtifact?: LegacyDigitalProviders['verifyReviewedArtifact'];
}): LegacyDigitalExecutor & {
    connection: LegacyDigitalProviders['connection'];
    providers: Pick<
        LegacyDigitalProviders,
        | 'orders'
        | 'carts'
        | 'stockMovements'
        | 'stockLocations'
        | 'coupons'
        | 'history'
        | 'manualDelivery'
        | 'incidents'
    >;
    lifecycle: Record<string, boolean>;
    close(): void;
};
