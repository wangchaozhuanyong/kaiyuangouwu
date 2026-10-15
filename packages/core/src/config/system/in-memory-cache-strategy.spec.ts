import { describe, expect, it } from 'vitest';

import { TestingCacheTtlProvider } from '../../cache/cache-ttl-provider';

import { InMemoryCacheStrategy } from './in-memory-cache-strategy';

class MeasuredCache extends InMemoryCacheStrategy {
    get retained() {
        return {
            entries: this.cache.size,
            tags: this.cacheTags.size,
            references: [...this.cacheTags.values()].reduce((sum, keys) => sum + keys.size, 0),
        };
    }
}

describe('in-memory cache retention', () => {
    it('reclaims expired generations even when their keys are never read again', async () => {
        const clock = new TestingCacheTtlProvider();
        const cache = new MeasuredCache({ cacheTtlProvider: clock });
        await cache.set('permanent', { live: true });
        for (let generation = 0; generation < 300; generation++) {
            await cache.set(`generation:${generation}`, { generation }, { ttl: 1000, tags: ['pages'] });
            clock.incrementTime(2000);
        }
        await cache.set('current', { live: true }, { ttl: 1000, tags: ['pages'] });
        expect(cache.retained).toEqual({ entries: 2, tags: 1, references: 1 });
        expect(await cache.get('permanent')).toEqual({ live: true });
        expect(await cache.get('generation:0')).toBeUndefined();
        expect(await cache.get('current')).toEqual({ live: true });
    });

    it('removes tag references when an expired entry is read', async () => {
        const clock = new TestingCacheTtlProvider();
        const cache = new MeasuredCache({ cacheTtlProvider: clock });
        await cache.set('expired', 1, { ttl: 1, tags: ['first', 'second'] });
        clock.incrementTime(1);
        expect(await cache.get('expired')).toBeUndefined();
        expect(cache.retained).toEqual({ entries: 0, tags: 0, references: 0 });
    });

    it('does not invalidate a replacement through its previous tags', async () => {
        const cache = new MeasuredCache();
        await cache.set('same-key', 1, { tags: ['old'] });
        await cache.set('same-key', 2, { tags: ['new'] });
        await cache.invalidateTags(['old']);
        expect(await cache.get('same-key')).toBe(2);
        expect(cache.retained).toEqual({ entries: 1, tags: 1, references: 1 });
        await cache.invalidateTags(['new']);
        expect(await cache.get('same-key')).toBeUndefined();
        expect(cache.retained).toEqual({ entries: 0, tags: 0, references: 0 });
    });

    it('releases evicted entries from every tag while preserving newest-write order', async () => {
        const cache = new MeasuredCache({ cacheSize: 2 });
        await cache.set('first', 1, { tags: ['shared', 'first-only'] });
        await cache.set('second', 2, { tags: ['shared'] });
        await cache.set('first', 3, { tags: ['shared', 'first-only'] });
        await cache.set('third', 4, { tags: ['shared'] });
        expect(await cache.get('second')).toBeUndefined();
        expect(await cache.get('first')).toBe(3);
        expect(await cache.get('third')).toBe(4);
        expect(cache.retained).toEqual({ entries: 2, tags: 2, references: 3 });
        await cache.delete('first');
        expect(cache.retained).toEqual({ entries: 1, tags: 1, references: 1 });
    });

    it('cleans shared tag indexes after invalidation without skipping entries', async () => {
        const cache = new MeasuredCache();
        await cache.set('first', 1, { tags: ['group', 'other'] });
        await cache.set('second', 2, { tags: ['group', 'other'] });
        await cache.invalidateTags(['group']);
        expect(await cache.get('first')).toBeUndefined();
        expect(await cache.get('second')).toBeUndefined();
        expect(cache.retained).toEqual({ entries: 0, tags: 0, references: 0 });
    });
});
