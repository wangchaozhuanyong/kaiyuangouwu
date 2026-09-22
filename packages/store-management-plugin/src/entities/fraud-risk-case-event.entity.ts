import type { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { FraudRiskCase } from './fraud-risk-case.entity';

@Entity({ name: 'fraud_risk_case_event' })
@Index('UQ_fraud_risk_event_key', ['riskCaseId', 'idempotencyKey'], { unique: true })
@Index('IDX_fraud_risk_event_timeline', ['riskCaseId', 'createdAt'])
export class FraudRiskCaseEvent extends VendureEntity {
    constructor(input?: DeepPartial<FraudRiskCaseEvent>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_fraud_risk_event_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @ManyToOne(() => FraudRiskCase, riskCase => riskCase.events, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'riskCaseId', foreignKeyConstraintName: 'FK_fraud_risk_event_case' })
    riskCase: FraudRiskCase;

    @EntityId()
    riskCaseId: ID;

    @Column({ type: 'varchar', length: 32 })
    eventType: string;

    @Column({ type: 'varchar', length: 16 })
    actorType: 'SYSTEM' | 'ADMIN' | 'CUSTOMER';

    @Column({ type: 'varchar', length: 128, nullable: true })
    actorUserId: string | null;

    @Column({ type: 'varchar', length: 500 })
    note: string;

    @Column({ type: 'text', nullable: true })
    payloadJson: string | null;

    @Column({ type: 'varchar', length: 96 })
    idempotencyKey: string;
}
