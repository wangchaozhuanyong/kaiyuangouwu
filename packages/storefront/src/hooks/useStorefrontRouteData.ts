import { useQuery } from '@tanstack/react-query';
import type { QueryLoadState } from '../loading-state';
import type { StorefrontQueryContext } from './storefront-query-context';

import { offlineLoadError } from '../loading-state';
import { orderStatusRefreshInterval } from '../order-refresh';
import {
    PUBLIC_QUERY_GC_TIME,
    PUBLIC_QUERY_STALE_TIME,
    publicQueryMeta,
    storefrontQueryKeys,
} from '../query-client';
import { RouteState } from '../storefront-router';
import { ActiveCustomer } from '../types';
export function useStorefrontRouteData({
    api,
    market,
    language,
    vendureLanguageCode,
    storefrontContextResolved,
    customer,
    customerLoadState,
    route,
}: StorefrontQueryContext & {
    customer: ActiveCustomer | null;
    customerLoadState: QueryLoadState;
    route: RouteState;
}) {
    const isZh = language === 'zh';
    const productQuery = useQuery({
        queryKey: storefrontQueryKeys.product(
            storefrontQueryKeys.market(market),
            vendureLanguageCode,
            route.id ?? '',
        ),
        queryFn: async ({ signal }) => {
            const product = await api.product(route.id ?? '', signal);
            if (!product) throw new Error(isZh ? '商品不存在或已下架' : 'Product not found');
            return product;
        },
        enabled: storefrontContextResolved && route.name === 'product' && !!route.id,
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        meta: publicQueryMeta(),
    });

    const routeProduct = productQuery.data ?? null;

    const routeProductLoading = productQuery.isLoading;

    const routeProductError =
        productQuery.isPaused && productQuery.data === undefined
            ? offlineLoadError(language)
            : productQuery.error instanceof Error
              ? productQuery.error.message
              : '';

    const orderQuery = useQuery({
        queryKey: storefrontQueryKeys.order(
            storefrontQueryKeys.market(market),
            vendureLanguageCode,
            customer?.id ?? '',
            route.id ?? '',
        ),
        queryFn: async ({ signal }) => {
            const order = await api.order(route.id ?? '', signal);
            if (!order) throw new Error(isZh ? '订单不存在或无权查看' : 'Order not found');
            return order;
        },
        enabled: customerLoadState === 'ready' && !!customer && route.name === 'order-detail' && !!route.id,
        staleTime: 0,
        refetchOnMount: 'always',
        refetchInterval: query => orderStatusRefreshInterval(query.state.data?.state),
        gcTime: PUBLIC_QUERY_GC_TIME,
    });

    const routeOrder = orderQuery.data ?? null;

    const routeOrderLoading = orderQuery.isLoading;

    const routeOrderError =
        orderQuery.isPaused && orderQuery.data === undefined
            ? offlineLoadError(language)
            : orderQuery.error instanceof Error
              ? orderQuery.error.message
              : '';
    return {
        productQuery,
        routeProduct,
        routeProductLoading,
        routeProductError,
        orderQuery,
        routeOrder,
        routeOrderLoading,
        routeOrderError,
    };
}
