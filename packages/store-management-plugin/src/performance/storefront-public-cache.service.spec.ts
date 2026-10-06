import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorefrontPublicCacheService } from './storefront-public-cache.service';

vi.mock('@vendure/core', () => ({ CacheService: class {}, ConfigService: class {} }));
const ctx = { channelId: 'a', languageCode: 'en', currencyCode: 'MYR' } as any;
function harness() {
    const entries = new Map<string, unknown>();
    const versions = new Map<string, string>();
    let generation = 0;
    const strategy = {
        getOrCreateVersion: vi.fn((key: string) => {
            if (!versions.has(key)) versions.set(key, String(++generation));
            return Promise.resolve(versions.get(key));
        }),
        rotateVersion: vi.fn((key: string) => {
            versions.set(key, String(++generation));
            return Promise.resolve(versions.get(key));
        }),
    };
    const cache = {
        get: vi.fn((key: string) => Promise.resolve(entries.get(key))),
        set: vi.fn((key: string, value: unknown) => {
            entries.set(key, value);
            return Promise.resolve();
        }),
    };
    const service = new StorefrontPublicCacheService(
        cache as any,
        { systemOptions: { cacheStrategy: strategy } } as any,
    );
    return { service, cache, strategy, entries };
}
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
afterEach(() => vi.useRealTimers());

