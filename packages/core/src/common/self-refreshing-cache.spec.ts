import { beforeAll, describe, expect, it, vi } from 'vitest';

import { Logger } from '../config/logger/vendure-logger';

import { createSelfRefreshingCache, SelfRefreshingCache } from './self-refreshing-cache';

describe('SelfRefreshingCache', () => {
    let testCache: SelfRefreshingCache<number, [string]>;
    const fetchFn = vi.fn().mockImplementation((arg: string) => arg.length);
    let currentTime = 0;
    beforeAll(async () => {
        testCache = await createSelfRefreshingCache<number, [string]>({
            name: 'test',
            ttl: 1000,
            refresh: {
                fn: arg => {
                    return Promise.resolve(fetchFn(arg) as number);
                },
                defaultArgs: ['default'],
            },
            getTimeFn: () => currentTime,
        });
    });

    it('fetches value on first call', async () => {
        const result = await testCache.value();
        expect(result).toBe(7);
        expect(fetchFn.mock.calls.length).toBe(1);
    });

    it('passes default args on first call', () => {
        expect(fetchFn.mock.calls[0]).toEqual(['default']);
    });

    it('return from cache on second call', async () => {
        const result = await testCache.value();
        expect(result).toBe(7);
        expect(fetchFn.mock.calls.length).toBe(1);
    });

    it('automatically refresh after ttl expires', async () => {
        currentTime = 1001;
        const result = await testCache.value('custom');
        expect(result).toBe(6);
        expect(fetchFn.mock.calls.length).toBe(2);
    });

    it('refresh forces fetch with supplied args', async () => {
        const result = await testCache.refresh('new arg which is longer');
        expect(result).toBe(23);
        expect(fetchFn.mock.calls.length).toBe(3);
        expect(fetchFn.mock.calls[2]).toEqual(['new arg which is longer']);
    });

    describe('memoization', () => {
        const memoizedFn = vi.fn();
        let getMemoized: (arg1: string, arg2: number) => Promise<number>;

        beforeAll(() => {
            getMemoized = async (arg1, arg2) => {
                return testCache.memoize([arg1, arg2], ['quux'], (value, a1, a2) => {
                    memoizedFn(a1, a2);
                    return value * +a2;
                });
            };
        });

        it('calls the memoized function only once for the given args', async () => {
            const result1 = await getMemoized('foo', 1);
            expect(result1).toBe(23 * 1);
            expect(memoizedFn.mock.calls.length).toBe(1);
            expect(memoizedFn.mock.calls[0]).toEqual(['foo', 1]);

            const result2 = await getMemoized('foo', 1);
            expect(result2).toBe(23 * 1);
            expect(memoizedFn.mock.calls.length).toBe(1);
        });

        it('calls the memoized function when args change', async () => {
            const result1 = await getMemoized('foo', 2);
            expect(result1).toBe(23 * 2);
            expect(memoizedFn.mock.calls.length).toBe(2);
            expect(memoizedFn.mock.calls[1]).toEqual(['foo', 2]);
        });

        it('retains memoized results from earlier calls', async () => {
            const result1 = await getMemoized('foo', 1);
            expect(result1).toBe(23 * 1);
            expect(memoizedFn.mock.calls.length).toBe(2);
        });

        it('re-fetches and re-runs memoized function after ttl expires', async () => {
            currentTime = 3000;
            const result1 = await getMemoized('foo', 1);
            expect(result1).toBe(4 * 1);
            expect(memoizedFn.mock.calls.length).toBe(3);

            await getMemoized('foo', 1);
            expect(memoizedFn.mock.calls.length).toBe(3);
        });

        it('works with alternating calls', async () => {
            const result1 = await getMemoized('foo', 1);
            expect(result1).toBe(4 * 1);
            expect(memoizedFn.mock.calls.length).toBe(3);

            const result2 = await getMemoized('foo', 3);
            expect(result2).toBe(4 * 3);
            expect(memoizedFn.mock.calls.length).toBe(4);

            const result3 = await getMemoized('foo', 1);
            expect(result3).toBe(4 * 1);
            expect(memoizedFn.mock.calls.length).toBe(4);

            const result4 = await getMemoized('foo', 3);
            expect(result4).toBe(4 * 3);
            expect(memoizedFn.mock.calls.length).toBe(4);

            const result5 = await getMemoized('foo', 1);
            expect(result5).toBe(4 * 1);
            expect(memoizedFn.mock.calls.length).toBe(4);
        });
    });
});

