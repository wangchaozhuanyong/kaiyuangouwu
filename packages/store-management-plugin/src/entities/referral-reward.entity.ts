import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, Customer, EntityId, Money, Order, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

@Entity({ name: 'referral_reward' })
@Index('IDX_referral_reward_channel_order', ['channelId', 'orderId'], { unique: true })
@Index('IDX_referral_reward_inviter_available', ['inviterCustomerId', 'availableAt'])
export class ReferralReward extends VendureEntity {
    constructor(input?: DeepPartial<ReferralReward>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_referral_reward_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @ManyToOne(() => Customer, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'inviterCustomerId', foreignKeyConstraintName: 'FK_referral_reward_inviter' })
    inviterCustomer: Customer;

    @EntityId()
    inviterCustomerId: ID;

    @ManyToOne(() => Customer, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'inviteeCustomerId', foreignKeyConstraintName: 'FK_referral_reward_invitee' })
    inviteeCustomer: Customer;

    @EntityId()
    inviteeCustomerId: ID;

    @ManyToOne(() => Order, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'orderId', foreignKeyConstraintName: 'FK_referral_reward_order' })
    order: Order;

    @EntityId()
    orderId: ID;

    @Column({ type: 'varchar', length: 3 })
    currencyCode: CurrencyCode;

    @Column('int')
    rewardRateBps: number;

    @Money()
    eligibleAmount: number;

    @Money()
    rewardAmount: number;

    @Money({ default: 0 })
    releasedAmount: number;

    @Money({ default: 0 })
    clawedBackAmount: number;

    @Money({ default: 0 })
    settledRefundTotal: number;

    @Money({ default: 0 })
    settledEligibleRefundTotal: number;

    @Money()
    orderTotalWithTax: number;

    @Column({ type: 'varchar', length: 24, default: 'PENDING' })
    status: string;

    @Column({ type: Date })
    earnedAt: Date;

    @Column({ type: Date })
    availableAt: Date;

    @Column({ type: Date, nullable: true })
    releasedAt: Date | null;
}
