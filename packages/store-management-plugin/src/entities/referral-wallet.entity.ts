import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, Customer, EntityId, Money, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne, VersionColumn } from 'typeorm';

import { ReferralAccount } from './referral-account.entity';

@Entity({ name: 'referral_wallet' })
@Index('IDX_referral_wallet_account_currency', ['referralAccountId', 'currencyCode'], { unique: true })
@Index('IDX_referral_wallet_channel_customer', ['channelId', 'customerId'])
export class ReferralWallet extends VendureEntity {
    constructor(input?: DeepPartial<ReferralWallet>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_referral_wallet_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @ManyToOne(() => ReferralAccount, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'referralAccountId', foreignKeyConstraintName: 'FK_referral_wallet_account' })
    referralAccount: ReferralAccount;

    @EntityId()
    referralAccountId: ID;

    @ManyToOne(() => Customer, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'customerId', foreignKeyConstraintName: 'FK_referral_wallet_customer' })
    customer: Customer;

    @EntityId()
    customerId: ID;

    @Column({ type: 'varchar', length: 3 })
    currencyCode: CurrencyCode;

    @Money({ default: 0 })
    availableBalance: number;

    @Money({ default: 0 })
    pendingBalance: number;

    @Money({ default: 0 })
    reservedBalance: number;

    @VersionColumn()
    version: number;
}
