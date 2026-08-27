import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Asset, Channel, EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

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

    @Column({ type: 'varchar', length: 80, default: '好友邀请函' })
    titleZh: string;

    @Column({ type: 'varchar', length: 80, default: 'Invitation for friends' })
    titleEn: string;

    @Column({ type: 'varchar', length: 180, default: '发现好东西，一起分享' })
    headlineZh: string;

    @Column({ type: 'varchar', length: 180, default: 'Discover something worth sharing' })
    headlineEn: string;

    @Column({ type: 'varchar', length: 220, default: '好友成功消费，可获得 {rewardRate}% 奖励用于消费抵扣' })
    rewardTextZh: string;

    @Column({
        type: 'varchar',
        length: 220,
        default: 'Earn {rewardRate}% in rewards when a friend makes a purchase',
    })
    rewardTextEn: string;

    @Column({ type: 'varchar', length: 260, default: '' })
    siteIntroZh: string;

    @Column({ type: 'varchar', length: 260, default: '' })
    siteIntroEn: string;

    @Column({ type: 'varchar', length: 260, default: '好物严选 · 便捷消费 · 售后服务' })
    serviceTextZh: string;

    @Column({ type: 'varchar', length: 260, default: 'Curated products · Easy shopping · Customer support' })
    serviceTextEn: string;

    @Column({ type: 'varchar', length: 16, default: '#FFFFFF' })
    foregroundColor: string;

    @Column({ type: 'varchar', length: 16, default: '#FF4D4F' })
    accentColor: string;

    @Column('int', { default: 28 })
    overlayOpacity: number;
}
