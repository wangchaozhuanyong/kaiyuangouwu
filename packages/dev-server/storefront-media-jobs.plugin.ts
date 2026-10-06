import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { AssetServer, AssetServerPlugin } from '@vendure/asset-server-plugin';
import {
    EventBus,
    JobQueue,
    JobQueueService,
    Logger,
    PluginCommonModule,
    ProcessContext,
    TransactionalConnection,
    VendurePlugin,
} from '@vendure/core';
import { StoreDomain, StoreDomainPlugin } from '@vendure/store-domain-plugin';
import {
    StorefrontMediaDeliveryService,
    StorefrontMediaManifestService,
    StorefrontPromotionAccessService,
    StorefrontPublicCacheInvalidatedEvent,
    StoreManagementPlugin,
} from '@vendure/store-management-plugin';
import { responsiveImageSources, type StorefrontImageKind } from '@vendure/storefront-content-plugin';
import type { Request } from 'express';
import { Subscription } from 'rxjs';

type PreparationJob = { channelId: string; host?: string; offset: number };
type PurgeJob = { channelId: string };
const CHUNK_SIZE = 24;

/** The queue consumes exactly the finite responsive URLs emitted by the shared media contract. */
export function publicDerivativePlans(uses: Array<{ path: string; kind: StorefrontImageKind }>) {
    const plans = new Map<string, { path: string; preset: string; quality: number }>();
    for (const use of uses) {
        const sources = responsiveImageSources(`/assets/${use.path}`, use.kind);
        for (const item of sources?.webpSrcSet.split(', ') ?? []) {
            const url = new URL(item.split(' ')[0], 'https://storefront.invalid');
            const preset = url.searchParams.get('preset');
            const quality = Number(url.searchParams.get('q'));
            if (preset && Number.isFinite(quality))
                plans.set(`${use.path}:${preset}:${quality}`, { path: use.path, preset, quality });
        }
    }
    return [...plans.values()].sort((a, b) => `${a.path}:${a.preset}`.localeCompare(`${b.path}:${b.preset}`));
}

@Injectable()
export class StorefrontMediaJobsService implements OnApplicationBootstrap, OnApplicationShutdown {
    private prepareQueue?: JobQueue<PreparationJob>;
    private purgeQueue?: JobQueue<PurgeJob>;
    private subscription?: Subscription;
    private readonly lastPreparation = new Map<string, number>();
    constructor(
        private readonly queues: JobQueueService,
        private readonly events: EventBus,
        private readonly connection: TransactionalConnection,
        private readonly access: StorefrontPromotionAccessService,
        private readonly manifests: StorefrontMediaManifestService,
        private readonly delivery: StorefrontMediaDeliveryService,
        private readonly assets: AssetServer,
        private readonly processContext: ProcessContext,
    ) {}

    async onApplicationBootstrap(): Promise<void> {
        if (process.env.STOREFRONT_MEDIA_PREGENERATE === 'true') {
            this.prepareQueue = await this.queues.createQueue({
                name: 'storefront-media-prepare',
                process: job => this.prepare(job.data),
            });
        }
        if (this.delivery.purgeEnabled) {
            this.purgeQueue = await this.queues.createQueue({
                name: 'storefront-media-purge',
                process: job => this.purge(job.data),
            });
        }
        if (!this.prepareQueue && !this.purgeQueue) return;
        this.subscription = this.events.ofType(StorefrontPublicCacheInvalidatedEvent).subscribe(event => {
            void this.enqueue(event.channelId).catch(() =>
                Logger.error('Public media job enqueue failed', 'StorefrontMediaJobs'),
            );
        });
        // Explicitly opted-in warm-up runs in the worker, not in a visitor's image request.
        if (this.processContext.isWorker && this.prepareQueue)
            await this.prepareQueue.add({ channelId: '*', offset: 0 }, { retries: 2 });
    }
    onApplicationShutdown() {
        this.subscription?.unsubscribe();
    }

    private async enqueue(channelId: string): Promise<void> {
        if (this.purgeQueue) await this.purgeQueue.add({ channelId }, { retries: 3 });
        if (this.prepareQueue && Date.now() - (this.lastPreparation.get(channelId) ?? 0) >= 30_000) {
            if (this.lastPreparation.size >= 256) {
                const oldest = this.lastPreparation.keys().next().value;
                if (oldest !== undefined) this.lastPreparation.delete(oldest);
            }
            this.lastPreparation.set(channelId, Date.now());
            await this.prepareQueue.add({ channelId, offset: 0 }, { retries: 2 });
        }
    }

    private async purge(data: PurgeJob) {
        const ids = data.channelId === '*' ? await this.delivery.channels() : [data.channelId];
        let count = 0;
        for (const id of ids) count += (await this.delivery.purge(await this.delivery.urls(id))).count;
        return { status: 'purged', count };
    }

    private async prepare(data: PreparationJob): Promise<{ prepared: number; failed?: number }> {
        const queue = this.prepareQueue;
        if (!queue) throw new Error('Public media preparation queue is not enabled');
        const query = this.connection.rawConnection
            .getRepository(StoreDomain)
            .createQueryBuilder('domain')
            .select('domain.domain', 'host')
            .addSelect('domain.channelId', 'channelId')
            .where('domain.status = :status', { status: 'ACTIVE' })
            .orderBy('domain.domain', 'ASC')
            .limit(257);
        if (data.channelId !== '*')
            query.andWhere('domain.channelId = :channelId', { channelId: data.channelId });
        if (data.host) query.andWhere('domain.domain = :host', { host: data.host });
        const domains = await query.getRawMany<{ host: string; channelId: string }>();
        if (domains.length > 256)
            throw new Error('Public media preparation exceeds the bounded domain batch');
        if (!data.host) {
            for (const domain of domains)
                await queue.add(
                    { channelId: String(domain.channelId), host: domain.host, offset: 0 },
                    { retries: 2 },
                );
            return { prepared: 0 };
        }
        if (!domains.length) return { prepared: 0 };
        const request = await this.access.resolveRequest({
            headers: { host: data.host, 'accept-language': 'zh-CN' },
            protocol: 'https',
            query: {},
        } as unknown as Request);
        if (!request || String(request.channelId) !== data.channelId) return { prepared: 0 };
        const manifest = await this.manifests.get(request.ctx, request.host);
        const plans = publicDerivativePlans(manifest.uses);
        let prepared = 0;
        let failed = 0;
        for (const plan of plans.slice(data.offset, data.offset + CHUNK_SIZE)) {
            if (!manifest.paths.includes(plan.path)) continue;
            try {
                await this.assets.preparePublicDerivative(plan.path, plan.preset, plan.quality);
                prepared++;
            } catch {
                failed++;
            }
        }
        if (failed)
            Logger.warn(
                'Some public media derivatives could not be prepared; lazy delivery remains available',
                'StorefrontMediaJobs',
            );
        if (data.offset + CHUNK_SIZE < plans.length)
            await queue.add({ ...data, offset: data.offset + CHUNK_SIZE }, { retries: 2 });
        return { prepared, failed };
    }
}

@VendurePlugin({
    imports: [PluginCommonModule, AssetServerPlugin, StoreDomainPlugin, StoreManagementPlugin],
    providers: [StorefrontMediaJobsService],
    compatibility: '^3.7.0',
})
export class StorefrontMediaJobsPlugin {}
