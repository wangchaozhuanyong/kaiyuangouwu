import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { EntityId, ProductVariant, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { PurchaseOrder } from './purchase-order.entity';

@Entity({ name: 'catalog_purchase_order_line' })
@Index('IDX_catalog_purchase_order_line_order_variant', ['purchaseOrderId', 'variantId'], { unique: true })
@Index('IDX_catalog_purchase_order_line_variant', ['variantId'])
export class PurchaseOrderLine extends VendureEntity {
    constructor(input?: DeepPartial<PurchaseOrderLine>) {
        super(input);
    }

    @ManyToOne(() => PurchaseOrder, order => order.lines, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'purchaseOrderId', foreignKeyConstraintName: 'FK_catalog_purchase_line_order' })
    purchaseOrder: PurchaseOrder;

    @EntityId()
    purchaseOrderId: ID;

    @ManyToOne(() => ProductVariant, { nullable: false, onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'variantId', foreignKeyConstraintName: 'FK_catalog_purchase_line_variant' })
    variant: ProductVariant;

    @EntityId()
    variantId: ID;

    @Column('int')
    orderedQuantity: number;

    @Column('int', { default: 0 })
    receivedQuantity: number;

    @Column('int', { default: 0 })
    acceptedQuantity: number;

    @Column('int', { default: 0 })
    rejectedQuantity: number;

    @Column('int', { default: 0 })
    returnedQuantity: number;

    @Column({ type: 'bigint' })
    unitCostMicrounits: string;

    @Column({ type: 'varchar', length: 80, nullable: true })
    purchaseUnit: string | null;

    @Column({ type: 'float', default: 1 })
    packageQuantity: number;

    @Column({ type: 'text', nullable: true })
    notes: string | null;
}
