import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorefrontPublicCacheService } from './storefront-public-cache.service';

vi.mock('@vendure/core', () => ({
    CacheService: class {},
    ConfigService: class {},
    RequestContextCacheService: class {},
}));
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
    it('does not return an old snapshot if publication changes while an access guard is awaiting', async () => {
        const { service } = harness();
        await service.readThrough(ctx, 'page', 30_000, () => Promise.resolve('old'));
        const guard = vi
            .fn()
            .mockImplementationOnce(() => service.invalidate('a'))
            .mockResolvedValue(undefined);
        const loader = vi.fn(() => Promise.resolve('new'));
        expect(await service.runGuarded(guard, () => service.readThrough(ctx, 'page', 30_000, loader))).toBe(
            'new',
        );
        expect(loader).toHaveBeenCalledTimes(1);
        expect(
            await service.runGuarded(
                () => service.invalidate('a'),
                () => service.peek(ctx, 'page'),
            ),
        ).toBeUndefined();
    });

    it('retries a fill when its final access lookup races with publication', async () => {
        const { service } = harness();
        const guard = vi
            .fn()
            .mockResolvedValueOnce(undefined)
            .mockImplementationOnce(() => service.invalidate('a'))
            .mockResolvedValue(undefined);
        let generation = 0;
        const result = await service.runGuarded(guard, () =>
            service.readThrough(ctx, 'page', 30_000, () => Promise.resolve(++generation)),
        );
        expect(result).toBe(2);
        expect(await service.peek(ctx, 'page')).toBe(2);
    });

    it('rejects a joined result if its original generation changed after the owner completed', async () => {
        const { service } = harness();
        let release!: () => void;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });
        const loaded = vi.fn();
        const owner = service.readThrough(ctx, 'page', 30_000, async () => {
            loaded();
            await gate;
            return 'old';
        });
        await vi.waitFor(() => expect(loaded).toHaveBeenCalled());
        const joined = service.runGuarded(
            () => service.invalidate('a'),
            () => service.readThrough(ctx, 'page', 30_000, () => Promise.resolve('unexpected')),
        );
        // Allow the joined caller to register against the owner's in-flight key.
        await pause(5);
        release();
        expect(await owner).toBe('old');
        await expect(joined).rejects.toThrow('Public data is temporarily unavailable');
        expect(await service.peek(ctx, 'page')).toBeUndefined();
    });
    it('bypasses existing snapshots and nested cache operations for each preview while retaining origin limits', async () => {
        const { service, cache } = harness();
        await service.readThrough(ctx, 'section', 30_000, () => Promise.resolve('live'));
        cache.get.mockClear();
        cache.set.mockClear();
        let calls = 0;
        const preview = () =>
            service.runUncached(async () => {
                expect(await service.peek(ctx, 'section')).toBeUndefined();
                return service.readThrough(ctx, 'page', 30_000, () =>
                    service.readThrough(ctx, 'section', 30_000, () => Promise.resolve(++calls)),
                );
            });
        expect(await Promise.all([preview(), preview()])).toEqual([1, 2]);
        expect(cache.get).not.toHaveBeenCalled();
        expect(cache.set).not.toHaveBeenCalled();
        expect(await service.peek(ctx, 'section')).toBe('live');
    });

    it('keeps preview origin work under the same four-loader permit and isolates concurrent live contexts', async () => {
        const { service } = harness();
        let active = 0;
        let maximum = 0;
        await Promise.all(
            Array.from({ length: 10 }, () =>
                service.runUncached(async () => {
                    active++;
                    maximum = Math.max(maximum, active);
                    await pause(5);
                    active--;
                }),
            ),
        );
        expect(maximum).toBe(4);
        await Promise.all([
            service.runUncached(() =>
                service.readThrough(ctx, 'shared', 30_000, () => Promise.resolve('preview')),
            ),
            service.readThrough(ctx, 'shared', 30_000, () => Promise.resolve('live')),
        ]);
        expect(await service.peek(ctx, 'shared')).toBe('live');
    });

    it('keeps the preview permit while optional work outlives the page response budget', async () => {
        const { service } = harness();
        let release!: () => void;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });
        const started = vi.fn();
        const responses = Array.from({ length: 4 }, () =>
            service.runUncached(() => {
                const optional = service.readThrough(ctx, 'slow-optional', 30_000, async () => {
                    started();
                    await gate;
                    return 'late';
                });
                return Promise.race([optional, Promise.resolve('response-budget-ended')]);
            }),
        );
        expect(await Promise.all(responses)).toEqual(Array(4).fill('response-budget-ended'));
        expect(started).toHaveBeenCalledTimes(4);
        const fifthStarted = vi.fn();
        const fifth = service.runUncached(() => {
            fifthStarted();
            return Promise.resolve('fifth');
        });
        await pause(10);
        expect(fifthStarted).not.toHaveBeenCalled();
        release();
        expect(await fifth).toBe('fifth');
        expect(fifthStarted).toHaveBeenCalledTimes(1);
    });

    it('carries the access guard into a late nested fill and never persists a revoked result', async () => {
        const { service, cache } = harness();
        let live = true;
        let release!: () => void;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });
        const guard = () => (live ? Promise.resolve() : Promise.reject(new Error('revoked')));
        const started = vi.fn();
        const result = service.runGuarded(guard, () =>
            service.readThrough(ctx, 'page', 30_000, async () => {
                return service.readThrough(ctx, 'optional', 30_000, async () => {
                    started();
                    await gate;
                    return 'old';
                });
            }),
        );
        await vi.waitFor(() => expect(started).toHaveBeenCalled());
        live = false;
        await service.invalidate('a');
        release();
        await expect(result).rejects.toThrow('revoked');
        expect(cache.set).not.toHaveBeenCalled();
        expect(await service.peek(ctx, 'optional')).toBeUndefined();
        expect(await service.peek(ctx, 'page')).toBeUndefined();
    });
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
    it('refreshes one key while its existing snapshot stays readable and keeps generation guards', async () => {
        const { service } = harness();
        await service.readThrough(ctx, 'page', 30000, () => Promise.resolve('previous'));
        let release!: () => void;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });
        const load = vi.fn(async () => {
            await gate;
            return 'refreshed';
        });
        const refreshes = Array.from({ length: 8 }, () =>
            service.readThrough(ctx, 'page', 30000, load, { refresh: true }),
        );
        await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
        expect(await service.peek(ctx, 'page')).toBe('previous');
        release();
        expect(await Promise.all(refreshes)).toEqual(Array(8).fill('refreshed'));
        expect(await service.peek(ctx, 'page')).toBe('refreshed');
        const racing = vi
            .fn()
            .mockImplementationOnce(async () => {
                await service.invalidate('a');
                return 'revoked';
            })
            .mockResolvedValue('after-publication');
        expect(await service.readThrough(ctx, 'page', 30000, racing, { refresh: true })).toBe(
            'after-publication',
        );
        expect(racing).toHaveBeenCalledTimes(2);
        expect(await service.peek(ctx, 'page')).toBe('after-publication');
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
