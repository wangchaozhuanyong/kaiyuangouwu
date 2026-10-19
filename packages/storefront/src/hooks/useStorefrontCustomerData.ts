import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { couponCampaignsForCustomer } from '../coupon-center-state';
import { uiCopy } from '../i18n';
import { offlineLoadError, resolveQueryLoadState, storefrontInitialQueryError } from '../loading-state';
import { storefrontQueryKeys } from '../query-client';
import { storefrontErrorMessage } from '../storefront-errors';
import { type RouteName } from '../storefront-router';
import { type ActiveCustomer, type CustomerIdentity, type StorefrontConfig } from '../types';

import { type StorefrontQueryContext } from './storefront-query-context';

export function useStorefrontCustomerData({
    api,
    market,
    language,
    vendureLanguageCode,
    storefrontContextResolved,
    customerAuthenticated,
    configQuery,
    customerIdentityQuery,
    activeRoute = 'account',
    homepageCoupons = false,
    homepageRecommendations = false,
}: StorefrontQueryContext & {
    customerIdentityQuery: Pick<
        UseQueryResult<CustomerIdentity | null>,
        'data' | 'isLoading' | 'isPaused' | 'isError' | 'error' | 'refetch'
    >;
    activeRoute?: RouteName;
    homepageCoupons?: boolean;
    homepageRecommendations?: boolean;
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

    // Bootstrap owns the sole identity observer. Addresses and recent orders do not
    // join its critical path or get downloaded by every navigation.
    const customerQuery = customerIdentityQuery;
    const identity = storefrontContextResolved ? (customerQuery.data ?? null) : null;
    const addressRoutes: RouteName[] = ['addresses', 'account-security', 'purchase', 'checkout', 'payment'];
    const orderRoutes: RouteName[] = ['account', 'orders', 'notifications', 'logistics', 'recommendations'];
    const needsAddresses = addressRoutes.includes(activeRoute);
    const needsOrders =
        orderRoutes.includes(activeRoute) || (activeRoute === 'home' && homepageRecommendations);
    const customerAddressesQueryKey = [
        ...storefrontQueryKeys.scope(storefrontQueryKeys.market(market), vendureLanguageCode),
        'customer-addresses',
        identity?.id ?? '',
    ];
    const customerRecentOrdersQueryKey = [
        ...storefrontQueryKeys.scope(storefrontQueryKeys.market(market), vendureLanguageCode),
        'customer-recent-orders',
        identity?.id ?? '',
    ];
    const customerAddressesQuery = useQuery({
        queryKey: customerAddressesQueryKey,
        queryFn: ({ signal }) => api.customerAddresses(signal),
        enabled: Boolean(identity) && needsAddresses,
        staleTime: 60_000,
    });
    const customerRecentOrdersQuery = useQuery({
        queryKey: customerRecentOrdersQueryKey,
        queryFn: ({ signal }) => api.customerRecentOrders(signal),
        enabled: Boolean(identity) && needsOrders,
        staleTime: 60_000,
    });
    const confirmedMissing =
        (needsAddresses && customerAddressesQuery.data === null) ||
        (needsOrders && customerRecentOrdersQuery.data === null);
    const customer: ActiveCustomer | null =
        identity && !confirmedMissing
            ? {
                  ...identity,
                  ...(customerAddressesQuery.data !== undefined
                      ? { addresses: customerAddressesQuery.data }
                      : {}),
                  ...(customerRecentOrdersQuery.data != null
                      ? { orders: customerRecentOrdersQuery.data }
                      : {}),
              }
            : null;
    const requiredDetails = customer
        ? [
              ...(needsAddresses ? [customerAddressesQuery] : []),
              ...(needsOrders && activeRoute !== 'home' && activeRoute !== 'recommendations'
                  ? [customerRecentOrdersQuery]
                  : []),
          ]
        : [];
    const detailsFailure = requiredDetails.find(
        query => query.data === undefined && (query.isError || query.isPaused),
    );
    const detailsPending = requiredDetails.find(query => query.data === undefined);
    const customerDetailsLoadState = resolveQueryLoadState({
        hasData: !detailsPending,
        isLoading: Boolean(detailsPending) && !detailsFailure,
        isPaused: Boolean(detailsFailure?.isPaused),
        isError: Boolean(detailsFailure?.isError),
    });
    const customerDetailsLoadError = detailsFailure
        ? (storefrontInitialQueryError(detailsFailure, language) ?? offlineLoadError(language))
        : '';
    const retryCustomerDetails = () =>
        Promise.all(requiredDetails.map(query => query.refetch({ cancelRefetch: false })));
    const couponRoutes: RouteName[] = [
        'coupons',
        'product',
        'cart',
        'purchase',
        'checkout',
        'payment',
        'account',
    ];
    const publicHomepageCoupons = activeRoute === 'home' && homepageCoupons;
    const needsCoupons = couponRoutes.includes(activeRoute) || publicHomepageCoupons;
    const couponCampaignsEnabled = publicHomepageCoupons
        ? storefrontContextResolved
        : Boolean(customer) && needsCoupons;

    const couponCampaignsQueryKey = storefrontQueryKeys.couponCampaigns(
        storefrontQueryKeys.market(market),
        vendureLanguageCode,
        customer?.id ?? null,
    );

    const couponCampaignsQuery = useQuery({
        queryKey: couponCampaignsQueryKey,
        queryFn: ({ signal }) => api.activeCouponCampaigns(signal),
        enabled: couponCampaignsEnabled,
        staleTime: 0,
    });

    // Public requests may run alongside identity bootstrap, but an unresolved account
    // must not flash guest offers which that customer has already claimed.
    const activeCoupons =
        publicHomepageCoupons &&
        (!storefrontContextResolved || customerQuery.data === undefined || (identity && confirmedMissing))
            ? []
            : (couponCampaignsQuery.data ?? []);

    const customerCouponQueryKey = storefrontQueryKeys.customerCoupons(
        storefrontQueryKeys.market(market),
        vendureLanguageCode,
        customer?.id ?? '',
    );

    const customerCouponsQuery = useQuery({
        queryKey: customerCouponQueryKey,
        queryFn: ({ signal }) => api.myAvailableCoupons(signal),
        enabled: Boolean(customer) && needsCoupons,
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
        enabled: Boolean(customer) && activeRoute === 'coupons',
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

    const couponCampaignsLoading = couponCampaignsEnabled && couponCampaignsQuery.isPending;

    const couponCampaignsError =
        !publicHomepageCoupons && customerQuery.data === undefined && customerQuery.isError
            ? customerLoadError
            : storefrontInitialQueryError(couponCampaignsQuery, language);

    const cartQueryError = storefrontInitialQueryError(cartQuery, language);
    return {
        cartQueryKey,
        customerQueryKey,
        cartQuery,
        customerQuery,
        customer,
        customerAddressesQueryKey,
        customerRecentOrdersQueryKey,
        customerDetailsLoadState,
        customerDetailsLoadError,
        retryCustomerDetails,
        customerHistoryPending:
            Boolean(customer) &&
            needsOrders &&
            customerRecentOrdersQuery.data === undefined &&
            !customerRecentOrdersQuery.isError,
        couponCampaignsQueryKey,
        couponCampaignsQuery,
        activeCoupons: customer ? couponCampaignsForCustomer(activeCoupons, myCoupons) : activeCoupons,
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
