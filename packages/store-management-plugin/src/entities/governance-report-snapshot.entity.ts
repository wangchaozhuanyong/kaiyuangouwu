import type { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

@Entity({ name: 'governance_report_snapshot' })
@Index('UQ_governance_report_date', ['channelId', 'businessDate'], { unique: true })
export class GovernanceReportSnapshot extends VendureEntity {
    constructor(input?: DeepPartial<GovernanceReportSnapshot>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_governance_report_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @Column({ type: 'varchar', length: 10 })
    businessDate: string;

    @Column({ type: Date })
    windowStartedAt: Date;

    @Column({ type: Date })
    windowEndedAt: Date;

    @Column({ type: 'text' })
    metricsJson: string;

    @Column({ type: 'varchar', length: 64 })
    digest: string;

    @Column({ type: 'boolean', default: true })
    auditIntegrityValid: boolean;

    @Column({ type: 'int', default: 0 })
    anomalyCount: number;
}
