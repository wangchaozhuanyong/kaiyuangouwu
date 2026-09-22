import type { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

export type GovernedConfigNamespace = 'FRAUD_RULES' | 'REPORT_SCHEDULE';
export type GovernedConfigStatus = 'DRAFT' | 'ACTIVE' | 'RETIRED' | 'REJECTED';

@Entity({ name: 'governed_config_version' })
@Index('UQ_governed_config_version', ['channelId', 'namespace', 'version'], { unique: true })
@Index('IDX_governed_config_active', ['channelId', 'namespace', 'status'])
export class GovernedConfigVersion extends VendureEntity {
    constructor(input?: DeepPartial<GovernedConfigVersion>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_governed_config_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @Column({ type: 'varchar', length: 40 })
    namespace: GovernedConfigNamespace;

    @Column({ type: 'int' })
    version: number;

    @Column({ type: 'varchar', length: 16 })
    status: GovernedConfigStatus;

    @Column({ type: 'text' })
    payloadJson: string;

    @Column({ type: 'varchar', length: 64 })
    payloadHash: string;

    @Column({ type: 'varchar', length: 128 })
    createdByUserId: string;

    @Column({ type: Date, nullable: true })
    activatedAt: Date | null;

    @Column({ type: Date, nullable: true })
    retiredAt: Date | null;
}
