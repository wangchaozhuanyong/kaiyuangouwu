import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, Order, Payment, Refund, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

@Entity('store_usdt_manual_refund')
@Index('IDX_store_usdt_manual_refund_transaction', ['network', 'transactionId'], { unique: true })
@Index('IDX_store_usdt_manual_refund_refund', ['refundId'], { unique: true })
@Index('IDX_store_usdt_manual_refund_channel_created', ['channelId', 'createdAt'])
export class StoreUsdtManualRefund extends VendureEntity {
    constructor(input?: DeepPartial<StoreUsdtManualRefund>) {
        super(input);
    }

    @ManyToOne(() => Channel)
    @JoinColumn({ name: 'channelId' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @ManyToOne(() => Payment)
    @JoinColumn({ name: 'paymentId' })
    payment: Payment;

    @EntityId()
    paymentId: ID;

    @ManyToOne(() => Order)
    @JoinColumn({ name: 'orderId' })
    order: Order;

    @EntityId()
    orderId: ID;

    @ManyToOne(() => Refund)
    @JoinColumn({ name: 'refundId' })
    refund: Refund;

    @EntityId()
    refundId: ID;

    @Column({ type: 'varchar', length: 16 })
    network: string;

    @Column({ type: 'varchar', length: 64 })
    transactionId: string;

    @Column({ type: 'decimal', precision: 30, scale: 0 })
    usdtAmountBaseUnits: string;

    @Column({ type: 'varchar', length: 64 })
    fromAddress: string;

    @Column({ type: 'varchar', length: 64 })
    toAddress: string;

    @Column({ type: 'integer' })
    blockNumber: number;

    @Column({ type: Date })
    blockTimestamp: Date;

    @EntityId()
    operatorUserId: ID;

    @Column({ type: 'varchar', length: 500 })
    reason: string;
}
