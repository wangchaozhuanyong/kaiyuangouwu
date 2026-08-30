import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import type { ID } from '@vendure/common/lib/shared-types';
import {
    Asset,
    AssetChannelEvent,
    AssetEvent,
    ChannelEvent,
    Collection,
    CollectionEvent,
    CollectionModificationEvent,
    Customer,
    CustomerEvent,
    EventBus,
    Logger,
    Order,
    OrderEvent,
    OrderStateTransitionEvent,
    Product,
    ProductChannelEvent,
    ProductEvent,
    ProductVariantChannelEvent,
    ProductVariantEvent,
    ProductVariantPriceEvent,
    Promotion,
    PromotionEvent,
    RequestContext,
    TransactionalConnection,
    VendureEvent,
} from '@vendure/core';
import { randomUUID } from 'node:crypto';
import { Subscription } from 'rxjs';

import { StorefrontDataChangedEvent, StorefrontRealtimeTopic } from './storefront-data-changed.event';

export interface StorefrontRealtimePayload {
    version: 1;
    id: string;
    occurredAt: string;
    topics: StorefrontRealtimeTopic[];
    entityType?: string;
    entityIds?: string[];
}

export interface StorefrontRealtimeClient {
    channelId: string;
    userId?: string;
    activeOrderId?: string;
    admin?: boolean;
    send(payload: StorefrontRealtimePayload): void;
}

interface RealtimeChange {
    topics: StorefrontRealtimeTopic[];
    channelIds?: ID[];
    allChannels?: boolean;
    userIds?: ID[];
    orderIds?: ID[];
    entityType?: string;
    entityIds?: ID[];
}

@Injectable()
export class StorefrontRealtimeService implements OnApplicationBootstrap, OnApplicationShutdown {
    private readonly clients = new Map<string, StorefrontRealtimeClient>();
    private readonly subscriptions = new Subscription();

    constructor(
        private readonly eventBus: EventBus,
        private readonly connection: TransactionalConnection,
    ) {}

