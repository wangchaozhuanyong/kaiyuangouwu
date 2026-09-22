import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

export type StoreUsdtReconciliationActionType = 'RETRY_SETTLEMENT' | 'CONFIRM_EXTERNAL_REFUND';

@Entity('store_usdt_reconciliation_action')
@Index('IDX_store_usdt_reconciliation_intent_created', ['intentId', 'createdAt'])
@Index('IDX_store_usdt_reconciliation_channel_created', ['channelId', 'createdAt'])
@Index('IDX_store_usdt_reconciliation_transaction', ['network', 'transactionId'], { unique: true })
export class StoreUsdtReconciliationAction extends VendureEntity {
    constructor(input?: DeepPartial<StoreUsdtReconciliationAction>) {
        super(input);
    }

    @EntityId()
    channelId: ID;

    @EntityId()
    intentId: ID;

    @EntityId()
    orderId: ID;

    @Column({ type: 'varchar', length: 32 })
    action: StoreUsdtReconciliationActionType;

    @Column({ type: 'varchar', length: 32 })
    outcome: string;

    @EntityId()
    operatorUserId: ID;

    @Column({ type: 'varchar', length: 500 })
    reason: string;

    @Column({ type: 'varchar', length: 16, nullable: true })
    network: string | null;

    @Column({ type: 'varchar', length: 80, nullable: true })
    transactionId: string | null;

    @Column({ type: 'decimal', precision: 30, scale: 0, nullable: true })
    usdtAmountBaseUnits: string | null;

    @Column({ type: 'varchar', length: 64, nullable: true })
    fromAddress: string | null;

    @Column({ type: 'varchar', length: 64, nullable: true })
    toAddress: string | null;

    @Column({ type: 'int', nullable: true })
    blockNumber: number | null;

    @Column({ type: Date, nullable: true })
    blockTimestamp: Date | null;
}
