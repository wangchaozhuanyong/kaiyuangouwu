import { QueryKey, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { storefrontQueryKeys } from '../query-client';
import { storefrontErrorMessage } from '../storefront-errors';
import { RouteName, RouteState } from '../storefront-router';
import { ActiveCustomer, StoreCustomerCoupon, StorefrontCart } from '../types';

import {
    automaticCouponInputKey,
    AutomaticCouponSelection,
    readAutomaticCouponSelection,
    rememberAutomaticCouponSelection,
} from './coupon-auto-selection-state';
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
    refreshConfirmedCart: () => Promise<StorefrontCart>;
    setCartLoading: (loading: boolean) => void;
    setCartError: (error: string | null) => void;
}

function suppressedCouponScope(marketCode: string): string | null {
    try {
        return sessionStorage.getItem(`storefront:coupon-auto-selection-suppressed:${marketCode}`);
    } catch {
        return null;
    }
}

function rememberSuppressedCouponScope(marketCode: string, scope: string): void {
    if (!scope) return;
    try {
        sessionStorage.setItem(`storefront:coupon-auto-selection-suppressed:${marketCode}`, scope);
    } catch {
        // Keep the in-memory choice when browser storage is unavailable.
    }
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
    refreshConfirmedCart,
    setCartLoading,
    setCartError,
}: StorefrontCouponOptions) {
    const queryClient = useQueryClient();
    const isZh = language === 'zh';
    const scopeKey = JSON.stringify([market.code, market.currencyCode, vendureLanguageCode, customer?.id]);
    const createClaimOwner = () => ({
        api,
        scopeKey,
        pending: new Map<string, StoreCustomerCoupon | null>(),
        flight: null as Promise<string | null> | null,
    });
    const couponOwnerRef = useRef(createClaimOwner());
    if (couponOwnerRef.current.api !== api || couponOwnerRef.current.scopeKey !== scopeKey)
        couponOwnerRef.current = createClaimOwner();
    const couponOwner = couponOwnerRef.current;
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);

    const couponAutoSelectionScope =
        cart?.checkoutOrder && customer ? `${customer.id}:${cart.id}:${cart.checkoutOrder.id}` : '';
    const couponAutoSelectionAttemptKey = couponAutoSelectionScope
        ? `${couponAutoSelectionScope}:${automaticCouponInputKey(cart, myCoupons)}`
        : '';
    const automaticSelectionRef = useRef<AutomaticCouponSelection | null>(null);
    const automaticSelection = readAutomaticCouponSelection(market.code) ?? automaticSelectionRef.current;
    const [, recheckAutomaticSelection] = useState(0);
    const couponAutoSelectionAttemptRef = useRef('');
    const couponAutoSelectionPendingRef = useRef('');
    const couponAutoSelectionSuppressedRef = useRef('');
    const couponAutoSelectionScopeRef = useRef(couponAutoSelectionScope);
    couponAutoSelectionScopeRef.current = couponAutoSelectionScope;

    const updateCouponSelection = useCallback(
        async (customerCouponId: string, remove: boolean): Promise<string | null> => {
            const previousSuppression = couponAutoSelectionSuppressedRef.current;
            couponAutoSelectionSuppressedRef.current = couponAutoSelectionScope;
            setCartLoading(true);
            setCartError(null);
            try {
                const { completeCouponSelection } = await import('../coupon-claim-verification');
                return await completeCouponSelection({
                    api,
                    customerCouponId,
                    remove,
                    language,
                    notify,
                    onSelected: () => rememberSuppressedCouponScope(market.code, couponAutoSelectionScope),
                    onRejected: () => {
                        couponAutoSelectionSuppressedRef.current = previousSuppression;
                    },
                    refresh: async () => {
                        await refreshConfirmedCart();
                        await queryClient.invalidateQueries({ queryKey: customerCouponQueryKey });
                    },
                });
            } catch (error) {
                couponAutoSelectionSuppressedRef.current = previousSuppression;
                return storefrontErrorMessage(error, language);
            } finally {
                setCartLoading(false);
            }
        },
        [
            api,
            couponAutoSelectionScope,
            customerCouponQueryKey,
            language,
            market.code,
            notify,
            queryClient,
            refreshConfirmedCart,
        ],
    );
    const applyCoupon = useCallback(
        (id: string) => updateCouponSelection(id, false),
        [updateCouponSelection],
    );
    const removeCoupon = useCallback(
        (id: string) => updateCouponSelection(id, true),
        [updateCouponSelection],
    );

    const claimCoupon = useCallback(
        (campaignId: string): Promise<string | null> => {
            const isCurrent = () => mounted.current && couponOwnerRef.current === couponOwner;
            if (!isCurrent()) return Promise.resolve(null);
            if (!customer) {
                navigate({ name: 'login' });
                return Promise.resolve(isZh ? '请先登录后领取优惠券' : 'Sign in to claim coupons');
            }
            if (couponOwner.flight) return couponOwner.flight;
            setCartLoading(true);
            setCartError(null);
            const refresh = () =>
                Promise.all([
                    queryClient.invalidateQueries({ queryKey: customerCouponQueryKey }),
                    queryClient.invalidateQueries({ queryKey: couponCampaignsQueryKey }),
                    queryClient.invalidateQueries({
                        queryKey: storefrontQueryKeys.customerCouponUsageRecords(
                            storefrontQueryKeys.market(market),
                            vendureLanguageCode,
                            customer.id,
                        ),
                    }),
                ]);
            const run = async (): Promise<string | null> => {
                try {
                    const { completeCouponClaim } = await import('../coupon-claim-verification');
                    if (!isCurrent()) return null;
                    return await completeCouponClaim({
                        api,
                        campaignId,
                        pending: couponOwner.pending,
                        isCurrent,
                        queryClient,
                        customerCouponQueryKey,
                        couponCampaignsQueryKey,
                        refresh,
                        language,
                        notify,
                    });
                } catch (error) {
                    return isCurrent() ? storefrontErrorMessage(error, language) : null;
                } finally {
                    couponOwner.flight = null;
                    if (isCurrent()) setCartLoading(false);
                }
            };
            couponOwner.flight = run();
            return couponOwner.flight;
        },
        [
            api,
            customer,
            couponOwner,
            customerCouponQueryKey,
            couponCampaignsQueryKey,
            isZh,
            market.code,
            navigate,
            notify,
            queryClient,
            vendureLanguageCode,
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
            suppressedCouponScope(market.code) === couponAutoSelectionScope ||
            couponAutoSelectionPendingRef.current === couponAutoSelectionScope ||
            couponAutoSelectionAttemptRef.current === couponAutoSelectionAttemptKey ||
            (automaticSelection?.scope === couponAutoSelectionScope &&
                automaticSelection.attemptKey === couponAutoSelectionAttemptKey) ||
            myCoupons.some(
                coupon =>
                    coupon.lockedOrderId === order.id &&
                    (automaticSelection?.scope !== couponAutoSelectionScope ||
                        automaticSelection.couponId !== coupon.id),
            ) ||
            (!myCoupons.some(coupon => coupon.usable) &&
                !(automaticSelection?.scope === couponAutoSelectionScope && automaticSelection.couponId))
        ) {
            return;
        }

        couponAutoSelectionAttemptRef.current = couponAutoSelectionAttemptKey;
        couponAutoSelectionPendingRef.current = couponAutoSelectionScope;
        setCartLoading(true);
        let active = true;
        let selected = false;
        const requestOwner = couponOwnerRef.current;
        const previousAutomaticId =
            automaticSelection?.scope === couponAutoSelectionScope ? automaticSelection.couponId : null;
        void api
            .applyBestCustomerCoupon()
            .then(async coupon => {
                selected = Boolean(coupon || previousAutomaticId);
                if (coupon) {
                    queryClient.setQueryData<StoreCustomerCoupon[]>(customerCouponQueryKey, current =>
                        current?.map(existing => (existing.id === coupon.id ? coupon : existing)),
                    );
                }
                if (couponOwnerRef.current !== requestOwner) return;
                const selection = {
                    scope: couponAutoSelectionScope,
                    couponId: coupon?.id ?? null,
                    attemptKey: '',
                };
                const isCurrentScope = couponAutoSelectionScopeRef.current === couponAutoSelectionScope;
                const isManual = couponAutoSelectionSuppressedRef.current === couponAutoSelectionScope;
                if (isCurrentScope && !isManual) {
                    automaticSelectionRef.current = selection;
                    rememberAutomaticCouponSelection(market.code, selection);
                    if (selected) await refreshConfirmedCart();
                    selection.attemptKey = couponAutoSelectionAttemptKey;
                    rememberAutomaticCouponSelection(market.code, selection);
                }
                if (active && !isManual && coupon && coupon.id !== previousAutomaticId) {
                    notify(
                        isZh
                            ? `已自动选择最优惠券：${coupon.campaignName}`
                            : `Best coupon applied: ${coupon.campaignName}`,
                    );
                }
                if (selected) {
                    await queryClient.invalidateQueries({ queryKey: customerCouponQueryKey });
                }
            })
            .catch(() => {
                if (
                    selected &&
                    couponOwnerRef.current === requestOwner &&
                    couponAutoSelectionScopeRef.current === couponAutoSelectionScope
                ) {
                    setCartError(
                        isZh
                            ? '优惠券已自动选择，但订单金额刷新失败，请刷新购物车后确认。'
                            : 'A coupon was selected, but the order total could not refresh. Refresh your cart to confirm.',
                    );
                }
            })
            .finally(() => {
                if (couponAutoSelectionPendingRef.current === couponAutoSelectionScope) {
                    couponAutoSelectionPendingRef.current = '';
                }
                if (
                    couponOwnerRef.current === requestOwner &&
                    couponAutoSelectionScopeRef.current === couponAutoSelectionScope
                ) {
                    setCartLoading(false);
                    recheckAutomaticSelection(version => version + 1);
                }
            });
        return () => {
            active = false;
        };
    }, [
        api,
        automaticSelection?.scope,
        automaticSelection?.couponId,
        automaticSelection?.attemptKey,
        cart,
        cartState.pending,
        couponAutoSelectionAttemptKey,
        couponAutoSelectionScope,
        customer,
        customerCouponQueryKey,
        customerCouponsQuery.isPending,
        isZh,
        market.code,
        myCoupons,
        notify,
        queryClient,
        refreshConfirmedCart,
        route.name,
        setCartError,
        setCartLoading,
    ]);

    return { applyCoupon, claimCoupon, removeCoupon };
}
