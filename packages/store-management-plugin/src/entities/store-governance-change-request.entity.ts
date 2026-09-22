import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

export type StoreGovernanceChangeType =
    'LEGAL_IDENTITY' | 'PAYOUT_ACCOUNT' | 'PAYMENT_CONFIGURATION' | 'USDT_WALLET';
export type StoreGovernanceChangeStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

@Entity({ name: 'store_governance_change_request' })
@Index('IDX_store_governance_request_version', ['channelId', 'requestType', 'version'], { unique: true })
@Index('IDX_store_governance_request_status', ['status', 'createdAt'])
export class StoreGovernanceChangeRequest extends VendureEntity {
    constructor(input?: DeepPartial<StoreGovernanceChangeRequest>) {
        super(input);
    }

    @ManyToOne(() => Channel, { onDelete: 'CASCADE', nullable: false })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_store_governance_request_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @Column({ type: 'varchar', length: 32 })
    requestType: StoreGovernanceChangeType;

    @Column({ type: 'int' })
    version: number;

    @Column({ type: 'varchar', length: 16, default: 'PENDING' })
    status: StoreGovernanceChangeStatus;

    @EntityId()
    submittedByUserId: ID;

    @EntityId({ nullable: true })
    reviewedByUserId: ID | null;

    @Column({ type: 'text' })
    encryptedPayload: string;

    @Column({ type: 'simple-json' })
    maskedSummary: Record<string, unknown>;

    @Column({ type: 'varchar', length: 500, nullable: true })
    reviewReason: string | null;

    @Column({ type: Date })
    submittedAt: Date;

    @Column({ type: Date, nullable: true })
    reviewedAt: Date | null;
}
