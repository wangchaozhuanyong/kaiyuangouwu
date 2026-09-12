import { useQuery } from '@tanstack/react-query';

import { buildBestSellerProducts, buildRecommendationProducts } from '../home-merchandising';
import {
    PUBLIC_QUERY_GC_TIME,
    PUBLIC_QUERY_STALE_TIME,
    publicQueryMeta,
    storefrontQueryKeys,
} from '../query-client';
import { useProductsByIdsQuery } from '../route-queries';
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
    catalogAccessGranted,
    customer,
    recentProductIds,
    products,
    contentBlocks,
    configuredBlockTypes,
}: StorefrontQueryContext & {
    customer: ActiveCustomer | null;
    recentProductIds: string[];
    products: Product[];
    contentBlocks: StorefrontContentBlock[];
    configuredBlockTypes: StorefrontContentBlockType[];
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
        enabled: storefrontContextResolved && catalogAccessGranted && showBestSellers,
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
            catalogAccessGranted &&
            showBestSellers &&
            !bestSellerCatalogQuery.isPending &&
            bestSellerCandidates.length > 0,
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        meta: publicQueryMeta(),
    });

    const pinnedBestSellerQuery = useProductsByIdsQuery({
        api,
        productIds: catalogAccessGranted ? pinnedBestSellerIds : [],
        market,
        language,
    });

    const purchaseSourceIds = Array.from(
        new Set(
            (customer?.orders.items ?? []).flatMap(order =>
                order.lines.map(line => line.productVariant.product.id),
            ),
        ),
    );

    const personalizationSourceIds = Array.from(new Set([...purchaseSourceIds, ...recentProductIds]));

    const personalizationSourceQuery = useProductsByIdsQuery({
        api,
        productIds: catalogAccessGranted ? personalizationSourceIds : [],
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
        enabled: storefrontContextResolved && catalogAccessGranted && showRecommendations,
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        meta: publicQueryMeta(),
    });

    const recommendationCandidates = recommendationCatalogQuery.data?.items ?? products;

    const bestSellerProducts = buildBestSellerProducts({
        pinnedProducts: pinnedBestSellerQuery.data ?? [],
        candidates: bestSellerCandidates,
        salesByProductId: bestSellerSalesQuery.data ?? {},
        count: bestSellerDisplayCount,
        seed: `${market.code}:${new Date().toISOString().slice(0, 10)}:best-sellers`,
    });

    const recommendationProducts = buildRecommendationProducts({
        candidates: recommendationCandidates,
        sourceProducts: personalizationSourceQuery.data ?? [],
        purchaseSourceIds,
        recentProductIds,
        count: recommendationDisplayCount,
        seed: `${market.code}:${new Date().toISOString().slice(0, 10)}:recommendations`,
    });
    return { bestSellerProducts, recommendationProducts, recommendationsBlock };
}