function deferredValue() {
    let resolveValue: (value: number) => void = () => undefined;
    let rejectValue: (error: Error) => void = () => undefined;
    const promise = new Promise<number>((resolve, reject) => {
        resolveValue = resolve;
        rejectValue = reject;
    });
    return { promise, resolve: resolveValue, reject: rejectValue };
}

async function deferredCache() {
    let testTime = 0;
    const refreshes: Array<ReturnType<typeof deferredValue>> = [];
    const fetch = vi.fn((arg: string): Promise<number> => {
        if (fetch.mock.calls.length === 1) return Promise.resolve(arg.length);
        const pending = deferredValue();
        refreshes.push(pending);
        return pending.promise;
    });
    const cache = await createSelfRefreshingCache<number, [string]>({
        name: 'concurrent-test',
        ttl: 1000,
        refresh: { fn: fetch, defaultArgs: ['initial'] },
        getTimeFn: () => testTime,
    });
    return {
        cache,
        fetch,
        refreshes,
        refreshAt: (index: number) => {
            const pending = refreshes[index];
            if (!pending) throw new Error(`Missing refresh ${index}`);
            return pending;
        },
        setTime: (time: number) => {
            testTime = time;
        },
    };
}

describe('SelfRefreshingCache concurrent refreshes', () => {
    it('shares one origin refresh across concurrent expired reads with normalized default arguments', async () => {
        const { cache, fetch, refreshes, setTime } = await deferredCache();
        setTime(1001);
        const reads = [cache.value(), cache.value(undefined), cache.value('initial')];
        const originCalls = fetch.mock.calls.length;
        refreshes.forEach(pending => pending.resolve(20));

        expect(await Promise.all(reads)).toEqual([20, 20, 20]);
        expect(originCalls).toBe(2);
        expect(fetch.mock.calls[1]).toEqual(['initial']);
    });

    it('shares a memoized refresh and retains different memoized keys when no value read requests clearing', async () => {
        const { cache, fetch, refreshes, setTime } = await deferredCache();
        const mapper = vi.fn((value: number, multiplier: number) => value * multiplier);
        setTime(1001);
        const reads = [
            cache.memoize([2], ['shared-source'], mapper),
            cache.memoize([3], ['shared-source'], mapper),
        ];
        const originCalls = fetch.mock.calls.length;
        refreshes.forEach(pending => pending.resolve(20));

        expect(await Promise.all(reads)).toEqual([40, 60]);
        expect(await cache.memoize([2], ['shared-source'], mapper)).toBe(40);
        expect(await cache.memoize([3], ['shared-source'], mapper)).toBe(60);
        expect(mapper).toHaveBeenCalledTimes(2);
        expect(originCalls).toBe(2);
    });

    it('clears memoized entries when a value read joins a refresh started by memoize', async () => {
        const { cache, fetch, refreshes, setTime } = await deferredCache();
        const mapper = vi.fn((value: number) => value * 2);
        setTime(1001);
        const memoized = cache.memoize(['key'], ['shared-source'], mapper);
        const valueRead = cache.value('shared-source');
        const originCalls = fetch.mock.calls.length;
        refreshes.forEach(pending => pending.resolve(20));

        expect(await memoized).toBe(40);
        expect(await valueRead).toBe(20);
        expect(await cache.memoize(['key'], ['shared-source'], mapper)).toBe(40);
        expect(mapper).toHaveBeenCalledTimes(2);
        expect(originCalls).toBe(2);
    });

    it('shares a failed refresh, returns the previous value and retries without extending its TTL', async () => {
        const { cache, fetch, refreshes, refreshAt, setTime } = await deferredCache();
        const errorLog = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
        try {
            setTime(1001);
            const reads = [cache.value(), cache.value(), cache.value()];
            const originCalls = fetch.mock.calls.length;
            refreshes.forEach(pending => pending.reject(new Error('database unavailable')));
            expect(await Promise.all(reads)).toEqual([7, 7, 7]);

            const retry = cache.value('retry');
            refreshAt(refreshes.length - 1).resolve(20);
            expect(await retry).toBe(20);
            expect(originCalls).toBe(2);
            expect(fetch).toHaveBeenCalledTimes(3);
            expect(errorLog).toHaveBeenCalledTimes(1);
        } finally {
            errorLog.mockRestore();
        }
    });

    it('shares a synchronous refresh failure, returns the previous value and can retry', async () => {
        let testTime = 0;
        const fetch = vi
            .fn<(arg: string) => Promise<number>>()
            .mockResolvedValueOnce(7)
            .mockImplementationOnce(() => {
                throw new Error('synchronous database failure');
            })
            .mockResolvedValue(20);
        const cache = await createSelfRefreshingCache<number, [string]>({
            name: 'sync-error-test',
            ttl: 1000,
            refresh: { fn: fetch, defaultArgs: ['initial'] },
            getTimeFn: () => testTime,
        });
        const errorLog = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
        try {
            testTime = 1001;
            expect(await Promise.all([cache.value(), cache.value(), cache.value()])).toEqual([7, 7, 7]);
            expect(fetch).toHaveBeenCalledTimes(2);
            expect(errorLog).toHaveBeenCalledTimes(1);
            expect(await cache.value()).toBe(20);
            expect(fetch).toHaveBeenCalledTimes(3);
        } finally {
            errorLog.mockRestore();
        }
    });

    it('starts the successful refresh TTL when the origin completes', async () => {
        const { cache, fetch, refreshAt, setTime } = await deferredCache();
        setTime(1001);
        const read = cache.value();
        setTime(1500);
        refreshAt(0).resolve(20);
        expect(await read).toBe(20);

        setTime(2500);
        expect(await cache.value()).toBe(20);
        expect(fetch).toHaveBeenCalledTimes(2);
        setTime(2501);
        const next = cache.value();
        refreshAt(1).resolve(30);
        expect(await next).toBe(30);
        expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('forces each explicit refresh and ignores an older automatic or explicit result', async () => {
        const { cache, fetch, refreshAt, setTime } = await deferredCache();
        setTime(1001);
        const automatic = cache.value('before-write');
        const firstForced = cache.refresh('after-write');
        const lastForced = cache.refresh('after-write');

        refreshAt(2).resolve(30);
        expect(await lastForced).toBe(30);
        refreshAt(1).resolve(20);
        await firstForced;
        refreshAt(0).resolve(10);
        await automatic;

        expect(await cache.value()).toBe(30);
        expect(fetch).toHaveBeenCalledTimes(4);
        expect(fetch.mock.calls.slice(1)).toEqual([['before-write'], ['after-write'], ['after-write']]);
    });

    it('does not let an older completion clear the newer pending refresh', async () => {
        const { cache, fetch, refreshes, refreshAt, setTime } = await deferredCache();
        setTime(1001);
        const automatic = cache.value('before-write');
        const forced = cache.refresh('after-write');
        refreshAt(0).resolve(10);
        await automatic;

        const joined = cache.value('after-write');
        const originCalls = fetch.mock.calls.length;
        refreshes.forEach(pending => pending.resolve(30));
        expect(await forced).toBe(30);
        expect(await joined).toBe(30);
        expect(originCalls).toBe(3);
    });

    it('does not let an old refresh overwrite the current value or clear newer memoized entries', async () => {
        const { cache, refreshAt, setTime } = await deferredCache();
        const mapper = vi.fn((value: number) => value * 2);
        setTime(1001);
        const automatic = cache.value('before-write');
        const forced = cache.refresh('after-write');
        refreshAt(1).resolve(30);
        await forced;
        expect(await cache.memoize(['fresh'], ['current'], mapper)).toBe(60);

        refreshAt(0).resolve(10);
        await automatic;
        expect(await cache.memoize(['fresh'], ['current'], mapper)).toBe(60);
        expect(mapper).toHaveBeenCalledTimes(1);
        expect(await cache.value()).toBe(30);
    });

    it.each(['automatic-first', 'forced-first'])(
        'preserves the forced refresh when a distinct context reads during it (%s)',
        async order => {
            const { cache, fetch, refreshAt, setTime } = await deferredCache();
            setTime(1001);
            const forced = cache.refresh('write-context');
            const automatic = cache.value('read-context');
            if (order === 'forced-first') {
                refreshAt(0).resolve(30);
                expect(await forced).toBe(30);
                refreshAt(1).resolve(20);
                expect(await automatic).toBe(20);
            } else {
                refreshAt(1).resolve(20);
                expect(await automatic).toBe(20);
                refreshAt(0).resolve(30);
                expect(await forced).toBe(30);
            }
            expect(fetch).toHaveBeenCalledTimes(3);
            expect(await cache.value()).toBe(30);
        },
    );

    it('keeps automatic refreshes with different arguments separate and preserves their own results', async () => {
        const { cache, fetch, refreshAt, setTime } = await deferredCache();
        setTime(1001);
        const first = cache.value('first-context');
        const second = cache.value('second-context');
        refreshAt(1).resolve(30);
        expect(await second).toBe(30);
        refreshAt(0).resolve(20);
        expect(await first).toBe(20);

        expect(fetch).toHaveBeenCalledTimes(3);
        expect(await cache.value()).toBe(30);
    });

    it('does not let an older completion extend the TTL of a newer successful refresh', async () => {
        const { cache, fetch, refreshAt, setTime } = await deferredCache();
        setTime(1001);
        const automatic = cache.value('before-write');
        const forced = cache.refresh('after-write');
        setTime(1500);
        refreshAt(1).resolve(30);
        await forced;
        setTime(2000);
        refreshAt(0).resolve(20);
        await automatic;

        setTime(2501);
        const next = cache.value('after-write');
        refreshAt(2).resolve(40);
        expect(await next).toBe(40);
        expect(fetch).toHaveBeenCalledTimes(4);
    });

    it('shares the same context reference but keeps distinct context objects separate', async () => {
        let testTime = 0;
        const firstContext = { replicationMode: 'master' };
        const secondContext = { replicationMode: 'master' };
        const firstRefresh = deferredValue();
        const secondRefresh = deferredValue();
        const thirdRefresh = deferredValue();
        const fetch = vi
            .fn<(ctx: object) => Promise<number>>()
            .mockResolvedValueOnce(7)
            .mockReturnValueOnce(firstRefresh.promise)
            .mockReturnValueOnce(secondRefresh.promise)
            .mockReturnValueOnce(thirdRefresh.promise);
        const cache = await createSelfRefreshingCache<number, [object]>({
            name: 'context-test',
            ttl: 1000,
            refresh: { fn: fetch, defaultArgs: [firstContext] },
            getTimeFn: () => testTime,
        });
        testTime = 1001;
        const first = cache.value(firstContext);
        const same = cache.value(firstContext);
        const distinct = cache.value(secondContext);
        const originCalls = fetch.mock.calls.length;
        firstRefresh.resolve(20);
        secondRefresh.resolve(30);
        thirdRefresh.resolve(30);

        expect(await Promise.all([first, same, distinct])).toEqual([20, 20, 30]);
        expect(originCalls).toBe(3);
        expect(fetch.mock.calls[1]?.[0]).toBe(firstContext);
        expect(fetch.mock.calls[2]?.[0]).toBe(secondContext);
    });
});
