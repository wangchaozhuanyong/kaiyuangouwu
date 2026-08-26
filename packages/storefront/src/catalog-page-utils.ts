import { SortMode } from './storefront-router';
import { Product } from './types';

export function minimumProductPrice(product: Product): number {
    return Math.min(...product.variants.map(variant => variant.priceWithTax), Number.MAX_SAFE_INTEGER);
}

export function sortCategoryProducts(
    products: Product[],
    sortMode: SortMode,
    locale: string,
    salesByProductId: Record<string, number> = {},
): Product[] {
    return [...products].sort((first, second) => {
        if (sortMode === 'sales') {
            const salesDifference = (salesByProductId[second.id] ?? 0) - (salesByProductId[first.id] ?? 0);
            if (salesDifference !== 0) return salesDifference;
            return Date.parse(second.createdAt) - Date.parse(first.createdAt);
        }
        if (sortMode === 'newest') return Date.parse(second.createdAt) - Date.parse(first.createdAt);
        if (sortMode === 'name') return first.name.localeCompare(second.name, locale);
        if (sortMode === 'price-asc') return minimumProductPrice(first) - minimumProductPrice(second);
        if (sortMode === 'price-desc') return minimumProductPrice(second) - minimumProductPrice(first);
        return 0;
    });
}

export function priceInputToMinorUnits(value: string): number | undefined {
    if (!value.trim()) return;
    const amount = Number(value);
    return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : undefined;
}
