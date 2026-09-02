import { describe, expect, it, vi } from 'vitest';

import { storefrontQueryKeys } from './query-client';
import {
    consumeStorefrontRealtimeStream,
    parseStorefrontRealtimeFrame,
    StorefrontRealtimeEvent,
    storefrontRealtimeQueryMatches,
} from './realtime-updates';

const scope = { marketCode: 'store-a', languageCode: 'zh_Hans', customerId: 'customer-1' };

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
