import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, Customer, EntityId, Money, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne, VersionColumn } from 'typeorm';

import { ReferralWallet } from './referral-wallet.entity';

@Entity({ name: 'referral_wallet_usage' })
@Index('IDX_referral_wallet_usage_idempotency', ['idempotencyKey'], { unique: true })
@Index('IDX_referral_wallet_usage_resource', ['channelId', 'resourceType', 'resourceId'], { unique: true })
@Index('IDX_referral_wallet_usage_customer_created', ['customerId', 'createdAt'])
export class ReferralWalletUsage extends VendureEntity {
    constructor(input?: DeepPartial<ReferralWalletUsage>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_referral_wallet_usage_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @ManyToOne(() => ReferralWallet, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'walletId', foreignKeyConstraintName: 'FK_referral_wallet_usage_wallet' })
    wallet: ReferralWallet;

    @EntityId()
    walletId: ID;

    @ManyToOne(() => Customer, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'customerId', foreignKeyConstraintName: 'FK_referral_wallet_usage_customer' })
    customer: Customer;

    @EntityId()
    customerId: ID;

    @Column({ type: 'varchar', length: 3 })
    currencyCode: CurrencyCode;

    @Column({ type: 'varchar', length: 48 })
    resourceType: string;

    @Column({ type: 'varchar', length: 128 })
    resourceId: string;

    @Column({ type: 'varchar', length: 255 })
    idempotencyKey: string;

    @Money()
    amount: number;

    @Money({ default: 0 })
    capturedAmount: number;

    @Money({ default: 0 })
    releasedAmount: number;

    @Column({ type: 'varchar', length: 24, default: 'RESERVED' })
    status: string;

    @Column({ type: Date })
    reservedAt: Date;

    @Column({ type: Date, nullable: true })
    settledAt: Date | null;

    @Column({ type: 'simple-json', nullable: true })
    metadata: Record<string, any> | null;

    @VersionColumn()
    version: number;
}
