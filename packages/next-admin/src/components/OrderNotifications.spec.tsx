// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RESOURCE_INVALIDATION_EVENT, type ResourceDomain } from '../runtime/admin-resource-events';
import { subscribeAdminFeedback, type AdminFeedback } from '../utils/admin-feedback';
import { OrderNotifications } from './OrderNotifications';

const { openStream } = vi.hoisted(() => ({ openStream: vi.fn() }));
vi.mock('../apollo', () => ({ openAdminOrderEvents: openStream }));
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
let container: HTMLDivElement;
let root: Root;
let events: AdminFeedback[];
let unsubscribe: () => void;
let play: ReturnType<typeof vi.fn>;
let cancelSpeech: ReturnType<typeof vi.fn>;
let audioPlay: ReturnType<typeof vi.fn>;
let audioPause: ReturnType<typeof vi.fn>;
let audioInstances: Array<{ src: string; onplaying?: () => void }>;
let voices: SpeechSynthesisVoice[];
let voiceEvents: EventTarget;
let administratorId: string;
let sequence = 0;
let streams: ReturnType<typeof stream>[];
let invalidations: Array<{ domains: ResourceDomain[]; reason: 'write' | 'event' }>;
const recordInvalidation = (event: Event) => {
    invalidations.push((event as CustomEvent<(typeof invalidations)[number]>).detail);
};

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
                administratorId={administratorId}
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
    administratorId = `admin-${++sequence}`;
    document.documentElement.lang = 'zh-CN';
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    events = [];
    streams = [];
    invalidations = [];
    window.addEventListener(RESOURCE_INVALIDATION_EVENT, recordInvalidation);
    unsubscribe = subscribeAdminFeedback(event => events.push(event));
    openStream.mockReset().mockImplementation(() => {
        const next = stream();
        streams.push(next);
        return Promise.resolve(next.response);
    });
    vi.stubGlobal(
        'SpeechSynthesisUtterance',
        class {
            lang = '';
            onstart?: () => void;
            onend?: () => void;
            constructor(public text: string) {}
        },
    );
    play = vi.fn().mockImplementation(utterance => {
        utterance.onstart?.();
        utterance.onend?.();
    });
    cancelSpeech = vi.fn();
    voices = [
        { lang: 'zh-CN', name: 'Synthetic Chinese', default: true },
        { lang: 'en-US', name: 'Synthetic English', default: true },
    ] as SpeechSynthesisVoice[];
    voiceEvents = new EventTarget();
    vi.stubGlobal('speechSynthesis', {
        speak: play,
        cancel: cancelSpeech,
        getVoices: () => voices,
        addEventListener: voiceEvents.addEventListener.bind(voiceEvents),
        removeEventListener: voiceEvents.removeEventListener.bind(voiceEvents),
    });
    audioPlay = vi.fn().mockResolvedValue(undefined);
    audioPause = vi.fn();
    audioInstances = [];
    vi.stubGlobal(
        'Audio',
        class {
            preload = '';
            onplaying?: () => void;
            onended?: () => void;
            onerror?: () => void;
            constructor(public src: string) {
                audioInstances.push(this);
            }
            play = audioPlay;
            pause = audioPause;
            removeAttribute(name: string) {
                if (name === 'src') this.src = '';
            }
        },
    );
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
    unsubscribe();
    window.removeEventListener(RESOURCE_INVALIDATION_EVENT, recordInvalidation);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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
        expect(invalidations).toEqual([]);
    });
    it('plays Chinese only for a new placement and deduplicates replayed orders', async () => {
        await render();
        await send(frame());
        await send(frame());
        await send(frame('new', 'server:2'));
        expect(play).toHaveBeenCalledTimes(1);
        expect(play.mock.calls[0][0].lang).toBe('zh-CN');
        expect(play.mock.calls[0][0].text).toBe('您有新的订单，请您查看。');
        expect(events.filter(event => event.id === 'new-order-notification')).toHaveLength(1);
    });
    it('selects English using the page language at delivery time', async () => {
        await render();
        await act(async () => {
            document.documentElement.lang = 'en-GB';
        });
        await send(frame());
        expect(play.mock.calls[0][0].lang).toBe('en-US');
        expect(events.at(-1)?.title).toBe('You have a new order. Please check it.');
    });
    it('keeps successive pending reminder text but announces an order only once', async () => {
        await render();
        await send(frame());
        const reminder = frame('new', 'server:2').replace('event: order-placed', 'event: order-pending');
        await send(reminder);
        await send(reminder);
        expect(play).toHaveBeenCalledTimes(1);
        expect(events.at(-1)?.title).toBe('您有未处理的订单，请您及时处理。');
        await act(async () => {
            document.documentElement.lang = 'en-US';
        });
        await send(reminder.replaceAll('server:2', 'server:3'));
        expect(play).toHaveBeenCalledTimes(1);
        expect(events.at(-1)?.title).toBe('You have pending orders. Please process them promptly.');
        expect(openStream).toHaveBeenCalledTimes(1);
    });
    it('shows pending reminder text while muted without playing audio', async () => {
        localStorage.setItem(`next-admin:order-voice:${administratorId}`, 'muted');
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
    it.each(['server:0', 'restarted-server:0'])(
        'invalidates orders and catalog once on recovered readiness without replay (%s)',
        async cursor => {
            await render();
            await send('event: ready\ndata: {"version":1,"cursor":"server:0"}\n\n');
            expect(invalidations).toEqual([]);
            await act(async () => {
                streams[0].end();
            });
            await act(async () => {
                await vi.advanceTimersByTimeAsync(1000);
            });
            await send(`event: ready\ndata: ${JSON.stringify({ version: 1, cursor })}\n\n`);
            expect(invalidations).toEqual([{ domains: ['orders', 'catalog'], reason: 'event' }]);
            expect(play).not.toHaveBeenCalled();
            expect(events.some(event => event.title === '订单提醒连接已恢复')).toBe(true);
            await send(`event: ready\ndata: ${JSON.stringify({ version: 1, cursor })}\n\n: heartbeat\n\n`);
            expect(invalidations).toHaveLength(1);
        },
    );
    it('refreshes resources after the initial connection attempt failed', async () => {
        openStream.mockRejectedValueOnce(new TypeError('Connection unavailable'));
        await render();
        expect(invalidations).toEqual([]);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
        });
        await send('event: ready\ndata: {"version":1,"cursor":"server:0"}\n\n');
        expect(invalidations).toEqual([{ domains: ['orders', 'catalog'], reason: 'event' }]);
        expect(play).not.toHaveBeenCalled();
    });
    it('ignores a late reconnect response from a previous channel', async () => {
        await render();
        await send('event: ready\ndata: {"version":1,"cursor":"server:0"}\n\n');
        await act(async () => {
            streams[0].end();
        });
        let resolveReconnect!: (response: Response) => void;
        openStream.mockImplementationOnce(
            () => new Promise<Response>(resolve => (resolveReconnect = resolve)),
        );
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
        });
        const previousSignal = openStream.mock.calls.at(-1)![1] as AbortSignal;
        const lateStream = stream();
        lateStream.send('event: ready\ndata: {"version":1,"cursor":"restarted-server:0"}\n\n');
        await render('2');
        await act(async () => {
            resolveReconnect(lateStream.response);
        });
        expect(previousSignal.aborted).toBe(true);
        expect(lateStream.cancel).toHaveBeenCalledTimes(1);
        await send('event: ready\ndata: {"version":1,"cursor":"channel-2-server:0"}\n\n');
        expect(invalidations).toEqual([]);
        expect(events.some(event => event.title === '订单提醒连接已恢复')).toBe(false);
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
        play.mockImplementationOnce(() => {
            throw new DOMException('Blocked', 'NotAllowedError');
        });
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
        expect(localStorage.getItem(`next-admin:order-voice:${administratorId}`)).toBe('muted');
        expect(play).not.toHaveBeenCalled();
        expect(events.at(-1)?.id).toBe('new-order-notification');
        await click();
        await send(frame());
        expect(play).toHaveBeenCalledTimes(1);
    });
    it('restores a muted preference', async () => {
        localStorage.setItem(`next-admin:order-voice:${administratorId}`, 'muted');
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
        expect(invalidations).toEqual([]);
    });
    it('keeps a visible order notification if audio fails', async () => {
        await render();
        play.mockImplementation(() => {
            throw new DOMException('Missing', 'NotSupportedError');
        });
        audioPlay.mockRejectedValue(new DOMException('Missing recording', 'NotSupportedError'));
        await send(frame());
        expect(events.some(event => event.id === 'new-order-notification')).toBe(true);
        expect(events.at(-1)?.title).toContain('订单语音播放失败');
    });
    it('uses the existing localized recording when synthesis is unavailable and keeps the store name in text', async () => {
        vi.stubGlobal('speechSynthesis', undefined);
        document.documentElement.lang = 'en-US';
        await render();
        const named = frame('fallback-order')
            .replace('event: order-placed', 'event: order-pending')
            .replace(
                '"occurredAt":',
                '"store":{"id":"store-a","nameZh":"真实网店","nameEn":"Real Store"},"occurredAt":',
            );
        await send(named);
        expect(play).not.toHaveBeenCalled();
        expect(audioPlay).toHaveBeenCalledTimes(1);
        expect(audioInstances[0].src).toMatch(/\/audio\/pending-order-en\.mp3$/);
        expect(events.at(-1)?.title).toBe('Real Store has pending orders. Please process them promptly.');
        expect(
            localStorage.getItem(`next-admin:order-announced:${administratorId}:store-a:fallback-order`),
        ).toBe('spoken');
    });
    it('waits for a delayed voice list and selects a matching voice without changing store text', async () => {
        voices = [];
        await render();
        await send(frame('delayed-voices'));
        expect(play).not.toHaveBeenCalled();
        expect(container.querySelector('button')).not.toBeNull();
        voices = [
            { lang: 'en-US', default: true },
            { lang: 'zh-CN', default: false },
        ] as SpeechSynthesisVoice[];
        await act(async () => voiceEvents.dispatchEvent(new Event('voiceschanged')));
        expect(play).toHaveBeenCalledTimes(1);
        expect(play.mock.calls[0][0].voice).toBe(voices[1]);
        expect(audioPlay).not.toHaveBeenCalled();
    });
    it('falls back after a bounded voice wait while the page and connection remain usable', async () => {
        voices = [];
        await render();
        await send(frame('empty-voices'));
        expect(events.at(-1)?.id).toBe('new-order-notification');
        expect(openStream).toHaveBeenCalledTimes(1);
        await act(async () => vi.advanceTimersByTimeAsync(1499));
        expect(audioPlay).not.toHaveBeenCalled();
        await act(async () => vi.advanceTimersByTimeAsync(1));
        expect(audioPlay).toHaveBeenCalledTimes(1);
        expect(audioInstances[0].src).toMatch(/\/audio\/new-order-zh\.mp3$/);
        expect(play).not.toHaveBeenCalled();
    });
    it('cancels delayed voice resolution on scope change without playback or receipt', async () => {
        voices = [];
        await render();
        await send(frame('cancelled-voice-list'));
        await render('2');
        voices = [{ lang: 'zh-CN', default: true }] as SpeechSynthesisVoice[];
        await act(async () => {
            voiceEvents.dispatchEvent(new Event('voiceschanged'));
            await vi.advanceTimersByTimeAsync(10000);
        });
        expect(play).not.toHaveBeenCalled();
        expect(audioPlay).not.toHaveBeenCalled();
        expect(
            localStorage.getItem(`next-admin:order-announced:${administratorId}:cancelled-voice-list`),
        ).toBeNull();
    });
    it('ignores late recording promises and callbacks after switching channel', async () => {
        vi.stubGlobal('speechSynthesis', undefined);
        let finishPlayback!: () => void;
        audioPlay.mockImplementation(
            () =>
                new Promise<void>(resolve => {
                    finishPlayback = resolve;
                }),
        );
        await render();
        await send(frame('late-recording'));
        const late = audioInstances[0].onplaying!;
        await render('2');
        const pauses = audioPause.mock.calls.length;
        await act(async () => {
            finishPlayback();
            late();
        });
        expect(audioPause).toHaveBeenCalled();
        expect(audioPause).toHaveBeenCalledTimes(pauses);
        expect(
            localStorage.getItem(`next-admin:order-announced:${administratorId}:late-recording`),
        ).toBeNull();
        expect(container.querySelector('button')?.getAttribute('aria-pressed')).toBe('false');
    });
    it('deduplicates named events by administrator, sales store and order across platform/store streams', async () => {
        const named = (storeId: string, eventId: string) =>
            frame('shared-order', eventId).replace(
                '"occurredAt":',
                `"store":{"id":"${storeId}","nameZh":"当前销售店","nameEn":"Selling Store"},"occurredAt":`,
            );
        await render();
        await send(named('sales-store-a', 'platform:1'));
        await render('2');
        await send(named('sales-store-a', 'store:1'));
        expect(play).toHaveBeenCalledTimes(1);
        expect(
            localStorage.getItem(`next-admin:order-announced:${administratorId}:sales-store-a:shared-order`),
        ).toBe('spoken');
        await render('3');
        await send(named('sales-store-b', 'other-store:1'));
        expect(play).toHaveBeenCalledTimes(2);
    });
    it('speaks the event owner name on a platform page and uses fresh localized text', async () => {
        await render();
        const named = (id: string) =>
            frame(id).replace(
                '"occurredAt":',
                '"store":{"id":"store-a","nameZh":"真实网店","nameEn":"Real Store"},"occurredAt":',
            );
        await send(named('named-zh'));
        expect(play.mock.calls[0][0].text).toBe('真实网店有新的订单，请您查看。');
        await act(async () => {
            document.documentElement.lang = 'en';
        });
        await send(named('named-en'));
        expect(play.mock.calls[1][0].text).toBe('Real Store has a new order. Please check it.');
        expect(events.at(-1)?.title).toBe(play.mock.calls[1][0].text);
    });
    it('deduplicates the same order after switching from platform to store', async () => {
        await render();
        await send(frame('one-order'));
        await render('2');
        await send(frame('one-order', 'other-server:1'));
        expect(play).toHaveBeenCalledTimes(1);
        expect(events.filter(event => event.id === 'new-order-notification')).toHaveLength(2);
    });
    it('never confirms or resumes late playback after the previous channel unmounts', async () => {
        play.mockImplementation(() => {});
        await render();
        await send(frame('late-voice'));
        const utterance = play.mock.calls[0][0];
        await render('2');
        const cancellations = cancelSpeech.mock.calls.length;
        await act(async () => {
            utterance.onstart();
        });
        expect(localStorage.getItem(`next-admin:order-announced:${administratorId}:late-voice`)).toBeNull();
        expect(container.querySelector('button')?.getAttribute('aria-pressed')).toBe('false');
        expect(cancelSpeech).toHaveBeenCalled();
        expect(cancelSpeech).toHaveBeenCalledTimes(cancellations);
    });
    it('synchronizes mute from another tab and stops pending speech immediately', async () => {
        play.mockImplementation(() => {});
        await render();
        await send(frame('pending-voice'));
        const utterance = play.mock.calls[0][0];
        await act(async () => {
            window.dispatchEvent(
                new StorageEvent('storage', {
                    key: `next-admin:order-voice:${administratorId}`,
                    newValue: 'muted',
                }),
            );
            utterance.onstart();
        });
        expect(cancelSpeech).toHaveBeenCalled();
        expect(container.querySelector('button')?.getAttribute('aria-pressed')).toBe('false');
        expect(
            localStorage.getItem(`next-admin:order-announced:${administratorId}:pending-voice`),
        ).toBeNull();
    });
    it('honors 429 Retry-After instead of reconnecting every second', async () => {
        openStream.mockResolvedValueOnce(
            new Response(null, { status: 429, headers: { 'retry-after': '90' } }),
        );
        await render();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(89999);
        });
        expect(openStream).toHaveBeenCalledTimes(1);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1);
        });
        expect(openStream).toHaveBeenCalledTimes(2);
    });
    it('backs off rate limiting from thirty seconds to a maximum of five minutes', async () => {
        openStream.mockResolvedValue(new Response(null, { status: 429 }));
        await render();
        for (const delay of [30000, 60000, 120000, 240000, 300000, 300000]) {
            const count = openStream.mock.calls.length;
            await act(async () => {
                await vi.advanceTimersByTimeAsync(delay - 1);
            });
            expect(openStream).toHaveBeenCalledTimes(count);
            await act(async () => {
                await vi.advanceTimersByTimeAsync(1);
            });
            expect(openStream).toHaveBeenCalledTimes(count + 1);
        }
    });
});
