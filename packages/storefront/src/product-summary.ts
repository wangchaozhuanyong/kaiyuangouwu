import type { Product } from './types';

type ProductListSource = Omit<Product, 'description' | 'assets'> &
    Partial<Pick<Product, 'description' | 'assets'>>;

/** Existing card/editorial readers use this display excerpt; only detail requests own full bodies. */
export function asListProduct(product: ProductListSource): Product {
    return {
        ...product,
        description: product.description ?? product.descriptionSummary ?? '',
        assets: product.assets ?? [],
    };
}
