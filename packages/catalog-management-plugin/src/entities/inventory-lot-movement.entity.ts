import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import {
    EntityId,
    OrderLine,
    ProductVariant,
    StockLocation,
    StockMovement,
    VendureEntity,
} from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { InventoryLot } from './inventory-lot.entity';

export type InventoryLotMovementType = 'SALE' | 'CANCELLATION';

@Entity({ name: 'catalog_inventory_lot_movement' })
@Index('IDX_catalog_lot_movement_stock_lot', ['stockMovementId', 'lotId'], { unique: true })
@Index('IDX_catalog_lot_movement_order_line', ['orderLineId', 'variantId', 'stockLocationId'])
export class InventoryLotMovement extends VendureEntity {
    constructor(input?: DeepPartial<InventoryLotMovement>) {
        super(input);
    }

    @ManyToOne(() => InventoryLot, { nullable: false, onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'lotId', foreignKeyConstraintName: 'FK_catalog_lot_movement_lot' })
    lot: InventoryLot;

    @EntityId()
    lotId: ID;

    @ManyToOne(() => StockMovement, { nullable: false, onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'stockMovementId', foreignKeyConstraintName: 'FK_catalog_lot_movement_stock' })
    stockMovement: StockMovement;

    @EntityId()
    stockMovementId: ID;

    @ManyToOne(() => OrderLine, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'orderLineId', foreignKeyConstraintName: 'FK_catalog_lot_movement_order_line' })
    orderLine: OrderLine | null;

    @EntityId({ nullable: true })
    orderLineId: ID | null;

    @ManyToOne(() => ProductVariant, { nullable: false, onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'variantId', foreignKeyConstraintName: 'FK_catalog_lot_movement_variant' })
    variant: ProductVariant;

    @EntityId()
    variantId: ID;

    @ManyToOne(() => StockLocation, { nullable: false, onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'stockLocationId', foreignKeyConstraintName: 'FK_catalog_lot_movement_location' })
    stockLocation: StockLocation;

    @EntityId()
    stockLocationId: ID;

    @Column({ type: 'varchar', length: 24 })
    type: InventoryLotMovementType;

    /** Negative for a sale and positive for a cancellation. */
    @Column('int')
    quantity: number;

    @Column({ type: 'varchar', length: 64, nullable: true })
    actorId: string | null;
}
