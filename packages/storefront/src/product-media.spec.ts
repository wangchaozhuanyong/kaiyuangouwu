import { describe, expect, it } from 'vitest';

import { productGalleryAssets, productImage } from './product-media';

const cover = { id: 'cover', preview: '/assets/preview/cover.png' };
const detail = { id: 'detail', preview: '/assets/preview/detail.png' };
const alternate = { id: 'alternate', preview: '/assets/preview/alternate.png' };

describe('Vendure product media', () => {
    it('uses the featured asset first even when it is later in the gallery, preserving other image order', () => {
        const product = { featuredAsset: cover, assets: [detail, cover, alternate] };
        const originalAssets = [...product.assets];

        expect(productGalleryAssets(product)).toEqual([cover, detail, alternate]);
        expect(productImage(product)).toBe(cover.preview);
        expect(product.assets).toEqual(originalAssets);
    });

    it('includes a featured asset that is managed separately from the gallery', () => {
        expect(productGalleryAssets({ featuredAsset: cover, assets: [detail] })).toEqual([cover, detail]);
        expect(productGalleryAssets({ featuredAsset: cover, assets: [] })).toEqual([cover]);
    });

    it('deduplicates by Vendure asset identity and prefers current featured asset data', () => {
        const product = {
            featuredAsset: cover,
            assets: [{ ...cover, preview: '/assets/preview/previous.png' }, detail, detail],
        };
        expect(productGalleryAssets(product)).toEqual([cover, detail]);
    });

    it('falls back to the gallery when the cover is removed or has no preview', () => {
        for (const featuredAsset of [null, { ...cover, preview: '' }]) {
            const product = { featuredAsset, assets: [detail, alternate] };
            expect(productGalleryAssets(product)).toEqual([detail, alternate]);
            expect(productImage(product)).toBe(detail.preview);
        }
    });

    it('reflects a changed cover without requiring the merchant to reorder the gallery', () => {
        const product = { featuredAsset: cover, assets: [detail, cover, alternate] };
        const updated = { ...product, featuredAsset: alternate };
        expect(productImage(updated)).toBe(alternate.preview);
        expect(productGalleryAssets(updated)).toEqual([alternate, detail, cover]);
    });

    it('supports empty and unavailable products without inventing a managed image', () => {
        for (const product of [null, undefined, { featuredAsset: null, assets: [] }]) {
            expect(productGalleryAssets(product)).toEqual([]);
            expect(productImage(product)).toBeNull();
        }
    });
});
