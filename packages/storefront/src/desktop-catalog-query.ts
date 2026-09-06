import { priceInputToMinorUnits } from './catalog-page-utils';
import { RouteState } from './storefront-router';
import { StorefrontCatalogInput } from './types';

export function desktopCatalogRoute(route: RouteState, changes: Partial<RouteState> = {}): RouteState {
    // The shared navigator remembers category filters. Explicit fields let desktop
    // home/search controls start from their visible state and reliably reset it.
    return {
        name: route.name === 'search' ? 'search' : 'category',
        collectionId: route.collectionId ?? 'all',
        childId: route.childId ?? 'all',
        term: route.term,
        sort: route.sort ?? 'recommended',
        fulfillment: route.fulfillment ?? 'all',
        inStockOnly: route.inStockOnly === true,
        minPrice: route.minPrice,
        maxPrice: route.maxPrice,
        ...changes,
    };
}

export function desktopCatalogInput(route: RouteState): StorefrontCatalogInput {
    const collectionId = route.childId && route.childId !== 'all' ? route.childId : route.collectionId;
    return {
        collectionId: collectionId && collectionId !== 'all' ? collectionId : undefined,
        term: route.term?.trim() || undefined,
        sort: route.sort ?? 'recommended',
        fulfillmentType: route.fulfillment === 'all' ? undefined : route.fulfillment,
        inStockOnly: route.inStockOnly === true,
        minPriceWithTax: priceInputToMinorUnits(route.minPrice ?? ''),
        maxPriceWithTax: priceInputToMinorUnits(route.maxPrice ?? ''),
    };
}
