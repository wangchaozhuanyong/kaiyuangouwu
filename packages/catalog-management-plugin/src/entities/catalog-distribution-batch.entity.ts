import { ID } from '@vendure/common/lib/shared-types';
import { EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity({ name: 'catalog_distribution_batch' })
@Index('IDX_catalog_distribution_idempotency', ['idempotencyKey'], { unique: true })
export class CatalogDistributionBatch extends VendureEntity {
    constructor(input?: Partial<CatalogDistributionBatch>) {
        super(input);
    }
    @Column({ type: 'varchar', length: 100 }) idempotencyKey: string;
    @EntityId() actorUserId: ID;
    @Column({ type: 'varchar', length: 64 }) inputHash: string;
    @Column({ type: 'varchar', length: 16, default: 'PREVIEW' }) state: 'PREVIEW' | 'PARTIAL' | 'COMPLETE';
    @Column({ type: 'simple-json' }) input: Record<string, any>;
    @Column({ type: 'simple-json' }) items: Array<Record<string, any>>;
    @Column({ type: 'simple-json' }) results: Array<Record<string, any>>;
}
