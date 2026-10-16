import {
    normalizeCount,
    stableScore,
    stableShuffle,
    uniqueProducts,
} from '../../storefront-content-plugin/src/shared/home-merchandising';

import { Product, StorefrontContentTargetType } from './types';

export { buildBestSellerProducts } from '../../storefront-content-plugin/src/shared/home-merchandising';

export function buildRecommendationProducts({
    candidates,
    sourceProducts,
    purchaseSourceIds,
    recentProductIds,
    count,
    seed,
}: {
    candidates: Product[];
    sourceProducts: Product[];
    purchaseSourceIds: string[];
    recentProductIds: string[];
    count: number;
    seed: string;
}): Product[] {
    const purchaseIds = new Set(purchaseSourceIds);
    const recentIds = new Set(recentProductIds);
    const purchaseCollectionIds = collectionIdsFor(
        sourceProducts.filter(product => purchaseIds.has(product.id)),
    );
    const recentCollectionIds = collectionIdsFor(sourceProducts.filter(product => recentIds.has(product.id)));
    const sourceIds = new Set([...purchaseIds, ...recentIds]);
    const unseenCandidates = candidates.filter(product => !sourceIds.has(product.id));
    const ranked = [...unseenCandidates].sort((first, second) => {
        const difference =
            recommendationScore(second, purchaseCollectionIds, recentCollectionIds) -
            recommendationScore(first, purchaseCollectionIds, recentCollectionIds);
        return difference || stableScore(first.id, seed) - stableScore(second.id, seed);
    });
    const hasPreferenceSignal = purchaseCollectionIds.size > 0 || recentCollectionIds.size > 0;
    const primary = hasPreferenceSignal ? ranked : stableShuffle(unseenCandidates, seed);
    const fallback = stableShuffle(
        candidates.filter(product => sourceIds.has(product.id)),
        `${seed}:seen`,
    );
    return uniqueProducts([...primary, ...fallback]).slice(0, normalizeCount(count));
}

export function selectManagedProducts({
    productIds,
    products,
    count,
}: {
    productIds: string[];
    products: Product[];
    count: number;
}): Product[] {
    const productsById = new Map(products.map(product => [product.id, product]));
    return Array.from(new Set(productIds))
        .flatMap(productId => {
            const product = productsById.get(productId);
            return product ? [product] : [];
        })
        .slice(0, normalizeCount(count));
}

export function selectCategoryPromotionProducts({
    selectedProductIds,
    products,
    targetType,
    targetValue,
    count,
}: {
    selectedProductIds: string[];
    products: Product[];
    targetType: StorefrontContentTargetType;
    targetValue: string | null;
    count: number;
}): Product[] {
    const normalizedCount = Math.min(4, normalizeCount(count));
    const selectedProducts = selectManagedProducts({
        productIds: selectedProductIds,
        products,
        count: normalizedCount,
    });
    if (!targetValue || !['COLLECTION', 'CATEGORY'].includes(targetType)) {
        return selectedProducts;
    }

    const selectedIds = new Set(selectedProducts.map(product => product.id));
    const categoryProducts = products.filter(
        product =>
            !selectedIds.has(product.id) &&
            product.collections.some(collection => collection.id === targetValue),
    );
    return [...selectedProducts, ...categoryProducts].slice(0, normalizedCount);
}

function recommendationScore(
    product: Product,
    purchaseCollectionIds: Set<string>,
    recentCollectionIds: Set<string>,
): number {
    return product.collections.reduce(
        (score, collection) =>
            score +
            (purchaseCollectionIds.has(collection.id) ? 100 : 0) +
            (recentCollectionIds.has(collection.id) ? 10 : 0),
        0,
    );
}

function collectionIdsFor(products: Product[]): Set<string> {
    return new Set(products.flatMap(product => product.collections.map(collection => collection.id)));
}
