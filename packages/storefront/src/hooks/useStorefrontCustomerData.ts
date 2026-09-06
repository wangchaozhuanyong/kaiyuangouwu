import { useQuery } from '@tanstack/react-query';
import type { StorefrontQueryContext } from './storefront-query-context';

import { uiCopy } from '../i18n';
import { offlineLoadError, resolveQueryLoadState } from '../loading-state';
import { storefrontQueryKeys } from '../query-client';
export function useStorefrontCustomerData({
    api,
    market,
    language,
    vendureLanguageCode,
    storefrontContextResolved,
}: StorefrontQueryContext) {
    const text = uiCopy[language];
    const cartQueryKey = storefrontQueryKeys.cart(storefrontQueryKeys.market(market), vendureLanguageCode);

    const customerQueryKey = storefrontQueryKeys.customer(
        storefrontQueryKeys.market(market),
        vendureLanguageCode,
    );

    const cartQuery = useQuery({
        queryKey: cartQueryKey,
        queryFn: ({ signal }) => api.cart(signal),
        enabled: storefrontContextResolved,
        staleTime: 0,
    });

    const customerQuery = useQuery({
        queryKey: customerQueryKey,
        queryFn: ({ signal }) => api.activeCustomer(signal),
        enabled: storefrontContextResolved,
        staleTime: 0,
    });

    const customer = customerQuery.data ?? null;

    const couponCampaignsQueryKey = storefrontQueryKeys.couponCampaigns(
        storefrontQueryKeys.market(market),
        vendureLanguageCode,
        customer?.id ?? null,
    );

    const couponCampaignsQuery = useQuery({
        queryKey: couponCampaignsQueryKey,
        queryFn: ({ signal }) => api.activeCouponCampaigns(signal),
        enabled: customerQuery.data !== undefined,
        staleTime: 0,
        refetchInterval: customerQuery.data !== undefined ? 60_000 : false,
    });

    const activeCoupons = couponCampaignsQuery.data ?? [];

    const customerCouponQueryKey = storefrontQueryKeys.customerCoupons(
        storefrontQueryKeys.market(market),
        vendureLanguageCode,
        customer?.id ?? '',
    );

    const customerCouponsQuery = useQuery({
        queryKey: customerCouponQueryKey,
        queryFn: ({ signal }) => api.myCoupons(signal),
        enabled: Boolean(customer),
        staleTime: 0,
        refetchInterval: customer ? 60_000 : false,
    });

    const myCoupons = customerCouponsQuery.data ?? [];

    const customerCouponUsageRecordsQuery = useQuery({
        queryKey: storefrontQueryKeys.customerCouponUsageRecords(
            storefrontQueryKeys.market(market),
            vendureLanguageCode,
            customer?.id ?? '',
        ),
        queryFn: ({ signal }) => api.myCouponUsageRecords(signal),
        enabled: Boolean(customer),
        staleTime: 0,
        refetchInterval: customer ? 60_000 : false,
    });

    const couponUsageRecords = customerCouponUsageRecordsQuery.data ?? [];

    const customerCouponsError = !customer
        ? ''
        : customerCouponsQuery.isPaused && customerCouponsQuery.data === undefined
          ? offlineLoadError(language)
          : customerCouponsQuery.error instanceof Error
            ? customerCouponsQuery.error.message
            : customerCouponsQuery.error
              ? text.loadError
              : '';

    const customerCouponUsageRecordsError = !customer
        ? ''
        : customerCouponUsageRecordsQuery.isPaused && customerCouponUsageRecordsQuery.data === undefined
          ? offlineLoadError(language)
          : customerCouponUsageRecordsQuery.error instanceof Error
            ? customerCouponUsageRecordsQuery.error.message
            : customerCouponUsageRecordsQuery.error
              ? text.loadError
              : '';

    const customerLoadState = resolveQueryLoadState({
        hasData: customerQuery.data !== undefined,
        isLoading: customerQuery.isLoading,
        isPaused: customerQuery.isPaused,
        isError: customerQuery.isError,
    });

    const cartLoadState = resolveQueryLoadState({
        hasData: cartQuery.data !== undefined,
        isLoading: cartQuery.isLoading,
        isPaused: cartQuery.isPaused,
        isError: cartQuery.isError,
    });

    const customerLoadError =
        customerLoadState === 'paused'
            ? offlineLoadError(language)
            : customerQuery.error instanceof Error
              ? customerQuery.error.message
              : text.loadError;

    const couponCampaignsLoading =
        customerQuery.data === undefined
            ? !customerQuery.isError
            : couponCampaignsQuery.isPending && couponCampaignsQuery.data === undefined;

    const couponCampaignsError =
        customerQuery.data === undefined && customerQuery.isError
            ? customerLoadError
            : couponCampaignsQuery.isPaused && couponCampaignsQuery.data === undefined
              ? offlineLoadError(language)
              : couponCampaignsQuery.error instanceof Error
                ? couponCampaignsQuery.error.message
                : couponCampaignsQuery.error
                  ? text.loadError
                  : '';

    const cartQueryError =
        cartLoadState === 'paused'
            ? offlineLoadError(language)
            : cartQuery.error instanceof Error
              ? cartQuery.error.message
              : cartQuery.error
                ? text.loadError
                : null;
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
        cartLoadState,
        couponCampaignsLoading,
        couponCampaignsError,
        cartQueryError,
    };
}
