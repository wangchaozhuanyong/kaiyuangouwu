import { JsonCompatible } from '@vendure/common/lib/shared-types';

import { CacheTtlProvider, DefaultCacheTtlProvider } from '../../cache/cache-ttl-provider';

import { CacheStrategy, SetCacheKeyOptions } from './cache-strategy';

export interface CacheItem<T> {
    value: JsonCompatible<T>;
    expires?: number;
    tags?: string[];
}

/**
 * A {@link CacheStrategy} that stores the cache in memory using a simple
 * JavaScript Map.
 *
 * This is the default strategy that will be used if no other strategy is
 * configured.
 *
 * **Caution** do not use this in a multi-instance deployment because
 * cache invalidation will not propagate to other instances.
 *
 * @since 3.1.0
 */
export class InMemoryCacheStrategy implements CacheStrategy {
    protected cache = new Map<string, CacheItem<any>>();
    protected cacheTags = new Map<string, Set<string>>();
    protected cacheSize = 10_000;
    protected ttlProvider: CacheTtlProvider;
    private lastPrunedAt: number | undefined;

    constructor(config?: { cacheSize?: number; cacheTtlProvider?: CacheTtlProvider }) {
        if (config?.cacheSize) {
            this.cacheSize = config.cacheSize;
        }
        this.ttlProvider = config?.cacheTtlProvider || new DefaultCacheTtlProvider();
    }

    async get<T extends JsonCompatible<T>>(key: string): Promise<T | undefined> {
        const hit = this.cache.get(key);
        if (hit) {
            if (!hit.expires || (hit.expires && this.ttlProvider.getTime() < hit.expires)) {
                return Promise.resolve(hit.value);
            } else {
                this.remove(key);
            }
        }
        return Promise.resolve(undefined);
    }

    async set<T extends JsonCompatible<T>>(key: string, value: T, options?: SetCacheKeyOptions) {
        const now = this.ttlProvider.getTime();
        this.pruneExpired(now);
        if (this.cache.has(key)) {
            // delete key to put the item to the end of
            // the cache, marking it as new again
            this.remove(key);
        } else if (this.cache.size === this.cacheSize) {
            // evict oldest
            const oldest = this.first();
            if (oldest) {
                this.remove(oldest);
            }
        }
        this.cache.set(key, {
            value,
            expires: options?.ttl ? now + options.ttl : undefined,
            tags: options?.tags ? [...new Set(options.tags)] : undefined,
        });
        if (options?.tags) {
            for (const tag of options.tags) {
                const tagged = this.cacheTags.get(tag) || new Set<string>();
                tagged.add(key);
                this.cacheTags.set(tag, tagged);
            }
        }
        return Promise.resolve();
    }

    async delete(key: string) {
        this.remove(key);
        return Promise.resolve();
    }

    async invalidateTags(tags: string[]) {
        for (const tag of tags) {
            const tagged = this.cacheTags.get(tag);
            if (tagged) {
                for (const key of tagged) {
                    this.remove(key);
                }
                this.cacheTags.delete(tag);
            }
        }
        return Promise.resolve();
    }

    private pruneExpired(now: number) {
        // Revisioned keys are never read again after invalidation. Reclaim their
        // expired payloads on writes without scanning the full cache on every write.
        if (this.lastPrunedAt != null && now >= this.lastPrunedAt && now - this.lastPrunedAt < 1000) {
            return;
        }
        this.lastPrunedAt = now;
        for (const [key, item] of this.cache) {
            if (item.expires != null && item.expires <= now) this.remove(key);
        }
    }

    private remove(key: string) {
        const item = this.cache.get(key);
        this.cache.delete(key);
        for (const tag of item?.tags ?? []) {
            const tagged = this.cacheTags.get(tag);
            tagged?.delete(key);
            if (tagged?.size === 0) this.cacheTags.delete(tag);
        }
    }

    private first() {
        return this.cache.keys().next().value;
    }
}
