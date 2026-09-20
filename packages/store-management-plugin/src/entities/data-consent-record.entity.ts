import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

export type DataConsentPurpose = 'TERMS' | 'PRIVACY' | 'ANALYTICS';
export type DataConsentAction = 'GRANTED' | 'WITHDRAWN';

@Entity({ name: 'data_consent_record' })
@Index('IDX_data_consent_subject_created', ['subjectKeyHash', 'createdAt'])
@Index('IDX_data_consent_channel_created', ['channelId', 'createdAt'])
@Index('IDX_data_consent_purpose_created', ['purpose', 'createdAt'])
export class DataConsentRecord extends VendureEntity {
    constructor(input?: DeepPartial<DataConsentRecord>) {
        super(input);
    }

    @EntityId()
    channelId: ID;

    @EntityId({ nullable: true })
    customerId: ID | null;

    @Column({ type: 'varchar', length: 64 })
    subjectKeyHash: string;

    @Column({ type: 'varchar', length: 24 })
    purpose: DataConsentPurpose;

    @Column({ type: 'varchar', length: 24 })
    action: DataConsentAction;

    @Column({ type: 'varchar', length: 160 })
    policyVersion: string;

    @Column({ type: 'varchar', length: 64 })
    policyDigest: string;

    @Column({ type: 'varchar', length: 16 })
    locale: string;

    @Column({ type: 'varchar', length: 32 })
    source: string;

    @Column({ type: 'varchar', length: 64, nullable: true })
    ipHash: string | null;

    @Column({ type: 'varchar', length: 64, nullable: true })
    userAgentHash: string | null;

    @Column({ type: Date })
    recordedAt: Date;
}
