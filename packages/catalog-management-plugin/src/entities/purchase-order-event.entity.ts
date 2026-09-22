import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { PurchaseOrder } from './purchase-order.entity';

@Entity({ name: 'catalog_purchase_order_event' })
@Index('IDX_catalog_purchase_order_event_order_created', ['purchaseOrderId', 'createdAt'])
export class PurchaseOrderEvent extends VendureEntity {
    constructor(input?: DeepPartial<PurchaseOrderEvent>) {
        super(input);
    }

    @ManyToOne(() => PurchaseOrder, order => order.events, { nullable: false, onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'purchaseOrderId', foreignKeyConstraintName: 'FK_catalog_purchase_event_order' })
    purchaseOrder: PurchaseOrder;

    @EntityId()
    purchaseOrderId: ID;

    @Column({ type: 'varchar', length: 40 })
    type: string;

    @Column({ type: 'varchar', length: 128, nullable: true })
    actorUserId: string | null;

    @Column({ type: 'varchar', length: 500 })
    summary: string;

    @Column({ type: 'simple-json', nullable: true })
    details: Record<string, string | number | boolean | null> | null;
}
