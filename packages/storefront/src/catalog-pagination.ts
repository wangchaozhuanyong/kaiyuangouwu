import { ProductSearchPage } from './types';

export class CatalogPaginationError extends Error {}

export function validateCatalogPage(
    page: ProductSearchPage,
    offset: number,
    previousIds: Set<string>,
    message: string,
) {
    if (
        (page.items.length === 0 && page.totalItems > offset) ||
        (page.items.length > 0 && page.items.every(item => previousIds.has(item.id)))
    ) {
        throw new CatalogPaginationError(message);
    }
    return page;
}

export function nextCatalogPageParam(page: ProductSearchPage, _pages: ProductSearchPage[], offset: number) {
    const next = offset + page.items.length;
    return page.items.length > 0 && next < page.totalItems ? next : undefined;
}
