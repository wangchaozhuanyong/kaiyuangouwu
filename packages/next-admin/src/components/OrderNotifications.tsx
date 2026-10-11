import { Volume2, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AdminButton } from './AdminControls';

import { invalidateAdminResources } from '../runtime/admin-resource-events';
import { publishAdminFeedback } from '../utils/admin-feedback';
import { subscribeAdminOrderEvents } from '../utils/admin-order-events';
import type { AdminOrderNotification } from '../utils/admin-order-stream';
import {
    announceOrderOnce,
    readOrderVoiceMuted,
    setOrderVoiceMuted,
    subscribeOrderVoicePreference,
    waitForOrderAnnouncementVoices,
} from '../utils/admin-order-voice';
import {
    ORDER_NOTIFICATION_COPY,
    orderAnnouncementText,
    orderNotificationLanguage,
} from '../utils/order-notifications';

function subscribePageLanguage(onChange: () => void) {
    const observer = new MutationObserver(onChange);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    return () => observer.disconnect();
}

const getPageLanguage = () => orderNotificationLanguage(document.documentElement.lang);

/** Mounted once in the authenticated shell, keyed by administrator and channel. */
export function OrderNotifications({
    administratorId,
    channelId,
    channelToken,
    store,
}: {
    administratorId: string;
    channelId: string;
    channelToken: string;
    store?: AdminOrderNotification['store'];
}) {
    const language = useSyncExternalStore(subscribePageLanguage, getPageLanguage, () => 'zh' as const);
    const copy = ORDER_NOTIFICATION_COPY[language];
    const [muted, setMuted] = useState(() => readOrderVoiceMuted(administratorId));
    const mutedRef = useRef(muted);
    const [audioReady, setAudioReady] = useState(false);
    const [disconnected, setDisconnected] = useState(false);
    const playbackVersion = useRef(0);
    const pendingPlayback = useRef(new Set<() => void>());
    const currentStore = useRef(store);
    useLayoutEffect(() => {
        currentStore.current = store?.id === channelId ? store : undefined;
    }, [store, channelId]);

    const stopPlayback = useCallback(() => {
        playbackVersion.current += 1;
        for (const cancel of [...pendingPlayback.current]) cancel();
        window.speechSynthesis?.cancel();
    }, []);
    useEffect(() => () => stopPlayback(), [stopPlayback]);
    useEffect(
        () =>
            subscribeOrderVoicePreference(administratorId, next => {
                mutedRef.current = next;
                setMuted(next);
                if (next) stopPlayback();
            }),
        [administratorId, stopPlayback],
    );

    const playAnnouncement = useCallback(
        (
            text: string,
            kind: 'order-placed' | 'order-pending' = 'order-placed',
            signal?: AbortSignal,
            started?: () => void,
        ): Promise<void> => {
            if (mutedRef.current || signal?.aborted) return Promise.resolve();
            const version = playbackVersion.current;
            const currentLanguage = getPageLanguage();
            const currentCopy = ORDER_NOTIFICATION_COPY[currentLanguage];
            const fail = (blocked: boolean) => {
                setAudioReady(false);
                publishAdminFeedback({
                    id: 'order-voice-playback',
                    kind: 'info',
                    title: blocked ? currentCopy.blocked : currentCopy.failed,
                    durationMs: 12000,
                });
            };
            return new Promise<void>(resolve => {
                const controller = new AbortController();
                let audio: HTMLAudioElement | undefined;
                let utterance: SpeechSynthesisUtterance | undefined;
                let began = false;
                let recording = false;
                let settled = false;
                const settle = () => {
                    if (settled) return;
                    settled = true;
                    window.clearTimeout(timer);
                    resolve();
                };
                const cleanup = () => {
                    controller.abort();
                    pendingPlayback.current.delete(cancel);
                    signal?.removeEventListener('abort', cancel);
                    settle();
                };
                const cancel = () => {
                    cleanup();
                    window.speechSynthesis?.cancel();
                    audio?.pause();
                    audio?.removeAttribute('src');
                };
                const current = () =>
                    !controller.signal.aborted &&
                    version === playbackVersion.current &&
                    !mutedRef.current &&
                    !signal?.aborted;
                const timer = window.setTimeout(() => {
                    if (current()) fail(true);
                    cancel();
                }, 10000);
                pendingPlayback.current.add(cancel);
                signal?.addEventListener('abort', cancel, { once: true });
                const begin = () => {
                    if (!current()) return;
                    if (began) return;
                    began = true;
                    setAudioReady(true);
                    started?.();
                    settle();
                };
                const playbackFailed = (blocked: boolean) => {
                    if (!current()) return;
                    fail(blocked);
                    cancel();
                };
                const playRecording = () => {
                    if (!current() || recording || began) return;
                    recording = true;
                    if (utterance) {
                        utterance.onstart = null;
                        utterance.onend = null;
                        utterance.onerror = null;
                    }
                    try {
                        audio = new Audio(
                            `${import.meta.env.BASE_URL}audio/${kind === 'order-pending' ? 'pending-order' : 'new-order'}-${currentLanguage}.mp3`,
                        );
                        audio.preload = 'auto';
                        audio.onplaying = begin;
                        audio.onended = cleanup;
                        audio.onerror = () => playbackFailed(false);
                        // play() resolves only once playback has started. Both paths share
                        // the guard so a late promise/event cannot confirm cancelled sound.
                        void audio
                            .play()
                            .then(begin, error =>
                                playbackFailed(
                                    error instanceof DOMException && error.name === 'NotAllowedError',
                                ),
                            );
                    } catch (error) {
                        playbackFailed(error instanceof DOMException && error.name === 'NotAllowedError');
                    }
                };
                const synthesis = window.speechSynthesis;
                if (!synthesis || typeof SpeechSynthesisUtterance === 'undefined') {
                    playRecording();
                    return;
                }
                const speak = (voices: SpeechSynthesisVoice[] = []) => {
                    if (!current()) return;
                    utterance = new SpeechSynthesisUtterance(text);
                    utterance.lang = currentLanguage === 'en' ? 'en-US' : 'zh-CN';
                    const matching = voices.filter(voice =>
                        voice.lang.toLowerCase().startsWith(currentLanguage),
                    );
                    utterance.voice = matching.find(voice => voice.default) ?? matching[0] ?? null;
                    utterance.onstart = begin;
                    utterance.onend = cleanup;
                    utterance.onerror = event => {
                        if (!current()) return;
                        if (
                            !began &&
                            [
                                'synthesis-unavailable',
                                'voice-unavailable',
                                'language-unavailable',
                                'synthesis-failed',
                            ].includes(event.error)
                        )
                            playRecording();
                        else playbackFailed(event.error === 'not-allowed');
                    };
                    try {
                        synthesis.speak(utterance);
                    } catch (error) {
                        if (error instanceof DOMException && error.name === 'NotAllowedError')
                            playbackFailed(true);
                        else playRecording();
                    }
                };
                if (typeof synthesis.getVoices !== 'function') speak();
                else
                    void waitForOrderAnnouncementVoices(synthesis, controller.signal)
                        .then(voices => {
                            if (!current()) return;
                            if (voices.length) speak(voices);
                            else playRecording();
                        })
                        .catch(() => playRecording());
            });
        },
        [],
    );

    useEffect(() => {
        const controller = new AbortController();
        const remove = subscribeAdminOrderEvents(
            { administratorId, channelId, channelToken },
            {
                ready: recovered => {
                    setDisconnected(false);
                    if (!recovered) return;
                    invalidateAdminResources(['orders', 'catalog'], 'event');
                    publishAdminFeedback({
                        id: 'order-notifications-connection',
                        kind: 'info',
                        title: ORDER_NOTIFICATION_COPY[getPageLanguage()].recovered,
                    });
                },
                status: value => {
                    setDisconnected(true);
                    if (value === 'unauthorized') {
                        controller.abort();
                        stopPlayback();
                    }
                    publishAdminFeedback({
                        id: 'order-notifications-connection',
                        kind: 'info',
                        title: ORDER_NOTIFICATION_COPY[getPageLanguage()][value],
                    });
                },
                order: event => {
                    if (controller.signal.aborted) return;
                    const isReminder = event.kind === 'order-pending';
                    if (!isReminder) invalidateAdminResources(['orders', 'catalog'], 'event');
                    const text = orderAnnouncementText(
                        getPageLanguage(),
                        event.kind,
                        event.store ?? currentStore.current,
                    );
                    publishAdminFeedback({
                        id: isReminder ? 'pending-order-notification' : 'new-order-notification',
                        kind: 'info',
                        title: text,
                        durationMs: 12000,
                    });
                    void announceOrderOnce(
                        administratorId,
                        event.orderId,
                        controller.signal,
                        started =>
                            playAnnouncement(
                                orderAnnouncementText(
                                    getPageLanguage(),
                                    event.kind,
                                    event.store ?? currentStore.current,
                                ),
                                event.kind,
                                controller.signal,
                                started,
                            ),
                        event.store?.id,
                    );
                },
            },
        );
        return () => {
            controller.abort();
            remove();
            stopPlayback();
        };
    }, [administratorId, channelId, channelToken, playAnnouncement, stopPlayback]);

    const toggleSound = () => {
        const nextMuted = !muted && audioReady;
        setOrderVoiceMuted(administratorId, nextMuted);
        if (nextMuted) publishAdminFeedback({ kind: 'info', title: copy.muted });
        else
            void playAnnouncement(
                orderAnnouncementText(getPageLanguage(), 'order-placed', currentStore.current),
            );
    };

    const label = !muted && audioReady ? copy.mute : copy.enable;
    const Icon = muted || !audioReady ? VolumeX : Volume2;
    return (
        <AdminButton
            type="button"
            onClick={toggleSound}
            aria-label={label}
            aria-pressed={!muted && audioReady}
            title={disconnected ? copy.disconnected + ' · ' + label : label}
            className={[
                'relative shrink-0 cursor-pointer rounded-lg p-2 transition-colors hover:bg-slate-100',
                muted || !audioReady ? 'text-slate-500' : 'text-blue-600',
            ].join(' ')}
        >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {disconnected && (
                <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-500" />
            )}
        </AdminButton>
    );
}
