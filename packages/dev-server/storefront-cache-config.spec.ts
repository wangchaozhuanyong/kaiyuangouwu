import { describe, expect, it, vi } from 'vitest';

import { storefrontCachePlugins } from './storefront-cache-config';
vi.mock('@vendure/core', () => ({ RedisCachePlugin: { init: (options: unknown) => options } }));
describe('optional shared public cache configuration', () => {
    it('keeps Redis and CDN purge disabled by default', () => {
        expect(storefrontCachePlugins({})).toEqual([]);
    });
    it('configures bounded Redis operations without enabling an offline queue', () => {
        const [options] = storefrontCachePlugins({
            STOREFRONT_REDIS_URL: 'rediss://cache.example:6380/2',
        }) as any;
        expect(options.redisOptions).toMatchObject({
            host: 'cache.example',
            port: 6380,
            db: 2,
            tls: {},
            connectTimeout: 500,
            commandTimeout: 100,
            maxRetriesPerRequest: 0,
            enableOfflineQueue: false,
        });
        expect(options.namespace).toBe('vendure-storefront-cache-v1');
    });
    it('rejects incomplete exact-purge setup and non-Redis URLs without exposing credentials', () => {
        expect(() => storefrontCachePlugins({ STOREFRONT_CDN_PURGE_ENABLED: 'true' })).toThrow(
            'requires Redis',
        );
        expect(() =>
            storefrontCachePlugins({
                STOREFRONT_REDIS_URL: 'https://fixture-user:fixture-placeholder@cache.example',
            }),
        ).toThrow('must use redis or rediss');
        expect(() => storefrontCachePlugins({ STOREFRONT_REDIS_URL: 'redis://cache.example/-1' })).toThrow(
            'invalid database',
        );
    });
});
