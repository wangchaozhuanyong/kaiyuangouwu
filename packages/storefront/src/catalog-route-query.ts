import {
    canonicalPublicPageRequest,
    type PublicPageRequest,
} from '../../storefront-content-plugin/src/shared/public-page-data';

import { priceInputToMinorUnits } from './catalog-page-utils';
import { STOREFRONT_CATALOG_PAGE_SIZE } from './query-client';
import { RouteState } from './storefront-router';
import { CollectionSummary, ProductSearchSort, StorefrontCatalogInput } from './types';

/** The API read and its media observer must address exactly the same public request. */
export function publicCatalogRequest(
    input: StorefrontCatalogInput,
    pathname = typeof window === 'undefined' ? '/category' : window.location.pathname,
    scope: 'route' | 'store' = 'route',
): Extract<PublicPageRequest, { kind: 'catalog' }> {
    const sorts: Record<
        ProductSearchSort,
        NonNullable<Extract<PublicPageRequest, { kind: 'catalog' }>['input']['sort']>
    > = {
        recommended: 'RECOMMENDED',
        sales: 'SALES',
        newest: 'NEWEST',
        name: 'NAME',
        'price-asc': 'PRICE_ASC',
        'price-desc': 'PRICE_DESC',
    };
    return canonicalPublicPageRequest({
        kind: 'catalog',
        // Search's existing public contract has no implicit navigation-category filter.
        path: scope === 'store' || /^(?:\/(?:zh|en))?\/search\/?$/u.test(pathname) ? '/search' : '/category',
        input: {
            ...input,
            sort: sorts[input.sort ?? 'recommended'],
            fulfillmentType: input.fulfillmentType?.toUpperCase() as 'PHYSICAL' | 'DIGITAL' | undefined,
        },
    }) as Extract<PublicPageRequest, { kind: 'catalog' }>;
}

export type CatalogRouteState = Pick<
    RouteState,
    'collectionId' | 'childId' | 'sort' | 'fulfillment' | 'inStockOnly' | 'minPrice' | 'maxPrice' | 'page'
>;

export function resolveCategoryRoute(route: RouteState, collections: CollectionSummary[]): RouteState {
    if (route.name !== 'category' || (route.collectionId && route.collectionId !== 'all')) return route;
    if (route.childId && route.childId !== 'all') {
        const parent = collections.find(collection =>
            collection.children?.some(child => child.id === route.childId),
        );
        return parent ? { ...route, collectionId: parent.id } : route;
    }
    const first = collections.find(collection => collection.id && collection.id !== 'all');
    return first ? { ...route, collectionId: first.id, childId: 'all' } : route;
}

export function catalogRouteState(route: RouteState): Required<CatalogRouteState> {
    return {
        collectionId: route.collectionId ?? 'all',
        childId: route.childId ?? 'all',
        sort: route.sort ?? 'recommended',
        fulfillment: route.fulfillment ?? 'all',
        inStockOnly: route.inStockOnly === true,
        minPrice: route.minPrice ?? '',
        maxPrice: route.maxPrice ?? '',
        page: route.page ?? 1,
    };
}

export function catalogRouteSearch(route: RouteState): CatalogRouteState {
    const state = catalogRouteState(route);
    return {
        collectionId: state.collectionId === 'all' ? undefined : state.collectionId,
        childId: state.childId === 'all' ? undefined : state.childId,
        sort: state.sort === 'recommended' ? undefined : state.sort,
        fulfillment: state.fulfillment === 'all' ? undefined : state.fulfillment,
        inStockOnly: state.inStockOnly || undefined,
        minPrice: state.minPrice || undefined,
        maxPrice: state.maxPrice || undefined,
        page: state.page > 1 ? state.page : undefined,
    };
}

export function catalogRouteWithChanges(route: RouteState, changes: Partial<RouteState> = {}): RouteState {
    const state = catalogRouteState(route);
    return {
        name: route.name === 'search' ? 'search' : 'category',
        publicLanguage: route.publicLanguage,
        page: changes.page,
        collectionId: state.collectionId,
        childId: state.childId,
        term: route.term,
        sort: state.sort,
        fulfillment: state.fulfillment,
        inStockOnly: state.inStockOnly,
        minPrice: state.minPrice || undefined,
        maxPrice: state.maxPrice || undefined,
        ...changes,
    };
}

export function catalogInputFromRoute(route: RouteState): StorefrontCatalogInput {
    const state = catalogRouteState(route);
    const collectionId = state.childId !== 'all' ? state.childId : state.collectionId;
    return {
        collectionId: collectionId !== 'all' ? collectionId : undefined,
        term: route.term?.trim() || undefined,
        sort: state.sort,
        fulfillmentType: state.fulfillment === 'all' ? undefined : state.fulfillment,
        inStockOnly: state.inStockOnly,
        minPriceWithTax: priceInputToMinorUnits(state.minPrice),
        maxPriceWithTax: priceInputToMinorUnits(state.maxPrice),
        ...(route.page && route.page > 1 ? { skip: (route.page - 1) * STOREFRONT_CATALOG_PAGE_SIZE } : {}),
    };
}
