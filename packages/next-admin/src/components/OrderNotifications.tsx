import { Volume2, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { openAdminOrderEvents } from '../apollo';
import { publishAdminFeedback } from '../utils/admin-feedback';
import { readAdminOrderStream } from '../utils/admin-order-stream';
import { ORDER_NOTIFICATION_COPY, orderNotificationLanguage } from '../utils/order-notifications';

function subscribePageLanguage(onChange: () => void) {
    const observer = new MutationObserver(onChange);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    return () => observer.disconnect();
}

const getPageLanguage = () => orderNotificationLanguage(document.documentElement.lang);

function readMuted(key: string) {
    try {
        return localStorage.getItem(key) === 'muted';
    } catch {
        return false;
    }
}

/** Mounted once in the authenticated shell, keyed by administrator and channel. */
export function OrderNotifications({
    administratorId,
    channelId,
    channelToken,
}: {
    administratorId: string;
    channelId: string;
    channelToken: string;
}) {
    const language = useSyncExternalStore(subscribePageLanguage, getPageLanguage, () => 'zh' as const);
    const copy = ORDER_NOTIFICATION_COPY[language];
    const preferenceKey = `next-admin:order-voice:${administratorId}`;
    const [muted, setMuted] = useState(() => readMuted(preferenceKey));
    const mutedRef = useRef(muted);
    const [audioReady, setAudioReady] = useState(false);
    const [disconnected, setDisconnected] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const playbackVersion = useRef(0);

    useEffect(() => {
        const audio = new Audio();
        audio.preload = 'auto';
        audioRef.current = audio;
        return () => {
            playbackVersion.current += 1;
            audio.pause();
            audio.removeAttribute('src');
            audioRef.current = null;
        };
    }, []);

    const playAnnouncement = useCallback(async (kind: 'order-placed' | 'order-pending' = 'order-placed') => {
        const audio = audioRef.current;
        if (!audio || mutedRef.current) return;
        const currentLanguage = getPageLanguage();
        const currentCopy = ORDER_NOTIFICATION_COPY[currentLanguage];
        const source = `${import.meta.env.BASE_URL}audio/${kind === 'order-pending' ? 'pending-order' : 'new-order'}-${currentLanguage}.mp3`;
        // Simultaneous overdue orders share the announcement already playing instead of restarting it.
        if (kind === 'order-pending' && !audio.paused && audio.getAttribute('src') === source) return;
        const version = ++playbackVersion.current;
        try {
            audio.pause();
            if (audio.getAttribute('src') !== source) audio.src = source;
            audio.currentTime = 0;
            await audio.play();
            if (version === playbackVersion.current) setAudioReady(true);
        } catch (error) {
            if (version !== playbackVersion.current) return;
            setAudioReady(false);
            publishAdminFeedback({
                id: 'order-voice-playback',
                kind: 'info',
                title:
                    error instanceof DOMException && error.name === 'NotAllowedError'
                        ? currentCopy.blocked
                        : currentCopy.failed,
                durationMs: 12000,
            });
        }
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        let lastEventId: string | undefined;
        let connectionFailed = false;
        const seenNotifications = new Set<string>();
        const connect = async () => {
            let retryDelay = 1000;
            while (!controller.signal.aborted) {
                try {
                    const response = await openAdminOrderEvents(channelToken, controller.signal, lastEventId);
                    if (controller.signal.aborted) {
                        await response.body?.cancel();
                        return;
                    }
                    if (response.status === 401 || response.status === 403) {
                        setDisconnected(true);
                        publishAdminFeedback({
                            id: 'order-notifications-connection',
                            kind: 'info',
                            title: ORDER_NOTIFICATION_COPY[getPageLanguage()].unauthorized,
                        });
                        return;
                    }
                    await readAdminOrderStream(response, controller.signal, {
                        ready: cursor => {
                            lastEventId = cursor;
                            retryDelay = 1000;
                            if (connectionFailed) {
                                connectionFailed = false;
                                setDisconnected(false);
                                publishAdminFeedback({
                                    id: 'order-notifications-connection',
                                    kind: 'info',
                                    title: ORDER_NOTIFICATION_COPY[getPageLanguage()].recovered,
                                });
                            }
                        },
                        order: event => {
                            lastEventId = event.id;
                            const isReminder = event.kind === 'order-pending';
                            const key = isReminder ? `reminder:${event.id}` : `placed:${event.orderId}`;
                            if (seenNotifications.has(key)) return;
                            seenNotifications.add(key);
                            if (seenNotifications.size > 2000)
                                seenNotifications.delete(seenNotifications.values().next().value!);
                            const currentCopy = ORDER_NOTIFICATION_COPY[getPageLanguage()];
                            publishAdminFeedback({
                                id: isReminder ? 'pending-order-notification' : 'new-order-notification',
                                kind: 'info',
                                title: isReminder ? currentCopy.pending : currentCopy.message,
                                durationMs: 12000,
                            });
                            void playAnnouncement(event.kind);
                        },
                    });
                } catch {
                    // A dropped stream reconnects below; a healthy stream never starts another request.
                }
                if (controller.signal.aborted) return;
                if (!connectionFailed) {
                    connectionFailed = true;
                    setDisconnected(true);
                    publishAdminFeedback({
                        id: 'order-notifications-connection',
                        kind: 'info',
                        title: ORDER_NOTIFICATION_COPY[getPageLanguage()].disconnected,
                    });
                }
                await new Promise<void>(resolve => {
                    const finish = () => {
                        window.clearTimeout(timer);
                        controller.signal.removeEventListener('abort', finish);
                        resolve();
                    };
                    const timer = window.setTimeout(finish, retryDelay);
                    controller.signal.addEventListener('abort', finish, { once: true });
                });
                retryDelay = Math.min(retryDelay * 2, 30000);
            }
        };
        void connect();
        return () => controller.abort();
    }, [channelId, channelToken, playAnnouncement]);

    const toggleSound = () => {
        const nextMuted = !muted && audioReady;
        mutedRef.current = nextMuted;
        setMuted(nextMuted);
        try {
            localStorage.setItem(preferenceKey, nextMuted ? 'muted' : 'enabled');
        } catch {
            // Sound remains usable when browser storage is unavailable.
        }
        if (nextMuted) {
            playbackVersion.current += 1;
            audioRef.current?.pause();
            publishAdminFeedback({ kind: 'info', title: copy.muted });
        } else {
            void playAnnouncement();
        }
    };

    const label = !muted && audioReady ? copy.mute : copy.enable;
    const Icon = muted || !audioReady ? VolumeX : Volume2;
    return (
        <button
            type="button"
            onClick={toggleSound}
            aria-label={label}
            aria-pressed={!muted && audioReady}
            title={disconnected ? `${copy.disconnected} · ${label}` : label}
            className={`relative shrink-0 cursor-pointer rounded-lg p-2 transition-colors hover:bg-slate-100 ${muted || !audioReady ? 'text-slate-500' : 'text-blue-600'}`}
        >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {disconnected && (
                <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-500" />
            )}
        </button>
    );
}
