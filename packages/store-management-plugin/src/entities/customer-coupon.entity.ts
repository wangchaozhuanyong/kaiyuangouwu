import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, Customer, EntityId, Money, Order, Promotion, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne, VersionColumn } from 'typeorm';

import { CustomerCouponStatus } from '../promotion/coupon-lifecycle.constants';
import { StoreCouponCampaignKind } from '../types';

import { StoreCouponCampaignConfig } from './store-coupon-campaign-config.entity';

@Entity({ name: 'customer_coupon' })
@Index('IDX_customer_coupon_campaign_customer', ['promotionId', 'customerId', 'claimedAt'])
@Index('IDX_customer_coupon_customer_status_valid', ['customerId', 'status', 'validUntil'])
@Index('IDX_customer_coupon_locked_order', ['lockedOrderId', 'status'])
@Index('IDX_customer_coupon_used_order', ['usedOrderId', 'status'])
export class CustomerCoupon extends VendureEntity {
    constructor(input?: DeepPartial<CustomerCoupon>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_customer_coupon_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @ManyToOne(() => StoreCouponCampaignConfig, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'campaignConfigId', foreignKeyConstraintName: 'FK_customer_coupon_config' })
    campaignConfig: StoreCouponCampaignConfig;

    @EntityId()
    campaignConfigId: ID;

    @ManyToOne(() => Promotion, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'promotionId', foreignKeyConstraintName: 'FK_customer_coupon_promotion' })
    promotion: Promotion;

    @EntityId()
    promotionId: ID;

    @ManyToOne(() => Customer, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'customerId', foreignKeyConstraintName: 'FK_customer_coupon_customer' })
    customer: Customer;

    @EntityId()
    customerId: ID;

    @Column({ type: 'varchar', length: 24, default: 'AVAILABLE' })
    status: CustomerCouponStatus;

    @Column({ type: 'varchar', length: 120 })
    campaignName: string;

    @Column({ type: 'varchar', length: 32 })
    campaignKind: StoreCouponCampaignKind;

    @Money({ default: 0 })
    minimumSpend: number;

    @Money({ nullable: true })
    discountAmount: number | null;

    @Column({ type: 'float', nullable: true })
    discountRate: number | null;

    @Column({ type: Date })
    claimedAt: Date;

    @Column({ type: Date })
    validFrom: Date;

    @Column({ type: Date, nullable: true })
    validUntil: Date | null;

    @Column({ type: Date, nullable: true })
    lockedAt: Date | null;

    @Column({ type: Date, nullable: true })
    lockExpiresAt: Date | null;

    @ManyToOne(() => Order, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'lockedOrderId', foreignKeyConstraintName: 'FK_customer_coupon_locked_order' })
    lockedOrder: Order | null;

    @EntityId({ nullable: true })
    lockedOrderId: ID | null;

    @Column({ type: Date, nullable: true })
    usedAt: Date | null;

    @ManyToOne(() => Order, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'usedOrderId', foreignKeyConstraintName: 'FK_customer_coupon_used_order' })
    usedOrder: Order | null;

    @EntityId({ nullable: true })
    usedOrderId: ID | null;

    @Column({ type: Date, nullable: true })
    returnedAt: Date | null;

    @Column({ type: Date, nullable: true })
    expiredAt: Date | null;

    @Column({ type: Date, nullable: true })
    revokedAt: Date | null;

    @Column({ type: 'int', default: 0 })
    returnCount: number;

    @VersionColumn()
    version: number;
}
