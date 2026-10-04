/* eslint-disable import/order -- prettier-plugin-organize-imports places type-only imports after runtime imports. */
import { useQuery } from '@tanstack/react-query';

import { buildBestSellerProducts, buildRecommendationProducts } from '../home-merchandising';
import {
    PUBLIC_QUERY_GC_TIME,
    PUBLIC_QUERY_STALE_TIME,
    publicQueryMeta,
    storefrontQueryKeys,
} from '../query-client';
import { useProductsByIdsQuery } from '../route-queries';
import type { RouteState } from '../storefront-router';
import { contentNumberSetting, contentStringArraySetting } from '../storefront-utils';
import {
    ActiveCustomer,
    Product,
    type StorefrontContentBlock,
    type StorefrontContentBlockType,
} from '../types';

import { type StorefrontQueryContext } from './storefront-query-context';
import { usePageLoadProductOrder } from './usePageLoadProductOrder';
export function useStorefrontMerchandising({
    api,
    market,
    language,
    vendureLanguageCode,
    storefrontContextResolved,
    customer,
    recentProductIds,
    personalizationReady = true,
    products,
    contentBlocks,
    configuredBlockTypes,
    activeRoute,
    contentReady,
}: StorefrontQueryContext & {
    customer: ActiveCustomer | null;
    recentProductIds: string[];
    personalizationReady?: boolean;
    products: Product[];
    contentBlocks: StorefrontContentBlock[];
    configuredBlockTypes: StorefrontContentBlockType[];
    activeRoute: RouteState['name'];
    contentReady: boolean;
}) {
    const bestSellersBlock = contentBlocks.find(block => block.type === 'BEST_SELLERS');

    const recommendationsBlock = contentBlocks.find(block => block.type === 'RECOMMENDATIONS');
    const displayCount = (block: StorefrontContentBlock | undefined, fallback: number) =>
        Math.min(50, Math.max(1, contentNumberSetting(block?.settings?.displayCount, fallback)));

    const pinnedBestSellerIds = contentStringArraySetting(bestSellersBlock?.settings?.pinnedProductIds);

    const bestSellerDisplayCount = displayCount(bestSellersBlock, 4);
    const recommendationDisplayCount = displayCount(recommendationsBlock, 6);

    const showBestSellers = Boolean(bestSellersBlock) || !configuredBlockTypes.includes('BEST_SELLERS');

    const showRecommendations =
        Boolean(recommendationsBlock) || !configuredBlockTypes.includes('RECOMMENDATIONS');
    const homeContentReady = activeRoute === 'home' && contentReady;
    const recommendationsReady =
        (activeRoute === 'home' || activeRoute === 'recommendations') && contentReady;
    const bestSellersEnabled = storefrontContextResolved && homeContentReady && showBestSellers;
    const recommendationsEnabled = storefrontContextResolved && recommendationsReady && showRecommendations;

    // Keep enough variety for configured sections without loading the previous
    // 48-product ceiling on every home visit. Larger managed sections still
    // scale up to the existing API limit.
    const bestSellerCandidateCount = Math.min(48, Math.max(16, bestSellerDisplayCount));
    const recommendationCandidateCount = Math.min(48, Math.max(16, recommendationDisplayCount * 2));

    const marketCode = storefrontQueryKeys.market(market);
    const publicOptions = {
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        meta: publicQueryMeta(),
    };
    const catalogOptions = (
        purpose: string,
        sort: 'sales' | 'recommended',
        take: number,
        enabled: boolean,
    ) => ({
        ...publicOptions,
        queryKey: storefrontQueryKeys.catalog(marketCode, vendureLanguageCode, { purpose, sort, take }),
        queryFn: ({ signal }: { signal: AbortSignal }) => api.catalog({ sort, take }, signal),
        enabled,
    });
    const bestSellerCatalogQuery = useQuery(
        catalogOptions('home-best-sellers', 'sales', bestSellerCandidateCount, bestSellersEnabled),
    );

    const bestSellerCandidates = bestSellerCatalogQuery.data?.items ?? products;

    const bestSellerSalesQuery = useQuery({
        queryKey: [
            ...storefrontQueryKeys.scope(marketCode, vendureLanguageCode),
            'home-best-seller-sales',
            bestSellerCandidates.map(product => product.id),
        ],
        queryFn: ({ signal }) =>
            api.productSales(
                bestSellerCandidates.map(product => product.id),
                signal,
            ),
        enabled: bestSellersEnabled && !bestSellerCatalogQuery.isPending && bestSellerCandidates.length > 0,
        ...publicOptions,
    });

    const pinnedBestSellerQuery = useProductsByIdsQuery({
        api,
        productIds: homeContentReady ? pinnedBestSellerIds : [],
        market,
        language,
    });

    const purchaseSourceIds = (customer?.orders.items ?? []).flatMap(order =>
        order.lines.map(line => line.productVariant.product.id),
    );

    const personalizationSourceIds = Array.from(new Set([...purchaseSourceIds, ...recentProductIds]));

    const personalizationSourceQuery = useProductsByIdsQuery({
        api,
        productIds: recommendationsReady ? personalizationSourceIds : [],
        market,
        language,
    });

    const recommendationCatalogQuery = useQuery(
        catalogOptions(
            'home-recommendations',
            'recommended',
            recommendationCandidateCount,
            recommendationsEnabled,
        ),
    );

    const recommendationCandidates = recommendationCatalogQuery.data?.items ?? products;

    const day = new Date().toISOString().slice(0, 10);
    const bestSellerProducts = buildBestSellerProducts({
        pinnedProducts: pinnedBestSellerQuery.data ?? [],
        candidates: bestSellerCandidates,
        salesByProductId: bestSellerSalesQuery.data ?? {},
        count: bestSellerDisplayCount,
        seed: `${market.code}:${day}:best-sellers`,
    });

    // Do not publish the bootstrap catalog as a finished merchandising section. The
    // ranked catalog, pinned products and sales arrive separately and would otherwise
    // replace visible cards (and add rows) several times during the first render.
    // Cached data stays usable during background refreshes; paused/failed requests
    // retain the existing fallback products instead of leaving a permanent skeleton.
    const bestSellersLoading =
        bestSellersEnabled &&
        (bestSellerCatalogQuery.isLoading ||
            bestSellerSalesQuery.isLoading ||
            pinnedBestSellerQuery.isLoading);
    const recommendationsLoading =
        recommendationsEnabled &&
        (!personalizationReady ||
            recommendationCatalogQuery.isLoading ||
            personalizationSourceQuery.isLoading);
    const scope = JSON.stringify([marketCode, vendureLanguageCode]);
    const bestSellers = usePageLoadProductOrder({
        scope,
        kind: 'best-sellers',
        ready: bestSellersEnabled && !bestSellersLoading,
        candidates: bestSellerCandidates,
        select: () => bestSellerProducts,
    });
    const recommendations = usePageLoadProductOrder({
        scope,
        kind: 'personalized',
        ready: recommendationsEnabled && !recommendationsLoading,
        candidates: recommendationCandidates,
        select: () =>
            buildRecommendationProducts({
                candidates: recommendationCandidates,
                sourceProducts: personalizationSourceQuery.data ?? [],
                purchaseSourceIds,
                recentProductIds,
                count: recommendationDisplayCount,
                seed: `${market.code}:${day}:recommendations`,
            }),
    });
    return {
        bestSellerProducts: bestSellers.products,
        recommendationProducts: recommendations.products,
        recommendationsBlock,
        bestSellersLoading: bestSellersEnabled && bestSellers.loading,
        recommendationsLoading: recommendationsEnabled && recommendations.loading,
    };
}
