import { describe, expect, it, vi } from 'vitest';

import { storefrontCachePlugins } from './storefront-cache-config';
vi.mock('@vendure/core', () => ({ RedisCachePlugin: { init: (options: unknown) => options } }));
vi.mock('@vendure/store-management-plugin', async () => {
    const { storefrontCdnPurgeConfiguration } =
        await import('../store-management-plugin/src/performance/storefront-cdn-purge-config');
    return { storefrontCdnPurgeConfiguration };
});

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

describe('shared exact-purge startup routing validation', () => {
    const valid = {
        STOREFRONT_REDIS_URL: 'rediss://cache.example:6380/2',
        STOREFRONT_CDN_PURGE_ENABLED: 'true',
        STOREFRONT_CLOUDFLARE_PURGE_TOKEN: 'fixture-placeholder',
        STOREFRONT_CLOUDFLARE_ZONES: JSON.stringify({
            'alpha.invalid': 'a'.repeat(32),
            'beta.invalid': 'b'.repeat(32),
            'gamma.invalid': 'c'.repeat(32),
        }),
    };
    it('starts with a complete three-zone map and no legacy zone', () => {
        const [options] = storefrontCachePlugins(valid) as any;
        expect(options.namespace).toBe('vendure-storefront-cache-v1');
        expect(options.redisOptions).toMatchObject({ host: 'cache.example', port: 6380, db: 2 });
    });
    it('retains valid legacy routing without a map', () => {
        const [options] = storefrontCachePlugins({
            ...valid,
            STOREFRONT_CLOUDFLARE_ZONES: '',
            STOREFRONT_CLOUDFLARE_ZONE_ID: 'a'.repeat(32),
        }) as any;
        expect(options.redisOptions.host).toBe('cache.example');
        expect(() => storefrontCachePlugins({ ...valid, STOREFRONT_CLOUDFLARE_ZONES: '' })).toThrow(
            'configuration is incomplete',
        );
    });
    it.each([
        'not-json',
        'null',
        '[]',
        '{}',
        JSON.stringify({ 'example.invalid': 1 }),
        JSON.stringify({ 'example.invalid': 'not-a-zone' }),
        JSON.stringify({ 'Example.invalid': 'a'.repeat(32) }),
        JSON.stringify({ '*.example.invalid': 'a'.repeat(32) }),
        JSON.stringify({ 'example.invalid:443': 'a'.repeat(32) }),
        JSON.stringify({ 'example.invalid/': 'a'.repeat(32) }),
        JSON.stringify({ 'example.invalid.': 'a'.repeat(32) }),
        JSON.stringify({ '999.1.2.3': 'a'.repeat(32) }),
        JSON.stringify({ 'example.invalid': 'a'.repeat(32), 'other.invalid': 'not-a-zone' }),
    ])('rejects invalid full mapping even when the legacy zone is valid: %s', raw => {
        expect(() =>
            storefrontCachePlugins({
                ...valid,
                STOREFRONT_CLOUDFLARE_ZONE_ID: 'a'.repeat(32),
                STOREFRONT_CLOUDFLARE_ZONES: raw,
            }),
        ).toThrow('hostname map is invalid');
    });
    it.each(['', ' '])('requires a nonblank token with map-only routing: %j', token => {
        expect(() => storefrontCachePlugins({ ...valid, STOREFRONT_CLOUDFLARE_PURGE_TOKEN: token })).toThrow(
            'configuration is incomplete',
        );
    });
    it.each(['', ' '])('requires Redis with map-only routing: %j', address => {
        expect(() => storefrontCachePlugins({ ...valid, STOREFRONT_REDIS_URL: address })).toThrow(
            'requires Redis',
        );
    });
    it('ignores invalid purge routing while disabled and retains ordinary Redis validation', () => {
        expect(
            storefrontCachePlugins({
                STOREFRONT_CDN_PURGE_ENABLED: 'false',
                STOREFRONT_CLOUDFLARE_ZONES: 'not-json',
            }),
        ).toEqual([]);
        expect(() =>
            storefrontCachePlugins({
                ...valid,
                STOREFRONT_CDN_PURGE_ENABLED: 'false',
                STOREFRONT_CLOUDFLARE_ZONES: 'not-json',
                STOREFRONT_REDIS_URL: 'https://cache.example',
            }),
        ).toThrow('must use redis or rediss');
    });
});
