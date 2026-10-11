// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { openStream } = vi.hoisted(() => ({ openStream: vi.fn() }));
vi.mock('../apollo', () => ({ openAdminOrderEvents: openStream }));

class BrowserChannel {
    static channels = new Set<BrowserChannel>();
    onmessage?: (event: { data: unknown }) => void;
    constructor(public name: string) {
        BrowserChannel.channels.add(this);
    }
    postMessage(data: unknown) {
        for (const peer of BrowserChannel.channels) {
            if (peer === this || peer.name !== this.name) continue;
            queueMicrotask(() => {
                if (BrowserChannel.channels.has(peer)) peer.onmessage?.({ data: structuredClone(data) });
            });
        }
    }
    close() {
        BrowserChannel.channels.delete(this);
    }
}

function browserLocks() {
    const queues = new Map<
        string,
        Array<{
            started: boolean;
            signal: AbortSignal;
            run: () => Promise<unknown>;
            resolve: (value: unknown) => void;
            reject: (error: unknown) => void;
            abort: () => void;
        }>
    >();
    const drain = (name: string) => {
        const queue = queues.get(name);
        const task = queue?.[0];
        if (!task || task.started) return;
        task.started = true;
        void Promise.resolve()
            .then(task.run)
            .then(task.resolve, task.reject)
            .finally(() => {
                task.signal.removeEventListener('abort', task.abort);
                queue!.shift();
                if (!queue!.length) queues.delete(name);
                else drain(name);
            });
    };
    return {
        request: vi.fn(
            (name: string, options: { signal: AbortSignal }, callback: () => Promise<unknown>) =>
                new Promise((resolve, reject) => {
                    const queue = queues.get(name) ?? [];
                    const task = {
                        started: false,
                        signal: options.signal,
                        run: callback,
                        resolve,
                        reject,
                        abort: () => {},
                    };
                    task.abort = () => {
                        if (task.started) return;
                        const index = queue.indexOf(task);
                        if (index >= 0) queue.splice(index, 1);
                        reject(new DOMException('Cancelled', 'AbortError'));
                        if (!queue.length) queues.delete(name);
                        else drain(name);
                    };
                    if (options.signal.aborted) return task.abort();
                    options.signal.addEventListener('abort', task.abort, { once: true });
                    queue.push(task);
                    queues.set(name, queue);
                    drain(name);
                }),
        ),
    };
}

function stream() {
    let writer!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn();
    const response = new Response(
        new ReadableStream({
            start: value => {
                writer = value;
            },
            cancel,
        }),
        {
            headers: { 'content-type': 'text/event-stream' },
        },
    );
    return { response, cancel, send: (frame: string) => writer.enqueue(new TextEncoder().encode(frame)) };
}
const frame = (orderId: string, id = 'server:1') =>
    `id: ${id}\nevent: order-placed\ndata: ${JSON.stringify({ version: 1, id, orderId, occurredAt: '2026-10-11' })}\n\n`;
const handlers = () => ({ ready: vi.fn(), order: vi.fn(), status: vi.fn() });
async function flush() {
    for (let i = 0; i < 35; i++) await Promise.resolve();
}
async function separateEventRuntime() {
    // Separate module instances model separate browser tabs; locks, storage and channel bus are shared.
    vi.resetModules();
    return import('./admin-order-events');
}
async function separateVoiceRuntime() {
    vi.resetModules();
    return import('./admin-order-voice');
}
const cleanups: Array<() => void> = [];
let streams: ReturnType<typeof stream>[];
beforeEach(() => {
    localStorage.clear();
    streams = [];
    vi.stubGlobal('BroadcastChannel', BrowserChannel);
    vi.stubGlobal('navigator', { locks: browserLocks() });
    openStream.mockReset().mockImplementation(() => {
        const next = stream();
        streams.push(next);
        return Promise.resolve(next.response);
    });
});
afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    await flush();
    BrowserChannel.channels.clear();
    vi.unstubAllGlobals();
});

