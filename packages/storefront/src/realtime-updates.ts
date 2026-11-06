import type { QueryClient, QueryKey } from '@tanstack/react-query';

import { invalidatePublicPageReads } from './public-page-transport';

export const storefrontRealtimeTopics = [
    'catalog',
    'content',
    'config',
    'cart',
    'customer',
    'orders',
    'coupons',
    'reviews',
    'referral',
] as const;

export type StorefrontRealtimeTopic = (typeof storefrontRealtimeTopics)[number];

export interface StorefrontRealtimeEvent {
    version: 1;
    id: string;
    occurredAt: string;
    topics: StorefrontRealtimeTopic[];
    entityType?: string;
    entityIds?: string[];
}

export interface StorefrontRealtimeScope {
    marketCode: string;
    languageCode: string;
    customerId?: string;
}

const MAX_PENDING_EVENT_BYTES = 256 * 1024;
const REALTIME_READY_TIMEOUT_MS = 10_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_HEARTBEAT_INTERVAL_MS = 300_000;

export interface StorefrontRealtimeStreamOptions {
    signal?: AbortSignal;
    onReady?: () => void;
}

export async function consumeStorefrontRealtimeStream(
    body: ReadableStream<Uint8Array>,
    onEvent: (event: StorefrontRealtimeEvent) => void,
    options: StorefrontRealtimeStreamOptions = {},
): Promise<void> {
    await consumeRealtimeFrames(
        body,
        frame => {
            const heartbeatIntervalMs = storefrontRealtimeReadyHeartbeatInterval(frame);
            const parsed = parseStorefrontRealtimeFrame(frame);
            if (parsed) onEvent(parsed);
            return { heartbeatIntervalMs: heartbeatIntervalMs ?? undefined, activity: Boolean(parsed) };
        },
        options,
    );
}

/** Shared SSE framing, cancellation and heartbeat watchdog. It never fetches business data. */
export async function consumeRealtimeFrames(
    body: ReadableStream<Uint8Array>,
    onFrame: (frame: string) => { heartbeatIntervalMs?: number; activity?: boolean },
    options: StorefrontRealtimeStreamOptions = {},
): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let completedNaturally = false;
    let failure: unknown;
    let ready = false;
    let heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let timeoutFailure: Error | undefined;
    let cancellation: Promise<void> | undefined;
    const cancelReader = (reason?: unknown) => {
        if (cancellation) return cancellation;
        try {
            cancellation = reader.cancel(reason).catch(() => undefined);
        } catch {
            cancellation = Promise.resolve();
        }
        return cancellation;
    };
    const abort = () => {
        void cancelReader(options.signal?.reason);
    };
    const scheduleWatchdog = (timeoutMs: number) => {
        if (watchdog !== undefined) clearTimeout(watchdog);
        watchdog = setTimeout(() => {
            timeoutFailure = new Error(
                ready ? 'Storefront realtime heartbeat timed out' : 'Storefront realtime ready timed out',
            );
            void cancelReader(timeoutFailure);
        }, timeoutMs);
    };

    if (options.signal?.aborted) {
        await cancelReader(options.signal.reason);
        reader.releaseLock();
        return;
    }
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
        scheduleWatchdog(REALTIME_READY_TIMEOUT_MS);
        while (true) {
            const { done, value } = await reader.read();
            if (timeoutFailure) throw timeoutFailure;
            pending += decoder.decode(value, { stream: !done });
            if (pending.length > MAX_PENDING_EVENT_BYTES) {
                throw new Error('Storefront realtime event exceeded the maximum size');
            }
            const frames = pending.split(/\r?\n\r?\n/u);
            pending = done ? '' : (frames.pop() ?? '');
            for (const frame of frames) {
                const parsed = onFrame(frame);
                if (!ready && parsed.heartbeatIntervalMs !== undefined) {
                    ready = true;
                    heartbeatIntervalMs = parsed.heartbeatIntervalMs;
                    scheduleWatchdog(Math.max(1_000, heartbeatIntervalMs * 3));
                    options.onReady?.();
                }
                if (ready && (parsed.activity || frame.split(/\r?\n/u).some(line => line.startsWith(':')))) {
                    scheduleWatchdog(Math.max(1_000, heartbeatIntervalMs * 3));
                }
            }
            if (done) {
                completedNaturally = !options.signal?.aborted;
                return;
            }
        }
    } catch (error) {
        failure = error;
        throw error;
    } finally {
        if (watchdog !== undefined) clearTimeout(watchdog);
        options.signal?.removeEventListener('abort', abort);
        if (!completedNaturally) await cancelReader(failure ?? options.signal?.reason);
        reader.releaseLock();
    }
}

