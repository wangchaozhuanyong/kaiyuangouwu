import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity({ name: 'customer_service_feedback' })
@Index('UQ_customer_service_feedback_scope', ['channelId', 'customerId', 'scopeKey'], { unique: true })
@Index('IDX_customer_service_feedback_channel_updated', ['channelId', 'updatedAt'])
export class CustomerServiceFeedback extends VendureEntity {
    constructor(input?: DeepPartial<CustomerServiceFeedback>) {
        super(input);
    }

    @EntityId()
    channelId: ID;

    @EntityId()
    customerId: ID;

    @EntityId({ nullable: true })
    orderId: ID | null;

    @Column({ type: 'varchar', length: 80 })
    scopeKey: string;

    @Column({ type: 'varchar', length: 80, nullable: true })
    orderCode: string | null;

    @Column({ type: 'int' })
    rating: number;

    @Column({ type: 'text' })
    tagsJson: string;

    @Column({ type: 'text', nullable: true })
    comment: string | null;
}
