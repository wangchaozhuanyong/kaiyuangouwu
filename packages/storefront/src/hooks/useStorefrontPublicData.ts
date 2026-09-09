import { useQuery } from '@tanstack/react-query';

import { normalizeHeroAutoplayIntervalSeconds } from '../hero-carousel';
import { uiCopy } from '../i18n';
import { offlineLoadError, QueryLoadState } from '../loading-state';
import {
    PUBLIC_QUERY_GC_TIME,
    PUBLIC_QUERY_STALE_TIME,
    publicQueryMeta,
    storefrontQueryKeys,
} from '../query-client';
import { useProductsByIdsQuery } from '../route-queries';
import { storefrontErrorMessage } from '../storefront-errors';
import { contentStringArraySetting } from '../storefront-utils';

import { type StorefrontQueryContext } from './storefront-query-context';

export function useStorefrontPublicData({
    api,
    market,
    language,
    vendureLanguageCode,
    storefrontContextResolved,
    catalogAccessGranted,
}: StorefrontQueryContext) {
    const text = uiCopy[language];
    const productsQuery = useQuery({
        queryKey: storefrontQueryKeys.products(storefrontQueryKeys.market(market), vendureLanguageCode, 12),
        queryFn: ({ signal }) => api.products(12, signal),
        enabled: storefrontContextResolved && catalogAccessGranted,
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        meta: publicQueryMeta(),
    });

    const collectionsQuery = useQuery({
        queryKey: storefrontQueryKeys.collections(storefrontQueryKeys.market(market), vendureLanguageCode),
        queryFn: ({ signal }) => api.collections(signal),
        enabled: storefrontContextResolved && catalogAccessGranted,
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        meta: publicQueryMeta(),
    });

    const configQuery = useQuery({
        queryKey: storefrontQueryKeys.config(storefrontQueryKeys.market(market), vendureLanguageCode),
        queryFn: ({ signal }) => api.storefrontConfig(signal),
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
    });

    const contentQuery = useQuery({
        queryKey: [
            ...storefrontQueryKeys.content(storefrontQueryKeys.market(market), vendureLanguageCode),
            catalogAccessGranted ? 'authenticated' : 'account',
        ],
        queryFn: ({ signal }) =>
            catalogAccessGranted ? api.storefrontContent(signal) : api.storefrontAccountContent(signal),
        enabled: storefrontContextResolved,
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        meta: publicQueryMeta(),
    });

    const commerceModeQuery = useQuery({
        queryKey: storefrontQueryKeys.commerceMode(storefrontQueryKeys.market(market)),
        queryFn: ({ signal }) => api.activeStoreCommerceMode(signal),
        enabled: storefrontContextResolved && catalogAccessGranted,
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        meta: publicQueryMeta(),
    });

    const rawProducts = catalogAccessGranted ? (productsQuery.data ?? []) : [];

    const products = rawProducts;

    const collections = catalogAccessGranted ? (collectionsQuery.data ?? []) : [];

    const contentBlocks = contentQuery.data?.blocks ?? [];

    const navigationBlock = contentBlocks.find(block => block.type === 'NAVIGATION');

    const activeFlashSales = contentQuery.data?.flashSales ?? [];

    const systemAnnouncements = contentQuery.data?.systemAnnouncements ?? [];

    const managedContentProductIds = Array.from(
        new Set(
            contentBlocks.flatMap(block => contentStringArraySetting(block.settings?.selectedProductIds)),
        ),
    );

    const managedContentProductsQuery = useProductsByIdsQuery({
        api,
        productIds: catalogAccessGranted ? managedContentProductIds : [],
        market,
        language,
    });

    const managedContentProducts = managedContentProductsQuery.data ?? [];

    const activeFlashSaleItems = activeFlashSales
        .flatMap(sale => sale.items)
        .filter(
            (item, index, items) =>
                items.findIndex(candidate => candidate.productVariantId === item.productVariantId) === index,
        );

    const heroAutoplayIntervalSeconds = normalizeHeroAutoplayIntervalSeconds(
        contentQuery.data?.settings?.heroAutoplayIntervalSeconds ?? 5,
    );

    const configuredBlockTypes = contentQuery.data?.settings?.configuredBlockTypes ?? [];

    const criticalPublicQueries = [productsQuery, collectionsQuery, configQuery];

    const loading =
        rawProducts.length === 0 &&
        criticalPublicQueries.some(query => query.isLoading && query.data === undefined && !products.length);

    const publicPaused = criticalPublicQueries.some(
        query => query.isPaused && query.data === undefined && !products.length,
    );

    const publicQueryError =
        rawProducts.length === 0 && !products.length
            ? criticalPublicQueries.find(query => query.error && query.data === undefined)?.error
            : undefined;

    const error = publicPaused
        ? offlineLoadError(language)
        : publicQueryError instanceof Error
          ? storefrontErrorMessage(publicQueryError, language)
          : publicQueryError
            ? text.loadError
            : null;

    const publicLoadState: QueryLoadState = publicPaused
        ? 'paused'
        : loading
          ? 'loading'
          : error
            ? 'error'
            : 'ready';

    const contentError = error
        ? ''
        : contentQuery.isPaused && contentQuery.data === undefined
          ? offlineLoadError(language)
          : contentQuery.data !== undefined
            ? ''
            : contentQuery.error instanceof Error
              ? storefrontErrorMessage(contentQuery.error, language)
              : contentQuery.error
                ? text.loadError
                : '';
    return {
        productsQuery,
        collectionsQuery,
        configQuery,
        contentQuery,
        commerceModeQuery,
        products,
        collections,
        contentBlocks,
        navigationBlock,
        activeFlashSales,
        systemAnnouncements,
        managedContentProductsQuery,
        managedContentProducts,
        activeFlashSaleItems,
        heroAutoplayIntervalSeconds,
        configuredBlockTypes,
        loading,
        error,
        publicLoadState,
        contentError,
    };
}
