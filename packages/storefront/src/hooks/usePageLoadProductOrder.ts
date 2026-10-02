import { skipToken, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { Product } from '../types';

/** Freeze recommendations for this document; best sellers keep their last settled list while loading. */
export function usePageLoadProductOrder({
    scope,
    kind,
    ready,
    candidates,
    select,
}: {
    scope: string;
    kind: 'personalized' | 'daily' | 'best-sellers';
    ready: boolean;
    candidates: Product[];
    select: () => Product[];
}) {
    const client = useQueryClient();
    // Outside the API query namespace: realtime/auth cache invalidation must not
    // reset a visible selection. No persistence metadata: reload starts a new order.
    const queryKey = ['recommendation-order', scope, kind];
    const previous = client.getQueryData<Product[]>(queryKey);
    const fixed = kind !== 'best-sellers';
    const selection = fixed ? (previous ?? (ready ? select() : undefined)) : ready ? select() : previous;
    useEffect(() => {
        if (!selection || (fixed && previous)) return;
        client.setQueryDefaults(queryKey, { queryFn: skipToken, gcTime: Infinity });
        client.setQueryData(queryKey, selection);
    }, [client, queryKey, selection, fixed, previous]);

    return {
        products:
            selection?.map(product => candidates.find(candidate => candidate.id === product.id) ?? product) ??
            [],
        loading: !selection,
    };
}
