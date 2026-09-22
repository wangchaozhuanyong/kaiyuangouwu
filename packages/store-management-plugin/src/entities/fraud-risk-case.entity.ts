import type { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';

import { FraudRiskAppeal } from './fraud-risk-appeal.entity';
import { FraudRiskCaseEvent } from './fraud-risk-case-event.entity';

export type FraudRiskCaseStatus = 'OPEN' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED' | 'APPEALED' | 'CLOSED';
export type FraudRiskSeverity = 'P1' | 'P2' | 'P3';

@Entity({ name: 'fraud_risk_case' })
@Index('UQ_fraud_risk_case_key', ['channelId', 'idempotencyKey'], { unique: true })
@Index('UQ_fraud_risk_case_code', ['caseCode'], { unique: true })
@Index(
    'UQ_fraud_risk_case_subject_digest',
    ['channelId', 'subjectType', 'subjectId', 'ruleVersion', 'subjectDigest'],
    { unique: true },
)
@Index('IDX_fraud_risk_case_queue', ['channelId', 'status', 'severity', 'dueAt'])
@Index('IDX_fraud_risk_case_subject', ['channelId', 'subjectType', 'subjectId', 'createdAt'])
export class FraudRiskCase extends VendureEntity {
    constructor(input?: DeepPartial<FraudRiskCase>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_fraud_risk_case_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @Column({ type: 'varchar', length: 32 })
    caseCode: string;

    @Column({ type: 'varchar', length: 24 })
    subjectType: 'ORDER' | 'ACCOUNT' | 'PAYMENT' | 'REFERRAL';

    @Column({ type: 'varchar', length: 128 })
    subjectId: string;

    @EntityId({ nullable: true })
    orderId: ID | null;

    @EntityId({ nullable: true })
    customerId: ID | null;

    @Column({ type: 'varchar', length: 16 })
    status: FraudRiskCaseStatus;

    @Column({ type: 'varchar', length: 8 })
    severity: FraudRiskSeverity;

    @Column({ type: 'int' })
    riskScore: number;

    @Column({ type: 'varchar', length: 64 })
    ruleVersion: string;

    @Column({ type: 'varchar', length: 64 })
    subjectDigest: string;

    @Column({ type: 'text' })
    signalsJson: string;

    @Column({ type: 'varchar', length: 40 })
    recommendedAction: 'ALLOW' | 'MANUAL_REVIEW' | 'HOLD_FULFILLMENT';

    @Column({ type: Date })
    dueAt: Date;

    @Column({ type: 'varchar', length: 128, nullable: true })
    ownerUserId: string | null;

    @Column({ type: 'varchar', length: 32, nullable: true })
    decisionCode: 'RELEASE' | 'BLOCK' | null;

    @Column({ type: 'varchar', length: 500, nullable: true })
    decisionReason: string | null;

    @Column({ type: 'varchar', length: 128, nullable: true })
    decidedByUserId: string | null;

    @Column({ type: Date, nullable: true })
    decidedAt: Date | null;

    @Column({ type: 'varchar', length: 96 })
    idempotencyKey: string;

    @OneToMany(() => FraudRiskCaseEvent, event => event.riskCase)
    events: FraudRiskCaseEvent[];

    @OneToMany(() => FraudRiskAppeal, appeal => appeal.riskCase)
    appeals: FraudRiskAppeal[];
}
