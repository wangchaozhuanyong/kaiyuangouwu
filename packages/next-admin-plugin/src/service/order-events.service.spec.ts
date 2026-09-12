import { OrderPlacedEvent } from '@vendure/core';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { listenForOrderEvents, relayOrderEvent } from './order-event-relay';
import { OrderEventsService } from './order-events.service';

vi.mock('./order-event-relay', () => ({
    orderEventSocketPath: () => '/private-fixture/events.sock',
    listenForOrderEvents: vi.fn().mockResolvedValue(() => Promise.resolve()),
    relayOrderEvent: vi.fn().mockResolvedValue(undefined),
}));
const HALF_HOUR = 30 * 60 * 1000;
const services: OrderEventsService[] = [];
function order(id = '1') {
    return {
        id,
        active: false,
        state: 'PaymentSettled',
        orderPlacedAt: new Date(),
        channels: [{ id: 'a' }, { id: 'seller' }],
        lines: [{ id: 'line', quantity: 2 }],
        fulfillments: [] as Array<{ state: string; lines: Array<{ orderLineId: string; quantity: number }> }>,
    };
}
function harness(worker = false) {
    const source = new Subject<{ order: { id: string } }>();
    const changes = new Subject<{ order: { id: string; orderPlacedAt: Date } }>();
    const findOne = vi.fn().mockImplementation(({ where }) => Promise.resolve(order(where.id)));
    const find = vi.fn().mockResolvedValue([]);
    const service = new OrderEventsService(
        { ofType: (type: unknown) => (type === OrderPlacedEvent ? source : changes) } as never,
        { rawConnection: { getRepository: () => ({ findOne, find }) } } as never,
        { isServer: !worker, isWorker: worker },
    );
    services.push(service);
    return { service, source, changes, findOne, find };
}
async function flush() {
    for (let i = 0; i < 8; i++) await Promise.resolve();
}
beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-10T00:00:00Z'));
});
afterEach(async () => {
    for (const service of services.splice(0)) await service.onApplicationShutdown();
    vi.clearAllMocks();
    vi.useRealTimers();
});

describe('order placement push', () => {
    it('does one startup recovery read, then no idle queries, and routes real events only to assigned Channels', async () => {
        const { service, source, findOne, find } = harness();
        await service.onApplicationBootstrap();
        const store = vi.fn();
        const seller = vi.fn();
        const unrelated = vi.fn();
        service.subscribe('a', undefined, store, vi.fn());
        service.subscribe('seller', undefined, seller, vi.fn());
        service.subscribe('other', undefined, unrelated, vi.fn());
        await vi.advanceTimersByTimeAsync(2 * HALF_HOUR);
        expect(find).toHaveBeenCalledTimes(1);
        expect(findOne).not.toHaveBeenCalled();
        source.next({ order: { id: '1' } });
        await flush();
        expect(store).toHaveBeenCalledTimes(1);
        expect(seller).toHaveBeenCalledTimes(1);
        expect(unrelated).not.toHaveBeenCalled();
        expect(Object.keys(store.mock.calls[0][0]).sort()).toEqual([
            'id',
            'kind',
            'occurredAt',
            'orderId',
            'version',
        ]);
        await service.publishPlacedOrder('1');
        expect(findOne).toHaveBeenCalledTimes(1);
    });
    it('relays worker placement and processing events without a listener or order queries', async () => {
        const { service, source, changes, findOne, find } = harness(true);
        await service.onApplicationBootstrap();
        expect(listenForOrderEvents).not.toHaveBeenCalled();
        source.next({ order: { id: 'worker-order' } });
        changes.next({ order: { id: 'worker-order', orderPlacedAt: new Date() } });
        expect(relayOrderEvent).toHaveBeenCalledWith('/private-fixture/events.sock', 'worker-order');
        expect(relayOrderEvent).toHaveBeenCalledWith(
            '/private-fixture/events.sock',
            'worker-order',
            'changed',
        );
        expect(findOne).not.toHaveBeenCalled();
        expect(find).not.toHaveBeenCalled();
    });
    it('replays missed events for the same Channel only and gives fresh connections no history', async () => {
        const { service } = harness();
        const first = service.subscribe('a', undefined, vi.fn(), vi.fn());
        first.remove();
        await service.publishPlacedOrder('1');
        expect(service.subscribe('a', first.cursor, vi.fn(), vi.fn()).replay).toHaveLength(1);
        expect(service.subscribe('other', first.cursor, vi.fn(), vi.fn()).replay).toHaveLength(0);
        expect(service.subscribe('a', undefined, vi.fn(), vi.fn()).replay).toHaveLength(0);
        expect(service.subscribe('a', 'old-instance:1', vi.fn(), vi.fn()).replay).toHaveLength(0);
    });
    it.each([
        null,
        { active: true, state: 'AddingItems', orderPlacedAt: new Date() },
        { active: false, state: 'Draft', orderPlacedAt: new Date() },
        { active: false, state: 'PaymentSettled', orderPlacedAt: null },
    ])('does not announce an unplaced order', async value => {
        const { service, findOne } = harness();
        findOne.mockResolvedValue(value);
        const send = vi.fn();
        service.subscribe('a', undefined, send, vi.fn());
        await service.publishPlacedOrder('1');
        await vi.advanceTimersByTimeAsync(HALF_HOUR);
        expect(send).not.toHaveBeenCalled();
        expect(findOne).toHaveBeenCalledTimes(1);
    });
});

