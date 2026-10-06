import { describe, expect, it, vi } from 'vitest';

import { RedisCacheStrategy } from './redis-cache-strategy';

describe('Redis public cache generations', () => {
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
