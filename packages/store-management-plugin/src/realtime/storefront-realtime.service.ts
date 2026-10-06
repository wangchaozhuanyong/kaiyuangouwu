import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import type { ID } from '@vendure/common/lib/shared-types';
import { TranslationProviderState } from '@vendure/content-translation-plugin';
import {
    Customer,
    CustomerEvent,
    EventBus,
    Logger,
    Order,
    OrderEvent,
    OrderStateTransitionEvent,
    RequestContext,
    TransactionalConnection,
    VendureEvent,
} from '@vendure/core';
import { randomUUID } from 'node:crypto';
import { Subscription } from 'rxjs';

import { StorefrontTranslationChangedEvent } from '../performance/storefront-translation-changed.event';

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
    private translationPoll?: ReturnType<typeof setInterval>;
    private translationVersion = '';
    private translationPolling = false;

    constructor(
        private readonly eventBus: EventBus,
        private readonly connection: TransactionalConnection,
    ) {}

    onApplicationBootstrap(): void {
        // Worker and API processes do not share EventBus or SSE clients. Observe the durable generation.
        this.translationPoll = setInterval(() => {
            void this.pollTranslationChanges();
        }, 3000);
        this.translationPoll.unref();
        // Public catalog/content events are handled once by StorefrontCacheInvalidationService,
        // which rotates the public generation after commit before it broadcasts refresh.
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
        this.subscribeFiltered<StorefrontReviewChangedLike>(
            event => event.realtimeEventKind === 'storefront-review-changed',
            event => this.publishReviewChange(event),
        );
        this.subscribe(StorefrontDataChangedEvent, event => {
            const publicTopics = ['catalog', 'content', 'config', 'reviews', 'referral', 'coupons'];
            if (
                !event.options.userIds?.length &&
                !event.options.orderIds?.length &&
                event.topics.some(topic => publicTopics.includes(topic))
            )
                return;
            this.publish({
                topics: event.topics,
                channelIds: event.options.channelIds ?? [event.ctx.channelId],
                allChannels: event.options.allChannels,
                userIds: event.options.userIds,
                orderIds: event.options.orderIds,
                entityType: event.options.entityType,
                entityIds: event.options.entityIds,
            });
        });
    }

    onApplicationShutdown(): void {
        if (this.translationPoll) clearInterval(this.translationPoll);
        this.subscriptions.unsubscribe();
        this.clients.clear();
    }

    async pollTranslationChanges(): Promise<void> {
        if (this.translationPolling || !this.clients.size) return;
        this.translationPolling = true;
        try {
            const states = await this.connection.rawConnection.getRepository(TranslationProviderState).find({
                select: { provider: true, notificationVersion: true },
                order: { provider: 'ASC' },
            });
            const version = JSON.stringify(states);
            if (version !== this.translationVersion) {
                await this.eventBus.publish(new StorefrontTranslationChangedEvent());
                this.translationVersion = version;
            }
        } catch {
            // Keep the previous generation so a transient database failure is retried on the next tick.
        } finally {
            this.translationPolling = false;
        }
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

        for (const [clientId, client] of this.clients) {
            if (!change.allChannels && !channelIds.has(client.channelId)) continue;
            if (
                privateEvent &&
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
                this.clients.delete(clientId);
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

    private async publishOrderChange(orderId: ID, _fallbackChannelId: ID): Promise<void> {
        const order = await this.connection.rawConnection.getRepository(Order).findOne({
            where: { id: orderId },
            relations: { customer: { user: true } },
        });
        const userId = order?.customer?.user?.id;
        // Unresolved historical ownership must never fan out to management channels.
        if (!order?.salesChannelId) return;
        this.publish({
            topics: ['cart', 'orders', 'coupons'],
            channelIds: [order.salesChannelId],
            userIds: userId ? [userId] : undefined,
            orderIds: [orderId],
            entityType: 'Order',
            entityIds: [orderId],
        });
    }

    private async publishReviewChange(event: StorefrontReviewChangedLike): Promise<void> {
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

type StorefrontReviewChangedLike = VendureEvent & {
    realtimeEventKind: 'storefront-review-changed';
    ctx: RequestContext;
    productId: ID;
    customerId: ID;
    reviewId: ID;
    publicListingChanged: boolean;
};
