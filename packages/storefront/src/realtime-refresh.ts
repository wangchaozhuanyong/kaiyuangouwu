// organize-imports-ignore -- Preserve the repository's ESLint order for type-only imports.
import type { StorefrontRealtimeEvent, StorefrontRealtimeScope } from './realtime-updates';
import type { Query, QueryClient, QueryKey } from '@tanstack/react-query';

/** Recover active account reads whose invalidation may have been missed while the stream was down. */
export function refreshStorefrontPrivateRealtimeReads(
    queryClient: QueryClient,
    scope: StorefrontRealtimeScope,
) {
    if (!scope.customerId) return Promise.resolve();
    const prefix = ['storefront', scope.marketCode, scope.languageCode, 'private'];
    return queryClient.refetchQueries(
        {
            type: 'active',
            predicate: ({ queryKey }) =>
                matchesPrefix(queryKey, prefix) &&
                (queryKey[4] === 'cart' ||
                    (queryKey[4] === 'customer' &&
                        queryKey[5] === scope.customerId &&
                        [
                            'coupon-campaigns',
                            'coupons',
                            'coupon-usage-records',
                            'orders',
                            'order',
                            'order-counts',
                            'after-sales',
                        ].includes(String(queryKey[6])))),
        },
        { cancelRefetch: false },
    );
}

const realtimeRefreshes = new WeakMap<
    QueryClient,
    Map<
        string,
        {
            signal?: AbortSignal;
            enqueue: (event: StorefrontRealtimeEvent) => void;
            promise: Promise<void>;
        }
    >
>();
const REALTIME_MERGE_DELAY_MS = 100;
const REALTIME_MAX_MERGE_DELAY_MS = 500;

/** Merge notifications, not response data. Query and the transport retain their existing owners. */
export function enqueueStorefrontRealtimeQueries(
    queryClient: QueryClient,
    event: StorefrontRealtimeEvent,
    scope: StorefrontRealtimeScope,
    signal?: AbortSignal,
): Promise<void> {
    if (signal?.aborted) return Promise.resolve();
    let scopes = realtimeRefreshes.get(queryClient);
    if (!scopes) realtimeRefreshes.set(queryClient, (scopes = new Map()));
    const key = JSON.stringify([scope.marketCode, scope.languageCode, scope.customerId]);
    const existing = scopes.get(key);
    if (existing && existing.signal === signal) {
        existing.enqueue(event);
        return existing.promise;
    }
    const pending = new Map<string, StorefrontRealtimeEvent>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let disposed = false;
    let firstPendingAt = 0;
    let lastPendingAt = 0;
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((done, fail) => {
        resolve = done;
        reject = fail;
    });
    const finish = (error?: unknown) => {
        disposed = true;
        if (timer !== undefined) clearTimeout(timer);
        pending.clear();
        signal?.removeEventListener('abort', abort);
        if (scopes.get(key) === state) scopes.delete(key);
        if (error) reject(error);
        else resolve();
    };
    const abort = () => finish();
    const schedule = () => {
        if (disposed || running) return;
        if (timer !== undefined) clearTimeout(timer);
        const now = Date.now();
        timer = setTimeout(
            () => void flush(),
            Math.max(
                0,
                Math.min(
                    lastPendingAt + REALTIME_MERGE_DELAY_MS - now,
                    firstPendingAt + REALTIME_MAX_MERGE_DELAY_MS - now,
                ),
            ),
        );
    };
    const flush = async () => {
        timer = undefined;
        if (disposed) return;
        const events = [...pending.values()];
        pending.clear();
        running = true;
        try {
            await applyStorefrontRealtimeQueries(queryClient, events, scope, () => !disposed);
        } catch (error) {
            finish(error);
            return;
        }
        running = false;
        if (disposed) return;
        if (pending.size) schedule();
        else finish();
    };
    const state = {
        signal,
        promise,
        enqueue(next: StorefrontRealtimeEvent) {
            if (disposed) return;
            if (!pending.size) firstPendingAt = Date.now();
            lastPendingAt = Date.now();
            const target = JSON.stringify([[...next.topics].sort(), next.entityType]);
            const prior = pending.get(target);
            pending.set(
                target,
                prior
                    ? {
                          ...next,
                          // An untargeted notification must remain broad; never narrow it to later IDs.
                          entityIds:
                              prior.entityIds?.length && next.entityIds?.length
                                  ? [...new Set([...prior.entityIds, ...next.entityIds])]
                                  : undefined,
                      }
                    : next,
            );
            schedule();
        },
    };
    scopes.set(key, state);
    signal?.addEventListener('abort', abort, { once: true });
    state.enqueue(event);
    return promise;
}

async function applyStorefrontRealtimeQueries(
    queryClient: QueryClient,
    events: StorefrontRealtimeEvent[],
    scope: StorefrontRealtimeScope,
    current: () => boolean,
): Promise<void> {
    const matches = (query: Pick<Query, 'queryKey'>) =>
        events.some(event => storefrontRealtimeQueryMatches(query, event, scope));
    const publication = events.some(event =>
        event.topics.some(topic => ['catalog', 'content', 'config', 'coupons'].includes(topic)),
    );
    if (publication) {
        await queryClient.cancelQueries({
            predicate: query =>
                matchesPrefix(query.queryKey, ['storefront', scope.marketCode, scope.languageCode]) &&
                query.queryKey[3] !== 'private' &&
                (query.meta?.publicAggregatePart === true ||
                    query.queryKey[3] === 'config' ||
                    matches(query)),
        });
    }
    if (!current()) return;
    // Aggregate sections share config's read owner. Mark their cached values stale without
    // launching independent content/visual/collection requests.
    await queryClient.invalidateQueries({
        predicate: query => matches(query) && query.meta?.publicAggregatePart === true,
        refetchType: 'none',
    });
    if (!current()) return;
    await queryClient.invalidateQueries(
        {
            predicate: query =>
                query.meta?.publicAggregatePart !== true &&
                (matches(query) ||
                    (matchesPrefix(query.queryKey, [
                        'storefront',
                        scope.marketCode,
                        scope.languageCode,
                        'config',
                    ]) &&
                        publication)),
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

function matchesPrefix(value: readonly unknown[], prefix: readonly unknown[]): boolean {
    return prefix.every((part, index) => value[index] === part);
}
