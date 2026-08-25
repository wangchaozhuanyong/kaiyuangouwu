import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, Customer, EntityId, Money, Order, Promotion, Refund, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { CouponLedgerActorType, CouponLedgerEventType } from '../promotion/coupon-lifecycle.constants';

import { CustomerCoupon } from './customer-coupon.entity';

@Entity({ name: 'coupon_ledger_entry' })
@Index('IDX_coupon_ledger_channel_created', ['channelId', 'createdAt'])
@Index('IDX_coupon_ledger_coupon_created', ['customerCouponId', 'createdAt'])
@Index('IDX_coupon_ledger_campaign_created', ['promotionId', 'createdAt'])
@Index('IDX_coupon_ledger_idempotency', ['idempotencyKey'], { unique: true })
export class CouponLedgerEntry extends VendureEntity {
    constructor(input?: DeepPartial<CouponLedgerEntry>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_coupon_ledger_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @ManyToOne(() => CustomerCoupon, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'customerCouponId', foreignKeyConstraintName: 'FK_coupon_ledger_coupon' })
    customerCoupon: CustomerCoupon;

    @EntityId()
    customerCouponId: ID;

    @ManyToOne(() => Promotion, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'promotionId', foreignKeyConstraintName: 'FK_coupon_ledger_promotion' })
    promotion: Promotion;

    @EntityId()
    promotionId: ID;

    @ManyToOne(() => Customer, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'customerId', foreignKeyConstraintName: 'FK_coupon_ledger_customer' })
    customer: Customer;

    @EntityId()
    customerId: ID;

    @ManyToOne(() => Order, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'orderId', foreignKeyConstraintName: 'FK_coupon_ledger_order' })
    order: Order | null;

    @EntityId({ nullable: true })
    orderId: ID | null;

    @ManyToOne(() => Refund, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'refundId', foreignKeyConstraintName: 'FK_coupon_ledger_refund' })
    refund: Refund | null;

    @EntityId({ nullable: true })
    refundId: ID | null;

    @Column({ type: 'varchar', length: 24 })
    eventType: CouponLedgerEventType;

    @Column({ type: 'varchar', length: 16 })
    actorType: CouponLedgerActorType;

    @Column({ type: 'varchar', length: 255, nullable: true })
    idempotencyKey: string | null;

    @Money({ nullable: true })
    discountAmount: number | null;

    @Column({ type: 'varchar', length: 500, nullable: true })
    note: string | null;

    @Column({ type: 'simple-json', nullable: true })
    metadata: Record<string, unknown> | null;
}
