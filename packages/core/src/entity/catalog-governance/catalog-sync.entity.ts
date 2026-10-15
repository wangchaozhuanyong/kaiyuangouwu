import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Column, Entity, Index } from 'typeorm';

import { VendureEntity } from '../base/base.entity';
import { EntityId } from '../entity-id.decorator';

/** Platform-owned, opt-in relationship. No stock or credential material is copied here. */
@Entity({ name: 'catalog_sync_rule' })
@Index('IDX_catalog_sync_rule_identity', ['sourceChannelId', 'sourceCollectionId', 'targetChannelId'], {
    unique: true,
})
export class CatalogSyncRule extends VendureEntity {
    constructor(input?: DeepPartial<CatalogSyncRule>) {
        super(input);
    }
    @EntityId() sourceChannelId: ID;
    @EntityId() sourceCollectionId: ID;
    @EntityId() targetChannelId: ID;
    @EntityId() actorUserId: ID;
    @Column({ default: true }) includeDescendants: boolean;
    @Column({ default: false }) enabled: boolean;
    @Column({ default: false }) takeoverConfirmed: boolean;
    @Column({ type: 'int', default: 1 }) version: number;
    @Column({ type: 'varchar', length: 24, default: 'DISABLED' }) state:
        'DISABLED' | 'QUEUED' | 'RUNNING' | 'COMPLETE' | 'PARTIAL';
    @Column({ type: 'int', default: 0 }) cursor: number;
    @Column({ type: 'int', default: 0 }) generation: number;
    @Column({ type: 'int', default: 0 }) runGeneration: number;
    @Column({ type: 'int', default: 0 }) completedGeneration: number;
    @Column({ type: Date, nullable: true }) lastSyncedAt: Date | null;
    @Column({ type: Date, nullable: true }) leaseUntil: Date | null;
    @Column({ type: 'varchar', length: 36, nullable: true }) leaseToken: string | null;
    @Column({ type: 'varchar', length: 1000, nullable: true }) error: string | null;
}

/** One provenance record per rule; overlapping rules can point at the same resource. */
@Entity({ name: 'catalog_sync_binding' })
@Index('IDX_catalog_sync_binding_identity', ['ruleId', 'kind', 'sourceId'], { unique: true })
@Index('IDX_catalog_sync_binding_target', ['targetChannelId', 'kind', 'targetId'])
export class CatalogSyncBinding extends VendureEntity {
    constructor(input?: Partial<CatalogSyncBinding>) {
        super();
        Object.assign(this, input);
    }
    @EntityId() ruleId: ID;
    @EntityId() sourceChannelId: ID;
    @EntityId() targetChannelId: ID;
    @Column({ type: 'varchar', length: 16 }) kind: 'PRODUCT' | 'COLLECTION' | 'SHIPPING';
    @EntityId() sourceId: ID;
    @EntityId() targetId: ID;
    @Column({ type: 'varchar', length: 16, default: 'PENDING' }) state:
        'PENDING' | 'ACTIVE' | 'ERROR' | 'REMOVED';
    @Column({ type: 'varchar', length: 64, nullable: true }) fingerprint: string | null;
    @Column({ type: 'simple-json', nullable: true }) baseline: Record<string, unknown> | null;
    @Column({ type: 'varchar', length: 1000, nullable: true }) error: string | null;
}

/** Immutable supplier identity for accepted orders, independent of later rule changes. */
@Entity({ name: 'catalog_supply_snapshot' })
@Index('IDX_catalog_supply_snapshot_line', ['orderLineId'], { unique: true })
@Index('IDX_catalog_supply_snapshot_scope', ['channelId', 'productVariantId'])
export class CatalogSupplySnapshot extends VendureEntity {
    constructor(input?: DeepPartial<CatalogSupplySnapshot>) {
        super(input);
    }
    @EntityId() orderId: ID;
    @EntityId() orderLineId: ID;
    @EntityId() productVariantId: ID;
    @EntityId() channelId: ID;
    @EntityId() sourceChannelId: ID;
    @EntityId() ruleId: ID;
    @Column({ type: 'int' }) ruleVersion: number;
    @Column({ type: 'simple-json' }) configuration: {
        currencyCode: string;
        price: number;
        sourceCurrencyCode?: string;
        sourcePrice?: number;
        rate?: number;
        roundingMode?: string;
        markupBps?: number;
        fileVersionId?: string;
        shippingMethodIds?: string[];
    };
}
