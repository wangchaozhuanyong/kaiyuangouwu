import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, ProductVariant, VendureEntity } from '@vendure/core';
import { Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { CatalogSupplier } from './catalog-supplier.entity';

@Entity({ name: 'catalog_variant_supplier' })
@Index('IDX_catalog_variant_supplier_channel_variant', ['channelId', 'variantId'], { unique: true })
@Index('IDX_catalog_variant_supplier_supplier', ['supplierId'])
export class CatalogVariantSupplier extends VendureEntity {
    constructor(input?: DeepPartial<CatalogVariantSupplier>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_catalog_variant_supplier_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @ManyToOne(() => ProductVariant, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'variantId', foreignKeyConstraintName: 'FK_catalog_variant_supplier_variant' })
    variant: ProductVariant;

    @EntityId()
    variantId: ID;

    @ManyToOne(() => CatalogSupplier, { nullable: false, onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'supplierId', foreignKeyConstraintName: 'FK_catalog_variant_supplier_supplier' })
    supplier: CatalogSupplier;

    @EntityId()
    supplierId: ID;
}
