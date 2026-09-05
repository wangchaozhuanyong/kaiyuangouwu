import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, Order, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

@Entity({ name: 'catalog_order_profit_expense' })
@Index('IDX_catalog_order_profit_expense_scope', ['orderId', 'channelId', 'currencyCode'], {
    unique: true,
})
@Index('IDX_catalog_order_profit_expense_channel_updated', ['channelId', 'updatedAt'])
export class OrderProfitExpense extends VendureEntity {
    constructor(input?: DeepPartial<OrderProfitExpense>) {
        super(input);
    }

    @ManyToOne(() => Order, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'orderId', foreignKeyConstraintName: 'FK_catalog_profit_expense_order' })
    order: Order;

    @EntityId()
    orderId: ID;

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_catalog_profit_expense_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @Column({ type: 'varchar', length: 3 })
    currencyCode: CurrencyCode;

    @Column({ type: 'bigint', nullable: true })
    carrierShippingCostMicrounits: string | null;

    @Column({ type: 'bigint', nullable: true })
    paymentFeeMicrounits: string | null;

    @Column({ type: 'varchar', length: 24 })
    source: string;

    @Column({ type: 'varchar', length: 64, nullable: true })
    sourceReference: string | null;

    @Column({ type: 'varchar', length: 500, nullable: true })
    note: string | null;

    @Column({ type: 'varchar', length: 64, nullable: true })
    actorId: string | null;
}
