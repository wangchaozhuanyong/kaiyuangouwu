import { type ConfigService } from '@vendure/core';
import { type DataSource } from 'typeorm';

import {
    type LegacyCompensationExecutor,
    type LegacyCompensationProviders,
    type LegacyCompensationRuntimeProof,
} from './public-preview-legacy-compensation.mjs';

export declare function createNoLifecycleLegacyCompensationHost(options: {
    dataSource: DataSource;
    configService: ConfigService;
    runtime: Record<string, unknown>;
    entities: Record<string, object>;
    clock?: () => Date;
    isolatedTest?: boolean;
    verifyProductionRuntimeProtections?: () => Promise<LegacyCompensationRuntimeProof | null>;
}): LegacyCompensationExecutor & {
    connection: LegacyCompensationProviders['connection'];
    providers: Pick<
        LegacyCompensationProviders,
        'orders' | 'carts' | 'stockMovements' | 'stockLocations' | 'coupons' | 'history'
    >;
    lifecycle: Record<string, boolean>;
    close(): void;
};
