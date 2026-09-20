import type { CurrencyCode } from '@vendure/common/lib/generated-types';
import type { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, Customer, EntityId, Money, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

export type CustomerOperationsSegment = 'NEW' | 'LEAD' | 'ACTIVE' | 'LOYAL' | 'VIP' | 'AT_RISK' | 'DORMANT';
export type CustomerChurnRisk = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';

@Entity({ name: 'customer_operations_profile' })
@Index('UQ_customer_operations_profile_scope', ['channelId', 'customerId'], { unique: true })
@Index('IDX_customer_operations_profile_segment', ['channelId', 'segment', 'churnRisk'])
@Index('IDX_customer_operations_profile_follow_up', ['channelId', 'nextFollowUpAt'])
export class CustomerOperationsProfile extends VendureEntity {
    constructor(input?: DeepPartial<CustomerOperationsProfile>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_customer_operations_profile_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @ManyToOne(() => Customer, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'customerId', foreignKeyConstraintName: 'FK_customer_operations_profile_customer' })
    customer: Customer;

    @EntityId()
    customerId: ID;

    @Column({ type: 'varchar', length: 24 })
    segment: CustomerOperationsSegment;

    @Column({ type: 'varchar', length: 16 })
    churnRisk: CustomerChurnRisk;

    @Column({ type: 'int', default: 0 })
    recencyScore: number;

    @Column({ type: 'int', default: 0 })
    frequencyScore: number;

    @Column({ type: 'int', default: 0 })
    monetaryScore: number;

    @Column({ type: 'int', nullable: true })
    recencyDays: number | null;

    @Column({ type: 'int', default: 0 })
    orderCount: number;

    @Column({ type: 'varchar', length: 3 })
    currencyCode: CurrencyCode;

    @Money()
    grossRevenue: number;

    @Money()
    refundTotal: number;

    @Money()
    netLifetimeValue: number;

    @Money()
    averageOrderValue: number;

    @Column({ type: 'text' })
    currencyMetricsJson: string;

    @Column({ type: 'int', default: 0 })
    serviceInteractionCount: number;

    @Column({ type: 'int', default: 0 })
    afterSalesCount: number;

    @Column({ type: 'int', default: 0 })
    openAfterSalesCount: number;

    @Column({ type: Date, nullable: true })
    lastOrderAt: Date | null;

    @Column({ type: Date, nullable: true })
    lastServiceAt: Date | null;

    @Column({ type: Date, nullable: true })
    nextFollowUpAt: Date | null;

    @Column({ type: 'boolean', default: false })
    doNotContact: boolean;

    @Column({ type: 'text' })
    reasonsJson: string;

    @Column({ type: 'varchar', length: 32 })
    evaluationVersion: string;

    @Column({ type: Date })
    lastEvaluatedAt: Date;
}
