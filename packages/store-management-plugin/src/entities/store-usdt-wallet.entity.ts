import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

export type StoreUsdtWalletReviewStatus = 'UNCONFIGURED' | 'PENDING' | 'ACTIVE' | 'REJECTED';

@Entity('store_usdt_wallet')
@Index('IDX_store_usdt_wallet_channel', ['channelId'], { unique: true })
export class StoreUsdtWallet extends VendureEntity {
    constructor(input?: DeepPartial<StoreUsdtWallet>) {
        super(input);
    }

    @ManyToOne(() => Channel, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @Column({ type: 'varchar', length: 16, default: 'UNCONFIGURED' })
    reviewStatus: StoreUsdtWalletReviewStatus;

    @Column({ type: 'text', nullable: true })
    activeReceivingAddressEncrypted: string | null;

    @Column({ type: 'varchar', length: 64, nullable: true })
    activeReceivingAddressFingerprint: string | null;

    @Column({ type: 'text', nullable: true })
    pendingReceivingAddressEncrypted: string | null;

    @Column({ type: 'varchar', length: 64, nullable: true })
    pendingReceivingAddressFingerprint: string | null;

    @Column({ type: Date, nullable: true })
    submittedAt: Date | null;

    @EntityId({ nullable: true })
    submittedByUserId: ID | null;

    @Column({ type: Date, nullable: true })
    reviewedAt: Date | null;

    @EntityId({ nullable: true })
    reviewedByUserId: ID | null;

    @Column({ type: 'varchar', length: 500, nullable: true })
    rejectionReason: string | null;
}