describe('pending order reminders', () => {
    it('reminds at 30 and 60 minutes without early checks or reset on page reconnect', async () => {
        const { service, findOne } = harness();
        const send = vi.fn();
        const client = service.subscribe('a', undefined, send, vi.fn());
        await service.publishPlacedOrder('1');
        await vi.advanceTimersByTimeAsync(HALF_HOUR - 1);
        client.remove();
        service.subscribe('a', undefined, send, vi.fn());
        expect(findOne).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(send).toHaveBeenLastCalledWith(
            expect.objectContaining({ kind: 'order-pending', orderId: '1' }),
        );
        expect(findOne).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(HALF_HOUR);
        expect(send).toHaveBeenCalledTimes(3);
        expect(findOne).toHaveBeenCalledTimes(3);
        expect(send.mock.calls[1][0].id).not.toBe(send.mock.calls[2][0].id);
    });
    it.each(['Shipped', 'Delivered', 'Cancelled'])(
        'stops on committed %s with no later checks',
        async state => {
            const { service, findOne, changes } = harness();
            await service.onApplicationBootstrap();
            const value = order();
            findOne.mockResolvedValue(value);
            const send = vi.fn();
            service.subscribe('a', undefined, send, vi.fn());
            await service.publishPlacedOrder('1');
            await vi.advanceTimersByTimeAsync(1000);
            value.state = state;
            changes.next({ order: value });
            await flush();
            const reads = findOne.mock.calls.length;
            await vi.advanceTimersByTimeAsync(3 * HALF_HOUR);
            expect(findOne).toHaveBeenCalledTimes(reads);
            expect(send).toHaveBeenCalledTimes(1);
        },
    );
    it('keeps partial quantities due, then stops when all are shipped or delivered even without a state event', async () => {
        const { service, findOne } = harness();
        const value = order();
        findOne.mockResolvedValue(value);
        const send = vi.fn();
        service.subscribe('a', undefined, send, vi.fn());
        await service.publishPlacedOrder('1');
        await vi.advanceTimersByTimeAsync(HALF_HOUR / 2);
        value.state = 'PartiallyShipped';
        value.fulfillments = [{ state: 'Shipped', lines: [{ orderLineId: 'line', quantity: 1 }] }];
        await service.refreshOrder('1');
        await vi.advanceTimersByTimeAsync(HALF_HOUR / 2);
        expect(send).toHaveBeenCalledTimes(2);
        value.fulfillments.push({ state: 'Delivered', lines: [{ orderLineId: 'line', quantity: 1 }] });
        await vi.advanceTimersByTimeAsync(HALF_HOUR);
        expect(send).toHaveBeenCalledTimes(2);
        const reads = findOne.mock.calls.length;
        await vi.advanceTimersByTimeAsync(HALF_HOUR);
        expect(findOne).toHaveBeenCalledTimes(reads);
    });
    it('does not remind for already-delivered authorized digital goods', async () => {
        const { service, findOne } = harness();
        const value = order();
        value.state = 'PaymentAuthorized';
        value.fulfillments = [{ state: 'Delivered', lines: [{ orderLineId: 'line', quantity: 2 }] }];
        findOne.mockResolvedValue(value);
        const send = vi.fn();
        service.subscribe('a', undefined, send, vi.fn());
        await service.publishPlacedOrder('1');
        await vi.advanceTimersByTimeAsync(2 * HALF_HOUR);
        expect(send).toHaveBeenCalledTimes(1);
        expect(findOne).toHaveBeenCalledTimes(1);
    });
    it('recovers timers on restart without announcing historical new orders', async () => {
        const { service, find, findOne } = harness();
        const value = order();
        value.orderPlacedAt = new Date(Date.now() - HALF_HOUR - 10 * 60000);
        find.mockResolvedValue([value]);
        findOne.mockResolvedValue(value);
        const send = vi.fn();
        service.subscribe('a', undefined, send, vi.fn());
        await service.onApplicationBootstrap();
        expect(send).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(20 * 60000 - 1);
        expect(send).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kind: 'order-pending' }));
        expect(find).toHaveBeenCalledTimes(1);
    });
    it('replays only the latest reminder and removes it after processing', async () => {
        const { service, findOne } = harness();
        const value = order();
        findOne.mockResolvedValue(value);
        const cursor = service.subscribe('a', undefined, vi.fn(), vi.fn()).cursor;
        await service.publishPlacedOrder('1');
        await vi.advanceTimersByTimeAsync(3 * HALF_HOUR);
        expect(service.subscribe('a', cursor, vi.fn(), vi.fn()).replay.map(event => event.kind)).toEqual([
            'order-placed',
            'order-pending',
        ]);
        value.state = 'Cancelled';
        await service.refreshOrder('1');
        expect(service.subscribe('a', cursor, vi.fn(), vi.fn()).replay.map(event => event.kind)).toEqual([
            'order-placed',
        ]);
    });
    it('suppresses unverified reminders and resumes only at the next deadline', async () => {
        const { service, findOne } = harness();
        const send = vi.fn();
        service.subscribe('a', undefined, send, vi.fn());
        await service.publishPlacedOrder('1');
        findOne.mockRejectedValueOnce(new Error('database unavailable'));
        await vi.advanceTimersByTimeAsync(HALF_HOUR);
        expect(send).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(HALF_HOUR - 1);
        expect(findOne).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(send).toHaveBeenCalledTimes(2);
    });
    it('does not reschedule an in-flight check after shutdown', async () => {
        const { service, findOne } = harness();
        const send = vi.fn();
        service.subscribe('a', undefined, send, vi.fn());
        await service.publishPlacedOrder('1');
        let resolve!: (value: unknown) => void;
        findOne.mockImplementationOnce(
            () =>
                new Promise(done => {
                    resolve = done;
                }),
        );
        await vi.advanceTimersByTimeAsync(HALF_HOUR);
        await service.onApplicationShutdown();
        resolve(order());
        await flush();
        await vi.advanceTimersByTimeAsync(HALF_HOUR);
        expect(send).toHaveBeenCalledTimes(1);
        expect(findOne).toHaveBeenCalledTimes(2);
    });
});
