import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, Order, Payment, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { UsdtPaymentIntentStatus } from '../usdt/usdt-payment.constants';

import { StorefrontUsdtCheckoutQuote } from './storefront-usdt-checkout-quote.entity';

@Entity('storefront_usdt_payment_intent')
@Index('IDX_storefront_usdt_intent_quote', ['quoteId'], { unique: true })
@Index('IDX_storefront_usdt_intent_match_key', ['matchKey'], { unique: true })
@Index('IDX_storefront_usdt_intent_transaction', ['transactionId'], { unique: true })
@Index('IDX_storefront_usdt_intent_status_expiry', ['status', 'expiresAt'])
export class StorefrontUsdtPaymentIntent extends VendureEntity {
    constructor(input?: DeepPartial<StorefrontUsdtPaymentIntent>) {
        super(input);
    }

    @ManyToOne(() => Channel, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @ManyToOne(() => Order, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'orderId' })
    order: Order;

    @EntityId()
    orderId: ID;

    @ManyToOne(() => StorefrontUsdtCheckoutQuote, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'quoteId' })
    quote: StorefrontUsdtCheckoutQuote;

    @EntityId()
    quoteId: ID;

    @ManyToOne(() => Payment, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'paymentId' })
    payment: Payment | null;

    @EntityId({ nullable: true })
    paymentId: ID | null;

    @Column({ type: 'varchar', length: 16 })
    network: string;

    @Column({ type: 'varchar', length: 64 })
    tokenContractAddress: string;

    @Column({ type: 'varchar', length: 64 })
    receivingAddress: string;

    @Column({ type: 'varchar', length: 64 })
    receivingAddressFingerprint: string;

    @Column({ type: 'varchar', length: 64 })
    matchKey: string;

    @Column({ type: 'decimal', precision: 24, scale: 6 })
    baseUsdtAmount: string;

    @Column({ type: 'decimal', precision: 24, scale: 6 })
    expectedUsdtAmount: string;

    @Column({ type: 'varchar', length: 24, default: 'PENDING' })
    status: UsdtPaymentIntentStatus;

    @Column({ type: 'varchar', length: 80, nullable: true })
    transactionId: string | null;

    @Column({ type: 'varchar', length: 64, nullable: true })
    senderAddress: string | null;

    @Column({ type: 'decimal', precision: 24, scale: 6, nullable: true })
    receivedUsdtAmount: string | null;

    @Column({ type: 'int', nullable: true })
    blockNumber: number | null;

    @Column({ type: Date, nullable: true })
    blockTimestamp: Date | null;

    @Column({ type: Date, nullable: true })
    lastCheckedAt: Date | null;

    @Column({ type: Date, nullable: true })
    settledAt: Date | null;

    @Column({ type: 'varchar', length: 500, nullable: true })
    failureReason: string | null;

    @Column({ type: Date })
    expiresAt: Date;
}
