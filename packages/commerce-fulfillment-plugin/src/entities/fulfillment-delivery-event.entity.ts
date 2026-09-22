import type { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import {
    FulfillmentDeliveryRecord,
    type FulfillmentDeliveryStatus,
} from './fulfillment-delivery-record.entity';

@Entity({ name: 'fulfillment_delivery_event' })
@Index('IDX_fulfillment_delivery_event_record_created', ['recordId', 'createdAt'])
@Index('IDX_fulfillment_delivery_event_record_key', ['recordId', 'idempotencyKey'], { unique: true })
export class FulfillmentDeliveryEvent extends VendureEntity {
    constructor(input?: DeepPartial<FulfillmentDeliveryEvent>) {
        super(input);
    }

    @ManyToOne(() => FulfillmentDeliveryRecord, record => record.events, { onDelete: 'CASCADE' })
    @JoinColumn()
    record: FulfillmentDeliveryRecord;

    @EntityId()
    recordId: ID;

    @Column({ type: 'varchar', length: 24 })
    status: FulfillmentDeliveryStatus;

    @Column({ type: 'varchar', length: 80 })
    idempotencyKey: string;

    @Column({ type: 'varchar', length: 16 })
    actorType: 'CUSTOMER' | 'ADMIN' | 'SYSTEM';

    @Column({ type: 'varchar', length: 255 })
    actorLabel: string;

    @Column({ type: 'varchar', length: 128, nullable: true })
    actorId: string | null;

    @Column({ type: 'text' })
    note: string;

    @Column({ type: 'varchar', length: 120 })
    carrier: string;

    @Column({ type: 'varchar', length: 160 })
    trackingCode: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    proofReference: string | null;
}
