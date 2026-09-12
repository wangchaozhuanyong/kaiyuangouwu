import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, OneToMany } from 'typeorm';

import { IcloudAccountStatus } from '../types';

import { IcloudReceivedMail } from './icloud-received-mail.entity';
import { IcloudVirtualEmail } from './icloud-virtual-email.entity';

@Entity({ name: 'icloud_primary_account' })
export class IcloudPrimaryAccount extends VendureEntity {
    constructor(input?: DeepPartial<IcloudPrimaryAccount>) {
        super(input);
    }

    @Column({ type: 'varchar', length: 255, unique: true })
    email: string;

    /**
     * Encrypted app-specific password (AES-256-GCM)
     */
    @Column({ type: 'text' })
    encryptedAppPassword: string;

    @Column({ type: 'varchar', length: 255, default: 'imap.mail.me.com' })
    imapHost: string;

    @Column({ type: 'int', default: 993 })
    imapPort: number;

    @Column({ type: 'text', nullable: true })
    note: string | null;

    @Column({
        type: 'varchar',
        length: 32,
        default: IcloudAccountStatus.ACTIVE,
    })
    status: IcloudAccountStatus;

    /**
     * Master access code for querying all emails under this primary account
     */
    @Column({ type: 'varchar', length: 64, unique: true, nullable: true })
    @Index('IDX_icloud_master_query_code')
    masterQueryCode: string | null;

    @Column({ type: Date, nullable: true })
    codeExpiresAt: Date | null;

    /**
     * Interval in days for automatic code rotation. 0 = no automatic rotation.
     */
    @Column({ type: 'int', default: 30 })
    codeResetIntervalDays: number;

    @Column({ type: Date, nullable: true })
    lastQueriedAt: Date | null;

    @Column({ type: 'varchar', length: 64, nullable: true })
    lastQueriedIp: string | null;

    @Column({ type: Date, nullable: true })
    lastSyncedAt: Date | null;

    @Column({ type: 'int', default: 0 })
    lastSyncedUid: number;

    @Column({ type: 'text', nullable: true })
    lastSyncError: string | null;

    @OneToMany(() => IcloudVirtualEmail, virtual => virtual.primaryAccount)
    virtualEmails: IcloudVirtualEmail[];

    @OneToMany(() => IcloudReceivedMail, mail => mail.primaryAccount)
    receivedMails: IcloudReceivedMail[];
}
