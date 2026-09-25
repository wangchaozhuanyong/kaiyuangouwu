import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, Customer, EntityId, Order, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { AfterSalesRequest } from './after-sales-request.entity';

@Entity({ name: 'after_sales_evidence' })
@Index('IDX_after_sales_evidence_owner', ['channelId', 'customerId', 'orderId'])
@Index('IDX_after_sales_evidence_request', ['requestId'])
@Index('IDX_after_sales_evidence_cleanup', ['deletedAt', 'storageDeletedAt', 'createdAt'])
@Index('UQ_after_sales_evidence_key', ['storageKey'], { unique: true })
export class AfterSalesEvidence extends VendureEntity {
    constructor(input?: DeepPartial<AfterSalesEvidence>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_after_sales_evidence_channel' })
    channel: Channel;
    @EntityId() channelId: ID;

    @ManyToOne(() => Customer, { nullable: false, onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'customerId', foreignKeyConstraintName: 'FK_after_sales_evidence_customer' })
    customer: Customer;
    @EntityId() customerId: ID;

    @ManyToOne(() => Order, { nullable: false, onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'orderId', foreignKeyConstraintName: 'FK_after_sales_evidence_order' })
    order: Order;
    @EntityId() orderId: ID;

    @ManyToOne(() => AfterSalesRequest, { nullable: true, onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'requestId', foreignKeyConstraintName: 'FK_after_sales_evidence_request' })
    request: AfterSalesRequest | null;
    @EntityId({ nullable: true }) requestId: ID | null;

    @Column({ type: 'varchar', length: 255 }) storageKey: string;
    @Column({ type: 'varchar', length: 64 }) sha256: string;
    @Column({ type: 'varchar', length: 32 }) mimeType: string;
    @Column('int') byteSize: number;
    @Column({ type: Date, nullable: true }) readyAt: Date | null;
    @Column({ type: Date, nullable: true }) deletedAt: Date | null;
    @Column({ type: Date, nullable: true }) storageDeletedAt: Date | null;
}
