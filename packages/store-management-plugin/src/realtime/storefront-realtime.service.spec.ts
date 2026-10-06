import { Subject, filter } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { StorefrontCacheInvalidationService } from '../performance/storefront-cache-invalidation.service';

import { StorefrontDataChangedEvent } from './storefront-data-changed.event';
import { StorefrontRealtimeService } from './storefront-realtime.service';

function service() {
    return new StorefrontRealtimeService({} as never, {} as never);
}

describe('StorefrontRealtimeService', () => {
    it('delivers a public invalidation only to the affected Channel', () => {
        const realtime = service();
        const storeA = vi.fn();
        const storeB = vi.fn();
        realtime.addClient({ channelId: 'store-a', send: storeA });
        realtime.addClient({ channelId: 'store-b', send: storeB });

        realtime.publish({
            topics: ['catalog'],
            channelIds: ['store-a'],
            entityType: 'Product',
            entityIds: ['product-1'],
        });

        expect(storeA).toHaveBeenCalledWith(
            expect.objectContaining({
                version: 1,
                topics: ['catalog'],
                entityType: 'Product',
                entityIds: ['product-1'],
            }),
        );
        expect(storeB).not.toHaveBeenCalled();
    });

    it('keeps customer events private for every storefront listener', () => {
        const realtime = service();
        const target = vi.fn();
        const other = vi.fn();
        const admin = vi.fn();
        realtime.addClient({ channelId: 'store-a', userId: 'user-1', send: target });
        realtime.addClient({ channelId: 'store-a', userId: 'user-2', send: other });
        realtime.addClient({ channelId: 'store-a', userId: 'admin-1', send: admin });

        realtime.publish({
            topics: ['orders'],
            channelIds: ['store-a'],
            userIds: ['user-1'],
            entityType: 'Order',
            entityIds: ['order-1'],
        });

        expect(target).toHaveBeenCalledOnce();
        expect(other).not.toHaveBeenCalled();
        expect(admin).not.toHaveBeenCalled();
        expect(target.mock.calls[0][0]).not.toHaveProperty('userIds');
    });

    it('removes disconnected clients', () => {
        const realtime = service();
        const send = vi.fn();
        const remove = realtime.addClient({ channelId: 'store-a', send });
        remove();

        realtime.publish({ topics: ['content'], channelIds: ['store-a'] });

        expect(send).not.toHaveBeenCalled();
    });

    it('removes a client whose write fails without interrupting other clients', () => {
        const realtime = service();
        const failed = vi.fn(() => {
            throw new Error('response closed');
        });
        const healthy = vi.fn();
        realtime.addClient({ channelId: 'store-a', send: failed });
        realtime.addClient({ channelId: 'store-a', send: healthy });

        realtime.publish({ topics: ['content'], channelIds: ['store-a'] });
        realtime.publish({ topics: ['content'], channelIds: ['store-a'] });

        expect(failed).toHaveBeenCalledOnce();
        expect(healthy).toHaveBeenCalledTimes(2);
    });
});

function eventHarness(isWorker = false) {
    const events = new Subject<any>();
    const bus = {
        ofType: (type: any) => events.pipe(filter(event => event instanceof type)),
        filter: (predicate: any) => events.pipe(filter(predicate)),
        publish: vi.fn((event: any) => {
            events.next(event);
            return Promise.resolve();
        }),
    };
    const find = vi.fn().mockResolvedValue([{ provider: 'google', notificationVersion: 1 }]);
    const realtime = new StorefrontRealtimeService(
        bus as never,
        { rawConnection: { getRepository: () => ({ find }) } } as never,
    );
    let version = '1';
    const cache = {
        sharedVersions: true,
        observedChannels: () => ['store-a'],
        revision: vi.fn(() => Promise.resolve(version)),
        invalidate: vi.fn(() => {
            version = String(Number(version) + 1);
            return Promise.resolve();
        }),
    };
    const invalidator = new StorefrontCacheInvalidationService(bus as never, cache as never, realtime, {
        isWorker,
    } as never);
    realtime.onApplicationBootstrap();
    invalidator.onApplicationBootstrap();
    return {
        realtime,
        invalidator,
        bus,
        cache,
        find,
        emit: (event: any) => events.next(event),
        close: () => {
            realtime.onApplicationShutdown();
            invalidator.onApplicationShutdown();
        },
    };
}

