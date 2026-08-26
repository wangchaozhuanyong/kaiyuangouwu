import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, Customer, EntityId, Money, Order, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { ReferralWallet } from './referral-wallet.entity';

@Entity({ name: 'referral_balance_use' })
@Index('IDX_referral_balance_use_channel_order', ['channelId', 'orderId'], { unique: true })
export class ReferralBalanceUse extends VendureEntity {
    constructor(input?: DeepPartial<ReferralBalanceUse>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_referral_balance_use_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @ManyToOne(() => ReferralWallet, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'walletId', foreignKeyConstraintName: 'FK_referral_balance_use_wallet' })
    wallet: ReferralWallet;

    @EntityId()
    walletId: ID;

    @ManyToOne(() => Customer, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'customerId', foreignKeyConstraintName: 'FK_referral_balance_use_customer' })
    customer: Customer;

    @EntityId()
    customerId: ID;

    @ManyToOne(() => Order, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'orderId', foreignKeyConstraintName: 'FK_referral_balance_use_order' })
    order: Order;

    @EntityId()
    orderId: ID;

    @Column({ type: 'varchar', length: 3 })
    currencyCode: CurrencyCode;

    @Money()
    amount: number;

    @Money({ default: 0 })
    refundedAmount: number;

    @Column({ type: 'varchar', length: 24, default: 'RESERVED' })
    status: string;

    @Column({ type: Date })
    reservedAt: Date;

    @Column({ type: Date, nullable: true })
    capturedAt: Date | null;

    @Column({ type: Date, nullable: true })
    releasedAt: Date | null;
}
