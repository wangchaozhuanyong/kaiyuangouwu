import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';

import { PurchaseOrder } from './purchase-order.entity';
import { PurchaseReceiptLine } from './purchase-receipt-line.entity';

@Entity({ name: 'catalog_purchase_receipt' })
@Index('IDX_catalog_purchase_receipt_order_key', ['purchaseOrderId', 'idempotencyKey'], { unique: true })
@Index('IDX_catalog_purchase_receipt_code', ['code'], { unique: true })
export class PurchaseReceipt extends VendureEntity {
    constructor(input?: DeepPartial<PurchaseReceipt>) {
        super(input);
    }

    @ManyToOne(() => PurchaseOrder, order => order.receipts, { nullable: false, onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'purchaseOrderId', foreignKeyConstraintName: 'FK_catalog_purchase_receipt_order' })
    purchaseOrder: PurchaseOrder;

    @EntityId()
    purchaseOrderId: ID;

    @Column({ type: 'varchar', length: 64 })
    code: string;

    @Column({ type: 'varchar', length: 80 })
    idempotencyKey: string;

    @Column({ type: 'varchar', length: 120, nullable: true })
    supplierDeliveryReference: string | null;

    @Column({ type: Date })
    receivedAt: Date;

    @Column({ type: 'varchar', length: 128, nullable: true })
    receivedByUserId: string | null;

    @Column({ type: 'text', nullable: true })
    notes: string | null;

    @OneToMany(() => PurchaseReceiptLine, line => line.receipt)
    lines: PurchaseReceiptLine[];
}
