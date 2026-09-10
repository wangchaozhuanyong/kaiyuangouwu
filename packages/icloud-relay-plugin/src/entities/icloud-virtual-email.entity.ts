import { DeepPartial, EntityId, ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';

import { IcloudVirtualEmailStatus } from '../types';

import { IcloudPrimaryAccount } from './icloud-primary-account.entity';
import { IcloudReceivedMail } from './icloud-received-mail.entity';

@Entity({ name: 'icloud_virtual_email' })
@Index('IDX_icloud_virtual_account_alias', ['primaryAccountId', 'aliasEmail'], { unique: true })
export class IcloudVirtualEmail extends VendureEntity {
    constructor(input?: DeepPartial<IcloudVirtualEmail>) {
        super(input);
    }

    @EntityId()
    primaryAccountId: ID;

    @ManyToOne(() => IcloudPrimaryAccount, account => account.virtualEmails, {
        onDelete: 'CASCADE',
        nullable: false,
    })
    @JoinColumn({
        name: 'primaryAccountId',
        foreignKeyConstraintName: 'FK_icloud_virtual_primary_account',
    })
    primaryAccount: IcloudPrimaryAccount;

    @Column({ type: 'varchar', length: 255, unique: true })
    @Index('IDX_icloud_virtual_email_alias')
    aliasEmail: string;

    @Column({ type: 'text', nullable: true })
    note: string | null;

    @Column({
        type: 'varchar',
        length: 32,
        default: IcloudVirtualEmailStatus.ACTIVE,
    })
    status: IcloudVirtualEmailStatus;

    /**
     * Unique query code distributed to the buyer/customer
     */
    @Column({ type: 'varchar', length: 64, unique: true })
    @Index('IDX_icloud_buyer_query_code')
    buyerQueryCode: string;

    @Column({ type: Date, nullable: true })
    codeExpiresAt: Date | null;

    /**
     * Automatic rotation period in days. 0 = no automatic rotation.
     */
    @Column({ type: 'int', default: 30 })
    codeResetIntervalDays: number;

    @Column({ type: Date, nullable: true })
    lastQueriedAt: Date | null;

    @Column({ type: 'varchar', length: 64, nullable: true })
    lastQueriedIp: string | null;

    @Column({ type: 'int', default: 0 })
    mailCount: number;

    @Column({ type: Date, nullable: true })
    lastMailReceivedAt: Date | null;

    @OneToMany(() => IcloudReceivedMail, mail => mail.virtualEmail)
    receivedMails: IcloudReceivedMail[];
}
