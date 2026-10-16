// organize-imports-ignore
import type {
    CollectionSummary,
    MarketConfig,
    Product,
    StorefrontCatalogInput,
    StorefrontLanguage,
} from './types';
import { notifyManager, useQueryClient } from '@tanstack/react-query';
import { useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';

import {
    boundedMediaPreviews,
    type MediaDescriptor,
} from '../../storefront-content-plugin/src/shared/responsive-image';

import { publicCatalogRequest } from './catalog-route-query';
import { languageCodeFor } from './i18n';
import { productImage } from './product-media';
import { publicPageReadGeneration, watchPublicPageReadGeneration } from './public-page-transport';
import { isStorefrontScopeAccessDenied, storefrontQueryKeys } from './query-client';
import { imageSources } from './responsive-image';
import { SafeImageMediaContext, type BorrowedPublicMedia } from './safe-image';
import { publicMediaOrigin, publicSeoQueryKey } from './storefront-page-data';

/** Observe only the exact catalog reads whose products are currently displayed. Never starts a read. */
export function usePublicCatalogMedia({
    market,
    language,
    catalogs,
    collections = [],
}: {
    market: MarketConfig;
    language: StorefrontLanguage;
    collections?: CollectionSummary[];
    catalogs: Array<{
        input: StorefrontCatalogInput;
        pathname: string;
        scope?: 'route' | 'store';
        products: Product[];
    }>;
}): BorrowedPublicMedia {
    const client = useQueryClient();
    const cache = client.getQueryCache();
    const marketCode = storefrontQueryKeys.market(market);
    const languageCode = languageCodeFor(language);
    const keys = catalogs.map(catalog =>
        publicSeoQueryKey(
            marketCode,
            languageCode,
            publicCatalogRequest(catalog.input, catalog.pathname, catalog.scope),
            'public-media',
            collections,
        ),
    );
    const subscribe = useCallback(
        (notify: () => void) => {
            const update = notifyManager.batchCalls(notify);
            const stopCache = cache.subscribe(update);
            const stopGeneration = watchPublicPageReadGeneration(update);
            return () => {
                stopCache();
                stopGeneration();
            };
        },
        [cache],
    );
    const snapshot = () =>
        [
            publicPageReadGeneration(),
            ...keys.map(key => {
                const state = client.getQueryState(key);
                return state
                    ? [
                          state.dataUpdatedAt,
                          state.dataUpdateCount,
                          state.errorUpdatedAt,
                          state.status,
                          state.isInvalidated,
                      ].join(':')
                    : 'missing';
            }),
        ].join('|');
    useSyncExternalStore(subscribe, snapshot, snapshot);
    const media = new Map<string, MediaDescriptor>();
    if (!isStorefrontScopeAccessDenied(client, { marketCode, languageCode }))
        catalogs.forEach((catalog, index) => {
            const state = client.getQueryState(keys[index]);
            const descriptors = client.getQueryData<MediaDescriptor[]>(keys[index]);
            if (
                !descriptors ||
                state?.status !== 'success' ||
                state.isInvalidated ||
                !currentMedia(descriptors, marketCode, languageCode)
            )
                return;
            const displayed = new Set(
                catalog.products.flatMap(product => {
                    if (!currentMedia(descriptors, marketCode, languageCode, product)) return [];
                    const source = productImage(product);
                    return source ? [imageSources(source).identity] : [];
                }),
            );
            for (const descriptor of descriptors) {
                if (descriptor.kind !== 'card' && descriptor.kind !== 'thumbnail') continue;
                const identity = imageSources(descriptor.identity).identity;
                if (!displayed.has(identity)) continue;
                const key = JSON.stringify([identity, descriptor.kind, descriptor.version]);
                if (!media.has(key)) media.set(key, descriptor);
            }
        });
    return { media: [...media.values()], generation: publicPageReadGeneration() };
}

function currentMedia(
    media: readonly MediaDescriptor[],
    market: string,
    language: string,
    product?: Product,
) {
    const origin = publicMediaOrigin(media);
    if (!origin) return false;
    const [generation, scope, mode, products] = origin;
    const source = product && products.get(product.id);
    return (
        generation === publicPageReadGeneration() &&
        `${scope.channelCode}:${scope.currencyCode}` === market &&
        scope.languageCode === language &&
        mode === 'LIVE' &&
        (!product ||
            Boolean(
                source &&
                imageSources(source).identity === imageSources(productImage(product) ?? '').identity,
            )) &&
        typeof window !== 'undefined' &&
        scope.host === window.location.host
    );
}

export function merchandisingMediaCatalogs(
    takes: { sales: number; recommended: number },
    best: Product[],
    recommended: Product[],
    home: boolean,
) {
    return [
        ...(home
            ? [
                  {
                      input: { sort: 'sales' as const, take: takes.sales },
                      pathname: '/category',
                      scope: 'store' as const,
                      products: best,
                  },
              ]
            : []),
        {
            input: { sort: 'recommended' as const, take: takes.recommended },
            pathname: '/category',
            scope: 'store' as const,
            products: recommended,
        },
    ];
}

/** Extend only this route's image presentation; primary hints and their missing previews win. */
export function CatalogImageMediaProvider({
    borrowed,
    children,
}: {
    borrowed: BorrowedPublicMedia;
    children: ReactNode;
}) {
    const parent = useContext(SafeImageMediaContext);
    const value = useMemo(() => {
        const sources = new Set(parent.sources);
        const previews = new Map(parent.previews);
        const borrowedSources = new Set<string>();
        for (const descriptor of boundedMediaPreviews(borrowed.media)) {
            if (imageSources(descriptor.identity).version !== descriptor.version) continue;
            const key = `${imageSources(descriptor.identity).identity}\u0000${descriptor.kind ?? ''}`;
            if (sources.has(key)) continue;
            sources.add(key);
            borrowedSources.add(key);
            if (descriptor.placeholder) previews.set(key, descriptor.placeholder.inlineData);
        }
        return {
            scope: parent.scope,
            sources,
            previews,
            borrowedSources,
            borrowedGeneration: borrowed.generation,
        };
    }, [parent, borrowed]);
    return <SafeImageMediaContext.Provider value={value}>{children}</SafeImageMediaContext.Provider>;
}

/** Route-local observation, unsubscribed with the route; never a second server-data cache. */
export function PublicCatalogMediaProvider({
    children,
    ...props
}: Parameters<typeof usePublicCatalogMedia>[0] & { children: ReactNode }) {
    const borrowed = usePublicCatalogMedia(props);
    return <CatalogImageMediaProvider borrowed={borrowed}>{children}</CatalogImageMediaProvider>;
}
