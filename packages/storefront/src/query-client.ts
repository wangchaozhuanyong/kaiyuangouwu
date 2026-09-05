import { DehydratedState, QueryClient, QueryKey, dehydrate, hydrate } from '@tanstack/react-query';

import { ShopApiTimeoutError } from './api';

export const PUBLIC_QUERY_STALE_TIME = 60_000;
export const ROUTE_QUERY_STALE_TIME = 60_000;
export const PUBLIC_QUERY_GC_TIME = 30 * 60_000;
export const PUBLIC_QUERY_CACHE_MAX_AGE = 5 * 60_000;
export const PUBLIC_QUERY_CACHE_KEY = 'vendure-storefront-public-query-cache:v4';
export const LEGACY_PUBLIC_QUERY_CACHE_KEYS = [
    'vendure-storefront-public-query-cache:v3',
    'vendure-storefront-public-query-cache:v2',
] as const;
const PUBLIC_QUERY_CACHE_VERSION = 4;

export function storefrontQueryRetry(failureCount: number, error: unknown): boolean {
    return !(error instanceof ShopApiTimeoutError) && failureCount < 1;
}

interface PersistedPublicQueryCache {
    version: number;
    savedAt: number;
    state: DehydratedState;
}

export function createStorefrontQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: {
                retry: storefrontQueryRetry,
                staleTime: ROUTE_QUERY_STALE_TIME,
                gcTime: PUBLIC_QUERY_GC_TIME,
                refetchOnMount: storefrontRefetchPolicy,
                refetchOnWindowFocus: storefrontRefetchPolicy,
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

export function storefrontRefetchPolicy(_query: { meta?: Record<string, unknown> }): true {
    // Let React Query refetch only stale queries instead of forcing every persisted query to refresh.
    return true;
}

function isStorefrontConfigQuery(queryKey: QueryKey): boolean {
    return queryKey[0] === 'storefront' && queryKey[3] === 'config';
}

export function persistPublicQueryCache(
    client: QueryClient,
    storage: Pick<Storage, 'setItem'> = sessionStorage,
    savedAt = Date.now(),
): void {
    const state = dehydrate(client, {
        shouldDehydrateQuery: query =>
            query.state.status === 'success' &&
            query.meta?.persistPublic === true &&
            !isStorefrontConfigQuery(query.queryKey),
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
            queries: payload.state.queries.filter(query => !isStorefrontConfigQuery(query.queryKey)),
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
    market: (market: { code: string; currencyCode: string }) => `${market.code}:${market.currencyCode}`,
    scope: (marketCode: string, languageCode: string) => ['storefront', marketCode, languageCode] as const,
    config: (marketCode: string, languageCode: string) =>
        [...storefrontQueryKeys.scope(marketCode, languageCode), 'config'] as const,
    commerceMode: (marketCode: string) => ['storefront', marketCode, 'commerce-mode'] as const,
    content: (marketCode: string, languageCode: string) =>
        [...storefrontQueryKeys.scope(marketCode, languageCode), 'content'] as const,
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
    ) => [...storefrontQueryKeys.scope(marketCode, languageCode), 'catalog', input] as const,
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
    customerReviews: (marketCode: string, languageCode: string, customerId: string) =>
        [...storefrontQueryKeys.customerScope(marketCode, languageCode, customerId), 'reviews'] as const,
    reviewCandidates: (marketCode: string, languageCode: string, customerId: string) =>
        [
            ...storefrontQueryKeys.customerScope(marketCode, languageCode, customerId),
            'review-candidates',
        ] as const,
    productReviews: (marketCode: string, languageCode: string, productId: string) =>
        [...storefrontQueryKeys.scope(marketCode, languageCode), 'product-reviews', productId] as const,
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
