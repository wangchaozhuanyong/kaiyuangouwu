import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, Customer, EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

@Entity({ name: 'storefront_daily_visitor' })
@Index('IDX_storefront_daily_visitor_identity', ['channelId', 'businessDate', 'visitorKeyHash'], {
    unique: true,
})
@Index('IDX_storefront_daily_visitor_channel_date', ['channelId', 'businessDate'])
export class StorefrontDailyVisitor extends VendureEntity {
    constructor(input?: DeepPartial<StorefrontDailyVisitor>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_storefront_daily_visitor_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @ManyToOne(() => Customer, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'customerId', foreignKeyConstraintName: 'FK_storefront_daily_visitor_customer' })
    customer: Customer | null;

    @EntityId({ nullable: true })
    customerId: ID | null;

    @Column({ type: 'varchar', length: 10 })
    businessDate: string;

    @Column({ type: 'varchar', length: 64 })
    visitorKeyHash: string;

    @Column({ type: Date })
    firstSeenAt: Date;

    @Column({ type: Date })
    lastSeenAt: Date;

    @Column('int', { default: 1 })
    visitCount: number;
}
