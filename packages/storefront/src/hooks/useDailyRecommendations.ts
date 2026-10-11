import { useQuery } from '@tanstack/react-query';

import { ShopApi } from '../api';
import { languageCodeFor } from '../i18n';
import { storefrontQueryKeys } from '../query-client';
import { useProductsByIdsQuery } from '../route-queries';
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
    const referenceIds = [
        ...new Set([...selection.selectedIds, ...selection.products.map(product => product.id)]),
    ];
    const references = useProductsByIdsQuery({ api, market, language, productIds: referenceIds, enabled });
    const current = references.data ? new Map(references.data.map(product => [product.id, product])) : null;
    const items = current
        ? selection.products.flatMap(product => current.get(product.id) ?? [])
        : selection.products;
    return {
        ...query,
        data: query.data ? { ...query.data, items } : undefined,
        retry: async () => {
            const result = await query.refetch({ cancelRefetch: false });
            if (selection.selectedIds.length) await references.refetch({ cancelRefetch: false });
            return result;
        },
    };
}
