import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, Customer, EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

@Entity({ name: 'image_private_asset' })
@Index('IDX_image_private_asset_owner_created', ['customerId', 'createdAt'])
@Index('IDX_image_private_asset_expiry', ['expiresAt'])
export class ImagePrivateAsset extends VendureEntity {
    constructor(input?: DeepPartial<ImagePrivateAsset>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_image_private_asset_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @ManyToOne(() => Customer, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'customerId', foreignKeyConstraintName: 'FK_image_private_asset_customer' })
    customer: Customer;

    @EntityId()
    customerId: ID;

    @Column({ type: 'varchar', length: 16 })
    kind: string;

    @Column({ type: 'varchar', length: 255, unique: true })
    storageKey: string;

    @Column({ type: 'varchar', length: 80 })
    originalName: string;

    @Column({ type: 'varchar', length: 64 })
    mimeType: string;

    @Column('int')
    byteSize: number;

    @Column('int')
    width: number;

    @Column('int')
    height: number;

    @Column({ type: 'varchar', length: 64 })
    sha256: string;

    @Column({ type: Date })
    expiresAt: Date;

    @Column({ type: Date, nullable: true })
    deletedAt: Date | null;

    @Column({ type: 'simple-json', nullable: true })
    providerMetadata: Record<string, any> | null;
}
