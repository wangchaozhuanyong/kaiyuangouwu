// organize-imports-ignore
import type { StorefrontConfig } from './types';
import {
    DehydratedState,
    QueryClient,
    QueryKey,
    dehydrate,
    hashKey,
    hydrate,
    type Query,
} from '@tanstack/react-query';

import { ShopApiTimeoutError } from './api/helpers';
import { invalidatePublicPageReads } from './public-page-transport';
import { isStorefrontClosedError } from './storefront-access';
import { storefrontErrorCode } from './storefront-errors';

type PublicQuerySource = { mode?: StorefrontConfig['accessMode']; dataUpdateCount: number };
type QueryReadStart = { access: number; persistence: number; mode?: StorefrontConfig['accessMode'] };
type AccessScope = Pick<StorefrontRefreshScope, 'marketCode' | 'languageCode'>;
type ScopeAccess = {
    denied: boolean;
    epoch: number;
    persistenceEpoch: number;
    restricted: boolean;
    mode?: StorefrontConfig['accessMode'];
};
const accessRuntimes = new WeakMap<
    QueryClient,
    {
        scopes: Map<string, ScopeAccess>;
        starts: WeakMap<Query, QueryReadStart>;
        sources: WeakMap<Query, PublicQuerySource>;
        listeners: Set<() => void>;
    }
>();
const accessScopeKey = (scope: AccessScope) => JSON.stringify([scope.marketCode, scope.languageCode]);
function queryScope(key: QueryKey): AccessScope | undefined {
    return key[0] === 'storefront' &&
        typeof key[1] === 'string' &&
        typeof key[2] === 'string' &&
        key[2] !== 'commerce-mode'
        ? { marketCode: key[1], languageCode: key[2] }
        : undefined;
}
function clearPersistedPublicData(): void {
    try {
        if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(PUBLIC_QUERY_CACHE_KEY);
    } catch {
        // Access denial must still clear in-memory data when storage is unavailable.
    }
}

/** Access epochs are control metadata only; server data remains in the Query cache. */
function accessRuntime(client: QueryClient) {
    const existing = accessRuntimes.get(client);
    if (existing) return existing;
    const runtime = {
        scopes: new Map<string, ScopeAccess>(),
        starts: new WeakMap<Query, QueryReadStart>(),
        sources: new WeakMap<Query, PublicQuerySource>(),
        listeners: new Set<() => void>(),
    };
    accessRuntimes.set(client, runtime);
    const cache = client.getQueryCache();
    cache.subscribe(event => {
        if (event.type !== 'updated') return;
        const query = event.query;
        const scope = queryScope(query.queryKey);
        if (!scope || cache.get(query.queryHash) !== query) return;
        const key = accessScopeKey(scope);
        let state = runtime.scopes.get(key);
        if (!state) {
            state = { denied: false, epoch: 0, persistenceEpoch: 0, restricted: false };
            runtime.scopes.set(key, state);
        }
        const config = query.queryKey[3] === 'config';
        if (event.action.type === 'fetch') {
            runtime.starts.set(query, {
                access: state.epoch,
                persistence: state.persistenceEpoch,
                mode: state.mode,
            });
            return;
        }
        const data = query.state.data as StorefrontConfig | undefined;
        const denied =
            (event.action.type === 'error' && isStorefrontClosedError(query.state.error, config)) ||
            (config && event.action.type === 'success' && data?.accessMode === 'CLOSED');
        if (denied) {
            state.denied = true;
            state.epoch++;
            state.mode = 'CLOSED';
            state.restricted = true;
            state.persistenceEpoch++;
            invalidatePublicPageReads();
            clearPersistedPublicData();
            // Notify the shell before removing query objects; no stale observer may keep content visible.
            runtime.listeners.forEach(listener => listener());
            const matches = (candidate: Query) =>
                isStorefrontQueryInScope(candidate.queryKey, { ...scope, includePrivate: true });
            void client.cancelQueries({
                predicate: candidate => matches(candidate) && candidate.state.fetchStatus === 'fetching',
            });
            client.removeQueries({
                predicate: candidate => matches(candidate) && candidate.queryKey[3] !== 'config',
            });
            return;
        }
        if (event.action.type !== 'success') return;
        if (state.denied) {
            if (!config) {
                client.removeQueries({ queryKey: query.queryKey, exact: true });
                return;
            }
            // Copying config/SSI data never restores access. Removed query objects were rejected above.
            if (event.action.manual || runtime.starts.get(query)?.access !== state.epoch) return;
            state.denied = false;
            runtime.listeners.forEach(listener => listener());
        }
        if (!config && query.queryKey[3] !== 'private') {
            const previous = runtime.sources.get(query);
            runtime.sources.set(query, {
                mode: event.action.manual
                    ? (previous?.mode ?? state.mode)
                    : (runtime.starts.get(query)?.mode ?? state.mode),
                dataUpdateCount: query.state.dataUpdateCount,
            });
        }
        if (config) {
            if (data?.accessMode === 'PREVIEW') {
                restrictStorefrontScopePersistence(client, scope);
            } else if (
                !event.action.manual &&
                runtime.starts.get(query)?.persistence === state.persistenceEpoch
            ) {
                const wasRestricted = state.restricted;
                state.mode = data?.accessMode;
                state.restricted = data?.accessMode !== 'LIVE';
                if (wasRestricted && state.mode === 'LIVE') {
                    // A fresh LIVE config cannot republish old PREVIEW entities. The same LIVE
                    // aggregate may already have seeded newer entities with explicit LIVE provenance.
                    const stalePreview = (candidate: Query) => {
                        if (
                            !isStorefrontQueryInScope(candidate.queryKey, scope) ||
                            candidate.queryKey[3] === 'config'
                        )
                            return false;
                        const source = runtime.sources.get(candidate);
                        return (
                            source?.mode !== 'LIVE' ||
                            source.dataUpdateCount !== candidate.state.dataUpdateCount
                        );
                    };
                    void client.cancelQueries({ predicate: stalePreview });
                    client.removeQueries({ predicate: stalePreview });
                }
            } else if (!state.restricted) {
                // Validated initial LIVE SSI may authorize restoration, never a previously restricted scope.
                state.mode = data?.accessMode;
            }
        }
    });
    return runtime;
}

