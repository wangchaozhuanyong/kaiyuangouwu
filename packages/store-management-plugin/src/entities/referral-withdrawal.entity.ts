import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, Customer, EntityId, Money, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { ReferralWallet } from './referral-wallet.entity';

@Entity({ name: 'referral_withdrawal' })
@Index('IDX_referral_withdrawal_code', ['code'], { unique: true })
@Index('IDX_referral_withdrawal_channel_status_created', ['channelId', 'status', 'createdAt'])
export class ReferralWithdrawal extends VendureEntity {
    constructor(input?: DeepPartial<ReferralWithdrawal>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_referral_withdrawal_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @ManyToOne(() => ReferralWallet, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'walletId', foreignKeyConstraintName: 'FK_referral_withdrawal_wallet' })
    wallet: ReferralWallet;

    @EntityId()
    walletId: ID;

    @ManyToOne(() => Customer, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'customerId', foreignKeyConstraintName: 'FK_referral_withdrawal_customer' })
    customer: Customer;

    @EntityId()
    customerId: ID;

    @Column({ type: 'varchar', length: 32 })
    code: string;

    @Column({ type: 'varchar', length: 3 })
    currencyCode: CurrencyCode;

    @Money()
    amount: number;

    @Column({ type: 'varchar', length: 24, default: 'PENDING' })
    status: string;

    @Column({ type: 'varchar', length: 32 })
    payoutMethod: string;

    @Column({ type: 'varchar', length: 160 })
    payoutAccountMasked: string;

    @Column({ type: 'varchar', length: 160, nullable: true })
    externalReference: string | null;

    @Column({ type: 'varchar', length: 500, nullable: true })
    note: string | null;

    @EntityId({ nullable: true })
    requestedByAdministratorId: ID | null;

    @EntityId({ nullable: true })
    processedByAdministratorId: ID | null;

    @Column({ type: Date, nullable: true })
    approvedAt: Date | null;

    @Column({ type: Date, nullable: true })
    paidAt: Date | null;

    @Column({ type: Date, nullable: true })
    rejectedAt: Date | null;

    @Column({ type: Date, nullable: true })
    cancelledAt: Date | null;
}
