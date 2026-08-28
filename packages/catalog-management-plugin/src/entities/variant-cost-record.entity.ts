import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, ProductVariant, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

@Entity({ name: 'catalog_variant_cost_record' })
@Index('IDX_catalog_variant_cost_current', ['variantId', 'channelId', 'currencyCode', 'effectiveAt'])
export class VariantCostRecord extends VendureEntity {
    constructor(input?: DeepPartial<VariantCostRecord>) {
        super(input);
    }

    @ManyToOne(() => ProductVariant, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'variantId', foreignKeyConstraintName: 'FK_catalog_variant_cost_variant' })
    variant: ProductVariant;

    @EntityId()
    variantId: ID;

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_catalog_variant_cost_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @Column({ type: 'varchar', length: 3 })
    currencyCode: CurrencyCode;

    @Column({ type: 'bigint' })
    costMicrounits: string;

    @Column({ type: Date })
    effectiveAt: Date;

    @Column({ type: 'varchar', length: 24 })
    source: string;

    @Column({ type: 'varchar', length: 64, nullable: true })
    sourceReference: string | null;

    @Column({ type: 'varchar', length: 64, nullable: true })
    actorId: string | null;
}
