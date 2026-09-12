// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { subscribeAdminFeedback, type AdminFeedback } from '../utils/admin-feedback';
import { OrderNotifications } from './OrderNotifications';

const { openStream } = vi.hoisted(() => ({ openStream: vi.fn() }));
vi.mock('../apollo', () => ({ openAdminOrderEvents: openStream }));
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
let container: HTMLDivElement;
let root: Root;
let events: AdminFeedback[];
let unsubscribe: () => void;
let play: ReturnType<typeof vi.spyOn>;
let streams: ReturnType<typeof stream>[];

function stream() {
    let control!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn();
    const response = new Response(
        new ReadableStream({
            start(controller) {
                control = controller;
            },
            cancel,
        }),
        { headers: { 'content-type': 'text/event-stream' } },
    );
    const send = (frame: string) => control.enqueue(new TextEncoder().encode(frame));
    return { response, send, cancel, end: () => control.close() };
}
const frame = (orderId = 'new', id = 'server:1') =>
    `id: ${id}\nevent: order-placed\ndata: ${JSON.stringify({ version: 1, id, orderId, occurredAt: '2026-09-10T01:00:00Z' })}\n\n`;
async function render(channelId = '1') {
    await act(async () => {
        root.render(
            <OrderNotifications
                key={channelId}
                administratorId="admin-1"
                channelId={channelId}
                channelToken={`channel-${channelId}`}
            />,
        );
    });
}
async function send(data: string) {
    await act(async () => {
        streams.at(-1)!.send(data);
    });
}
async function click() {
    await act(async () => {
        container.querySelector('button')!.click();
    });
}

beforeEach(() => {
    vi.useFakeTimers();
    environment.IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    document.documentElement.lang = 'zh-CN';
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    events = [];
    streams = [];
    unsubscribe = subscribeAdminFeedback(event => events.push(event));
    openStream.mockReset().mockImplementation(() => {
        const next = stream();
        streams.push(next);
        return Promise.resolve(next.response);
    });
    play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
    unsubscribe();
    vi.restoreAllMocks();
    vi.useRealTimers();
    environment.IS_REACT_ACT_ENVIRONMENT = false;
});

