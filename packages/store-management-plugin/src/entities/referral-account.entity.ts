import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, Customer, EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

@Entity({ name: 'referral_account' })
@Index('IDX_referral_account_channel_customer', ['channelId', 'customerId'], { unique: true })
@Index('IDX_referral_account_channel_code', ['channelId', 'inviteCode'], { unique: true })
export class ReferralAccount extends VendureEntity {
    constructor(input?: DeepPartial<ReferralAccount>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_referral_account_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @ManyToOne(() => Customer, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'customerId', foreignKeyConstraintName: 'FK_referral_account_customer' })
    customer: Customer;

    @EntityId()
    customerId: ID;

    @Column({ type: 'varchar', length: 12 })
    inviteCode: string;
}
