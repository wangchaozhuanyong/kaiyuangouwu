import { DeepPartial, EntityId, ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { IcloudPrimaryAccount } from './icloud-primary-account.entity';
import { IcloudVirtualEmail } from './icloud-virtual-email.entity';

@Entity({ name: 'icloud_received_mail' })
@Index('IDX_icloud_mail_account_msgid', ['primaryAccountId', 'messageId'], { unique: true })
@Index('IDX_icloud_mail_virtual_received', ['virtualEmailId', 'receivedAt'])
export class IcloudReceivedMail extends VendureEntity {
    constructor(input?: DeepPartial<IcloudReceivedMail>) {
        super(input);
    }

    @EntityId()
    primaryAccountId: ID;

    @ManyToOne(() => IcloudPrimaryAccount, account => account.receivedMails, {
        onDelete: 'CASCADE',
        nullable: false,
    })
    @JoinColumn({
        name: 'primaryAccountId',
        foreignKeyConstraintName: 'FK_icloud_mail_primary_account',
    })
    primaryAccount: IcloudPrimaryAccount;

    @EntityId({ nullable: true })
    // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
    virtualEmailId: ID | null;

    @ManyToOne(() => IcloudVirtualEmail, virtual => virtual.receivedMails, {
        onDelete: 'SET NULL',
        nullable: true,
    })
    @JoinColumn({
        name: 'virtualEmailId',
        foreignKeyConstraintName: 'FK_icloud_mail_virtual_email',
    })
    virtualEmail: IcloudVirtualEmail | null;

    @Column({ type: 'varchar', length: 255 })
    messageId: string;

    @Column({ type: 'int', default: 0 })
    imapUid: number;

    @Column({ type: 'varchar', length: 255 })
    fromAddress: string;

    @Column({ type: 'varchar', length: 255, default: '' })
    fromName: string;

    @Column({ type: 'text', nullable: true })
    toAddressesJson: string | null;

    @Column({ type: 'varchar', length: 500, default: '(No Subject)' })
    subject: string;

    @Column({ type: 'text', nullable: true })
    bodyHtml: string | null;

    @Column({ type: 'text', nullable: true })
    bodyText: string | null;

    @Column({ type: 'varchar', length: 64, nullable: true })
    @Index('IDX_icloud_mail_extracted_code')
    extractedCode: string | null;

    @Column({ type: Date })
    receivedAt: Date;

    @Column({ type: 'boolean', default: false })
    isRead: boolean;

    @Column({ type: 'boolean', default: false })
    isStarred: boolean;
}
