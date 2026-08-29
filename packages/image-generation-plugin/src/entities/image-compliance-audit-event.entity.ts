import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

@Entity({ name: 'image_compliance_audit_event' })
@Index('IDX_image_compliance_audit_channel_created', ['channelId', 'createdAt'])
export class ImageComplianceAuditEvent extends VendureEntity {
    constructor(input?: DeepPartial<ImageComplianceAuditEvent>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_image_compliance_audit_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @EntityId({ nullable: true })
    actorId: ID | null;

    @Column({ type: 'varchar', length: 64 })
    customerIdSnapshot: string;

    @Column({ type: 'varchar', length: 32 })
    action: string;

    @Column({ type: 'varchar', length: 500 })
    reason: string;

    @Column('int', { default: 0 })
    affectedPromptRecords: number;

    @Column('int', { default: 0 })
    affectedJobs: number;

    @Column({ type: 'simple-json', nullable: true })
    metadata: Record<string, any> | null;
}
