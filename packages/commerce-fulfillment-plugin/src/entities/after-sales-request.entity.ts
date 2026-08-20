import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, Customer, EntityId, Money, Order, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';

import { AfterSalesReason, AfterSalesState, AfterSalesType } from '../after-sales.constants';
import { AfterSalesEvent } from './after-sales-event.entity';
import { AfterSalesItem } from './after-sales-item.entity';

@Entity({ name: 'after_sales_request' })
@Index('IDX_after_sales_request_code', ['code'], { unique: true })
@Index('IDX_after_sales_request_channel_state_created', ['channelId', 'state', 'createdAt'])
@Index('IDX_after_sales_request_customer_created', ['customerId', 'createdAt'])
@Index('IDX_after_sales_request_order', ['orderId'])
export class AfterSalesRequest extends VendureEntity {
    constructor(input?: DeepPartial<AfterSalesRequest>) {
        super(input);
    }

    @Column({ type: 'varchar', length: 32 })
    code: string;

    @Column({ type: 'varchar', length: 32 })
    type: AfterSalesType;

    @Column({ type: 'varchar', length: 24, default: 'PENDING' })
    state: AfterSalesState;

    @Column({ type: 'varchar', length: 40 })
    reason: AfterSalesReason;

    @Column({ type: 'text' })
    description: string;

    @Column({ type: 'varchar', length: 3 })
    currencyCode: CurrencyCode;

    @Money()
    requestedAmount: number;

    @Money({ nullable: true })
    approvedAmount: number | null;

    @Column({ type: 'text', nullable: true })
    resolution: string | null;

    @Column({ type: 'varchar', length: 200 })
    customerName: string;

    @Column({ type: 'varchar', length: 254 })
    customerEmail: string;

    @Column({ type: Date, nullable: true })
    respondedAt: Date | null;

    @Column({ type: Date, nullable: true })
    completedAt: Date | null;

    @Column({ type: Date, nullable: true })
    cancelledAt: Date | null;

    @OneToMany(() => AfterSalesItem, item => item.request)
    items: AfterSalesItem[];

    @OneToMany(() => AfterSalesEvent, event => event.request)
    events: AfterSalesEvent[];

    @ManyToOne(() => Channel, { onDelete: 'CASCADE', nullable: false })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_after_sales_request_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @ManyToOne(() => Customer, { nullable: false })
    @JoinColumn({ name: 'customerId', foreignKeyConstraintName: 'FK_after_sales_request_customer' })
    customer: Customer;

    @EntityId()
    customerId: ID;

    @ManyToOne(() => Order, { onDelete: 'CASCADE', nullable: false })
    @JoinColumn({ name: 'orderId', foreignKeyConstraintName: 'FK_after_sales_request_order' })
    order: Order;

    @EntityId()
    orderId: ID;
}
