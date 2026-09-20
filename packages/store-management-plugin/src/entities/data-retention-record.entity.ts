import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

export type DataRetentionResourceType = 'CUSTOMER_AVATAR';
export type DataRetentionStatus = 'PENDING' | 'BLOCKED_REFERENCE' | 'FAILED' | 'RESTORED' | 'PURGED';

@Entity({ name: 'data_retention_record' })
@Index('UQ_data_retention_resource', ['resourceType', 'resourceKey'], { unique: true })
@Index('IDX_data_retention_due', ['status', 'legalHold', 'nextAttemptAt'])
@Index('IDX_data_retention_channel_created', ['channelId', 'createdAt'])
export class DataRetentionRecord extends VendureEntity {
    constructor(input?: DeepPartial<DataRetentionRecord>) {
        super(input);
    }

    @EntityId()
    channelId: ID;

    @Column({ type: 'varchar', length: 32 })
    resourceType: DataRetentionResourceType;

    @Column({ type: 'varchar', length: 64 })
    resourceKey: string;

    @Column({ type: 'varchar', length: 64 })
    subjectKeyHash: string;

    @Column({ type: 'varchar', length: 64 })
    policyCode: string;

    @Column({ type: 'varchar', length: 64 })
    reason: string;

    @Column({ type: 'varchar', length: 24, default: 'PENDING' })
    status: DataRetentionStatus;

    @Column({ type: Date })
    quarantinedAt: Date;

    @Column({ type: Date })
    purgeAfter: Date;

    @Column({ type: Date, nullable: true })
    nextAttemptAt: Date | null;

    @Column({ type: 'boolean', default: false })
    legalHold: boolean;

    @Column({ type: 'varchar', length: 500, nullable: true })
    legalHoldReason: string | null;

    @EntityId({ nullable: true })
    legalHoldChangedByUserId: ID | null;

    @Column({ type: Date, nullable: true })
    legalHoldChangedAt: Date | null;

    @Column({ type: 'int', default: 0 })
    attemptCount: number;

    @Column({ type: Date, nullable: true })
    lastAttemptAt: Date | null;

    @Column({ type: 'varchar', length: 500, nullable: true })
    lastError: string | null;

    @Column({ type: Date, nullable: true })
    completedAt: Date | null;
}
