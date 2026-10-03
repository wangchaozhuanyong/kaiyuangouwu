import { useQuery } from '@tanstack/react-query';

import { ShopApi } from '../api';
import { languageCodeFor } from '../i18n';
import { storefrontQueryKeys } from '../query-client';
import { MarketConfig, StorefrontLanguage } from '../types';

import { usePageLoadProductOrder } from './usePageLoadProductOrder';

export function useDailyRecommendations(
    api: ShopApi,
    market: MarketConfig,
    language: StorefrontLanguage,
    enabled = true,
) {
    const query = useQuery({
        queryKey: [
            ...storefrontQueryKeys.scope(storefrontQueryKeys.market(market), languageCodeFor(language)),
            'daily-recommendations',
        ],
        queryFn: ({ signal }) => api.dailyRecommendations(signal),
        enabled,
        staleTime: Infinity,
        gcTime: Infinity,
        retry: false,
    });
    const selection = usePageLoadProductOrder({
        scope: JSON.stringify([storefrontQueryKeys.market(market), languageCodeFor(language)]),
        kind: 'daily',
        ready: query.data !== undefined,
        candidates: query.data?.items ?? [],
        select: () => query.data?.items ?? [],
    });
    return {
        ...query,
        data: query.data ? { ...query.data, items: selection.products } : undefined,
    };
}
