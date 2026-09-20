import type { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, Fulfillment, Order, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, OneToOne } from 'typeorm';

import { FulfillmentDeliveryEvent } from './fulfillment-delivery-event.entity';

export type FulfillmentDeliveryStatus = 'IN_TRANSIT' | 'EXCEPTION' | 'DELIVERED';

@Entity({ name: 'fulfillment_delivery_record' })
@Index('IDX_fulfillment_delivery_channel_status', ['channelId', 'status', 'nextActionDueAt'])
export class FulfillmentDeliveryRecord extends VendureEntity {
    constructor(input?: DeepPartial<FulfillmentDeliveryRecord>) {
        super(input);
    }

    @Index('UQ_fulfillment_delivery_fulfillment', { unique: true })
    @OneToOne(() => Fulfillment, { onDelete: 'CASCADE' })
    @JoinColumn()
    fulfillment: Fulfillment;

    @EntityId()
    fulfillmentId: ID;

    @ManyToOne(() => Order, { onDelete: 'CASCADE' })
    @JoinColumn()
    order: Order;

    @EntityId()
    orderId: ID;

    @ManyToOne(() => Channel, { onDelete: 'CASCADE' })
    @JoinColumn()
    channel: Channel;

    @EntityId()
    channelId: ID;

    @Column({ type: 'varchar', length: 24 })
    status: FulfillmentDeliveryStatus;

    @Column({ type: 'varchar', length: 120 })
    carrier: string;

    @Column({ type: 'varchar', length: 160 })
    trackingCode: string;

    @Column({ type: 'text', nullable: true })
    exceptionReason: string | null;

    @Column({ type: 'varchar', length: 255, nullable: true })
    proofReference: string | null;

    @Column({ type: Date })
    shippedAt: Date;

    @Column({ type: Date, nullable: true })
    deliveredAt: Date | null;

    @Column({ type: Date, nullable: true })
    nextActionDueAt: Date | null;

    @OneToMany(() => FulfillmentDeliveryEvent, event => event.record)
    events: FulfillmentDeliveryEvent[];

    overdue = false;
}
