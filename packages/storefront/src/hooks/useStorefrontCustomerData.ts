import { useQuery } from '@tanstack/react-query';

import { uiCopy } from '../i18n';
import { offlineLoadError, resolveQueryLoadState } from '../loading-state';
import { storefrontQueryKeys } from '../query-client';
import { storefrontErrorMessage } from '../storefront-errors';

import { type StorefrontQueryContext } from './storefront-query-context';

export function useStorefrontCustomerData({
    api,
    market,
    language,
    vendureLanguageCode,
    storefrontContextResolved,
    catalogAccessGranted,
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
        enabled: storefrontContextResolved && catalogAccessGranted,
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

    const customerCouponsError = !customer
        ? ''
        : customerCouponsQuery.isPaused && customerCouponsQuery.data === undefined
          ? offlineLoadError(language)
          : customerCouponsQuery.error instanceof Error
            ? storefrontErrorMessage(customerCouponsQuery.error, language)
            : customerCouponsQuery.error
              ? text.loadError
              : '';

    const customerCouponUsageRecordsError = !customer
        ? ''
        : customerCouponUsageRecordsQuery.isPaused && customerCouponUsageRecordsQuery.data === undefined
          ? offlineLoadError(language)
          : customerCouponUsageRecordsQuery.error instanceof Error
            ? storefrontErrorMessage(customerCouponUsageRecordsQuery.error, language)
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
              ? storefrontErrorMessage(customerQuery.error, language)
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
                ? storefrontErrorMessage(couponCampaignsQuery.error, language)
                : couponCampaignsQuery.error
                  ? text.loadError
                  : '';

    const cartQueryError =
        cartLoadState === 'paused'
            ? offlineLoadError(language)
            : cartQuery.error instanceof Error
              ? storefrontErrorMessage(cartQuery.error, language)
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
