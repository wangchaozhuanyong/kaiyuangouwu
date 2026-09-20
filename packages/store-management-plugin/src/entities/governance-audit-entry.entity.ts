import type { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

@Entity({ name: 'governance_audit_entry' })
@Index('UQ_governance_audit_sequence', ['channelId', 'sequence'], { unique: true })
@Index('UQ_governance_audit_key', ['channelId', 'idempotencyKey'], { unique: true })
@Index('IDX_governance_audit_resource', ['channelId', 'resourceType', 'resourceId', 'createdAt'])
export class GovernanceAuditEntry extends VendureEntity {
    constructor(input?: DeepPartial<GovernanceAuditEntry>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_governance_audit_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @Column({ type: 'int' })
    sequence: number;

    @Column({ type: 'varchar', length: 80 })
    eventType: string;

    @Column({ type: 'varchar', length: 80 })
    resourceType: string;

    @Column({ type: 'varchar', length: 160 })
    resourceId: string;

    @Column({ type: 'varchar', length: 16 })
    actorType: 'SYSTEM' | 'ADMIN' | 'CUSTOMER';

    @Column({ type: 'varchar', length: 128, nullable: true })
    actorUserId: string | null;

    @Column({ type: 'varchar', length: 160 })
    actorLabel: string;

    @Column({ type: 'varchar', length: 500 })
    reason: string;

    @Column({ type: 'text' })
    payloadJson: string;

    @Column({ type: 'varchar', length: 64 })
    payloadHash: string;

    @Column({ type: 'varchar', length: 64, nullable: true })
    previousHash: string | null;

    @Column({ type: 'varchar', length: 64 })
    entryHash: string;

    @Column({ type: 'varchar', length: 96 })
    idempotencyKey: string;
}
