import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { AutoCardDeliveryEventType } from '../auto-card.constants';

import { AutoCardDelivery } from './auto-card-delivery.entity';

@Entity({ name: 'auto_card_delivery_event' })
@Index('IDX_auto_card_delivery_event_delivery_created', ['deliveryId', 'createdAt'])
export class AutoCardDeliveryEvent extends VendureEntity {
    constructor(input?: DeepPartial<AutoCardDeliveryEvent>) {
        super(input);
    }

    @Column({ type: 'varchar', length: 24 })
    type: AutoCardDeliveryEventType;

    @Column({ type: 'varchar', length: 16 })
    actorType: 'SYSTEM' | 'ADMIN';

    @Column({ type: 'varchar', length: 64, nullable: true })
    actorId: string | null;

    @Column({ type: 'text' })
    note: string;

    @ManyToOne(() => AutoCardDelivery, delivery => delivery.events, {
        onDelete: 'CASCADE',
        nullable: false,
    })
    @JoinColumn({ name: 'deliveryId', foreignKeyConstraintName: 'FK_auto_card_delivery_event_delivery' })
    delivery: AutoCardDelivery;

    @EntityId()
    deliveryId: ID;
}
