import { OrderProcessingChangedEvent } from '@vendure/commerce-fulfillment-plugin';
import {
    OrderPlacedEvent,
    OrderStateTransitionEvent,
    RefundEvent,
    RefundStateTransitionEvent,
} from '@vendure/core';
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
        salesChannelId: 'a',
        channels: [{ id: 'a' }, { id: 'seller' }],
        lines: [{ id: 'line', quantity: 2 }],
        fulfillments: [] as Array<{ state: string; lines: Array<{ orderLineId: string; quantity: number }> }>,
    };
}
function harness(worker = false, needsReminder?: (order: unknown) => Promise<boolean>) {
    const source = new Subject<{ order: { id: string } }>();
    const changes = new Subject<{ order: { id: string; orderPlacedAt: Date } }>();
    const refunds = new Subject<{ order: { id: string; orderPlacedAt: Date } }>();
    const refundTransitions = new Subject<{ order: { id: string; orderPlacedAt: Date } }>();
    const processingChanges = new Subject<{ orderId: string }>();
    const subjects = new Map<unknown, Subject<any>>([
        [OrderPlacedEvent, source],
        [OrderStateTransitionEvent, changes],
        [RefundEvent, refunds],
        [RefundStateTransitionEvent, refundTransitions],
        [OrderProcessingChangedEvent, processingChanges],
    ]);
    const findOne = vi.fn().mockImplementation(({ where }) => Promise.resolve(order(where.id)));
    const find = vi.fn().mockResolvedValue([]);
    const service = new OrderEventsService(
        { ofType: (type: unknown) => subjects.get(type) } as never,
        { rawConnection: { getRepository: () => ({ findOne, find }) } } as never,
        { isServer: !worker, isWorker: worker },
        needsReminder ? ({ needsReminder } as never) : undefined,
    );
    services.push(service);
    return { service, source, changes, refunds, refundTransitions, processingChanges, findOne, find };
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
    it('does one startup recovery read, then no idle queries, and routes real events only to the sale owner', async () => {
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
        expect(seller).not.toHaveBeenCalled();
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
        const { service, source, changes, refunds, refundTransitions, processingChanges, findOne, find } =
            harness(true);
        await service.onApplicationBootstrap();
        expect(listenForOrderEvents).not.toHaveBeenCalled();
        source.next({ order: { id: 'worker-order' } });
        changes.next({ order: { id: 'worker-order', orderPlacedAt: new Date() } });
        refunds.next({ order: { id: 'refund-created', orderPlacedAt: new Date() } });
        refundTransitions.next({ order: { id: 'refund-settled', orderPlacedAt: new Date() } });
        processingChanges.next({ orderId: 'digital-notification-failed' });
        expect(relayOrderEvent).toHaveBeenCalledWith('/private-fixture/events.sock', 'worker-order');
        expect(relayOrderEvent).toHaveBeenCalledWith(
            '/private-fixture/events.sock',
            'worker-order',
            'changed',
        );
        for (const id of ['refund-created', 'refund-settled', 'digital-notification-failed']) {
            expect(relayOrderEvent).toHaveBeenCalledWith('/private-fixture/events.sock', id, 'changed');
        }
        expect(relayOrderEvent).toHaveBeenCalledTimes(5);
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

describe('processing changes without an Order state transition', () => {
    it.each(['refund-created', 'refund-transition', 'digital-processing'] as const)(
        '%s starts a newly actionable task without announcing a new order',
        async kind => {
            let actionable = false;
            const needsReminder = vi.fn().mockImplementation(() => Promise.resolve(actionable));
            const { service, source, refunds, refundTransitions, processingChanges, findOne } = harness(
                false,
                needsReminder,
            );
            const value = order();
            value.state = 'Delivered';
            findOne.mockResolvedValue(value);
            await service.onApplicationBootstrap();
            const send = vi.fn();
            const unrelated = vi.fn();
            service.subscribe('a', undefined, send, vi.fn());
            service.subscribe('seller', undefined, unrelated, vi.fn());
            source.next({ order: value });
            await flush();
            await vi.advanceTimersByTimeAsync(HALF_HOUR);
            expect(send).toHaveBeenCalledTimes(1);
            expect(findOne).toHaveBeenCalledTimes(1);
            actionable = true;
            if (kind === 'refund-created') refunds.next({ order: value });
            else if (kind === 'refund-transition') refundTransitions.next({ order: value });
            else processingChanges.next({ orderId: String(value.id) });
            await flush();
            expect(findOne).toHaveBeenCalledTimes(2);
            expect(send).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(HALF_HOUR);
            expect(send).toHaveBeenCalledTimes(2);
            expect(send).toHaveBeenLastCalledWith(
                expect.objectContaining({ kind: 'order-pending', orderId: '1' }),
            );
            expect(unrelated).not.toHaveBeenCalled();
            expect(value.state).toBe('Delivered');
        },
    );

    it.each(['refund-transition', 'digital-processing'] as const)(
        '%s stops resolved tasks and removes stale reconnect reminders',
        async kind => {
            let actionable = true;
            const { service, refundTransitions, processingChanges, findOne } = harness(false, () =>
                Promise.resolve(actionable),
            );
            const value = order();
            value.state = 'Cancelled';
            findOne.mockResolvedValue(value);
            await service.onApplicationBootstrap();
            const send = vi.fn();
            const cursor = service.subscribe('a', undefined, send, vi.fn()).cursor;
            await service.publishPlacedOrder('1');
            await vi.advanceTimersByTimeAsync(HALF_HOUR);
            expect(send).toHaveBeenCalledTimes(2);
            actionable = false;
            if (kind === 'refund-transition') refundTransitions.next({ order: value });
            else processingChanges.next({ orderId: '1' });
            await flush();
            const reads = findOne.mock.calls.length;
            await vi.advanceTimersByTimeAsync(2 * HALF_HOUR);
            expect(send).toHaveBeenCalledTimes(2);
            expect(findOne).toHaveBeenCalledTimes(reads);
            expect(service.subscribe('a', cursor, vi.fn(), vi.fn()).replay.map(event => event.kind)).toEqual([
                'order-placed',
            ]);
            expect(value.state).toBe('Cancelled');
        },
    );

    it('does not reset an existing reminder when another refund or notification event arrives', async () => {
        const { service, refunds, processingChanges, findOne } = harness(false, () => Promise.resolve(true));
        const value = order();
        findOne.mockResolvedValue(value);
        await service.onApplicationBootstrap();
        const send = vi.fn();
        service.subscribe('a', undefined, send, vi.fn());
        await service.publishPlacedOrder('1');
        await vi.advanceTimersByTimeAsync(HALF_HOUR / 2);
        refunds.next({ order: value });
        processingChanges.next({ orderId: '1' });
        await flush();
        await vi.advanceTimersByTimeAsync(HALF_HOUR / 2);
        expect(send).toHaveBeenCalledTimes(2);
        expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'order-pending' }));
    });

    it('does not create tasks for missing or unplaced orders and removes subscriptions on shutdown', async () => {
        const needsReminder = vi.fn().mockResolvedValue(true);
        const { service, refunds, refundTransitions, processingChanges, findOne } = harness(
            false,
            needsReminder,
        );
        await service.onApplicationBootstrap();
        const send = vi.fn();
        service.subscribe('a', undefined, send, vi.fn());
        findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...order(), orderPlacedAt: null });
        processingChanges.next({ orderId: 'missing' });
        await flush();
        processingChanges.next({ orderId: 'unplaced' });
        await flush();
        await vi.advanceTimersByTimeAsync(HALF_HOUR);
        expect(needsReminder).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
        await service.onApplicationShutdown();
        refunds.next({ order: order() });
        refundTransitions.next({ order: order() });
        processingChanges.next({ orderId: '1' });
        await flush();
        expect(findOne).toHaveBeenCalledTimes(2);
    });

    it('recovers canceled funding tasks and delivery exceptions at startup through the summary provider', async () => {
        const needsReminder = vi.fn().mockImplementation(value => Promise.resolve(value.id !== 'complete'));
        const { service, find, findOne } = harness(false, needsReminder);
        const canceled = { ...order('cancelled-refund'), state: 'Cancelled' };
        const notification = { ...order('notification-failed'), state: 'Delivered' };
        find.mockResolvedValue([canceled, notification, { ...order('complete'), state: 'Delivered' }]);
        findOne.mockImplementation(({ where }) =>
            Promise.resolve(where.id === canceled.id ? canceled : notification),
        );
        const send = vi.fn();
        service.subscribe('a', undefined, send, vi.fn());
        await service.onApplicationBootstrap();
        expect(find.mock.calls[0][0].where).not.toHaveProperty('state');
        expect(send).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(HALF_HOUR);
        expect(send.mock.calls.map(([event]) => event.orderId).sort()).toEqual([
            'cancelled-refund',
            'notification-failed',
        ]);
    });

    it('does not announce or clear timers from a summary lookup that completes after shutdown', async () => {
        const needsReminder = vi.fn().mockResolvedValue(true);
        const { service, findOne } = harness(false, needsReminder);
        const send = vi.fn();
        service.subscribe('a', undefined, send, vi.fn());
        const cursor = service.subscribe('a', undefined, vi.fn(), vi.fn()).cursor;
        await service.publishPlacedOrder('1');
        let resolve!: (value: boolean) => void;
        needsReminder.mockImplementationOnce(
            () =>
                new Promise(done => {
                    resolve = done;
                }),
        );
        await vi.advanceTimersByTimeAsync(HALF_HOUR);
        await service.onApplicationShutdown();
        resolve(true);
        await flush();
        await vi.advanceTimersByTimeAsync(HALF_HOUR);
        expect(findOne).toHaveBeenCalledTimes(2);
        expect(service.subscribe('a', cursor, vi.fn(), vi.fn()).replay.map(event => event.kind)).toEqual([
            'order-placed',
        ]);
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('retries a failed processing summary without emitting an unverified reminder', async () => {
        const needsReminder = vi.fn().mockResolvedValue(true);
        const { service, findOne } = harness(false, needsReminder);
        const send = vi.fn();
        service.subscribe('a', undefined, send, vi.fn());
        await service.publishPlacedOrder('1');
        needsReminder.mockRejectedValueOnce(new Error('summary query failed'));
        await vi.advanceTimersByTimeAsync(HALF_HOUR);
        expect(send).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(HALF_HOUR);
        expect(findOne).toHaveBeenCalledTimes(3);
        expect(send).toHaveBeenCalledTimes(2);
        expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'order-pending' }));
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

it('reserves aggregate live events and replay for explicitly authorized platform readers', async () => {
    const { service, findOne } = harness();
    const aggregate = vi.fn();
    const member = vi.fn();
    const platformCursor = service.subscribe('platform', undefined, aggregate, vi.fn(), true).cursor;
    service.subscribe('platform', undefined, member, vi.fn());
    await service.publishPlacedOrder('1');
    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(member).not.toHaveBeenCalled();
    expect(service.subscribe('seller', platformCursor, vi.fn(), vi.fn()).replay).toEqual([]);
    expect(service.subscribe('platform', platformCursor, vi.fn(), vi.fn(), true).replay).toHaveLength(1);
    findOne.mockResolvedValue({ ...order('legacy'), salesChannelId: null });
    await service.publishPlacedOrder('legacy');
    expect(aggregate).toHaveBeenCalledTimes(2);
    expect(member).not.toHaveBeenCalled();
});
