import { afterEach, describe, expect, it, vi } from 'vitest';

import { storefrontQueryKeys } from './query-client';
import {
    consumeStorefrontRealtimeStream,
    parseStorefrontRealtimeFrame,
    StorefrontRealtimeEvent,
    storefrontRealtimeQueryMatches,
} from './realtime-updates';

const scope = { marketCode: 'store-a', languageCode: 'zh_Hans', customerId: 'customer-1' };

afterEach(() => vi.useRealTimers());

function event(overrides: Partial<StorefrontRealtimeEvent> = {}): StorefrontRealtimeEvent {
    return {
        version: 1,
        id: 'event-1',
        occurredAt: '2026-08-30T00:00:00.000Z',
        topics: ['catalog'],
        ...overrides,
    };
}

describe('storefront realtime stream', () => {
    it('closes a silent stream after missed heartbeats while real heartbeats extend its lifetime', async () => {
        vi.useFakeTimers();
        const encoder = new TextEncoder();
        const cancel = vi.fn();
        let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                streamController = controller;
                controller.enqueue(
                    encoder.encode('event: ready\ndata: {"version":1,"heartbeatIntervalMs":1000}\n\n'),
                );
            },
            cancel,
        });
        if (!streamController) throw new Error('Stream controller was not initialized');
        const observed = consumeStorefrontRealtimeStream(body, vi.fn()).catch(error => error);
        await vi.advanceTimersByTimeAsync(2_000);
        streamController.enqueue(encoder.encode(': heartbeat\n\n'));
        await vi.advanceTimersByTimeAsync(2_999);
        expect(cancel).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        const cancelledOnDeadline = cancel.mock.calls.length;
        if (!cancelledOnDeadline) streamController.close();
        const outcome = await observed;

        expect(cancelledOnDeadline).toBe(1);
        expect(outcome).toBeInstanceOf(Error);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('rejects an invalid heartbeat interval instead of treating it as a ready connection', async () => {
        vi.useFakeTimers();
        const encoder = new TextEncoder();
        const cancel = vi.fn();
        const controller = new AbortController();
        const onReady = vi.fn();
        const body = new ReadableStream<Uint8Array>({
            start(streamController) {
                streamController.enqueue(
                    encoder.encode('event: ready\ndata: {"version":1,"heartbeatIntervalMs":0}\n\n'),
                );
            },
            cancel,
        });
        const observed = consumeStorefrontRealtimeStream(body, vi.fn(), {
            signal: controller.signal,
            onReady,
        }).catch(error => error);

        await vi.advanceTimersByTimeAsync(10_000);
        const cancelledOnDeadline = cancel.mock.calls.length;
        controller.abort();
        const outcome = await observed;

        expect(onReady).not.toHaveBeenCalled();
        expect(cancelledOnDeadline).toBe(1);
        expect(outcome).toBeInstanceOf(Error);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps a healthy stream alive beyond the initial deadlines and cleans up on unmount', async () => {
        vi.useFakeTimers();
        const encoder = new TextEncoder();
        const cancel = vi.fn();
        const controller = new AbortController();
        const onEvent = vi.fn();
        let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
        const body = new ReadableStream<Uint8Array>({
            start(stream) {
                streamController = stream;
                stream.enqueue(encoder.encode('event: ready\ndata: {"version":1}\n\n'));
            },
            cancel,
        });
        if (!streamController) throw new Error('Stream controller was not initialized');
        const pending = consumeStorefrontRealtimeStream(body, onEvent, { signal: controller.signal });
        for (let index = 0; index < 4; index += 1) {
            await vi.advanceTimersByTimeAsync(14_000);
            streamController.enqueue(encoder.encode(': heartbeat\n\n'));
        }
        streamController.enqueue(
            encoder.encode(
                'event: invalidate\ndata: {"version":1,"id":"healthy-event","occurredAt":"2026-09-27T00:00:00Z","topics":["orders"]}\n\n',
            ),
        );
        await vi.advanceTimersByTimeAsync(0);
        expect(cancel).not.toHaveBeenCalled();
        expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ id: 'healthy-event' }));

        controller.abort();
        await pending;
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('parses invalidate events and ignores heartbeats and ready frames', () => {
        expect(parseStorefrontRealtimeFrame(': heartbeat')).toBeNull();
        expect(parseStorefrontRealtimeFrame('event: ready\ndata: {"version":1}')).toBeNull();
        expect(
            parseStorefrontRealtimeFrame(
                'id: event-1\nevent: invalidate\ndata: {"version":1,"id":"event-1","occurredAt":"2026-08-30T00:00:00.000Z","topics":["content"]}',
            ),
        ).toEqual(expect.objectContaining({ id: 'event-1', topics: ['content'] }));
    });

    it('handles an event split across network chunks', async () => {
        const encoder = new TextEncoder();
        const cancel = vi.fn();
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(encoder.encode('event: invalidate\ndata: {"version":1,"id":"event-2",'));
                controller.enqueue(
                    encoder.encode('"occurredAt":"2026-08-30T00:00:00.000Z","topics":["config"]}\n\n'),
                );
                controller.close();
            },
            cancel,
        });
        const onEvent = vi.fn();

        await consumeStorefrontRealtimeStream(body, onEvent);

        expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ id: 'event-2', topics: ['config'] }));
        expect(cancel).not.toHaveBeenCalled();
    });

    it('reports a valid ready frame once before consuming invalidation events', async () => {
        const encoder = new TextEncoder();
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(
                    encoder.encode(
                        'event: ready\ndata: {"version":1,"heartbeatIntervalMs":15000}\n\n' +
                            'event: ready\ndata: {"version":1,"heartbeatIntervalMs":15000}\n\n',
                    ),
                );
                controller.close();
            },
        });
        const onReady = vi.fn();

        await consumeStorefrontRealtimeStream(body, vi.fn(), { onReady });

        expect(onReady).toHaveBeenCalledTimes(1);
    });

    it('cancels the underlying stream when an event callback throws', async () => {
        const encoder = new TextEncoder();
        const cancel = vi.fn();
        const failure = new Error('invalidation failed');
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(
                    encoder.encode(
                        'event: invalidate\ndata: {"version":1,"id":"event-3","occurredAt":"2026-08-30T00:00:00.000Z","topics":["content"]}\n\n',
                    ),
                );
            },
            cancel,
        });

        await expect(
            consumeStorefrontRealtimeStream(body, () => {
                throw failure;
            }),
        ).rejects.toBe(failure);
        expect(cancel).toHaveBeenCalledWith(failure);
    });

    it('cancels the underlying stream when an oversized frame is rejected', async () => {
        const encoder = new TextEncoder();
        const cancel = vi.fn();
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(encoder.encode(`data: ${'x'.repeat(256 * 1024)}`));
            },
            cancel,
        });

        await expect(consumeStorefrontRealtimeStream(body, vi.fn())).rejects.toThrow(
            'Storefront realtime event exceeded the maximum size',
        );
        expect(cancel).toHaveBeenCalledTimes(1);
    });

    it('cancels an active reader when the caller aborts', async () => {
        const cancel = vi.fn();
        const body = new ReadableStream<Uint8Array>({ cancel });
        const controller = new AbortController();
        const reason = new DOMException('Unmounted', 'AbortError');
        const pending = consumeStorefrontRealtimeStream(body, vi.fn(), {
            signal: controller.signal,
        });

        controller.abort(reason);

        await pending;
        expect(cancel).toHaveBeenCalledWith(reason);
    });
});

