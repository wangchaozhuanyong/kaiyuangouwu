import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import {
    CATALOG_RESOURCE_TYPES,
    CatalogResourceOwnership,
    CatalogResourceType,
    Channel,
    TransactionalConnection,
} from '@vendure/core';
import { EntitySubscriberInterface, InsertEvent } from 'typeorm';

/** Record creation ownership in the same transaction; never infer it from a resource name. */
@Injectable()
export class CatalogOwnershipSubscriber implements EntitySubscriberInterface, OnApplicationBootstrap {
    constructor(private readonly connection: TransactionalConnection) {}
    onApplicationBootstrap() {
        this.connection.rawConnection.subscribers.push(this);
    }

    async afterInsert(event: InsertEvent<any>) {
        const type = event.metadata.name as CatalogResourceType;
        if (!CATALOG_RESOURCE_TYPES.includes(type) || !event.entity?.id) return;
        const entity = event.entity;
        const defaultChannel = await event.manager.getRepository(Channel).findOne({
            where: { code: DEFAULT_CHANNEL_CODE },
            loadEagerRelations: false,
        });
        const ids: string[] = Array.from(
            new Set<string>(
                (entity.channels ?? [])
                    .map((c: Channel) => String(c.id))
                    .filter((id: string) => id !== String(defaultChannel?.id)),
            ),
        );
        const ownerChannelId =
            type === 'Tag'
                ? entity.ownerChannelId
                : ids.length === 1
                  ? ids[0]
                  : ids.length === 0
                    ? defaultChannel?.id
                    : undefined;
        if (!ownerChannelId) return;
        await event.manager.getRepository(CatalogResourceOwnership).insert({
            resourceType: type,
            resourceId: entity.id,
            ownerChannelId,
            scope: String(ownerChannelId) === String(defaultChannel?.id) ? 'PLATFORM_TEMPLATE' : 'STORE',
        });
    }
}
