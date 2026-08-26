import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, Customer, EntityId, Money, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { ReferralWallet } from './referral-wallet.entity';

@Entity({ name: 'referral_ledger_entry' })
@Index('IDX_referral_ledger_idempotency', ['idempotencyKey'], { unique: true })
@Index('IDX_referral_ledger_channel_created', ['channelId', 'createdAt'])
@Index('IDX_referral_ledger_customer_created', ['customerId', 'createdAt'])
export class ReferralLedgerEntry extends VendureEntity {
    constructor(input?: DeepPartial<ReferralLedgerEntry>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_referral_ledger_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @ManyToOne(() => ReferralWallet, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'walletId', foreignKeyConstraintName: 'FK_referral_ledger_wallet' })
    wallet: ReferralWallet;

    @EntityId()
    walletId: ID;

    @ManyToOne(() => Customer, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'customerId', foreignKeyConstraintName: 'FK_referral_ledger_customer' })
    customer: Customer;

    @EntityId()
    customerId: ID;

    @Column({ type: 'varchar', length: 3 })
    currencyCode: CurrencyCode;

    @Column({ type: 'varchar', length: 32 })
    eventType: string;

    @Money({ default: 0 })
    availableDelta: number;

    @Money({ default: 0 })
    pendingDelta: number;

    @Money({ default: 0 })
    reservedDelta: number;

    @Money()
    availableAfter: number;

    @Money()
    pendingAfter: number;

    @Money()
    reservedAfter: number;

    @Column({ type: 'varchar', length: 255 })
    idempotencyKey: string;

    @EntityId({ nullable: true })
    orderId: ID | null;

    @EntityId({ nullable: true })
    refundId: ID | null;

    @EntityId({ nullable: true })
    withdrawalId: ID | null;

    @EntityId({ nullable: true })
    actorId: ID | null;

    @Column({ type: 'varchar', length: 16, default: 'SYSTEM' })
    actorType: string;

    @Column({ type: 'varchar', length: 500, nullable: true })
    note: string | null;

    @Column({ type: 'simple-json', nullable: true })
    metadata: Record<string, unknown> | null;
}