describe('browser-shared order transport', () => {
    it('uses one channel connection and relays notifications to a second browser tab', async () => {
        const first = await separateEventRuntime();
        const second = await separateEventRuntime();
        const a = handlers();
        const b = handlers();
        const scope = { administratorId: 'a', channelId: 'shop', channelToken: 'fixture-shop' };
        cleanups.push(first.subscribeAdminOrderEvents(scope, a), second.subscribeAdminOrderEvents(scope, b));
        await flush();
        expect(openStream).toHaveBeenCalledTimes(1);
        streams[0].send('event: ready\ndata: {"version":1,"cursor":"server:0"}\n\n');
        streams[0].send(frame('order'));
        await flush();
        expect(a.order).toHaveBeenCalledTimes(1);
        expect(b.order).toHaveBeenCalledTimes(1);
        expect(b.ready).toHaveBeenCalledWith(false);
        streams[0].send(frame('order', 'server:2'));
        await flush();
        expect(b.order).toHaveBeenCalledTimes(1);
    });
    it('hands ownership to the remaining tab with the last shared cursor when the leader closes', async () => {
        const first = await separateEventRuntime();
        const second = await separateEventRuntime();
        const scope = { administratorId: 'a', channelId: 'shop', channelToken: 'fixture-shop' };
        const removeLeader = first.subscribeAdminOrderEvents(scope, handlers());
        cleanups.push(second.subscribeAdminOrderEvents(scope, handlers()));
        await flush();
        streams[0].send(frame('order', 'server:5'));
        await flush();
        removeLeader();
        await flush();
        expect(openStream.mock.calls[0][1].aborted).toBe(true);
        expect(streams[0].cancel).toHaveBeenCalled();
        expect(openStream).toHaveBeenCalledTimes(2);
        expect(openStream).toHaveBeenLastCalledWith('fixture-shop', expect.any(AbortSignal), 'server:5');
    });
    it('does not let a queued follower reopen an unauthorized channel', async () => {
        openStream.mockResolvedValue(new Response(null, { status: 403 }));
        const first = await separateEventRuntime();
        const second = await separateEventRuntime();
        const a = handlers();
        const b = handlers();
        const scope = { administratorId: 'a', channelId: 'shop', channelToken: 'fixture-shop' };
        cleanups.push(first.subscribeAdminOrderEvents(scope, a), second.subscribeAdminOrderEvents(scope, b));
        await flush();
        expect(openStream).toHaveBeenCalledTimes(1);
        expect(b.status).toHaveBeenCalledWith('unauthorized');
    });
    it('isolates administrator and channel ownership', async () => {
        const runtime = await separateEventRuntime();
        for (const [administratorId, channelId] of [
            ['a', 'one'],
            ['a', 'two'],
            ['b', 'one'],
        ]) {
            cleanups.push(
                runtime.subscribeAdminOrderEvents(
                    { administratorId, channelId, channelToken: 'fixture' },
                    handlers(),
                ),
            );
        }
        await flush();
        expect(openStream).toHaveBeenCalledTimes(3);
    });
});

describe('browser-shared order sound', () => {
    it('claims a single voice for the same order across platform and store tabs and reloads', async () => {
        const first = await separateVoiceRuntime();
        const second = await separateVoiceRuntime();
        const speak = vi.fn(async (started: () => void) => {
            started();
        });
        const signal = new AbortController().signal;
        await Promise.all([
            first.announceOrderOnce('a', 'order', signal, speak),
            second.announceOrderOnce('a', 'order', signal, speak),
        ]);
        expect(speak).toHaveBeenCalledTimes(1);
        const reloaded = await separateVoiceRuntime();
        await reloaded.announceOrderOnce('a', 'order', signal, speak);
        expect(speak).toHaveBeenCalledTimes(1);
    });
    it('does not record blocked playback and cancels a late queued owner', async () => {
        const first = await separateVoiceRuntime();
        const second = await separateVoiceRuntime();
        const signal = new AbortController().signal;
        let release!: () => void;
        const blocked = vi.fn(
            () =>
                new Promise<void>(resolve => {
                    release = resolve;
                }),
        );
        const firstWork = first.announceOrderOnce('a', 'order', signal, blocked);
        await flush();
        const controller = new AbortController();
        const late = vi.fn(async (started: () => void) => {
            started();
        });
        const lateWork = second.announceOrderOnce('a', 'order', controller.signal, late);
        controller.abort();
        release();
        await Promise.all([firstWork, lateWork]);
        expect(late).not.toHaveBeenCalled();
        expect(localStorage.getItem('next-admin:order-announced:a:order')).toBeNull();
        await second.announceOrderOnce('a', 'order', signal, late);
        expect(late).toHaveBeenCalledTimes(1);
    });
    it('broadcasts mute across tabs and keeps silent queued announcements', async () => {
        const first = await separateVoiceRuntime();
        const second = await separateVoiceRuntime();
        const a = vi.fn();
        const b = vi.fn();
        cleanups.push(
            first.subscribeOrderVoicePreference('a', a),
            second.subscribeOrderVoicePreference('a', b),
        );
        first.setOrderVoiceMuted('a', true);
        await flush();
        expect(a).toHaveBeenCalledWith(true);
        expect(b).toHaveBeenCalledWith(true);
        const speak = vi.fn();
        await second.announceOrderOnce('a', 'order', new AbortController().signal, speak);
        expect(speak).not.toHaveBeenCalled();
    });
});