it.each([false, true])(
    'invalidates after the committed event before one public refresh in API/worker=%s',
    async isWorker => {
        const test = eventHarness(isWorker);
        const a = vi.fn();
        const b = vi.fn();
        test.realtime.addClient({ channelId: 'store-a', send: a });
        test.realtime.addClient({ channelId: 'store-b', send: b });
        let release!: () => void;
        test.cache.invalidate.mockImplementationOnce(
            () =>
                new Promise<void>(resolve => {
                    release = resolve;
                }),
        );
        try {
            test.emit({
                realtimeEventKind: 'storefront-review-settings-changed',
                ctx: { channelId: 'store-a' },
            });
            expect(a).not.toHaveBeenCalled();
            release();
            await vi.waitFor(() => expect(a).toHaveBeenCalledTimes(1));
            expect(a).toHaveBeenCalledWith(
                expect.objectContaining({ topics: ['config'], entityType: 'StorefrontReviewSettings' }),
            );
            expect(b).not.toHaveBeenCalled();
            await test.invalidator.poll();
            expect(a).toHaveBeenCalledTimes(1);
        } finally {
            test.close();
        }
    },
);

it('routes content and generic public events once, retaining private customer/order notification scopes', async () => {
    const test = eventHarness();
    const guest = vi.fn();
    const owner = vi.fn();
    const other = vi.fn();
    test.realtime.addClient({ channelId: 'store-a', send: guest });
    test.realtime.addClient({ channelId: 'store-a', userId: 'customer-a', send: owner });
    test.realtime.addClient({ channelId: 'store-a', userId: 'customer-b', send: other });
    try {
        test.emit({
            realtimeEventKind: 'storefront-content-changed',
            ctx: { channelId: 'store-a' },
            entityIds: ['block-a'],
        });
        await vi.waitFor(() => expect(guest).toHaveBeenCalledTimes(1));
        expect(test.cache.invalidate).toHaveBeenCalledTimes(1);
        test.emit(
            new StorefrontDataChangedEvent({ channelId: 'store-a' } as never, ['coupons'], {
                userIds: ['customer-a'],
            }),
        );
        await vi.waitFor(() => expect(owner).toHaveBeenCalledTimes(2));
        expect(guest).toHaveBeenCalledTimes(1);
        expect(other).toHaveBeenCalledTimes(1);
        expect(test.cache.invalidate).toHaveBeenCalledTimes(1);
    } finally {
        test.close();
    }
});

it('observes SQL translation changes through the same invalidation entry and retries failed polling', async () => {
    const test = eventHarness();
    const send = vi.fn();
    test.realtime.addClient({ channelId: 'store-a', send });
    try {
        await test.realtime.pollTranslationChanges();
        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
        await test.realtime.pollTranslationChanges();
        await test.invalidator.poll();
        expect(send).toHaveBeenCalledTimes(1);
        expect(test.cache.invalidate).toHaveBeenCalledWith('*');
        test.find.mockRejectedValueOnce(new Error('database offline'));
        await test.realtime.pollTranslationChanges();
        test.find.mockResolvedValue([{ provider: 'google', notificationVersion: 2 }]);
        await test.realtime.pollTranslationChanges();
        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
        expect(send.mock.calls[1][0].topics).toContain('config');
    } finally {
        test.close();
    }
});

it('refreshes stock data without scheduling a whole-store image purge on each order', async () => {
    const test = eventHarness();
    const send = vi.fn();
    test.realtime.addClient({ channelId: 'store-a', send });
    try {
        test.emit({ constructor: { name: 'StockMovementEvent' }, ctx: { channelId: 'store-a' } });
        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
        expect(test.cache.invalidate).toHaveBeenCalledWith('*');
        expect(test.bus.publish).not.toHaveBeenCalled();
        test.emit({ constructor: { name: 'AssetEvent' }, ctx: { channelId: 'store-a' } });
        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
        expect(test.bus.publish).toHaveBeenCalledTimes(1);
    } finally {
        test.close();
    }
});
