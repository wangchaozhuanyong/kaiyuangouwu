import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { uiCopy } from '../i18n';
import { offlineLoadError, resolveQueryLoadState, storefrontInitialQueryError } from '../loading-state';
import { storefrontQueryKeys } from '../query-client';
import { storefrontErrorMessage } from '../storefront-errors';
import { type StorefrontConfig } from '../types';

import { type StorefrontQueryContext } from './storefront-query-context';

export function useStorefrontCustomerData({
    api,
    market,
    language,
    vendureLanguageCode,
    storefrontContextResolved,
    customerAuthenticated,
    configQuery,
}: StorefrontQueryContext & {
    configQuery: Pick<
        UseQueryResult<StorefrontConfig>,
        'isLoading' | 'isPaused' | 'isError' | 'error' | 'refetch'
    >;
}) {
    const text = uiCopy[language];
    const cartQueryKey = storefrontQueryKeys.cart(storefrontQueryKeys.market(market), vendureLanguageCode);

    const customerQueryKey = storefrontQueryKeys.customer(
        storefrontQueryKeys.market(market),
        vendureLanguageCode,
    );

    const cartQuery = useQuery({
        queryKey: cartQueryKey,
        queryFn: ({ signal }) => api.cart(signal),
        enabled: storefrontContextResolved && customerAuthenticated,
        staleTime: 0,
    });

    const customerQuery = useQuery({
        queryKey: customerQueryKey,
        queryFn: ({ signal }) => api.activeCustomer(signal),
        enabled: storefrontContextResolved,
        staleTime: 0,
    });

    const customer = storefrontContextResolved ? (customerQuery.data ?? null) : null;

    const couponCampaignsQueryKey = storefrontQueryKeys.couponCampaigns(
        storefrontQueryKeys.market(market),
        vendureLanguageCode,
        customer?.id ?? null,
    );

    const couponCampaignsQuery = useQuery({
        queryKey: couponCampaignsQueryKey,
        queryFn: ({ signal }) => api.activeCouponCampaigns(signal),
        enabled: Boolean(customer),
        staleTime: 0,
    });

    const activeCoupons = couponCampaignsQuery.data ?? [];

    const customerCouponQueryKey = storefrontQueryKeys.customerCoupons(
        storefrontQueryKeys.market(market),
        vendureLanguageCode,
        customer?.id ?? '',
    );

    const customerCouponsQuery = useQuery({
        queryKey: customerCouponQueryKey,
        queryFn: ({ signal }) => api.myAvailableCoupons(signal),
        enabled: Boolean(customer),
        staleTime: 0,
    });

    const myCoupons = customerCouponsQuery.data ?? [];

    const customerCouponUsageRecordsQuery = useQuery({
        queryKey: storefrontQueryKeys.customerCouponUsageRecords(
            storefrontQueryKeys.market(market),
            vendureLanguageCode,
            customer?.id ?? '',
        ),
        queryFn: ({ signal }) => api.myCouponUsageRecordsPage({ take: 20 }, signal),
        enabled: Boolean(customer),
        staleTime: 0,
    });

    const couponUsageRecords = customerCouponUsageRecordsQuery.data?.items ?? [];

    const customerCouponsError = storefrontInitialQueryError(customerCouponsQuery, language);

    const customerCouponUsageRecordsError = storefrontInitialQueryError(
        customerCouponUsageRecordsQuery,
        language,
    );

    // An unresolved store cannot load its account yet. Surface the prerequisite failure
    // instead of leaving the disabled customer query in an endless loading state.
    const customerReadQuery = storefrontContextResolved ? customerQuery : configQuery;
    const customerLoadState = resolveQueryLoadState({
        hasData: storefrontContextResolved && customerQuery.data !== undefined,
        isLoading: customerReadQuery.isLoading,
        isPaused: customerReadQuery.isPaused,
        isError: customerReadQuery.isError,
    });
    const retryCustomer = () => customerReadQuery.refetch({ cancelRefetch: false });

    const cartLoadState = resolveQueryLoadState({
        hasData: cartQuery.data !== undefined,
        isLoading: cartQuery.isLoading,
        isPaused: cartQuery.isPaused,
        isError: cartQuery.isError,
    });

    const customerLoadError =
        customerLoadState === 'paused'
            ? offlineLoadError(language)
            : customerReadQuery.error instanceof Error
              ? storefrontErrorMessage(customerReadQuery.error, language)
              : text.loadError;

    const couponCampaignsLoading =
        Boolean(customer) && couponCampaignsQuery.isPending && couponCampaignsQuery.data === undefined;

    const couponCampaignsError =
        customerQuery.data === undefined && customerQuery.isError
            ? customerLoadError
            : storefrontInitialQueryError(couponCampaignsQuery, language);

    const cartQueryError = storefrontInitialQueryError(cartQuery, language);
    return {
        cartQueryKey,
        customerQueryKey,
        cartQuery,
        customerQuery,
        customer,
        couponCampaignsQueryKey,
        couponCampaignsQuery,
        activeCoupons,
        customerCouponQueryKey,
        customerCouponsQuery,
        myCoupons,
        customerCouponUsageRecordsQuery,
        couponUsageRecords,
        customerCouponsError,
        customerCouponUsageRecordsError,
        customerLoadError,
        customerLoadState,
        retryCustomer,
        cartLoadState,
        couponCampaignsLoading,
        couponCampaignsError,
        cartQueryError,
    };
}
