import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

@Entity({ name: 'catalog_supplier' })
@Index('IDX_catalog_supplier_channel_code', ['channelId', 'code'], { unique: true })
@Index('IDX_catalog_supplier_channel_name', ['channelId', 'normalizedName'], { unique: true })
@Index('IDX_catalog_supplier_channel_enabled', ['channelId', 'enabled'])
export class CatalogSupplier extends VendureEntity {
    constructor(input?: DeepPartial<CatalogSupplier>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_catalog_supplier_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @Column({ type: 'varchar', length: 64 })
    code: string;

    @Column({ type: 'varchar', length: 255 })
    name: string;

    @Column({ type: 'varchar', length: 255 })
    normalizedName: string;

    @Column({ type: 'boolean', default: true })
    enabled: boolean;

    @Column({ type: 'varchar', length: 120, nullable: true })
    contactName: string | null;

    @Column({ type: 'varchar', length: 80, nullable: true })
    phone: string | null;

    @Column({ type: 'varchar', length: 255, nullable: true })
    email: string | null;

    @Column({ type: 'varchar', length: 500, nullable: true })
    address: string | null;

    @Column({ type: 'text', nullable: true })
    notes: string | null;
}
