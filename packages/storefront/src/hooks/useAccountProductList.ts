import { useEffect, useRef } from 'react';

import { storefrontInitialQueryError } from '../loading-state';
import { useProductsByIdsQuery } from '../route-queries';
import { Product } from '../types';

type ProductListOptions = Parameters<typeof useProductsByIdsQuery>[0];

/** Local display continuity only: never seed a partial response into the shared query cache. */
export function useAccountProductList(options: ProductListOptions) {
    const { api, productIds, market, language } = options;
    const query = useProductsByIdsQuery(options);
    const confirmed = useRef<
        | (Omit<ProductListOptions, 'productIds' | 'market'> & {
              marketCode: string;
              currencyCode: string;
              products: Product[];
          })
        | null
    >(null);
    const previous = confirmed.current;
    const sameScope =
        previous?.api === api &&
        previous.marketCode === market.code &&
        previous.currencyCode === market.currencyCode &&
        previous.language === language;

    useEffect(() => {
        if (!productIds.length || !sameScope) confirmed.current = null;
        if (productIds.length && query.data !== undefined) {
            confirmed.current = {
                api,
                marketCode: market.code,
                currencyCode: market.currencyCode,
                language,
                products: query.data,
            };
        }
    }, [api, market.code, market.currencyCode, language, productIds.length, query.data, sameScope]);

    // A resolved [] is authoritative. Removed IDs disappear immediately, including during errors.
    const source = query.data ?? (sameScope ? previous.products : []);
    const products = productIds
        .map(id => source.find(product => product.id === id))
        .filter((product): product is Product => product !== undefined);
    // A new key has no shared data yet, so its failure needs local feedback even with retained cards.
    // Confirmed same-key refresh failures remain owned by StorefrontQueryFeedback.
    const error = storefrontInitialQueryError(query, language);
    return { query, products, error };
}
