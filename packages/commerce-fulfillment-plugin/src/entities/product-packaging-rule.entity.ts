import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, Product, ProductVariant, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';

import { PackagingUnpackEvent } from './packaging-unpack-event.entity';

@Entity({ name: 'product_packaging_rule' })
@Index('IDX_product_packaging_rule_channel_product', ['channelId', 'productId'], { unique: true })
@Index('IDX_product_packaging_rule_channel_unit_variant', ['channelId', 'unitVariantId'], {
    unique: true,
})
@Index('IDX_product_packaging_rule_channel_package_variant', ['channelId', 'packageVariantId'], {
    unique: true,
})
export class ProductPackagingRule extends VendureEntity {
    constructor(input?: DeepPartial<ProductPackagingRule>) {
        super(input);
    }

    @Column({ type: 'boolean', default: true })
    enabled: boolean;

    @Column({ type: 'boolean', default: true })
    autoUnpack: boolean;

    @Column({ type: 'varchar', length: 32 })
    unitLabel: string;

    @Column({ type: 'varchar', length: 32 })
    packageLabel: string;

    @Column({ type: 'int' })
    unitsPerPackage: number;

    @ManyToOne(() => Channel, { onDelete: 'CASCADE', nullable: false })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_product_packaging_rule_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @ManyToOne(() => Product, { onDelete: 'CASCADE', nullable: false })
    @JoinColumn({ name: 'productId', foreignKeyConstraintName: 'FK_product_packaging_rule_product' })
    product: Product;

    @EntityId()
    productId: ID;

    @ManyToOne(() => ProductVariant, { onDelete: 'CASCADE', nullable: false })
    @JoinColumn({
        name: 'unitVariantId',
        foreignKeyConstraintName: 'FK_product_packaging_rule_unit_variant',
    })
    unitVariant: ProductVariant;

    @EntityId()
    unitVariantId: ID;

    @ManyToOne(() => ProductVariant, { onDelete: 'CASCADE', nullable: false })
    @JoinColumn({
        name: 'packageVariantId',
        foreignKeyConstraintName: 'FK_product_packaging_rule_package_variant',
    })
    packageVariant: ProductVariant;

    @EntityId()
    packageVariantId: ID;

    @OneToMany(() => PackagingUnpackEvent, event => event.rule)
    unpackEvents: PackagingUnpackEvent[];
}