export function isStorefrontScopeAccessDenied(client: QueryClient, scope: AccessScope): boolean {
    return accessRuntime(client).scopes.get(accessScopeKey(scope))?.denied === true;
}

export function watchStorefrontScopeAccess(client: QueryClient, notify: () => void): () => void {
    const listeners = accessRuntime(client).listeners;
    listeners.add(notify);
    return () => {
        listeners.delete(notify);
    };
}

/** Tag the response just written by the aggregate owner; this never grants access or changes scope mode. */
export function markStorefrontPublicQuerySource(
    client: QueryClient,
    key: QueryKey,
    mode?: StorefrontConfig['accessMode'],
): void {
    const query = client.getQueryCache().find({ queryKey: key, exact: true });
    if (!query || key[3] === 'config' || key[3] === 'private') return;
    accessRuntime(client).sources.set(query, { mode, dataUpdateCount: query.state.dataUpdateCount });
}

/** Tighten access before a PREVIEW aggregate is seeded, even while the previous config still says LIVE. */
export function restrictStorefrontScopePersistence(client: QueryClient, scope: AccessScope): void {
    const runtime = accessRuntime(client);
    const key = accessScopeKey(scope);
    let state = runtime.scopes.get(key);
    if (!state) {
        state = { denied: false, epoch: 0, persistenceEpoch: 0, restricted: false };
        runtime.scopes.set(key, state);
    }
    clearPersistedPublicData();
    if (state.restricted && state.mode === 'PREVIEW') return;
    state.restricted = true;
    state.persistenceEpoch++;
    state.mode = 'PREVIEW';
    // Clear old LIVE results before the caller seeds the new PREVIEW response.
    const publicData = (query: Query) =>
        isStorefrontQueryInScope(query.queryKey, scope) && query.queryKey[3] !== 'config';
    void client.cancelQueries({ predicate: publicData });
    client.removeQueries({ predicate: publicData });
}

