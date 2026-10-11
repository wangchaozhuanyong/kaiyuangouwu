import { openAdminOrderEvents } from '../apollo';
import { readAdminOrderStream, type AdminOrderNotification } from './admin-order-stream';

type StreamMessage =
    | { type: 'ready'; cursor: string; recovered: boolean }
    | { type: 'order'; event: AdminOrderNotification }
    | { type: 'status'; value: 'disconnected' | 'unauthorized' }
    | { type: 'hello' };

export interface OrderEventHandlers {
    ready: (recovered: boolean) => void;
    order: (event: AdminOrderNotification) => void;
    status: (value: 'disconnected' | 'unauthorized') => void;
}

interface Session {
    controller: AbortController;
    listeners: Set<OrderEventHandlers>;
    channel?: BroadcastChannel;
    cursor?: string;
    status?: 'disconnected' | 'unauthorized';
    seen: Set<string>;
    leader: boolean;
}

// Only transport ownership and notification receipts are shared here, never order data/cache.
const sessions = new Map<string, Session>();

const isUnauthorized = (session: Session) => session.status === 'unauthorized';

function pause(signal: AbortSignal, delay: number) {
    return new Promise<void>(resolve => {
        if (signal.aborted) return resolve();
        const finish = () => {
            window.clearTimeout(timer);
            signal.removeEventListener('abort', finish);
            resolve();
        };
        const timer = window.setTimeout(finish, delay);
        signal.addEventListener('abort', finish, { once: true });
    });
}

function retryAfter(response: Response): number | undefined {
    const value = response.headers.get('retry-after')?.trim();
    if (!value) return;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
}

function deliver(session: Session, message: StreamMessage, relay = false) {
    if (session.controller.signal.aborted) return;
    if (message.type === 'hello') {
        if (session.leader && session.status)
            session.channel?.postMessage({ type: 'status', value: session.status } satisfies StreamMessage);
        else if (session.leader && session.cursor)
            session.channel?.postMessage({
                type: 'ready',
                cursor: session.cursor,
                recovered: false,
            } satisfies StreamMessage);
        return;
    }
    if (message.type === 'order') {
        session.cursor = message.event.id;
        const key =
            message.event.kind === 'order-pending'
                ? `reminder:${message.event.id}`
                : `placed:${message.event.orderId}`;
        if (session.seen.has(key)) return;
        session.seen.add(key);
        if (session.seen.size > 2000) session.seen.delete(session.seen.values().next().value!);
        for (const listener of session.listeners) listener.order(message.event);
    } else if (message.type === 'ready') {
        session.cursor = message.cursor;
        session.status = undefined;
        for (const listener of session.listeners) listener.ready(message.recovered);
    } else {
        if (session.status === message.value) return;
        session.status = message.value;
        for (const listener of session.listeners) listener.status(message.value);
    }
    if (relay) session.channel?.postMessage(message);
}

async function connect(session: Session, channelToken: string) {
    const { signal } = session.controller;
    let delay = 1000;
    let rateLimitDelay = 30000;
    while (!signal.aborted && !isUnauthorized(session)) {
        let nextDelay = delay;
        try {
            const response = await openAdminOrderEvents(channelToken, signal, session.cursor);
            if (signal.aborted) {
                await response.body?.cancel();
                return;
            }
            if (response.status === 401 || response.status === 403) {
                await response.body?.cancel();
                deliver(session, { type: 'status', value: 'unauthorized' }, true);
                return;
            }
            if (response.status === 429) {
                // Respect the server's minimum. Without one, back off from 30 seconds to five minutes.
                nextDelay = Math.max(30000, retryAfter(response) ?? rateLimitDelay);
                rateLimitDelay = Math.min(rateLimitDelay * 2, 300000);
                await response.body?.cancel();
            } else {
                await readAdminOrderStream(response, signal, {
                    ready: cursor => {
                        delay = 1000;
                        nextDelay = 1000;
                        rateLimitDelay = 30000;
                        deliver(
                            session,
                            { type: 'ready', cursor, recovered: session.status === 'disconnected' },
                            true,
                        );
                    },
                    order: event => deliver(session, { type: 'order', event }, true),
                });
            }
        } catch {
            // Dropped reads reconnect; cancellation never starts a replacement request.
        }
        if (signal.aborted || isUnauthorized(session)) return;
        deliver(session, { type: 'status', value: 'disconnected' }, true);
        await pause(signal, nextDelay);
        delay = Math.min(delay * 2, 30000);
    }
}

/** One SSE per administrator/channel across tabs when both browser coordination APIs exist. */
export function subscribeAdminOrderEvents(
    scope: { administratorId: string; channelId: string; channelToken: string },
    handlers: OrderEventHandlers,
) {
    const key = `${scope.administratorId}:${scope.channelId}`;
    let session = sessions.get(key);
    if (!session) {
        session = {
            controller: new AbortController(),
            listeners: new Set(),
            seen: new Set(),
            leader: false,
        };
        sessions.set(key, session);
        const current = session;
        if (navigator.locks && typeof BroadcastChannel !== 'undefined') {
            current.channel = new BroadcastChannel(`next-admin:order-events:${key}`);
            current.channel.onmessage = event => {
                const message = event.data as StreamMessage;
                if (message && ['hello', 'ready', 'order', 'status'].includes(message.type))
                    deliver(current, message);
            };
        }
        // Register the first listener before an immediately resolved read/lock can deliver an event.
        current.listeners.add(handlers);
        const lead = async () => {
            if (current.controller.signal.aborted || isUnauthorized(current)) return;
            current.leader = true;
            await connect(current, scope.channelToken);
            // Keep the stopped owner until its scope closes, so followers cannot race the
            // unauthorized broadcast by acquiring the lock and immediately trying again.
            if (isUnauthorized(current) && !current.controller.signal.aborted)
                await new Promise<void>(resolve =>
                    current.controller.signal.addEventListener('abort', () => resolve(), { once: true }),
                );
            current.leader = false;
        };
        if (current.channel) {
            void navigator.locks
                .request(`next-admin:order-stream:${key}`, { signal: current.controller.signal }, lead)
                .catch(() => {});
            current.channel.postMessage({ type: 'hello' } satisfies StreamMessage);
        } else {
            void lead();
        }
    } else {
        session.listeners.add(handlers);
        if (session.status) handlers.status(session.status);
    }
    const current = session;
    return () => {
        current.listeners.delete(handlers);
        if (current.listeners.size > 0) return;
        current.controller.abort();
        current.channel?.close();
        if (sessions.get(key) === current) sessions.delete(key);
    };
}
