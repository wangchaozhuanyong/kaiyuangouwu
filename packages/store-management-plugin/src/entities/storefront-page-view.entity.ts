import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

@Entity({ name: 'storefront_page_view' })
@Index('IDX_storefront_page_view_event', ['channelId', 'eventId'], { unique: true })
@Index('IDX_storefront_page_view_day', ['channelId', 'businessDate', 'visitorKeyHash'])
export class StorefrontPageView extends VendureEntity {
    constructor(input?: DeepPartial<StorefrontPageView>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_storefront_page_view_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @Column({ type: 'varchar', length: 10 })
    businessDate: string;

    @Column({ type: 'varchar', length: 36 })
    eventId: string;

    @Column({ type: 'varchar', length: 64 })
    visitorKeyHash: string;

    @Column({ type: 'varchar', length: 64, nullable: true })
    customerKeyHash: string | null;

    @Column({ type: 'varchar', length: 64, nullable: true })
    ipHash: string | null;

    /** Stable, pseudonymous key used only to freeze last-non-direct order attribution. */
    @Column({ type: 'varchar', length: 64, nullable: true })
    attributionKeyHash: string | null;

    @Column({ type: 'varchar', length: 512, nullable: true })
    path: string | null;

    @Column({ type: 'varchar', length: 255, nullable: true })
    referrerHost: string | null;

    @Column({ type: 'varchar', length: 100, nullable: true })
    source: string | null;

    @Column({ type: 'varchar', length: 100, nullable: true })
    medium: string | null;

    @Column({ type: 'varchar', length: 160, nullable: true })
    campaign: string | null;

    @Column({ type: 'varchar', length: 160, nullable: true })
    term: string | null;

    @Column({ type: 'varchar', length: 160, nullable: true })
    content: string | null;
}