describe('storefront realtime query targeting', () => {
    it('invalidates catalog lists and only the changed Product detail', () => {
        const changed = event({ entityType: 'Product', entityIds: ['product-1'] });

        expect(
            storefrontRealtimeQueryMatches(
                { queryKey: storefrontQueryKeys.catalog('store-a', 'zh_Hans', {}) },
                changed,
                scope,
            ),
        ).toBe(true);
        expect(
            storefrontRealtimeQueryMatches(
                { queryKey: storefrontQueryKeys.product('store-a', 'zh_Hans', 'product-1') },
                changed,
                scope,
            ),
        ).toBe(true);
        expect(
            storefrontRealtimeQueryMatches(
                { queryKey: storefrontQueryKeys.product('store-a', 'zh_Hans', 'product-2') },
                changed,
                scope,
            ),
        ).toBe(false);
    });

    it('does not invalidate another Channel or an unrelated query family', () => {
        const changed = event({ topics: ['content'] });

        expect(
            storefrontRealtimeQueryMatches(
                { queryKey: storefrontQueryKeys.content('store-b', 'zh_Hans') },
                changed,
                scope,
            ),
        ).toBe(false);
        expect(
            storefrontRealtimeQueryMatches(
                { queryKey: storefrontQueryKeys.config('store-a', 'zh_Hans') },
                changed,
                scope,
            ),
        ).toBe(false);
    });

    it('refreshes the language-independent commerce mode only for the active store', () => {
        const changed = event({ topics: ['config'] });

        expect(
            storefrontRealtimeQueryMatches(
                { queryKey: storefrontQueryKeys.commerceMode('store-a') },
                changed,
                scope,
            ),
        ).toBe(true);
        expect(
            storefrontRealtimeQueryMatches(
                { queryKey: storefrontQueryKeys.commerceMode('store-b') },
                changed,
                scope,
            ),
        ).toBe(false);
    });

    it('targets private order and coupon queries for the active customer', () => {
        const changed = event({ topics: ['orders', 'coupons'] });

        expect(
            storefrontRealtimeQueryMatches(
                { queryKey: storefrontQueryKeys.customerOrders('store-a', 'zh_Hans', 'customer-1', {}) },
                changed,
                scope,
            ),
        ).toBe(true);
        expect(
            storefrontRealtimeQueryMatches(
                { queryKey: storefrontQueryKeys.customerCoupons('store-a', 'zh_Hans', 'customer-2') },
                changed,
                scope,
            ),
        ).toBe(false);
        expect(
            storefrontRealtimeQueryMatches(
                { queryKey: storefrontQueryKeys.couponCampaigns('store-a', 'zh_Hans', 'customer-1') },
                changed,
                scope,
            ),
        ).toBe(true);
        expect(
            storefrontRealtimeQueryMatches(
                { queryKey: storefrontQueryKeys.couponCampaigns('store-a', 'zh_Hans', 'customer-2') },
                changed,
                scope,
            ),
        ).toBe(false);
    });

    it('refreshes the active identity coupon campaign query for content changes', () => {
        const changed = event({ topics: ['content'] });

        expect(
            storefrontRealtimeQueryMatches(
                { queryKey: storefrontQueryKeys.couponCampaigns('store-a', 'zh_Hans', 'customer-1') },
                changed,
                scope,
            ),
        ).toBe(true);
        expect(
            storefrontRealtimeQueryMatches(
                { queryKey: storefrontQueryKeys.couponCampaigns('store-a', 'zh_Hans', null) },
                changed,
                { ...scope, customerId: undefined },
            ),
        ).toBe(true);
    });
});
