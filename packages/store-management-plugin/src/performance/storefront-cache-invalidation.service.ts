import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { EventBus, Logger, ProcessContext, RequestContext, VendureEvent } from '@vendure/core';
import { Subscription } from 'rxjs';

import { StorefrontDataChangedEvent } from '../realtime/storefront-data-changed.event';
import { StorefrontRealtimeService } from '../realtime/storefront-realtime.service';

import { StorefrontPublicCacheService } from './storefront-public-cache.service';

const GLOBAL_PUBLIC_EVENTS = new Set([
    'ProductEvent',
    'ProductVariantEvent',
    'ProductVariantPriceEvent',
    'ProductChannelEvent',
    'ProductVariantChannelEvent',
    'CollectionEvent',
    'CollectionModificationEvent',
    'AssetEvent',
    'AssetChannelEvent',
    'ChannelEvent',
    'PromotionEvent',
    'StockMovementEvent',
    'SearchIndexCompletedEvent',
    'StoreDomainChangedEvent',
    'StorefrontTranslationChangedEvent',
]);
const PUBLIC_TOPICS = ['catalog', 'content', 'config', 'reviews', 'referral', 'coupons'] as const;

export class StorefrontPublicCacheInvalidatedEvent extends VendureEvent {
    constructor(
        public readonly ctx: RequestContext | undefined,
        public readonly channelId: string,
    ) {
        super();
    }
}

/** One mapping for page snapshots and media manifests, in both API and worker processes. */
@Injectable()
export class StorefrontCacheInvalidationService implements OnApplicationBootstrap, OnApplicationShutdown {
    private subscription?: Subscription;
    private timer?: ReturnType<typeof setInterval>;
    private polling = false;
    private retryGlobal = false;
    private readonly revisions = new Map<string, string>();

    constructor(
        private readonly events: EventBus,
        private readonly cache: StorefrontPublicCacheService,
        private readonly realtime: StorefrontRealtimeService,
        private readonly processContext: ProcessContext,
    ) {}

    onApplicationBootstrap() {
        // EventBus.filter waits for the event's transaction to commit before delivering it.
        this.subscription = this.events
            .filter(event => this.isPublicChange(event))
            .subscribe(event => {
                void this.changed(event as VendureEvent & { ctx: RequestContext }).catch(() => {
                    Logger.error(
                        'Public cache invalidation failed; bounded TTL remains active',
                        'StorefrontPublicCache',
                    );
                });
            });
        if (this.cache.sharedVersions) {
            this.timer = setInterval(() => {
                void this.poll().catch(() => undefined);
            }, 3000);
            this.timer.unref();
        }
    }

    onApplicationShutdown() {
        this.subscription?.unsubscribe();
        if (this.timer) clearInterval(this.timer);
    }

    private isPublicChange(event: VendureEvent): boolean {
        if (GLOBAL_PUBLIC_EVENTS.has(event.constructor.name)) return true;
        if ((event as any).realtimeEventKind === 'storefront-content-changed') return true;
        if ((event as any).realtimeEventKind === 'storefront-review-settings-changed') return true;
        if ((event as any).realtimeEventKind === 'storefront-review-changed')
            return (event as any).publicListingChanged === true;
        if (event instanceof StorefrontDataChangedEvent)
            return (
                !event.options.userIds?.length &&
                !event.options.orderIds?.length &&
                event.topics.some(topic => PUBLIC_TOPICS.includes(topic as any))
            );
        return false;
    }

    private changesPublicMedia(event: VendureEvent): boolean {
        // Stock, price and translated copy updates refresh public data without evicting every
        // catalog image from the CDN on each order. Publication and permission changes do purge.
        if (
            [
                'StockMovementEvent',
                'ProductVariantPriceEvent',
                'StorefrontTranslationChangedEvent',
                'SearchIndexCompletedEvent',
            ].includes(event.constructor.name)
        )
            return false;
        if ((event as any).realtimeEventKind?.startsWith('storefront-review')) return false;
        if (event instanceof StorefrontDataChangedEvent)
            return event.topics.some(topic => topic === 'content' || topic === 'config');
        return true;
    }

