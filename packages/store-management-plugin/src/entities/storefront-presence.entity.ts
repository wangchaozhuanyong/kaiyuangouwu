import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity('storefront_presence')
@Index('IDX_storefront_presence_identity', ['channelId', 'visitorKeyHash'], { unique: true })
@Index('IDX_storefront_presence_active', ['channelId', 'lastSeenAt'])
export class StorefrontPresence extends VendureEntity {
    constructor(input?: DeepPartial<StorefrontPresence>) {
        super(input);
    }
    @EntityId() channelId: ID;
    @Column({ type: 'varchar', length: 64 }) visitorKeyHash: string;
    @Column({ type: 'varchar', length: 64, nullable: true }) customerKeyHash: string | null;
    @Column({ type: Date }) lastSeenAt: Date;
}

@Entity('storefront_presence_status')
@Index('IDX_storefront_presence_status_channel', ['channelId'], { unique: true })
export class StorefrontPresenceStatus extends VendureEntity {
    constructor(input?: DeepPartial<StorefrontPresenceStatus>) {
        super(input);
    }
    @EntityId() channelId: ID;
    @Column({ type: Date }) firstSeenAt: Date;
}
