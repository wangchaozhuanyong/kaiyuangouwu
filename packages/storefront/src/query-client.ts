import { DehydratedState, QueryClient, dehydrate, hydrate } from '@tanstack/react-query';

export const PUBLIC_QUERY_STALE_TIME = 60_000;
export const PUBLIC_QUERY_GC_TIME = 30 * 60_000;
export const PUBLIC_QUERY_CACHE_MAX_AGE = 5 * 60_000;
export const PUBLIC_QUERY_CACHE_KEY = 'vendure-storefront-public-query-cache:v1';
const PUBLIC_QUERY_CACHE_VERSION = 1;

interface PersistedPublicQueryCache {
    version: number;
    savedAt: number;
    state: DehydratedState;
}

export function createStorefrontQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: {
                retry: 1,
                gcTime: PUBLIC_QUERY_GC_TIME,
                refetchOnWindowFocus: true,
                networkMode: 'online',
            },
            mutations: {
                retry: false,
                networkMode: 'online',
            },
        },
    });
}

export const storefrontQueryClient = createStorefrontQueryClient();

export function publicQueryMeta() {
    return { persistPublic: true } as const;
}

export function persistPublicQueryCache(
    client: QueryClient,
    storage: Pick<Storage, 'setItem'> = sessionStorage,
    savedAt = Date.now(),
): void {
    const state = dehydrate(client, {
        shouldDehydrateQuery: query => query.state.status === 'success' && query.meta?.persistPublic === true,
    });
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
        hydrate(client, payload.state);
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
        if (event?.query.meta?.persistPublic !== true) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
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
    scope: (marketCode: string, languageCode: string) => ['storefront', marketCode, languageCode] as const,
    config: (marketCode: string, languageCode: string) =>
        [...storefrontQueryKeys.scope(marketCode, languageCode), 'config'] as const,
    content: (marketCode: string, languageCode: string) =>
        [...storefrontQueryKeys.scope(marketCode, languageCode), 'content'] as const,
    collections: (marketCode: string, languageCode: string) =>
        [...storefrontQueryKeys.scope(marketCode, languageCode), 'collections'] as const,
    products: (marketCode: string, languageCode: string, take: number) =>
        [...storefrontQueryKeys.scope(marketCode, languageCode), 'products', { take }] as const,
    product: (marketCode: string, languageCode: string, productId: string) =>
        [...storefrontQueryKeys.scope(marketCode, languageCode), 'product', productId] as const,
    catalog: (
        marketCode: string,
        languageCode: string,
        input: Record<string, string | number | boolean | undefined>,
    ) => [...storefrontQueryKeys.scope(marketCode, languageCode), 'catalog', input] as const,
    cart: (marketCode: string, languageCode: string) =>
        [...storefrontQueryKeys.scope(marketCode, languageCode), 'private', 'cart'] as const,
    customer: (marketCode: string, languageCode: string) =>
        [...storefrontQueryKeys.scope(marketCode, languageCode), 'private', 'customer'] as const,
    order: (marketCode: string, languageCode: string, orderId: string) =>
        [...storefrontQueryKeys.scope(marketCode, languageCode), 'private', 'order', orderId] as const,
};
