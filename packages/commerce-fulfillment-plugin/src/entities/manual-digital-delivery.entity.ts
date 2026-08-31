import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, Order, OrderLine, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';

import { ManualDigitalDeliveryEvent } from './manual-digital-delivery-event.entity';

export type ManualDigitalDeliveryState =
    'WAITING_PROCESSING' | 'DRAFT' | 'SENDING' | 'SENT' | 'EMAIL_FAILED' | 'MANUAL_REVIEW' | 'CANCELLED';

@Entity({ name: 'manual_digital_delivery' })
@Index('IDX_manual_digital_delivery_order_line', ['orderLineId'], { unique: true })
@Index('IDX_manual_digital_delivery_channel_state_expected', ['channelId', 'state', 'expectedAt'])
export class ManualDigitalDelivery extends VendureEntity {
    constructor(input?: DeepPartial<ManualDigitalDelivery>) {
        super(input);
    }

    @Column({ type: 'varchar', length: 24, default: 'WAITING_PROCESSING' })
    state: ManualDigitalDeliveryState;

    @Column({ type: 'varchar', length: 254 })
    recipientEmail: string;

    @Column({ type: 'varchar', length: 16 })
    languageCode: string;

    @Column({ type: 'varchar', length: 255 })
    productName: string;

    @Column({ type: 'varchar', length: 255 })
    sku: string;

    @Column({ type: 'int' })
    quantity: number;

    @Column({ type: Date })
    expectedAt: Date;

    @Column({ type: 'text', nullable: true })
    encryptedPackages: string | null;

    @Column({ type: 'text' })
    attachmentAssetIdsJson = '[]';

    @Column({ type: 'int', default: 0 })
    attemptCount: number;

    @Column({ type: 'text', nullable: true })
    lastError: string | null;

    @Column({ type: Date, nullable: true })
    lastDispatchedAt: Date | null;

    @Column({ type: Date, nullable: true })
    sentAt: Date | null;

    @Column({ type: 'varchar', length: 64, nullable: true })
    fulfillmentId: string | null;

    @ManyToOne(() => Channel, { onDelete: 'CASCADE', nullable: false })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_manual_delivery_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @ManyToOne(() => Order, { onDelete: 'CASCADE', nullable: false })
    @JoinColumn({ name: 'orderId', foreignKeyConstraintName: 'FK_manual_delivery_order' })
    order: Order;

    @EntityId()
    orderId: ID;

    @ManyToOne(() => OrderLine, { onDelete: 'CASCADE', nullable: false })
    @JoinColumn({ name: 'orderLineId', foreignKeyConstraintName: 'FK_manual_delivery_order_line' })
    orderLine: OrderLine;

    @EntityId()
    orderLineId: ID;

    @OneToMany(() => ManualDigitalDeliveryEvent, event => event.delivery)
    events: ManualDigitalDeliveryEvent[];
}
