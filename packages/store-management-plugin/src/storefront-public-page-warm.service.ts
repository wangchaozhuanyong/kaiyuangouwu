import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import {
    CacheService,
    ForbiddenError,
    JobQueue,
    JobQueueService,
    LanguageCode,
    Logger,
    ProcessContext,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { StoreDomain } from '@vendure/store-domain-plugin';
import {
    canonicalPublicPageRequest,
    publicPageRequestKey,
    storefrontNavigationCollections,
    type PublicNavigationCollection,
    type PublicPageRequest,
} from '@vendure/storefront-content-plugin';
import type { Request } from 'express';

import { StorefrontPublicCacheService } from './performance/storefront-public-cache.service';
import { StorefrontPromotionAccessService } from './promotion/storefront-promotion-access.service';
import { StorefrontClosedError } from './storefront-activation.service';
import { publicSectionWithinBudget, StorefrontPublicPageService } from './storefront-public-page.service';
import { publicPagePreferences } from './storefront-public-request';

export const PUBLIC_PAGE_HOT_ROUTE_LIMIT = 20;
const HOT_TTL = 30 * 60_000;
const CHANNEL_LIMIT = 256;
const REFRESH_AFTER = 15_000;
type WarmJob = { channelId: string };
export type PublicHotRoute = {
    host: string;
    languageCode: string;
    currencyCode: string;
    request: PublicPageRequest;
    seenAt: number;
    /** Worker-selected published primary navigation, never supplied by visitors. */
    primary?: boolean;
};
const hotKey = (channel: string, revision: string) =>
    `storefront-public-hot-routes:v2:${channel}:${revision}`;
const identity = (route: PublicHotRoute) =>
    JSON.stringify([route.host, route.languageCode, route.currencyCode, publicPageRequestKey(route.request)]);

export function mergePublicHotRoutes(previous: PublicHotRoute[], recent: PublicHotRoute[], now = Date.now()) {
    const routes = new Map<string, PublicHotRoute>();
    for (const route of [...previous, ...recent]) {
        if (!route || route.seenAt < now - HOT_TTL) continue;
        try {
            const request = canonicalPublicPageRequest(route.request);
            // An arbitrary search/filter must not create recurring background work.
            if (
                request.kind === 'catalog' &&
                (request.input.skip ||
                    request.input.term ||
                    request.input.inStockOnly ||
                    request.input.fulfillmentType ||
                    request.input.minPriceWithTax != null ||
                    request.input.maxPriceWithTax != null ||
                    request.input.sort !== 'RECOMMENDED')
            )
                continue;
            const entry = { ...route, request };
            const key = identity(entry);
            const existing = routes.get(key);
            if ((existing?.seenAt ?? 0) <= entry.seenAt)
                routes.set(key, { ...entry, ...(existing?.primary ? { primary: true } : {}) });
        } catch {
            /* Invalid/obsolete work never enters the warm set. */
        }
    }
    const priority = (route: PublicHotRoute) =>
        route.primary ? 0 : route.request.kind === 'home' ? 1 : route.request.kind === 'catalog' ? 2 : 3;
    return [...routes.values()]
        .sort((a, b) => priority(a) - priority(b) || b.seenAt - a.seenAt)
        .slice(0, PUBLIC_PAGE_HOT_ROUTE_LIMIT);
}

/** Queue-owned assembly only; SSI never waits for queued assembly or the hot-route registry. */
@Injectable()
export class StorefrontPublicPageWarmService implements OnApplicationBootstrap, OnApplicationShutdown {
    private queue?: JobQueue<WarmJob>;
    private timer?: ReturnType<typeof setInterval>;
    private readonly pending = new Map<string, PublicHotRoute[]>();
    private readonly flushing = new Map<string, Promise<void>>();
    private readonly queued = new Set<string>();
    private readonly processing = new Map<string, Promise<unknown>>();

    constructor(
        private readonly jobs: JobQueueService,
        private readonly processContext: ProcessContext,
        private readonly cache: CacheService,
        private readonly connection: TransactionalConnection,
        private readonly access: StorefrontPromotionAccessService,
        private readonly pages: StorefrontPublicPageService,
        private readonly publicCache: StorefrontPublicCacheService,
    ) {}

    async onApplicationBootstrap() {
        this.queue = await this.jobs.createQueue({
            name: 'storefront-public-page-warm',
            process: job => this.process(job.data),
        });
        if (this.processContext.isWorker) {
            await this.enqueue('*').catch(() => this.failed());
            this.timer = setInterval(() => {
                void this.enqueue('*').catch(() => this.failed());
            }, 20_000);
            this.timer.unref?.();
        }
    }

    onApplicationShutdown() {
        if (this.timer) clearInterval(this.timer);
        this.queue = undefined;
        this.queued.clear();
    }

    async observe(ctx: RequestContext, host: string, request: PublicPageRequest): Promise<void> {
        if (ctx.apiType !== 'shop' || ctx.activeUserId || ctx.session || !this.queue) return;
        const key = await this.registryKey(ctx);
        if (!key) return;
        if (!this.pending.has(key) && this.pending.size + this.flushing.size >= CHANNEL_LIMIT) return;
        const route: PublicHotRoute = {
            host,
            request,
            languageCode: ctx.languageCode,
            currencyCode: ctx.currencyCode,
            seenAt: Date.now(),
        };
        this.pending.set(key, mergePublicHotRoutes(this.pending.get(key) ?? [], [route]));
        if (this.flushing.has(key)) return;
        const flushed = this.flush(ctx, key)
            .catch(() => this.failed())
            .finally(() => {
                this.flushing.delete(key);
            });
        this.flushing.set(key, flushed);
        await flushed;
    }

    private async registryKey(ctx: RequestContext): Promise<string | undefined> {
        if ((await this.pages.getAccessMode(ctx)) !== 'LIVE') return undefined;
        const revision = await this.publicCache.revision(ctx.channelId);
        return revision ? hotKey(String(ctx.channelId), revision) : undefined;
    }

    private async saveRoutes(ctx: RequestContext, key: string, routes: PublicHotRoute[]) {
        if ((await this.registryKey(ctx)) !== key) return;
        await publicSectionWithinBudget(this.cache.set(key, routes, { ttl: HOT_TTL }), 200);
        if ((await this.registryKey(ctx)) !== key)
            await publicSectionWithinBudget(this.cache.delete(key), 200);
    }

    private async flush(ctx: RequestContext, key: string) {
        while (this.pending.has(key)) {
            const recent = this.pending.get(key) ?? [];
            this.pending.delete(key);
            if ((await this.registryKey(ctx)) !== key) return;
            const previous = await publicSectionWithinBudget(this.cache.get<PublicHotRoute[]>(key), 200);
            const routes = mergePublicHotRoutes(previous ?? [], recent);
            await this.saveRoutes(ctx, key, routes);
        }
    }

    private async enqueue(channelId: string) {
        // The deployed topology has one worker. APIs only record routes; they never schedule jobs.
        // Keep each channel queued until completion, including time waiting behind another store.
        if (!this.processContext.isWorker || !this.queue || this.queued.has(channelId)) return;
        if (this.queued.size >= CHANNEL_LIMIT + 1) return;
        this.queued.add(channelId);
        try {
            // The periodic scan retries failures. Independent queue retries would outlive this ownership.
            await this.queue.add({ channelId }, { retries: 0 });
        } catch (error) {
            this.queued.delete(channelId);
            throw error;
        }
    }

    private process(job: WarmJob): Promise<unknown> {
        const pending = this.processing.get(job.channelId);
        if (pending) return pending;
        const work = this.warm(job)
            .catch(error => {
                if (error instanceof StorefrontClosedError || error instanceof ForbiddenError)
                    return { warmed: 0 };
                throw error;
            })
            .finally(() => {
                this.processing.delete(job.channelId);
                this.queued.delete(job.channelId);
            });
        this.processing.set(job.channelId, work);
        return work;
    }

    private async warm({ channelId }: WarmJob) {
        const query = this.connection.rawConnection
            .getRepository(StoreDomain)
            .createQueryBuilder('domain')
            .select('domain.domain', 'host')
            .addSelect('domain.channelId', 'channelId')
            .where('domain.status = :status', { status: 'ACTIVE' })
            .orderBy('domain.isPrimary', 'DESC')
            .addOrderBy('domain.domain', 'ASC')
            .limit(CHANNEL_LIMIT + 1);
        if (channelId !== '*') query.andWhere('domain.channelId = :channelId', { channelId });
        const domains = await query.getRawMany<{ host: string; channelId: string }>();
        if (domains.length > CHANNEL_LIMIT) throw new Error('Public warm-up domain limit exceeded');
        if (channelId === '*') {
            const channels = new Set<string>();
            for (const domain of domains) {
                const channel = String(domain.channelId);
                if (channels.has(channel)) continue;
                if (await this.verifiedContext(domain.host, channel)) {
                    channels.add(channel);
                    await this.enqueue(channel);
                }
            }
            return { queued: channels.size };
        }
        if (!domains.length) return { warmed: 0 };
        const validHosts = new Set(domains.map(domain => domain.host));
        const first = await this.verifiedContext(domains[0].host, channelId);
        if (!first) return { warmed: 0 };
        const key = await this.registryKey(first);
        if (!key) return { warmed: 0 };
        const previous = await publicSectionWithinBudget(this.cache.get<PublicHotRoute[]>(key), 200);
        const primaryLanguage =
            first.channel.defaultLanguageCode === LanguageCode.zh_Hans
                ? LanguageCode.zh_Hans
                : LanguageCode.en;
        const currencyCode = first.channel.defaultCurrencyCode ?? first.currencyCode;
        const defaults: PublicHotRoute[] = [];
        const preparedHomes = new Set<string>();
        let warmed = 0;
        for (const languageCode of [
            primaryLanguage,
            primaryLanguage === LanguageCode.en ? LanguageCode.zh_Hans : LanguageCode.en,
        ]) {
            const ctx = first.copy(publicPagePreferences(first, languageCode, currencyCode));
            if ((await this.registryKey(ctx)) !== key) return { warmed };
            const base = {
                host: domains[0].host,
                languageCode,
                currencyCode,
                seenAt: Date.now(),
                primary: true,
            };
            const homeRequest = { kind: 'home' } as const;
            // Host-only anonymous contexts default to English. Explicitly seed both supported languages.
            const cachedHome = await this.pages.peek(ctx, base.host, homeRequest);
            const refreshHome = !cachedHome || Date.now() - cachedHome.generatedAt >= REFRESH_AFTER;
            const home = refreshHome
                ? await this.pages.read(ctx, base.host, homeRequest, { refresh: true })
                : cachedHome;
            if (refreshHome) warmed++;
            const homeRoute = { ...base, request: homeRequest };
            preparedHomes.add(identity(homeRoute));
            defaults.push(homeRoute, { ...base, request: { kind: 'catalog', input: {} } });
            for (const collection of storefrontNavigationCollections(
                (home.collections ?? []) as PublicNavigationCollection[],
            ).slice(0, 4)) {
                const id = (collection as { id?: unknown })?.id;
                if (typeof id === 'string' && /^[a-z0-9_-]{1,100}$/iu.test(id))
                    defaults.push({ ...base, request: { kind: 'catalog', input: { collectionId: id } } });
            }
        }
        const routes = mergePublicHotRoutes(
            (previous ?? [])
                .filter(route => validHosts.has(route.host))
                .map(route => ({ ...route, primary: false })),
            defaults,
        );
        await this.saveRoutes(first, key, routes);
        if ((await this.registryKey(first)) !== key) return { warmed };
        for (const route of routes) {
            if (preparedHomes.has(identity(route))) continue;
            // Domain revocation, activation and currency changes are checked again when queued work executes.
            const original = await this.verifiedContext(route.host, channelId);
            if (!original) continue;
            if ((await this.registryKey(original)) !== key) return { warmed };
            let ctx: RequestContext;
            try {
                ctx = original.copy(publicPagePreferences(original, route.languageCode, route.currencyCode));
            } catch {
                continue;
            }
            const cached = await this.pages.peek(ctx, route.host, route.request);
            if (cached && Date.now() - cached.generatedAt < REFRESH_AFTER) continue;
            await this.pages.read(ctx, route.host, route.request, { refresh: true });
            warmed++;
        }
        return { warmed };
    }

    private async verifiedContext(host: string, channelId: string): Promise<RequestContext | undefined> {
        try {
            const resolved = await this.access.resolveRequest({
                headers: { host },
                query: {},
                protocol: 'https',
            } as unknown as Request);
            if (!resolved || String(resolved.ctx.channelId) !== channelId) return undefined;
            return (await this.pages.getAccessMode(resolved.ctx)) === 'LIVE' ? resolved.ctx : undefined;
        } catch (error) {
            if (error instanceof StorefrontClosedError || error instanceof ForbiddenError) return undefined;
            throw error;
        }
    }

    private failed() {
        Logger.warn(
            'Public page warm-up unavailable; public requests retain bounded cache fallback',
            'StorefrontPublicPage',
        );
    }
}
