import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { EntityId, ProductVariant, StockLocation, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne, VersionColumn } from 'typeorm';

@Entity({ name: 'catalog_inventory_lot' })
@Index('IDX_catalog_inventory_lot_unique', ['variantId', 'stockLocationId', 'lotCode'], { unique: true })
@Index('IDX_catalog_inventory_lot_expiry', ['stockLocationId', 'expiresAt'])
export class InventoryLot extends VendureEntity {
    constructor(input?: DeepPartial<InventoryLot>) {
        super(input);
    }

    @ManyToOne(() => ProductVariant, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'variantId', foreignKeyConstraintName: 'FK_catalog_inventory_lot_variant' })
    variant: ProductVariant;

    @EntityId()
    variantId: ID;

    @ManyToOne(() => StockLocation, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'stockLocationId', foreignKeyConstraintName: 'FK_catalog_inventory_lot_location' })
    stockLocation: StockLocation;

    @EntityId()
    stockLocationId: ID;

    @Column({ type: 'varchar', length: 80 })
    lotCode: string;

    @Column({ type: Date, nullable: true })
    manufacturedAt: Date | null;

    @Column({ type: Date, nullable: true })
    expiresAt: Date | null;

    @Column('int', { default: 0 })
    quantityOnHand: number;

    @Column({ type: 'bigint', nullable: true })
    purchaseCostMicrounits: string | null;

    @Column({ type: 'varchar', length: 3 })
    currencyCode: CurrencyCode;

    @Column({ type: 'varchar', length: 24, default: 'ACTIVE' })
    state: string;

    @VersionColumn()
    version: number;
}