    private async changed(event: VendureEvent & { ctx: RequestContext }) {
        const channelIds =
            event instanceof StorefrontDataChangedEvent && !event.options.allChannels
                ? (event.options.channelIds ?? [event.ctx.channelId]).map(String)
                : GLOBAL_PUBLIC_EVENTS.has(event.constructor.name) || (event as any).options?.allChannels
                  ? ['*']
                  : [String(event.ctx.channelId)];
        for (const id of new Set(channelIds)) {
            try {
                await this.cache.invalidate(id);
            } catch {
                this.retryGlobal = true;
                // CDN revocation must still be queued while Redis is temporarily unavailable.
                if (this.changesPublicMedia(event))
                    await this.events.publish(new StorefrontPublicCacheInvalidatedEvent(event.ctx, id));
                throw new Error('Public cache invalidation unavailable');
            }
            // Record locally emitted revisions so the cross-process poll does not emit them again.
            await Promise.all(
                (id === '*' ? this.cache.observedChannels() : [id]).map(async channelId => {
                    const revision = await this.cache.revision(channelId);
                    if (revision) this.revisions.set(channelId, revision);
                }),
            );
            const kind = (event as any).realtimeEventKind as string | undefined;
            const topics =
                event instanceof StorefrontDataChangedEvent
                    ? event.topics
                    : kind === 'storefront-review-settings-changed'
                      ? ['config' as const]
                      : kind === 'storefront-review-changed'
                        ? ['reviews' as const]
                        : kind === 'storefront-content-changed'
                          ? ['content' as const]
                          : [
                                  'ProductEvent',
                                  'ProductVariantEvent',
                                  'ProductChannelEvent',
                                  'ProductVariantChannelEvent',
                                  'ProductVariantPriceEvent',
                                  'PromotionEvent',
                                  'SearchIndexCompletedEvent',
                              ].includes(event.constructor.name)
                            ? [...PUBLIC_TOPICS, 'cart' as const]
                            : [...PUBLIC_TOPICS];
            this.realtime.publish({
                ...(id === '*' ? { allChannels: true } : { channelIds: [id] }),
                topics,
                ...(kind === 'storefront-review-settings-changed'
                    ? { entityType: 'StorefrontReviewSettings' }
                    : {}),
                ...(event instanceof StorefrontDataChangedEvent
                    ? { entityType: event.options.entityType, entityIds: event.options.entityIds }
                    : {}),
            });
            if (this.changesPublicMedia(event))
                await this.events.publish(new StorefrontPublicCacheInvalidatedEvent(event.ctx, id));
        }
    }

    async poll(): Promise<void> {
        if (this.polling) return;
        this.polling = true;
        try {
            if (this.retryGlobal) {
                await this.cache.invalidate('*');
                this.retryGlobal = false;
                await Promise.all(
                    this.cache.observedChannels().map(async channelId => {
                        const revision = await this.cache.revision(channelId);
                        if (revision) this.revisions.set(channelId, revision);
                    }),
                );
                this.realtime.publish({ allChannels: true, topics: [...PUBLIC_TOPICS, 'cart'] });
            }
            if (this.processContext.isWorker) return;
            const observed = this.cache.observedChannels();
            for (const key of this.revisions.keys()) if (!observed.includes(key)) this.revisions.delete(key);
            for (const channelId of observed) {
                const revision = await this.cache.revision(channelId);
                if (!revision) continue;
                const previous = this.revisions.get(channelId);
                this.revisions.set(channelId, revision);
                if (previous && previous !== revision)
                    // Worker index-completion events reach API processes through this
                    // durable revision; their cart eligibility must also be re-read.
                    this.realtime.publish({ channelIds: [channelId], topics: [...PUBLIC_TOPICS, 'cart'] });
            }
        } finally {
            this.polling = false;
        }
    }
}
