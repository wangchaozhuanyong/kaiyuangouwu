import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, Order, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

@Entity({ name: 'catalog_order_profit_expense_event' })
@Index('UQ_catalog_profit_expense_event_key', ['channelId', 'idempotencyKey'], { unique: true })
@Index('IDX_catalog_profit_expense_event_order', ['channelId', 'orderId', 'createdAt'])
export class OrderProfitExpenseEvent extends VendureEntity {
    constructor(input?: DeepPartial<OrderProfitExpenseEvent>) {
        super(input);
    }

    @ManyToOne(() => Order, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'orderId', foreignKeyConstraintName: 'FK_catalog_profit_expense_event_order' })
    order: Order;

    @EntityId()
    orderId: ID;

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_catalog_profit_expense_event_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @Column({ type: 'varchar', length: 3 })
    currencyCode: CurrencyCode;

    @Column({ type: 'varchar', length: 24 })
    eventType: string;

    @Column({ type: 'varchar', length: 96 })
    idempotencyKey: string;

    @Column({ type: 'varchar', length: 128, nullable: true })
    actorUserId: string | null;

    @Column({ type: 'varchar', length: 64, nullable: true })
    sourceReference: string | null;

    @Column({ type: 'text', nullable: true })
    beforeJson: string | null;

    @Column({ type: 'text' })
    afterJson: string;
}
