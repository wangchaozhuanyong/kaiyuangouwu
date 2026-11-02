import { Channel, DeepPartial, EntityId, ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

/** Public discovery data only. Merchant configuration and articles remain Channel scoped. */
@Entity('news_blog_skill')
@Index('UQ_blog_skill_identity', ['identity'], { unique: true })
export class BlogSkill extends VendureEntity {
    constructor(input?: DeepPartial<BlogSkill>) {
        super(input);
    }
    @Column('varchar', { length: 64 }) identity: string;
    @Column('varchar', { length: 40 }) repositoryId: string;
    @Column('varchar', { length: 300 }) repository: string;
    @Column('varchar', { length: 1000 }) directory: string;
    @Column('varchar', { length: 100 }) name: string;
    @Column('varchar', { length: 64 }) contentHash: string;
    @Column('text') body: string;
    @Column('text') evidenceJson: string;
    @Column('varchar', { length: 24, default: 'READY' }) status: string;
    @Column('varchar', { length: 300, default: '' }) message: string;
    @Column({ type: Date }) checkedAt: Date;
}
@Entity('news_blog_skill_observation')
@Index('IDX_blog_skill_observed', ['identity', 'observedAt'])
export class BlogSkillObservation extends VendureEntity {
    constructor(input?: DeepPartial<BlogSkillObservation>) {
        super(input);
    }
    @Column('varchar', { length: 64 }) identity: string;
    @Column('int') stars: number;
    @Column('text') rankingJson: string;
    @Column({ type: Date }) observedAt: Date;
}
@Entity('news_blog_skill_state')
@Index('UQ_blog_skill_state', ['code'], { unique: true })
export class BlogSkillState extends VendureEntity {
    constructor(input?: DeepPartial<BlogSkillState>) {
        super(input);
    }
    @Column('varchar', { length: 32 }) code: string;
    @Column({ type: Date, nullable: true }) leaseUntil: Date | null;
    @Column({ type: Date, nullable: true }) lastCollectedAt: Date | null;
    @Column({ type: Date, nullable: true }) requestWindow: Date | null;
    @Column('int', { default: 0 }) requestCount: number;
    @Column('varchar', { length: 300, default: '' }) message: string;
}
@Entity('news_blog_skill_recommendation')
@Index('UQ_blog_skill_day', ['channelId', 'day'], { unique: true })
@Index('UQ_blog_skill_once', ['channelId', 'identity'], { unique: true })
export class BlogSkillRecommendation extends VendureEntity {
    constructor(input?: DeepPartial<BlogSkillRecommendation>) {
        super(input);
    }
    @ManyToOne(() => Channel, { onDelete: 'CASCADE', nullable: false })
    @JoinColumn({ name: 'channelId' })
    channel: Channel;
    @EntityId() channelId: ID;
    @Column('varchar', { length: 10 }) day: string;
    @Column('varchar', { length: 64 }) identity: string;
    @Column('varchar', { length: 40 }) repositoryId: string;
    @Column('varchar', { length: 24, default: 'SELECTED' }) status: string;
    @Column('varchar', { length: 300, default: '' }) message: string;
    @Column('varchar', { length: 40, nullable: true }) articleId: string | null;
    @Column('varchar', { length: 64 }) contentHash: string;
    @Column('text') evidenceJson: string;
}
export const skillEntities = [BlogSkill, BlogSkillObservation, BlogSkillState, BlogSkillRecommendation];
