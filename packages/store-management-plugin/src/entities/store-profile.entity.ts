import { Asset, Channel, DeepPartial, EntityId, ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { StoreProfileStatus } from '../types';

@Entity({ name: 'store_profile' })
@Index('IDX_store_profile_channel', ['channelId'], { unique: true })
@Index('IDX_store_profile_public_order', ['status', 'isPublished', 'sortOrder'])
@Index('IDX_store_profile_logo_asset', ['logoAssetId'])
export class StoreProfile extends VendureEntity {
    constructor(input?: DeepPartial<StoreProfile>) {
        super(input);
    }

    @ManyToOne(() => Channel, { onDelete: 'CASCADE', nullable: false })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_store_profile_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @Column('varchar', { length: 20, default: 'DRAFT' })
    status: StoreProfileStatus;

    @Column('boolean', { default: false })
    isPublished: boolean;

    @Column('integer', { default: 0 })
    sortOrder: number;

    @Column('text')
    descriptionZh: string;

    @Column('text')
    descriptionEn: string;

    @ManyToOne(() => Asset, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'logoAssetId', foreignKeyConstraintName: 'FK_store_profile_logo_asset' })
    logoAsset: Asset | null;

    @EntityId({ nullable: true })
    logoAssetId: ID | null;

    primaryDomain?: string | null;

    storefrontUrl?: string | null;
}
