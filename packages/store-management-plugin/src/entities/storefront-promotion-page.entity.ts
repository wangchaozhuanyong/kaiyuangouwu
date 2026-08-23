import { Channel, DeepPartial, EntityId, ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { StorefrontPromotionContentType } from '../types';

@Entity({ name: 'storefront_promotion_page' })
@Index('IDX_storefront_promotion_page_channel', ['channelId'], { unique: true })
export class StorefrontPromotionPage extends VendureEntity {
    constructor(input?: DeepPartial<StorefrontPromotionPage>) {
        super(input);
    }

    @ManyToOne(() => Channel, { onDelete: 'CASCADE', nullable: false })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_storefront_promotion_page_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @Column('varchar', { length: 16, default: 'HTML' })
    contentType: StorefrontPromotionContentType;

    @Column('text', { nullable: true })
    draftSource: string | null;

    @Column('varchar', { length: 16, default: 'HTML' })
    publishedContentType: StorefrontPromotionContentType;

    @Column('text', { nullable: true })
    publishedSource: string | null;

    @Column('boolean', { default: false })
    isCustomized: boolean;

    @Column('int', { default: 1 })
    defaultTemplateVersion: number;

    @Column('int', { default: 0 })
    publishedVersion: number;

    @Column({ type: Date, nullable: true })
    publishedAt: Date | null;
}