    onApplicationBootstrap(): void {
        this.subscribe(ProductEvent, event =>
            this.publishEntityChange('Product', Product, event.entity.id, event.ctx.channelId, ['catalog']),
        );
        this.subscribe(ProductVariantEvent, event => {
            const productIds = uniqueStrings(event.entity.map(variant => variant.productId));
            const channelIds = uniqueStrings(
                event.entity.flatMap(variant => variant.channels?.map(channel => channel.id) ?? []),
            );
            this.publish({
                topics: ['catalog'],
                channelIds: channelIds.length ? channelIds : [event.ctx.channelId],
                entityType: 'Product',
                entityIds: productIds,
            });
        });
        this.subscribe(ProductVariantPriceEvent, event => {
            const channelIds = uniqueStrings(event.entity.map(price => price.channelId));
            this.publish({
                topics: ['catalog', 'cart'],
                channelIds: channelIds.length ? channelIds : [event.ctx.channelId],
                entityType: 'ProductVariantPrice',
            });
        });
        this.subscribe(ProductChannelEvent, event =>
            this.publish({
                topics: ['catalog'],
                channelIds: [event.channelId],
                entityType: 'Product',
                entityIds: [event.product.id],
            }),
        );
        this.subscribe(ProductVariantChannelEvent, event =>
            this.publish({
                topics: ['catalog'],
                channelIds: [event.channelId],
                entityType: 'Product',
                entityIds: event.productVariant.productId ? [event.productVariant.productId] : undefined,
            }),
        );
        this.subscribe(CollectionEvent, event =>
            this.publishEntityChange('Collection', Collection, event.entity.id, event.ctx.channelId, [
                'catalog',
            ]),
        );
        this.subscribe(CollectionModificationEvent, event =>
            this.publishEntityChange('Collection', Collection, event.collection.id, event.ctx.channelId, [
                'catalog',
            ]),
        );
        this.subscribe(AssetEvent, event =>
            this.publishEntityChange('Asset', Asset, event.entity.id, event.ctx.channelId, [
                'catalog',
                'content',
                'config',
            ]),
        );
        this.subscribe(AssetChannelEvent, event =>
            this.publish({
                topics: ['catalog', 'content', 'config'],
                channelIds: [event.channelId],
                entityType: 'Asset',
                entityIds: [event.asset.id],
            }),
        );
        this.subscribe(ChannelEvent, event =>
            this.publish({
                topics: ['config', 'catalog'],
                channelIds: [event.entity.id],
                entityType: 'Channel',
                entityIds: [event.entity.id],
            }),
        );
        this.subscribe(PromotionEvent, event =>
            this.publishEntityChange('Promotion', Promotion, event.entity.id, event.ctx.channelId, [
                'content',
                'cart',
            ]),
        );
        this.subscribe(OrderEvent, event => this.publishOrderChange(event.entity.id, event.ctx.channelId));
        this.subscribe(OrderStateTransitionEvent, event =>
            this.publishOrderChange(event.order.id, event.ctx.channelId),
        );
        this.subscribe(CustomerEvent, event => {
            const userId = event.entity.user?.id;
            if (!userId) return;
            this.publish({
                topics: ['customer'],
                channelIds: [event.ctx.channelId],
                userIds: [userId],
                entityType: 'Customer',
                entityIds: [event.entity.id],
            });
        });
        this.subscribeFiltered<StorefrontContentChangedLike>(
            event => event.realtimeEventKind === 'storefront-content-changed',
            event =>
                this.publish({
                    topics: ['content'],
                    channelIds: [event.ctx.channelId],
                    entityType: 'StorefrontContent',
                    entityIds: event.entityIds,
                }),
        );
        this.subscribeFiltered<StorefrontReviewChangedLike>(
            event => event.realtimeEventKind === 'storefront-review-changed',
            event => this.publishReviewChange(event),
        );
        this.subscribe(StorefrontDataChangedEvent, event =>
            this.publish({
                topics: event.topics,
                channelIds: event.options.channelIds ?? [event.ctx.channelId],
                allChannels: event.options.allChannels,
                userIds: event.options.userIds,
                orderIds: event.options.orderIds,
                entityType: event.options.entityType,
                entityIds: event.options.entityIds,
            }),
        );
    }

    onApplicationShutdown(): void {
        this.subscriptions.unsubscribe();
        this.clients.clear();
    }

    addClient(client: StorefrontRealtimeClient): () => void {
        const clientId = randomUUID();
        this.clients.set(clientId, client);
        return () => this.clients.delete(clientId);
    }

