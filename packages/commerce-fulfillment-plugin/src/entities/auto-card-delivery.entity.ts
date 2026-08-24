import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, Order, OrderLine, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';

import { AutoCardDeliveryState } from '../auto-card.constants';

import { AutoCardConfig } from './auto-card-config.entity';
import { AutoCardDeliveryEvent } from './auto-card-delivery-event.entity';
import { AutoCardPoolItem } from './auto-card-pool-item.entity';

@Entity({ name: 'auto_card_delivery' })
@Index('IDX_auto_card_delivery_order_line', ['orderLineId'], { unique: true })
@Index('IDX_auto_card_delivery_channel_state_created', ['channelId', 'state', 'createdAt'])
@Index('IDX_auto_card_delivery_config_created', ['configId', 'createdAt'])
export class AutoCardDelivery extends VendureEntity {
    constructor(input?: DeepPartial<AutoCardDelivery>) {
        super(input);
    }

    @Column({ type: 'varchar', length: 24, default: 'WAITING_STOCK' })
    state: AutoCardDeliveryState;

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

    @Column({ type: 'text' })
    schemaSnapshot: string;

    @Column({ type: 'text' })
    instructionsSnapshot: string;

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
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_auto_card_delivery_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @ManyToOne(() => Order, { onDelete: 'CASCADE', nullable: false })
    @JoinColumn({ name: 'orderId', foreignKeyConstraintName: 'FK_auto_card_delivery_order' })
    order: Order;

    @EntityId()
    orderId: ID;

    @ManyToOne(() => OrderLine, { onDelete: 'CASCADE', nullable: false })
    @JoinColumn({ name: 'orderLineId', foreignKeyConstraintName: 'FK_auto_card_delivery_order_line' })
    orderLine: OrderLine;

    @EntityId()
    orderLineId: ID;

    @ManyToOne(() => AutoCardConfig, config => config.deliveries, {
        onDelete: 'RESTRICT',
        nullable: false,
    })
    @JoinColumn({ name: 'configId', foreignKeyConstraintName: 'FK_auto_card_delivery_config' })
    config: AutoCardConfig;

    @EntityId()
    configId: ID;

    @OneToMany(() => AutoCardPoolItem, item => item.delivery)
    poolItems: AutoCardPoolItem[];

    @OneToMany(() => AutoCardDeliveryEvent, event => event.delivery)
    events: AutoCardDeliveryEvent[];
}
