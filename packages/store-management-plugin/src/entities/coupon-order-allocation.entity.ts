import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, Customer, EntityId, Money, Order, Promotion, Refund, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { CouponAllocationStatus } from '../promotion/coupon-lifecycle.constants';

import { CustomerCoupon } from './customer-coupon.entity';

export interface CouponLineAllocationSnapshot {
    orderLineId: string;
    quantity: number;
    amount: number;
    amountWithTax: number;
}

@Entity({ name: 'coupon_order_allocation' })
@Index('IDX_coupon_allocation_order_coupon', ['orderId', 'customerCouponId'], { unique: true })
@Index('IDX_coupon_allocation_campaign_created', ['promotionId', 'createdAt'])
@Index('IDX_coupon_allocation_customer_created', ['customerId', 'createdAt'])
export class CouponOrderAllocation extends VendureEntity {
    constructor(input?: DeepPartial<CouponOrderAllocation>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_coupon_allocation_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @ManyToOne(() => CustomerCoupon, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'customerCouponId', foreignKeyConstraintName: 'FK_coupon_allocation_coupon' })
    customerCoupon: CustomerCoupon;

    @EntityId()
    customerCouponId: ID;

    @ManyToOne(() => Promotion, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'promotionId', foreignKeyConstraintName: 'FK_coupon_allocation_promotion' })
    promotion: Promotion;

    @EntityId()
    promotionId: ID;

    @ManyToOne(() => Customer, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'customerId', foreignKeyConstraintName: 'FK_coupon_allocation_customer' })
    customer: Customer;

    @EntityId()
    customerId: ID;

    @ManyToOne(() => Order, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'orderId', foreignKeyConstraintName: 'FK_coupon_allocation_order' })
    order: Order;

    @EntityId()
    orderId: ID;

    @ManyToOne(() => Refund, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'refundId', foreignKeyConstraintName: 'FK_coupon_allocation_refund' })
    refund: Refund | null;

    @EntityId({ nullable: true })
    refundId: ID | null;

    @Column({ type: 'varchar', length: 16, default: 'LOCKED' })
    status: CouponAllocationStatus;

    @Column({ type: 'varchar', length: 120 })
    campaignName: string;

    @Column({ type: 'varchar', length: 3 })
    currencyCode: CurrencyCode;

    @Money({ default: 0 })
    discountAmount: number;

    @Money({ default: 0 })
    discountAmountWithTax: number;

    @Money({ default: 0 })
    refundedAmount: number;

    @Money({ default: 0 })
    orderTotalWithTax: number;

    @Column({ type: 'simple-json', nullable: true })
    lineAllocations: CouponLineAllocationSnapshot[] | null;

    @Column({ type: Date })
    appliedAt: Date;

    @Column({ type: Date, nullable: true })
    usedAt: Date | null;

    @Column({ type: Date, nullable: true })
    releasedAt: Date | null;

    @Column({ type: Date, nullable: true })
    refundedAt: Date | null;
}
