import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestContext } from '../api/common/request-context';

import { RequestContextCacheService } from './request-context-cache.service';

describe('request-scoped read batches', () => {
    it('clears all read generations without letting an older in-flight batch repopulate them', async () => {
        const cache = new RequestContextCacheService();
        const ctx = {} as RequestContext;
        cache.set(ctx, 'scalar', 'old');
        let release!: (value: number[]) => void;
        let entered!: () => void;
        const started = new Promise<void>(resolve => {
            entered = resolve;
        });
        const old = cache.load(ctx, 'scope', 'id', () => {
            entered();
            return new Promise<number[]>(resolve => {
                release = resolve;
            });
        });
        await started;
        cache.clear(ctx);
        expect(cache.get(ctx, 'scalar')).toBeUndefined();
        const fresh = vi.fn(() => Promise.resolve([2]));
        expect(await cache.load(ctx, 'scope', 'id', fresh)).toBe(2);
        release([1]);
        expect(await old).toBe(1);
        expect(await cache.load(ctx, 'scope', 'id', fresh)).toBe(2);
        expect(fresh).toHaveBeenCalledTimes(1);
    });

    it('does not retain results across serial writes in a GraphQL mutation request', async () => {
        const cache = new RequestContextCacheService();
        const ctx = {
            req: { body: { query: 'mutation Save { first: save second: save }' } },
        } as RequestContext;
        let current = 1;
        const batch = vi.fn((ids: readonly string[]) => Promise.resolve(ids.map(() => current)));
        expect(await cache.load(ctx, 'scope', 'id', batch)).toBe(1);
        current = 2;
        expect(await cache.load(ctx, 'scope', 'id', batch)).toBe(2);
        expect(batch).toHaveBeenCalledTimes(2);
    });

    it('coalesces siblings and duplicate IDs, preserving order, empty and zero values', async () => {
        const cache = new RequestContextCacheService();
        const ctx = {} as RequestContext;
        const batch = vi.fn((ids: readonly string[]) =>
            Promise.resolve(ids.map(id => (id === '0' ? 0 : Number(id)))),
        );
        const result = await Promise.all([3, 0, 1, 3].map(id => cache.load(ctx, 'scope', id, batch)));
        expect(result).toEqual([3, 0, 1, 3]);
        expect(batch).toHaveBeenCalledExactlyOnceWith(['3', '0', '1']);
        expect(await cache.load(ctx, 'scope', 0, batch)).toBe(0);
        expect(batch).toHaveBeenCalledTimes(1);
    });

    it('isolates requests and scopes and bounds large pages to 200 keys', async () => {
        const cache = new RequestContextCacheService();
        const ctx = {} as RequestContext;
        const batch = vi.fn((ids: readonly string[]) => Promise.resolve([...ids]));
        await Promise.all(Array.from({ length: 250 }, (_, id) => cache.load(ctx, 'A:en:USD', id, batch)));
        expect(batch.mock.calls.map(([ids]) => ids.length)).toEqual([200, 50]);
        await cache.load(ctx, 'B:zh:CNY', 0, batch);
        await cache.load({} as RequestContext, 'A:en:USD', 0, batch);
        expect(batch).toHaveBeenCalledTimes(4);
    });

    it('does not retain a failed batch as successful cached data', async () => {
        const cache = new RequestContextCacheService();
        const ctx = {} as RequestContext;
        const batch = vi.fn().mockRejectedValueOnce(new Error('read unavailable')).mockResolvedValueOnce([7]);
        await expect(cache.load(ctx, 'scope', 'id', batch)).rejects.toThrow('read unavailable');
        await expect(cache.load(ctx, 'scope', 'id', batch)).resolves.toBe(7);
        expect(batch).toHaveBeenCalledTimes(2);
    });
});

describe('Request context cache', () => {
    let cache: RequestContextCacheService;
    beforeEach(() => {
        cache = new RequestContextCacheService();
    });

    it('stores and retrieves a multiple values', () => {
        const ctx = RequestContext.empty();

        cache.set(ctx, 'test', 1);
        cache.set(ctx, 'test2', 2);
        expect(cache.get(ctx, 'test')).toBe(1);
        expect(cache.get(ctx, 'test2')).toBe(2);
    });

    it('uses getDefault function', async () => {
        const ctx = RequestContext.empty();
        const result = cache.get(ctx, 'test', () => Promise.resolve('foo'));

        expect(result instanceof Promise).toBe(true);
        expect(await result).toBe('foo');
    });

    it('can use objects as keys', () => {
        const ctx = RequestContext.empty();

        const x = {};
        cache.set(ctx, x, 1);
        expect(cache.get(ctx, x)).toBe(1);
    });

    it('uses separate stores per context', () => {
        const ctx = RequestContext.empty();
        const ctx2 = RequestContext.empty();

        cache.set(ctx, 'test', 1);
        cache.set(ctx2, 'test', 2);

        expect(cache.get(ctx, 'test')).toBe(1);
        expect(cache.get(ctx2, 'test')).toBe(2);
    });
});
