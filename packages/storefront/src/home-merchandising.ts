import { Product, StorefrontContentTargetType } from './types';

export function buildBestSellerProducts({
    pinnedProducts,
    candidates,
    salesByProductId,
    count,
    seed,
}: {
    pinnedProducts: Product[];
    candidates: Product[];
    salesByProductId: Record<string, number>;
    count: number;
    seed: string;
}): Product[] {
    const hasSales = candidates.some(product => (salesByProductId[product.id] ?? 0) > 0);
    const organic = hasSales
        ? [...candidates].sort((first, second) => {
              const difference = (salesByProductId[second.id] ?? 0) - (salesByProductId[first.id] ?? 0);
              return difference || stableScore(first.id, seed) - stableScore(second.id, seed);
          })
        : stableShuffle(candidates, seed);
    return uniqueProducts([...pinnedProducts, ...organic]).slice(0, normalizeCount(count));
}

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

function stableShuffle(products: Product[], seed: string): Product[] {
    return [...products].sort((first, second) => stableScore(first.id, seed) - stableScore(second.id, seed));
}

function stableScore(value: string, seed: string): number {
    let hash = 0;
    for (const character of `${seed}:${value}`) {
        hash = (Math.imul(hash, 31) + character.charCodeAt(0)) % 2_147_483_647;
    }
    return hash;
}

function uniqueProducts(products: Product[]): Product[] {
    const seen = new Set<string>();
    return products.filter(product => {
        if (seen.has(product.id)) return false;
        seen.add(product.id);
        return true;
    });
}

function normalizeCount(count: number): number {
    return Number.isFinite(count) ? Math.max(1, Math.trunc(count)) : 1;
}
