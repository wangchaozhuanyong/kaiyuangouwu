import { InfiniteData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ShopApi } from '../api';
import { CatalogPaginationError, nextCatalogPageParam, validateCatalogPage } from '../catalog-pagination';
import { usePageReadiness } from '../page-readiness';
import {
    PUBLIC_QUERY_GC_TIME,
    PUBLIC_QUERY_STALE_TIME,
    publicQueryMeta,
    STOREFRONT_CATALOG_PAGE_SIZE,
    storefrontPlaceholderData,
    storefrontQueryKeys,
    storefrontQueryRetry,
} from '../query-client';
import { routeFromLocation, routeHref, type RouteState } from '../storefront-router';
import { MarketConfig, ProductSearchPage, StorefrontCatalogInput, StorefrontLanguage } from '../types';

interface CategoryPaginationOptions {
    api: Pick<ShopApi, 'catalog'>;
    market: MarketConfig;
    languageCode: string;
    language: StorefrontLanguage;
    input: StorefrontCatalogInput;
    enabled: boolean;
    suspended: boolean;
    pageSize?: number;
    route?: RouteState;
}

export function useCategoryPagination({
    api,
    market,
    languageCode,
    language,
    input,
    enabled,
    suspended,
    pageSize = STOREFRONT_CATALOG_PAGE_SIZE,
    route,
}: CategoryPaginationOptions) {
    const queryClient = useQueryClient();
    const queryKey = storefrontQueryKeys.catalog(storefrontQueryKeys.market(market), languageCode, {
        ...input,
        take: pageSize,
    });
    const scope = JSON.stringify(queryKey);
    const resultsRef = useRef<HTMLElement>(null);
    const sentinelRef = useRef<HTMLDivElement>(null);
    const requestRef = useRef<{ scope: string } | null>(null);
    const [online, setOnline] = useState(
        () => typeof navigator === 'undefined' || navigator.onLine !== false,
    );
    const [visible, setVisible] = useState(
        () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
    );
    // Match the server's first render; browser capabilities are applied after hydration.
    const [automaticSupported, setAutomaticSupported] = useState(false);

    useEffect(() => {
        setAutomaticSupported(typeof IntersectionObserver !== 'undefined');
    }, []);

    useEffect(() => {
        const updateConnection = () => setOnline(navigator.onLine);
        const updateVisibility = () => setVisible(document.visibilityState !== 'hidden');
        window.addEventListener('online', updateConnection);
        window.addEventListener('offline', updateConnection);
        document.addEventListener('visibilitychange', updateVisibility);
        return () => {
            window.removeEventListener('online', updateConnection);
            window.removeEventListener('offline', updateConnection);
            document.removeEventListener('visibilitychange', updateVisibility);
        };
    }, []);

    const query = useInfiniteQuery({
        queryKey,
        queryFn: async ({ pageParam, signal }) => {
            const page = await api.catalog({ ...input, skip: pageParam, take: pageSize }, signal);
            const cached = queryClient.getQueryData<InfiniteData<ProductSearchPage, number>>(queryKey);
            // Compare only earlier offsets: a background refresh may legitimately return the same page.
            const previousIds = new Set(
                cached?.pages.flatMap((previous, index) =>
                    cached.pageParams[index] < pageParam ? previous.items.map(item => item.id) : [],
                ),
            );
            return validateCatalogPage(
                page,
                pageParam,
                previousIds,
                language === 'zh'
                    ? '暂时无法加载更多商品，请重试'
                    : 'Could not load more products. Please retry.',
            );
        },
        initialPageParam: input.skip ?? 0,
        getNextPageParam: nextCatalogPageParam,
        enabled,
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        refetchOnMount: false,
        refetchOnWindowFocus: current => current.state.status !== 'error',
        refetchOnReconnect: current => current.state.status !== 'error',
        placeholderData: (previousData, previousQuery) =>
            storefrontPlaceholderData(previousData, previousQuery?.queryKey, queryKey),
        retry: (count, error) =>
            !(error instanceof CatalogPaginationError) && storefrontQueryRetry(count, error),
        meta: publicQueryMeta(),
    });
    usePageReadiness(enabled && query.isPending && !query.isError);
    const products = useMemo(() => {
        const seen = new Set<string>();
        return (query.data?.pages.flatMap(page => page.items) ?? []).filter(product => {
            if (seen.has(product.id)) return false;
            seen.add(product.id);
            return true;
        });
    }, [query.data]);
    const canRequest =
        enabled &&
        online &&
        visible &&
        !suspended &&
        !query.isFetching &&
        !query.isPaused &&
        !query.isPlaceholderData;

    const loadMore = useCallback(async () => {
        if (
            !canRequest ||
            (!query.hasNextPage && !query.isRefetchError) ||
            requestRef.current?.scope === scope
        )
            return;
        const request = { scope };
        requestRef.current = request;
        try {
            if (query.isRefetchError) await query.refetch({ cancelRefetch: false });
            else await query.fetchNextPage({ cancelRefetch: false });
        } finally {
            if (requestRef.current === request) requestRef.current = null;
        }
    }, [canRequest, query.fetchNextPage, query.hasNextPage, query.isRefetchError, query.refetch, scope]);

    useEffect(() => {
        const root = resultsRef.current;
        const target = sentinelRef.current;
        if (!automaticSupported || !canRequest || !query.hasNextPage || query.isError || !root || !target)
            return;
        let active = true;
        let observer: IntersectionObserver;
        const observeScrollContainer = () => {
            observer?.disconnect();
            const scrollRoot = getComputedStyle(root).overflowY === 'visible' ? null : root;
            observer = new IntersectionObserver(
                entries => {
                    if (active && entries.some(entry => entry.isIntersecting)) void loadMore();
                },
                { root: scrollRoot, rootMargin: '0px 0px 300px 0px', threshold: 0 },
            );
            observer.observe(target);
        };
        observeScrollContainer();
        window.addEventListener('resize', observeScrollContainer);
        return () => {
            active = false;
            window.removeEventListener('resize', observeScrollContainer);
            observer.disconnect();
        };
    }, [
        automaticSupported,
        canRequest,
        loadMore,
        query.dataUpdatedAt,
        query.hasNextPage,
        query.isError,
        scope,
    ]);

    return {
        query,
        products,
        totalItems: query.data?.pages.at(-1)?.totalItems ?? 0,
        resultsRef,
        sentinelRef,
        online,
        automaticSupported,
        loadMore,
        nextHref:
            query.hasNextPage && query.data
                ? routeHref({
                      ...(route ??
                          (typeof window === 'undefined'
                              ? { name: 'category' as const }
                              : routeFromLocation())),
                      page: Math.floor((Number(query.data.pageParams.at(-1) ?? 0) + pageSize) / pageSize) + 1,
                  })
                : undefined,
        previousHref:
            (input.skip ?? 0) > 0
                ? routeHref({
                      ...(route ??
                          (typeof window === 'undefined'
                              ? { name: 'category' as const }
                              : routeFromLocation())),
                      page:
                          Math.floor((input.skip ?? 0) / pageSize) > 1
                              ? Math.floor((input.skip ?? 0) / pageSize)
                              : undefined,
                  })
                : undefined,
    };
}
