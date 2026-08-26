import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, Customer, EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

@Entity({ name: 'referral_relationship' })
@Index('IDX_referral_relationship_channel_invitee', ['channelId', 'inviteeCustomerId'], { unique: true })
@Index('IDX_referral_relationship_channel_inviter_bound', ['channelId', 'inviterCustomerId', 'boundAt'])
export class ReferralRelationship extends VendureEntity {
    constructor(input?: DeepPartial<ReferralRelationship>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_referral_relationship_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @ManyToOne(() => Customer, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'inviterCustomerId', foreignKeyConstraintName: 'FK_referral_relationship_inviter' })
    inviterCustomer: Customer;

    @EntityId()
    inviterCustomerId: ID;

    @ManyToOne(() => Customer, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'inviteeCustomerId', foreignKeyConstraintName: 'FK_referral_relationship_invitee' })
    inviteeCustomer: Customer;

    @EntityId()
    inviteeCustomerId: ID;

    @Column({ type: 'varchar', length: 12 })
    inviteCodeSnapshot: string;

    @Column({ type: 'varchar', length: 16, default: 'CODE' })
    source: string;

    @Column({ type: Date })
    boundAt: Date;

    @Column({ type: Date, nullable: true })
    firstPaidOrderAt: Date | null;
}
