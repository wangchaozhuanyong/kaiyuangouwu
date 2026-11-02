import { Channel, DeepPartial, EntityId, ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { skillEntities } from './skill-entities';

abstract class ChannelRecord extends VendureEntity {
    @ManyToOne(() => Channel, { onDelete: 'CASCADE', nullable: false })
    @JoinColumn({ name: 'channelId' })
    channel: Channel;
    abstract channelId: ID;
}
@Entity('news_blog_settings')
@Index('UQ_news_blog_settings_channel', ['channelId'], { unique: true })
export class BlogSettings extends ChannelRecord {
    // Vendure registers EntityId columns on the concrete entity constructor.
    @EntityId() channelId: ID;
    constructor(input?: DeepPartial<BlogSettings>) {
        super(input);
    }
    @Column('int', { default: 1 }) version: number;
    @Column('boolean', { default: false }) enabled: boolean;
    @Column('boolean', { default: false }) automationEnabled: boolean;
    @Column('int', { default: 30 }) intervalMinutes: number;
    @Column('int', { default: 3 }) dailyMaxArticles: number;
    @Column('text') settingsJson: string;
    @Column({ type: Date, nullable: true }) lastCollectedAt: Date | null;
    @Column({ type: Date, nullable: true }) leaseUntil: Date | null;
}
@Entity('news_blog_article')
@Index('UQ_news_blog_article_slug', ['channelId', 'slug'], { unique: true })
@Index('UQ_news_blog_article_event', ['channelId', 'eventKey'], { unique: true })
@Index('IDX_news_blog_published', ['channelId', 'publishedAt'])
export class BlogArticle extends ChannelRecord {
    // Vendure registers EntityId columns on the concrete entity constructor.
    @EntityId() channelId: ID;
    constructor(input?: DeepPartial<BlogArticle>) {
        super(input);
    }
    @Column('varchar', { length: 100 }) slug: string;
    @Column('varchar', { length: 64, nullable: true }) eventKey: string | null;
    @Column('int', { default: 1 }) version: number;
    @Column('varchar', { length: 24, default: 'DRAFT' }) state: string;
    @Column('text') draftJson: string;
    @Column('text', { nullable: true }) publishedJson: string | null;
    @Column({ type: Date, nullable: true }) publishedAt: Date | null;
    @Column('text') issuesJson: string;
    @Column('varchar', { length: 160, default: '' }) publishedTitle: string;
    @Column('varchar', { length: 24, default: '' }) publishedCategory: string;
    @Column('text', { nullable: true }) publishedSearchText: string | null;
    @Column('boolean', { default: false }) publishedPinned: boolean;
}
@Entity('news_blog_revision')
@Index('UQ_news_blog_revision', ['channelId', 'articleId', 'version'], { unique: true })
export class BlogRevision extends ChannelRecord {
    // Vendure registers EntityId columns on the concrete entity constructor.
    @EntityId() channelId: ID;
    constructor(input?: DeepPartial<BlogRevision>) {
        super(input);
    }
    @Column('int') articleId: number;
    @Column('int') version: number;
    @Column('varchar', { length: 24 }) action: string;
    @Column('varchar', { length: 128 }) actorId: string;
    @Column('text', { nullable: true }) snapshotJson: string | null;
}
@Entity('news_blog_source')
@Index('UQ_news_blog_source', ['channelId', 'code'], { unique: true })
export class BlogSource extends ChannelRecord {
    // Vendure registers EntityId columns on the concrete entity constructor.
    @EntityId() channelId: ID;
    constructor(input?: DeepPartial<BlogSource>) {
        super(input);
    }
    @Column('varchar', { length: 40 }) code: string;
    @Column('boolean', { default: true }) enabled: boolean;
    @Column('int', { default: 1 }) version: number;
    @Column({ type: Date, nullable: true }) lastCollectedAt: Date | null;
    @Column('varchar', { length: 40, default: 'NOT_COLLECTED' }) status: string;
    @Column('varchar', { length: 300, default: '' }) message: string;
    @Column('varchar', { length: 512, nullable: true }) etag: string | null;
    @Column('varchar', { length: 128, nullable: true }) lastModified: string | null;
}
@Entity('news_blog_source_item')
@Index('UQ_news_blog_source_item', ['channelId', 'identityKey'], { unique: true })
@Index('IDX_news_blog_source_event', ['channelId', 'eventKey'])
export class BlogSourceItem extends ChannelRecord {
    // Vendure registers EntityId columns on the concrete entity constructor.
    @EntityId() channelId: ID;
    constructor(input?: DeepPartial<BlogSourceItem>) {
        super(input);
    }
    @Column('varchar', { length: 40 }) sourceCode: string;
    @Column('varchar', { length: 64 }) identityKey: string;
    @Column('varchar', { length: 64 }) contentHash: string;
    @Column('varchar', { length: 64 }) eventKey: string;
    @Column('varchar', { length: 2048 }) url: string;
    @Column('varchar', { length: 500 }) title: string;
    @Column('varchar', { length: 24 }) category: string;
    @Column('text') body: string;
    @Column('text', { nullable: true }) metadataJson: string | null;
    @Column({ type: Date }) sourcePublishedAt: Date;
    @Column({ type: Date }) fetchedAt: Date;
    @Column('varchar', { length: 24, default: 'READY' }) status: string;
}
@Entity('news_blog_run')
@Index('UQ_news_blog_run_key', ['channelId', 'requestKey'], { unique: true })
@Index('IDX_news_blog_run_budget', ['channelId', 'budgetDate'])
export class BlogRun extends ChannelRecord {
    // Vendure registers EntityId columns on the concrete entity constructor.
    @EntityId() channelId: ID;
    constructor(input?: DeepPartial<BlogRun>) {
        super(input);
    }
    @Column('varchar', { length: 160 }) requestKey: string;
    @Column('varchar', { length: 24 }) kind: string;
    @Column('varchar', { length: 24, default: 'QUEUED' }) state: string;
    @Column('varchar', { length: 10 }) budgetDate: string;
    @Column('int', { default: 0 }) reservedMicros: number;
    @Column('int', { default: 0 }) chargedMicros: number;
    @Column('text') inputJson: string;
    @Column('text', { nullable: true }) telemetryJson: string | null;
    @Column('varchar', { length: 500, default: '' }) message: string;
    @Column({ type: Date, nullable: true }) startedAt: Date | null;
    @Column({ type: Date, nullable: true }) completedAt: Date | null;
}
export const blogEntities = [
    BlogSettings,
    BlogArticle,
    BlogRevision,
    BlogSource,
    BlogSourceItem,
    BlogRun,
    ...skillEntities,
];