function isLivePublicQuery(client: QueryClient, key: QueryKey): boolean {
    const runtime = accessRuntime(client);
    const scopes =
        key[2] === 'commerce-mode'
            ? client
                  .getQueryCache()
                  .getAll()
                  .filter(
                      query =>
                          query.queryKey[0] === 'storefront' &&
                          query.queryKey[1] === key[1] &&
                          query.queryKey[3] === 'config',
                  )
                  .flatMap(query => queryScope(query.queryKey) ?? [])
            : [queryScope(key)].filter((scope): scope is AccessScope => Boolean(scope));
    return (
        scopes.length > 0 &&
        scopes.every(scope => {
            const access = runtime.scopes.get(accessScopeKey(scope));
            const configs = client
                .getQueryCache()
                .findAll({ queryKey: storefrontQueryKeys.config(scope.marketCode, scope.languageCode) });
            return (
                access?.mode === 'LIVE' &&
                !access.denied &&
                !access.restricted &&
                configs.length > 0 &&
                configs.every(
                    query => (query.state.data as StorefrontConfig | undefined)?.accessMode === 'LIVE',
                )
            );
        })
    );
}

export const PUBLIC_QUERY_STALE_TIME = 60_000;
// Periodic refresh remains a fallback when the public event stream is disconnected.
export const STOREFRONT_CONFIG_REFRESH_INTERVAL = 60_000;
export const ROUTE_QUERY_STALE_TIME = 60_000;
export const PUBLIC_QUERY_GC_TIME = 30 * 60_000;
export const PUBLIC_QUERY_CACHE_MAX_AGE = 5 * 60_000;
export const PUBLIC_QUERY_CACHE_KEY = 'vendure-storefront-public-query-cache:v7';
export const LEGACY_PUBLIC_QUERY_CACHE_KEYS = [
    'vendure-storefront-public-query-cache:v6',
    'vendure-storefront-public-query-cache:v5',
    'vendure-storefront-public-query-cache:v4',
    'vendure-storefront-public-query-cache:v3',
    'vendure-storefront-public-query-cache:v2',
] as const;
const PUBLIC_QUERY_CACHE_VERSION = 7;

export function storefrontQueryRetry(failureCount: number, error: unknown): boolean {
    return (
        !(error instanceof ShopApiTimeoutError) &&
        storefrontErrorCode(error) !== 'FORBIDDEN' &&
        storefrontErrorCode(error) !== 'STOREFRONT_CLOSED' &&
        failureCount < 1
    );
}

interface PersistedPublicQueryCache {
    version: number;
    savedAt: number;
    state: DehydratedState;
}

export function createStorefrontQueryClient(): QueryClient {
    const client = new QueryClient({
        defaultOptions: {
            queries: {
                retry: storefrontQueryRetry,
                staleTime: ROUTE_QUERY_STALE_TIME,
                gcTime: PUBLIC_QUERY_GC_TIME,
                refetchOnMount: storefrontRefetchPolicy,
                refetchOnWindowFocus: storefrontRefetchPolicy,
                refetchOnReconnect: storefrontRefetchPolicy,
                refetchIntervalInBackground: false,
                networkMode: 'online',
            },
            mutations: {
                retry: false,
                networkMode: 'online',
            },
        },
    });
    accessRuntime(client);
    return client;
}

export const storefrontQueryClient = createStorefrontQueryClient();

export function publicQueryMeta() {
    return { persistPublic: true } as const;
}

export function storefrontRefetchPolicy(_query: { meta?: Record<string, unknown> }): true {
    // Let React Query refetch only stale queries instead of forcing every persisted query to refresh.
    return true;
}

export interface StorefrontRefreshScope {
    marketCode: string;
    languageCode: string;
    includePrivate?: boolean;
}

export function isStorefrontQueryInScope(queryKey: QueryKey, scope: StorefrontRefreshScope): boolean {
    return (
        queryKey[0] === 'storefront' &&
        queryKey[1] === scope.marketCode &&
        (queryKey[2] === scope.languageCode || queryKey[2] === 'commerce-mode') &&
        (scope.includePrivate === true || queryKey[3] !== 'private')
    );
}

/** Only the identical request may retain results. An old empty filter is not the new filter. */
export function storefrontPlaceholderData<T>(
    previous: T | undefined,
    previousKey: QueryKey | undefined,
    nextKey: QueryKey,
): T | undefined {
    return previousKey && hashKey(previousKey) === hashKey(nextKey) ? previous : undefined;
}