export function parseStorefrontRealtimeFrame(frame: string): StorefrontRealtimeEvent | null {
    const { eventName, data } = parseStorefrontRealtimeFrameFields(frame);
    if (eventName !== 'invalidate' || data.length === 0) return null;
    try {
        const candidate = JSON.parse(data.join('\n')) as Partial<StorefrontRealtimeEvent>;
        if (
            candidate.version !== 1 ||
            typeof candidate.id !== 'string' ||
            typeof candidate.occurredAt !== 'string' ||
            !Array.isArray(candidate.topics) ||
            !candidate.topics.every(topic => storefrontRealtimeTopics.includes(topic))
        ) {
            return null;
        }
        return candidate as StorefrontRealtimeEvent;
    } catch {
        return null;
    }
}

function storefrontRealtimeReadyHeartbeatInterval(frame: string): number | null {
    const { eventName, data } = parseStorefrontRealtimeFrameFields(frame);
    if (eventName !== 'ready' || data.length === 0) return null;
    try {
        const candidate = JSON.parse(data.join('\n')) as { version?: unknown; heartbeatIntervalMs?: unknown };
        if (candidate.version !== 1) return null;
        if (candidate.heartbeatIntervalMs === undefined) return DEFAULT_HEARTBEAT_INTERVAL_MS;
        return typeof candidate.heartbeatIntervalMs === 'number' &&
            Number.isInteger(candidate.heartbeatIntervalMs) &&
            candidate.heartbeatIntervalMs >= 1 &&
            candidate.heartbeatIntervalMs <= MAX_HEARTBEAT_INTERVAL_MS
            ? candidate.heartbeatIntervalMs
            : null;
    } catch {
        return null;
    }
}

export function parseStorefrontRealtimeFrameFields(frame: string): {
    eventName: string;
    data: string[];
} {
    let eventName = 'message';
    const data: string[] = [];
    for (const line of frame.split(/\r?\n/u)) {
        if (!line || line.startsWith(':')) continue;
        const separator = line.indexOf(':');
        const field = separator === -1 ? line : line.slice(0, separator);
        const value = separator === -1 ? '' : line.slice(separator + 1).replace(/^ /u, '');
        if (field === 'event') eventName = value;
        if (field === 'data') data.push(value);
    }
    return { eventName, data };
}

/** Fence synchronously; load the batching coordinator with realtime work, outside the initial page closure. */
export function invalidateStorefrontRealtimeQueries(
    queryClient: QueryClient,
    event: StorefrontRealtimeEvent,
    scope: StorefrontRealtimeScope,
    signal?: AbortSignal,
): Promise<void> {
    if (signal?.aborted) return Promise.resolve();
    if (event.topics.some(topic => ['catalog', 'content', 'config', 'coupons'].includes(topic)))
        invalidatePublicPageReads();
    return import('./realtime-refresh').then(({ enqueueStorefrontRealtimeQueries }) =>
        enqueueStorefrontRealtimeQueries(queryClient, event, scope, signal),
    );
}

/** A lightweight current-scope check; the public aggregate and catalog keep their own owners. */
export function refreshStorefrontAssociations(queryClient: QueryClient, scope: StorefrontRealtimeScope) {
    return queryClient.refetchQueries(
        {
            type: 'active',
            predicate: query =>
                matchesPrefix(query.queryKey, ['storefront', scope.marketCode, scope.languageCode]) &&
                ['products-by-ids', 'flash-sale-associations'].includes(String(query.queryKey[3])),
        },
        { cancelRefetch: false },
    );
}

function matchesPrefix(value: QueryKey, prefix: QueryKey): boolean {
    return prefix.every((part, index) => value[index] === part);
}
