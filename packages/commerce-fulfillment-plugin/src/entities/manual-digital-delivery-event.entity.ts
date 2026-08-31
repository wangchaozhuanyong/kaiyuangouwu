import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { ManualDigitalDelivery } from './manual-digital-delivery.entity';

export type ManualDigitalDeliveryEventType =
    | 'TASK_CREATED'
    | 'DRAFT_SAVED'
    | 'PUBLISHED'
    | 'EMAIL_SENT'
    | 'EMAIL_FAILED'
    | 'AUTO_RETRY'
    | 'MANUAL_RETRY'
    | 'MANUAL_REVIEW'
    | 'CANCELLED';

@Entity({ name: 'manual_digital_delivery_event' })
@Index('IDX_manual_delivery_event_delivery_created', ['deliveryId', 'createdAt'])
export class ManualDigitalDeliveryEvent extends VendureEntity {
    constructor(input?: DeepPartial<ManualDigitalDeliveryEvent>) {
        super(input);
    }

    @Column({ type: 'varchar', length: 24 })
    type: ManualDigitalDeliveryEventType;

    @Column({ type: 'varchar', length: 16 })
    actorType: 'SYSTEM' | 'ADMIN';

    @Column({ type: 'varchar', length: 64, nullable: true })
    actorId: string | null;

    @Column({ type: 'text' })
    note: string;

    @ManyToOne(() => ManualDigitalDelivery, delivery => delivery.events, {
        onDelete: 'CASCADE',
        nullable: false,
    })
    @JoinColumn({ name: 'deliveryId', foreignKeyConstraintName: 'FK_manual_delivery_event_delivery' })
    delivery: ManualDigitalDelivery;

    @EntityId()
    deliveryId: ID;
}
