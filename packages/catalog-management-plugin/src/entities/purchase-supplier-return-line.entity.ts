import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { InventoryLot } from './inventory-lot.entity';
import { PurchaseOrderLine } from './purchase-order-line.entity';
import { PurchaseSupplierReturn } from './purchase-supplier-return.entity';

@Entity({ name: 'catalog_purchase_supplier_return_line' })
@Index(
    'IDX_catalog_purchase_return_line_return_order_line_lot',
    ['supplierReturnId', 'purchaseOrderLineId', 'inventoryLotId'],
    { unique: true },
)
export class PurchaseSupplierReturnLine extends VendureEntity {
    constructor(input?: DeepPartial<PurchaseSupplierReturnLine>) {
        super(input);
    }

    @ManyToOne(() => PurchaseSupplierReturn, supplierReturn => supplierReturn.lines, {
        nullable: false,
        onDelete: 'CASCADE',
    })
    @JoinColumn({
        name: 'supplierReturnId',
        foreignKeyConstraintName: 'FK_catalog_purchase_return_line_return',
    })
    supplierReturn: PurchaseSupplierReturn;

    @EntityId()
    supplierReturnId: ID;

    @ManyToOne(() => PurchaseOrderLine, { nullable: false, onDelete: 'RESTRICT' })
    @JoinColumn({
        name: 'purchaseOrderLineId',
        foreignKeyConstraintName: 'FK_catalog_purchase_return_line_order_line',
    })
    purchaseOrderLine: PurchaseOrderLine;

    @EntityId()
    purchaseOrderLineId: ID;

    @ManyToOne(() => InventoryLot, { nullable: false, onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'inventoryLotId', foreignKeyConstraintName: 'FK_catalog_purchase_return_line_lot' })
    inventoryLot: InventoryLot;

    @EntityId()
    inventoryLotId: ID;

    @Column('int')
    quantity: number;

    @Column({ type: 'bigint' })
    unitCostMicrounits: string;

    @Column({ type: 'bigint' })
    creditMicrounits: string;

    @Column({ type: 'varchar', length: 500 })
    reason: string;
}
