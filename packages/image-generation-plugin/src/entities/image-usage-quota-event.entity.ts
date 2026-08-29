import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity({ name: 'image_usage_quota_event' })
@Index('IDX_image_usage_quota_event_idempotency', ['idempotencyKey'], { unique: true })
@Index('IDX_image_usage_quota_event_resource', ['resourceType', 'resourceId'])
export class ImageUsageQuotaEvent extends VendureEntity {
    constructor(input?: DeepPartial<ImageUsageQuotaEvent>) {
        super(input);
    }

    @EntityId()
    bucketId: ID;

    @Column({ type: 'varchar', length: 96 })
    idempotencyKey: string;

    @Column({ type: 'varchar', length: 32 })
    resourceType: string;

    @Column({ type: 'varchar', length: 64 })
    resourceId: string;

    @Column('int')
    amount: number;

    @Column('int', { default: 0 })
    consumedAmount: number;

    @Column('int', { default: 0 })
    releasedAmount: number;

    @Column({ type: 'varchar', length: 16, default: 'RESERVED' })
    state: string;

    @Column({ type: Date, nullable: true })
    consumedAt: Date | null;

    @Column({ type: Date, nullable: true })
    releasedAt: Date | null;

    @Column({ type: 'simple-json', nullable: true })
    metadata: Record<string, any> | null;
}
