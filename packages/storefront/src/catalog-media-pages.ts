import { STOREFRONT_CATALOG_PAGE_SIZE } from './query-client';
import { ProductSearchPage, StorefrontCatalogInput } from './types';

/** Match displayed pages to their existing public media reads without adding a cache or request. */
export function paginatedMediaCatalogs(
    input: StorefrontCatalogInput,
    data: { pages: ProductSearchPage[]; pageParams: unknown[] } | undefined,
    pathname: '/category' | '/search',
) {
    if (!data) return [];
    return data.pages.flatMap((page, index) => {
        const skip = data.pageParams[index];
        if (typeof skip !== 'number' || !Number.isSafeInteger(skip) || skip < 0) return [];
        return [
            {
                input: { ...input, skip, take: STOREFRONT_CATALOG_PAGE_SIZE },
                pathname,
                products: page.items,
            },
        ];
    });
}