const refreshFlights = new WeakMap<QueryClient, Map<string, Promise<void>>>();
/** SSE, reconnect and manual refresh join active reads. Mutations are never part of this path. */
export function refreshStorefrontQueries(client: QueryClient, scope: StorefrontRefreshScope): Promise<void> {
    let flights = refreshFlights.get(client);
    if (!flights) {
        flights = new Map();
        refreshFlights.set(client, flights);
    }
    const key = JSON.stringify(scope);
    const existing = flights.get(key);
    if (existing) return existing;
    const promise = Promise.resolve()
        .then(() =>
            client.refetchQueries(
                {
                    type: 'active',
                    predicate: query =>
                        isStorefrontQueryInScope(query.queryKey, scope) &&
                        query.meta?.publicAggregatePart !== true,
                },
                { cancelRefetch: false },
            ),
        )
        .finally(() => flights?.delete(key));
    flights.set(key, promise);
    return promise;
}

const reusablePublicQueries = new Set([
    'content',
    'collections',
    'products',
    'product',
    'products-by-ids',
    'catalog',
    'product-reviews',
    'home-best-seller-sales',
]);

function isReusablePublicQuery(queryKey: QueryKey): boolean {
    return (
        queryKey[0] === 'storefront' &&
        (queryKey[2] === 'commerce-mode' || reusablePublicQueries.has(String(queryKey[3])))
    );
}

export function persistPublicQueryCache(
    client: QueryClient,
    storage: Pick<Storage, 'setItem'> & Partial<Pick<Storage, 'removeItem'>> = sessionStorage,
    savedAt = Date.now(),
): void {
    const state = dehydrate(client, {
        shouldDehydrateQuery: query =>
            query.state.data !== undefined &&
            query.meta?.persistPublic === true &&
            isReusablePublicQuery(query.queryKey) &&
            isLivePublicQuery(client, query.queryKey) &&
            accessRuntime(client).sources.get(query)?.mode !== 'PREVIEW',
    });
    if (state.queries.length === 0) {
        storage.removeItem?.(PUBLIC_QUERY_CACHE_KEY);
        return;
    }
    // Persist confirmed public data, never the error object from a later failed refresh.
    // Keep the original dataUpdatedAt so hydration cannot make old data appear fresh.
    state.queries = state.queries.map(query => ({
        ...query,
        state: {
            ...query.state,
            error: null,
            fetchFailureReason: null,
            fetchFailureCount: 0,
            status: 'success',
            fetchStatus: 'idle',
        },
    }));
    const payload: PersistedPublicQueryCache = {
        version: PUBLIC_QUERY_CACHE_VERSION,
        savedAt,
        state,
    };
    storage.setItem(PUBLIC_QUERY_CACHE_KEY, JSON.stringify(payload));
}

export function restorePublicQueryCache(
    client: QueryClient,
    storage: Pick<Storage, 'getItem' | 'removeItem'> = sessionStorage,
    now = Date.now(),
): boolean {
    try {
        for (const legacyKey of LEGACY_PUBLIC_QUERY_CACHE_KEYS) storage.removeItem(legacyKey);
        const value = storage.getItem(PUBLIC_QUERY_CACHE_KEY);
        if (!value) return false;
        const payload = JSON.parse(value) as PersistedPublicQueryCache;
        if (
            payload.version !== PUBLIC_QUERY_CACHE_VERSION ||
            !Number.isFinite(payload.savedAt) ||
            now - payload.savedAt > PUBLIC_QUERY_CACHE_MAX_AGE ||
            now < payload.savedAt
        ) {
            storage.removeItem(PUBLIC_QUERY_CACHE_KEY);
            return false;
        }
        // Existing sessions can contain both bootstrap and resolved-market branding.
        // Always load configuration from the Shop API so cleared copy cannot return on reload.
        hydrate(client, {
            ...payload.state,
            queries: payload.state.queries.filter(
                query => isReusablePublicQuery(query.queryKey) && isLivePublicQuery(client, query.queryKey),
            ),
        });
        return true;
    } catch {
        storage.removeItem(PUBLIC_QUERY_CACHE_KEY);
        return false;
    }
}

