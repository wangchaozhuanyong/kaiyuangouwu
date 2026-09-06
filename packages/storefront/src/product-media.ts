import { Asset, Product } from './types';

type ProductMedia = Pick<Product, 'featuredAsset' | 'assets'>;

/** Vendure's featured asset is the cover; gallery order only applies to the remaining images. */
export function productGalleryAssets(product?: ProductMedia | null): Asset[] {
    const assets: Asset[] = [];
    const seen = new Set<string>();
    for (const asset of [product?.featuredAsset, ...(product?.assets ?? [])]) {
        if (!asset?.preview || seen.has(asset.id)) continue;
        seen.add(asset.id);
        assets.push(asset);
    }
    return assets;
}

export function productImage(product?: ProductMedia | null): string | null {
    return productGalleryAssets(product)[0]?.preview ?? null;
}
