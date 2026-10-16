export function buildBestSellerProducts<T extends { id: string }>({
    pinnedProducts,
    candidates,
    salesByProductId,
    count,
    seed,
}: {
    pinnedProducts: T[];
    candidates: T[];
    salesByProductId: Record<string, number>;
    count: number;
    seed: string;
}): T[] {
    const hasSales = candidates.some(product => (salesByProductId[product.id] ?? 0) > 0);
    const organic = hasSales
        ? [...candidates].sort((first, second) => {
              const difference = (salesByProductId[second.id] ?? 0) - (salesByProductId[first.id] ?? 0);
              return difference || stableScore(first.id, seed) - stableScore(second.id, seed);
          })
        : stableShuffle(candidates, seed);
    return uniqueProducts([...pinnedProducts, ...organic]).slice(0, normalizeCount(count));
}

export function stableShuffle<T extends { id: string }>(products: T[], seed: string): T[] {
    return [...products].sort((first, second) => stableScore(first.id, seed) - stableScore(second.id, seed));
}

export function stableScore(value: string, seed: string): number {
    let hash = 0;
    for (const character of `${seed}:${value}`) {
        hash = (Math.imul(hash, 31) + character.charCodeAt(0)) % 2_147_483_647;
    }
    return hash;
}

export function uniqueProducts<T extends { id: string }>(products: T[]): T[] {
    const seen = new Set<string>();
    return products.filter(product => {
        if (seen.has(product.id)) return false;
        seen.add(product.id);
        return true;
    });
}

export function normalizeCount(count: number): number {
    return Number.isFinite(count) ? Math.max(1, Math.trunc(count)) : 1;
}
