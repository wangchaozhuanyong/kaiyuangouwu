import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

export type StoreUsdtWalletAuditAction = 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'MIGRATED' | 'REENCRYPTED';

@Entity('store_usdt_wallet_audit')
@Index('IDX_store_usdt_wallet_audit_channel_created', ['channelId', 'createdAt'])
export class StoreUsdtWalletAudit extends VendureEntity {
    constructor(input?: DeepPartial<StoreUsdtWalletAudit>) {
        super(input);
    }

    @ManyToOne(() => Channel, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @Column({ type: 'varchar', length: 16 })
    action: StoreUsdtWalletAuditAction;

    @Column({ type: 'varchar', length: 64 })
    addressFingerprint: string;

    @EntityId({ nullable: true })
    actorUserId: ID | null;

    @Column({ type: 'varchar', length: 500, nullable: true })
    note: string | null;
}
