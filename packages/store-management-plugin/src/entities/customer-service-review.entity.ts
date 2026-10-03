import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity('customer_service_review')
@Index('IDX_service_review_identity', ['channelId', 'ownerKey', 'submissionKey'], { unique: true })
@Index('IDX_service_review_channel_created', ['channelId', 'createdAt'])
export class CustomerServiceReview extends VendureEntity {
    constructor(input?: DeepPartial<CustomerServiceReview>) {
        super(input);
    }
    @EntityId() channelId: ID;
    @EntityId({ nullable: true }) customerId: ID | null;
    @EntityId({ nullable: true }) orderId: ID | null;
    @Column({ type: 'varchar', length: 64 }) ownerKey: string;
    @Column({ type: 'varchar', length: 64 }) submissionKey: string;
    @Column({ type: 'int' }) rating: number;
    @Column({ type: 'simple-json' }) tags: string[];
    @Column({ type: 'text' }) comment: string;
    @Column({ type: 'varchar', length: 64, nullable: true }) orderCode: string | null;
    @Column({ type: 'int', default: 1 }) revision: number;
}
