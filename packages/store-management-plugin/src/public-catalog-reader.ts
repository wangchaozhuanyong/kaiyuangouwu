import type { PublicProductSummary, RequestContext } from '@vendure/core';
import type { PublicPageCatalogInput } from '@vendure/storefront-content-plugin';

/** Registered by the catalog plugin; no circular dependency on its implementation. */
export const PUBLIC_CATALOG_READER = Symbol.for('vendure.public-catalog-reader');
export interface PublicCatalogReader {
    find(
        ctx: RequestContext,
        input: PublicPageCatalogInput,
    ): Promise<{ items: PublicProductSummary[]; totalItems: number }>;
}
