import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OrderEventsService } from '../service/order-events.service';

import { OrderEventsController } from './order-events.controller';

function harness() {
    const remove = vi.fn();
    const subscribe = vi.fn<OrderEventsService['subscribe']>(() => ({
        cursor: 'server:0',
        replay: [],
        remove,
    }));
    const session = {
        user: { channelPermissions: [{ id: 'a', permissions: ['ReadOrder'] }] },
        expires: new Date(Date.now() + 3600000),
    };
    const getSessionFromToken = vi.fn().mockResolvedValue(session);
    const controller = new OrderEventsController({ subscribe } as never, { getSessionFromToken } as never);
    const ctx = {
        channelId: 'a',
        session: { ...session, token: 'fixture-session' },
        userHasPermissions: () => true,
    };
    const req = Object.assign(new EventEmitter(), { aborted: false, get: vi.fn() });
    const res = Object.assign(new EventEmitter(), {
        destroyed: false,
        writableEnded: false,
        status: vi.fn(),
        setHeader: vi.fn(),
        flushHeaders: vi.fn(),
        write: vi.fn(() => true),
        end: vi.fn(),
    });
    res.status.mockReturnValue(res);
    return { controller, ctx, req, res, subscribe, remove, getSessionFromToken, session };
}
const payload = {
    kind: 'order-placed',
    version: 1,
    id: 'server:1',
    orderId: '1',
    occurredAt: '2026-09-10T00:00:00Z',
} as const;
async function flush() {
    for (let i = 0; i < 8; i++) await Promise.resolve();
}
afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
});

describe('authenticated order event stream', () => {
    it('keeps the connection alive without polling orders or sessions, and checks permission only when sending an event', async () => {
        vi.useFakeTimers();
        const h = harness();
        h.controller.stream(h.ctx as never, h.req as never, h.res as never);
        await vi.advanceTimersByTimeAsync(600000);
        expect(h.getSessionFromToken).not.toHaveBeenCalled();
        expect(h.subscribe).toHaveBeenCalledTimes(1);
        expect(h.res.write).toHaveBeenCalledWith(': heartbeat\n\n');
        h.subscribe.mock.calls[0][2](payload);
        await flush();
        expect(h.getSessionFromToken).toHaveBeenCalledTimes(1);
        expect(h.res.write).toHaveBeenCalledWith(expect.stringContaining('event: order-placed'));
        h.res.emit('close');
        expect(h.remove).toHaveBeenCalledOnce();
    });
    it('delivers pending reminders through the same authenticated stream', async () => {
        const h = harness();
        h.controller.stream(h.ctx as never, h.req as never, h.res as never);
        h.subscribe.mock.calls[0][2]({ ...payload, kind: 'order-pending' });
        await flush();
        expect(h.res.write).toHaveBeenCalledWith(expect.stringContaining('event: order-pending'));
        expect(h.getSessionFromToken).toHaveBeenCalledOnce();
        h.res.emit('close');
    });
    it('rejects missing order permission before opening the stream', () => {
        const h = harness();
        h.ctx.userHasPermissions = () => false;
        h.controller.stream(h.ctx as never, h.req as never, h.res as never);
        expect(h.res.status).toHaveBeenCalledWith(403);
        expect(h.subscribe).not.toHaveBeenCalled();
    });
    it('closes without delivering an order after the session is revoked', async () => {
        vi.useFakeTimers();
        const h = harness();
        h.controller.stream(h.ctx as never, h.req as never, h.res as never);
        await flush();
        h.getSessionFromToken.mockResolvedValue(undefined);
        h.res.write.mockClear();
        h.subscribe.mock.calls[0][2](payload);
        await flush();
        expect(h.res.write).not.toHaveBeenCalled();
        expect(h.res.end).toHaveBeenCalled();
    });
    it('closes without delivering an event after Channel permission is removed', async () => {
        vi.useFakeTimers();
        const h = harness();
        h.controller.stream(h.ctx as never, h.req as never, h.res as never);
        await flush();
        h.session.user.channelPermissions = [{ id: 'other', permissions: ['ReadOrder'] }];
        h.res.write.mockClear();
        h.subscribe.mock.calls[0][2](payload);
        await flush();
        expect(h.res.write).not.toHaveBeenCalled();
        expect(h.remove).toHaveBeenCalled();
    });
    it('closes a backpressured client and cancels keepalive', async () => {
        vi.useFakeTimers();
        const h = harness();
        h.controller.stream(h.ctx as never, h.req as never, h.res as never);
        await flush();
        h.res.write.mockReturnValue(false);
        await vi.advanceTimersByTimeAsync(25000);
        expect(h.remove).toHaveBeenCalledOnce();
        h.res.write.mockClear();
        await vi.advanceTimersByTimeAsync(60000);
        expect(h.res.write).not.toHaveBeenCalled();
    });
    it('expires the stream without an idle session lookup', async () => {
        vi.useFakeTimers();
        const h = harness();
        h.ctx.session.expires = new Date(Date.now() + 1000);
        h.controller.stream(h.ctx as never, h.req as never, h.res as never);
        await vi.advanceTimersByTimeAsync(1001);
        expect(h.remove).toHaveBeenCalledOnce();
        expect(h.getSessionFromToken).not.toHaveBeenCalled();
    });
});
