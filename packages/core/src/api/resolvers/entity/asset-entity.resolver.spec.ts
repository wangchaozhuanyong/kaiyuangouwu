import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

import { RequestContextCacheService } from '../../../cache/request-context-cache.service';

import { AssetEntityResolver } from './asset-entity.resolver';

describe('AssetEntityResolver tag ownership', () => {
    it('batches preloaded tag IDs across assets and returns only scoped tags', async () => {
        const own = { id: 1, value: 'own' };
        const service = {
            findAll: vi.fn().mockResolvedValue({ items: [own], totalItems: 1 }),
            getTagsForEntity: vi.fn(),
        };
        const resolver = new AssetEntityResolver(service as any, {} as any, new RequestContextCacheService());
        const ctx = { channelId: 2 } as any;
        const reads = await Promise.all([
            resolver.tags(ctx, { id: 1, tags: [own, { id: 2, value: 'foreign' }] } as any),
            resolver.tags(ctx, { id: 2, tags: [own, { id: 3, value: 'unregistered' }] } as any),
        ]);
        expect(reads).toEqual([[own], [own]]);
        expect(service.findAll).toHaveBeenCalledExactlyOnceWith(ctx, {
            filter: { id: { in: ['1', '2', '3'] } },
            take: 100,
        });
        expect(service.getTagsForEntity).not.toHaveBeenCalled();
    });
    it('does not query empty preloaded tags and retains the scoped fallback', async () => {
        const service = { findAll: vi.fn(), getTagsForEntity: vi.fn().mockResolvedValue([]) };
        const resolver = new AssetEntityResolver(service as any, {} as any, new RequestContextCacheService());
        expect(await resolver.tags({} as any, { tags: [] } as any)).toEqual([]);
        expect(service.findAll).not.toHaveBeenCalled();
        expect(await resolver.tags({} as any, { id: 8 } as any)).toEqual([]);
        expect(service.getTagsForEntity).toHaveBeenCalledOnce();
    });
});
