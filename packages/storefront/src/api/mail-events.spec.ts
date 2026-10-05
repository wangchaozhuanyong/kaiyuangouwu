// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { watchMailEvents } from './mail-events';

const active: AbortController[] = [];
function fixture() {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
        start: source => {
            stream = source;
        },
    });
    const send = (event: string, payload: unknown) =>
        stream.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
    const ready = () => send('ready', { version: 1, cursor: '7', heartbeatIntervalMs: 15_000 });
    const controller = new AbortController();
    active.push(controller);
    return { body, send, ready, controller, stream };
}
afterEach(() => {
    active.splice(0).forEach(controller => controller.abort());
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('private mailbox transport', () => {
    it('keeps the code out of the URL, deduplicates events and never reads business data on heartbeat', async () => {
        vi.useFakeTimers();
        const f = fixture();
        const fetch = vi.fn().mockResolvedValue({
            ok: true,
            headers: new Headers({ 'content-type': 'text/event-stream' }),
            body: f.body,
        });
        vi.stubGlobal('fetch', fetch);
        const onChange = vi.fn();
        const onStatus = vi.fn();
        const watching = watchMailEvents(
            'BUY-AAAA-BBBB',
            { 'vendure-token': 'store-a' },
            { onChange, onStatus },
            f.controller.signal,
        );
        await vi.advanceTimersByTimeAsync(0);
        f.ready();
        await vi.advanceTimersByTimeAsync(0);
        expect(fetch.mock.calls[0][0]).not.toContain('BUY-');
        expect(JSON.parse(fetch.mock.calls[0][1].body).queryCode).toBe('BUY-AAAA-BBBB');
        expect(fetch.mock.calls[0][1].headers['vendure-token']).toBe('store-a');
        f.send('mail', { eventId: 'event-1', cursor: '8' });
        f.send('mail', { eventId: 'event-1', cursor: '8' });
        await vi.advanceTimersByTimeAsync(0);
        expect(onChange).toHaveBeenCalledTimes(2); // Initial reconciliation plus one unique mail.
        for (let i = 0; i < 8; i++) {
            f.stream.enqueue(new TextEncoder().encode(': heartbeat\n\n'));
            await vi.advanceTimersByTimeAsync(15_000);
        }
        expect(fetch).toHaveBeenCalledOnce();
        expect(onChange).toHaveBeenCalledTimes(2);
        f.controller.abort();
        await watching;
        expect(vi.getTimerCount()).toBe(0);
    });

    it('reconnects with the last cursor after heartbeat loss and reconciles even without a replay', async () => {
        vi.useFakeTimers();
        const first = fixture();
        const next = fixture();
        const fetch = vi
            .fn()
            .mockResolvedValueOnce({
                ok: true,
                headers: new Headers({ 'content-type': 'text/event-stream' }),
                body: first.body,
            })
            .mockResolvedValueOnce({
                ok: true,
                headers: new Headers({ 'content-type': 'text/event-stream' }),
                body: next.body,
            });
        vi.stubGlobal('fetch', fetch);
        vi.spyOn(Math, 'random').mockReturnValue(0);
        const onChange = vi.fn();
        const onStatus = vi.fn();
        const watching = watchMailEvents(
            'BUY-AAAA-BBBB',
            {},
            { onChange, onStatus },
            first.controller.signal,
        );
        await vi.advanceTimersByTimeAsync(0);
        first.ready();
        await vi.advanceTimersByTimeAsync(0);
        first.send('mail', { eventId: 'last-event', cursor: '11' });
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(46_000);
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(JSON.parse(fetch.mock.calls[1][1].body).cursor).toBe('11');
        next.ready();
        await vi.advanceTimersByTimeAsync(0);
        expect(onChange).toHaveBeenCalledTimes(3);
        first.controller.abort();
        await watching;
    });

    it('reconnects after the result read fails so the notification cannot disappear permanently', async () => {
        vi.useFakeTimers();
        const first = fixture();
        const next = fixture();
        vi.spyOn(Math, 'random').mockReturnValue(0);
        const fetch = vi
            .fn()
            .mockResolvedValueOnce({
                ok: true,
                headers: new Headers({ 'content-type': 'text/event-stream' }),
                body: first.body,
            })
            .mockResolvedValueOnce({
                ok: true,
                headers: new Headers({ 'content-type': 'text/event-stream' }),
                body: next.body,
            });
        vi.stubGlobal('fetch', fetch);
        const onChange = vi.fn().mockRejectedValueOnce(new Error('read failed')).mockResolvedValue(undefined);
        const watching = watchMailEvents(
            'BUY-AAAA-BBBB',
            {},
            { onChange, onStatus: vi.fn() },
            first.controller.signal,
        );
        await vi.advanceTimersByTimeAsync(0);
        first.ready();
        await vi.advanceTimersByTimeAsync(1000);
        expect(fetch).toHaveBeenCalledTimes(2);
        next.ready();
        await vi.advanceTimersByTimeAsync(0);
        expect(onChange).toHaveBeenCalledTimes(2);
        first.controller.abort();
        await watching;
    });

    it('stops when an old reverse proxy returns the HTML app shell instead of SSE', async () => {
        vi.useFakeTimers();
        const f = fixture();
        const onStatus = vi.fn();
        const fetch = vi.fn().mockResolvedValue({
            ok: true,
            body: f.body,
            headers: new Headers({ 'content-type': 'text/html' }),
        });
        vi.stubGlobal('fetch', fetch);
        await watchMailEvents('BUY-AAAA-BBBB', {}, { onChange: vi.fn(), onStatus }, f.controller.signal);
        await vi.advanceTimersByTimeAsync(120_000);
        expect(fetch).toHaveBeenCalledOnce();
        expect(onStatus).toHaveBeenLastCalledWith('unavailable');
    });

    it.each([
        [403, 'denied'],
        [409, 'unavailable'],
        [404, 'unavailable'],
    ] as const)('stops on HTTP %s and never falls back to polling', async (status, expected) => {
        vi.useFakeTimers();
        const f = fixture();
        const onStatus = vi.fn();
        const onChange = vi.fn();
        const fetch = vi.fn().mockResolvedValue({ ok: false, status, body: null });
        vi.stubGlobal('fetch', fetch);
        await watchMailEvents('BUY-AAAA-BBBB', {}, { onChange, onStatus }, f.controller.signal);
        await vi.advanceTimersByTimeAsync(120_000);
        expect(onStatus).toHaveBeenLastCalledWith(expected);
        expect(fetch).toHaveBeenCalledOnce();
        expect(onChange).not.toHaveBeenCalled();
    });
});
