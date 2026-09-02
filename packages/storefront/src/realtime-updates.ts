import type { Query, QueryClient, QueryKey } from '@tanstack/react-query';

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

export interface StorefrontRealtimeStreamOptions {
    signal?: AbortSignal;
    onReady?: () => void;
}

export async function consumeStorefrontRealtimeStream(
    body: ReadableStream<Uint8Array>,
    onEvent: (event: StorefrontRealtimeEvent) => void,
    options: StorefrontRealtimeStreamOptions = {},
): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let completedNaturally = false;
    let failure: unknown;
    let ready = false;
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

    if (options.signal?.aborted) {
        await cancelReader(options.signal.reason);
        reader.releaseLock();
        return;
    }
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
        while (true) {
            const { done, value } = await reader.read();
            pending += decoder.decode(value, { stream: !done });
            if (pending.length > MAX_PENDING_EVENT_BYTES) {
                throw new Error('Storefront realtime event exceeded the maximum size');
            }
            const frames = pending.split(/\r?\n\r?\n/u);
            pending = done ? '' : (frames.pop() ?? '');
            for (const frame of frames) {
                if (!ready && isStorefrontRealtimeReadyFrame(frame)) {
                    ready = true;
                    options.onReady?.();
                }
                const parsed = parseStorefrontRealtimeFrame(frame);
                if (parsed) onEvent(parsed);
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

function isStorefrontRealtimeReadyFrame(frame: string): boolean {
    const { eventName, data } = parseStorefrontRealtimeFrameFields(frame);
    if (eventName !== 'ready' || data.length === 0) return false;
    try {
        const candidate = JSON.parse(data.join('\n')) as { version?: unknown };
        return candidate.version === 1;
    } catch {
        return false;
    }
}

function parseStorefrontRealtimeFrameFields(frame: string): {
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
    await queryClient.invalidateQueries({
        predicate: query => storefrontRealtimeQueryMatches(query, event, scope),
    });
}

export function storefrontRealtimeQueryMatches(
    query: Pick<Query, 'queryKey'>,
    event: StorefrontRealtimeEvent,
    scope: StorefrontRealtimeScope,
): boolean {
    const key = query.queryKey;
    if (!matchesPrefix(key, ['storefront', scope.marketCode, scope.languageCode])) return false;
    const section = key[3];
    const topics = new Set(event.topics);

    if (topics.has('config') && section === 'config') return true;
    if (topics.has('content') && (section === 'content' || couponCampaignQueryMatches(key, scope))) {
        return true;
    }
    if (topics.has('catalog') && catalogQueryMatches(key, event)) return true;
    if (topics.has('reviews') && section === 'product-reviews') {
        const ids = new Set(event.entityIds ?? []);
        return event.entityType !== 'Product' || ids.size === 0 || ids.has(String(key[4]));
    }
    if (topics.has('referral') && section === 'referral-program') return true;
    if (section !== 'private') return false;

    const privateSection = key[4];
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
    if (['products', 'catalog', 'collections'].includes(String(section))) return true;
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
