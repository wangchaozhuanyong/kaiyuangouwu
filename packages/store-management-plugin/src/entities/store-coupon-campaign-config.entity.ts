import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, Promotion, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { CouponStackPolicy } from '../promotion/coupon-lifecycle.constants';

@Entity({ name: 'store_coupon_campaign_config' })
@Index('IDX_store_coupon_campaign_config_promotion', ['promotionId'], { unique: true })
@Index('IDX_store_coupon_campaign_config_channel_claim', ['channelId', 'claimStartsAt', 'claimEndsAt'])
export class StoreCouponCampaignConfig extends VendureEntity {
    constructor(input?: DeepPartial<StoreCouponCampaignConfig>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_store_coupon_config_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @ManyToOne(() => Promotion, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'promotionId', foreignKeyConstraintName: 'FK_store_coupon_config_promotion' })
    promotion: Promotion;

    @EntityId()
    promotionId: ID;

    @Column({ type: Date, nullable: true })
    claimStartsAt: Date | null;

    @Column({ type: Date, nullable: true })
    claimEndsAt: Date | null;

    @Column({ type: 'int', nullable: true })
    validityDays: number | null;

    @Column({ type: 'int', nullable: true })
    issueLimit: number | null;

    @Column({ type: 'int', default: 1 })
    perCustomerClaimLimit: number;

    @Column({ type: 'varchar', length: 16, default: 'EXCLUSIVE' })
    stackPolicy: CouponStackPolicy;

    @Column({ type: 'boolean', default: true })
    returnOnCancellation: boolean;

    @Column({ type: 'boolean', default: true })
    returnOnFullRefund: boolean;
}
