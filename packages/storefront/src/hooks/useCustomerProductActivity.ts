import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';

import { ShopApi } from '../api';
import { clearProductVisitTimes, readProductVisitTimes, recordProductVisit } from '../browsing-history';
import { scopedStorageKey } from '../storefront-storage';
import {
    FAVORITE_PRODUCT_LIMIT,
    FAVORITE_PRODUCT_STORAGE_KEY,
    RECENT_PRODUCT_LIMIT,
    RECENT_PRODUCT_STORAGE_KEY,
} from '../storefront-utils';
import { CustomerProductActivity, MarketConfig, StorefrontLanguage } from '../types';

interface Options {
    api: ShopApi;
    market: MarketConfig;
    language: StorefrontLanguage;
    customerId: string | null;
    storefrontCode: string;
    guestFavoriteProductIds: string[];
    guestRecentProductIds: string[];
    setGuestFavoriteProductIds: Dispatch<SetStateAction<string[]>>;
    setGuestRecentProductIds: Dispatch<SetStateAction<string[]>>;
}

function writeGuestIds(key: string, storefrontCode: string, ids: string[]) {
    try {
        localStorage.setItem(scopedStorageKey(key, storefrontCode), JSON.stringify(ids));
    } catch {
        // Guest lists remain usable in memory when storage is restricted.
    }
}

export function useCustomerProductActivity({
    api,
    market,
    language,
    customerId,
    storefrontCode,
    guestFavoriteProductIds,
    guestRecentProductIds,
    setGuestFavoriteProductIds,
    setGuestRecentProductIds,
}: Options) {
    const queryClient = useQueryClient();
    const activeCustomerId = useRef(customerId);
    activeCustomerId.current = customerId;
    const mutationQueue = useRef<Promise<unknown>>(Promise.resolve());
    const key = [
        'storefront',
        `${market.code}:${market.currencyCode}`,
        language,
        'customer-product-activity',
        customerId,
    ];
    const activityQuery = useQuery({
        queryKey: key,
        queryFn: ({ signal }) => api.contentReviewsApi.myCustomerProductActivity(signal),
        enabled: Boolean(customerId),
        staleTime: 0,
    });
    const accountActivity = customerId ? activityQuery.data : null;
    const favoriteProductIds = customerId
        ? (accountActivity?.favoriteProductIds ?? [])
        : guestFavoriteProductIds;
    const recentProductIds = customerId
        ? (accountActivity?.recentProductVisits.map(visit => visit.productId) ?? [])
        : guestRecentProductIds;
    const visitTimes = customerId
        ? Object.fromEntries(
              (accountActivity?.recentProductVisits ?? []).map(visit => [
                  visit.productId,
                  new Date(visit.visitedAt).getTime(),
              ]),
          )
        : readProductVisitTimes(storefrontCode, guestRecentProductIds);

    const enqueue = useCallback(<T>(operation: () => Promise<T>): Promise<T> => {
        const pending = mutationQueue.current.then(operation, operation);
        mutationQueue.current = pending.catch(() => undefined);
        return pending;
    }, []);

    const updateAccount = useCallback(
        (operation: () => Promise<CustomerProductActivity>) =>
            enqueue(async () => {
                if (!customerId || activeCustomerId.current !== customerId) return;
                const result = await operation();
                if (activeCustomerId.current !== customerId) return;
                await queryClient.cancelQueries({ queryKey: key, exact: true });
                queryClient.setQueryData(key, result);
            }),
        [api, customerId, market.code, market.currencyCode, language, queryClient, enqueue],
    );

    const toggleFavoriteProduct = useCallback(
        (productId: string) => {
            if (!storefrontCode) return Promise.resolve();
            if (customerId) {
                return updateAccount(async () => {
                    const current = await queryClient.ensureQueryData({
                        queryKey: key,
                        queryFn: () => api.contentReviewsApi.myCustomerProductActivity(),
                    });
                    if (activeCustomerId.current !== customerId) return current;
                    return api.contentReviewsApi.setFavoriteProduct(
                        productId,
                        !current.favoriteProductIds.includes(productId),
                    );
                });
            }
            setGuestFavoriteProductIds(current => {
                const next = current.includes(productId)
                    ? current.filter(id => id !== productId)
                    : [productId, ...current].slice(0, FAVORITE_PRODUCT_LIMIT);
                writeGuestIds(FAVORITE_PRODUCT_STORAGE_KEY, storefrontCode, next);
                return next;
            });
            return Promise.resolve();
        },
        [
            api,
            customerId,
            storefrontCode,
            updateAccount,
            queryClient,
            market.code,
            market.currencyCode,
            language,
        ],
    );

    const removeFavoriteProducts = useCallback(
        (productIds: string[]) => {
            if (!storefrontCode) return Promise.resolve();
            if (customerId)
                return updateAccount(() => api.contentReviewsApi.removeFavoriteProducts(productIds));
            const removed = new Set(productIds);
            setGuestFavoriteProductIds(current => {
                const next = current.filter(id => !removed.has(id));
                writeGuestIds(FAVORITE_PRODUCT_STORAGE_KEY, storefrontCode, next);
                return next;
            });
            return Promise.resolve();
        },
        [api, customerId, storefrontCode, updateAccount],
    );

    const clearFavorites = useCallback(() => {
        if (customerId) return updateAccount(() => api.contentReviewsApi.clearFavoriteProducts());
        setGuestFavoriteProductIds([]);
        writeGuestIds(FAVORITE_PRODUCT_STORAGE_KEY, storefrontCode, []);
        return Promise.resolve();
    }, [api, customerId, storefrontCode, updateAccount]);

    const visitProduct = useCallback(
        (productId: string) => {
            if (!storefrontCode) return Promise.resolve();
            if (customerId) return updateAccount(() => api.contentReviewsApi.recordProductVisit(productId));
            recordProductVisit(storefrontCode, productId, guestRecentProductIds, RECENT_PRODUCT_LIMIT);
            setGuestRecentProductIds(current => {
                const next = [productId, ...current.filter(id => id !== productId)].slice(
                    0,
                    RECENT_PRODUCT_LIMIT,
                );
                writeGuestIds(RECENT_PRODUCT_STORAGE_KEY, storefrontCode, next);
                return next;
            });
            return Promise.resolve();
        },
        [api, customerId, storefrontCode, guestRecentProductIds, updateAccount],
    );

    const clearVisits = useCallback(() => {
        if (customerId) return updateAccount(() => api.contentReviewsApi.clearProductVisits());
        setGuestRecentProductIds([]);
        writeGuestIds(RECENT_PRODUCT_STORAGE_KEY, storefrontCode, []);
        clearProductVisitTimes(storefrontCode);
        return Promise.resolve();
    }, [api, customerId, storefrontCode, updateAccount]);

    return {
        favoriteProductIds,
        recentProductIds,
        visitTimes,
        loading: Boolean(customerId) && activityQuery.isPending,
        error: customerId ? activityQuery.error : null,
        retry: activityQuery.refetch,
        toggleFavoriteProduct,
        removeFavoriteProducts,
        clearFavorites,
        visitProduct,
        clearVisits,
    };
}
