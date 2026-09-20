import type { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { FraudRiskCase } from './fraud-risk-case.entity';

@Entity({ name: 'fraud_risk_appeal' })
@Index('UQ_fraud_risk_appeal_key', ['riskCaseId', 'idempotencyKey'], { unique: true })
@Index('UQ_fraud_risk_appeal_case', ['riskCaseId'], { unique: true })
@Index('IDX_fraud_risk_appeal_queue', ['channelId', 'status', 'createdAt'])
export class FraudRiskAppeal extends VendureEntity {
    constructor(input?: DeepPartial<FraudRiskAppeal>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_fraud_risk_appeal_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @ManyToOne(() => FraudRiskCase, riskCase => riskCase.appeals, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'riskCaseId', foreignKeyConstraintName: 'FK_fraud_risk_appeal_case' })
    riskCase: FraudRiskCase;

    @EntityId()
    riskCaseId: ID;

    @EntityId({ nullable: true })
    customerId: ID | null;

    @Column({ type: 'varchar', length: 16 })
    status: 'PENDING' | 'ACCEPTED' | 'REJECTED';

    @Column({ type: 'varchar', length: 1000 })
    reason: string;

    @Column({ type: 'varchar', length: 1000, nullable: true })
    response: string | null;

    @Column({ type: 'varchar', length: 128, nullable: true })
    reviewedByUserId: string | null;

    @Column({ type: Date, nullable: true })
    reviewedAt: Date | null;

    @Column({ type: 'varchar', length: 96 })
    idempotencyKey: string;
}
