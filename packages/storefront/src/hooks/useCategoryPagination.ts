import { InfiniteData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ShopApi } from '../api';
import {
    PUBLIC_QUERY_GC_TIME,
    PUBLIC_QUERY_STALE_TIME,
    publicQueryMeta,
    storefrontQueryKeys,
    storefrontQueryRetry,
} from '../query-client';
import { MarketConfig, ProductSearchPage, StorefrontCatalogInput, StorefrontLanguage } from '../types';

class CatalogPaginationError extends Error {}

interface CategoryPaginationOptions {
    api: Pick<ShopApi, 'catalog'>;
    market: MarketConfig;
    languageCode: string;
    language: StorefrontLanguage;
    input: StorefrontCatalogInput;
    enabled: boolean;
    suspended: boolean;
}

export function useCategoryPagination({
    api,
    market,
    languageCode,
    language,
    input,
    enabled,
    suspended,
}: CategoryPaginationOptions) {
    const queryClient = useQueryClient();
    const queryKey = storefrontQueryKeys.catalog(storefrontQueryKeys.market(market), languageCode, {
        ...input,
    });
    const scope = JSON.stringify(queryKey);
    const resultsRef = useRef<HTMLElement>(null);
    const sentinelRef = useRef<HTMLDivElement>(null);
    const requestRef = useRef<{ scope: string } | null>(null);
    const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
    const [visible, setVisible] = useState(
        () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
    );
    const automaticSupported = typeof IntersectionObserver !== 'undefined';

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
            const page = await api.catalog({ ...input, skip: pageParam, take: 12 }, signal);
            const cached = queryClient.getQueryData<InfiniteData<ProductSearchPage, number>>(queryKey);
            // Compare only earlier offsets: a background refresh may legitimately return the same page.
            const previousIds = new Set(
                cached?.pages.flatMap((previous, index) =>
                    cached.pageParams[index] < pageParam ? previous.items.map(item => item.id) : [],
                ),
            );
            const emptyWithRemaining = page.items.length === 0 && page.totalItems > pageParam;
            const repeatedPage = page.items.length > 0 && page.items.every(item => previousIds.has(item.id));
            if (emptyWithRemaining || repeatedPage) {
                throw new CatalogPaginationError(
                    language === 'zh'
                        ? '暂时无法加载更多商品，请重试'
                        : 'Could not load more products. Please retry.',
                );
            }
            return page;
        },
        initialPageParam: 0,
        getNextPageParam: (lastPage, _pages, lastPageParam) => {
            const next = lastPageParam + lastPage.items.length;
            return lastPage.items.length > 0 && next < lastPage.totalItems ? next : undefined;
        },
        enabled,
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        refetchOnMount: false,
        refetchOnWindowFocus: current => current.state.status !== 'error',
        refetchOnReconnect: current => current.state.status !== 'error',
        placeholderData: (previousData, previousQuery) =>
            previousQuery?.queryKey.slice(0, 3).every((part, index) => part === queryKey[index])
                ? previousData
                : undefined,
        retry: (count, error) =>
            !(error instanceof CatalogPaginationError) && storefrontQueryRetry(count, error),
        meta: publicQueryMeta(),
    });
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
        const observer = new IntersectionObserver(
            entries => {
                if (active && entries.some(entry => entry.isIntersecting)) void loadMore();
            },
            { root, rootMargin: '0px 0px 300px 0px', threshold: 0 },
        );
        observer.observe(target);
        return () => {
            active = false;
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
    };
}
