import { Asset, Channel, DeepPartial, EntityId, ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { StoreActivationReadiness, StoreProfileStatus } from '../types';

@Entity({ name: 'store_profile' })
@Index('IDX_store_profile_channel', ['channelId'], { unique: true })
@Index('IDX_store_profile_public_order', ['status', 'isPublished', 'sortOrder'])
@Index('IDX_store_profile_logo_asset', ['logoAssetId'])
@Index('IDX_store_profile_logo_on_light_asset', ['logoOnLightAssetId'])
@Index('IDX_store_profile_logo_on_dark_asset', ['logoOnDarkAssetId'])
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

    @Column('text', { nullable: true })
    internalNote: string | null;

    @ManyToOne(() => Asset, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'logoAssetId', foreignKeyConstraintName: 'FK_store_profile_logo_asset' })
    logoAsset: Asset | null;

    @EntityId({ nullable: true })
    logoAssetId: ID | null;

    @ManyToOne(() => Asset, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({
        name: 'logoOnLightAssetId',
        foreignKeyConstraintName: 'FK_store_profile_logo_on_light_asset',
    })
    logoOnLightAsset: Asset | null;

    @EntityId({ nullable: true })
    logoOnLightAssetId: ID | null;

    @ManyToOne(() => Asset, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({
        name: 'logoOnDarkAssetId',
        foreignKeyConstraintName: 'FK_store_profile_logo_on_dark_asset',
    })
    logoOnDarkAsset: Asset | null;

    @EntityId({ nullable: true })
    logoOnDarkAssetId: ID | null;

    @Column('varchar', { length: 160, nullable: true })
    taglineZh: string | null;

    @Column('varchar', { length: 160, nullable: true })
    taglineEn: string | null;

    @Column('varchar', { length: 7, nullable: true })
    brandBackgroundColor: string | null;

    @Column('varchar', { length: 7, nullable: true })
    brandPrimaryColor: string | null;

    @Column('varchar', { length: 7, nullable: true })
    brandAccentColor: string | null;

    @Column('varchar', { length: 7, nullable: true })
    brandHighlightColor: string | null;

    @Column('varchar', { length: 200, nullable: true })
    legalEntityName: string | null;

    @Column('varchar', { length: 100, nullable: true })
    legalRegistrationCountry: string | null;

    @Column('varchar', { length: 254, nullable: true })
    supportEmail: string | null;

    @Column('varchar', { length: 254, nullable: true })
    privacyEmail: string | null;

    primaryDomain?: string | null;

    storefrontUrl?: string | null;

    activationReadiness?: StoreActivationReadiness;

    isOperational?: boolean;
}
