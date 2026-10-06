import { useQuery, useQueryClient } from '@tanstack/react-query';

import { SEND_CLIENT_CHANNEL_TOKEN } from '../api/helpers';
import { normalizeHeroAutoplayIntervalSeconds } from '../hero-carousel';
import { uiCopy } from '../i18n';
import { QueryLoadState, storefrontInitialQueryError, storefrontQueryPresentation } from '../loading-state';
import {
    PUBLIC_QUERY_GC_TIME,
    PUBLIC_QUERY_STALE_TIME,
    publicQueryMeta,
    STOREFRONT_CONFIG_REFRESH_INTERVAL,
    storefrontQueryKeys,
} from '../query-client';
import { useProductsByIdsQuery } from '../route-queries';
import { fetchPublicPage, seedPublicPage } from '../storefront-page-data';
import { contentStringArraySetting } from '../storefront-utils';

import { type StorefrontQueryContext } from './storefront-query-context';

export function useStorefrontPublicData({
    api,
    market,
    language,
    vendureLanguageCode,
    storefrontContextResolved,
}: StorefrontQueryContext) {
    const text = uiCopy[language];
    const queryClient = useQueryClient();
    const productsQuery = useQuery({
        queryKey: storefrontQueryKeys.products(storefrontQueryKeys.market(market), vendureLanguageCode, 12),
        queryFn: ({ signal }) => api.products(12, signal),
        enabled: storefrontContextResolved,
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        meta: publicQueryMeta(),
    });

    const collectionsQuery = useQuery({
        queryKey: storefrontQueryKeys.collections(storefrontQueryKeys.market(market), vendureLanguageCode),
        queryFn: ({ signal }) => api.collections(signal),
        enabled: storefrontContextResolved,
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        meta: publicQueryMeta(),
    });

    const configQuery = useQuery({
        queryKey: [
            ...storefrontQueryKeys.config(storefrontQueryKeys.market(market), vendureLanguageCode),
            'public',
        ],
        queryFn: async ({ signal }) => {
            const page = await fetchPublicPage(
                vendureLanguageCode,
                storefrontContextResolved ? market.currencyCode : undefined,
                signal,
                { kind: 'home' },
                storefrontContextResolved ? market.code : undefined,
            );
            if (!page) return api.storefrontConfig(signal);
            seedPublicPage(queryClient, page, false);
            return page.config;
        },
        // The bootstrap copies the just-received config to the resolved market key.
        // Avoid immediately repeating the same request when the server owns Channel routing.
        staleTime: SEND_CLIENT_CHANNEL_TOKEN ? 0 : 30_000,
        refetchInterval: STOREFRONT_CONFIG_REFRESH_INTERVAL,
        gcTime: PUBLIC_QUERY_GC_TIME,
    });

    const contentQuery = useQuery({
        queryKey: [
            ...storefrontQueryKeys.content(storefrontQueryKeys.market(market), vendureLanguageCode),
            'public',
        ],
        queryFn: ({ signal }) => api.storefrontContent(signal),
        enabled: storefrontContextResolved,
        staleTime: 30_000,
        refetchInterval: STOREFRONT_CONFIG_REFRESH_INTERVAL,
        gcTime: PUBLIC_QUERY_GC_TIME,
        meta: publicQueryMeta(),
    });

    const flashSalesQuery = useQuery({
        queryKey: storefrontQueryKeys.flashSales(storefrontQueryKeys.market(market), vendureLanguageCode),
        queryFn: ({ signal }) => api.activeFlashSales(signal),
        enabled: storefrontContextResolved,
        staleTime: 30_000,
        refetchInterval: STOREFRONT_CONFIG_REFRESH_INTERVAL,
        gcTime: PUBLIC_QUERY_GC_TIME,
        meta: publicQueryMeta(),
    });

    const reviewSettingsQuery = useQuery({
        queryKey: storefrontQueryKeys.reviewSettings(storefrontQueryKeys.market(market), vendureLanguageCode),
        queryFn: ({ signal }) => api.reviewSettings(signal),
        enabled: storefrontContextResolved,
        staleTime: 0,
        refetchInterval: STOREFRONT_CONFIG_REFRESH_INTERVAL,
        gcTime: PUBLIC_QUERY_GC_TIME,
        meta: publicQueryMeta(),
    });
    const reviewSettingsStatus =
        reviewSettingsQuery.isError && reviewSettingsQuery.data === undefined
            ? 'error'
            : reviewSettingsQuery.data
              ? reviewSettingsQuery.data.enabled
                  ? 'enabled'
                  : 'disabled'
              : 'loading';

    const commerceModeQuery = useQuery({
        queryKey: storefrontQueryKeys.commerceMode(storefrontQueryKeys.market(market)),
        queryFn: ({ signal }) => api.activeStoreCommerceMode(signal),
        enabled: storefrontContextResolved,
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        meta: publicQueryMeta(),
    });

    const rawProducts = productsQuery.data ?? [];

    const products = rawProducts;

    const collections = collectionsQuery.data ?? [];

    const contentBlocks = contentQuery.data?.blocks ?? [];

    const configuredNavigationBlock = contentBlocks.find(block => block.type === 'NAVIGATION');
    const navigationBlock =
        configuredNavigationBlock && reviewSettingsStatus !== 'enabled'
            ? {
                  ...configuredNavigationBlock,
                  items: configuredNavigationBlock.items.filter(item => item.targetValue !== '/reviews'),
              }
            : configuredNavigationBlock;

    const activeFlashSales =
        flashSalesQuery.data ??
        (contentQuery.data?.flashSalesDeferred ? [] : (contentQuery.data?.flashSales ?? []));

    const systemAnnouncements = contentQuery.data?.systemAnnouncements ?? [];

    const managedContentProductIds = Array.from(
        new Set(
            contentBlocks.flatMap(block => contentStringArraySetting(block.settings?.selectedProductIds)),
        ),
    );

    const managedContentProductsQuery = useProductsByIdsQuery({
        api,
        productIds: managedContentProductIds,
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
    const authSettings = contentQuery.data?.settings.auth ?? {
        emailPasswordEnabled: true,
        emailAutoRegistrationEnabled: false,
        emailQuickRegistrationEnabled: false,
        googleEnabled: false,
        googleClientId: null,
    };

    // Catalog/recommendation reads have their own section state and cannot hide published home content.
    const criticalPublicQueries = [configQuery, contentQuery];

    const presentations = criticalPublicQueries.map(storefrontQueryPresentation);
    const initialFailure = criticalPublicQueries.find(query => query.data === undefined && query.isError);
    const publicPaused = presentations.some(query => query.paused);
    const error = initialFailure
        ? storefrontInitialQueryError(initialFailure, language)
        : publicPaused
          ? (criticalPublicQueries.map(query => storefrontInitialQueryError(query, language)).find(Boolean) ??
            text.loadError)
          : null;
    const loading = !error && presentations.some(query => query.initialLoading);
    const publicLoadState: QueryLoadState = initialFailure
        ? 'error'
        : publicPaused
          ? 'paused'
          : loading
            ? 'loading'
            : 'ready';
    const contentError = storefrontInitialQueryError(contentQuery, language);
    return {
        productsQuery,
        collectionsQuery,
        configQuery,
        contentQuery,
        reviewSettingsQuery,
        reviewSettingsStatus,
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
        authSettings,
        loading,
        error,
        publicLoadState,
        contentError,
    };
}
