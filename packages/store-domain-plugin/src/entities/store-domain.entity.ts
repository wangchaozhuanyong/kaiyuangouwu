import { Channel, DeepPartial, EntityId, ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

import { StoreDomainProvisioningMode, StoreDomainStatus } from '../types';

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

    @Column('varchar', { length: 24, default: 'MANUAL' })
    provisioningMode: StoreDomainProvisioningMode;

    @Column('boolean', { default: false })
    dnsManaged: boolean;

    @Column('varchar', { length: 64, nullable: true })
    providerExternalId: string | null;

    @Column('varchar', { length: 40, nullable: true })
    providerHostnameStatus: string | null;

    @Column('varchar', { length: 40, nullable: true })
    providerSslStatus: string | null;

    @Column({ type: Date, nullable: true })
    lastProvisionedAt: Date | null;
}
