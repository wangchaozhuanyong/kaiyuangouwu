import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { EntityId, ProductVariant, StockLocation, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

@Entity({ name: 'catalog_inventory_policy' })
@Index('IDX_catalog_inventory_policy_variant_location', ['variantId', 'stockLocationId'], { unique: true })
export class InventoryPolicy extends VendureEntity {
    constructor(input?: DeepPartial<InventoryPolicy>) {
        super(input);
    }

    @ManyToOne(() => ProductVariant, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'variantId', foreignKeyConstraintName: 'FK_catalog_inventory_policy_variant' })
    variant: ProductVariant;

    @EntityId()
    variantId: ID;

    @ManyToOne(() => StockLocation, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'stockLocationId', foreignKeyConstraintName: 'FK_catalog_inventory_policy_location' })
    stockLocation: StockLocation;

    @EntityId()
    stockLocationId: ID;

    @Column('int', { nullable: true })
    minimumStock: number | null;

    @Column('int', { nullable: true })
    maximumStock: number | null;
}
