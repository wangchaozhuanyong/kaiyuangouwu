import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

export type DataSubjectRequestType = 'EXPORT' | 'ACCOUNT_CLOSURE';
export type DataSubjectRequestStatus =
    'PENDING' | 'PROCESSING' | 'BLOCKED' | 'FAILED' | 'FULFILLED' | 'CANCELLED';

@Entity({ name: 'data_subject_request' })
@Index('IDX_data_subject_request_subject_created', ['subjectKeyHash', 'createdAt'])
@Index('IDX_data_subject_request_due', ['requestType', 'status', 'nextAttemptAt'])
@Index('IDX_data_subject_request_channel_created', ['channelId', 'createdAt'])
export class DataSubjectRequest extends VendureEntity {
    constructor(input?: DeepPartial<DataSubjectRequest>) {
        super(input);
    }

    @EntityId()
    channelId: ID;

    @EntityId()
    customerId: ID;

    @Column({ type: 'varchar', length: 64 })
    subjectKeyHash: string;

    @Column({ type: 'varchar', length: 24 })
    requestType: DataSubjectRequestType;

    @Column({ type: 'varchar', length: 24, default: 'PENDING' })
    status: DataSubjectRequestStatus;

    @Column({ type: Date })
    requestedAt: Date;

    @Column({ type: Date, nullable: true })
    dueAt: Date | null;

    @Column({ type: Date, nullable: true })
    nextAttemptAt: Date | null;

    @Column({ type: Date, nullable: true })
    lastAttemptAt: Date | null;

    @Column({ type: 'int', default: 0 })
    attemptCount: number;

    @Column({ type: 'text', nullable: true })
    blockersJson: string | null;

    @Column({ type: 'varchar', length: 500, nullable: true })
    lastError: string | null;

    @Column({ type: 'varchar', length: 64, nullable: true })
    resultDigest: string | null;

    @Column({ type: 'text', nullable: true })
    resultSummaryJson: string | null;

    @Column({ type: Date, nullable: true })
    completedAt: Date | null;

    @Column({ type: Date, nullable: true })
    cancelledAt: Date | null;
}
