import { describe, expect, it, vi } from 'vitest';

import { RedisCacheStrategy } from './redis-cache-strategy';

describe('Redis public cache generations', () => {
    it('atomically compares serialized entries and applies the existing namespace, TTL and tags', async () => {
        const strategy = new RedisCacheStrategy({ namespace: 'test' });
        const client = { eval: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0), set: vi.fn() };
        (strategy as any).client = client;
        expect(
            await strategy.compareAndSet(
                'page',
                undefined,
                { media: 'ready' },
                { ttl: 1500, tags: ['public'] },
            ),
        ).toBe(true);
        expect(client.eval).toHaveBeenCalledWith(
            expect.stringContaining('current ~= ARGV[2]'),
            2,
            'test:page',
            'test:tag:public',
            '0',
            '',
            '{"media":"ready"}',
            2,
        );
        expect(
            await strategy.compareAndSet('page', { media: 'old' }, { media: 'partial' }, { ttl: 30_000 }),
        ).toBe(false);
        expect(client.eval.mock.calls[1].slice(-4)).toEqual([
            '1',
            '{"media":"old"}',
            '{"media":"partial"}',
            30,
        ]);
        expect(client.set).not.toHaveBeenCalled();
    });
    it('does not attempt an oversized or invalid-TTL conditional write', async () => {
        const strategy = new RedisCacheStrategy({ namespace: 'test', maxItemSizeInBytes: 12 });
        const client = { eval: vi.fn() };
        (strategy as any).client = client;
        expect(await strategy.compareAndSet('page', undefined, { image: 'too large' }, { ttl: 1000 })).toBe(
            false,
        );
        expect(await strategy.compareAndSet('page', undefined, 'ok', { ttl: -1000 })).toBe(false);
        expect(client.eval).not.toHaveBeenCalled();
    });
    it('propagates conditional-write errors without falling back to SET', async () => {
        const strategy = new RedisCacheStrategy({ namespace: 'test' });
        const client = { eval: vi.fn().mockRejectedValue(new Error('offline')), set: vi.fn() };
        (strategy as any).client = client;
        await expect(strategy.compareAndSet('page', undefined, 'ready', { ttl: 30_000 })).rejects.toThrow(
            'offline',
        );
        expect(client.set).not.toHaveBeenCalled();
    });
    it('initializes with NX and rereads the winning generation from another worker', async () => {
        const strategy = new RedisCacheStrategy({ namespace: 'test' });
        const client = {
            get: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('other-worker-generation'),
            set: vi.fn(() => Promise.resolve(null)),
        };
        (strategy as any).client = client;
        expect(await strategy.getOrCreateVersion('revision:a')).toBe('other-worker-generation');
        expect(client.set).toHaveBeenCalledWith('test:revision:a', expect.any(String), 'EX', 86400, 'NX');
    });
    it('propagates revision errors instead of allowing a stale authenticated cache hit', async () => {
        const strategy = new RedisCacheStrategy({ namespace: 'test' });
        (strategy as any).client = {
            get: vi.fn().mockRejectedValue(new Error('offline')),
            set: vi.fn().mockRejectedValue(new Error('offline')),
        };
        await expect(strategy.getOrCreateVersion('revision:a')).rejects.toThrow('offline');
        await expect(strategy.rotateVersion('revision:a')).rejects.toThrow('offline');
    });
    it('performs the bounded delivery ledger mutation atomically in one namespaced Redis command', async () => {
        const strategy = new RedisCacheStrategy({ namespace: 'test' });
        const client = {
            eval: vi.fn(() => Promise.resolve(1)),
            zrange: vi.fn(() => Promise.resolve(['https://shop.example/assets/preview/public.jpg'])),
        };
        (strategy as any).client = client;
        expect(
            await strategy.addToBoundedSet(
                'delivered:a',
                'https://shop.example/assets/preview/public.jpg',
                8192,
                600,
            ),
        ).toBe(true);
        expect(client.eval).toHaveBeenCalledWith(
            expect.stringContaining('ZCARD'),
            1,
            'test:delivered:a',
            'https://shop.example/assets/preview/public.jpg',
            8192,
            600,
            expect.any(Number),
        );
        expect(await strategy.boundedSetMembers('delivered:a')).toHaveLength(1);
        expect(client.zrange).toHaveBeenCalledWith('test:delivered:a', 0, -1);
    });
});
