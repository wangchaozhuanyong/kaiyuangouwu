import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, Order, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

@Entity({ name: 'storefront_order_attribution' })
@Index('UQ_storefront_order_attribution_order', ['orderId'], { unique: true })
@Index('IDX_storefront_order_attribution_report', ['channelId', 'source', 'campaign', 'touchAt'])
export class StorefrontOrderAttribution extends VendureEntity {
    constructor(input?: DeepPartial<StorefrontOrderAttribution>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_storefront_order_attribution_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @ManyToOne(() => Order, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'orderId', foreignKeyConstraintName: 'FK_storefront_order_attribution_order' })
    order: Order;

    @EntityId()
    orderId: ID;

    @Column({ type: 'varchar', length: 36, nullable: true })
    touchEventId: string | null;

    @Column({ type: 'varchar', length: 32 })
    attributionModel: string;

    @Column({ type: 'varchar', length: 100 })
    source: string;

    @Column({ type: 'varchar', length: 100 })
    medium: string;

    @Column({ type: 'varchar', length: 160 })
    campaign: string;

    @Column({ type: 'varchar', length: 160 })
    term: string;

    @Column({ type: 'varchar', length: 160 })
    content: string;

    @Column({ type: 'varchar', length: 512, nullable: true })
    landingPath: string | null;

    @Column({ type: 'varchar', length: 255, nullable: true })
    referrerHost: string | null;

    @Column({ type: Date })
    touchAt: Date;
}
