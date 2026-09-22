import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';

import { PurchaseOrder } from './purchase-order.entity';
import { PurchaseSupplierReturnLine } from './purchase-supplier-return-line.entity';

@Entity({ name: 'catalog_purchase_supplier_return' })
@Index('IDX_catalog_purchase_return_order_key', ['purchaseOrderId', 'idempotencyKey'], { unique: true })
@Index('IDX_catalog_purchase_return_code', ['code'], { unique: true })
export class PurchaseSupplierReturn extends VendureEntity {
    constructor(input?: DeepPartial<PurchaseSupplierReturn>) {
        super(input);
    }

    @ManyToOne(() => PurchaseOrder, order => order.supplierReturns, {
        nullable: false,
        onDelete: 'RESTRICT',
    })
    @JoinColumn({ name: 'purchaseOrderId', foreignKeyConstraintName: 'FK_catalog_purchase_return_order' })
    purchaseOrder: PurchaseOrder;

    @EntityId()
    purchaseOrderId: ID;

    @Column({ type: 'varchar', length: 64 })
    code: string;

    @Column({ type: 'varchar', length: 80 })
    idempotencyKey: string;

    @Column({ type: 'varchar', length: 120, nullable: true })
    supplierAcknowledgementReference: string | null;

    @Column({ type: Date })
    returnedAt: Date;

    @Column({ type: 'varchar', length: 128, nullable: true })
    returnedByUserId: string | null;

    @Column({ type: 'text', nullable: true })
    notes: string | null;

    @OneToMany(() => PurchaseSupplierReturnLine, line => line.supplierReturn)
    lines: PurchaseSupplierReturnLine[];
}
