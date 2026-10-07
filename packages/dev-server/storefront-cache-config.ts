import { RedisCachePlugin } from '@vendure/core';
import { storefrontCdnPurgeConfiguration } from '@vendure/store-management-plugin';

/** Opt-in only. No Redis connection or infrastructure change when the URL is absent. */
export function storefrontCachePlugins(env: NodeJS.ProcessEnv = process.env) {
    const address = env.STOREFRONT_REDIS_URL?.trim();
    if (env.STOREFRONT_CDN_PURGE_ENABLED === 'true') {
        if (!address)
            throw new Error('Exact media purge requires Redis, Cloudflare routing and a purge token');
        storefrontCdnPurgeConfiguration(env);
    }
    if (!address) return [];
    let url: URL;
    try {
        url = new URL(address);
    } catch {
        throw new Error('STOREFRONT_REDIS_URL must be a Redis URL');
    }
    if (!['redis:', 'rediss:'].includes(url.protocol))
        throw new Error('STOREFRONT_REDIS_URL must use redis or rediss');
    const db = Number(url.pathname.slice(1) || 0);
    if (!Number.isInteger(db) || db < 0) throw new Error('STOREFRONT_REDIS_URL has an invalid database');
    return [
        RedisCachePlugin.init({
            namespace: 'vendure-storefront-cache-v1',
            maxItemSizeInBytes: 2_000_000,
            redisOptions: {
                host: url.hostname,
                port: Number(url.port || 6379),
                ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
                ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
                ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
                db,
                connectTimeout: 500,
                commandTimeout: 100,
                maxRetriesPerRequest: 0,
                enableOfflineQueue: false,
                retryStrategy: attempts => Math.min(1000 * attempts, 10_000),
            },
        }),
    ];
}
