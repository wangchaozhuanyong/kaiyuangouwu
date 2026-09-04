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

    @Column({ type: 'varchar', length: 80, default: 'AI 工具一站式服务' })
    titleZh: string;

    @Column({ type: 'varchar', length: 80, default: 'One-stop AI service' })
    titleEn: string;

    @Column({ type: 'varchar', length: 180, default: '热门 AI 工具\n一站轻松获取' })
    headlineZh: string;

    @Column({ type: 'varchar', length: 180, default: 'Popular AI tools\nmade easy' })
    headlineEn: string;

    @Column({ type: 'varchar', length: 220, default: '好友成功消费，可获得 {rewardRate}% 奖励用于消费抵扣' })
    rewardTextZh: string;

    @Column({
        type: 'varchar',
        length: 220,
        default: 'Earn {rewardRate}% in rewards when a friend makes a purchase',
    })
    rewardTextEn: string;

    @Column({
        type: 'varchar',
        length: 260,
        default: 'ChatGPT、Claude、Gemini、Codex 等\n热门 AI 服务，一个网站轻松了解与选择',
    })
    siteIntroZh: string;

    @Column({
        type: 'varchar',
        length: 260,
        default: 'ChatGPT, Claude, Gemini, Codex and more\nExplore practical AI services in one place',
    })
    siteIntroEn: string;

    @Column({ type: 'varchar', length: 260, default: '好物严选 · 便捷消费 · 售后服务' })
    serviceTextZh: string;

    @Column({ type: 'varchar', length: 260, default: 'Curated products · Easy shopping · Customer support' })
    serviceTextEn: string;

    @Column({ type: 'varchar', length: 100, default: '热门工具汇集' })
    featureOneTitleZh: string;

    @Column({ type: 'varchar', length: 100, default: '精选 AI tools' })
    featureOneTitleEn: string;

    @Column({ type: 'varchar', length: 160, default: '多种 AI 工具任你选' })
    featureOneTextZh: string;

    @Column({ type: 'varchar', length: 160, default: 'A curated set of AI tools' })
    featureOneTextEn: string;

    @Column({ type: 'varchar', length: 100, default: '便捷开通服务' })
    featureTwoTitleZh: string;

    @Column({ type: 'varchar', length: 100, default: 'Fast activation' })
    featureTwoTitleEn: string;

    @Column({ type: 'varchar', length: 160, default: '快速开通 省时省心' })
    featureTwoTextZh: string;

    @Column({ type: 'varchar', length: 160, default: 'Get started in a few clicks' })
    featureTwoTextEn: string;

    @Column({ type: 'varchar', length: 100, default: '专属售后支持' })
    featureThreeTitleZh: string;

    @Column({ type: 'varchar', length: 100, default: 'Dedicated support' })
    featureThreeTitleEn: string;

    @Column({ type: 'varchar', length: 160, default: '专业客服 贴心服务' })
    featureThreeTextZh: string;

    @Column({ type: 'varchar', length: 160, default: 'Friendly help when you need it' })
    featureThreeTextEn: string;

    @Column({ type: 'varchar', length: 100, default: '扫码访问 AwanMesh 模钥' })
    qrEyebrowZh: string;

    @Column({ type: 'varchar', length: 100, default: 'Scan AwanMesh' })
    qrEyebrowEn: string;

    @Column({ type: 'varchar', length: 140, default: '发现更多实用 AI 服务' })
    qrTitleZh: string;

    @Column({ type: 'varchar', length: 140, default: 'Discover practical AI services' })
    qrTitleEn: string;

    @Column({ type: 'varchar', length: 140, default: '满足多种 AI 使用场景' })
    qrDescriptionZh: string;

    @Column({ type: 'varchar', length: 140, default: 'Tools for work, creativity, learning and code' })
    qrDescriptionEn: string;

    @Column({ type: 'varchar', length: 48, default: '办公提效' })
    sceneOneZh: string;

    @Column({ type: 'varchar', length: 48, default: 'Work' })
    sceneOneEn: string;

    @Column({ type: 'varchar', length: 48, default: '内容创作' })
    sceneTwoZh: string;

    @Column({ type: 'varchar', length: 48, default: 'Create' })
    sceneTwoEn: string;

    @Column({ type: 'varchar', length: 48, default: '学习辅助' })
    sceneThreeZh: string;

    @Column({ type: 'varchar', length: 48, default: 'Learn' })
    sceneThreeEn: string;

    @Column({ type: 'varchar', length: 48, default: '智能编程' })
    sceneFourZh: string;

    @Column({ type: 'varchar', length: 48, default: 'Code' })
    sceneFourEn: string;

    @Column({ type: 'varchar', length: 140, default: '长按识别二维码，立即进入 AwanMesh 模钥' })
    ctaTextZh: string;

    @Column({ type: 'varchar', length: 140, default: 'Press and hold to enter AwanMesh' })
    ctaTextEn: string;

    @Column({ type: 'varchar', length: 160, default: '让好用的 AI，真正为你所用' })
    footerTitleZh: string;

    @Column({ type: 'varchar', length: 160, default: 'AI that works for you' })
    footerTitleEn: string;

    @Column({ type: 'varchar', length: 220, default: '热门 AI 工具与数字服务一站式平台' })
    footerTextZh: string;

    @Column({ type: 'varchar', length: 220, default: 'One-stop platform for AI tools and digital services' })
    footerTextEn: string;

    @Column({ type: 'varchar', length: 16, default: '#0E2A63' })
    foregroundColor: string;

    @Column({ type: 'varchar', length: 16, default: '#1269E8' })
    accentColor: string;

    @Column('int', { default: 0 })
    overlayOpacity: number;
}
