import type { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { GovernedConfigVersion } from './governed-config-version.entity';

export type GovernanceApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';

@Entity({ name: 'governance_approval_request' })
@Index('UQ_governance_approval_key', ['channelId', 'idempotencyKey'], { unique: true })
@Index('IDX_governance_approval_queue', ['channelId', 'status', 'expiresAt'])
export class GovernanceApprovalRequest extends VendureEntity {
    constructor(input?: DeepPartial<GovernanceApprovalRequest>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_governance_approval_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @ManyToOne(() => GovernedConfigVersion, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'configVersionId', foreignKeyConstraintName: 'FK_governance_approval_config' })
    configVersion: GovernedConfigVersion;

    @EntityId()
    configVersionId: ID;

    @Column({ type: 'varchar', length: 16 })
    status: GovernanceApprovalStatus;

    @Column({ type: 'varchar', length: 128 })
    requestedByUserId: string;

    @Column({ type: 'varchar', length: 500 })
    requestReason: string;

    @Column({ type: Date })
    expiresAt: Date;

    @Column({ type: 'varchar', length: 128, nullable: true })
    reviewedByUserId: string | null;

    @Column({ type: 'varchar', length: 500, nullable: true })
    reviewReason: string | null;

    @Column({ type: Date, nullable: true })
    reviewedAt: Date | null;

    @Column({ type: 'varchar', length: 96 })
    idempotencyKey: string;
}
