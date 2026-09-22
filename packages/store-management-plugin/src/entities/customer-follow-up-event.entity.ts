import type { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, Customer, EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { CustomerFollowUp } from './customer-follow-up.entity';

export type CustomerFollowUpEventType =
    'CREATED' | 'RESCHEDULED' | 'COMPLETED' | 'DISMISSED' | 'AUTO_RECOVERED';

@Entity({ name: 'customer_follow_up_event' })
@Index('UQ_customer_follow_up_event_key', ['followUpId', 'idempotencyKey'], { unique: true })
@Index('IDX_customer_follow_up_event_timeline', ['followUpId', 'createdAt'])
@Index('IDX_customer_follow_up_event_customer', ['channelId', 'customerId', 'createdAt'])
export class CustomerFollowUpEvent extends VendureEntity {
    constructor(input?: DeepPartial<CustomerFollowUpEvent>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_customer_follow_up_event_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @ManyToOne(() => Customer, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'customerId', foreignKeyConstraintName: 'FK_customer_follow_up_event_customer' })
    customer: Customer;

    @EntityId()
    customerId: ID;

    @ManyToOne(() => CustomerFollowUp, followUp => followUp.events, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'followUpId', foreignKeyConstraintName: 'FK_customer_follow_up_event_follow_up' })
    followUp: CustomerFollowUp;

    @EntityId()
    followUpId: ID;

    @Column({ type: 'varchar', length: 24 })
    eventType: CustomerFollowUpEventType;

    @Column({ type: 'varchar', length: 96 })
    idempotencyKey: string;

    @Column({ type: 'varchar', length: 16 })
    actorType: 'SYSTEM' | 'ADMIN';

    @Column({ type: 'varchar', length: 160 })
    actorLabel: string;

    @EntityId({ nullable: true })
    actorUserId: ID | null;

    @Column({ type: 'text' })
    note: string;

    @Column({ type: 'text', nullable: true })
    payloadJson: string | null;
}
