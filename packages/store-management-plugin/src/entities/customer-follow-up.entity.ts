import type { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, Customer, EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';

import { CustomerFollowUpEvent } from './customer-follow-up-event.entity';
import { CustomerOperationsProfile } from './customer-operations-profile.entity';

export type CustomerFollowUpStatus = 'OPEN' | 'COMPLETED' | 'DISMISSED';
export type CustomerFollowUpSource = 'SYSTEM' | 'ADMIN';
export type CustomerFollowUpPriority = 'P1' | 'P2' | 'P3';
export type CustomerFollowUpOutcome =
    'CONTACTED' | 'RESOLVED' | 'NO_RESPONSE' | 'DO_NOT_CONTACT' | 'NOT_NEEDED';

@Entity({ name: 'customer_follow_up' })
@Index('UQ_customer_follow_up_idempotency', ['channelId', 'idempotencyKey'], { unique: true })
@Index('IDX_customer_follow_up_queue', ['channelId', 'status', 'dueAt', 'priority'])
@Index('IDX_customer_follow_up_customer', ['channelId', 'customerId', 'createdAt'])
export class CustomerFollowUp extends VendureEntity {
    constructor(input?: DeepPartial<CustomerFollowUp>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_customer_follow_up_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @ManyToOne(() => Customer, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'customerId', foreignKeyConstraintName: 'FK_customer_follow_up_customer' })
    customer: Customer;

    @EntityId()
    customerId: ID;

    @ManyToOne(() => CustomerOperationsProfile, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'profileId', foreignKeyConstraintName: 'FK_customer_follow_up_profile' })
    profile: CustomerOperationsProfile;

    @EntityId()
    profileId: ID;

    @Column({ type: 'varchar', length: 24 })
    status: CustomerFollowUpStatus;

    @Column({ type: 'varchar', length: 16 })
    source: CustomerFollowUpSource;

    @Column({ type: 'varchar', length: 8 })
    priority: CustomerFollowUpPriority;

    @Column({ type: 'varchar', length: 32 })
    reasonCode: string;

    @Column({ type: 'varchar', length: 160 })
    title: string;

    @Column({ type: 'text' })
    note: string;

    @Column({ type: 'varchar', length: 96 })
    idempotencyKey: string;

    @Column({ type: Date })
    dueAt: Date;

    @EntityId({ nullable: true })
    ownerUserId: ID | null;

    @Column({ type: 'varchar', length: 32, nullable: true })
    outcomeCode: CustomerFollowUpOutcome | null;

    @Column({ type: 'text', nullable: true })
    outcomeNote: string | null;

    @Column({ type: Date, nullable: true })
    completedAt: Date | null;

    @EntityId({ nullable: true })
    completedByUserId: ID | null;

    @OneToMany(() => CustomerFollowUpEvent, event => event.followUp)
    events: CustomerFollowUpEvent[];
}
