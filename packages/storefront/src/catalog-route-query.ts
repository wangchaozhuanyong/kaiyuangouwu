import { priceInputToMinorUnits } from './catalog-page-utils';
import { RouteState } from './storefront-router';
import { StorefrontCatalogInput } from './types';

export type CatalogRouteState = Pick<
    RouteState,
    'collectionId' | 'childId' | 'sort' | 'fulfillment' | 'inStockOnly' | 'minPrice' | 'maxPrice'
>;

export function catalogRouteState(route: RouteState): Required<CatalogRouteState> {
    return {
        collectionId: route.collectionId ?? 'all',
        childId: route.childId ?? 'all',
        sort: route.sort ?? 'recommended',
        fulfillment: route.fulfillment ?? 'all',
        inStockOnly: route.inStockOnly === true,
        minPrice: route.minPrice ?? '',
        maxPrice: route.maxPrice ?? '',
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
    };
}

export function catalogRouteWithChanges(route: RouteState, changes: Partial<RouteState> = {}): RouteState {
    const state = catalogRouteState(route);
    return {
        name: route.name === 'search' ? 'search' : 'category',
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
    };
}
