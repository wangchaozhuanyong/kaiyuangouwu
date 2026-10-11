import type { Query, QueryClient, QueryKey } from '@tanstack/react-query';

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

interface StorefrontRealtimeScope {
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

export async function invalidateStorefrontRealtimeQueries(
    queryClient: QueryClient,
    event: StorefrontRealtimeEvent,
    scope: StorefrontRealtimeScope,
): Promise<void> {
    if (event.topics.some(topic => ['catalog', 'content', 'config'].includes(topic))) {
        // A publication event invalidates any older transport, even if it is still downloading.
        invalidatePublicPageReads();
        await queryClient.cancelQueries({
            predicate: query =>
                matchesPrefix(query.queryKey, ['storefront', scope.marketCode, scope.languageCode]) &&
                query.queryKey[3] !== 'private' &&
                (query.meta?.publicAggregatePart === true ||
                    query.queryKey[3] === 'config' ||
                    storefrontRealtimeQueryMatches(query, event, scope)),
        });
    }
    // Aggregate sections share config's read owner. Mark their cached values stale without
    // launching independent content/visual/collection requests.
    await queryClient.invalidateQueries({
        predicate: query =>
            storefrontRealtimeQueryMatches(query, event, scope) && query.meta?.publicAggregatePart === true,
        refetchType: 'none',
    });
    await queryClient.invalidateQueries(
        {
            predicate: query =>
                query.meta?.publicAggregatePart !== true &&
                (storefrontRealtimeQueryMatches(query, event, scope) ||
                    (matchesPrefix(query.queryKey, [
                        'storefront',
                        scope.marketCode,
                        scope.languageCode,
                        'config',
                    ]) &&
                        event.topics.some(topic => ['catalog', 'content', 'config'].includes(topic)))),
        },
        { cancelRefetch: false },
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

export function storefrontRealtimeQueryMatches(
    query: Pick<Query, 'queryKey'>,
    event: StorefrontRealtimeEvent,
    scope: StorefrontRealtimeScope,
): boolean {
    const key = query.queryKey;
    const topics = new Set(event.topics);
    if (
        topics.has('config') &&
        matchesPrefix(key, ['storefront', scope.marketCode]) &&
        key[2] === 'commerce-mode'
    ) {
        return true;
    }
    if (!matchesPrefix(key, ['storefront', scope.marketCode, scope.languageCode])) return false;
    const section = key[3];
    if (
        ['flash-sales', 'flash-sale-associations'].includes(String(section)) &&
        (topics.has('catalog') || topics.has('content'))
    )
        return true;
    if (section === 'daily-recommendations' && (topics.has('catalog') || topics.has('orders'))) return true;

    if (topics.has('config') && (section === 'config' || section === 'review-settings')) return true;
    if (
        topics.has('content') &&
        (section === 'content' || section === 'visual-preset' || couponCampaignQueryMatches(key, scope))
    ) {
        return true;
    }
    if (topics.has('catalog') && catalogQueryMatches(key, event)) return true;
    if (topics.has('reviews') && section === 'product-reviews') {
        const ids = new Set(event.entityIds ?? []);
        return event.entityType !== 'Product' || ids.size === 0 || ids.has(String(key[4]));
    }
    if ((topics.has('referral') || topics.has('content')) && section === 'referral-program') return true;
    if (section !== 'private') return false;

    const privateSection = key[4];
    if (topics.has('catalog') && privateSection === 'cart') return true;
    if (topics.has('coupons') && privateSection === 'coupon-campaigns') return true;
    if (topics.has('cart') && privateSection === 'cart') return true;
    if (topics.has('customer') && privateSection === 'customer' && key.length === 5) return true;
    if (topics.has('orders') && (privateSection === 'order' || privateSection === 'order-by-code'))
        return true;
    if (!scope.customerId || privateSection !== 'customer' || String(key[5]) !== scope.customerId) {
        return false;
    }
    const customerSection = key[6];
    if (
        topics.has('orders') &&
        ['orders', 'order', 'order-counts', 'after-sales', 'review-candidates'].includes(
            String(customerSection),
        )
    ) {
        return true;
    }
    if (
        topics.has('coupons') &&
        ['coupon-campaigns', 'coupons', 'coupon-usage-records'].includes(String(customerSection))
    ) {
        return true;
    }
    if (topics.has('reviews') && ['reviews', 'review-candidates'].includes(String(customerSection))) {
        return true;
    }
    return topics.has('referral') && customerSection === 'referral';
}

function couponCampaignQueryMatches(key: QueryKey, scope: StorefrontRealtimeScope): boolean {
    if (key[3] !== 'private') return false;
    if (key[4] === 'coupon-campaigns') return key[5] === 'anonymous';
    return (
        Boolean(scope.customerId) &&
        key[4] === 'customer' &&
        String(key[5]) === scope.customerId &&
        key[6] === 'coupon-campaigns'
    );
}

function catalogQueryMatches(key: QueryKey, event: StorefrontRealtimeEvent): boolean {
    const section = key[3];
    if (
        [
            'products',
            'catalog',
            'collections',
            'native-catalog',
            'native-catalog-sales',
            'home-best-seller-sales',
        ].includes(String(section))
    )
        return true;
    const ids = new Set(event.entityIds ?? []);
    if (section === 'product') {
        return event.entityType !== 'Product' || ids.size === 0 || ids.has(String(key[4]));
    }
    if (section === 'products-by-ids') {
        const queryIds = Array.isArray(key[4]) ? key[4].map(String) : [];
        return event.entityType !== 'Product' || ids.size === 0 || queryIds.some(id => ids.has(id));
    }
    return false;
}

function matchesPrefix(value: QueryKey, prefix: QueryKey): boolean {
    return prefix.every((part, index) => value[index] === part);
}
