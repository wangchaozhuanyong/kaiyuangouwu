import { Channel, DeepPartial, EntityId, ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { type StorefrontSeoTargetType } from './storefront-seo.contract';

@Entity({ name: 'storefront_seo_record' })
@Index('UQ_storefront_seo_identity', ['channelId', 'targetType', 'targetId', 'languageCode'], {
    unique: true,
})
export class StorefrontSeoRecord extends VendureEntity {
    constructor(input?: DeepPartial<StorefrontSeoRecord>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_storefront_seo_channel' })
    channel: Channel;
    @EntityId() channelId: ID;
    @Column('varchar', { length: 16 }) targetType: StorefrontSeoTargetType;
    @Column('varchar', { length: 160 }) targetId: string;
    @Column('varchar', { length: 16 }) languageCode: string;
    @Column('text') draftJson: string;
    @Column('text', { nullable: true }) publishedJson: string | null;
    @Column('int', { default: 1 }) version: number;
    @Column('int', { default: 0 }) publishedVersion: number;
    @Column({ type: Date, nullable: true }) publishedAt: Date | null;
    @Column('varchar', { length: 128, nullable: true }) publishedByUserId: string | null;
}

@Entity({ name: 'storefront_seo_revision' })
@Index('UQ_storefront_seo_revision', ['recordId', 'version'], { unique: true })
@Index('IDX_storefront_seo_revision_channel', ['channelId'])
export class StorefrontSeoRevision extends VendureEntity {
    constructor(input?: DeepPartial<StorefrontSeoRevision>) {
        super(input);
    }

    @ManyToOne(() => StorefrontSeoRecord, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'recordId', foreignKeyConstraintName: 'FK_storefront_seo_revision_record' })
    record: StorefrontSeoRecord;
    @EntityId() recordId: ID;
    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_storefront_seo_revision_channel' })
    channel: Channel;
    @EntityId() channelId: ID;
    @Column('int') version: number;
    @Column('text', { nullable: true }) payloadJson: string | null;
    @Column({ type: Date }) publishedAt: Date;
    @Column('varchar', { length: 128 }) publishedBy: string;
}
