import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { DEFAULT_HERO_AUTOPLAY_INTERVAL_SECONDS } from '../constants';

@Entity({ name: 'storefront_content_settings' })
@Index('IDX_storefront_content_settings_channel', ['channelId'], { unique: true })
export class StorefrontContentSettings extends VendureEntity {
    constructor(input?: DeepPartial<StorefrontContentSettings>) {
        super(input);
    }

    @Column({ type: 'int', default: DEFAULT_HERO_AUTOPLAY_INTERVAL_SECONDS })
    heroAutoplayIntervalSeconds: number;

    @ManyToOne(() => Channel, { onDelete: 'CASCADE', nullable: false })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_storefront_content_settings_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;
}
