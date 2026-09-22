import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { EntityId, ProductVariant, StockLocation, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { InventoryLot } from './inventory-lot.entity';
import { InventoryOperation } from './inventory-operation.entity';

@Entity({ name: 'catalog_inventory_operation_line' })
@Index('IDX_catalog_inventory_operation_line_operation', ['operationId'])
@Index('IDX_catalog_inventory_operation_line_scope', ['variantId', 'stockLocationId', 'createdAt'])
export class InventoryOperationLine extends VendureEntity {
    constructor(input?: DeepPartial<InventoryOperationLine>) {
        super(input);
    }

    @ManyToOne(() => InventoryOperation, operation => operation.lines, {
        nullable: false,
        onDelete: 'RESTRICT',
    })
    @JoinColumn({ name: 'operationId', foreignKeyConstraintName: 'FK_catalog_inventory_line_operation' })
    operation: InventoryOperation;

    @EntityId()
    operationId: ID;

    @ManyToOne(() => ProductVariant, { nullable: false, onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'variantId', foreignKeyConstraintName: 'FK_catalog_inventory_line_variant' })
    variant: ProductVariant;

    @EntityId()
    variantId: ID;

    @ManyToOne(() => StockLocation, { nullable: false, onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'stockLocationId', foreignKeyConstraintName: 'FK_catalog_inventory_line_location' })
    stockLocation: StockLocation;

    @EntityId()
    stockLocationId: ID;

    @ManyToOne(() => InventoryLot, { nullable: true, onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'inventoryLotId', foreignKeyConstraintName: 'FK_catalog_inventory_line_lot' })
    inventoryLot: InventoryLot | null;

    @EntityId({ nullable: true })
    inventoryLotId: ID | null;

    @Column('int')
    quantityDelta: number;

    @Column('int')
    previousLotQuantity: number;

    @Column('int')
    resultingLotQuantity: number;

    @Column('int')
    previousStockOnHand: number;

    @Column('int')
    resultingStockOnHand: number;

    @Column({ type: 'varchar', length: 32, nullable: true })
    reconciliationMode: string | null;
}
