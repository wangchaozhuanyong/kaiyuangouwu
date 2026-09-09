import { QueryKey, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

import { markCouponCampaignClaimed } from '../coupon-center-state';
import { claimAndVerifyCoupon } from '../coupon-claim-verification';
import { uiCopy } from '../i18n';
import { storefrontQueryKeys } from '../query-client';
import { RouteName, RouteState } from '../storefront-router';
import { ActiveCustomer, StoreCustomerCoupon, StorefrontCart, StorefrontCouponCampaign } from '../types';

import { storefrontErrorMessage } from '../storefront-errors';
import { StorefrontQueryContext } from './storefront-query-context';
import { useStorefrontNavigation } from './useStorefrontNavigation';

interface StorefrontCouponOptions extends StorefrontQueryContext {
    cart: StorefrontCart | null;
    cartState: { pending: boolean };
    route: Pick<RouteState, 'name'>;
    customer: ActiveCustomer | null;
    myCoupons: StoreCustomerCoupon[];
    customerCouponsQuery: { isPending: boolean };
    customerCouponQueryKey: QueryKey;
    couponCampaignsQueryKey: QueryKey;
    notify: (message: string) => void;
    navigate: ReturnType<typeof useStorefrontNavigation>['navigate'];
    refreshCart: () => Promise<StorefrontCart>;
    setCartLoading: (loading: boolean) => void;
    setCartError: (error: string | null) => void;
}

export function useStorefrontCoupons({
    api,
    market,
    language,
    vendureLanguageCode,
    cart,
    cartState,
    route,
    customer,
    myCoupons,
    customerCouponsQuery,
    customerCouponQueryKey,
    couponCampaignsQueryKey,
    notify,
    navigate,
    refreshCart,
    setCartLoading,
    setCartError,
}: StorefrontCouponOptions) {
    const queryClient = useQueryClient();
    const text = uiCopy[language];
    const isZh = language === 'zh';

    const couponAutoSelectionScope =
        cart?.checkoutOrder && customer ? `${customer.id}:${cart.id}:${cart.checkoutOrder.id}` : '';
    const couponAutoSelectionAttemptKey = couponAutoSelectionScope
        ? `${couponAutoSelectionScope}:${cart?.revision ?? 0}:${myCoupons
              .map(coupon => `${coupon.id}:${coupon.status}:${coupon.lockedOrderId ?? ''}`)
              .sort()
              .join('|')}`
        : '';
    const couponAutoSelectionAttemptRef = useRef('');
    const couponAutoSelectionSuppressedRef = useRef('');

    const applyCoupon = useCallback(
        async (customerCouponId: string): Promise<string | null> => {
            couponAutoSelectionSuppressedRef.current = couponAutoSelectionScope;
            setCartLoading(true);
            setCartError(null);
            try {
                await api.applyCustomerCoupon(customerCouponId);
                await Promise.all([queryClient.invalidateQueries({ queryKey: customerCouponQueryKey })]);
                notify(isZh ? '优惠券已使用' : 'Coupon applied');
                return null;
            } catch (requestError) {
                return requestError instanceof Error
                    ? storefrontErrorMessage(requestError, language)
                    : text.loadError;
            } finally {
                setCartLoading(false);
            }
        },
        [
            api,
            couponAutoSelectionScope,
            customerCouponQueryKey,
            isZh,
            notify,
            queryClient,
            refreshCart,
            text.loadError,
        ],
    );

    const claimCoupon = useCallback(
        async (campaignId: string): Promise<string | null> => {
            if (!customer) {
                navigate({ name: 'login' });
                return isZh ? '请先登录后领取优惠券' : 'Sign in to claim coupons';
            }
            setCartLoading(true);
            setCartError(null);
            try {
                const result = await claimAndVerifyCoupon(api, campaignId);
                if (result.status !== 'lookup-failed') {
                    queryClient.setQueryData<StoreCustomerCoupon[]>(customerCouponQueryKey, result.coupons);
                } else {
                    void queryClient.invalidateQueries({ queryKey: customerCouponQueryKey });
                }
                if (result.status === 'verified') {
                    queryClient.setQueryData<StorefrontCouponCampaign[]>(
                        couponCampaignsQueryKey,
                        campaigns =>
                            campaigns ? markCouponCampaignClaimed(campaigns, campaignId) : campaigns,
                    );
                }
                await Promise.all([
                    queryClient.invalidateQueries({ queryKey: couponCampaignsQueryKey }),
                    queryClient.invalidateQueries({
                        queryKey: storefrontQueryKeys.customerCouponUsageRecords(
                            storefrontQueryKeys.market(market),
                            vendureLanguageCode,
                            customer.id,
                        ),
                    }),
                ]);
                if (result.status === 'lookup-failed') {
                    return isZh
                        ? '领取请求已完成，但当前账号权益核验失败。请刷新后查看，若仍未显示请联系客服。'
                        : [
                              'The claim request completed, but account ownership could not be verified.',
                              'Refresh and contact support if it is still missing.',
                          ].join(' ');
                }
                if (result.status === 'missing') {
                    return isZh
                        ? '领取请求已完成，但未在当前账号查到该优惠券。请勿重复领取，刷新后仍未显示请联系客服。'
                        : [
                              'The claim request completed, but the coupon was not found on this account.',
                              'Do not claim again; refresh and contact support if it is still missing.',
                          ].join(' ');
                }
                notify(isZh ? '优惠券领取成功' : 'Coupon claimed');
                return null;
            } catch (requestError) {
                return requestError instanceof Error
                    ? storefrontErrorMessage(requestError, language)
                    : text.loadError;
            } finally {
                setCartLoading(false);
            }
        },
        [
            api,
            customer,
            customerCouponQueryKey,
            couponCampaignsQueryKey,
            isZh,
            market.code,
            navigate,
            notify,
            queryClient,
            text.loadError,
            vendureLanguageCode,
        ],
    );

    const removeCoupon = useCallback(
        async (customerCouponId: string): Promise<string | null> => {
            couponAutoSelectionSuppressedRef.current = couponAutoSelectionScope;
            setCartLoading(true);
            setCartError(null);
            try {
                await api.removeCustomerCoupon(customerCouponId);
                await Promise.all([queryClient.invalidateQueries({ queryKey: customerCouponQueryKey })]);
                notify(isZh ? '已取消使用优惠券' : 'Coupon unapplied');
                return null;
            } catch (requestError) {
                return requestError instanceof Error
                    ? storefrontErrorMessage(requestError, language)
                    : text.loadError;
            } finally {
                setCartLoading(false);
            }
        },
        [
            api,
            couponAutoSelectionScope,
            customerCouponQueryKey,
            isZh,
            notify,
            queryClient,
            refreshCart,
            text.loadError,
        ],
    );

    useEffect(() => {
        const order = cart?.checkoutOrder;
        if (
            !customer ||
            !order?.lines.length ||
            cart?.state !== 'OPEN' ||
            cartState.pending ||
            !(['cart', 'checkout', 'purchase'] as RouteName[]).includes(route.name) ||
            customerCouponsQuery.isPending ||
            !couponAutoSelectionScope ||
            !couponAutoSelectionAttemptKey ||
            couponAutoSelectionSuppressedRef.current === couponAutoSelectionScope ||
            couponAutoSelectionAttemptRef.current === couponAutoSelectionAttemptKey ||
            myCoupons.some(coupon => coupon.lockedOrderId === order.id) ||
            !myCoupons.some(coupon => coupon.usable)
        ) {
            return;
        }

        couponAutoSelectionAttemptRef.current = couponAutoSelectionAttemptKey;
        let active = true;
        void api
            .applyBestCustomerCoupon()
            .then(async coupon => {
                if (!coupon) return;
                queryClient.setQueryData<StoreCustomerCoupon[]>(customerCouponQueryKey, current =>
                    current?.map(existing => (existing.id === coupon.id ? coupon : existing)),
                );
                if (active) {
                    notify(
                        isZh
                            ? `已自动选择最优惠券：${coupon.campaignName}`
                            : `Best coupon applied: ${coupon.campaignName}`,
                    );
                }
                await Promise.all([queryClient.invalidateQueries({ queryKey: customerCouponQueryKey })]);
            })
            .catch(() => undefined);
        return () => {
            active = false;
        };
    }, [
        api,
        cart,
        cartState.pending,
        couponAutoSelectionAttemptKey,
        couponAutoSelectionScope,
        customer,
        customerCouponQueryKey,
        customerCouponsQuery.isPending,
        isZh,
        myCoupons,
        notify,
        queryClient,
        refreshCart,
        route.name,
    ]);

    return { applyCoupon, claimCoupon, removeCoupon };
}
