import { useQuery } from '@tanstack/react-query';

import { ShopApi } from '../api';
import { languageCodeFor } from '../i18n';
import { PUBLIC_QUERY_GC_TIME, storefrontQueryKeys } from '../query-client';
import { MarketConfig, StorefrontLanguage } from '../types';

export function useDailyRecommendations(
    api: ShopApi,
    market: MarketConfig,
    language: StorefrontLanguage,
    enabled = true,
) {
    return useQuery({
        queryKey: [
            ...storefrontQueryKeys.scope(storefrontQueryKeys.market(market), languageCodeFor(language)),
            'daily-recommendations',
        ],
        queryFn: ({ signal }) => api.dailyRecommendations(signal),
        enabled,
        staleTime: 60_000,
        gcTime: PUBLIC_QUERY_GC_TIME,
        refetchInterval: query => {
            const expires = Date.parse(query.state.data?.expiresAt ?? '');
            return Number.isFinite(expires) ? Math.max(1000, Math.min(60_000, expires - Date.now())) : 60_000;
        },
        refetchOnWindowFocus: true,
        retry: false,
    });
}
