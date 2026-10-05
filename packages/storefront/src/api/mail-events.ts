import { consumeRealtimeFrames, parseStorefrontRealtimeFrameFields } from '../realtime-updates';

import {
    abortableDelay,
    calculateStorefrontRealtimeRetry,
    cancelStorefrontRealtimeBody,
    createRequestSignal,
    STOREFRONT_REALTIME_INITIAL_RETRY_DELAY_MS,
    StorefrontRealtimeConnectionError,
    storefrontRealtimeUrl,
} from './helpers';

export type MailStreamStatus = 'connecting' | 'live' | 'reconnecting' | 'paused' | 'unavailable' | 'denied';
export interface MailStreamCallbacks {
    onChange: () => void | Promise<void>;
    onStatus: (status: MailStreamStatus) => void;
}

class MailStreamStopped extends Error {
    constructor(readonly status: 'unavailable' | 'denied') {
        super(status);
    }
}

/** Mailbox capability stays in the POST body, never in URLs or shared caches. */
export async function watchMailEvents(
    queryCode: string,
    headers: Record<string, string>,
    callbacks: MailStreamCallbacks,
    signal: AbortSignal,
): Promise<void> {
    const url = new URL(storefrontRealtimeUrl());
    url.pathname = url.pathname.replace(/\/events$/u, '/mail-events');
    url.search = '';
    let cursor = '0';
    let connectedOnce = false;
    let retryDelayMs = STOREFRONT_REALTIME_INITIAL_RETRY_DELAY_MS;
    const seen = new Set<string>();
    const advanceCursor = (value: unknown) => {
        if (typeof value !== 'string' || !/^\d{1,20}$/u.test(value)) return;
        if (BigInt(value) > BigInt(cursor)) cursor = value;
    };
    while (!signal.aborted) {
        const connection = new AbortController();
        const abort = () => connection.abort(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        let notificationFailure: unknown;
        const notify = () => {
            void Promise.resolve(callbacks.onChange()).catch(error => {
                if (connection.signal.aborted) return;
                notificationFailure = error;
                connection.abort();
            });
        };
        callbacks.onStatus(connectedOnce ? 'reconnecting' : 'connecting');
        try {
            const request = createRequestSignal(connection.signal, 10_000);
            let response: Response;
            try {
                response = await fetch(url.toString(), {
                    method: 'POST',
                    credentials: 'include',
                    cache: 'no-store',
                    headers: { ...headers, accept: 'text/event-stream', 'content-type': 'application/json' },
                    body: JSON.stringify({ queryCode, cursor }),
                    signal: request.signal,
                });
            } finally {
                request.cleanup();
            }
            if (!response.ok) {
                await cancelStorefrontRealtimeBody(response.body, undefined);
                if ([400, 401, 403].includes(response.status)) throw new MailStreamStopped('denied');
                if ([404, 405, 409].includes(response.status)) throw new MailStreamStopped('unavailable');
                throw new StorefrontRealtimeConnectionError(
                    response.status,
                    response.headers.get('retry-after'),
                );
            }
            if (!response.headers.get('content-type')?.startsWith('text/event-stream')) {
                await cancelStorefrontRealtimeBody(response.body, undefined);
                throw new MailStreamStopped('unavailable');
            }
            if (!response.body) throw new Error('Missing mail stream');
            await consumeRealtimeFrames(
                response.body,
                frame => {
                    const { eventName, data } = parseStorefrontRealtimeFrameFields(frame);
                    if (!data.length) return {};
                    const payload = JSON.parse(data.join('\n')) as Record<string, unknown>;
                    if (eventName === 'access-denied') throw new MailStreamStopped('denied');
                    if (eventName === 'unavailable') throw new MailStreamStopped('unavailable');
                    if (eventName === 'ready') {
                        if (payload.version !== 1 || payload.heartbeatIntervalMs !== 15_000)
                            throw new Error('Invalid mail stream');
                        advanceCursor(payload.cursor);
                        connectedOnce = true;
                        callbacks.onStatus('live');
                        // One read on connection/reconnection closes snapshot/notification races.
                        notify();
                        return { heartbeatIntervalMs: 15_000, activity: true };
                    }
                    if (eventName === 'reconcile') {
                        notify();
                        return { activity: true };
                    }
                    if (eventName === 'mail') {
                        if (typeof payload.eventId !== 'string' || payload.eventId.length > 128)
                            throw new Error('Invalid mail event');
                        advanceCursor(payload.cursor);
                        if (!seen.has(payload.eventId)) {
                            seen.add(payload.eventId);
                            const oldest = seen.values().next().value;
                            if (seen.size > 1000 && oldest !== undefined) seen.delete(oldest);
                            notify();
                        }
                        return { activity: true };
                    }
                    return {};
                },
                {
                    signal: connection.signal,
                    onReady: () => {
                        retryDelayMs = STOREFRONT_REALTIME_INITIAL_RETRY_DELAY_MS;
                    },
                },
            );
            if (notificationFailure)
                throw notificationFailure instanceof Error
                    ? notificationFailure
                    : new Error('Mail result read failed');
            if (!signal.aborted) throw new Error('Mail stream closed');
        } catch (error) {
            if (signal.aborted) return;
            if (error instanceof MailStreamStopped) {
                callbacks.onStatus(error.status);
                return;
            }
            callbacks.onStatus('reconnecting');
            const retry = calculateStorefrontRealtimeRetry({
                status: error instanceof StorefrontRealtimeConnectionError ? error.status : undefined,
                retryAfter: error instanceof StorefrontRealtimeConnectionError ? error.retryAfter : undefined,
                baseDelayMs: retryDelayMs,
            });
            await abortableDelay(retry.delayMs, signal);
            retryDelayMs = retry.nextBaseDelayMs;
        } finally {
            signal.removeEventListener('abort', abort);
            connection.abort();
        }
    }
}
