import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Column, Entity, Index } from 'typeorm';

import { VendureEntity } from '../base/base.entity';
import { EntityId } from '../entity-id.decorator';

export type ProductSalesAuthorizationState = 'PENDING' | 'ACTIVE' | 'PAUSED' | 'REVOKED';

@Entity({ name: 'product_sales_authorization' })
@Index('IDX_product_sales_target', ['productId', 'channelId'], { unique: true })
export class ProductSalesAuthorization extends VendureEntity {
    constructor(input?: DeepPartial<ProductSalesAuthorization>) {
        super(input);
    }

    @EntityId()
    productId: ID;

    @EntityId()
    channelId: ID;

    @EntityId()
    sourceChannelId: ID;

    @Column({ type: 'varchar', length: 16, default: 'PENDING' })
    state: ProductSalesAuthorizationState;

    /** The native variant/channel relation is authoritative; this records the reviewed scope. */
    @Column({ type: 'simple-json' })
    variantIds: string[];

    @Column({ type: 'simple-json', nullable: true })
    pendingVariantIds: string[] | null;

    @Column({ type: 'int', default: 1 })
    version: number;
}
