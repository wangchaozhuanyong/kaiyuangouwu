/* eslint-disable import/order -- prettier-plugin-organize-imports places type-only imports after runtime imports. */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

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
export function useStorefrontMerchandising({
    api,
    market,
    language,
    vendureLanguageCode,
    storefrontContextResolved,
    customer,
    recentProductIds,
    products,
    contentBlocks,
    configuredBlockTypes,
    activeRoute,
    contentReady,
}: StorefrontQueryContext & {
    customer: ActiveCustomer | null;
    recentProductIds: string[];
    products: Product[];
    contentBlocks: StorefrontContentBlock[];
    configuredBlockTypes: StorefrontContentBlockType[];
    activeRoute: RouteState['name'];
    contentReady: boolean;
}) {
    const bestSellersBlock = contentBlocks.find(block => block.type === 'BEST_SELLERS');

    const recommendationsBlock = contentBlocks.find(block => block.type === 'RECOMMENDATIONS');

    const pinnedBestSellerIds = contentStringArraySetting(bestSellersBlock?.settings?.pinnedProductIds);

    const bestSellerDisplayCount = Math.min(
        50,
        Math.max(1, contentNumberSetting(bestSellersBlock?.settings?.displayCount, 4)),
    );

    const recommendationDisplayCount = Math.min(
        50,
        Math.max(1, contentNumberSetting(recommendationsBlock?.settings?.displayCount, 6)),
    );

    const showBestSellers = Boolean(bestSellersBlock) || !configuredBlockTypes.includes('BEST_SELLERS');

    const showRecommendations =
        Boolean(recommendationsBlock) || !configuredBlockTypes.includes('RECOMMENDATIONS');
    const homeContentReady = activeRoute === 'home' && contentReady;
    const recommendationsReady =
        (activeRoute === 'home' || activeRoute === 'recommendations') && contentReady;

    // Keep enough variety for configured sections without loading the previous
    // 48-product ceiling on every home visit. Larger managed sections still
    // scale up to the existing API limit.
    const bestSellerCandidateCount = Math.min(48, Math.max(16, bestSellerDisplayCount));
    const recommendationCandidateCount = Math.min(48, Math.max(16, recommendationDisplayCount * 2));

    const bestSellerCatalogQuery = useQuery({
        queryKey: storefrontQueryKeys.catalog(storefrontQueryKeys.market(market), vendureLanguageCode, {
            purpose: 'home-best-sellers',
            sort: 'sales',
            take: bestSellerCandidateCount,
        }),
        queryFn: ({ signal }) => api.catalog({ sort: 'sales', take: bestSellerCandidateCount }, signal),
        enabled: storefrontContextResolved && homeContentReady && showBestSellers,
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        meta: publicQueryMeta(),
    });

    const bestSellerCandidates = bestSellerCatalogQuery.data?.items ?? products;

    const bestSellerSalesQuery = useQuery({
        queryKey: [
            ...storefrontQueryKeys.scope(storefrontQueryKeys.market(market), vendureLanguageCode),
            'home-best-seller-sales',
            bestSellerCandidates.map(product => product.id),
        ],
        queryFn: () => api.productSales(bestSellerCandidates.map(product => product.id)),
        enabled:
            storefrontContextResolved &&
            homeContentReady &&
            showBestSellers &&
            !bestSellerCatalogQuery.isPending &&
            bestSellerCandidates.length > 0,
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        meta: publicQueryMeta(),
    });

    const pinnedBestSellerQuery = useProductsByIdsQuery({
        api,
        productIds: homeContentReady ? pinnedBestSellerIds : [],
        market,
        language,
    });

    const purchaseSourceIds = useMemo(
        () =>
            Array.from(
                new Set(
                    (customer?.orders.items ?? []).flatMap(order =>
                        order.lines.map(line => line.productVariant.product.id),
                    ),
                ),
            ),
        [customer],
    );

    const personalizationSourceIds = Array.from(new Set([...purchaseSourceIds, ...recentProductIds]));

    const personalizationSourceQuery = useProductsByIdsQuery({
        api,
        productIds: recommendationsReady ? personalizationSourceIds : [],
        market,
        language,
    });

    const recommendationCatalogQuery = useQuery({
        queryKey: storefrontQueryKeys.catalog(storefrontQueryKeys.market(market), vendureLanguageCode, {
            purpose: 'home-recommendations',
            sort: 'recommended',
            take: recommendationCandidateCount,
        }),
        queryFn: ({ signal }) =>
            api.catalog({ sort: 'recommended', take: recommendationCandidateCount }, signal),
        enabled: storefrontContextResolved && recommendationsReady && showRecommendations,
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        meta: publicQueryMeta(),
    });

    const recommendationCandidates = recommendationCatalogQuery.data?.items ?? products;

    const day = new Date().toISOString().slice(0, 10);
    const bestSellerProducts = useMemo(
        () =>
            buildBestSellerProducts({
                pinnedProducts: pinnedBestSellerQuery.data ?? [],
                candidates: bestSellerCandidates,
                salesByProductId: bestSellerSalesQuery.data ?? {},
                count: bestSellerDisplayCount,
                seed: `${market.code}:${day}:best-sellers`,
            }),
        [
            pinnedBestSellerQuery.data,
            bestSellerCandidates,
            bestSellerSalesQuery.data,
            bestSellerDisplayCount,
            market.code,
            day,
        ],
    );

    const recommendationProducts = useMemo(
        () =>
            buildRecommendationProducts({
                candidates: recommendationCandidates,
                sourceProducts: personalizationSourceQuery.data ?? [],
                purchaseSourceIds,
                recentProductIds,
                count: recommendationDisplayCount,
                seed: `${market.code}:${day}:recommendations`,
            }),
        [
            recommendationCandidates,
            personalizationSourceQuery.data,
            purchaseSourceIds,
            recentProductIds,
            recommendationDisplayCount,
            market.code,
            day,
        ],
    );
    // Do not publish the bootstrap catalog as a finished merchandising section. The
    // ranked catalog, pinned products and sales arrive separately and would otherwise
    // replace visible cards (and add rows) several times during the first render.
    // Cached data stays usable during background refreshes; paused/failed requests
    // retain the existing fallback products instead of leaving a permanent skeleton.
    const bestSellersLoading =
        homeContentReady &&
        showBestSellers &&
        (bestSellerCatalogQuery.isLoading ||
            bestSellerSalesQuery.isLoading ||
            pinnedBestSellerQuery.isLoading);
    const recommendationsLoading =
        recommendationsReady &&
        showRecommendations &&
        (recommendationCatalogQuery.isLoading || personalizationSourceQuery.isLoading);
    const scope = JSON.stringify([storefrontQueryKeys.market(market), vendureLanguageCode]);
    const bestSellers = useSettledProducts(bestSellerProducts, bestSellersLoading, scope, homeContentReady);
    const recommendations = useSettledProducts(
        recommendationProducts,
        recommendationsLoading,
        scope,
        recommendationsReady,
    );
    return {
        bestSellerProducts: bestSellers.products,
        recommendationProducts: activeRoute === 'home' ? recommendations.products : recommendationProducts,
        recommendationsBlock,
        bestSellersLoading: bestSellers.loading,
        recommendationsLoading: recommendations.loading,
    };
}

// A refreshed catalog can introduce a new sales-query key. Keep the last complete
// section visible while those new dependencies settle, including an empty result.
function useSettledProducts(products: Product[], pending: boolean, scope: string, enabled: boolean) {
    const [settled, setSettled] = useState<{ scope: string; products: Product[] }>();
    useEffect(() => {
        if (enabled && !pending)
            setSettled(current =>
                current?.scope === scope &&
                current.products.length === products.length &&
                current.products.every((product, index) => product === products[index])
                    ? current
                    : { scope, products },
            );
    }, [enabled, pending, products, scope]);
    const previous = settled?.scope === scope ? settled : undefined;
    return {
        products: pending ? (previous?.products ?? []) : products,
        loading: pending && !previous,
    };
}
