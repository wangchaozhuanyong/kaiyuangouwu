import type { Product, ProductVariant } from './types';

/** The storefront catalog sorts and filters products by their lowest variant price. */
export function lowestPricedProductVariant(product: Product): ProductVariant | null {
    let lowest: ProductVariant | null = null;
    for (const variant of product.variants) {
        if (!Number.isFinite(variant.priceWithTax) || variant.priceWithTax < 0) continue;
        if (!lowest || variant.priceWithTax < lowest.priceWithTax) lowest = variant;
    }
    return lowest;
}

export function minimumProductPrice(product: Product): number {
    return lowestPricedProductVariant(product)?.priceWithTax ?? Number.MAX_SAFE_INTEGER;
}
