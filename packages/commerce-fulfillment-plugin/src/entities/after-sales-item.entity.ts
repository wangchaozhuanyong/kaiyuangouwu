import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { EntityId, Money, OrderLine, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { FulfillmentType } from '../types';
import { AfterSalesRequest } from './after-sales-request.entity';

@Entity({ name: 'after_sales_item' })
@Index('IDX_after_sales_item_request', ['requestId'])
export class AfterSalesItem extends VendureEntity {
    constructor(input?: DeepPartial<AfterSalesItem>) {
        super(input);
    }

    @Column({ type: 'int' })
    quantity: number;

    @Money()
    unitPriceWithTax: number;

    @Money()
    lineAmountWithTax: number;

    @Column({ type: 'varchar', length: 255 })
    productName: string;

    @Column({ type: 'varchar', length: 255 })
    sku: string;

    @Column({ type: 'varchar', length: 16 })
    fulfillmentType: FulfillmentType;

    @ManyToOne(() => AfterSalesRequest, request => request.items, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'requestId', foreignKeyConstraintName: 'FK_after_sales_item_request' })
    request: AfterSalesRequest;

    @EntityId()
    requestId: ID;

    @ManyToOne(() => OrderLine, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'orderLineId', foreignKeyConstraintName: 'FK_after_sales_item_order_line' })
    orderLine: OrderLine | null;

    @EntityId({ nullable: true })
    orderLineId: ID | null;
}
