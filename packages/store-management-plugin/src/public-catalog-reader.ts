import type { PublicProductSummary, PublicProductSummaryAsset, RequestContext } from '@vendure/core';
import type { PublicPageCatalogInput } from '@vendure/storefront-content-plugin';

/** Registered by the catalog plugin; no circular dependency on its implementation. */
export const PUBLIC_CATALOG_READER = Symbol.for('vendure.public-catalog-reader');
export interface PublicCatalogReader {
    find(
        ctx: RequestContext,
        input: PublicPageCatalogInput,
    ): Promise<{ items: PublicProductSummary[]; totalItems: number }>;
    sales(ctx: RequestContext, productIds: string[]): Promise<Record<string, number>>;
}

/** Optional artwork capability on the existing summary adapter; no additional registration. */
export interface PublicProductMediaReader {
    mediaById(ctx: RequestContext, id: string): Promise<PublicProductMedia | null>;
}

/** Artwork only; never includes prices, inventory, coupons or customer data. */
export interface PublicProductMedia {
    id: string;
    featuredAsset: PublicProductSummaryAsset | null;
    variants: Array<{
        featuredAsset: PublicProductSummaryAsset | null;
        product: { featuredAsset: PublicProductSummaryAsset | null };
    }>;
}
