import { describe, expect, it, vi } from 'vitest';

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

    it('keeps customer events private while allowing an authorized admin listener', () => {
        const realtime = service();
        const target = vi.fn();
        const other = vi.fn();
        const admin = vi.fn();
        realtime.addClient({ channelId: 'store-a', userId: 'user-1', send: target });
        realtime.addClient({ channelId: 'store-a', userId: 'user-2', send: other });
        realtime.addClient({ channelId: 'store-a', userId: 'admin-1', admin: true, send: admin });

        realtime.publish({
            topics: ['orders'],
            channelIds: ['store-a'],
            userIds: ['user-1'],
            entityType: 'Order',
            entityIds: ['order-1'],
        });

        expect(target).toHaveBeenCalledOnce();
        expect(other).not.toHaveBeenCalled();
        expect(admin).toHaveBeenCalledOnce();
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

it('observes worker translation commits from SQL state and retries failed polling', async () => {
    const find = vi.fn().mockResolvedValue([{ provider: 'google', notificationVersion: 1 }]);
    const realtime = new StorefrontRealtimeService(
        {} as never,
        {
            rawConnection: { getRepository: () => ({ find }) },
        } as never,
    );
    const send = vi.fn();
    realtime.addClient({ channelId: 'store-a', send });
    await realtime.pollTranslationChanges();
    await realtime.pollTranslationChanges();
    expect(send).toHaveBeenCalledTimes(1);
    find.mockRejectedValueOnce(new Error('database offline'));
    await realtime.pollTranslationChanges();
    find.mockResolvedValue([{ provider: 'google', notificationVersion: 2 }]);
    await realtime.pollTranslationChanges();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].topics).toContain('config');
});
