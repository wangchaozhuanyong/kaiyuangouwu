import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, Product, ProductVariant, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

@Entity({ name: 'catalog_source_binding' })
@Index('IDX_catalog_source_binding_channel_key', ['channelId', 'sourceKey'], { unique: true })
@Index('IDX_catalog_source_binding_variant', ['variantId'])
export class CatalogSourceBinding extends VendureEntity {
    constructor(input?: DeepPartial<CatalogSourceBinding>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_catalog_source_binding_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @Column({ type: 'varchar', length: 64 })
    sourceKey: string;

    @ManyToOne(() => Product, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'productId', foreignKeyConstraintName: 'FK_catalog_source_binding_product' })
    product: Product;

    @EntityId()
    productId: ID;

    @ManyToOne(() => ProductVariant, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'variantId', foreignKeyConstraintName: 'FK_catalog_source_binding_variant' })
    variant: ProductVariant;

    @EntityId()
    variantId: ID;

    @Column({ type: 'varchar', length: 64 })
    lastFingerprint: string;

    @Column({ type: 'varchar', length: 64 })
    lastFileHash: string;
}
