import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { InventoryLot } from './inventory-lot.entity';
import { PurchaseOrderLine } from './purchase-order-line.entity';
import { PurchaseReceipt } from './purchase-receipt.entity';

@Entity({ name: 'catalog_purchase_receipt_line' })
@Index('IDX_catalog_purchase_receipt_line_receipt_order_line', ['receiptId', 'purchaseOrderLineId'], {
    unique: true,
})
export class PurchaseReceiptLine extends VendureEntity {
    constructor(input?: DeepPartial<PurchaseReceiptLine>) {
        super(input);
    }

    @ManyToOne(() => PurchaseReceipt, receipt => receipt.lines, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'receiptId', foreignKeyConstraintName: 'FK_catalog_purchase_receipt_line_receipt' })
    receipt: PurchaseReceipt;

    @EntityId()
    receiptId: ID;

    @ManyToOne(() => PurchaseOrderLine, { nullable: false, onDelete: 'RESTRICT' })
    @JoinColumn({
        name: 'purchaseOrderLineId',
        foreignKeyConstraintName: 'FK_catalog_purchase_receipt_line_order_line',
    })
    purchaseOrderLine: PurchaseOrderLine;

    @EntityId()
    purchaseOrderLineId: ID;

    @ManyToOne(() => InventoryLot, { nullable: true, onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'inventoryLotId', foreignKeyConstraintName: 'FK_catalog_purchase_receipt_line_lot' })
    inventoryLot: InventoryLot | null;

    @EntityId({ nullable: true })
    inventoryLotId: ID | null;

    @Column('int')
    receivedQuantity: number;

    @Column('int')
    acceptedQuantity: number;

    @Column('int')
    rejectedQuantity: number;

    @Column({ type: 'varchar', length: 80, nullable: true })
    lotCode: string | null;

    @Column({ type: Date, nullable: true })
    manufacturedAt: Date | null;

    @Column({ type: Date, nullable: true })
    expiresAt: Date | null;

    @Column({ type: 'bigint' })
    unitCostMicrounits: string;

    @Column({ type: 'varchar', length: 500, nullable: true })
    rejectionReason: string | null;
}
