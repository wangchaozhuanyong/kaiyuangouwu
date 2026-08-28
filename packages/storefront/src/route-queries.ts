import { useQuery } from '@tanstack/react-query';

import { ShopApi } from './api';
import { languageCodeFor } from './i18n';
import {
    PUBLIC_QUERY_GC_TIME,
    PUBLIC_QUERY_STALE_TIME,
    publicQueryMeta,
    storefrontQueryKeys,
} from './query-client';
import { MarketConfig, StorefrontLanguage } from './types';

export function useProductsByIdsQuery({
    api,
    productIds,
    market,
    language,
}: {
    api: ShopApi;
    productIds: string[];
    market: MarketConfig;
    language: StorefrontLanguage;
}) {
    return useQuery({
        queryKey: storefrontQueryKeys.productsByIds(
            storefrontQueryKeys.market(market),
            languageCodeFor(language),
            productIds,
        ),
        queryFn: ({ signal }) => api.productsByIds(productIds, signal),
        enabled: productIds.length > 0,
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        meta: publicQueryMeta(),
    });
}