describe('event-driven order announcements', () => {
    it('keeps one connection for ten idle minutes; readiness and heartbeat never play sound or request orders', async () => {
        await render();
        await send('event: ready\ndata: {"version":1,"cursor":"server:0"}\n\n: heartbeat\n\n');
        await act(async () => {
            await vi.advanceTimersByTimeAsync(600000);
        });
        expect(openStream).toHaveBeenCalledTimes(1);
        expect(openStream).toHaveBeenCalledWith('channel-1', expect.any(AbortSignal), undefined);
        expect(play).not.toHaveBeenCalled();
    });
    it('plays Chinese only for a new placement and deduplicates replayed orders', async () => {
        await render();
        await send(frame());
        await send(frame());
        await send(frame('new', 'server:2'));
        expect(play).toHaveBeenCalledTimes(1);
        expect((play.mock.instances[0] as HTMLAudioElement).src).toMatch(/new-order-zh\.mp3$/);
        expect(events.filter(event => event.id === 'new-order-notification')).toHaveLength(1);
    });
    it('selects English using the page language at delivery time', async () => {
        await render();
        await act(async () => {
            document.documentElement.lang = 'en-GB';
        });
        await send(frame());
        expect((play.mock.instances[0] as HTMLAudioElement).src).toMatch(/new-order-en\.mp3$/);
        expect(events.at(-1)?.title).toBe('You have a new order. Please check it.');
    });
    it('announces successive pending reminders for the same order and deduplicates identical events', async () => {
        await render();
        await send(frame());
        const reminder = frame('new', 'server:2').replace('event: order-placed', 'event: order-pending');
        await send(reminder);
        await send(reminder);
        expect(play).toHaveBeenCalledTimes(2);
        expect((play.mock.instances.at(-1) as HTMLAudioElement).src).toMatch(/pending-order-zh\.mp3$/);
        expect(events.at(-1)?.title).toBe('您有未处理的订单，请您及时处理。');
        await act(async () => {
            document.documentElement.lang = 'en-US';
        });
        await send(reminder.replaceAll('server:2', 'server:3'));
        expect(play).toHaveBeenCalledTimes(3);
        expect((play.mock.instances.at(-1) as HTMLAudioElement).src).toMatch(/pending-order-en\.mp3$/);
        expect(events.at(-1)?.title).toBe('You have pending orders. Please process them promptly.');
        expect(openStream).toHaveBeenCalledTimes(1);
    });
    it('shows pending reminder text while muted without playing audio', async () => {
        localStorage.setItem('next-admin:order-voice:admin-1', 'muted');
        await render();
        await send(frame().replace('event: order-placed', 'event: order-pending'));
        expect(play).not.toHaveBeenCalled();
        expect(events.at(-1)?.title).toBe('您有未处理的订单，请您及时处理。');
    });
    it('reconnects only after disconnect, using the last cursor for missed events', async () => {
        await render();
        await send('event: ready\ndata: {"version":1,"cursor":"server:0"}\n\n');
        await act(async () => {
            streams[0].end();
        });
        expect(openStream).toHaveBeenCalledTimes(1);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
        });
        expect(openStream).toHaveBeenLastCalledWith('channel-1', expect.any(AbortSignal), 'server:0');
        await send(frame('missed'));
        await send('event: ready\ndata: {"version":1,"cursor":"server:1"}\n\n');
        expect(play).toHaveBeenCalledTimes(1);
        expect(events.some(event => event.title === '订单提醒连接已恢复')).toBe(true);
    });
    it('stops a previous channel stream and resets its cursor on channel change', async () => {
        await render();
        await send(frame());
        const previousSignal = openStream.mock.calls[0][1];
        await render('2');
        expect(previousSignal.aborted).toBe(true);
        expect(streams[0].cancel).toHaveBeenCalled();
        expect(openStream).toHaveBeenLastCalledWith('channel-2', expect.any(AbortSignal), undefined);
    });
    it('handles autoplay blocking and retries from the sound button', async () => {
        await render();
        play.mockRejectedValueOnce(new DOMException('Blocked', 'NotAllowedError'));
        await send(frame());
        expect(events.at(-1)?.title).toContain('点击顶部声音按钮');
        await click();
        expect(container.querySelector('button')?.getAttribute('aria-pressed')).toBe('true');
    });
    it('retains text notifications while muted and remembers the preference', async () => {
        await render();
        await click();
        await click();
        play.mockClear();
        await send(frame());
        expect(localStorage.getItem('next-admin:order-voice:admin-1')).toBe('muted');
        expect(play).not.toHaveBeenCalled();
        expect(events.at(-1)?.id).toBe('new-order-notification');
        await click();
        await send(frame());
        expect(play).toHaveBeenCalledTimes(1);
    });
    it('restores a muted preference', async () => {
        localStorage.setItem('next-admin:order-voice:admin-1', 'muted');
        await render();
        await send(frame());
        expect(play).not.toHaveBeenCalled();
    });
    it.each([401, 403])('does not retry a rejected session or permission (%s)', async status => {
        openStream.mockResolvedValueOnce(new Response(null, { status }));
        await render();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(600000);
        });
        expect(openStream).toHaveBeenCalledTimes(1);
        expect(events.at(-1)?.title).toContain('重新登录');
    });
    it('aborts the stream and reconnect timer on unmount', async () => {
        await render();
        await act(async () => {
            streams[0].end();
        });
        await act(async () => {
            root.render(null);
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(60000);
        });
        expect(openStream).toHaveBeenCalledTimes(1);
        expect(openStream.mock.calls[0][1].aborted).toBe(true);
    });
    it('keeps a visible order notification if audio fails', async () => {
        await render();
        play.mockRejectedValue(new DOMException('Missing', 'NotSupportedError'));
        await send(frame());
        expect(events.some(event => event.id === 'new-order-notification')).toBe(true);
        expect(events.at(-1)?.title).toContain('订单语音播放失败');
    });
});
