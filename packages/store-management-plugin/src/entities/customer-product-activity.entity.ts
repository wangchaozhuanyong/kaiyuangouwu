import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

export type CustomerProductActivityKind = 'FAVORITE' | 'HISTORY';

@Entity({ name: 'customer_product_activity' })
@Index('UQ_customer_product_activity', ['channelId', 'customerId', 'kind', 'productId'], {
    unique: true,
})
@Index('IDX_customer_product_activity_recent', ['channelId', 'customerId', 'kind', 'visitedAt'])
export class CustomerProductActivity extends VendureEntity {
    constructor(input?: DeepPartial<CustomerProductActivity>) {
        super(input);
    }

    @EntityId()
    channelId: ID;

    @EntityId()
    customerId: ID;

    @EntityId()
    productId: ID;

    @Column({ type: 'varchar', length: 16 })
    kind: CustomerProductActivityKind;

    @Column({ type: Date })
    visitedAt: Date;
}
