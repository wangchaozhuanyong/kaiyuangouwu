// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

import { watchRechargeEvents } from './recharge-events';

vi.mock('./session-transport', () => ({
    sessionTransport: (
        _url: string,
        _exclusive: boolean,
        _signal: AbortSignal,
        run: () => Promise<Response>,
    ) => run(),
}));
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});
const id = '11111111-1111-4111-8111-111111111111';
const credential = 'a'.repeat(64);
const ready = 'event: ready\ndata: {}\n\n';
const stream = (content: string) =>
    new Response(content, { headers: { 'content-type': 'text/event-stream' } });

it('keeps the task capability in the POST body and stops after the terminal snapshot', async () => {
    const snapshot = { id, credential, status: 'succeeded', updatedAt: new Date().toISOString() };
    const request = vi
        .fn()
        .mockResolvedValue(stream(ready + 'event: task\ndata: ' + JSON.stringify(snapshot) + '\n\n'));
    vi.stubGlobal('fetch', request);
    const receive = vi.fn();
    await watchRechargeEvents(
        id,
        credential,
        'shop',
        () => null,
        new AbortController().signal,
        receive,
        vi.fn(),
    );
    expect(request).toHaveBeenCalledOnce();
    const [url, options] = request.mock.calls[0];
    expect(url.pathname).toBe('/storefront-realtime/recharge-events');
    expect(url.search).toBe('');
    expect(String(url)).not.toContain(credential);
    expect(options).toMatchObject({
        method: 'POST',
        cache: 'no-store',
        body: JSON.stringify({ id, credential }),
    });
    expect(receive).toHaveBeenCalledExactlyOnceWith(snapshot);
});

it('backs off repeated ready-then-closed streams instead of restarting at two seconds', async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockImplementation(() => Promise.resolve(stream(ready)));
    vi.stubGlobal('fetch', request);
    const abort = new AbortController();
    const run = watchRechargeEvents(id, credential, 'shop', () => null, abort.signal, vi.fn(), vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4999);
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(request).toHaveBeenCalledTimes(3);
    abort.abort();
    await run;
    await vi.advanceTimersByTimeAsync(60000);
    expect(request).toHaveBeenCalledTimes(3);
});

it('stops reconnecting when the task credential is denied', async () => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));
    vi.stubGlobal('fetch', request);
    const connection = vi.fn();
    await watchRechargeEvents(
        id,
        credential,
        'shop',
        () => null,
        new AbortController().signal,
        vi.fn(),
        connection,
    );
    expect(connection).toHaveBeenLastCalledWith('denied');
    expect(request).toHaveBeenCalledOnce();
});
