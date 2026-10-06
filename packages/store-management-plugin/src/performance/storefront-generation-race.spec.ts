import { expect, it, vi } from 'vitest';

import { RequestContextCacheService } from '../../../core/src/cache/request-context-cache.service';

import { StorefrontPublicCacheService } from './storefront-public-cache.service';

it('discards retained request DataLoader results before rebuilding a changed public generation', async () => {
    const requestCache = new RequestContextCacheService();
    const entries = new Map<string, unknown>();
    const ctx = { channelId: 'shop-a', languageCode: 'en', currencyCode: 'MYR' } as any;
    const service = new StorefrontPublicCacheService(
        {
            get: (key: string) => Promise.resolve(entries.get(key)),
            set: (key: string, value: unknown) => {
                entries.set(key, value);
                return Promise.resolve();
            },
        } as any,
        { systemOptions: { cacheStrategy: {} } } as any,
        requestCache,
    );
    let stock = 1;
    let first = true;
    const batch = vi.fn((ids: readonly string[]) => Promise.resolve(ids.map(() => stock)));
    const result = await service.readThrough(ctx, 'product-summary', 30000, async () => {
        const value = await requestCache.load(ctx, 'public-stock', 'variant-a', batch);
        if (first) {
            first = false;
            stock = 0;
            await service.invalidate('shop-a');
        }
        return { availableStock: value };
    });
    expect(result).toEqual({ availableStock: 0 });
    expect(batch).toHaveBeenCalledTimes(2);
    expect(await service.peek(ctx, 'product-summary')).toEqual({ availableStock: 0 });
});
