import { Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { CacheService, ConfigService, ID, RequestContext, RequestContextCacheService } from '@vendure/core';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { clearTimeout, setTimeout } from 'node:timers';

interface RevisionStrategy {
    getOrCreateVersion?(key: string): Promise<string>;
    rotateVersion?(key: string): Promise<string>;
}
interface PublicEntry<T> {
    value: T;
    expiresAt: number;
    revision: string;
}
const PREFIX = 'storefront-public:v1';
const MAX_LOADERS = 4;
const MAX_QUEUED = 32;
const MAX_CHANNELS = 256;
const CACHE_TIMEOUT_MS = 100;
const PEEK_BUDGET_MS = 200;

/** Anonymous public DTOs only. No request, session or entity instances may be cached. */
@Injectable()
export class StorefrontPublicCacheService {
    private readonly inFlight = new Map<string, Promise<unknown>>();
    private readonly localRevisions = new Map<string, string>();
    private readonly channels = new Set<string>();
    private activeLoaders = 0;
    private readonly loaderContext = new AsyncLocalStorage<boolean>();
    private readonly accessContext = new AsyncLocalStorage<{
        uncached?: boolean;
        assertReusable?: () => Promise<void>;
        pendingOrigin?: Set<Promise<unknown>>;
    }>();
    private readonly waiting: Array<() => void> = [];
    private sharedUnavailable = false;
    private recovering?: Promise<string | undefined>;
    private fallbackRevision = 0;
    readonly metrics = { hits: 0, misses: 0, bypasses: 0, superseded: 0, rejected: 0 };

    constructor(
        private readonly cache: CacheService,
        private readonly config: ConfigService,
        @Optional() private readonly requestCache?: RequestContextCacheService,
    ) {}
    get sharedVersions(): boolean {
        return typeof this.strategy.getOrCreateVersion === 'function';
    }
    observedChannels(): string[] {
        return [...this.channels];
    }

    /** Preview assembly and all nested readers share the existing bounded origin permit, never a cache. */
    runUncached<T>(load: () => Promise<T>): Promise<T> {
        if (this.accessContext.getStore()?.uncached) return this.loadUncached(load);
        let resolve!: (value: T) => void;
        let reject!: (error: unknown) => void;
        const response = new Promise<T>((yes, no) => {
            resolve = yes;
            reject = no;
        });
        const pendingOrigin = new Set<Promise<unknown>>();
        // The response budget may end before optional origin work. Keep this same permit until
        // that work actually settles, without extending the response's 600 ms section budget.
        void this.withLoaderPermit(() =>
            this.accessContext.run({ uncached: true, pendingOrigin }, async () => {
                try {
                    resolve(await load());
                } catch (error) {
                    reject(error);
                }
                while (pendingOrigin.size) await Promise.allSettled([...pendingOrigin]);
            }),
        ).catch(reject);
        return response;
    }

    loadUncached<T>(load: () => Promise<T>): Promise<T> {
        const access = this.accessContext.getStore();
        if (!access?.uncached) return this.runUncached(load);
        const result = this.withLoaderPermit(load);
        access.pendingOrigin?.add(result);
        const settled = () => {
            access.pendingOrigin?.delete(result);
        };
        void result.then(settled, settled);
        return result;
    }

    /** Own each explicit source, including siblings left pending after Promise.all fails fast. */
    trackSource<T>(load: () => Promise<T>): Promise<T> {
        return this.accessContext.getStore()?.uncached ? this.loadUncached(load) : load();
    }

    /** The guard also follows optional loaders which complete after their page's response budget. */
    runGuarded<T>(assertReusable: () => Promise<void>, load: () => Promise<T>): Promise<T> {
        return this.accessContext.run({ ...this.accessContext.getStore(), assertReusable }, load);
    }

    async revision(channelId: ID, deadline = Date.now() + CACHE_TIMEOUT_MS): Promise<string | undefined> {
        const id = String(channelId);
        if (!this.channels.has(id) && this.channels.size >= MAX_CHANNELS) {
            const oldest = this.channels.values().next().value;
            if (oldest !== undefined) {
                this.channels.delete(oldest);
                this.localRevisions.delete(oldest);
            }
        }
        this.channels.add(id);
        const versions = await Promise.all([this.version('*', deadline), this.version(id, deadline)]);
        let global = versions[0];
        const channel = versions[1];
        if (!global || !channel) {
            this.sharedUnavailable = this.sharedVersions;
            return undefined;
        }
        if (this.sharedUnavailable && this.strategy.rotateVersion) {
            // Discard all pre-outage generations before any recovered cache can be used.
            if (!this.recovering) {
                const result = this.bounded(this.strategy.rotateVersion(`${PREFIX}:revision:*`), deadline);
                this.recovering = result;
                void result.finally(() => {
                    if (this.recovering === result) this.recovering = undefined;
                });
            }
            global = await this.recovering;
            if (!global) return undefined;
            this.sharedUnavailable = false;
        }
        return `${global}:${channel}`;
    }

    async peek<T>(ctx: RequestContext, scopeKey: string): Promise<T | undefined> {
        if (ctx.activeUserId || this.accessContext.getStore()?.uncached) return undefined;
        const deadline = Date.now() + PEEK_BUDGET_MS;
        const revision = await this.revision(ctx.channelId, deadline);
        if (!revision || Date.now() >= deadline) return undefined;
        const entry = await this.bounded(
            this.cache.get<PublicEntry<any>>(this.key(ctx, scopeKey, revision)),
            deadline,
        );
        if (!entry || entry.expiresAt <= Date.now() || entry.revision !== revision || Date.now() >= deadline)
            return undefined;
        if (revision !== (await this.revision(ctx.channelId, deadline))) return undefined;
        await this.accessContext.getStore()?.assertReusable?.();
        if (Date.now() >= deadline || revision !== (await this.revision(ctx.channelId, deadline)))
            return undefined;
        this.metrics.hits++;
        return entry.value as T;
    }

    async readThrough<T>(
        ctx: RequestContext,
        scopeKey: string,
        ttlMs: number,
        loader: () => Promise<T>,
        options: { requireSharedRevision?: boolean; refresh?: boolean } = {},
    ): Promise<T> {
        if (ctx.activeUserId) throw new Error('Public cache requires an anonymous request context');
        const access = this.accessContext.getStore();
        if (access?.uncached) {
            this.metrics.bypasses++;
            return this.loadUncached(loader);
        }
        const ttl = Math.min(60_000, Math.max(1, ttlMs));
        const revision = await this.revision(ctx.channelId);
        const initialFallback = this.fallbackRevision;
        if (!revision && options.requireSharedRevision) throw this.unavailable();
        if (!revision) this.metrics.bypasses++;
        const key = this.key(ctx, scopeKey, revision ?? `uncached:${this.fallbackRevision}`);
        // A proactive refresh keeps the existing snapshot readable until its guarded replacement is ready.
        if (revision && !options.refresh) {
            const cached = await this.bounded(this.cache.get<PublicEntry<any>>(key));
            if (
                cached &&
                cached.revision === revision &&
                cached.expiresAt > Date.now() &&
                revision === (await this.revision(ctx.channelId))
            ) {
                await access?.assertReusable?.();
                if (revision === (await this.revision(ctx.channelId))) {
                    this.metrics.hits++;
                    return cached.value as T;
                }
            }
        }
        const existing = this.inFlight.get(key);
        if (existing) {
            const value = await (existing as Promise<T>);
            await access?.assertReusable?.();
            // A joined result has no independent fill ownership. Conservatively retry the read
            // if its original key generation changed, even if the owner has already retried.
            if (
                revision !== (await this.revision(ctx.channelId)) ||
                initialFallback !== this.fallbackRevision
            )
                throw this.unavailable();
            return value;
        }
        if (this.inFlight.size >= MAX_LOADERS + MAX_QUEUED) throw this.unavailable();
        this.metrics.misses++;
        const result = this.withLoaderPermit(async () => {
            for (let attempt = 0; attempt < 2; attempt++) {
                const before = await this.revision(ctx.channelId);
                const fallbackBefore = this.fallbackRevision;
                if (!before && options.requireSharedRevision) throw this.unavailable();
                const value = await loader();
                await access?.assertReusable?.();
                const after = await this.revision(ctx.channelId);
                if (!before || !after) {
                    if (options.requireSharedRevision) throw this.unavailable();
                    // Authoritative, uncached fallback is concurrency bounded. Never persist it.
                    if (!before && !after && fallbackBefore === this.fallbackRevision) return value;
                    this.metrics.superseded++;
                    this.requestCache?.clear(ctx);
                    continue;
                }
                if (before !== after) {
                    this.metrics.superseded++;
                    this.requestCache?.clear(ctx);
                    continue;
                }
                await this.bounded(
                    this.cache.set(
                        this.key(ctx, scopeKey, before),
                        { value, revision: before, expiresAt: Date.now() + ttl } as any,
                        { ttl },
                    ),
                );
                if (before !== (await this.revision(ctx.channelId))) {
                    this.metrics.superseded++;
                    this.requestCache?.clear(ctx);
                    continue;
                }
                await access?.assertReusable?.();
                if (before !== (await this.revision(ctx.channelId))) {
                    this.metrics.superseded++;
                    this.requestCache?.clear(ctx);
                    continue;
                }
                return value;
            }
            throw this.unavailable();
        });
        this.inFlight.set(key, result);
        try {
            return await result;
        } finally {
            if (this.inFlight.get(key) === result) this.inFlight.delete(key);
        }
    }

    async invalidate(channel: ID | RequestContext = '*'): Promise<void> {
        this.fallbackRevision++;
        const id = String(typeof channel === 'object' ? channel.channelId : channel);
        if (this.strategy.rotateVersion) {
            const rotated = await this.bounded(this.strategy.rotateVersion(`${PREFIX}:revision:${id}`));
            if (!rotated) {
                this.sharedUnavailable = true;
                throw this.unavailable();
            }
        } else {
            if (id !== '*' && !this.localRevisions.has(id) && this.localRevisions.size >= MAX_CHANNELS + 1) {
                const oldest = [...this.localRevisions.keys()].find(key => key !== '*');
                if (oldest) this.localRevisions.delete(oldest);
            }
            this.localRevisions.set(id, randomUUID());
        }
    }

    private async withLoaderPermit<T>(load: () => Promise<T>): Promise<T> {
        // Nested public projections share their root's permit; four outer loaders must not deadlock
        // while waiting for their own config/content loaders to acquire a fifth permit.
        if (this.loaderContext.getStore()) return load();
        if (this.activeLoaders >= MAX_LOADERS) {
            if (this.waiting.length >= MAX_QUEUED) throw this.unavailable();
            await new Promise<void>((resolve, reject) => {
                const ready = () => {
                    clearTimeout(timer);
                    resolve();
                };
                const timer = setTimeout(() => {
                    const index = this.waiting.indexOf(ready);
                    if (index !== -1) this.waiting.splice(index, 1);
                    reject(this.unavailable());
                }, 1000);
                this.waiting.push(ready);
            });
        } else this.activeLoaders++;
        try {
            return await this.loaderContext.run(true, load);
        } finally {
            const next = this.waiting.shift();
            if (next) next();
            else this.activeLoaders--;
        }
    }
    private unavailable(): ServiceUnavailableException {
        this.metrics.rejected++;
        return new ServiceUnavailableException('Public data is temporarily unavailable');
    }
    private get strategy(): RevisionStrategy {
        return this.config.systemOptions.cacheStrategy as RevisionStrategy;
    }
    private async version(id: string, deadline: number): Promise<string | undefined> {
        if (this.strategy.getOrCreateVersion)
            return this.bounded(this.strategy.getOrCreateVersion(`${PREFIX}:revision:${id}`), deadline);
        if (!this.localRevisions.has(id)) this.localRevisions.set(id, randomUUID());
        return this.localRevisions.get(id);
    }
    private key(ctx: RequestContext, scope: string, revision: string): string {
        const digest = createHash('sha256')
            .update(
                JSON.stringify([
                    String(ctx.channelId),
                    ctx.languageCode,
                    ctx.currencyCode,
                    'public',
                    scope,
                    revision,
                ]),
            )
            .digest('hex');
        return `${PREFIX}:entry:${digest}`;
    }
    private async bounded<T>(
        promise: Promise<T>,
        deadline = Date.now() + CACHE_TIMEOUT_MS,
    ): Promise<T | undefined> {
        const remaining = Math.min(CACHE_TIMEOUT_MS, deadline - Date.now());
        if (remaining <= 0) {
            void promise.catch(() => undefined);
            return undefined;
        }
        let cancelTimer: (() => void) | undefined;
        try {
            return await Promise.race([
                promise.catch(() => undefined),
                new Promise<undefined>(resolve => {
                    const timer = setTimeout(() => resolve(undefined), remaining);
                    cancelTimer = () => clearTimeout(timer);
                }),
            ]);
        } finally {
            cancelTimer?.();
        }
    }
}
