import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Asset, Channel, EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { referralPosterCopy } from '../referral/referral-poster-presets';

@Entity({ name: 'referral_poster_template' })
@Index('IDX_referral_poster_template_channel_position', ['channelId', 'position'])
export class ReferralPosterTemplate extends VendureEntity {
    constructor(input?: DeepPartial<ReferralPosterTemplate>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_referral_poster_template_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @Column({ type: 'varchar', length: 128 })
    name: string;

    @Column('boolean', { default: true })
    enabled: boolean;

    @Column('int', { default: 0 })
    position: number;

    @Column({ type: 'varchar', length: 32, default: 'STANDARD_CENTER' })
    layoutVariant: string;

    @ManyToOne(() => Asset, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({
        name: 'posterBackgroundAssetId',
        foreignKeyConstraintName: 'FK_referral_poster_template_poster_asset',
    })
    posterBackgroundAsset: Asset | null;

    @EntityId({ nullable: true })
    posterBackgroundAssetId: ID | null;

    @ManyToOne(() => Asset, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({
        name: 'shareBackgroundAssetId',
        foreignKeyConstraintName: 'FK_referral_poster_template_share_asset',
    })
    shareBackgroundAsset: Asset | null;

    @EntityId({ nullable: true })
    shareBackgroundAssetId: ID | null;

    @Column({ type: 'varchar', length: 80, default: referralPosterCopy.titleZh })
    titleZh: string;

    @Column({ type: 'varchar', length: 80, default: referralPosterCopy.titleEn })
    titleEn: string;

    @Column({ type: 'varchar', length: 180, default: referralPosterCopy.headlineZh })
    headlineZh: string;

    @Column({ type: 'varchar', length: 180, default: referralPosterCopy.headlineEn })
    headlineEn: string;

    @Column({ type: 'varchar', length: 220, default: referralPosterCopy.rewardTextZh })
    rewardTextZh: string;

    @Column({
        type: 'varchar',
        length: 220,
        default: referralPosterCopy.rewardTextEn,
    })
    rewardTextEn: string;

    @Column({
        type: 'varchar',
        length: 260,
        default: referralPosterCopy.siteIntroZh,
    })
    siteIntroZh: string;

    @Column({
        type: 'varchar',
        length: 260,
        default: referralPosterCopy.siteIntroEn,
    })
    siteIntroEn: string;

    @Column({ type: 'varchar', length: 260, default: referralPosterCopy.serviceTextZh })
    serviceTextZh: string;

    @Column({ type: 'varchar', length: 260, default: referralPosterCopy.serviceTextEn })
    serviceTextEn: string;

    @Column({ type: 'varchar', length: 100, default: referralPosterCopy.featureOneTitleZh })
    featureOneTitleZh: string;

    @Column({ type: 'varchar', length: 100, default: referralPosterCopy.featureOneTitleEn })
    featureOneTitleEn: string;

    @Column({ type: 'varchar', length: 160, default: referralPosterCopy.featureOneTextZh })
    featureOneTextZh: string;

    @Column({ type: 'varchar', length: 160, default: referralPosterCopy.featureOneTextEn })
    featureOneTextEn: string;

    @Column({ type: 'varchar', length: 100, default: referralPosterCopy.featureTwoTitleZh })
    featureTwoTitleZh: string;

    @Column({ type: 'varchar', length: 100, default: referralPosterCopy.featureTwoTitleEn })
    featureTwoTitleEn: string;

    @Column({ type: 'varchar', length: 160, default: referralPosterCopy.featureTwoTextZh })
    featureTwoTextZh: string;

    @Column({ type: 'varchar', length: 160, default: referralPosterCopy.featureTwoTextEn })
    featureTwoTextEn: string;

    @Column({ type: 'varchar', length: 100, default: referralPosterCopy.featureThreeTitleZh })
    featureThreeTitleZh: string;

    @Column({ type: 'varchar', length: 100, default: referralPosterCopy.featureThreeTitleEn })
    featureThreeTitleEn: string;

    @Column({ type: 'varchar', length: 160, default: referralPosterCopy.featureThreeTextZh })
    featureThreeTextZh: string;

    @Column({ type: 'varchar', length: 160, default: referralPosterCopy.featureThreeTextEn })
    featureThreeTextEn: string;

    @Column({ type: 'varchar', length: 100, default: referralPosterCopy.qrEyebrowZh })
    qrEyebrowZh: string;

    @Column({ type: 'varchar', length: 100, default: referralPosterCopy.qrEyebrowEn })
    qrEyebrowEn: string;

    @Column({ type: 'varchar', length: 140, default: referralPosterCopy.qrTitleZh })
    qrTitleZh: string;

    @Column({ type: 'varchar', length: 140, default: referralPosterCopy.qrTitleEn })
    qrTitleEn: string;

    @Column({ type: 'varchar', length: 140, default: referralPosterCopy.qrDescriptionZh })
    qrDescriptionZh: string;

    @Column({ type: 'varchar', length: 140, default: referralPosterCopy.qrDescriptionEn })
    qrDescriptionEn: string;

    @Column({ type: 'varchar', length: 48, default: referralPosterCopy.sceneOneZh })
    sceneOneZh: string;

    @Column({ type: 'varchar', length: 48, default: referralPosterCopy.sceneOneEn })
    sceneOneEn: string;

    @Column({ type: 'varchar', length: 48, default: referralPosterCopy.sceneTwoZh })
    sceneTwoZh: string;

    @Column({ type: 'varchar', length: 48, default: referralPosterCopy.sceneTwoEn })
    sceneTwoEn: string;

    @Column({ type: 'varchar', length: 48, default: referralPosterCopy.sceneThreeZh })
    sceneThreeZh: string;

    @Column({ type: 'varchar', length: 48, default: referralPosterCopy.sceneThreeEn })
    sceneThreeEn: string;

    @Column({ type: 'varchar', length: 48, default: referralPosterCopy.sceneFourZh })
    sceneFourZh: string;

    @Column({ type: 'varchar', length: 48, default: referralPosterCopy.sceneFourEn })
    sceneFourEn: string;

    @Column({ type: 'varchar', length: 140, default: referralPosterCopy.ctaTextZh })
    ctaTextZh: string;

    @Column({ type: 'varchar', length: 140, default: referralPosterCopy.ctaTextEn })
    ctaTextEn: string;

    @Column({ type: 'varchar', length: 160, default: referralPosterCopy.footerTitleZh })
    footerTitleZh: string;

    @Column({ type: 'varchar', length: 160, default: referralPosterCopy.footerTitleEn })
    footerTitleEn: string;

    @Column({ type: 'varchar', length: 220, default: referralPosterCopy.footerTextZh })
    footerTextZh: string;

    @Column({ type: 'varchar', length: 220, default: referralPosterCopy.footerTextEn })
    footerTextEn: string;

    @Column({ type: 'varchar', length: 16, default: '#0E2A63' })
    foregroundColor: string;

    @Column({ type: 'varchar', length: 16, default: '#1269E8' })
    accentColor: string;

    @Column('int', { default: 0 })
    overlayOpacity: number;
}
