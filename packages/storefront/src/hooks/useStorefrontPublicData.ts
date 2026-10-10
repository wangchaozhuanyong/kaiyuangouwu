import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { type PublicSeoDocument } from '../../../storefront-content-plugin/src/shared/public-seo';
import { storefrontNavigationCollections } from '../api/catalog';
import { SEND_CLIENT_CHANNEL_TOKEN } from '../api/helpers';
import { normalizeHeroAutoplayIntervalSeconds } from '../hero-carousel';
import { uiCopy } from '../i18n';
import { QueryLoadState, storefrontInitialQueryError, storefrontQueryPresentation } from '../loading-state';
import { asListProduct } from '../product-summary';
import {
    PUBLIC_QUERY_GC_TIME,
    PUBLIC_QUERY_STALE_TIME,
    publicQueryMeta,
    storefrontQueryKeys,
} from '../query-client';
import { useProductsByIdsQuery } from '../route-queries';
import {
    currentPublicPageRequest,
    fetchPublicPage,
    publicSeoQueryKey,
    readInitialPublicPage,
    seedPublicPage,
    type PublicPageData,
} from '../storefront-page-data';
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
    const request = currentPublicPageRequest();
    const initialSeoPage = readInitialPublicPage();
    // Observe metadata delivered by the same public read; this observer never starts a request.
    const publicSeoQuery = useQuery<PublicSeoDocument | null>({
        queryKey: publicSeoQueryKey(storefrontQueryKeys.market(market), vendureLanguageCode, request),
        enabled: false,
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        initialData:
            initialSeoPage?.scope.channelCode === market.code &&
            initialSeoPage.scope.currencyCode === market.currencyCode &&
            initialSeoPage.scope.languageCode === vendureLanguageCode
                ? initialSeoPage.seo
                : undefined,
    });
    const locationKey =
        typeof window === 'undefined' ? '/' : window.location.pathname + window.location.search;
    const [readyLocation, setReadyLocation] = useState('');
    useEffect(() => {
        const ready = () => setReadyLocation(window.location.pathname + window.location.search);
        document.addEventListener('storefront:page-ready', ready);
        // Subscribe after the first layout commit, which may already have declared cached data ready.
        if (document.querySelector('[data-page-readiness=ready]')) ready();
        return () => document.removeEventListener('storefront:page-ready', ready);
    }, []);
    async function publicSection<T>(
        name: 'products' | 'collections' | 'content' | 'flashSales',
        fallback: () => Promise<T>,
        signal?: AbortSignal,
    ): Promise<T> {
        const page = await fetchPublicPage(
            vendureLanguageCode,
            market.currencyCode,
            signal,
            currentPublicPageRequest(),
            market.code,
        );
        if (!page) return fallback();
        seedPublicPage(queryClient, page, true, false);
        if (page[name] === undefined) return fallback();
        if (name === 'collections' && page.collections)
            return storefrontNavigationCollections(page.collections) as T;
        if (name === 'products' && page.products) return page.products.map(asListProduct) as T;
        return page[name] as T;
    }
    const aggregatePart = {
        refetchOnMount: true as const,
        refetchOnWindowFocus: false as const,
        refetchOnReconnect: false as const,
        meta: { ...publicQueryMeta(), publicAggregatePart: !SEND_CLIENT_CHANNEL_TOKEN },
    };
    async function refreshMissingPublicSections(page: PublicPageData | undefined, signal: AbortSignal) {
        if (SEND_CLIENT_CHANNEL_TOKEN || !storefrontContextResolved || signal.aborted) return;
        const marketCode = storefrontQueryKeys.market(market);
        const missing: Array<[QueryKey, unknown, (querySignal: AbortSignal) => Promise<unknown>]> = [
            [
                [...storefrontQueryKeys.content(marketCode, vendureLanguageCode), 'public'],
                page?.content,
                querySignal => api.storefrontContent(querySignal),
            ],
            [
                storefrontQueryKeys.collections(marketCode, vendureLanguageCode),
                page?.collections,
                querySignal => api.collections(querySignal),
            ],
            [
                storefrontQueryKeys.flashSales(marketCode, vendureLanguageCode),
                page?.flashSales,
                querySignal => api.activeFlashSales(querySignal),
            ],
            [
                [...storefrontQueryKeys.scope(marketCode, vendureLanguageCode), 'visual-preset'],
                page?.visualPreset,
                querySignal => api.storefrontVisualPreset(querySignal),
            ],
        ];
        if (currentPublicPageRequest().kind === 'home')
            missing.push([
                storefrontQueryKeys.products(marketCode, vendureLanguageCode, 12),
                page?.products,
                querySignal => api.products(12, querySignal),
            ]);
        // Configuration remains the only refresh owner. Missing sections use their existing
        // query/cache and its cancellation/error state, without another aggregate request.
        const reads: Array<Promise<unknown>> = [];
        for (const [key, value, fallback] of missing) {
            if (value !== undefined) continue;
            const query = queryClient.getQueryCache().find({ queryKey: key, exact: true });
            if (!query?.isActive() || query.meta?.publicAggregatePart !== true) continue;
            reads.push(
                queryClient.fetchQuery({
                    ...query.options,
                    queryKey: key,
                    queryFn: ({ signal: querySignal }) => fallback(querySignal),
                    staleTime: 0,
                }),
            );
        }
        await Promise.allSettled(reads);
    }
    const productsQuery = useQuery({
        queryKey: storefrontQueryKeys.products(storefrontQueryKeys.market(market), vendureLanguageCode, 12),
        queryFn: ({ signal }) =>
            request.kind === 'home'
                ? publicSection('products', () => api.products(12, signal), signal)
                : api.products(12, signal),
        // Non-home recommendations never repeat the current catalog aggregate or delay its first rows.
        enabled: storefrontContextResolved && (request.kind === 'home' || readyLocation === locationKey),
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        ...aggregatePart,
        meta: {
            ...publicQueryMeta(),
            publicAggregatePart: request.kind === 'home' && !SEND_CLIENT_CHANNEL_TOKEN,
        },
    });

    const collectionsQuery = useQuery({
        queryKey: storefrontQueryKeys.collections(storefrontQueryKeys.market(market), vendureLanguageCode),
        queryFn: ({ signal }) => publicSection('collections', () => api.collections(signal), signal),
        enabled: storefrontContextResolved,
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        ...aggregatePart,
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
                currentPublicPageRequest(),
                storefrontContextResolved ? market.code : undefined,
            );
            if (!page) {
                const config = await api.storefrontConfig(signal);
                await refreshMissingPublicSections(undefined, signal);
                return config;
            }
            seedPublicPage(queryClient, page, false);
            await refreshMissingPublicSections(page, signal);
            return page.config;
        },
        // The bootstrap copies the just-received config to the resolved market key.
        // Avoid immediately repeating the same request when the server owns Channel routing.
        staleTime: SEND_CLIENT_CHANNEL_TOKEN ? 0 : 30_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        gcTime: PUBLIC_QUERY_GC_TIME,
    });

    const contentQuery = useQuery({
        queryKey: [
            ...storefrontQueryKeys.content(storefrontQueryKeys.market(market), vendureLanguageCode),
            'public',
        ],
        queryFn: ({ signal }) => publicSection('content', () => api.storefrontContent(signal), signal),
        enabled: storefrontContextResolved,
        staleTime: 30_000,
        gcTime: PUBLIC_QUERY_GC_TIME,
        ...aggregatePart,
    });

    const flashSalesQuery = useQuery({
        queryKey: storefrontQueryKeys.flashSales(storefrontQueryKeys.market(market), vendureLanguageCode),
        queryFn: ({ signal }) => publicSection('flashSales', () => api.activeFlashSales(signal), signal),
        enabled: storefrontContextResolved,
        staleTime: 30_000,
        gcTime: PUBLIC_QUERY_GC_TIME,
        ...aggregatePart,
    });

    const reviewSettingsQuery = useQuery({
        queryKey: storefrontQueryKeys.reviewSettings(storefrontQueryKeys.market(market), vendureLanguageCode),
        queryFn: ({ signal }) => api.reviewSettings(signal),
        enabled: storefrontContextResolved,
        staleTime: PUBLIC_QUERY_STALE_TIME,
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
        publicSeo: publicSeoQuery.data,
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
