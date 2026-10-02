import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Column, Entity, Index } from 'typeorm';

import { VendureEntity } from '../base/base.entity';
import { EntityId } from '../entity-id.decorator';

export const CATALOG_RESOURCE_TYPES = [
    'Product',
    'Collection',
    'ProductOptionGroup',
    'ProductOption',
    'Facet',
    'FacetValue',
    'Asset',
    'Tag',
] as const;
export type CatalogResourceType = (typeof CATALOG_RESOURCE_TYPES)[number];

/** Ownership is independent of sales membership and customer visibility. */
@Entity({ name: 'catalog_resource_ownership' })
@Index('IDX_catalog_resource_identity', ['resourceType', 'resourceId'], { unique: true })
@Index('IDX_catalog_resource_owner', ['ownerChannelId', 'resourceType'])
export class CatalogResourceOwnership extends VendureEntity {
    constructor(input?: DeepPartial<CatalogResourceOwnership>) {
        super(input);
    }

    @Column({ type: 'varchar', length: 32 })
    resourceType: CatalogResourceType;

    @EntityId()
    resourceId: ID;

    @EntityId()
    ownerChannelId: ID;

    @Column({ type: 'varchar', length: 24, default: 'STORE' })
    scope: 'STORE' | 'PLATFORM_TEMPLATE';
}
