// organize-imports-ignore -- Preserve ESLint type/value import groups.
import type { StorefrontConfig } from './types';
import {
    dehydrate,
    hydrate,
    type DehydratedState,
    type Query,
    type QueryClient,
    type QueryKey,
} from '@tanstack/react-query';

import {
    isLivePersistenceScope,
    isPreviewPublicQuery,
    PUBLIC_QUERY_CACHE_KEY,
    queryScope,
    storefrontQueryKeys,
} from './query-client';
type AccessScope = Parameters<typeof isLivePersistenceScope>[1];
export const PUBLIC_QUERY_CACHE_MAX_AGE = 5 * 60_000;
export const LEGACY_PUBLIC_QUERY_CACHE_KEYS = [
    'vendure-storefront-public-query-cache:v6',
    'vendure-storefront-public-query-cache:v5',
    'vendure-storefront-public-query-cache:v4',
    'vendure-storefront-public-query-cache:v3',
    'vendure-storefront-public-query-cache:v2',
] as const;
function isLivePublicQuery(client: QueryClient, key: QueryKey): boolean {
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
            const configs = client
                .getQueryCache()
                .findAll({ queryKey: storefrontQueryKeys.config(scope.marketCode, scope.languageCode) });
            return (
                isLivePersistenceScope(client, scope) &&
                configs.length > 0 &&
                configs.every(
                    query => (query.state.data as StorefrontConfig | undefined)?.accessMode === 'LIVE',
                )
            );
        })
    );
}

function canPersistPublicQuery(client: QueryClient, query: Query): boolean {
    return isLivePublicQuery(client, query.queryKey) && !isPreviewPublicQuery(client, query);
}
const PUBLIC_QUERY_CACHE_VERSION = 7;
const MAX_QUERIES = 32;
const MAX_PAGES = 3;
const MAX_BYTES = 256 * 1024;
function boundedData(data: unknown): unknown {
    const value = data as { pages?: unknown[]; pageParams?: unknown[] } | null;
    return value && Array.isArray(value.pages) && Array.isArray(value.pageParams)
        ? {
              ...value,
              pages: value.pages.slice(0, MAX_PAGES),
              pageParams: value.pageParams.slice(0, MAX_PAGES),
          }
        : data;
}
interface PersistedPublicQueryCache {
    version: number;
    savedAt: number;
    state: DehydratedState;
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
    const selected = new Set(
        client
            .getQueryCache()
            .getAll()
            .filter(
                query =>
                    query.meta?.persistPublic === true &&
                    isReusablePublicQuery(query.queryKey) &&
                    canPersistPublicQuery(client, query),
            )
            .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)
            .slice(0, MAX_QUERIES),
    );
    const state = dehydrate(client, {
        shouldDehydrateQuery: query =>
            selected.has(query) &&
            query.state.data !== undefined &&
            query.meta?.persistPublic === true &&
            isReusablePublicQuery(query.queryKey) &&
            canPersistPublicQuery(client, query),
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
    // Bound the persisted copy only; live Query pages and scroll/back data remain intact.
    const encoder = new TextEncoder();
    let bytes = 256;
    payload.state.queries = payload.state.queries.flatMap(query => {
        query.state.data = boundedData(query.state.data);
        const size = encoder.encode(JSON.stringify(query)).byteLength + 1;
        if (bytes + size > MAX_BYTES) return [];
        bytes += size;
        return [query];
    });
    const serialized = JSON.stringify(payload);
    if (encoder.encode(serialized).byteLength <= MAX_BYTES)
        storage.setItem(PUBLIC_QUERY_CACHE_KEY, serialized);
}

export function restorePublicQueryCache(
    client: QueryClient,
    storage: Pick<Storage, 'getItem' | 'removeItem'> = sessionStorage,
    now = Date.now(),
): boolean {
    try {
        LEGACY_PUBLIC_QUERY_CACHE_KEYS.forEach(key => storage.removeItem(key));
        const value = storage.getItem(PUBLIC_QUERY_CACHE_KEY);
        if (!value) return false;
        if (value.length > MAX_BYTES || new TextEncoder().encode(value).byteLength > MAX_BYTES) {
            storage.removeItem(PUBLIC_QUERY_CACHE_KEY);
            return false;
        }
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
        // Restore missing reads only. A later local timestamp cannot replace the
        // document or a completed live read with a previous visit's artwork.
        hydrate(client, {
            queries: payload.state.queries
                .filter(
                    ({ queryKey }) =>
                        isReusablePublicQuery(queryKey) &&
                        isLivePublicQuery(client, queryKey) &&
                        client.getQueryData(queryKey) === undefined,
                )
                .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)
                .slice(0, MAX_QUERIES)
                .map(query => ({ ...query, state: { ...query.state, data: boundedData(query.state.data) } })),
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
    persistInitial = false,
): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let idle: number | undefined;
    const persist = () => {
        try {
            persistPublicQueryCache(client, storage);
        } catch {
            /* In-memory Query remains usable. */
        }
    };
    const schedule = () => {
        if (timer) clearTimeout(timer);
        if (idle !== undefined) window.cancelIdleCallback(idle);
        timer = setTimeout(() => {
            timer = undefined;
            const runIdle = () => {
                idle = undefined;
                persist();
            };
            if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function')
                idle = window.requestIdleCallback(runIdle, { timeout: 1000 });
            else persist();
        }, 100);
    };
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
            (event.type === 'updated' && ['success', 'setState'].includes(event.action.type));
        if (!changed) return;
        schedule();
    });
    // Catch changes made before a deferred SSR subscription using the same
    // bounded, idle persistence path as later updates.
    if (persistInitial) schedule();
    if (typeof window !== 'undefined') window.addEventListener('pagehide', persist);
    return () => {
        if (timer) clearTimeout(timer);
        if (idle !== undefined) window.cancelIdleCallback(idle);
        if (typeof window !== 'undefined') window.removeEventListener('pagehide', persist);
        unsubscribe();
    };
}
