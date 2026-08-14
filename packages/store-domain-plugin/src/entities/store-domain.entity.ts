import { Channel, DeepPartial, EntityId, ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

import { StoreDomainStatus } from '../types';

@Entity()
export class StoreDomain extends VendureEntity {
    constructor(input?: DeepPartial<StoreDomain>) {
        super(input);
    }

    @Index({ unique: true })
    @Column('varchar', { length: 253 })
    domain: string;

    @Index()
    @ManyToOne(() => Channel, { onDelete: 'CASCADE' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @Column('boolean', { default: false })
    isPrimary: boolean;

    /** Nullable unique slot: non-primary rows are null, while the primary row stores its channel ID. */
    @Index({ unique: true })
    @EntityId({ nullable: true })
    primaryChannelId: ID | null;

    @Column('varchar', { length: 20, default: 'PENDING' })
    status: StoreDomainStatus;

    @Index({ unique: true })
    @Column('varchar', { length: 64 })
    verificationToken: string;

    @Column({ type: Date, nullable: true })
    verifiedAt: Date | null;

    @Column('text', { nullable: true })
    lastVerificationError: string | null;
}
