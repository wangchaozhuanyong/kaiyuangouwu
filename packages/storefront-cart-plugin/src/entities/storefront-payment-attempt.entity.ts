import { DeepPartial, EntityId, ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

export type PaymentAttemptStatus = 'PROCESSING' | 'APPLIED' | 'REJECTED' | 'NOT_EXECUTED' | 'UNKNOWN';

/** Acknowledgement fence only: never store payment input, tokens or contact data. */
@Entity()
@Index('IDX_payment_attempt_identity', ['cartId', 'requestId'], { unique: true })
@Index('IDX_payment_attempt_active_order', ['activeOrderKey'], { unique: true })
export class StorefrontPaymentAttempt extends VendureEntity {
    constructor(input?: DeepPartial<StorefrontPaymentAttempt>) {
        super(input);
    }

    @EntityId() cartId: ID;
    @EntityId() channelId: ID;
    @EntityId() orderId: ID;
    @Column('varchar', { length: 80 }) requestId: string;
    @Column('varchar', { length: 16 }) kind: 'payment' | 'balance';
    @Column('varchar', { length: 100 }) method: string;
    @Column('varchar', { length: 4 }) currencyCode: string;
    @Column('int') amount: number;
    @Column('varchar', { length: 16 }) status: PaymentAttemptStatus;
    @Column('varchar', { length: 100, nullable: true }) errorCode: string | null;
    @Column('varchar', { length: 80, nullable: true }) activeOrderKey: string | null;
}
