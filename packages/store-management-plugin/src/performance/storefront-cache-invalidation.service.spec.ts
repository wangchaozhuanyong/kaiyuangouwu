import { expect, it, vi } from 'vitest';

import { SearchIndexCompletedEvent } from '../../../core/src/event-bus/events/search-index-completed-event';

import { StorefrontCacheInvalidationService } from './storefront-cache-invalidation.service';

function harness() {
    let revision = 'v1';
    const cache = {
        invalidate: vi.fn().mockResolvedValue(undefined),
        observedChannels: () => ['a'],
        revision: vi.fn(() => Promise.resolve(revision)),
    };
    const publish = vi.fn();
    const media = vi.fn();
    const service = new StorefrontCacheInvalidationService(
        { publish: media } as never,
        cache as never,
        { publish } as never,
        { isWorker: false } as never,
    );
    return {
        service,
        cache,
        publish,
        media,
        advance: () => {
            revision = 'v2';
        },
    };
}
it('invalidates public catalog/content/cart after index completion without invalidating media', async () => {
    const test = harness();
    const event = new SearchIndexCompletedEvent({ channelId: 'a' } as never, 'update-product');
    expect((test.service as any).isPublicChange(event)).toBe(true);
    await (test.service as any).changed(event);
    expect(test.cache.invalidate).toHaveBeenCalledExactlyOnceWith('*');
    expect(test.publish).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
            allChannels: true,
            topics: expect.arrayContaining(['catalog', 'content', 'cart']),
        }),
    );
    expect(test.media).not.toHaveBeenCalled();
});
it('carries cart revalidation to the API when a worker completion changes the shared generation', async () => {
    const test = harness();
    await test.service.poll();
    expect(test.publish).not.toHaveBeenCalled();
    test.advance();
    await test.service.poll();
    expect(test.publish).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ channelIds: ['a'], topics: expect.arrayContaining(['catalog', 'cart']) }),
    );
    await test.service.poll();
    expect(test.publish).toHaveBeenCalledOnce();
});