describe('public cache boundaries', () => {
    it('singleflights concurrent reads and separates store, language, currency and host scopes', async () => {
        const { service } = harness();
        const loader = vi.fn(async () => {
            await pause(5);
            return { public: true };
        });
        await Promise.all(
            Array.from({ length: 25 }, () => service.readThrough(ctx, 'host:a', 30000, loader)),
        );
        expect(loader).toHaveBeenCalledTimes(1);
        for (const variant of [
            { ...ctx, channelId: 'b' },
            { ...ctx, languageCode: 'zh_Hans' },
            { ...ctx, currencyCode: 'USD' },
        ])
            await service.readThrough(variant, 'host:a', 30000, loader);
        await service.readThrough(ctx, 'host:b', 30000, loader);
        expect(loader).toHaveBeenCalledTimes(5);
        await expect(
            service.readThrough({ ...ctx, activeUserId: 'private' }, 'host:a', 30000, loader),
        ).rejects.toThrow('anonymous');
        expect(await service.peek({ ...ctx, activeUserId: 'private' }, 'host:a')).toBeUndefined();
    });
    it('uses shared revisions across independently constructed API and worker services', async () => {
        const test = harness();
        const worker = new StorefrontPublicCacheService(
            test.cache as any,
            { systemOptions: { cacheStrategy: test.strategy } } as any,
        );
        await test.service.readThrough(ctx, 'page', 30000, () => Promise.resolve('old'));
        await worker.invalidate('a');
        expect(await test.service.peek(ctx, 'page')).toBeUndefined();
        expect(await test.service.readThrough(ctx, 'page', 30000, () => Promise.resolve('new'))).toBe('new');
    });
    it('does not resurrect a stale entry when invalidation races peek', async () => {
        const { service, cache } = harness();
        await service.readThrough(ctx, 'page', 30000, () => Promise.resolve('old'));
        const original = cache.get.getMockImplementation();
        if (!original) throw new Error('Expected cache reader implementation');
        cache.get.mockImplementationOnce(async key => {
            const value = await original(key);
            await service.invalidate('a');
            return value;
        });
        expect(await service.peek(ctx, 'page')).toBeUndefined();
    });
    it('retries a changed generation and fails closed if the second load also races a withdrawal', async () => {
        const { service } = harness();
        const loader = vi.fn(async () => {
            await service.invalidate('a');
            return 'revoked';
        });
        await expect(service.readThrough(ctx, 'media', 30000, loader)).rejects.toMatchObject({ status: 503 });
        expect(loader).toHaveBeenCalledTimes(2);
        expect(await service.peek(ctx, 'media')).toBeUndefined();
    });
    it('returns a newly loaded snapshot after one publication change', async () => {
        const { service } = harness();
        const loader = vi
            .fn()
            .mockImplementationOnce(async () => {
                await service.invalidate('a');
                return 'old';
            })
            .mockResolvedValue('new');
        expect(await service.readThrough(ctx, 'media', 30000, loader)).toBe('new');
        expect(await service.peek(ctx, 'media')).toBe('new');
    });
    it('bounds uncached outage fallback, deduplicates same keys and clears pre-outage snapshots on recovery', async () => {
        const test = harness();
        const healthy = test.strategy.getOrCreateVersion.getMockImplementation();
        if (!healthy) throw new Error('Expected revision reader implementation');
        await test.service.readThrough(ctx, 'page', 30000, () => Promise.resolve('old'));
        test.strategy.getOrCreateVersion.mockRejectedValue(new Error('offline'));
        const fallback = vi.fn(async () => {
            await pause(5);
            return 'fresh';
        });
        expect(
            await Promise.all(
                Array.from({ length: 25 }, () => test.service.readThrough(ctx, 'page', 30000, fallback)),
            ),
        ).toEqual(Array(25).fill('fresh'));
        expect(fallback).toHaveBeenCalledOnce();
        await expect(
            test.service.readThrough(ctx, 'manifest', 30000, fallback, { requireSharedRevision: true }),
        ).rejects.toMatchObject({ status: 503 });
        expect(test.cache.set).toHaveBeenCalledTimes(1);
        test.strategy.getOrCreateVersion.mockImplementation(healthy);
        expect(await test.service.peek(ctx, 'page')).toBeUndefined();
        expect(test.strategy.rotateVersion).toHaveBeenCalled();
        expect(await test.service.readThrough(ctx, 'page', 30000, () => Promise.resolve('recovered'))).toBe(
            'recovered',
        );
    });
    it('limits root loaders to four and rejects overflow instead of starting unlimited database reads', async () => {
        const { service, strategy } = harness();
        strategy.getOrCreateVersion.mockRejectedValue(new Error('offline'));
        let active = 0;
        let max = 0;
        let release!: () => void;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });
        const loader = async () => {
            active++;
            max = Math.max(max, active);
            await gate;
            active--;
            return true;
        };
        const all = Promise.allSettled(
            Array.from({ length: 60 }, (_, i) => service.readThrough(ctx, `page:${i}`, 30000, loader)),
        );
        await pause(20);
        expect(active).toBe(4);
        release();
        const results = await all;
        expect(max).toBe(4);
        expect(results.filter(item => item.status === 'rejected')).toHaveLength(24);
    });
    it('shares permits with nested projections, so four outer loaders cannot deadlock', async () => {
        const { service } = harness();
        const values = await Promise.all(
            Array.from({ length: 4 }, (_, i) =>
                service.readThrough(ctx, `page:${i}`, 30000, async () => {
                    return Promise.all(
                        ['config', 'content', 'collections'].map(key =>
                            service.readThrough(ctx, `${key}:${i}`, 30000, () => Promise.resolve(key)),
                        ),
                    );
                }),
            ),
        );
        expect(values).toEqual(Array(4).fill(['config', 'content', 'collections']));
    });
    it('expires bounded entries and never executes a loader during peek', async () => {
        const { service } = harness();
        const clock = vi.spyOn(Date, 'now').mockReturnValue(10000);
        try {
            const load = vi.fn(() => Promise.resolve('value'));
            await service.readThrough(ctx, 'page', 30000, load);
            clock.mockReturnValue(40001);
            expect(await service.peek(ctx, 'page')).toBeUndefined();
            expect(load).toHaveBeenCalledOnce();
        } finally {
            clock.mockRestore();
        }
    });
    it('keeps SSI peek inside its total 200ms deadline even when every cache stage is slow', async () => {
        const { service, strategy, cache } = harness();
        await service.readThrough(ctx, 'page', 30000, () => Promise.resolve(true));
        const originalVersion = strategy.getOrCreateVersion.getMockImplementation();
        const originalGet = cache.get.getMockImplementation();
        if (!originalVersion || !originalGet) throw new Error('Expected cache implementations');
        strategy.getOrCreateVersion.mockImplementation(async key => {
            await pause(85);
            return originalVersion(key);
        });
        cache.get.mockImplementation(async key => {
            await pause(85);
            return originalGet(key);
        });
        const start = performance.now();
        expect(await service.peek(ctx, 'page')).toBeUndefined();
        expect(performance.now() - start).toBeLessThan(350);
    });
});