export function watchPublicQueryCache(
    client: QueryClient,
    storage: Pick<Storage, 'setItem'> = sessionStorage,
): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = client.getQueryCache().subscribe(event => {
        if (
            event.query.queryKey[3] !== 'config' &&
            (event.query.meta?.persistPublic !== true || !isReusablePublicQuery(event.query.queryKey))
        ) {
            return;
        }
        // Observer bookkeeping happens on navigation and renders even when the
        // cached data is unchanged. Only persist changes to restorable state.
        const changed =
            event.type === 'removed' ||
            (event.type === 'added' && event.query.state.status === 'success') ||
            (event.type === 'updated' &&
                ['success', 'error', 'invalidate', 'setState'].includes(event.action.type));
        if (!changed) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = undefined;
            try {
                persistPublicQueryCache(client, storage);
            } catch {
                // Storage can be unavailable or full; the in-memory cache remains valid.
            }
        }, 100);
    });
    return () => {
        if (timer) clearTimeout(timer);
        unsubscribe();
    };
}

export const storefrontQueryKeys = {
    market: (market: { code: string; currencyCode: string }) => `${market.code}:${market.currencyCode}`,
    scope: (marketCode: string, languageCode: string) => ['storefront', marketCode, languageCode] as const,
    config: (marketCode: string, languageCode: string) =>
        [...storefrontQueryKeys.scope(marketCode, languageCode), 'config'] as const,
    commerceMode: (marketCode: string) => ['storefront', marketCode, 'commerce-mode'] as const,
    content: (marketCode: string, languageCode: string) =>
        [...storefrontQueryKeys.scope(marketCode, languageCode), 'content'] as const,
    announcements: (marketCode: string, languageCode: string, page: number, take: number) =>
        [...storefrontQueryKeys.content(marketCode, languageCode), 'announcements', { page, take }] as const,
    announcement: (marketCode: string, languageCode: string, id: string) =>
        [...storefrontQueryKeys.content(marketCode, languageCode), 'announcement', id] as const,
    flashSales: (marketCode: string, languageCode: string) =>
        [...storefrontQueryKeys.scope(marketCode, languageCode), 'flash-sales'] as const,
    collections: (marketCode: string, languageCode: string) =>
        [...storefrontQueryKeys.scope(marketCode, languageCode), 'collections'] as const,
    products: (marketCode: string, languageCode: string, take: number) =>
        [...storefrontQueryKeys.scope(marketCode, languageCode), 'products', { take }] as const,
    product: (marketCode: string, languageCode: string, productId: string) =>
        [...storefrontQueryKeys.scope(marketCode, languageCode), 'product', productId] as const,
    productsByIds: (marketCode: string, languageCode: string, productIds: readonly string[]) =>
        [...storefrontQueryKeys.scope(marketCode, languageCode), 'products-by-ids', [...productIds]] as const,
    catalog: (
        marketCode: string,
        languageCode: string,
        input: Record<string, string | number | boolean | undefined>,
    ) =>
        [
            ...storefrontQueryKeys.scope(marketCode, languageCode),
            'catalog',
            catalogCacheInput(input),
        ] as const,
    privateScope: (marketCode: string, languageCode: string) =>
        [...storefrontQueryKeys.scope(marketCode, languageCode), 'private'] as const,
    cart: (marketCode: string, languageCode: string) =>
        [...storefrontQueryKeys.privateScope(marketCode, languageCode), 'cart'] as const,
    customer: (marketCode: string, languageCode: string) =>
        [...storefrontQueryKeys.privateScope(marketCode, languageCode), 'customer'] as const,
    couponCampaigns: (marketCode: string, languageCode: string, customerId: string | null) =>
        customerId
            ? ([
                  ...storefrontQueryKeys.customerScope(marketCode, languageCode, customerId),
                  'coupon-campaigns',
              ] as const)
            : ([
                  ...storefrontQueryKeys.privateScope(marketCode, languageCode),
                  'coupon-campaigns',
                  'anonymous',
              ] as const),
    customerCoupons: (marketCode: string, languageCode: string, customerId: string) =>
        [...storefrontQueryKeys.customerScope(marketCode, languageCode, customerId), 'coupons'] as const,
    customerCouponUsageRecords: (marketCode: string, languageCode: string, customerId: string) =>
        [
            ...storefrontQueryKeys.customerScope(marketCode, languageCode, customerId),
            'coupon-usage-records',
        ] as const,
    customerScope: (marketCode: string, languageCode: string, customerId: string) =>
        [...storefrontQueryKeys.privateScope(marketCode, languageCode), 'customer', customerId] as const,
    deliveryEmails: (marketCode: string, languageCode: string, customerId: string) =>
        [
            ...storefrontQueryKeys.customerScope(marketCode, languageCode, customerId),
            'delivery-emails',
        ] as const,
    customerOrderCounts: (marketCode: string, languageCode: string, customerId: string) =>
        [...storefrontQueryKeys.customerScope(marketCode, languageCode, customerId), 'order-counts'] as const,
    afterSalesRequests: (marketCode: string, languageCode: string, customerId: string) =>
        [...storefrontQueryKeys.customerScope(marketCode, languageCode, customerId), 'after-sales'] as const,
    notificationReads: (marketCode: string, languageCode: string, customerId: string, versions: string) =>
        [
            ...storefrontQueryKeys.customerScope(marketCode, languageCode, customerId),
            'notification-reads',
            versions,
        ] as const,
    customerReviews: (marketCode: string, languageCode: string, customerId: string) =>
        [...storefrontQueryKeys.customerScope(marketCode, languageCode, customerId), 'reviews'] as const,
    customerProductActivity: (marketCode: string, languageCode: string, customerId: string) =>
        [
            ...storefrontQueryKeys.customerScope(marketCode, languageCode, customerId),
            'product-activity',
        ] as const,
    reviewCandidates: (marketCode: string, languageCode: string, customerId: string) =>
        [
            ...storefrontQueryKeys.customerScope(marketCode, languageCode, customerId),
            'review-candidates',
            'pages',
        ] as const,
    productReviews: (marketCode: string, languageCode: string, productId: string) =>
        [
            ...storefrontQueryKeys.scope(marketCode, languageCode),
            'product-reviews',
            productId,
            'pages',
        ] as const,
    reviewSettings: (marketCode: string, languageCode: string) =>
        [...storefrontQueryKeys.scope(marketCode, languageCode), 'review-settings'] as const,
    referralProgram: (marketCode: string, languageCode: string) =>
        [...storefrontQueryKeys.scope(marketCode, languageCode), 'referral-program'] as const,
    customerReferral: (marketCode: string, languageCode: string, customerId: string) =>
        [...storefrontQueryKeys.customerScope(marketCode, languageCode, customerId), 'referral'] as const,
    customerOrders: (
        marketCode: string,
        languageCode: string,
        customerId: string,
        input: Record<string, string | number | boolean | undefined>,
    ) =>
        [
            ...storefrontQueryKeys.customerScope(marketCode, languageCode, customerId),
            'orders',
            input,
        ] as const,
    order: (marketCode: string, languageCode: string, customerId: string, orderId: string) =>
        [
            ...storefrontQueryKeys.customerScope(marketCode, languageCode, customerId),
            'order',
            orderId,
        ] as const,
    orderByCode: (marketCode: string, languageCode: string, code: string) =>
        [...storefrontQueryKeys.privateScope(marketCode, languageCode), 'order-by-code', code] as const,
    paymentMethods: (marketCode: string, languageCode: string, orderId: string) =>
        [
            ...storefrontQueryKeys.privateScope(marketCode, languageCode),
            'order',
            orderId,
            'payment-methods',
        ] as const,
};

export const STOREFRONT_CATALOG_PAGE_SIZE = 12;

export function catalogCacheInput(input: Record<string, string | number | boolean | undefined>) {
    return {
        ...(input.purpose ? { purpose: input.purpose } : {}),
        term: typeof input.term === 'string' ? input.term.trim() || undefined : undefined,
        collectionId: input.collectionId || undefined,
        sort: String(input.sort || 'RECOMMENDED')
            .toUpperCase()
            .replaceAll('-', '_'),
        fulfillmentType: input.fulfillmentType ? String(input.fulfillmentType).toUpperCase() : undefined,
        inStockOnly: input.inStockOnly === true,
        minPriceWithTax: input.minPriceWithTax,
        maxPriceWithTax: input.maxPriceWithTax,
        take: input.take ?? STOREFRONT_CATALOG_PAGE_SIZE,
    };
}