    publish(change: RealtimeChange): void {
        const payload: StorefrontRealtimePayload = {
            version: 1,
            id: `${Date.now()}-${randomUUID()}`,
            occurredAt: new Date().toISOString(),
            topics: uniqueTopics(change.topics),
            ...(change.entityType ? { entityType: change.entityType } : {}),
            ...(change.entityIds?.length ? { entityIds: uniqueStrings(change.entityIds) } : {}),
        };
        const channelIds = new Set(uniqueStrings(change.channelIds ?? []));
        const userIds = new Set(uniqueStrings(change.userIds ?? []));
        const orderIds = new Set(uniqueStrings(change.orderIds ?? []));
        const privateEvent = userIds.size > 0 || orderIds.size > 0;

        for (const client of this.clients.values()) {
            if (!change.allChannels && !channelIds.has(client.channelId)) continue;
            if (
                privateEvent &&
                !client.admin &&
                !(client.userId && userIds.has(client.userId)) &&
                !(client.activeOrderId && orderIds.has(client.activeOrderId))
            ) {
                continue;
            }
            try {
                client.send(payload);
            } catch (error) {
                Logger.warn(
                    `Failed to write storefront realtime event: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
        }
    }

    private subscribe<T>(type: new (...args: any[]) => T, handler: (event: T) => void | Promise<void>): void {
        this.subscriptions.add(
            this.eventBus.ofType(type as any).subscribe(event => {
                Promise.resolve(handler(event as T)).catch(error =>
                    Logger.error(
                        `Failed to publish storefront realtime event: ${error instanceof Error ? error.message : String(error)}`,
                    ),
                );
            }),
        );
    }

    private subscribeFiltered<T extends VendureEvent>(
        predicate: (event: Record<string, unknown>) => boolean,
        handler: (event: T) => void | Promise<void>,
    ): void {
        this.subscriptions.add(
            this.eventBus.filter<T>(predicate as any).subscribe(event => {
                Promise.resolve(handler(event)).catch(error =>
                    Logger.error(
                        `Failed to publish storefront realtime event: ${error instanceof Error ? error.message : String(error)}`,
                    ),
                );
            }),
        );
    }

    private async publishEntityChange(
        entityType: string,
        entityClass: typeof Product | typeof Collection | typeof Asset | typeof Promotion,
        entityId: ID,
        fallbackChannelId: ID,
        topics: StorefrontRealtimeTopic[],
    ): Promise<void> {
        const channelIds = await this.findEntityChannelIds(entityClass, entityId);
        this.publish({
            topics,
            channelIds: channelIds.length ? channelIds : [fallbackChannelId],
            entityType,
            entityIds: [entityId],
        });
    }

    private async findEntityChannelIds(
        entityClass: typeof Product | typeof Collection | typeof Asset | typeof Promotion,
        entityId: ID,
    ): Promise<string[]> {
        const repository = this.connection.rawConnection.getRepository(entityClass);
        const entity = await repository.findOne({
            where: { id: entityId },
            relations: { channels: true },
        });
        return uniqueStrings(
            (entity as { channels?: Array<{ id: ID }> } | null)?.channels?.map(c => c.id) ?? [],
        );
    }

    private async publishOrderChange(orderId: ID, fallbackChannelId: ID): Promise<void> {
        const order = await this.connection.rawConnection.getRepository(Order).findOne({
            where: { id: orderId },
            relations: { customer: true, channels: true },
        });
        const userId = order?.customer?.user?.id;
        this.publish({
            topics: ['cart', 'orders', 'coupons'],
            channelIds: order?.channels?.length
                ? order.channels.map(channel => channel.id)
                : [fallbackChannelId],
            userIds: userId ? [userId] : undefined,
            orderIds: [orderId],
            entityType: 'Order',
            entityIds: [orderId],
        });
    }

    private async publishReviewChange(event: StorefrontReviewChangedLike): Promise<void> {
        if (event.publicListingChanged) {
            this.publish({
                topics: ['reviews'],
                channelIds: [event.ctx.channelId],
                entityType: 'Product',
                entityIds: [event.productId],
            });
        }
        const customer = await this.connection.rawConnection.getRepository(Customer).findOne({
            where: { id: event.customerId },
        });
        if (!customer?.user?.id) return;
        this.publish({
            topics: ['reviews'],
            channelIds: [event.ctx.channelId],
            userIds: [customer.user.id],
            entityType: 'Product',
            entityIds: [event.productId],
        });
    }
}

function uniqueStrings(values: ReadonlyArray<ID | null | undefined>): string[] {
    return Array.from(new Set(values.filter(value => value != null).map(String)));
}

function uniqueTopics(values: readonly StorefrontRealtimeTopic[]): StorefrontRealtimeTopic[] {
    return Array.from(new Set(values));
}

type StorefrontContentChangedLike = VendureEvent & {
    realtimeEventKind: 'storefront-content-changed';
    ctx: RequestContext;
    entityIds: ID[];
};

type StorefrontReviewChangedLike = VendureEvent & {
    realtimeEventKind: 'storefront-review-changed';
    ctx: RequestContext;
    productId: ID;
    customerId: ID;
    reviewId: ID;
    publicListingChanged: boolean;
};
